import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("AdRevenueSplitter Cryptographic Signature Tests", function () {
  let mockUSDC;
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
    // Get signers
    [owner, advertiser, oracleNode, platformWallet, creator1, creator2] = await ethers.getSigners();

    // Deploy Mock ERC20 USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy(ethers.parseUnits("1000", 6)); // Mint 1000 mock USDC to owner
    await mockUSDC.waitForDeployment();

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

    // Fund advertiser and approve splitter
    await mockUSDC.transfer(advertiser.address, ethers.parseUnits("100", 6));
    await mockUSDC.connect(advertiser).approve(await splitter.getAddress(), ethers.parseUnits("100", 6));
  });

  describe("Deployment Setup", function () {
    it("should set the correct oracle address and usdc address", async function () {
      expect(await splitter.usdcToken()).to.equal(await mockUSDC.getAddress());
      expect(await splitter.oracleNode()).to.equal(oracleNode.address);
      expect(await splitter.platformWallet()).to.equal(platformWallet.address);
    });
  });

  describe("Campaign Escrow & Settlement with Signatures", function () {
    let campaignId;
    const clickFingerprint = ethers.id("click_id_9999");
    const budget = ethers.parseUnits("10", 6);
    const cpc = ethers.parseUnits("1", 6); // 1 USDC CPC

    beforeEach(async function () {
      // Create campaign: 80% creator1, 20% creator2
      const tx = await splitter.connect(advertiser).createCampaign(
        budget,
        cpc,
        [creator1.address, creator2.address],
        [8000, 2000], // 80% and 20% shares
        ethers.ZeroAddress
      );
      const receipt = await tx.wait();

      // Find CampaignCreated event to retrieve campaignId
      const event = receipt.logs
        .map((log) => {
          try {
            return splitter.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed && parsed.name === "CampaignCreated");

      campaignId = event.args.campaignId;
    });

    it("should execute engagement payout successfully with a valid oracle signature", async function () {
      // Create EIP-191 compliant message signature using oracleNode account
      // Hash campaignId + clickFingerprint
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [campaignId, clickFingerprint]
      );

      // Sign message (appends prefix \x19Ethereum Signed Message:\n32 automatically in ethers signMessage)
      const signature = await oracleNode.signMessage(ethers.getBytes(messageHash));

      // Check initial balances
      const initialPlatform = await mockUSDC.balanceOf(platformWallet.address);
      const initialCreator1 = await mockUSDC.balanceOf(creator1.address);
      const initialCreator2 = await mockUSDC.balanceOf(creator2.address);

      // Trigger recordEngagement from any caller (e.g. owner) providing signature
      await splitter.connect(owner).recordEngagement(campaignId, clickFingerprint, [signature], proofA, proofB, proofC);

      // Total click cost: 1 USDC.
      // Platform fee: 3% of 1 USDC = 0.03 USDC.
      // Distribute amount: 0.97 USDC.
      // creator1 share (80%): 0.776 USDC.
      // creator2 share (20%): 0.194 USDC.
      expect(await mockUSDC.balanceOf(platformWallet.address)).to.equal(initialPlatform + ethers.parseUnits("0.03", 6));
      expect(await mockUSDC.balanceOf(creator1.address)).to.equal(initialCreator1 + ethers.parseUnits("0.776", 6));
      expect(await mockUSDC.balanceOf(creator2.address)).to.equal(initialCreator2 + ethers.parseUnits("0.194", 6));

      // Assert campaign details are updated
      const campaign = await splitter.campaigns(campaignId);
      expect(campaign.remainingBudget).to.equal(ethers.parseUnits("9", 6));
      expect(campaign.totalClicks).to.equal(1n);
    });

    it("should reject engagement if signature is signed by non-oracle node", async function () {
      // Sign using advertiser instead of oracleNode
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [campaignId, clickFingerprint]
      );
      const signature = await advertiser.signMessage(ethers.getBytes(messageHash));

      await expect(
        splitter.connect(owner).recordEngagement(campaignId, clickFingerprint, [signature], proofA, proofB, proofC)
      ).to.be.revertedWithCustomError(splitter, "InvalidOracleSignature");
    });

    it("should prevent duplicate uses of the same click fingerprint (double-spend protection)", async function () {
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [campaignId, clickFingerprint]
      );
      const signature = await oracleNode.signMessage(ethers.getBytes(messageHash));

      // First click succeeds
      await splitter.connect(owner).recordEngagement(campaignId, clickFingerprint, [signature], proofA, proofB, proofC);
      
      // Second click with same fingerprint reverts
      await expect(
        splitter.connect(owner).recordEngagement(campaignId, clickFingerprint, [signature], proofA, proofB, proofC)
      ).to.be.revertedWithCustomError(splitter, "FingerprintAlreadyUsed");
    });

    it("should reject recordEngagement if campaign budget is exhausted", async function () {
      // Loop CPC payouts to deplete the 10 USDC budget (CPC is 1 USDC, total 10 clicks)
      for (let i = 0; i < 10; i++) {
        const fingerprint = ethers.id(`click_${i}`);
        const hash = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [campaignId, fingerprint]);
        const sig = await oracleNode.signMessage(ethers.getBytes(hash));
        await splitter.connect(owner).recordEngagement(campaignId, fingerprint, [sig], proofA, proofB, proofC);
      }

      // Check campaign is deactivated
      const campaign = await splitter.campaigns(campaignId);
      expect(campaign.active).to.be.false;

      // 11th click should fail
      const nextFingerprint = ethers.id("click_11");
      const nextHash = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [campaignId, nextFingerprint]);
      const nextSig = await oracleNode.signMessage(ethers.getBytes(nextHash));

      await expect(
        splitter.connect(owner).recordEngagement(campaignId, nextFingerprint, [nextSig], proofA, proofB, proofC)
      ).to.be.revertedWithCustomError(splitter, "CampaignNotActive");
    });

    it("should support affiliate address splits with 80% Creator, 15% Affiliate, 5% Platform", async function () {
      const affiliate = creator2.address;
      const budgetAff = ethers.parseUnits("5", 6);
      const cpcAff = ethers.parseUnits("1", 6);

      const tx = await splitter.connect(advertiser).createCampaign(
        budgetAff,
        cpcAff,
        [creator1.address],
        [10000],
        affiliate
      );
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log) => {
          try {
            return splitter.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed && parsed.name === "CampaignCreated");
      const campId = event.args.campaignId;

      // Log click
      const finger = ethers.id("click_affiliate_123");
      const hash = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [campId, finger]);
      const sig = await oracleNode.signMessage(ethers.getBytes(hash));

      const initialCreatorBal = await mockUSDC.balanceOf(creator1.address);
      const initialAffiliateBal = await mockUSDC.balanceOf(affiliate);
      const initialPlatformBal = await mockUSDC.balanceOf(platformWallet.address);

      await splitter.connect(owner).recordEngagement(campId, finger, [sig], proofA, proofB, proofC);

      const finalCreatorBal = await mockUSDC.balanceOf(creator1.address);
      const finalAffiliateBal = await mockUSDC.balanceOf(affiliate);
      const finalPlatformBal = await mockUSDC.balanceOf(platformWallet.address);

      expect(finalCreatorBal - initialCreatorBal).to.equal(800000);
      expect(finalAffiliateBal - initialAffiliateBal).to.equal(150000);
      expect(finalPlatformBal - initialPlatformBal).to.equal(50000);
    });
  });
});
