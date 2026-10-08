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
    apiKey: { sepolia: ETHERSCAN_API_KEY ?? "" },
  },
  // Sourcify needs no API key, so the source is publicly checkable either way.
  sourcify: { enabled: true },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  mocha: { timeout: 180_000 },
};

export default config;
