import { ethers, network } from "hardhat";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Deploys SealedNFT and writes { address, chainId, abi } where the frontend
 * imports it from. Credentials come from .env via hardhat.config.ts — nothing
 * is hardcoded here.
 *
 *   npx hardhat run scripts/deploy.ts --network sepolia
 */
async function main() {
  const { chainId } = await ethers.provider.getNetwork();

  if (network.name === "sepolia") {
    if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL is not set in .env");
    if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY is not set in .env");
  }

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Network:  ${network.name} (chainId ${chainId})`);
  console.log(`Deployer: ${deployer.address} (${ethers.formatEther(balance)} ETH)`);

  if (balance === 0n) throw new Error("Deployer has no ETH — fund it before deploying.");

  const factory = await ethers.getContractFactory("SealedNFT");
  const nft = await factory.deploy();
  console.log(`Deploying... tx ${nft.deploymentTransaction()?.hash}`);
  await nft.waitForDeployment();

  const address = await nft.getAddress();
  console.log(`SealedNFT deployed at ${address}`);

  // Hand off to the frontend.
  const outDir = join(__dirname, "..", "frontend", "src", "contracts");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "SealedNFT.json"),
    JSON.stringify(
      { address, chainId: Number(chainId), abi: JSON.parse(factory.interface.formatJson()) },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote frontend/src/contracts/SealedNFT.json`);
  console.log(`\nVerify with:\n  npx hardhat verify --network ${network.name} ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
