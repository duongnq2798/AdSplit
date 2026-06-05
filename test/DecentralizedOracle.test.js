import { expect } from "chai";
import pkg from "hardhat";
const { ethers } = pkg;

describe("AdRevenueSplitter Decentralized Oracle Consensus Network (DON)", function () {
  let mockUSDC;
  let mockVault;
  let splitter;
  let owner;
  let advertiser;
  let oracle1;
  let oracle2;
  let oracle3;
  let unauthorizedOracle;
  let platformWallet;
  let creator1;
  const proofA = [0, 0];
  const proofB = [[0, 0], [0, 0]];
  const proofC = [0, 0];

  beforeEach(async function () {
    [
      owner,
      advertiser,
      oracle1,
      oracle2,
      oracle3,
      unauthorizedOracle,
      platformWallet,
      creator1
    ] = await ethers.getSigners();

    // Deploy Mock ERC20 USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy(ethers.parseUnits("10000", 6));
    await mockUSDC.waitForDeployment();

    // Deploy MockYieldVault
    const MockYieldVault = await ethers.getContractFactory("MockYieldVault");
    mockVault = await MockYieldVault.deploy(await mockUSDC.getAddress());
    await mockVault.waitForDeployment();

    // Deploy AdRevenueSplitter with oracle1 as the initial oracleNode
    const AdRevenueSplitter = await ethers.getContractFactory("AdRevenueSplitter");
    splitter = await AdRevenueSplitter.deploy(
      await mockUSDC.getAddress(),
      oracle1.address,
      platformWallet.address,
      await mockVault.getAddress()
    );
    await splitter.waitForDeployment();

    // Fund advertiser and approve splitter
    await mockUSDC.transfer(advertiser.address, ethers.parseUnits("1000", 6));
    await mockUSDC.connect(advertiser).approve(await splitter.getAddress(), ethers.parseUnits("1000", 6));
  });

  describe("DON Configuration & Administration", function () {
    it("should initialize with oracle1 as trusted and threshold as 1", async function () {
      expect(await splitter.isOracleNode(oracle1.address)).to.equal(true);
      expect(await splitter.isOracleNode(oracle2.address)).to.equal(false);
      expect(await splitter.oracleThreshold()).to.equal(1n);
    });

    it("should allow the owner to add oracle nodes and update threshold", async function () {
      await expect(splitter.connect(owner).addOracleNode(oracle2.address))
        .to.emit(splitter, "OracleNodeAdded")
        .withArgs(oracle2.address);

      await expect(splitter.connect(owner).addOracleNode(oracle3.address))
        .to.emit(splitter, "OracleNodeAdded")
        .withArgs(oracle3.address);

      await expect(splitter.connect(owner).setOracleThreshold(2))
        .to.emit(splitter, "OracleThresholdUpdated")
        .withArgs(2n);

      expect(await splitter.isOracleNode(oracle2.address)).to.equal(true);
      expect(await splitter.isOracleNode(oracle3.address)).to.equal(true);
      expect(await splitter.oracleThreshold()).to.equal(2n);
    });

    it("should allow the owner to remove oracle nodes", async function () {
      await splitter.connect(owner).addOracleNode(oracle2.address);
      expect(await splitter.isOracleNode(oracle2.address)).to.equal(true);

      await expect(splitter.connect(owner).removeOracleNode(oracle2.address))
        .to.emit(splitter, "OracleNodeRemoved")
        .withArgs(oracle2.address);

      expect(await splitter.isOracleNode(oracle2.address)).to.equal(false);
    });

    it("should restrict DON admin controls to owner", async function () {
      await expect(
        splitter.connect(advertiser).addOracleNode(oracle2.address)
      ).to.be.revertedWith("Only owner can call");

      await expect(
        splitter.connect(advertiser).setOracleThreshold(2)
      ).to.be.revertedWith("Only owner can call");
    });
  });

  describe("Consensus Signature Verification", function () {
    let campaignId;
    const clickFingerprint = ethers.keccak256(ethers.toUtf8Bytes("click_1234"));

    beforeEach(async function () {
      // Setup 3 trusted oracles with a threshold of 2
      await splitter.connect(owner).addOracleNode(oracle2.address);
      await splitter.connect(owner).addOracleNode(oracle3.address);
      await splitter.connect(owner).setOracleThreshold(2);

      // Create Campaign
      const budget = ethers.parseUnits("10", 6);
      const cpc = ethers.parseUnits("0.05", 6);
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

      campaignId = event.args.campaignId;
    });

    it("should successfully record engagement with 2 valid oracle signatures", async function () {
      // Pack parameters
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [campaignId, clickFingerprint]
      );

      // Sign with oracle1 and oracle2
      const sig1 = await oracle1.signMessage(ethers.getBytes(messageHash));
      const sig2 = await oracle2.signMessage(ethers.getBytes(messageHash));

      const tx = await splitter.recordEngagement(
        campaignId,
        clickFingerprint,
        [sig1, sig2],
        proofA,
        proofB,
        proofC
      );
      await expect(tx).to.emit(splitter, "RevenueSplitExecuted");

      // Verify fingerprint has been marked used
      expect(await splitter.usedFingerprints(clickFingerprint)).to.equal(true);
    });

    it("should revert if signature count is below threshold", async function () {
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [campaignId, clickFingerprint]
      );
      const sig1 = await oracle1.signMessage(ethers.getBytes(messageHash));

      await expect(
        splitter.recordEngagement(
          campaignId,
          clickFingerprint,
          [sig1],
          proofA,
          proofB,
          proofC
        )
      ).to.be.revertedWith("Insufficient signatures");
    });

    it("should revert if duplicate signatures from the same oracle are provided", async function () {
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [campaignId, clickFingerprint]
      );
      const sig1 = await oracle1.signMessage(ethers.getBytes(messageHash));

      await expect(
        splitter.recordEngagement(
          campaignId,
          clickFingerprint,
          [sig1, sig1],
          proofA,
          proofB,
          proofC
        )
      ).to.be.revertedWith("Duplicate signature");
    });

    it("should revert if any signature is from an unauthorized signer", async function () {
      const messageHash = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [campaignId, clickFingerprint]
      );
      const sig1 = await oracle1.signMessage(ethers.getBytes(messageHash));
      const sigUnauthorized = await unauthorizedOracle.signMessage(ethers.getBytes(messageHash));

      await expect(
        splitter.recordEngagement(
          campaignId,
          clickFingerprint,
          [sig1, sigUnauthorized],
          proofA,
          proofB,
          proofC
        )
      ).to.be.revertedWith("Invalid oracle signature");
    });
  });
});
