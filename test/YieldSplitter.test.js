import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("AdRevenueSplitter Yield-Generation & Vault Integration Tests", function () {
  let mockUSDC;
  let mockVault;
  let splitter;
  let owner;
  let advertiser;
  let oracleNode;
  let platformWallet;
  let creator1;

  beforeEach(async function () {
    [owner, advertiser, oracleNode, platformWallet, creator1] = await ethers.getSigners();

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

  it("should deposit advertising budgets to ERC-4626 vault and allocate shares", async function () {
    const budget = ethers.parseUnits("100", 6);
    const cpc = ethers.parseUnits("1", 6);

    const tx = await splitter.connect(advertiser).createCampaign(
      budget,
      cpc,
      [creator1.address],
      [10000]
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try { return splitter.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed && parsed.name === "CampaignCreated");

    const campaignId = event.args.campaignId;
    const campaign = await splitter.campaigns(campaignId);

    // Initial yield should be 0
    expect(await splitter.getCampaignYield(campaignId)).to.equal(0n);
    expect(campaign.vaultShares).to.be.greaterThan(0n);
    expect(campaign.totalBudget).to.equal(budget);
    expect(campaign.remainingBudget).to.equal(budget);
  });

  it("should calculate campaign yield correctly after time elapsed (10% APY simulation)", async function () {
    const budget = ethers.parseUnits("100", 6);
    const cpc = ethers.parseUnits("1", 6);

    const tx = await splitter.connect(advertiser).createCampaign(
      budget,
      cpc,
      [creator1.address],
      [10000]
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try { return splitter.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed && parsed.name === "CampaignCreated");

    const campaignId = event.args.campaignId;

    // Fast forward time by 1 year (365 days)
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    // Accrued yield should be around 10% of 100 USDC = 10 USDC (10 * 10^6)
    const yieldAmount = await splitter.getCampaignYield(campaignId);
    expect(yieldAmount).to.be.closeTo(ethers.parseUnits("10", 6), ethers.parseUnits("0.1", 6));
  });

  it("should withdraw principal plus accrued yield back to the advertiser", async function () {
    const budget = ethers.parseUnits("100", 6);
    const cpc = ethers.parseUnits("1", 6);

    const tx = await splitter.connect(advertiser).createCampaign(
      budget,
      cpc,
      [creator1.address],
      [10000]
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try { return splitter.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed && parsed.name === "CampaignCreated");

    const campaignId = event.args.campaignId;

    // Fast forward time by 1 year
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const beforeBalance = await mockUSDC.balanceOf(advertiser.address);

    // Close/Withdraw campaign
    await splitter.connect(advertiser).withdrawRemainingBudget(campaignId);

    const afterBalance = await mockUSDC.balanceOf(advertiser.address);
    const refundReceived = afterBalance - beforeBalance;

    // Refund received should include principal (100 USDC) + yield (approx 10 USDC)
    expect(refundReceived).to.be.closeTo(ethers.parseUnits("110", 6), ethers.parseUnits("0.1", 6));

    const campaign = await splitter.campaigns(campaignId);
    expect(campaign.active).to.be.false;
    expect(campaign.remainingBudget).to.equal(0n);
    expect(campaign.vaultShares).to.equal(0n);
  });

  it("should execute engagement payout successfully by redeeming shares from the vault", async function () {
    const budget = ethers.parseUnits("10", 6);
    const cpc = ethers.parseUnits("1", 6);

    const tx = await splitter.connect(advertiser).createCampaign(
      budget,
      cpc,
      [creator1.address],
      [10000]
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try { return splitter.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed && parsed.name === "CampaignCreated");

    const campaignId = event.args.campaignId;

    const clickFingerprint = ethers.id("yield_test_click");
    const hash = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [campaignId, clickFingerprint]);
    const sig = await oracleNode.signMessage(ethers.getBytes(hash));

    const beforeCreatorBalance = await mockUSDC.balanceOf(creator1.address);

    await splitter.connect(owner).recordEngagement(campaignId, clickFingerprint, [sig]);

    const afterCreatorBalance = await mockUSDC.balanceOf(creator1.address);
    // Platform fee is 3% of 1 USDC = 0.03 USDC.
    // Creator receives 97% of 1 USDC = 0.97 USDC.
    expect(afterCreatorBalance - beforeCreatorBalance).to.equal(ethers.parseUnits("0.97", 6));

    const campaign = await splitter.campaigns(campaignId);
    expect(campaign.remainingBudget).to.equal(ethers.parseUnits("9", 6));
  });

  it("should fall back to local USDC balance if vault redemption/withdrawal fails", async function () {
    const budget = ethers.parseUnits("10", 6);
    const cpc = ethers.parseUnits("1", 6);

    const tx = await splitter.connect(advertiser).createCampaign(
      budget,
      cpc,
      [creator1.address],
      [10000]
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log) => {
        try { return splitter.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed) => parsed && parsed.name === "CampaignCreated");

    const campaignId = event.args.campaignId;

    // Set vault to an invalid address (e.g. advertiser address or some address that doesn't implement ERC-4626)
    // This will force the vault calls to revert
    await splitter.connect(owner).setYieldVault(advertiser.address);

    // Fund the splitter contract directly with some USDC so it can execute fallback payment
    await mockUSDC.transfer(await splitter.getAddress(), ethers.parseUnits("5", 6));

    const clickFingerprint = ethers.id("fallback_test_click");
    const hash = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [campaignId, clickFingerprint]);
    const sig = await oracleNode.signMessage(ethers.getBytes(hash));

    const beforeCreatorBalance = await mockUSDC.balanceOf(creator1.address);

    // Should succeed because of the fallback mechanism using contract's local USDC
    await splitter.connect(owner).recordEngagement(campaignId, clickFingerprint, [sig]);

    const afterCreatorBalance = await mockUSDC.balanceOf(creator1.address);
    expect(afterCreatorBalance - beforeCreatorBalance).to.equal(ethers.parseUnits("0.97", 6));

    const campaign = await splitter.campaigns(campaignId);
    expect(campaign.remainingBudget).to.equal(ethers.parseUnits("9", 6));
  });
});
