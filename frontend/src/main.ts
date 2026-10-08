import { BrowserProvider, Contract, JsonRpcProvider, Wallet, formatEther, type Eip1193Provider } from "ethers";
import { Cipher, toast, short, revealOnScroll, animateEncBoxes } from "./ui";
import { startRouter, go, type Route } from "./router";
import { startStars } from "./stars";
import artifact from "./contracts/SealedNFT.json";

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { on?: (e: string, cb: (...a: unknown[]) => void) => void };
  }
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const connectBtn = el<HTMLButtonElement>("connect");
const walletMenu = el<HTMLElement>("walletMenu");
const menuAddr = el<HTMLElement>("menuAddr");
const menuCopy = el<HTMLButtonElement>("menuCopy");
const menuExplorer = el<HTMLAnchorElement>("menuExplorer");
const menuDisconnect = el<HTMLButtonElement>("menuDisconnect");
const mintBtn = el<HTMLButtonElement>("mint");
const revealBtn = el<HTMLButtonElement>("reveal");
const publishBtn = el<HTMLButtonElement>("publish");
const duelPanel = el<HTMLElement>("duelPanel");
const duelMe = el<HTMLElement>("duelMe");
const duelPick = el<HTMLSelectElement>("duelPick");
const duelGo = el<HTMLButtonElement>("duelGo");
const duelOut = el<HTMLElement>("duelOut");
const duelCount = el<HTMLElement>("duelCount");
const copyBtn = el<HTMLButtonElement>("copyHandle");
const netPill = el<HTMLElement>("net");
const netName = el<HTMLElement>("netName");
const youTitle = el<HTMLElement>("youTitle");
const youLede = el<HTMLElement>("youLede");
const seg = el<HTMLElement>("seg");
const standin = el<HTMLElement>("standin");
const standinTitle = el<HTMLElement>("standinTitle");
const standinText = el<HTMLElement>("standinText");
const standinAction = el<HTMLButtonElement>("standinAction");
const grid = el<HTMLElement>("grid");
const gridCount = el<HTMLElement>("gridCount");
const statHolders = el<HTMLElement>("statHolders");
const statReadable = el<HTMLElement>("statReadable");
const detail = el<HTMLElement>("detail");
const chip = el<HTMLElement>("chip");
const chipText = el<HTMLElement>("chipText");
const tokenIdEl = el<HTMLElement>("tokenId");
const tokenArt = el<HTMLImageElement>("tokenArt");
const gauge = el<HTMLElement>("gauge");
const powerMax = el<HTMLElement>("powerMax");
const handleEl = el<HTMLElement>("handle");
const sHolder = el<HTMLElement>("sHolder");
const sAcl = el<HTMLElement>("sAcl");
const noteEl = el<HTMLElement>("note");
const statMinted = el<HTMLElement>("statMinted");
const statContract = el<HTMLAnchorElement>("statContract");
const statChain = el<HTMLElement>("statChain");
const footContract = el<HTMLElement>("footContract");

const power = new Cipher(el<HTMLElement>("power"));
const segments = Array.from(gauge.querySelectorAll("i"));

const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
};
const ZERO_HANDLE = "0x" + "0".repeat(64);

/** tokenURI is base64 JSON wrapping a base64 SVG — both fully on-chain. */
function imageFromTokenURI(uri: string): string {
  try {
    const json = JSON.parse(atob(uri.slice(uri.indexOf(",") + 1)));
    return typeof json.image === "string" ? json.image : "";
  } catch {
    return "";
  }
}
/** Read-only endpoint so the collection renders before any wallet shows up —
 *  who holds what was always public, and the page should say so on load. */
const PUBLIC_RPC: Record<number, string> = {
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
};

const CHAIN_NAMES: Record<number, string> = { 1: "Ethereum", 11155111: "Sepolia" };

