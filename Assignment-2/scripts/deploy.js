const hre = require("hardhat");

async function main() {
  const QuickStarter = await hre.ethers.getContractFactory("QuickStarter");
  const quickStarter = await QuickStarter.deploy();

  await quickStarter.waitForDeployment();

  const address = await quickStarter.getAddress();
  console.log("QuickStarter deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
