import hre from "hardhat";

async function main() {
  console.log("Preparing deployment of AdRevenueSplitter onto Arc Testnet...");

  // Normalize addresses to correct EIP-55 checksums (pass lowercase to compute fresh checksum)
  const usdcTokenAddress = hre.ethers.getAddress("0x3600000000000000000000000000000000000000");
  const oracleNodeAddress = hre.ethers.getAddress("0xca2d2f677cd6303cec089b5f319d72a089b5f319");
  const platformWalletAddress = hre.ethers.getAddress("0xd91455cce706509f67cd6303cec089b5f319d72a");

  console.log("USDC Token:", usdcTokenAddress);
  console.log("Oracle Node:", oracleNodeAddress);
  console.log("Platform Wallet:", platformWalletAddress);

  // Deploy AdRevenueSplitter
  const AdRevenueSplitter = await hre.ethers.getContractFactory("AdRevenueSplitter");
  const contract = await AdRevenueSplitter.deploy(
    usdcTokenAddress,
    oracleNodeAddress,
    platformWalletAddress
  );

  await contract.waitForDeployment();

  const deployedAddress = await contract.getAddress();
  console.log("\n=======================================================");
  console.log("SUCCESS: AdRevenueSplitter contract successfully deployed!");
  console.log("Contract Address:", deployedAddress);
  console.log("=======================================================\n");
  console.log("Next Steps:");
  console.log("1. Copy this contract address.");
  console.log("2. Paste it into the 'AdRevenueSplitter.sol Explorer' field at the bottom of the page.");
  console.log("3. Click 'Reload Ledger' to synchronize campaign locks!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