/** Enough for wallet_addEthereumChain when the wallet does not know the chain yet. */
const CHAIN_PARAMS: Record<number, Record<string, unknown>> = {
  11155111: {
    chainId: "0xaa36a7",
    chainName: "Sepolia",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [PUBLIC_RPC[11155111]],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
};

const chainLabel = (id: number) => CHAIN_NAMES[id] ?? `chain ${id}`;

type Row = { id: bigint; owner: string; handle: string; image: string; published: boolean };

const state = {
  account: undefined as string | undefined,
  rows: [] as Row[],
  mine: 0n,
  /** Decrypted values, keyed by token id. Only ever populated for tokens we hold. */
  revealed: new Map<string, bigint>(),
  /** "public" shows what the chain shows everyone; "holder" shows what you alone can see. */
  pov: "public" as "public" | "holder",
  route: "public" as Route,
  duels: 0,
  loading: true,
};

/**
 * Local recording mode. With VITE_DEMO_KEY set in .env.local, the app signs with
 * a throwaway key over its own RPC instead of an injected wallet — the chain work
 * is identical, it just sidesteps a wallet whose endpoint is rate-limited.
 *
 * `import.meta.env.DEV` is statically false in a production build, so this whole
 * branch is stripped from anything that ships.
 */
const DEMO_KEY = import.meta.env.DEV ? (import.meta.env.VITE_DEMO_KEY as string | undefined) : undefined;
let demoSigner: Wallet | undefined;

let provider: BrowserProvider;
/** Signer-backed once connected; until then reads go through `readNft`. */
let nft: Contract | undefined;
let readNft: Contract | undefined;

const isMine = (addr?: string) =>
  !!addr && !!state.account && addr.toLowerCase() === state.account.toLowerCase();

function note(msg: string, kind: "info" | "error" = "info") {
  noteEl.textContent = msg;
  noteEl.dataset.kind = kind;
}

function lightTiles(n: number) {
  segments.forEach((seg, i) => {
    seg.style.setProperty("--step", String(i));
    seg.classList.toggle("on", i < n);
  });
}

// ── rendering ────────────────────────────────────────────────────


// ── render: public page ──────────────────────────────────────────

function skeletonCards(n = 8) {
  grid.replaceChildren(
    ...Array.from({ length: n }, () => {
      const d = document.createElement("div");
      d.className = "skeleton";
      d.innerHTML = '<span class="sk a"></span><span class="sk b"></span><span class="sk c"></span><span class="sk d"></span>';
      return d;
    }),
  );
}

function renderGrid() {
  if (state.loading) {
    gridCount.textContent = "reading the chain…";
    return skeletonCards();
  }

  gridCount.textContent = `${state.rows.length} token${state.rows.length === 1 ? "" : "s"}`;

  if (!state.rows.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Nothing minted yet. Be the first.";
    grid.replaceChildren(p);
    return;
  }

  grid.replaceChildren(
    ...state.rows.map((r, i) => {
      const mine = isMine(r.owner);
      const card = document.createElement(mine ? "button" : "div");
      card.className = "gcard" + (mine ? " is-mine" : "");
      card.style.setProperty("--i", String(i));

      card.innerHTML =
        '<div class="gcard-top"><span class="gcard-id">#' + r.id + '</span>' +
        '<span class="gcard-chip"' + (r.published ? ' data-tone="public"' : "") + ">" +
        (r.published ? "Published" : mine ? "Yours" : "Sealed") + "</span></div>" +
        '<img class="gcard-art" loading="lazy" alt="Mark of token ' + r.id + '" src="' + r.image + '">' +
        '<div class="gcard-foot"><span class="gcard-k">Holder</span>' +
        '<span class="gcard-v">' + short(r.owner) + "</span></div>" +
        '<code class="gcard-handle">' + short(r.handle, 10, 6) + "</code>";

      if (mine) {
        card.setAttribute("type", "button");
        card.title = "Open yours";
        card.addEventListener("click", () => go("you"));
      }
      return card;
    }),
  );
}

function renderDuel(row: Row) {
  const others = state.rows.filter((r) => r.id !== row.id);
  duelPanel.hidden = others.length === 0;
  duelMe.textContent = `#${row.id}`;
  duelCount.textContent = `${state.duels} settled`;
  if (duelPick.options.length !== others.length) {
    duelPick.replaceChildren(
      ...others.map((r) => new Option(`#${r.id} · ${short(r.owner)}`, r.id.toString())),
    );
  }
}

function renderPublicTiles() {
  statMinted.textContent = state.loading ? "—" : String(state.rows.length);
  const holders = new Set(state.rows.map((r) => r.owner.toLowerCase()));
  statHolders.textContent = state.loading ? "—" : String(holders.size);
  // Deliberately always zero: nothing on the public page is readable.
  statReadable.textContent = "0";
}

// ── render: for-you page ─────────────────────────────────────────

function showStandin(title: string, text: string, label: string, onClick: () => void) {
  detail.hidden = true;
  seg.hidden = true;
  standin.hidden = false;
  standinTitle.textContent = title;
  standinText.textContent = text;
  standinAction.textContent = label;
  standinAction.onclick = onClick;
}

function renderYou() {
  const row = state.rows.find((r) => r.id === state.mine);

  if (!state.account) {
    youTitle.textContent = "Known by one.";
    youLede.textContent = "One token per address, with its essence sealed to whoever holds it. Connect and this page becomes the only place that number exists in the clear.";
    return showStandin(
      "Nothing sealed to you yet.",
      "Connect a wallet and this page will tell you whether one is.",
      "Connect wallet",
      () => connectBtn.click(),
    );
  }

  if (!row) {
    youTitle.textContent = "Nothing yours yet.";
    youLede.textContent = "Mint one and the coprocessor draws an essence nobody has seen — not us, not you, not an indexer.";
    return showStandin(
      "You have not minted.",
      "One per address. The draw happens inside the coprocessor, so the number does not exist in the clear anywhere until you ask for it.",
      "Mint",
      () => mintBtn.click(),
    );
  }

  standin.hidden = true;
  detail.hidden = false;
  seg.hidden = false;
  mintBtn.hidden = true;

  const known = state.revealed.get(row.id.toString());
  const holderView = state.pov === "holder";

  youTitle.textContent = "Known by one.";
  youLede.textContent = "This handle is public. The number behind it reaches exactly one address — and the ACL on-chain says it is yours.";

  // `state.mine` is the token you MINTED. You may since have transferred it, and
  // because FHEVM grants cannot be revoked your view of it survives regardless —
  // the honest limit of "only the current holder".
  const stillHolds = isMine(row.owner);

  tokenArt.src = row.image;
  tokenArt.alt = `Mark of token ${row.id}`;
  tokenIdEl.textContent = `#${row.id}`;
  handleEl.textContent = row.handle === ZERO_HANDLE ? "—" : row.handle;
  copyBtn.hidden = row.handle === ZERO_HANDLE;
  sHolder.textContent = short(row.owner);
  sAcl.textContent = stillHolds ? "You, and nobody else" : "You and its current holder";

  if (!stillHolds) {
    youTitle.textContent = "Yours to read. Not yours to hold.";
    youLede.textContent =
      "You minted this one and passed it on. The ACL extended to its new holder in the same transaction, but FHEVM has no revoke, so your own view never closed.";
  }

  publishBtn.hidden = !stillHolds || row.published;
  renderDuel(row);

  if (row.published) {
    chip.dataset.tone = "public";
    chipText.textContent = "Published";
    sAcl.textContent = "Everyone, for good";
  }

  if (holderView && known !== undefined) {
    detail.dataset.state = "revealed";
    if (!row.published) {
      chip.dataset.tone = stillHolds ? "open" : "away";
      chipText.textContent = stillHolds ? "Open to you" : "Transferred · still open to you";
    }
    power.set(String(known));
    powerMax.hidden = false;
    lightTiles(Math.max(1, Math.ceil((Number(known) / 100) * 8)));
    revealBtn.disabled = true;
    note("Decrypted in this browser. The chain still holds nothing but the handle.");
    return;
  }

  detail.dataset.state = "sealed";
  chip.dataset.tone = stillHolds ? "sealed" : "away";
  chipText.textContent = stillHolds ? "Sealed" : "Transferred";
  power.scramble();
  powerMax.hidden = true;
  lightTiles(0);
  revealBtn.disabled = false;
  if (!stillHolds) {
    note(`Held by ${short(row.owner)} now. Your grant was never revoked, so you can still look.`);
  } else {
    note(holderView
      ? "Reveal it to switch this view to what only you can see."
      : "This is what everyone sees. Switch to “You” to look inside.");
  }
}

function render() {
  renderGrid();
  renderPublicTiles();
  renderYou();
}


// ── chain ────────────────────────────────────────────────────────

const MAX_ROWS = 24;

async function sync() {
  // Reads go through our own RPC even when a wallet is connected. The signer-backed
  // contract is for writes only: routing reads through the wallet makes the whole
  // page hostage to whatever endpoint it happens to use.
  const c = readNft ?? nft;
  if (!c) return render();

  const total: bigint = await c.totalMinted();
  const first = total > BigInt(MAX_ROWS) ? total - BigInt(MAX_ROWS) + 1n : 1n;

  const ids: bigint[] = [];
  for (let i = total; i >= first; i--) ids.push(i);

  state.rows = await Promise.all(
    ids.map(async (id) => {
      const [owner, handle, uri, published] = await Promise.all([
        c.ownerOf(id) as Promise<string>,
        c.getPower(id) as Promise<string>,
        c.tokenURI(id) as Promise<string>,
        c.published(id) as Promise<boolean>,
      ]);
      return { id, owner, handle, image: imageFromTokenURI(uri), published };
    }),
  );

  state.mine = state.account ? await c.mintedTokenId(state.account) : 0n;
  state.duels = Number(await c.totalDuels());
  state.loading = false;
  render();
}

/** Disables controls, surfaces errors, re-syncs when done. */
const FAUCET = "https://cloud.google.com/application/web3/faucet/ethereum/sepolia";

/**
 * Turns opaque provider failures into something a person can act on. ethers wraps
 * a wallet error it cannot parse as "could not coalesce error", which tells the
 * user nothing — and the usual cause is simply an unfunded wallet.
 */
function humanError(err: unknown): string {
  const e = err as {
    shortMessage?: string; message?: string; code?: string | number;
    info?: { error?: { message?: string } };
  };
  const raw = `${e.info?.error?.message ?? ""} ${e.shortMessage ?? ""} ${e.message ?? ""}`;

  // Keep the real thing reachable; the mapping below is a courtesy, not a diagnosis.
  console.error("[SealedNFT]", err);

  if (e.code === 4001 || e.code === "ACTION_REJECTED") return "Request rejected in wallet.";
  if (/user denied|user rejected/i.test(raw)) return "Request rejected in wallet.";

  // Only claim "no funds" when the chain actually said so. preflightMint() checks
  // the balance with real numbers and reports it precisely; guessing here once
  // told a funded wallet it was empty.
  if (/insufficient funds|gas required exceeds|INSUFFICIENT_FUNDS/i.test(raw))
    return "This wallet cannot cover gas. Fund it from a Sepolia faucet and try again.";

  // Wallets ship rate-limited public RPCs (Rabby defaults to thirdweb, which
  // returns 429 under load). The failure happens before signing, on the nonce
  // lookup, so it looks like a contract problem and is not one.
  if (/429|rate limit|too many requests/i.test(raw))
    return (
      "Your wallet's Sepolia RPC is rate-limited (HTTP 429). Point it at " +
      "https://ethereum-sepolia-rpc.publicnode.com in your wallet's network settings and retry."
    );

  // ethers collapses any wallet RPC error it cannot parse into this. It means the
  // wallet failed to broadcast, which is nearly always its own endpoint.
  if (/could not coalesce|-32603|internal json-rpc|missing revert data|CALL_EXCEPTION/i.test(raw))
    return (
      "Your wallet could not reach Sepolia — its RPC endpoint is failing or rate-limited. " +
      "Set the Sepolia RPC to https://ethereum-sepolia-rpc.publicnode.com in your wallet " +
      "(Rabby: Settings → Custom RPC · MetaMask: Networks → Sepolia → Edit), then retry."
    );

  if (/AlreadyMinted/i.test(raw)) return "This address has already minted. One per address.";
  if (/could not detect network/i.test(raw)) return "Could not reach the network. Try again in a moment.";

  const detail = (e.info?.error?.message ?? e.shortMessage ?? e.message ?? String(err)).slice(0, 160);
  return `Transaction failed: ${detail}`;
}

/**
 * Checks the wallet can actually pay for the mint before asking it to sign.
 * Gas is estimated on our own RPC, so a flaky wallet endpoint cannot break it,
 * and the figure is passed through as an explicit limit.
 */
async function preflightMint(): Promise<bigint> {
  const rpc = readNft?.runner?.provider;
  if (!rpc || !readNft || !state.account) throw new Error("Not connected.");

  const [gas, fee, balance] = await Promise.all([
    readNft.mint.estimateGas({ from: state.account }) as Promise<bigint>,
    rpc.getFeeData(),
    rpc.getBalance(state.account),
  ]);

  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const cost = gas * price;
  if (balance < cost) {
    throw new Error(
      `This wallet holds ${formatEther(balance)} ETH but the mint needs about ` +
        `${formatEther(cost)}. Fund it from a Sepolia faucet and try again.`,
    );
  }
  return (gas * 12n) / 10n; // 20% headroom
}

function action(btn: HTMLButtonElement, fn: () => Promise<void>) {
  btn.addEventListener("click", async () => {
    const all = [connectBtn, mintBtn, revealBtn, publishBtn, duelGo];
    const before = all.map((b) => b.disabled);
    all.forEach((b) => (b.disabled = true));
    btn.dataset.busy = "true";
    try {
      await fn();
    } catch (err: unknown) {
      const msg = humanError(err);
      toast(msg, /rejected/i.test(msg) ? "info" : "error");
      if (/faucet/i.test(msg)) toast(`Faucet: ${FAUCET}`, "info", 12000);
    } finally {
      delete btn.dataset.busy;
      all.forEach((b, i) => (b.disabled = before[i]));
      await sync();
    }
  });
}

function showNet(chainId: number) {
  const ok = chainId === artifact.chainId;
  netPill.hidden = false;
  netName.textContent = ok ? chainLabel(chainId) : `Switch to ${chainLabel(artifact.chainId)}`;
  if (ok) delete netPill.dataset.bad;
  else netPill.dataset.bad = "true";
}

const currentChain = async () =>
  parseInt((await window.ethereum!.request({ method: "eth_chainId" })) as string, 16);

/**
 * Puts the wallet on the contract's chain, asking it to switch (and to add the
 * network first, if it does not know it). Returns false when the user declines.
 * A successful switch fires `chainChanged`, which reloads and resumes.
 */
async function ensureChain(): Promise<boolean> {
  if (!window.ethereum) return false;

  const target = artifact.chainId;
  if ((await currentChain()) === target) return true;

  const hex = "0x" + target.toString(16);
  toast(`Switching your wallet to ${chainLabel(target)}…`);
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex }],
    });
    return true;
  } catch (err) {
    const e = err as { code?: number | string; message?: string };

    // 4902 (and some wallets' -32603) mean "I do not have that network yet".
    const unknown = e.code === 4902 || e.code === -32603 || /unrecognized chain/i.test(e.message ?? "");
    if (unknown && CHAIN_PARAMS[target]) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [CHAIN_PARAMS[target]],
      });
      return true;
    }
    if (e.code === 4001 || e.code === "ACTION_REJECTED") {
      toast(`Stayed on the wrong network. Mint and reveal need ${chainLabel(target)}.`, "error");
      showNet(await currentChain());
      return false;
    }
    throw err;
  }
}

