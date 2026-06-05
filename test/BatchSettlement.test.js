import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("AdRevenueSplitter Batch Micropayment Settlements (x402)", function () {
  let mockUSDC;
  let mockVault;
  let splitter;
  let owner;
  let advertiser;
  let oracleNode;
  let platformWallet;
  let creator1;
  let creator2;

  beforeEach(async function () {
    [owner, advertiser, oracleNode, platformWallet, creator1, creator2] = await ethers.getSigners();

    // Deploy Mock ERC20 USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy(ethers.parseUnits("10000", 6));
    await mockUSDC.waitForDeployment();

    // Deploy MockYieldVault
    const MockYieldVault = await ethers.getContractFactory("MockYieldVault");
    mockVault = await MockYieldVault.deploy(await mockUSDC.getAddress());
    await mockVault.waitForDeployment();

    // Deploy AdRevenueSplitter
    const AdRevenueSplitter = await ethers.getContractFactory("AdRevenueSplitter");
    splitter = await AdRevenueSplitter.deploy(
      await mockUSDC.getAddress(),
      oracleNode.address,
      platformWallet.address,
      await mockVault.getAddress()
    );
    await splitter.waitForDeployment();

    // Fund advertiser and approve splitter
    await mockUSDC.transfer(advertiser.address, ethers.parseUnits("1000", 6));
    await mockUSDC.connect(advertiser).approve(await splitter.getAddress(), ethers.parseUnits("1000", 6));
  });

  it("should successfully execute a batch of engagements via executeBatchEngagement", async function () {
    const budget = ethers.parseUnits("100", 6);
    const cpc = ethers.parseUnits("0.02", 6); // 2 cents CPC

    // Create campaign: split equally between creator1 and creator2
    const tx = await splitter.connect(advertiser).createCampaign(
      budget,
      cpc,
      [creator1.address, creator2.address],
      [5000, 5000],
      ethers.ZeroAddress
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try { return splitter.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed && parsed.name === "CampaignCreated");

    const campaignId = event.args.campaignId;

    // Simulate 1,000 micro-clicks at $0.002 each = $2.00 total
    const clickCount = 1000;
    const clickPayout = ethers.parseUnits("0.002", 6); // $0.002 per click
    const totalAccumulated = clickPayout * BigInt(clickCount); // $2.00

    // Payout split equally: $1.00 to creator1, $1.00 to creator2
    const creator1Share = totalAccumulated / 2n; // $1.00
    const creator2Share = totalAccumulated / 2n; // $1.00

    const initialPlatform = await mockUSDC.balanceOf(platformWallet.address);
    const initialCreator1 = await mockUSDC.balanceOf(creator1.address);
    const initialCreator2 = await mockUSDC.balanceOf(creator2.address);

    // Run executeBatchEngagement from oracle node/settler
    const batchTx = await splitter.connect(oracleNode).executeBatchEngagement(
      [campaignId, campaignId],
      [creator1.address, creator2.address],
      [creator1Share, creator2Share]
    );
    await batchTx.wait();

    // Verification
    const finalPlatform = await mockUSDC.balanceOf(platformWallet.address);
    const finalCreator1 = await mockUSDC.balanceOf(creator1.address);
    const finalCreator2 = await mockUSDC.balanceOf(creator2.address);

    const platformFeeBps = await splitter.platformFeeBps(); // 300 bps = 3%
    const totalFee = (totalAccumulated * platformFeeBps) / 10000n; // 3% of $2.00 = $0.06
    const distributedAmount = totalAccumulated - totalFee; // $1.94

    const expectedCreator1Payout = (creator1Share * (10000n - platformFeeBps)) / 10000n; // $0.97
    const expectedCreator2Payout = (creator2Share * (10000n - platformFeeBps)) / 10000n; // $0.97

    expect(finalPlatform - initialPlatform).to.equal(totalFee);
    expect(finalCreator1 - initialCreator1).to.equal(expectedCreator1Payout);
    expect(finalCreator2 - initialCreator2).to.equal(expectedCreator2Payout);

    const campaign = await splitter.campaigns(campaignId);
    expect(campaign.remainingBudget).to.equal(budget - totalAccumulated);
    expect(campaign.totalClicks).to.equal(2n); // 2 batch payout entries
  });

  it("should fail batch sweep if non-oracle or non-owner addresses call it", async function () {
    const budget = ethers.parseUnits("100", 6);
    const cpc = ethers.parseUnits("0.02", 6);

    const tx = await splitter.connect(advertiser).createCampaign(
      budget,
      cpc,
      [creator1.address],
      [10000],
      ethers.ZeroAddress
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try { return splitter.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed && parsed.name === "CampaignCreated");

    const campaignId = event.args.campaignId;

    // Call from arbitrary advertiser address should revert
    await expect(
      splitter.connect(advertiser).executeBatchEngagement(
        [campaignId],
        [creator1.address],
        [ethers.parseUnits("1.5", 6)]
      )
    ).to.be.revertedWith("Only authorized settler can call");
  });
});
