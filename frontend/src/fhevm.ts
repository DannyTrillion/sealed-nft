// `@zama-fhe/relayer-sdk/bundle` is NOT a self-contained module — it is a
// 176-byte shim whose whole body is `export const initSDK = window.relayerSDK.initSDK`.
// It only works if the UMD build was already loaded through a <script> tag, and
// without that it throws "Cannot read properties of undefined (reading 'initSDK')".
// `/web` is the real ESM browser build; its WASM is referenced with
// `new URL('tfhe_bg.wasm', import.meta.url)`, which Vite resolves on its own.
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";

type Instance = Awaited<ReturnType<typeof createInstance>>;

let instance: Instance | null = null;
let initPromise: Promise<unknown> | null = null;

/**
 * Builds the FHE instance against an explicit RPC rather than the injected wallet.
 *
 * `createInstance` reads the FHEVM host contracts (ACL, KMS verifier, public key)
 * over whatever provider it is handed. Handing it `window.ethereum` makes those
 * reads go through the wallet's own endpoint, and a flaky or rate-limited one
 * fails as an opaque ethers `missing revert data`. We only ever use the SDK to
 * build a keypair, build the EIP-712 payload and call the relayer — the signature
 * comes from our own signer — so it needs chain reads, not a wallet.
 */
export async function getFhevmInstance(rpcUrl: string): Promise<Instance> {
  if (instance) return instance;

  initPromise ??= initSDK();
  await initPromise;
  instance ??= await createInstance({ ...SepoliaConfig, network: rpcUrl });
  return instance;
}