/** Binds the signer-backed contract and flips the header into its connected state. */
/** The EIP-712 signer: the demo key when recording, otherwise the wallet. */
async function currentSigner() {
  if (demoSigner) return demoSigner;
  return provider.getSigner();
}

async function attachWallet() {
  provider = new BrowserProvider(window.ethereum!);
  const signer = await currentSigner();
  state.account = await signer.getAddress();
  nft = new Contract(artifact.address, artifact.abi, signer);

  showNet(await currentChain());

  connectBtn.textContent = short(state.account);
  connectBtn.classList.remove("btn-accent");
  connectBtn.classList.add("btn-ghost", "is-wallet");
  connectBtn.disabled = false;

  menuAddr.textContent = state.account;
  const base = EXPLORERS[artifact.chainId];
  if (base) menuExplorer.href = `${base}/address/${state.account}`;
  else menuExplorer.removeAttribute("href");
}

// ── wallet menu ──────────────────────────────────────────────────

function setMenu(open: boolean) {
  walletMenu.hidden = !open;
  connectBtn.setAttribute("aria-expanded", String(open));
}

const menuOpen = () => !walletMenu.hidden;

document.addEventListener("click", (e) => {
  if (!menuOpen()) return;
  if (!(e.target as Element)?.closest?.("#wallet")) setMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menuOpen()) setMenu(false);
});

