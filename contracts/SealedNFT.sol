// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {FHE, ebool, euint8, euint16} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title  SealedNFT
 * @notice An ERC-721 where ownership is public but each token carries one sealed
 *         trait: an encrypted `power` in [1, 100], generated on-chain by the FHE
 *         coprocessor at mint time. Nobody — not the minter, not the deployer,
 *         not an indexer — learns the value except through a user decryption that
 *         the ACL authorizes, and the ACL only ever names the current holder.
 */
contract SealedNFT is ERC721, ZamaEthereumConfig {
    using Strings for uint256;

    /// @notice Inclusive bounds of the sealed trait.
    uint8 public constant MIN_POWER = 1;
    uint8 public constant MAX_POWER = 100;

    uint256 private _nextTokenId = 1;

    /// @dev tokenId => encrypted trait handle.
    mapping(uint256 tokenId => euint8 power) private _power;

    /// @notice The token an address minted, or 0 if it never minted (ids start at 1).
    ///         Doubles as the one-mint-per-address guard and as the frontend's lookup.
    mapping(address minter => uint256 tokenId) public mintedTokenId;

    /// @notice A settled duel. Only `aWins` is ever made public — never the powers.
    struct Duel {
        uint256 a;
        uint256 b;
        ebool aWins;
    }

    /// @notice Essences their holder chose to make public. One way only.
    mapping(uint256 tokenId => bool) public published;

    mapping(uint256 duelId => Duel) private _duels;
    uint256 public totalDuels;

    event Minted(address indexed to, uint256 indexed tokenId);
    event Published(uint256 indexed tokenId);
    event Duelled(uint256 indexed duelId, uint256 indexed a, uint256 indexed b);

    error AlreadyMinted(address minter);
    error NotHolder(uint256 tokenId);
    error AlreadyPublished(uint256 tokenId);
    error SameToken();
    error NonexistentToken(uint256 tokenId);

    constructor() ERC721("Sealed NFT", "SEAL") {}

    /**
     * @notice Mint one token to the caller with a freshly generated sealed trait.
     * @return tokenId The id of the newly minted token.
     */
    function mint() external returns (uint256 tokenId) {
        if (mintedTokenId[msg.sender] != 0) revert AlreadyMinted(msg.sender);

        tokenId = _nextTokenId++;
        mintedTokenId[msg.sender] = tokenId;

        // Draw over 16 bits, then fold into [1, 100]. `randEuint8(upperBound)`
        // only accepts powers of two, and reducing a 16-bit draw mod 100 leaves
        // a modulo bias under 0.06% — fine for a trait, not for anything
        // adversarial. The draw happens inside the coprocessor: no plaintext
        // randomness ever exists on-chain.
        euint16 raw = FHE.randEuint16();
        euint8 power = FHE.asEuint8(FHE.add(FHE.rem(raw, MAX_POWER), MIN_POWER));

        _power[tokenId] = power;
        FHE.allowThis(power); // persist the handle for this contract
        FHE.allow(power, msg.sender); // let the holder decrypt it off-chain

        _safeMint(msg.sender, tokenId);
        emit Minted(msg.sender, tokenId);
    }

    /**
     * @notice Make this token's essence readable by everyone, for good.
     * @dev    Only the current holder may start it, and nothing can undo it:
     *         `makePubliclyDecryptable` is irreversible at the protocol level.
     *         This is the "your art, your call" half — sealed by default, public
     *         only by a deliberate act of whoever holds it.
     */
    function publish(uint256 tokenId) external {
        if (_ownerOf(tokenId) != msg.sender) revert NotHolder(tokenId);
        if (published[tokenId]) revert AlreadyPublished(tokenId);

        published[tokenId] = true;
        FHE.makePubliclyDecryptable(_power[tokenId]);
        emit Published(tokenId);
    }

    /**
     * @notice Settle which of two tokens is stronger without revealing either power.
     * @dev    The comparison runs on ciphertext; only the one-bit verdict is made
     *         public. Anyone may call it — there is nothing to protect in the inputs,
     *         because nothing about them leaks beyond that single bit.
     *
     *         Honest caveat: bits accumulate. Duelling one token against many whose
     *         powers are already published narrows its value by bisection. A
     *         production design would rate-limit duels per token, or require both
     *         holders to opt in. This demo does neither.
     */
    function duel(uint256 a, uint256 b) external returns (uint256 duelId) {
        if (a == b) revert SameToken();
        if (_ownerOf(a) == address(0)) revert NonexistentToken(a);
        if (_ownerOf(b) == address(0)) revert NonexistentToken(b);

        ebool aWins = FHE.gt(_power[a], _power[b]);
        FHE.allowThis(aWins);
        FHE.makePubliclyDecryptable(aWins); // the verdict, and only the verdict

        duelId = ++totalDuels;
        _duels[duelId] = Duel({a: a, b: b, aWins: aWins});
        emit Duelled(duelId, a, b);
    }

    /// @notice The encrypted verdict handle for a duel. Publicly decryptable.
    function duelResult(uint256 duelId) external view returns (uint256 a, uint256 b, ebool aWins) {
        Duel storage d = _duels[duelId];
        return (d.a, d.b, d.aWins);
    }

    /// @notice The encrypted trait handle. Opaque unless the caller is on its ACL.
    function getPower(uint256 tokenId) external view returns (euint8) {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);
        return _power[tokenId];
    }

    /// @notice Total number of tokens minted so far.
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    /**
     * @notice Fully on-chain metadata. No server, no IPFS pin, nothing that can be
     *         swapped later — matching the point of the collection.
     * @dev    Every token renders the same mark on purpose. Publicly there is nothing
     *         to tell them apart, so the art must not pretend otherwise. The essence
     *         is reported as encrypted rather than omitted, so a marketplace shows
     *         that a trait exists and is unreadable.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory id = tokenId.toString();

        string memory json = string.concat(
            '{"name":"Sealed #', id,
            '","description":"An ERC-721 whose essence is encrypted on-chain with Zama FHE. ',
            'Ownership is public; the power trait is a ciphertext handle only the current holder can decrypt.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(_mark(tokenId, id))), '",',
            '"attributes":[',
            '{"trait_type":"Essence","value":"', published[tokenId] ? 'Public' : 'Encrypted', '"},',
            '{"trait_type":"Power","value":"', published[tokenId] ? 'Published' : 'Sealed', '"},',
            '{"trait_type":"Trait type","value":"euint8"},',
            '{"trait_type":"Range","value":"1-100"}]}'
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /**
     * @dev Eight tiles around an empty centre, coloured and glyphed per token.
     *
     *      The seed comes from the token id and this contract only — never from
     *      the sealed value. Deriving the art from the essence would leak it:
     *      anyone could read a token's power off its picture. So every mark is
     *      unique, and no mark tells you anything you did not already know.
     *
     *      Split across three helpers to keep each frame shallow; one big
     *      `string.concat` here puts solc over its stack limit.
     */
    function _mark(uint256 tokenId, string memory id) private view returns (string memory) {
        uint256 seed = uint256(keccak256(abi.encodePacked(block.chainid, address(this), tokenId)));
        return string.concat(_backdrop(seed), _tiles(seed), _footer(id));
    }

    function _backdrop(uint256 seed) private pure returns (string memory) {
        string memory hue = (seed % 360).toString();
        string memory alt = ((seed % 360 + 140 + ((seed >> 9) % 80)) % 360).toString();
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">',
            '<defs><radialGradient id="g"><stop offset="0" stop-color="hsl(', hue,
            ',70%,55%)" stop-opacity="0.22"/><stop offset="1" stop-color="hsl(', hue,
            ',70%,55%)" stop-opacity="0"/></radialGradient></defs>',
            '<rect width="600" height="600" fill="#0b0b10"/>',
            '<circle cx="300" cy="286" r="250" fill="url(#g)"/>',
            '<circle cx="300" cy="286" r="208" fill="none" stroke="hsl(', alt,
            ',60%,60%)" stroke-opacity="0.22" stroke-width="1.5" stroke-dasharray="',
            (4 + (seed % 14)).toString(), ' ', (8 + ((seed >> 5) % 18)).toString(), '"/>'
        );
    }

    function _tiles(uint256 seed) private pure returns (string memory out) {
        uint16[3] memory pos = [uint16(140), 252, 364];
        uint256 hue = seed % 360;
        uint256 alt = (hue + 140 + ((seed >> 9) % 80)) % 360;
        uint256 k;
        for (uint256 r = 0; r < 3; r++) {
            for (uint256 c = 0; c < 3; c++) {
                if (r == 1 && c == 1) continue; // the centre stays empty
                uint256 bits = (seed >> (k * 6)) & 63;
                out = string.concat(out, _tile(pos[c], pos[r], (bits & 7) == 0 ? alt : hue, bits));
                k++;
            }
        }
    }

    function _footer(string memory id) private pure returns (string memory) {
        return string.concat(
            '<text x="300" y="516" fill="#ffd207" font-family="monospace" font-size="26" ',
            'letter-spacing="4" text-anchor="middle">SEALED</text>',
            '<text x="300" y="556" fill="#5c594f" font-family="monospace" font-size="20" ',
            'text-anchor="middle">#', id, '</text></svg>'
        );
    }

    /// @dev One tile: a tinted plate, plus a glyph chosen by two bits of the seed.
    function _tile(uint256 x, uint256 y, uint256 hue, uint256 bits) private pure returns (string memory) {
        string memory h = hue.toString();
        uint256 lum = 42 + ((bits >> 3) % 4) * 9;           // plate brightness
        string memory cx = (x + 48).toString();
        string memory cy = (y + 48).toString();

        string memory glyph;
        uint256 kind = (bits >> 1) & 3;
        if (kind == 1) {
            glyph = string.concat('<circle cx="', cx, '" cy="', cy, '" r="19" fill="hsl(', h, ',75%,62%)" fill-opacity="0.75"/>');
        } else if (kind == 2) {
            glyph = string.concat(
                '<rect x="', (x + 28).toString(), '" y="', (y + 28).toString(),
                '" width="40" height="40" rx="5" transform="rotate(45 ', cx, ' ', cy,
                ')" fill="hsl(', h, ',75%,62%)" fill-opacity="0.6"/>'
            );
        } else if (kind == 3) {
            glyph = string.concat(
                '<rect x="', (x + 20).toString(), '" y="', (y + 42).toString(),
                '" width="56" height="12" rx="6" fill="hsl(', h, ',80%,65%)" fill-opacity="0.7"/>'
            );
        }

        return string.concat(
            '<rect x="', x.toString(), '" y="', y.toString(),
            '" width="96" height="96" rx="12" fill="hsl(', h, ',45%,', lum.toString(),
            '%)" fill-opacity="0.16" stroke="hsl(', h, ',65%,60%)" stroke-opacity="0.45" stroke-width="2"/>',
            glyph
        );
    }

    /**
     * @dev Single ERC-721 mint/transfer/burn hook in OpenZeppelin v5. On a real
     *      transfer we extend the trait's ACL to the incoming holder so they can
     *      decrypt. Mint already granted the minter; burns (`to == 0`) grant nobody.
     *
     *      Caveat worth knowing: FHEVM ACL grants are additive and permanent —
     *      there is no revoke. A past holder keeps the ability to decrypt the
     *      handle they held. "Only the current holder can decrypt" is therefore
     *      true of anyone who never held the token, which is the property this
     *      demo actually enforces.
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);

        euint8 power = _power[tokenId];
        if (from != address(0) && to != address(0) && FHE.isInitialized(power)) {
            FHE.allow(power, to);
        }
    }
}
