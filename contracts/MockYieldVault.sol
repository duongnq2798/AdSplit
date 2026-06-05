// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AdRevenueSplitter.sol";

interface IMockERC20 {
    function mint(address to, uint256 amount) external;
}

contract MockYieldVault {
    IERC20 public immutable underlying;
    
    string public name = "Mock Yield Vault";
    string public symbol = "mYV";
    uint8 public decimals = 6;
    
    uint256 public totalShares;
    mapping(address => uint256) public shareBalances;
    
    // Track initial timestamp to simulate 10% APY
    uint256 public immutable startTimestamp;
    uint256 public constant YEAR = 365 days;
    
    constructor(address _underlying) {
        underlying = IERC20(_underlying);
        startTimestamp = block.timestamp;
    }
    
    function asset() external view returns (address) {
        return address(underlying);
    }
    
    // Calculate current rate: 1 share = 1 * (1 + 0.10 * elapsed / YEAR) assets
    // assets = shares * getRate() / 1e18
    function getRate() public view returns (uint256) {
        uint256 elapsed = block.timestamp - startTimestamp;
        // 1e18 is 1.0. 10% APY means rate increases by 0.10 per year
        // rate = 1e18 + (1e17 * elapsed) / YEAR
        return 1e18 + (1e17 * elapsed) / YEAR;
    }
    
    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * getRate()) / 1e18;
    }
    
    function convertToShares(uint256 assets) public view returns (uint256) {
        return (assets * 1e18) / getRate();
    }
    
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }
    
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }
    
    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }
    
    function deposit(uint256 assets, address receiver) external returns (uint256) {
        uint256 shares = convertToShares(assets);
        require(shares > 0, "Zero shares");
        
        require(underlying.transferFrom(msg.sender, address(this), assets), "Transfer failed");
        
        totalShares += shares;
        shareBalances[receiver] += shares;
        
        return shares;
    }
    
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256) {
        uint256 shares = convertToShares(assets);
        require(shareBalances[owner] >= shares, "Insufficient balance");
        
        // Self-funding: mint missing USDC to simulate yield backing
        uint256 currentBalance = underlying.balanceOf(address(this));
        if (currentBalance < assets) {
            try IMockERC20(address(underlying)).mint(address(this), assets - currentBalance) {} catch {}
        }
        
        shareBalances[owner] -= shares;
        totalShares -= shares;
        
        require(underlying.transfer(receiver, assets), "Transfer failed");
        
        return shares;
    }
    
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256) {
        require(shareBalances[owner] >= shares, "Insufficient balance");
        uint256 assets = convertToAssets(shares);
        
        // Self-funding: mint missing USDC to simulate yield backing
        uint256 currentBalance = underlying.balanceOf(address(this));
        if (currentBalance < assets) {
            try IMockERC20(address(underlying)).mint(address(this), assets - currentBalance) {} catch {}
        }
        
        shareBalances[owner] -= shares;
        totalShares -= shares;
        
        require(underlying.transfer(receiver, assets), "Transfer failed");
        
        return assets;
    }
    
    function balanceOf(address account) external view returns (uint256) {
        return shareBalances[account];
    }
    
    function totalSupply() external view returns (uint256) {
        return totalShares;
    }
}