menuCopy.addEventListener("click", async () => {
  if (!state.account) return;
  try {
    await navigator.clipboard.writeText(state.account);
    toast("Address copied.", "success");
  } catch {
    toast("Clipboard blocked by the browser.", "error");
  }
  setMenu(false);
});

menuExplorer.addEventListener("click", () => setMenu(false));

menuDisconnect.addEventListener("click", async () => {
  setMenu(false);

  // MetaMask can actually drop the permission; wallets that cannot just ignore it.
  try {
    await window.ethereum?.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    /* not supported — clearing local state below is still a real disconnect */
  }

  state.account = undefined;
  state.mine = 0n;
  state.revealed.clear();
  setPov("public");
  nft = undefined;

  connectBtn.textContent = "Connect wallet";
  connectBtn.classList.remove("btn-ghost", "is-wallet");
  connectBtn.classList.add("btn-accent");
  connectBtn.disabled = false;
  connectBtn.setAttribute("aria-expanded", "false");
  netPill.hidden = true;
  menuAddr.textContent = "—";

  toast("Disconnected.", "info");
  await sync();   // the public view survives: it never needed a wallet
});

/**
 * One button, two jobs: connect while disconnected, open the wallet menu once
 * connected. Deliberately not wrapped in `action()` — toggling a menu should not
 * re-read the chain.
 */
