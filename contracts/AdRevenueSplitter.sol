// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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

/**
 * @title AdRevenueSplitter
 * @notice Decentralized Ad Escrow & Automated Multi-Recipient Revenue Splitter on Arc L1.
 * USDC is the native gas token, but we also interact with ERC-20 USDC (6 decimals).
 */
contract AdRevenueSplitter {
    
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
    
    struct SplitShare {
        address recipient;
        uint256 shareBps; // In basis points (e.g. 4500 = 45%)
    }
    
    struct Campaign {
        bytes32 campaignId;
        address advertiser;
        uint256 totalBudget;      // 6 decimals USDC
        uint256 remainingBudget;  // 6 decimals USDC
        uint256 costPerClick;     // 6 decimals USDC
        uint256 totalClicks;
        bool active;
        uint256 vaultShares;      // shares allocated to the campaign in yieldVault
    }
    
    // Mapping from campaignId to Campaign details
    mapping(bytes32 => Campaign) public campaigns;
    
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
    
    // DON specific events
    event OracleNodeAdded(address indexed node);
    event OracleNodeRemoved(address indexed node);
    event OracleThresholdUpdated(uint256 newThreshold);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call");
        _;
    }
    
    modifier onlyOracle() {
        require(isOracleNode[msg.sender], "Only fraud detection oracle can call");
        _;
    }
    
    constructor(address _usdcToken, address _oracleNode, address _platformWallet, address _yieldVault) {
        require(_usdcToken != address(0), "Invalid token address");
        require(_oracleNode != address(0), "Invalid oracle address");
        require(_platformWallet != address(0), "Invalid platform wallet");
        require(_yieldVault != address(0), "Invalid yield vault address");
        
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
        require(_oracleNode != address(0), "Invalid address");
        emit OracleUpdated(oracleNode, _oracleNode);
        isOracleNode[oracleNode] = false;
        oracleNode = _oracleNode;
        isOracleNode[_oracleNode] = true;
    }
    
    /**
     * @notice Add a new trusted oracle node.
     */
    function addOracleNode(address _node) external onlyOwner {
        require(_node != address(0), "Invalid address");
        require(!isOracleNode[_node], "Already oracle");
        isOracleNode[_node] = true;
        emit OracleNodeAdded(_node);
    }
    
    /**
     * @notice Remove a trusted oracle node.
     */
    function removeOracleNode(address _node) external onlyOwner {
        require(isOracleNode[_node], "Not oracle");
        isOracleNode[_node] = false;
        emit OracleNodeRemoved(_node);
    }
    
    /**
     * @notice Update the required quorum threshold for consensus.
     */
    function setOracleThreshold(uint256 _threshold) external onlyOwner {
        require(_threshold > 0, "Threshold must be > 0");
        oracleThreshold = _threshold;
        emit OracleThresholdUpdated(_threshold);
    }
    
    /**
     * @notice Set the platform revenue wallet.
     */
    function setPlatformWallet(address _platformWallet) external onlyOwner {
        require(_platformWallet != address(0), "Invalid address");
        emit PlatformWalletUpdated(platformWallet, _platformWallet);
        platformWallet = _platformWallet;
    }
    
    /**
     * @notice Set platform fee in basis points (e.g. 300 = 3%).
     */
    function setPlatformFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 1000, "Fee cannot exceed 10%");
        emit PlatformFeeUpdated(platformFeeBps, _bps);
        platformFeeBps = _bps;
    }
    
    /**
     * @notice Set the yield vault address.
     */
    function setYieldVault(address _yieldVault) external onlyOwner {
        require(_yieldVault != address(0), "Invalid yield vault address");
        emit YieldVaultUpdated(address(yieldVault), _yieldVault);
        yieldVault = IERC4626(_yieldVault);
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
        uint256[] calldata _shares
    ) external returns (bytes32) {
        require(_budget > 0, "Budget must be greater than zero");
        require(_costPerClick > 0, "Cost per click must be greater than zero");
        require(_costPerClick <= _budget, "CPC cannot exceed total budget");
        require(_recipients.length == _shares.length, "Mismatched recipients and shares");
        require(_recipients.length > 0, "At least one recipient required");
        
        // Validate shares sum
        uint256 totalShares = 0;
        for (uint256 i = 0; i < _shares.length; i++) {
            require(_recipients[i] != address(0), "Invalid recipient");
            totalShares += _shares[i];
        }
        require(totalShares == BASIS_POINTS, "Shares sum must be exactly 10000 basis points");
        
        // Transfer USDC from advertiser to this contract escrow
        require(
            usdcToken.transferFrom(msg.sender, address(this), _budget),
            "USDC escrow deposit failed"
        );
        
        // Approve yieldVault to spend USDC
        require(
            usdcToken.approve(address(yieldVault), _budget),
            "USDC approve failed"
        );
        
        // Deposit into vault with slippage protection
        uint256 expectedShares = yieldVault.previewDeposit(_budget);
        uint256 shares = yieldVault.deposit(_budget, address(this));
        require(shares >= (expectedShares * 9950) / 10000, "Deposit slippage too high");
        
        campaignNonce++;
        bytes32 campaignId = keccak256(
            abi.encodePacked(msg.sender, _budget, _costPerClick, campaignNonce, block.timestamp)
        );
        
        campaigns[campaignId] = Campaign({
            campaignId: campaignId,
            advertiser: msg.sender,
            totalBudget: _budget,
            remainingBudget: _budget,
            costPerClick: _costPerClick,
            totalClicks: 0,
            active: true,
            vaultShares: shares
        });
        
        for (uint256 i = 0; i < _recipients.length; i++) {
            campaignSplits[campaignId].push(SplitShare({
                recipient: _recipients[i],
                shareBps: _shares[i]
            }));
        }
        
        emit CampaignCreated(campaignId, msg.sender, _budget, _costPerClick);
        return campaignId;
    }
    
    function _withdrawFromVault(uint256 _payoutAmount) private returns (uint256) {
        if (address(yieldVault).code.length == 0) {
            if (usdcToken.balanceOf(address(this)) >= _payoutAmount) {
                return _payoutAmount;
            }
            revert("Vault is EOA and no local USDC fallback available");
        }

        uint256 expectedSharesToRedeem = 0;
        try yieldVault.previewWithdraw(_payoutAmount) returns (uint256 expected) {
            expectedSharesToRedeem = expected;
        } catch {}

        try yieldVault.withdraw(_payoutAmount, address(this), address(this)) returns (uint256 redeemed) {
            if (expectedSharesToRedeem > 0) {
                require(redeemed <= (expectedSharesToRedeem * 10050) / 10000, "Withdraw slippage too high");
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
            revert("Vault withdrawal failed and no local USDC fallback available");
        }
    }

    function _redeemFromVault(uint256 _shares) private returns (uint256) {
        if (address(yieldVault).code.length == 0) {
            if (usdcToken.balanceOf(address(this)) >= _shares) {
                return _shares;
            }
            revert("Vault is EOA and no local USDC fallback available");
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
            revert("Vault redemption failed and no local USDC fallback available");
        }
    }

    /**
     * @notice Distributes payout for a single click instantly to dynamic recipients.
     * Called by any relayer or account with a valid signature from the Fraud Detection Oracle.
     */
    function recordEngagement(
        bytes32 _campaignId, 
        bytes32 _clickFingerprint, 
        bytes[] calldata _signatures
    ) external {
        require(!usedFingerprints[_clickFingerprint], "Fingerprint already used");
        require(_signatures.length >= oracleThreshold, "Insufficient signatures");
        
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32", 
                keccak256(abi.encodePacked(_campaignId, _clickFingerprint))
            )
        );
        
        address[] memory signers = new address[](_signatures.length);
        for (uint256 i = 0; i < _signatures.length; i++) {
            address signer = recoverSigner(messageHash, _signatures[i]);
            require(isOracleNode[signer], "Invalid oracle signature");
            
            for (uint256 j = 0; j < i; j++) {
                require(signers[j] != signer, "Duplicate signature");
            }
            signers[i] = signer;
        }
        
        usedFingerprints[_clickFingerprint] = true;

        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.active, "Campaign is not active");
        require(campaign.remainingBudget >= campaign.costPerClick, "Campaign budget exhausted");
        
        uint256 payoutAmount = campaign.costPerClick;
        campaign.remainingBudget -= payoutAmount;
        campaign.totalClicks += 1;
        
        // Withdraw from vault with slippage protection and fallback
        uint256 sharesRedeemed = _withdrawFromVault(payoutAmount);
        
        // Update campaign shares
        if (campaign.vaultShares >= sharesRedeemed) {
            campaign.vaultShares -= sharesRedeemed;
        } else {
            campaign.vaultShares = 0;
        }
        
        // Split payout
        uint256 platformFee = (payoutAmount * platformFeeBps) / BASIS_POINTS;
        uint256 distributeAmount = payoutAmount - platformFee;
        
        // Transfer platform fee
        if (platformFee > 0) {
            require(usdcToken.transfer(platformWallet, platformFee), "Platform fee transfer failed");
        }
        
        SplitShare[] storage splits = campaignSplits[_campaignId];
        for (uint256 i = 0; i < splits.length; i++) {
            uint256 recipientAmount = (distributeAmount * splits[i].shareBps) / BASIS_POINTS;
            if (recipientAmount > 0) {
                require(usdcToken.transfer(splits[i].recipient, recipientAmount), "Recipient payment failed");
                emit RecipientPaid(_campaignId, splits[i].recipient, recipientAmount);
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
                    require(usdcToken.transfer(campaign.advertiser, refundAmount), "Refund failed");
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
    ) external {
        require(isOracleNode[msg.sender] || msg.sender == owner, "Only authorized settler can call");
        require(_campaignIds.length == _creators.length, "Mismatched campaigns and creators");
        require(_creators.length == _amounts.length, "Mismatched creators and amounts");

        for (uint256 i = 0; i < _campaignIds.length; i++) {
            bytes32 campaignId = _campaignIds[i];
            address creator = _creators[i];
            uint256 amount = _amounts[i];
            
            if (amount == 0) continue;

            Campaign storage campaign = campaigns[campaignId];
            require(campaign.active, "Campaign is not active");
            require(campaign.remainingBudget >= amount, "Campaign budget exhausted");

            campaign.remainingBudget -= amount;
            campaign.totalClicks += 1;
            
            // Withdraw from vault
            uint256 sharesRedeemed = _withdrawFromVault(amount);
            
            if (campaign.vaultShares >= sharesRedeemed) {
                campaign.vaultShares -= sharesRedeemed;
            } else {
                campaign.vaultShares = 0;
            }

            // Split platform fee and recipient amount
            uint256 platformFee = (amount * platformFeeBps) / BASIS_POINTS;
            uint256 distributeAmount = amount - platformFee;

            if (platformFee > 0) {
                require(usdcToken.transfer(platformWallet, platformFee), "Platform fee transfer failed");
            }

            if (distributeAmount > 0) {
                require(usdcToken.transfer(creator, distributeAmount), "Creator payment failed");
                emit RecipientPaid(campaignId, creator, distributeAmount);
            }

            emit RevenueSplitExecuted(campaignId, amount, platformFee, distributeAmount);

            if (campaign.remainingBudget < campaign.costPerClick) {
                campaign.active = false;
                
                uint256 remainingShares = campaign.vaultShares;
                campaign.vaultShares = 0;
                campaign.remainingBudget = 0;
                
                uint256 refundAmount = 0;
                if (remainingShares > 0) {
                    refundAmount = _redeemFromVault(remainingShares);
                    if (refundAmount > 0) {
                        require(usdcToken.transfer(campaign.advertiser, refundAmount), "Refund failed");
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
        require(sig.length == 65, "Invalid signature length");

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }
    
    /**
     * @notice Emergency withdraw for Advertiser to pause and recoup remaining campaign funds immediately.
     */
    function withdrawRemainingBudget(bytes32 _campaignId) external {
        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.advertiser == msg.sender, "Only advertiser can withdraw");
        require(campaign.active, "Campaign is not active");
        
        uint256 refundShares = campaign.vaultShares;
        campaign.remainingBudget = 0;
        campaign.vaultShares = 0;
        campaign.active = false;
        
        uint256 refundAmount = 0;
        if (refundShares > 0) {
            refundAmount = _redeemFromVault(refundShares);
            if (refundAmount > 0) {
                require(usdcToken.transfer(msg.sender, refundAmount), "Withdraw refund failed");
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
        address[] memory recipients = new address[](splits.length);
        uint256[] memory shares = new uint256[](splits.length);
        for (uint256 i = 0; i < splits.length; i++) {
            recipients[i] = splits[i].recipient;
            shares[i] = splits[i].shareBps;
        }
        return (recipients, shares);
    }
}
