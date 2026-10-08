import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { SealedNFT } from "../typechain-types";

/** The relayer's ACL refusal. Asserting on it keeps the negative tests honest. */
const NOT_AUTHORIZED = /is not authorized to user decrypt/;

describe("SealedNFT", function () {
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let nft: SealedNFT;
  let nftAddress: string;

  before(async function () {
    const signers = await ethers.getSigners();
    [, alice, bob, carol] = signers;
  });

  beforeEach(async function () {
    // The decrypt assertions below need the mock coprocessor.
    if (!fhevm.isMock) this.skip();

    nft = await (await ethers.getContractFactory("SealedNFT")).deploy();
    nftAddress = await nft.getAddress();
  });

  it("mints a token and lets the owner decrypt a power in [1, 100]", async function () {
    await (await nft.connect(alice).mint()).wait();

    expect(await nft.ownerOf(1)).to.eq(alice.address);
    expect(await nft.totalMinted()).to.eq(1n);

    const handle = await nft.getPower(1);
    expect(handle).to.not.eq(ethers.ZeroHash);

    const power = await fhevm.userDecryptEuint(FhevmType.euint8, handle, nftAddress, alice);
    expect(power).to.be.gte(1n);
    expect(power).to.be.lte(100n);
  });

  it("keeps ownership public while the trait stays sealed", async function () {
    await (await nft.connect(alice).mint()).wait();

    // Anyone can read who holds it and what the handle is...
    expect(await nft.connect(carol).ownerOf(1)).to.eq(alice.address);
    const handle = await nft.connect(carol).getPower(1);
    expect(handle).to.not.eq(ethers.ZeroHash);

    // ...but the handle is just 32 opaque bytes to them.
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint8, handle, nftAddress, carol),
    ).to.be.rejectedWith(NOT_AUTHORIZED);
  });

  it("re-grants decryption to the new owner after a transfer", async function () {
    await (await nft.connect(alice).mint()).wait();

    const before = await fhevm.userDecryptEuint(
      FhevmType.euint8,
      await nft.getPower(1),
      nftAddress,
      alice,
    );

    // Bob cannot decrypt before he owns it.
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint8, await nft.getPower(1), nftAddress, bob),
    ).to.be.rejectedWith(NOT_AUTHORIZED);

    await (await nft.connect(alice).transferFrom(alice.address, bob.address, 1)).wait();
    expect(await nft.ownerOf(1)).to.eq(bob.address);

    const after = await fhevm.userDecryptEuint(
      FhevmType.euint8,
      await nft.getPower(1),
      nftAddress,
      bob,
    );

    // Same sealed value, now readable by its new holder.
    expect(after).to.eq(before);
  });

  it("gives each token its own independently sealed trait", async function () {
    await (await nft.connect(alice).mint()).wait();
    await (await nft.connect(bob).mint()).wait();

    const alicePower = await fhevm.userDecryptEuint(
      FhevmType.euint8,
      await nft.getPower(1),
      nftAddress,
      alice,
    );
    const bobPower = await fhevm.userDecryptEuint(
      FhevmType.euint8,
      await nft.getPower(2),
      nftAddress,
      bob,
    );

    for (const p of [alicePower, bobPower]) {
      expect(p).to.be.gte(1n);
      expect(p).to.be.lte(100n);
    }

    // Alice holds token 1 only — token 2's trait is not hers to read.
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint8, await nft.getPower(2), nftAddress, alice),
    ).to.be.rejectedWith(NOT_AUTHORIZED);
  });

  it("enforces one mint per address and records the minted id", async function () {
    expect(await nft.mintedTokenId(alice.address)).to.eq(0n);
    await (await nft.connect(alice).mint()).wait();
    expect(await nft.mintedTokenId(alice.address)).to.eq(1n);

    await expect(nft.connect(alice).mint())
      .to.be.revertedWithCustomError(nft, "AlreadyMinted")
      .withArgs(alice.address);
  });

  it("lets only the holder publish, and then anyone can read it", async function () {
    await (await nft.connect(alice).mint()).wait();
    const handle = await nft.getPower(1);

    // Sealed: a public decrypt is refused outright.
    await expect(fhevm.publicDecryptEuint(FhevmType.euint8, handle))
      .to.be.rejectedWith(/not allowed for public decryption/);

    await expect(nft.connect(bob).publish(1))
      .to.be.revertedWithCustomError(nft, "NotHolder").withArgs(1n);

    await (await nft.connect(alice).publish(1)).wait();
    expect(await nft.published(1)).to.eq(true);

    const open = await fhevm.publicDecryptEuint(FhevmType.euint8, handle);
    const toAlice = await fhevm.userDecryptEuint(FhevmType.euint8, handle, nftAddress, alice);
    expect(open).to.eq(toAlice);
    expect(open).to.be.gte(1n).and.to.be.lte(100n);

    // Irreversible, and the metadata stops claiming otherwise.
    await expect(nft.connect(alice).publish(1))
      .to.be.revertedWithCustomError(nft, "AlreadyPublished");
    const meta = JSON.parse(
      Buffer.from((await nft.tokenURI(1)).split(",")[1], "base64").toString(),
    );
    expect(meta.attributes.find((a: any) => a.trait_type === "Essence").value).to.eq("Public");
  });

  it("settles a duel without revealing either power", async function () {
    await (await nft.connect(alice).mint()).wait();
    await (await nft.connect(bob).mint()).wait();

    const pa = await fhevm.userDecryptEuint(FhevmType.euint8, await nft.getPower(1), nftAddress, alice);
    const pb = await fhevm.userDecryptEuint(FhevmType.euint8, await nft.getPower(2), nftAddress, bob);

    // Anyone may call it — there is nothing in the inputs left to protect.
    await (await nft.connect(carol).duel(1, 2)).wait();
    const [a, b, aWins] = await nft.duelResult(1);
    expect(a).to.eq(1n);
    expect(b).to.eq(2n);

    const verdict = await fhevm.publicDecryptEbool(aWins);
    expect(verdict).to.eq(pa > pb);

    // The verdict went public. The powers did not.
    await expect(fhevm.publicDecryptEuint(FhevmType.euint8, await nft.getPower(1)))
      .to.be.rejectedWith(/not allowed for public decryption/);
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint8, await nft.getPower(2), nftAddress, carol),
    ).to.be.rejectedWith(NOT_AUTHORIZED);
  });

  it("rejects a duel against itself or a missing token", async function () {
    await (await nft.connect(alice).mint()).wait();
    await expect(nft.duel(1, 1)).to.be.revertedWithCustomError(nft, "SameToken");
    await expect(nft.duel(1, 77)).to.be.revertedWithCustomError(nft, "NonexistentToken");
  });

  it("serves fully on-chain metadata that admits the essence is encrypted", async function () {
    await (await nft.connect(alice).mint()).wait();

    const uri = await nft.tokenURI(1);
    expect(uri.startsWith("data:application/json;base64,")).to.eq(true);

    const meta = JSON.parse(
      Buffer.from(uri.slice("data:application/json;base64,".length), "base64").toString(),
    );
    expect(meta.name).to.eq("Sealed #1");
    expect(meta.image.startsWith("data:image/svg+xml;base64,")).to.eq(true);

    const svg = Buffer.from(
      meta.image.slice("data:image/svg+xml;base64,".length), "base64",
    ).toString();
    // Eight plates, never nine: the centre is where its holder looks from.
    expect(svg.match(/width="96" height="96"/g)?.length).to.eq(8);
    expect(svg).to.contain("SEALED");

    const essence = meta.attributes.find(
      (a: { trait_type: string }) => a.trait_type === "Essence",
    );
    expect(essence.value).to.eq("Encrypted");
    // The metadata must never leak the number, even as a placeholder.
    expect(uri).to.not.contain("power");
  });

  it("gives every token a different mark, derived only from public data", async function () {
    await (await nft.connect(alice).mint()).wait();
    await (await nft.connect(bob).mint()).wait();

    const svgOf = async (id: number) => {
      const uri = await nft.tokenURI(id);
      const meta = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
      return Buffer.from(meta.image.split(",")[1], "base64").toString();
    };

    const a = await svgOf(1);
    const b = await svgOf(2);
    expect(a).to.not.eq(b);              // distinct art
    expect(await svgOf(1)).to.eq(a);     // but stable for a given token

    for (const svg of [a, b]) {
      expect(svg.match(/width="96" height="96"/g)?.length).to.eq(8);
      expect(svg).to.contain("SEALED");
    }

    // The mark is keyed to the token, not to who holds it or what it is worth:
    // transferring must not repaint it. (Non-leakage is structural — the art
    // path never reads `_power` — so this guards the observable half.)
    await (await nft.connect(alice).transferFrom(alice.address, carol.address, 1)).wait();
    expect(await nft.ownerOf(1)).to.eq(carol.address);
    expect(await svgOf(1)).to.eq(a);
  });

  it("reverts tokenURI for a token that does not exist", async function () {
    await expect(nft.tokenURI(99)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
  });

  it("reverts getPower for a token that does not exist", async function () {
    await expect(nft.getPower(99))
      .to.be.revertedWithCustomError(nft, "NonexistentToken")
      .withArgs(99n);
  });
});
