import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();

  console.log("Deploying QuickStarter contract...");

  const quickStarter = await ethers.deployContract("QuickStarter");
  const address = await quickStarter.getAddress();

  console.log(`QuickStarter deployed to: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
