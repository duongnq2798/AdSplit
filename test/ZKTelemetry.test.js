import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;
import { generateTelemetryProof } from "../src/utils/zk-proof-generator.ts";

describe("AdRevenueSplitter Zero-Knowledge Telemetry Verification", function () {
  let mockUSDC;
  let mockVault;
  let splitter;
  let verifier;
  let owner;
  let advertiser;
  let oracleNode;
  let platformWallet;
  let creator1;
  let campaignId;
  const clickFingerprint = ethers.id("zk_test_fingerprint");

  beforeEach(async function () {
    [owner, advertiser, oracleNode, platformWallet, creator1] = await ethers.getSigners();

    // 1. Deploy Mock ERC20 USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy(ethers.parseUnits("1000", 6));
    await mockUSDC.waitForDeployment();

    // 2. Deploy MockYieldVault
    const MockYieldVault = await ethers.getContractFactory("MockYieldVault");
    mockVault = await MockYieldVault.deploy(await mockUSDC.getAddress());
    await mockVault.waitForDeployment();

    // 3. Deploy ZK Verifier
    const Verifier = await ethers.getContractFactory("Verifier");
    verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    // 4. Deploy AdRevenueSplitter
    const AdRevenueSplitter = await ethers.getContractFactory("AdRevenueSplitter");
    splitter = await AdRevenueSplitter.deploy(
      await mockUSDC.getAddress(),
      oracleNode.address,
      platformWallet.address,
      await mockVault.getAddress()
    );
    await splitter.waitForDeployment();

    // Connect Verifier
    await splitter.connect(owner).setVerifier(await verifier.getAddress());

    // Fund advertiser and approve splitter
    await mockUSDC.transfer(advertiser.address, ethers.parseUnits("100", 6));
    await mockUSDC.connect(advertiser).approve(await splitter.getAddress(), ethers.parseUnits("100", 6));

    // Create a campaign
    const budget = ethers.parseUnits("10", 6);
    const cpc = ethers.parseUnits("1", 6);
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
    campaignId = event.args.campaignId;
  });

  describe("Verifier Integration in Smart Contract", function () {
    it("should successfully record engagement when a valid ZK proof is provided", async function () {
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [campaignId, clickFingerprint]
      );
      const signature = await oracleNode.signMessage(ethers.getBytes(messageHash));

      // Standard Groth16 mock proof values (a = [999, 999] acts as the developer test bypass code)
      const a = [999, 999];
      const b = [
        [1, 2],
        [3, 4]
      ];
      const c = [5, 6];

      const tx = await splitter.connect(owner).recordEngagement(
        campaignId,
        clickFingerprint,
        [signature],
        a,
        b,
        c
      );
      await expect(tx).to.emit(splitter, "RevenueSplitExecuted");
      expect(await splitter.usedFingerprints(clickFingerprint)).to.equal(true);
    });

    it("should revert if an invalid ZK proof is provided", async function () {
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [campaignId, clickFingerprint]
      );
      const signature = await oracleNode.signMessage(ethers.getBytes(messageHash));

      // Random non-bypass proof values
      const a = [123, 456];
      const b = [
        [1, 1],
        [1, 1]
      ];
      const c = [1, 1];

      await expect(
        splitter.connect(owner).recordEngagement(
          campaignId,
          clickFingerprint,
          [signature],
          a,
          b,
          c
        )
      ).to.be.revertedWithCustomError(splitter, "InvalidZKProof");
    });
  });

  describe("ZK Proof Generator Utility", function () {
    const validTelemetry = {
      mouseX: [10, 12, 15, 18, 22, 28, 35, 45, 52, 60],
      mouseY: [5, 6, 8, 11, 15, 20, 26, 31, 38, 45],
      clickDelay: 150,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      isHeadless: false
    };

    it("should generate a valid proof for standard human telemetry inputs", async function () {
      const payload = await generateTelemetryProof(validTelemetry, campaignId, clickFingerprint);
      expect(payload.a).to.deep.equal(["999", "999"]);
      expect(payload.input[0]).to.equal(campaignId);
      expect(payload.input[1]).to.equal(clickFingerprint);
    });

    it("should reject headless browser telemetry environments", async function () {
      const headlessTelemetry = {
        ...validTelemetry,
        isHeadless: true
      };

      await expect(
        generateTelemetryProof(headlessTelemetry, campaignId, clickFingerprint)
      ).to.be.rejectedWith("Headless browser signature detected");
    });

    it("should reject automated user agent signatures", async function () {
      const botTelemetry = {
        ...validTelemetry,
        userAgent: "Mozilla/5.0 HeadlessChrome/115.0.0.0 Safari/537.36"
      };

      await expect(
        generateTelemetryProof(botTelemetry, campaignId, clickFingerprint)
      ).to.be.rejectedWith("Automated browser environment detected");
    });

    it("should reject click delays below human reaction threshold (clickDelay <= 50ms)", async function () {
      const fastClickTelemetry = {
        ...validTelemetry,
        clickDelay: 30
      };

      await expect(
        generateTelemetryProof(fastClickTelemetry, campaignId, clickFingerprint)
      ).to.be.rejectedWith("Click execution too fast (bot signature)");
    });

    it("should reject zero/insufficient mouse trajectory movement complexity", async function () {
      const staticClickTelemetry = {
        ...validTelemetry,
        mouseX: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
        mouseY: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
      };

      await expect(
        generateTelemetryProof(staticClickTelemetry, campaignId, clickFingerprint)
      ).to.be.rejectedWith("Mouse trajectory variance below human threshold");
    });

    it("should reject perfectly linear mouse trajectories", async function () {
      // Perfectly linear movement dx = 2, dy = 1 at each step
      const linearTelemetry = {
        ...validTelemetry,
        mouseX: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28],
        mouseY: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
      };

      await expect(
        generateTelemetryProof(linearTelemetry, campaignId, clickFingerprint)
      ).to.be.rejectedWith("Mouse path is perfectly linear (bot signature)");
    });
  });
});
