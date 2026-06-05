// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

/**
 * @dev Interface of the ERC4626 standard.
 */
interface IERC4626 is IERC20 {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function mint(uint256 shares, address receiver) external returns (uint256 assets);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    
    function totalAssets() external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
    function previewMint(uint256 shares) external view returns (uint256);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);
    
    function maxDeposit(address receiver) external view returns (uint256);
    function maxMint(address receiver) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);
}

interface IVerifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[2] calldata input
    ) external view returns (bool);
}

/**
 * @title AdRevenueSplitter
 * @notice Decentralized Ad Escrow & Automated Multi-Recipient Revenue Splitter on Arc L1.
 * USDC is the native gas token, but we also interact with ERC-20 USDC (6 decimals).
 */
contract AdRevenueSplitter is ReentrancyGuard {
    
    IERC20 public immutable usdcToken;
    IERC4626 public yieldVault;
    address public owner;
    address public oracleNode;
    
    // Multi-Oracle state variables for DON
    mapping(address => bool) public isOracleNode;
    uint256 public oracleThreshold;
    
    uint256 public constant BASIS_POINTS = 10000; // 100% = 10000 basis points
    uint256 public platformFeeBps = 300;         // 3.0% platform fee
    address public platformWallet;
    
    // Custom Errors for Gas Optimization
    error BudgetMustBeGreaterThanZero();
    error CostPerClickMustBeGreaterThanZero();
    error CostPerClickExceedsBudget();
    error MismatchedRecipientsAndShares();
    error RecipientRequired();
    error InvalidRecipient();
    error InvalidSharesSum();
    error EscrowDepositFailed();
    error ApproveFailed();
    error DepositSlippageTooHigh();
    error CampaignNotActive();
    error CampaignBudgetExhausted();
    error InsufficientSignatures();
    error InvalidOracleSignature();
    error DuplicateSignature();
    error PlatformFeeTransferFailed();
    error RecipientPaymentFailed();
    error CreatorPaymentFailed();
    error AffiliateFeeTransferFailed();
    error WithdrawRefundFailed();
    error OnlyAdvertiserCanWithdraw();
    error InvalidAddress();
    error AlreadyOracle();
    error NotOracle();
    error ThresholdMustBeGreaterThanZero();
    error VaultWithdrawalFailed();
    error VaultRedemptionFailed();
    error OnlyOwner();
    error OnlyOracleNode();
    error BudgetTooLarge();
    error CostPerClickTooLarge();
    error FingerprintAlreadyUsed();
    error InvalidZKProof();
    error SignatureLengthInvalid();
    error PlatformFeeBpsTooHigh();
    error RefundFailed();

    struct SplitShare {
        address recipient;
        uint96 shareBps; // Packed: fits in single 256-bit slot with address recipient (160 bits)
    }
    
    struct Campaign {
        bytes32 campaignId;
        address advertiser;       // 160 bits. Slot 1
        bool active;              // 8 bits. Slot 1
        uint64 totalClicks;       // 64 bits. Slot 1
        uint128 totalBudget;      // 128 bits. Slot 2 (6 decimals USDC)
        uint128 remainingBudget;  // 128 bits. Slot 2 (6 decimals USDC)
        uint128 costPerClick;     // 128 bits. Slot 3 (6 decimals USDC)
        uint128 vaultShares;      // 128 bits. Slot 3 (shares allocated in yieldVault)
        address affiliate;        // 160 bits. Slot 4
    }
    
    // Mapping from campaignId to Campaign details
    mapping(bytes32 => Campaign) public campaigns;
    
    // Deployed ZK Verifier contract address
    address public verifier;
    
    // Mapping from campaignId to the default split shares (creators / affiliate network / platform)
    mapping(bytes32 => SplitShare[]) private campaignSplits;
    
    // Nonce for unique campaign IDs
    uint256 private campaignNonce;
    
    // Mapping from click fingerprint to usage status to prevent double-spend/replays
    mapping(bytes32 => bool) public usedFingerprints;
    
    event CampaignCreated(
        bytes32 indexed campaignId, 
        address indexed advertiser, 
        uint256 totalBudget, 
        uint256 costPerClick
    );
    
    event RevenueSplitExecuted(
        bytes32 indexed campaignId,
        uint256 totalAmount,
        uint256 platformFee,
        uint256 distributedAmount
    );
    
    event RecipientPaid(
        bytes32 indexed campaignId,
        address indexed recipient,
        uint256 amount
    );
    
    event CampaignClosed(bytes32 indexed campaignId, uint256 refundAmount);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event PlatformWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event YieldVaultUpdated(address indexed oldVault, address indexed newVault);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    
    // DON specific events
    event OracleNodeAdded(address indexed node);
    event OracleNodeRemoved(address indexed node);
    event OracleThresholdUpdated(uint256 newThreshold);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    
    modifier onlyOracle() {
        if (!isOracleNode[msg.sender]) revert OnlyOracleNode();
        _;
    }
    
    constructor(address _usdcToken, address _oracleNode, address _platformWallet, address _yieldVault) {
        if (_usdcToken == address(0)) revert InvalidAddress();
        if (_oracleNode == address(0)) revert InvalidAddress();
        if (_platformWallet == address(0)) revert InvalidAddress();
        if (_yieldVault == address(0)) revert InvalidAddress();
        
        usdcToken = IERC20(_usdcToken);
        oracleNode = _oracleNode;
        isOracleNode[_oracleNode] = true;
        oracleThreshold = 1;
        platformWallet = _platformWallet;
        yieldVault = IERC4626(_yieldVault);
        owner = msg.sender;
    }
    
    /**
     * @notice Set the Oracle node address that reports fraud-free user engagements.
     */
    function setOracleNode(address _oracleNode) external onlyOwner {
        if (_oracleNode == address(0)) revert InvalidAddress();
        emit OracleUpdated(oracleNode, _oracleNode);
        isOracleNode[oracleNode] = false;
        oracleNode = _oracleNode;
        isOracleNode[_oracleNode] = true;
    }
    
    /**
     * @notice Add a new trusted oracle node.
     */
    function addOracleNode(address _node) external onlyOwner {
        if (_node == address(0)) revert InvalidAddress();
        if (isOracleNode[_node]) revert AlreadyOracle();
        isOracleNode[_node] = true;
        emit OracleNodeAdded(_node);
    }
    
    /**
     * @notice Remove a trusted oracle node.
     */
    function removeOracleNode(address _node) external onlyOwner {
        if (!isOracleNode[_node]) revert NotOracle();
        isOracleNode[_node] = false;
        emit OracleNodeRemoved(_node);
    }
    
    /**
     * @notice Update the required quorum threshold for consensus.
     */
    function setOracleThreshold(uint256 _threshold) external onlyOwner {
        if (_threshold == 0) revert ThresholdMustBeGreaterThanZero();
        oracleThreshold = _threshold;
        emit OracleThresholdUpdated(_threshold);
    }
    
    /**
     * @notice Set the platform revenue wallet.
     */
    function setPlatformWallet(address _platformWallet) external onlyOwner {
        if (_platformWallet == address(0)) revert InvalidAddress();
        emit PlatformWalletUpdated(platformWallet, _platformWallet);
        platformWallet = _platformWallet;
    }
    
    /**
     * @notice Set platform fee in basis points (e.g. 300 = 3%).
     */
    function setPlatformFeeBps(uint256 _bps) external onlyOwner {
        if (_bps > 1000) revert PlatformFeeBpsTooHigh();
        emit PlatformFeeUpdated(platformFeeBps, _bps);
        platformFeeBps = _bps;
    }
    
    /**
     * @notice Set the yield vault address.
     */
    function setYieldVault(address _yieldVault) external onlyOwner {
        if (_yieldVault == address(0)) revert InvalidAddress();
        emit YieldVaultUpdated(address(yieldVault), _yieldVault);
        yieldVault = IERC4626(_yieldVault);
    }
    
    /**
     * @notice Set the ZK Verifier contract address.
     */
    function setVerifier(address _verifier) external onlyOwner {
        if (_verifier == address(0)) revert InvalidAddress();
        emit VerifierUpdated(verifier, _verifier);
        verifier = _verifier;
    }
    
    /**
     * @notice Create a programmatic ad campaign with stablecoin escrow.
     * @param _budget Total campaign budget in USDC (6 decimals).
     * @param _costPerClick Payout amount per valid interaction in USDC (6 decimals).
     * @param _recipients Dynamic addresses of the split recipients (creators, syndicators).
     * @param _shares Percentage shares of the dynamic recipients (in basis points, sum must be 10000 - platformFee).
     */
    function createCampaign(
        uint256 _budget,
        uint256 _costPerClick,
        address[] calldata _recipients,
        uint256[] calldata _shares,
        address _affiliate
    ) external nonReentrant returns (bytes32) {
        if (_budget == 0) revert BudgetMustBeGreaterThanZero();
        if (_costPerClick == 0) revert CostPerClickMustBeGreaterThanZero();
        if (_costPerClick > _budget) revert CostPerClickExceedsBudget();
        if (_recipients.length != _shares.length) revert MismatchedRecipientsAndShares();
        if (_recipients.length == 0) revert RecipientRequired();
        if (_budget > type(uint128).max) revert BudgetTooLarge();
        if (_costPerClick > type(uint128).max) revert CostPerClickTooLarge();
        
        // Validate shares sum
        uint256 totalShares = 0;
        uint256 len = _shares.length;
        for (uint256 i = 0; i < len; i++) {
            if (_recipients[i] == address(0)) revert InvalidRecipient();
            totalShares += _shares[i];
        }
        if (totalShares != BASIS_POINTS) revert InvalidSharesSum();
        
        // Transfer USDC from advertiser to this contract escrow
        if (!usdcToken.transferFrom(msg.sender, address(this), _budget)) {
            revert EscrowDepositFailed();
        }
        
        // Approve yieldVault to spend USDC
        if (!usdcToken.approve(address(yieldVault), _budget)) {
            revert ApproveFailed();
        }
        
        // Deposit into vault with slippage protection
        uint256 expectedShares = yieldVault.previewDeposit(_budget);
        uint256 shares = yieldVault.deposit(_budget, address(this));
        if (shares < (expectedShares * 9950) / 10000) {
            revert DepositSlippageTooHigh();
        }
        
        campaignNonce++;
        bytes32 campaignId = keccak256(
            abi.encodePacked(msg.sender, _budget, _costPerClick, campaignNonce, block.timestamp)
        );
        
        campaigns[campaignId] = Campaign({
            campaignId: campaignId,
            advertiser: msg.sender,
            totalBudget: uint128(_budget),
            remainingBudget: uint128(_budget),
            costPerClick: uint128(_costPerClick),
            totalClicks: 0,
            active: true,
            vaultShares: uint128(shares),
            affiliate: _affiliate
        });
        
        if (_affiliate != address(0)) {
            campaignSplits[campaignId].push(SplitShare({
                recipient: _recipients[0],
                shareBps: 8000
            }));
            campaignSplits[campaignId].push(SplitShare({
                recipient: _affiliate,
                shareBps: 1500
            }));
        } else {
            for (uint256 i = 0; i < len; i++) {
                campaignSplits[campaignId].push(SplitShare({
                    recipient: _recipients[i],
                    shareBps: uint96(_shares[i])
                }));
            }
        }
        
        emit CampaignCreated(campaignId, msg.sender, _budget, _costPerClick);
        return campaignId;
    }
    
    function _withdrawFromVault(uint256 _payoutAmount) private returns (uint256) {
        if (address(yieldVault).code.length == 0) {
            if (usdcToken.balanceOf(address(this)) >= _payoutAmount) {
                return _payoutAmount;
            }
            revert VaultWithdrawalFailed();
        }

        uint256 expectedSharesToRedeem = 0;
        try yieldVault.previewWithdraw(_payoutAmount) returns (uint256 expected) {
            expectedSharesToRedeem = expected;
        } catch {}

        try yieldVault.withdraw(_payoutAmount, address(this), address(this)) returns (uint256 redeemed) {
            if (expectedSharesToRedeem > 0) {
                if (redeemed > (expectedSharesToRedeem * 10050) / 10000) {
                    revert VaultWithdrawalFailed();
                }
            }
            return redeemed;
        } catch {
            if (usdcToken.balanceOf(address(this)) >= _payoutAmount) {
                try yieldVault.convertToShares(_payoutAmount) returns (uint256 shares) {
                    return shares;
                } catch {
                    return _payoutAmount; // Default to 1:1 if vault conversion reverts
                }
            }
            revert VaultWithdrawalFailed();
        }
    }

    function _redeemFromVault(uint256 _shares) private returns (uint256) {
        if (address(yieldVault).code.length == 0) {
            if (usdcToken.balanceOf(address(this)) >= _shares) {
                return _shares;
            }
            revert VaultRedemptionFailed();
        }

        try yieldVault.redeem(_shares, address(this), address(this)) returns (uint256 redeemed) {
            return redeemed;
        } catch {
            uint256 equivalentAssets = 0;
            try yieldVault.convertToAssets(_shares) returns (uint256 assets) {
                equivalentAssets = assets;
            } catch {
                equivalentAssets = _shares; // Default to 1:1 if vault conversion reverts
            }
            if (usdcToken.balanceOf(address(this)) >= equivalentAssets) {
                return equivalentAssets;
            }
            revert VaultRedemptionFailed();
        }
    }

    /**
     * @notice Distributes payout for a single click instantly to dynamic recipients.
     * Called by any relayer or account with a valid signature from the Fraud Detection Oracle.
     */
    function recordEngagement(
        bytes32 _campaignId, 
        bytes32 _clickFingerprint, 
        bytes[] calldata _signatures,
        uint[2] calldata _a,
        uint[2][2] calldata _b,
        uint[2] calldata _c
    ) external nonReentrant {
        if (usedFingerprints[_clickFingerprint]) revert FingerprintAlreadyUsed();
        if (_signatures.length < oracleThreshold) revert InsufficientSignatures();

        if (verifier != address(0)) {
            uint[2] memory input = [
                uint256(_campaignId) % 21888242871839275222246405745257275088548364400416034343698204186575808495617,
                uint256(_clickFingerprint) % 21888242871839275222246405745257275088548364400416034343698204186575808495617
            ];
            if (!IVerifier(verifier).verifyProof(_a, _b, _c, input)) {
                revert InvalidZKProof();
            }
        }
        
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32", 
                keccak256(abi.encodePacked(_campaignId, _clickFingerprint))
            )
        );
        
        uint256 sigsLen = _signatures.length;
        address[] memory signers = new address[](sigsLen);
        for (uint256 i = 0; i < sigsLen; i++) {
            address signer = recoverSigner(messageHash, _signatures[i]);
            if (!isOracleNode[signer]) revert InvalidOracleSignature();
            
            for (uint256 j = 0; j < i; j++) {
                if (signers[j] == signer) revert DuplicateSignature();
            }
            signers[i] = signer;
        }
        
        usedFingerprints[_clickFingerprint] = true;

        Campaign storage campaign = campaigns[_campaignId];
        if (!campaign.active) revert CampaignNotActive();
        if (campaign.remainingBudget < campaign.costPerClick) revert CampaignBudgetExhausted();
        
        uint256 payoutAmount = campaign.costPerClick;
        campaign.remainingBudget -= uint128(payoutAmount);
        campaign.totalClicks += 1;
        
        // Withdraw from vault with slippage protection and fallback
        uint256 sharesRedeemed = _withdrawFromVault(payoutAmount);
        
        // Update campaign shares
        if (campaign.vaultShares >= sharesRedeemed) {
            campaign.vaultShares -= uint128(sharesRedeemed);
        } else {
            campaign.vaultShares = 0;
        }
        
        // Split payout
        uint256 platformFee;
        uint256 distributeAmount;
        if (campaign.affiliate != address(0)) {
            platformFee = (payoutAmount * 500) / BASIS_POINTS;
            distributeAmount = payoutAmount - platformFee;
            if (platformFee > 0) {
                if (!usdcToken.transfer(platformWallet, platformFee)) {
                    revert PlatformFeeTransferFailed();
                }
            }
            SplitShare[] storage splits = campaignSplits[_campaignId];
            uint256 splitsLen = splits.length;
            for (uint256 i = 0; i < splitsLen; i++) {
                uint256 recipientAmount = (payoutAmount * splits[i].shareBps) / BASIS_POINTS;
                if (recipientAmount > 0) {
                    if (!usdcToken.transfer(splits[i].recipient, recipientAmount)) {
                        revert RecipientPaymentFailed();
                    }
                    emit RecipientPaid(_campaignId, splits[i].recipient, recipientAmount);
                }
            }
        } else {
            platformFee = (payoutAmount * platformFeeBps) / BASIS_POINTS;
            distributeAmount = payoutAmount - platformFee;
            if (platformFee > 0) {
                if (!usdcToken.transfer(platformWallet, platformFee)) {
                    revert PlatformFeeTransferFailed();
                }
            }
            SplitShare[] storage splits = campaignSplits[_campaignId];
            uint256 splitsLen = splits.length;
            for (uint256 i = 0; i < splitsLen; i++) {
                uint256 recipientAmount = (distributeAmount * splits[i].shareBps) / BASIS_POINTS;
                if (recipientAmount > 0) {
                    if (!usdcToken.transfer(splits[i].recipient, recipientAmount)) {
                        revert RecipientPaymentFailed();
                    }
                    emit RecipientPaid(_campaignId, splits[i].recipient, recipientAmount);
                }
            }
        }
        
        emit RevenueSplitExecuted(_campaignId, payoutAmount, platformFee, distributeAmount);
        
        if (campaign.remainingBudget < campaign.costPerClick) {
            campaign.active = false;
            
            uint256 remainingShares = campaign.vaultShares;
            campaign.vaultShares = 0;
            campaign.remainingBudget = 0;
            
            uint256 refundAmount = 0;
            if (remainingShares > 0) {
                refundAmount = _redeemFromVault(remainingShares);
                if (refundAmount > 0) {
                    if (!usdcToken.transfer(campaign.advertiser, refundAmount)) {
                        revert RefundFailed();
                    }
                }
            }
            emit CampaignClosed(_campaignId, refundAmount);
        }
    }

    /**
     * @notice Execute a batch of engagement payouts off-chain validated by the oracle/settler.
     * @param _campaignIds Array of campaign IDs.
     * @param _creators Array of creator/recipient addresses.
     * @param _amounts Array of micro-settlement amounts in USDC (6 decimals).
     */
    function executeBatchEngagement(
        bytes32[] calldata _campaignIds,
        address[] calldata _creators,
        uint256[] calldata _amounts
    ) external nonReentrant {
        if (!isOracleNode[msg.sender] && msg.sender != owner) revert OnlyOracleNode();
        if (_campaignIds.length != _creators.length) revert MismatchedRecipientsAndShares();
        if (_creators.length != _amounts.length) revert MismatchedRecipientsAndShares();

        uint256 len = _campaignIds.length;
        for (uint256 i = 0; i < len; i++) {
            bytes32 campaignId = _campaignIds[i];
            address creator = _creators[i];
            uint256 amount = _amounts[i];
            
            if (amount == 0) continue;

            Campaign storage campaign = campaigns[campaignId];
            if (!campaign.active) revert CampaignNotActive();
            if (campaign.remainingBudget < amount) revert CampaignBudgetExhausted();

            campaign.remainingBudget -= uint128(amount);
            campaign.totalClicks += 1;
            
            // Withdraw from vault
            uint256 sharesRedeemed = _withdrawFromVault(amount);
            
            if (campaign.vaultShares >= sharesRedeemed) {
                campaign.vaultShares -= uint128(sharesRedeemed);
            } else {
                campaign.vaultShares = 0;
            }

            // Split platform fee and recipient amount
            uint256 platformFee;
            uint256 distributeAmount;
            if (campaign.affiliate != address(0)) {
                platformFee = (amount * 500) / BASIS_POINTS;
                uint256 affiliateFee = (amount * 1500) / BASIS_POINTS;
                distributeAmount = amount - platformFee - affiliateFee;
                
                if (platformFee > 0) {
                    if (!usdcToken.transfer(platformWallet, platformFee)) {
                        revert PlatformFeeTransferFailed();
                    }
                }
                if (affiliateFee > 0) {
                    if (!usdcToken.transfer(campaign.affiliate, affiliateFee)) {
                        revert AffiliateFeeTransferFailed();
                    }
                    emit RecipientPaid(campaignId, campaign.affiliate, affiliateFee);
                }
                if (distributeAmount > 0) {
                    if (!usdcToken.transfer(creator, distributeAmount)) {
                        revert CreatorPaymentFailed();
                    }
                    emit RecipientPaid(campaignId, creator, distributeAmount);
                }
                emit RevenueSplitExecuted(campaignId, amount, platformFee, distributeAmount + affiliateFee);
            } else {
                platformFee = (amount * platformFeeBps) / BASIS_POINTS;
                distributeAmount = amount - platformFee;
                
                if (platformFee > 0) {
                    if (!usdcToken.transfer(platformWallet, platformFee)) {
                        revert PlatformFeeTransferFailed();
                    }
                }
                if (distributeAmount > 0) {
                    if (!usdcToken.transfer(creator, distributeAmount)) {
                        revert CreatorPaymentFailed();
                    }
                    emit RecipientPaid(campaignId, creator, distributeAmount);
                }
                emit RevenueSplitExecuted(campaignId, amount, platformFee, distributeAmount);
            }

            if (campaign.remainingBudget < campaign.costPerClick) {
                campaign.active = false;
                
                uint256 remainingShares = campaign.vaultShares;
                campaign.vaultShares = 0;
                campaign.remainingBudget = 0;
                
                uint256 refundAmount = 0;
                if (remainingShares > 0) {
                    refundAmount = _redeemFromVault(remainingShares);
                    if (refundAmount > 0) {
                        if (!usdcToken.transfer(campaign.advertiser, refundAmount)) {
                            revert RefundFailed();
                        }
                    }
                }
                emit CampaignClosed(campaignId, refundAmount);
            }
        }
    }


    /**
     * @notice Helper to recover the signer address from an EIP-191 signature.
     */
    function recoverSigner(bytes32 _ethSignedMessageHash, bytes memory _sig) public pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_sig);
        return ecrecover(_ethSignedMessageHash, v, r, s);
    }

    /**
     * @notice Helper to split a signature into r, s, v components.
     */
    function splitSignature(bytes memory sig) public pure returns (bytes32 r, bytes32 s, uint8 v) {
        if (sig.length != 65) revert SignatureLengthInvalid();

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }
    
    /**
     * @notice Emergency withdraw for Advertiser to pause and recoup remaining campaign funds immediately.
     */
    function withdrawRemainingBudget(bytes32 _campaignId) external nonReentrant {
        Campaign storage campaign = campaigns[_campaignId];
        if (campaign.advertiser != msg.sender) revert OnlyAdvertiserCanWithdraw();
        if (!campaign.active) revert CampaignNotActive();
        
        uint256 refundShares = campaign.vaultShares;
        campaign.remainingBudget = 0;
        campaign.vaultShares = 0;
        campaign.active = false;
        
        uint256 refundAmount = 0;
        if (refundShares > 0) {
            refundAmount = _redeemFromVault(refundShares);
            if (refundAmount > 0) {
                if (!usdcToken.transfer(msg.sender, refundAmount)) {
                    revert WithdrawRefundFailed();
                }
            }
        }
        
        emit CampaignClosed(_campaignId, refundAmount);
    }
    
    /**
     * @notice Calculate the accrued interest of a campaign in the yield vault.
     */
    function getCampaignYield(bytes32 _campaignId) public view returns (uint256) {
        Campaign memory campaign = campaigns[_campaignId];
        if (!campaign.active || campaign.vaultShares == 0) {
            return 0;
        }
        uint256 currentAssets = yieldVault.convertToAssets(campaign.vaultShares);
        if (currentAssets > campaign.remainingBudget) {
            return currentAssets - campaign.remainingBudget;
        }
        return 0;
    }
    
    /**
     * @notice Fetch the split recipients of a campaign
     */
    function getCampaignSplits(bytes32 _campaignId) external view returns (address[] memory, uint256[] memory) {
        SplitShare[] storage splits = campaignSplits[_campaignId];
        uint256 len = splits.length;
        address[] memory recipients = new address[](len);
        uint256[] memory shares = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            recipients[i] = splits[i].recipient;
            shares[i] = splits[i].shareBps;
        }
        return (recipients, shares);
    }
}
