import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("AdRevenueSplitter Production Readiness & Multi-Token Escrow System", function () {
  let mockUSDC;
  let mockEURC;
  let splitter;
  let owner;
  let advertiser;
  let oracleNode;
  let platformWallet;
  let creator1;
  let creator2;
  const proofA = [0, 0];
  const proofB = [[0, 0], [0, 0]];
  const proofC = [0, 0];

  beforeEach(async function () {
    [owner, advertiser, oracleNode, platformWallet, creator1, creator2] = await ethers.getSigners();

    // Deploy Mock ERC20 USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy(ethers.parseUnits("1000", 6));
    await mockUSDC.waitForDeployment();

    // Deploy Mock ERC20 EURC
    mockEURC = await MockERC20.deploy(ethers.parseUnits("1000", 6));
    await mockEURC.waitForDeployment();

    // Deploy MockYieldVault
    const MockYieldVault = await ethers.getContractFactory("MockYieldVault");
    const mockVault = await MockYieldVault.deploy(await mockUSDC.getAddress());
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

    // Register EURC token in allowedTokens
    await splitter.connect(owner).setAllowedToken(await mockEURC.getAddress(), true);

    // Fund advertiser and approve splitter for both tokens
    await mockUSDC.transfer(advertiser.address, ethers.parseUnits("200", 6));
    await mockEURC.transfer(advertiser.address, ethers.parseUnits("200", 6));

    await mockUSDC.connect(advertiser).approve(await splitter.getAddress(), ethers.parseUnits("200", 6));
    await mockEURC.connect(advertiser).approve(await splitter.getAddress(), ethers.parseUnits("200", 6));
  });

  describe("Pausable Operations & Emergency Controls", function () {
    let campaignId;
    const clickFingerprint = ethers.id("pause_test_click");
    const budget = ethers.parseUnits("10", 6);
    const cpc = ethers.parseUnits("1", 6);

    beforeEach(async function () {
      // Create campaign under normal conditions
      const tx = await splitter.connect(advertiser).createCampaign(
        await mockUSDC.getAddress(),
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
      campaignId = event.args.campaignId;
    });

    it("should allow owner to pause and unpause the contract", async function () {
      expect(await splitter.paused()).to.be.false;

      await splitter.connect(owner).pause();
      expect(await splitter.paused()).to.be.true;

      await splitter.connect(owner).unpause();
      expect(await splitter.paused()).to.be.false;
    });

    it("should prevent non-owner from pausing or unpausing", async function () {
      await expect(
        splitter.connect(advertiser).pause()
      ).to.be.revertedWithCustomError(splitter, "OnlyOwner");

      await splitter.connect(owner).pause();

      await expect(
        splitter.connect(advertiser).unpause()
      ).to.be.revertedWithCustomError(splitter, "OnlyOwner");
    });

    it("should block createCampaign, recordEngagement, and executeBatchEngagement while paused", async function () {
      await splitter.connect(owner).pause();

      // Block createCampaign
      await expect(
        splitter.connect(advertiser).createCampaign(
          await mockUSDC.getAddress(),
          budget,
          cpc,
          [creator1.address],
          [10000],
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(splitter, "EnforcedPause");

      // Block recordEngagement
      const messageHash = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [campaignId, clickFingerprint]);
      const sig = await oracleNode.signMessage(ethers.getBytes(messageHash));
      await expect(
        splitter.connect(owner).recordEngagement(campaignId, clickFingerprint, [sig], proofA, proofB, proofC)
      ).to.be.revertedWithCustomError(splitter, "EnforcedPause");

      // Block executeBatchEngagement
      await expect(
        splitter.connect(oracleNode).executeBatchEngagement(
          [campaignId],
          [creator1.address],
          [ethers.parseUnits("1.5", 6)]
        )
      ).to.be.revertedWithCustomError(splitter, "EnforcedPause");
    });

    it("should allow withdrawRemainingBudget to be executed even while paused", async function () {
      await splitter.connect(owner).pause();

      const beforeBalance = await mockUSDC.balanceOf(advertiser.address);
      
      // Advertiser pulls out their remaining budget during pause
      await splitter.connect(advertiser).withdrawRemainingBudget(campaignId);

      const afterBalance = await mockUSDC.balanceOf(advertiser.address);
      expect(afterBalance).to.be.greaterThan(beforeBalance);

      const campaign = await splitter.campaigns(campaignId);
      expect(campaign.active).to.be.false;
      expect(campaign.remainingBudget).to.equal(0n);
    });

    it("should allow owner to rescue/sweep tokens using emergencySweepToken", async function () {
      // Send some random tokens to the contract by mistake
      await mockEURC.transfer(await splitter.getAddress(), ethers.parseUnits("50", 6));
      expect(await mockEURC.balanceOf(await splitter.getAddress())).to.equal(ethers.parseUnits("50", 6));

      const beforeOwnerBalance = await mockEURC.balanceOf(owner.address);

      // Sweep tokens to owner
      await splitter.connect(owner).emergencySweepToken(await mockEURC.getAddress(), ethers.parseUnits("50", 6));

      expect(await mockEURC.balanceOf(await splitter.getAddress())).to.equal(0n);
      const afterOwnerBalance = await mockEURC.balanceOf(owner.address);
      expect(afterOwnerBalance - beforeOwnerBalance).to.equal(ethers.parseUnits("50", 6));
    });
  });

  describe("Multi-Token Escrow & EURC Support", function () {
    it("should successfully process campaigns and payouts in EURC", async function () {
      const budget = ethers.parseUnits("50", 6);
      const cpc = ethers.parseUnits("2", 6);

      // Create EURC Campaign
      const tx = await splitter.connect(advertiser).createCampaign(
        await mockEURC.getAddress(),
        budget,
        cpc,
        [creator1.address, creator2.address],
        [6000, 4000], // 60% and 40%
        ethers.ZeroAddress
      );
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log) => {
          try { return splitter.interface.parseLog(log); } catch { return null; }
        })
        .find((parsed) => parsed && parsed.name === "CampaignCreated");
      const campaignId = event.args.campaignId;

      // Verify campaign info
      const campaign = await splitter.campaigns(campaignId);
      expect(campaign.tokenAddress).to.equal(await mockEURC.getAddress());
      expect(campaign.totalBudget).to.equal(budget);

      // Payout click engagement
      const clickFingerprint = ethers.id("eurc_click_1");
      const hash = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [campaignId, clickFingerprint]);
      const sig = await oracleNode.signMessage(ethers.getBytes(hash));

      const initialCreator1 = await mockEURC.balanceOf(creator1.address);
      const initialCreator2 = await mockEURC.balanceOf(creator2.address);
      const initialPlatform = await mockEURC.balanceOf(platformWallet.address);

      // Process click
      await splitter.connect(owner).recordEngagement(campaignId, clickFingerprint, [sig], proofA, proofB, proofC);

      const finalCreator1 = await mockEURC.balanceOf(creator1.address);
      const finalCreator2 = await mockEURC.balanceOf(creator2.address);
      const finalPlatform = await mockEURC.balanceOf(platformWallet.address);

      // CPC is 2 EURC. Platform fee is 3% = 0.06 EURC. Distributable = 1.94 EURC
      // Creator 1 gets 60% of 1.94 EURC = 1.164 EURC = 1164000
      // Creator 2 gets 40% of 1.94 EURC = 0.776 EURC = 776000
      expect(finalCreator1 - initialCreator1).to.equal(1164000n);
      expect(finalCreator2 - initialCreator2).to.equal(776000n);
      expect(finalPlatform - initialPlatform).to.equal(60000n);
    });

    it("should revert if advertiser tries to create campaign with a non-allowed token", async function () {
      // Deploy another Mock ERC20 that is not allowed
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const unallowedToken = await MockERC20.deploy(ethers.parseUnits("1000", 6));
      await unallowedToken.waitForDeployment();

      await unallowedToken.transfer(advertiser.address, ethers.parseUnits("50", 6));
      await unallowedToken.connect(advertiser).approve(await splitter.getAddress(), ethers.parseUnits("50", 6));

      await expect(
        splitter.connect(advertiser).createCampaign(
          await unallowedToken.getAddress(),
          ethers.parseUnits("50", 6),
          ethers.parseUnits("1", 6),
          [creator1.address],
          [10000],
          ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(splitter, "TokenNotAllowed");
    });
  });
});
