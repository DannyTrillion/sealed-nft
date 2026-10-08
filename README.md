# SealedNFT — an NFT with one encrypted trait

A plain ERC-721 where **who owns what is public, but each token's `power` stat is not**.
At mint the FHE coprocessor draws a random `euint8` in `[1, 100]`; the chain only ever stores an opaque ciphertext handle.
The contract puts that handle on an ACL naming itself and the holder, so only the holder can ask the relayer to decrypt it.
Transfers re-grant the ACL to the incoming holder, so the stat follows the token rather than the original minter.
Nobody — not the deployer, not an indexer, not the coprocessor alone — can read a power they were never granted.

## Layout

| Path | What |
|---|---|
| [contracts/SealedNFT.sol](contracts/SealedNFT.sol) | The contract |
| [test/SealedNFT.ts](test/SealedNFT.ts) | 6 tests against the fhEVM mock node |
| [scripts/deploy.ts](scripts/deploy.ts) | Sepolia deploy + frontend handoff |
| [frontend/](frontend/) | Vite + ethers: connect, mint, reveal |

## Quick start

```bash
npm install
npm run compile
npm test            # 6 passing, no network needed
```

The tests run against the in-process mock coprocessor that `@fhevm/hardhat-plugin`
provides, so no Sepolia key or RPC is required to see the whole flow work.

## Live

| | |
|---|---|
| App | **https://sealed-nft.vercel.app** |
| Contract | [`0xe5076202af98b10C1af09c08FfD31174b0C7805c`](https://sepolia.etherscan.io/address/0xe5076202af98b10C1af09c08FfD31174b0C7805c) |
| Source | verified on [Etherscan](https://sepolia.etherscan.io/address/0xe5076202af98b10C1af09c08FfD31174b0C7805c#code) and [Sourcify](https://repo.sourcify.dev/11155111/0xe5076202af98b10C1af09c08FfD31174b0C7805c) |
| Supply | 10 tokens, 10 distinct holders · 1 published · 1 duel settled |

Exercised against the live coprocessor and relayer, not only the mock:

- **Mint** draws inside the coprocessor and seals to the minter (~810k gas).
- **Reveal** works in the browser: WASM load → EIP-712 signature → relayer re-encryption.
- **Handover** — a token was transferred on-chain and re-checked: handle unchanged, the
  **new holder decrypts the same value**, a never-holder is refused, and the **previous
  holder can still read it**, exactly as the no-revoke caveat below predicts.
- **Publish** (`FHE.makePubliclyDecryptable`) — holder-only and irreversible. Token #9 is
  published; its power reads **95** to anyone.
- **Duel** (`FHE.gt` on two ciphertexts) — duel #1 compared #1 against #9 and made only the
  one-bit verdict public. It says #9 won; #9 is 95 and #1 is 90, so the bit is right, and
  **#1's power is still sealed to the public** despite having lost.

### The duel leaks one bit, and bits add up

`duel()` publishes a single comparison bit, never the inputs. But duelling one token
against many whose powers are already published narrows its value by bisection. A
production design would rate-limit duels per token or require both holders to opt in;
this demo does neither, and says so in the contract comments.

## The art, and why it cannot come from the essence

Each token's mark is generated on-chain — base64 SVG inside base64 JSON, no server and no
IPFS pin — from `keccak256(chainid, contract, tokenId)`. Hue, plate brightness and the
glyph in each of the eight tiles all come from that seed. The centre stays empty.

The seed deliberately excludes the sealed value. **Art derived from the essence would leak
it**: anyone could read a token's power straight off its picture, and the encryption would
be decorative. So the marks are unique and public, and tell you nothing you did not
already know from the token id.

That is also why the "For you" page draws the mark and the gauge separately. The mark is
public and always visible. The eight-segment gauge only fills after a real user
decryption.

## Deploy to Sepolia

```bash
cp .env.example .env     # then fill in SEPOLIA_RPC_URL and PRIVATE_KEY
npm run deploy:sepolia
```

Credentials are read from `.env` only — nothing is hardcoded, and `.env` is gitignored.
The script refuses to run with an unset RPC/key or an unfunded deployer, and on success
writes `frontend/src/contracts/SealedNFT.json` (`{ address, chainId, abi }`) for the frontend.

Optionally: `npx hardhat verify --network sepolia <address>` (needs `ETHERSCAN_API_KEY`).

## Frontend

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```

An app-shell dashboard in the Fungo Labs design language (`#FFD207` on `#0B0B10`,
Archivo + JetBrains Mono, corner-bracket panels, mono numerics), across three routes:

- **`#/public`** — the collection as a grid where every card looks identical, because
  that is the point. Public holders, sealed essences, the real 32-byte handle under each.
  Yours is the one card that glows.
- **`#/you`** — your token alone. The eight-tile mark fills clockwise in proportion to the
  decrypted power. The **The public / You** toggle flips between what the chain shows
  everyone and what only you can reach; switching to *You* triggers the decryption.
- **`#/how`** — the mechanism, with a live `enc(7) + enc(5) = enc(12)` demo churning real
  hex, the four-step mint-to-reveal path, and the two caveats worth knowing.

The collection loads read-only over a public RPC before any wallet connects — who holds
what was always public, and the page should say so on load. Wrong network is fixed rather
than reported: the app calls `wallet_switchEthereumChain`, falls back to
`wallet_addEthereumChain` on error `4902`, and turns the network pill into the retry.

Reveal is a `@zama-fhe/relayer-sdk` *user decryption*: an ephemeral keypair, an EIP-712
request scoped to this contract and a one-day window, and a relayer that re-encrypts the
value to that keypair — but only because the on-chain ACL lists you.

### The one Vite detail that matters

Import the SDK from **`@zama-fhe/relayer-sdk/web`**, not `/bundle`.

`/bundle` is not a module. Its entire body is three lines reading `window.relayerSDK.*`,
so it only works if you have already loaded the UMD build through a `<script>` tag.
Import it under Vite and you get `Cannot read properties of undefined (reading 'initSDK')`
— and if you import it at module scope, that one error takes down the whole page,
including connect and mint. `/web` is the real ESM build; its WASM is referenced with
`new URL('tfhe_bg.wasm', import.meta.url)`, which Vite resolves on its own. It is still
imported lazily inside the reveal handler so a slow WASM load costs you the reveal rather
than the page.

## Two things worth knowing

**ACL grants are additive and permanent — FHEVM has no revoke.** A past holder keeps
the ability to decrypt the handle they held. So "only the current holder can decrypt"
holds against anyone who *never* held the token, which is what the tests assert; it is
not a guarantee against a previous owner. Rotating the secret on transfer would mean
re-randomizing the trait, which is a different product.

**The draw has a tiny modulo bias.** `FHE.randEuint8(upperBound)` only accepts powers
of two, so `mint()` draws 16 bits and reduces mod 100 — a bias under 0.06%, fine for a
cosmetic trait and not fine for anything adversarial.

## Stack

`@fhevm/solidity` 0.11.1 · `@fhevm/hardhat-plugin` 0.4.2 · `@zama-fhe/relayer-sdk` 0.4.1 ·
`@openzeppelin/contracts` 5.4.0 · Solidity 0.8.27 (`evmVersion: cancun`, required for
EIP-1153 transient storage).

> The relayer SDK prints a deprecation notice pointing at `@zama-fhe/sdk`. 0.4.1 is
> pinned here because that is what was asked for; it works, but a migration is pending upstream.