connectBtn.addEventListener("click", async () => {
  if (state.account) return setMenu(!menuOpen());
  if (!window.ethereum) return toast("No injected wallet found. Install MetaMask.", "error");
  if (!artifact.address) return toast("No contract address yet — run the deploy script.", "error");

  connectBtn.disabled = true;
  connectBtn.dataset.busy = "true";
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!demoSigner && !(await ensureChain())) return;
    await attachWallet();
    await sync();
  } catch (err: unknown) {
    toast(humanError(err), "error");
  } finally {
    delete connectBtn.dataset.busy;
    connectBtn.disabled = false;
  }
});

// The pill is the fix when it reads "Switch to …".
netPill.addEventListener("click", async () => {
  if (netPill.dataset.bad !== "true") return;
  try {
    if (await ensureChain()) await attachWallet();
  } catch (err) {
    toast((err as { message?: string }).message ?? String(err), "error");
  }
});

action(mintBtn, async () => {
  state.revealed.clear();
  if (!nft) return toast("Connect a wallet first.", "error");
  if (!demoSigner && !(await ensureChain())) return;

  note("Checking this wallet can pay for the mint…");
  const gasLimit = await preflightMint();

  toast("Minting — the coprocessor is drawing your essence.");
  await (await nft.mint({ gasLimit })).wait();
  toast("Minted and sealed. Nobody can read it yet, including you.", "success");
});

