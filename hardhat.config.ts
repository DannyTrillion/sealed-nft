import { HardhatUserConfig } from "hardhat/config";
import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";

dotenv.config();

const { PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY } = process.env;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      // `cancun` is required: FHE.allowTransient relies on EIP-1153 transient storage.
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 800 },
    },
  },
  networks: {
    // In-process mock coprocessor; this is where the tests run.
    hardhat: {},
    sepolia: {
      url: SEPOLIA_RPC_URL ?? "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  etherscan: {
    // A single string (not a per-network map) is what selects the Etherscan V2
    // API; the per-network form silently falls back to the retired V1 endpoint.
    apiKey: ETHERSCAN_API_KEY ?? "",
  },
  // hardhat-verify 2.0.14 still calls Sourcify's removed v1 API, so leave it off
  // here — Sourcify verification is done against their v2 endpoint directly.
  sourcify: { enabled: false },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  mocha: { timeout: 180_000 },
};

export default config;
