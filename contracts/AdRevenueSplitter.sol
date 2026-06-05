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
 * @title AdRevenueSplitter
 * @notice Decentralized Ad Escrow & Automated Multi-Recipient Revenue Splitter on Arc L1.
 * USDC is the native gas token, but we also interact with ERC-20 USDC (6 decimals).
 */
contract AdRevenueSplitter {
    
    IERC20 public immutable usdcToken;
    address public owner;
    address public oracleNode;
    
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

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call");
        _;
    }
    
    modifier onlyOracle() {
        require(msg.sender == oracleNode, "Only fraud detection oracle can call");
        _;
    }
    
    constructor(address _usdcToken, address _oracleNode, address _platformWallet) {
        require(_usdcToken != address(0), "Invalid token address");
        require(_oracleNode != address(0), "Invalid oracle address");
        require(_platformWallet != address(0), "Invalid platform wallet");
        
        usdcToken = IERC20(_usdcToken);
        oracleNode = _oracleNode;
        platformWallet = _platformWallet;
        owner = msg.sender;
    }
    
    /**
     * @notice Set the Oracle node address that reports fraud-free user engagements.
     */
    function setOracleNode(address _oracleNode) external onlyOwner {
        require(_oracleNode != address(0), "Invalid address");
        emit OracleUpdated(oracleNode, _oracleNode);
        oracleNode = _oracleNode;
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
            active: true
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
    
    /**
     * @notice Distributes payout for a single click instantly to dynamic recipients.
     * Called by any relayer or account with a valid signature from the Fraud Detection Oracle.
     */
    function recordEngagement(
        bytes32 _campaignId, 
        bytes32 _clickFingerprint, 
        bytes calldata _signature
    ) external {
        require(!usedFingerprints[_clickFingerprint], "Fingerprint already used");
        
        // Compute EIP-191 message hash
        bytes32 messageHash = keccak256(abi.encodePacked(_campaignId, _clickFingerprint));
        bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        // Recover signer address
        address signer = recoverSigner(ethSignedMessageHash, _signature);
        require(signer == oracleNode, "Invalid oracle signature");
        
        usedFingerprints[_clickFingerprint] = true;

        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.active, "Campaign is not active");
        require(campaign.remainingBudget >= campaign.costPerClick, "Campaign budget exhausted");
        
        uint256 payoutAmount = campaign.costPerClick;
        campaign.remainingBudget -= payoutAmount;
        campaign.totalClicks += 1;
        
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
            emit CampaignClosed(_campaignId, campaign.remainingBudget);
            
            // Refund any tiny remaining balance (dust) to advertiser
            if (campaign.remainingBudget > 0) {
                uint256 dustRefund = campaign.remainingBudget;
                campaign.remainingBudget = 0;
                require(usdcToken.transfer(campaign.advertiser, dustRefund), "Refund failed");
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
        require(campaign.remainingBudget > 0, "No funds left in campaign");
        
        uint256 refundAmount = campaign.remainingBudget;
        campaign.remainingBudget = 0;
        campaign.active = false;
        
        require(usdcToken.transfer(msg.sender, refundAmount), "Withdraw refund failed");
        emit CampaignClosed(_campaignId, refundAmount);
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