action(revealBtn, async () => {
  const row = state.rows.find((r) => r.id === state.mine);
  if (!row || (!provider && !demoSigner)) return;
  if (!demoSigner && !(await ensureChain())) return;

  // Lazy: the SDK pulls a large WASM bundle, and failing to load it should cost
  // you the reveal, not the whole page.
  note("Loading the FHE runtime…");
  const { getFhevmInstance } = await import("./fhevm");
  const rpc = PUBLIC_RPC[artifact.chainId];
  if (!rpc) throw new Error(`No RPC configured for chain ${artifact.chainId}.`);

  let instance;
  try {
    instance = await getFhevmInstance(rpc);
  } catch (err) {
    // ethers reports a failed eth_call against the FHEVM host contracts as a bare
    // "missing revert data", which tells the user nothing actionable.
    const m = (err as { message?: string }).message ?? "";
    if (/missing revert data|CALL_EXCEPTION|could not coalesce/i.test(m)) {
      throw new Error("Could not reach the FHE network to set up decryption. Try again in a moment.");
    }
    throw err;
  }
  const signer = await currentSigner();

  // An ephemeral keypair the relayer re-encrypts to. The EIP-712 signature
  // authorizes that, scoped to this contract and a one-day window; the on-chain
  // ACL is what makes it permitted at all.
  const keypair = instance.generateKeypair();
  const startTimeStamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;
  const contracts = [artifact.address];
  const eip712 = instance.createEIP712(keypair.publicKey, contracts, startTimeStamp, durationDays);

  note("Sign the decryption request in your wallet…");
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message,
  );

  note("Asking the relayer to re-encrypt it to this browser…");
  const handle = row.handle as `0x${string}`;

  const ask = () =>
    instance.userDecrypt(
      [{ handle, contractAddress: artifact.address }],
      keypair.privateKey,
      keypair.publicKey,
      signature.replace("0x", ""),
      contracts,
      state.account!,
      startTimeStamp,
      durationDays,
    );

  let result;
  try {
    result = await ask();
  } catch (err) {
    const m = (err as { message?: string }).message ?? "";
    // An ACL refusal is a real answer; a timeout is not. Only retry the latter.
    if (/not authorized|is not allowed/i.test(m)) throw err;
    note("The relayer is slow — retrying once…");
    result = await ask();
  }

  const value = BigInt(result[handle] as string | number | bigint);
  state.revealed.set(row.id.toString(), value);
  setPov("holder");
  if (state.route !== "you") go("you");

  detail.dataset.state = "revealed";
  powerMax.hidden = false;
  lightTiles(Math.max(1, Math.ceil((Number(value) / 100) * 8)));
  await power.settle(String(value));
  renderYou(); // chip, note and tiles agree with the value the instant it lands
  toast(`Power ${value} of 100.`, "success");
});

action(publishBtn, async () => {
  const row = state.rows.find((r) => r.id === state.mine);
  if (!row || !nft) return;
  if (!demoSigner && !(await ensureChain())) return;

  // Irreversible at the protocol level — worth one deliberate confirmation.
  const ok = confirm(
    `Publish token #${row.id}?\n\nThis makes its essence readable by everyone, forever. ` +
      `FHEVM cannot undo it — not for you, not for us.`,
  );
  if (!ok) return;

  toast("Publishing — this cannot be undone.");
  await (await nft.publish(row.id)).wait();
  toast(`Token #${row.id} is public now.`, "success");
});

action(duelGo, async () => {
  const row = state.rows.find((r) => r.id === state.mine);
  const opponent = BigInt(duelPick.value || "0");
  if (!row || !nft || opponent === 0n) return;
  if (!demoSigner && !(await ensureChain())) return;

  duelOut.removeAttribute("data-win");
  duelOut.textContent = "Comparing two ciphertexts on-chain…";
  const receipt = await (await nft.duel(row.id, opponent)).wait();

  // The contract made exactly one bit public: who won.
  const duelId: bigint = await nft.totalDuels();
  const [, , aWins] = await nft.duelResult(duelId);

  duelOut.textContent = "Reading the one bit that went public…";
  const { getFhevmInstance } = await import("./fhevm");
  const instance = await getFhevmInstance(PUBLIC_RPC[artifact.chainId]);
  // publicDecrypt returns { clearValues, ... } — not the value directly.
  const res = await instance.publicDecrypt([aWins as `0x${string}`]);
  const won = Boolean(res.clearValues[aWins as `0x${string}`]);

  duelOut.dataset.win = String(won);
  duelOut.textContent = won
    ? `#${row.id} beat #${opponent}. Neither power was revealed — only that one bit.`
    : `#${opponent} beat #${row.id}. Neither power was revealed — only that one bit.`;
  toast(won ? `#${row.id} wins.` : `#${opponent} wins.`, won ? "success" : "info");
  void receipt;
});

copyBtn.addEventListener("click", async () => {
  const row = state.rows.find((r) => r.id === state.mine);
  if (!row) return;
  try {
    await navigator.clipboard.writeText(row.handle);
    toast("Handle copied. Try decrypting it from another address.", "success");
  } catch {
    toast("Clipboard blocked by the browser.", "error");
  }
});

// ── point of view + tabs ─────────────────────────────────────────

function setPov(pov: "public" | "holder") {
  state.pov = pov;
  for (const b of document.querySelectorAll<HTMLElement>(".seg-btn")) {
    b.classList.toggle("is-active", b.dataset.pov === pov);
  }
}

for (const b of document.querySelectorAll<HTMLElement>(".seg-btn")) {
  b.addEventListener("click", () => {
    const pov = b.dataset.pov === "holder" ? "holder" : "public";
    setPov(pov);
    renderYou();

    // Asking to see it as the holder is the same as asking to decrypt it.
    const row = state.rows.find((r) => r.id === state.mine);
    if (pov === "holder" && row && !state.revealed.has(row.id.toString())) revealBtn.click();
  });
}

// ── boot ─────────────────────────────────────────────────────────

if (artifact.address) {
  const base = EXPLORERS[artifact.chainId];
  statContract.textContent = short(artifact.address, 6, 4);
  if (base) statContract.href = `${base}/address/${artifact.address}`;
  statChain.textContent = artifact.chainId === 11155111 ? "Sepolia testnet" : `chain ${artifact.chainId}`;
  footContract.textContent = artifact.address;
} else {
  statContract.removeAttribute("href");
  statChain.textContent = "run the deploy script";
  footContract.textContent = "not deployed";
}

startRouter((route) => {
  state.route = route;
  if (route === "how") {
    revealOnScroll();
    animateEncBoxes();
  }
  // Churning hex only needs to run on the page you are looking at.
  if (route !== "you") power.stop();
  else renderYou();
  scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
});

// A handle on state during `npm run dev` makes UI failures inspectable.
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__state = state;

startStars(el<HTMLCanvasElement>("sky"));

render();

if (artifact.address && PUBLIC_RPC[artifact.chainId]) {
  readNft = new Contract(
    artifact.address,
    artifact.abi,
    new JsonRpcProvider(PUBLIC_RPC[artifact.chainId]),
  );
  sync().catch(() => {
    state.loading = false;
    render();
    toast("Could not reach the network to read the collection.", "error");
  });
}

/** Re-attaches silently after a chain switch reload — eth_accounts never prompts. */
async function resume() {
  if (!window.ethereum || !artifact.address) return;
  const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
  if (!accounts?.length) return;

  const chain = await currentChain();
  showNet(chain);
  if (chain !== artifact.chainId) return;

  await attachWallet();
  await sync();
}

async function startDemoMode(rpc: string) {
  demoSigner = new Wallet(DEMO_KEY!, new JsonRpcProvider(rpc));
  state.account = demoSigner.address;
  nft = new Contract(artifact.address, artifact.abi, demoSigner);

  netPill.hidden = false;
  netName.textContent = "Sepolia";
  connectBtn.textContent = short(state.account);
  connectBtn.classList.remove("btn-accent");
  connectBtn.classList.add("btn-ghost", "is-wallet");
  menuAddr.textContent = state.account;
  document.body.dataset.demo = "true"; // shows the badge
  await sync();
}

if (DEMO_KEY && PUBLIC_RPC[artifact.chainId]) {
  startDemoMode(PUBLIC_RPC[artifact.chainId]).catch((e) =>
    toast(`Demo mode failed: ${(e as Error).message}`, "error"),
  );
} else {
  resume().catch(() => {});
}

window.ethereum?.on?.("accountsChanged", () => window.location.reload());
window.ethereum?.on?.("chainChanged", () => window.location.reload());
