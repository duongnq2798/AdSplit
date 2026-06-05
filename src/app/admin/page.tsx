"use client";

import React, { useState, useEffect } from "react";
import { 
  createPublicClient, 
  createWalletClient, 
  custom, 
  http, 
  parseUnits, 
  formatUnits,
  getAddress
} from "viem";
import { arcTestnet } from "viem/chains";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { 
  ShieldAlert, 
  ShieldCheck, 
  Play, 
  Pause, 
  Coins, 
  UserCheck, 
  Plus, 
  Trash2, 
  RefreshCw, 
  ArrowLeft,
  Settings,
  AlertTriangle
} from "lucide-react";

// Standard ABI for AdRevenueSplitter Administrative Panel
const ADMIN_ABI = [
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "paused",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "_node", type: "address" }],
    name: "addOracleNode",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "_node", type: "address" }],
    name: "removeOracleNode",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "_threshold", type: "uint256" }],
    name: "setOracleThreshold",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "oracleThreshold",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "_token", type: "address" }, { internalType: "bool", name: "_allowed", type: "bool" }],
    name: "setAllowedToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "_token", type: "address" }, { internalType: "address", name: "_vault", type: "address" }],
    name: "setTokenVault",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "_tokenAddress", type: "address" }, { internalType: "uint256", name: "_amount", type: "uint256" }],
    name: "emergencySweepToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "allowedTokens",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "tokenVaults",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "platformWallet",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "platformFeeBps",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

const DEFAULT_CONTRACT_ADDRESS = "0xE75D12e1E29370A0346A25D5ef371B2B990a3c91";
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

export default function AdminPage() {
  const { address: userAddress, isConnected: walletConnected } = useAccount();

  // Contract Address input
  const [contractAddress, setContractAddress] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("adsplit_contract_address") || DEFAULT_CONTRACT_ADDRESS;
    }
    return DEFAULT_CONTRACT_ADDRESS;
  });

  // Save contract address to localStorage
  useEffect(() => {
    localStorage.setItem("adsplit_contract_address", contractAddress);
  }, [contractAddress]);

  // Loading and feedback states
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  // Contract read parameters
  const [ownerAddress, setOwnerAddress] = useState<string>("");
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [threshold, setThreshold] = useState<number>(0);
  const [platformWallet, setPlatformWallet] = useState<string>("");
  const [platformFee, setPlatformFee] = useState<number>(0);
  
  // Custom token checking states
  const [usdcAllowed, setUsdcAllowed] = useState<boolean>(false);
  const [usdcVault, setUsdcVault] = useState<string>("");
  const [eurcAllowed, setEurcAllowed] = useState<boolean>(false);
  const [eurcVault, setEurcVault] = useState<string>("");

  // Form states
  const [oracleToAdd, setOracleToAdd] = useState("");
  const [oracleToRemove, setOracleToRemove] = useState("");
  const [newThreshold, setNewThreshold] = useState("");
  const [tokenToAllow, setTokenToAllow] = useState("");
  const [tokenAllowState, setTokenAllowState] = useState(true);
  const [vaultTokenAddress, setVaultTokenAddress] = useState("");
  const [vaultAddress, setVaultAddress] = useState("");
  const [sweepTokenAddress, setSweepTokenAddress] = useState("");
  const [sweepAmount, setSweepAmount] = useState("");

  // Auto show status messages
  const showFeedback = (msg: string, isError = false) => {
    setFeedback({ message: msg, isError });
    setTimeout(() => setFeedback(null), 6000);
  };

  // Get Viem Clients
  const getPublicClient = () => {
    return createPublicClient({
      chain: arcTestnet,
      transport: http("https://rpc.testnet.arc.network")
    });
  };

  const getWalletClient = async () => {
    if (!(window as any).ethereum) throw new Error("No web3 wallet detected.");
    return createWalletClient({
      chain: arcTestnet,
      transport: custom((window as any).ethereum)
    });
  };

  // Sync parameters from blockchain
  const syncContractState = async () => {
    if (!contractAddress.startsWith("0x") || contractAddress.length !== 42) {
      showFeedback("Invalid contract address structure", true);
      return;
    }
    setIsRefreshing(true);
    const client = getPublicClient();
    const formattedAddr = getAddress(contractAddress.trim());

    try {
      // Check if code exists
      const code = await client.getCode({ address: formattedAddr });
      if (!code || code === "0x") {
        showFeedback("No contract deployed at this address!", true);
        setIsRefreshing(false);
        return;
      }

      // Read state variables
      const [
        owner, 
        pausedState, 
        thresh, 
        platWallet, 
        platFee,
        usdcAllowVal,
        usdcVaultVal,
        eurcAllowVal,
        eurcVaultVal
      ] = await Promise.all([
        client.readContract({ address: formattedAddr, abi: ADMIN_ABI, functionName: "owner" }),
        client.readContract({ address: formattedAddr, abi: ADMIN_ABI, functionName: "paused" }),
        client.readContract({ address: formattedAddr, abi: ADMIN_ABI, functionName: "oracleThreshold" }),
        client.readContract({ address: formattedAddr, abi: ADMIN_ABI, functionName: "platformWallet" }),
        client.readContract({ address: formattedAddr, abi: ADMIN_ABI, functionName: "platformFeeBps" }),
        client.readContract({ address: formattedAddr, abi: ADMIN_ABI, functionName: "allowedTokens", args: [USDC_ADDRESS] }),
        client.readContract({ address: formattedAddr, abi: ADMIN_ABI, functionName: "tokenVaults", args: [USDC_ADDRESS] }),
        client.readContract({ address: formattedAddr, abi: ADMIN_ABI, functionName: "allowedTokens", args: [EURC_ADDRESS] }),
        client.readContract({ address: formattedAddr, abi: ADMIN_ABI, functionName: "tokenVaults", args: [EURC_ADDRESS] }),
      ]);

      setOwnerAddress(owner);
      setIsPaused(pausedState);
      setThreshold(Number(thresh));
      setPlatformWallet(platWallet);
      setPlatformFee(Number(platFee));
      setUsdcAllowed(usdcAllowVal);
      setUsdcVault(usdcVaultVal);
      setEurcAllowed(eurcAllowVal);
      setEurcVault(eurcVaultVal);

      showFeedback("Contract status refreshed successfully!");
    } catch (e: any) {
      console.error(e);
      showFeedback(`Failed to query contract state: ${e.message || e}`, true);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Run initial fetch on mount
  useEffect(() => {
    syncContractState();
  }, [contractAddress]);

  // Execute Write Transactions helper
  const handleWriteTx = async (funcName: string, args: any[], title: string) => {
    if (!walletConnected || !userAddress) {
      showFeedback("Please connect your wallet first!", true);
      return;
    }
    setTxPending(true);
    const formattedAddr = getAddress(contractAddress.trim());

    try {
      const walletClient = await getWalletClient();
      const publicClient = getPublicClient();

      const { request } = await publicClient.simulateContract({
        account: getAddress(userAddress),
        address: formattedAddr,
        abi: ADMIN_ABI,
        functionName: funcName as any,
        args: args as any
      });

      const hash = await walletClient.writeContract(request);
      showFeedback(`Transaction submitted: ${hash.substring(0, 15)}... Waiting confirmation.`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        showFeedback(`${title} completed successfully!`);
        await syncContractState();
      } else {
        showFeedback(`${title} transaction failed on-chain.`, true);
      }
    } catch (e: any) {
      console.error(e);
      let errMsg = e.message || String(e);
      if (errMsg.includes("UserOwner")) {
        errMsg = "OnlyOwner: Access denied. Connected wallet is not the contract owner.";
      }
      showFeedback(`${title} failed: ${errMsg}`, true);
    } finally {
      setTxPending(false);
    }
  };

  const isUserOwner = userAddress && ownerAddress && userAddress.toLowerCase() === ownerAddress.toLowerCase();

  return (
    <div className="flex flex-col min-h-screen text-[#4E3629] bg-[#FCFAF6] font-sans pb-16">
      {/* Top Banner Navigation */}
      <header className="border-b border-[#EADEC9] bg-white px-6 py-4 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <a href="/" className="flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 border-[#744D2B] bg-[#FCFAF6] hover:bg-[#F3EFE6] transition-colors text-sm font-semibold">
              <ArrowLeft className="w-4 h-4" /> Home Page
            </a>
            <div className="flex items-center gap-2">
              <Settings className="w-6 h-6 text-[#744D2B]" />
              <h1 className="text-xl font-bold tracking-tight text-[#744D2B]">AdSplit Protocol Admin Console</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ConnectButton showBalance={false} chainStatus="none" />
            <button 
              onClick={syncContractState}
              disabled={isRefreshing}
              className="p-2 rounded-xl border-2 border-[#EADEC9] hover:bg-[#FCFAF6] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 text-[#744D2B] ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 mt-8 flex-1 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Contract Configuration Status */}
        <div className="lg:col-span-1 space-y-6">
          
          {/* Custom Notification Box */}
          {feedback && (
            <div className={`p-4 rounded-xl border-2 ${feedback.isError ? "bg-red-50 border-red-400 text-red-800" : "bg-emerald-50 border-emerald-400 text-emerald-800"} flex items-start gap-3 shadow-md`}>
              {feedback.isError ? <ShieldAlert className="w-5 h-5 shrink-0" /> : <ShieldCheck className="w-5 h-5 shrink-0" />}
              <span className="text-sm font-medium">{feedback.message}</span>
            </div>
          )}

          {/* Connected Identity Box */}
          {!isUserOwner && walletConnected && (
            <div className="p-4 bg-[#FFF9EB] border-2 border-[#EAD2A8] rounded-2xl flex gap-3 text-[#7A5B18]">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold">Not Contract Owner</p>
                <p className="mt-1 opacity-90">Your wallet is connected but you are not the owner. Administrative functions will fail execution unless authorized.</p>
              </div>
            </div>
          )}

          {/* Configuration Parameters Panel */}
          <div className="p-6 bg-white border-3 border-[#744D2B] rounded-3xl shadow-sm space-y-6">
            <h2 className="text-lg font-bold border-b border-[#FCFAF6] pb-3 text-[#744D2B]">Escrow Contract Setup</h2>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-[#A89880] uppercase">Target Contract Address</label>
                <input 
                  type="text" 
                  value={contractAddress}
                  onChange={(e) => setContractAddress(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm rounded-xl border-2 border-[#EADEC9] bg-[#FCFAF6] text-[#4E3629] focus:outline-none focus:border-[#744D2B]" 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs font-bold text-[#A89880] uppercase">Contract State</span>
                  <div className="mt-1 flex items-center gap-2">
                    {isPaused ? (
                      <span className="px-3 py-1 text-xs font-bold rounded-lg border-2 border-red-500 bg-red-50 text-red-700">PAUSED</span>
                    ) : (
                      <span className="px-3 py-1 text-xs font-bold rounded-lg border-2 border-emerald-500 bg-emerald-50 text-emerald-700">ACTIVE</span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-bold text-[#A89880] uppercase">Consensus Quorum</span>
                  <p className="mt-1 font-bold text-lg">{threshold} Oracle Nodes</p>
                </div>
              </div>

              <div className="border-t border-[#FCFAF6] pt-4 space-y-3">
                <div>
                  <span className="text-xs font-bold text-[#A89880] uppercase">Contract Owner</span>
                  <p className="text-xs font-mono bg-[#FCFAF6] p-2 rounded-lg border border-[#EADEC9] break-all">{ownerAddress || "Loading..."}</p>
                </div>
                <div>
                  <span className="text-xs font-bold text-[#A89880] uppercase">Platform Wallet</span>
                  <p className="text-xs font-mono bg-[#FCFAF6] p-2 rounded-lg border border-[#EADEC9] break-all">{platformWallet || "Loading..."}</p>
                </div>
                <div>
                  <span className="text-xs font-bold text-[#A89880] uppercase">Platform Fee</span>
                  <p className="text-sm font-bold">{(platformFee / 100).toFixed(2)}% ({platformFee} bps)</p>
                </div>
              </div>
            </div>
          </div>

          {/* Dynamic Token States */}
          <div className="p-6 bg-white border-3 border-[#744D2B] rounded-3xl shadow-sm space-y-4">
            <h2 className="text-lg font-bold border-b border-[#FCFAF6] pb-2 text-[#744D2B]">Supported ERC-20 Tokens</h2>
            
            <div className="space-y-4 text-sm">
              <div className="p-3.5 bg-[#FCFAF6] rounded-2xl border-2 border-[#EADEC9] space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold flex items-center gap-1.5"><Coins className="w-4 h-4 text-blue-500" /> USDC</span>
                  {usdcAllowed ? (
                    <span className="text-xs font-bold text-emerald-600">ALLOWED</span>
                  ) : (
                    <span className="text-xs font-bold text-red-500">DISABLED</span>
                  )}
                </div>
                <div className="text-xs">
                  <p className="text-[#A89880] font-medium">Yield Vault Address:</p>
                  <p className="font-mono text-[10px] break-all text-slate-500">{usdcVault === "0x0000000000000000000000000000000000000000" ? "None" : usdcVault}</p>
                </div>
              </div>

              <div className="p-3.5 bg-[#FCFAF6] rounded-2xl border-2 border-[#EADEC9] space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold flex items-center gap-1.5"><Coins className="w-4 h-4 text-emerald-600" /> EURC</span>
                  {eurcAllowed ? (
                    <span className="text-xs font-bold text-emerald-600">ALLOWED</span>
                  ) : (
                    <span className="text-xs font-bold text-red-500">DISABLED</span>
                  )}
                </div>
                <div className="text-xs">
                  <p className="text-[#A89880] font-medium">Yield Vault Address:</p>
                  <p className="font-mono text-[10px] break-all text-slate-500">{eurcVault === "0x0000000000000000000000000000000000000000" ? "None" : eurcVault}</p>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Columns: Administrative Controls */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Pause / Unpause Global Switch */}
          <div className="p-6 bg-white border-3 border-[#744D2B] rounded-3xl shadow-sm">
            <h3 className="text-lg font-bold text-[#744D2B] mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" /> Emergency Circuit Breaker
            </h3>
            <p className="text-xs text-[#A89880] mb-4">Pausing the contract prevents all campaign creations, batch payouts, and client telemetry signature processing instantly. Advertisers are still allowed to recoup remaining funds.</p>
            
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-between p-4 bg-[#FCFAF6] border-2 border-[#EADEC9] rounded-2xl">
              <div>
                <p className="text-sm font-bold">Current State: {isPaused ? "Paused" : "Fully Operational"}</p>
                <p className="text-xs opacity-75 mt-0.5">Toggle requires owner approval signature</p>
              </div>

              {isPaused ? (
                <button 
                  onClick={() => handleWriteTx("unpause", [], "Unpause Protocol")}
                  disabled={txPending}
                  className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-white" /> Activate Protocol (Unpause)
                </button>
              ) : (
                <button 
                  onClick={() => handleWriteTx("pause", [], "Pause Protocol")}
                  disabled={txPending}
                  className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                >
                  <Pause className="w-4 h-4 fill-white" /> Pause Protocol Operations
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Oracle Node Management */}
            <div className="p-6 bg-white border-3 border-[#744D2B] rounded-3xl shadow-sm space-y-4">
              <h3 className="text-md font-bold text-[#744D2B] flex items-center gap-1.5"><UserCheck className="w-4 h-4" /> Oracle Node Registry</h3>
              
              <div className="space-y-4">
                {/* Add Oracle Node */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#A89880]">Add Oracle Node Address</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="0x..."
                      value={oracleToAdd}
                      onChange={(e) => setOracleToAdd(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border-2 border-[#EADEC9] bg-[#FCFAF6] text-[#4E3629] focus:outline-none focus:border-[#744D2B]"
                    />
                    <button 
                      onClick={() => handleWriteTx("addOracleNode", [oracleToAdd.trim()], "Add Oracle Node")}
                      disabled={txPending || !oracleToAdd}
                      className="px-3 py-1.5 bg-[#744D2B] hover:bg-[#5C3D22] text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Remove Oracle Node */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#A89880]">Remove Oracle Node Address</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="0x..."
                      value={oracleToRemove}
                      onChange={(e) => setOracleToRemove(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border-2 border-[#EADEC9] bg-[#FCFAF6] text-[#4E3629] focus:outline-none focus:border-[#744D2B]"
                    />
                    <button 
                      onClick={() => handleWriteTx("removeOracleNode", [oracleToRemove.trim()], "Remove Oracle Node")}
                      disabled={txPending || !oracleToRemove}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Update Threshold */}
                <div className="space-y-1 pt-2 border-t border-[#FCFAF6]">
                  <label className="text-xs font-bold text-[#A89880]">Update Threshold (Quorum count)</label>
                  <div className="flex gap-2">
                    <input 
                      type="number" 
                      placeholder="e.g. 2"
                      value={newThreshold}
                      onChange={(e) => setNewThreshold(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border-2 border-[#EADEC9] bg-[#FCFAF6] text-[#4E3629] focus:outline-none focus:border-[#744D2B]"
                    />
                    <button 
                      onClick={() => handleWriteTx("setOracleThreshold", [BigInt(newThreshold)], "Set Consensus Threshold")}
                      disabled={txPending || !newThreshold}
                      className="px-3 py-1.5 bg-[#744D2B] hover:bg-[#5C3D22] text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                    >
                      Set
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Token & Vault Allowances */}
            <div className="p-6 bg-white border-3 border-[#744D2B] rounded-3xl shadow-sm space-y-4">
              <h3 className="text-md font-bold text-[#744D2B] flex items-center gap-1.5"><Coins className="w-4 h-4" /> Multi-Token Configuration</h3>
              
              <div className="space-y-4">
                {/* Toggle Token Allowance */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[#A89880]">Set Token Allowance State</label>
                  <div className="flex gap-2 items-center">
                    <input 
                      type="text" 
                      placeholder="Token address (0x...)"
                      value={tokenToAllow}
                      onChange={(e) => setTokenToAllow(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border-2 border-[#EADEC9] bg-[#FCFAF6] text-[#4E3629] focus:outline-none focus:border-[#744D2B]"
                    />
                    <select 
                      value={tokenAllowState ? "true" : "false"}
                      onChange={(e) => setTokenAllowState(e.target.value === "true")}
                      className="px-2 py-1.5 text-xs rounded-lg border-2 border-[#EADEC9] bg-[#FCFAF6] text-[#4E3629]"
                    >
                      <option value="true">Allow</option>
                      <option value="false">Block</option>
                    </select>
                    <button 
                      onClick={() => handleWriteTx("setAllowedToken", [tokenToAllow.trim(), tokenAllowState], "Set Token Allowed")}
                      disabled={txPending || !tokenToAllow}
                      className="px-3 py-1.5 bg-[#744D2B] hover:bg-[#5C3D22] text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                    >
                      Set
                    </button>
                  </div>
                </div>

                {/* Set Token Vault mapping */}
                <div className="space-y-2 pt-2 border-t border-[#FCFAF6]">
                  <label className="text-xs font-bold text-[#A89880]">Link Token to ERC-4626 Vault</label>
                  <div className="space-y-2">
                    <input 
                      type="text" 
                      placeholder="Token address (0x...)"
                      value={vaultTokenAddress}
                      onChange={(e) => setVaultTokenAddress(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border-2 border-[#EADEC9] bg-[#FCFAF6] text-[#4E3629] focus:outline-none focus:border-[#744D2B]"
                    />
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="Vault address (0x...)"
                        value={vaultAddress}
                        onChange={(e) => setVaultAddress(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs rounded-lg border-2 border-[#EADEC9] bg-[#FCFAF6] text-[#4E3629] focus:outline-none focus:border-[#744D2B]"
                      />
                      <button 
                        onClick={() => handleWriteTx("setTokenVault", [vaultTokenAddress.trim(), vaultAddress.trim()], "Set Token Vault")}
                        disabled={txPending || !vaultTokenAddress || !vaultAddress}
                        className="px-3 py-1.5 bg-[#744D2B] hover:bg-[#5C3D22] text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                      >
                        Link
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Emergency Tokens Sweep */}
          <div className="p-6 bg-white border-3 border-[#744D2B] rounded-3xl shadow-sm">
            <h3 className="text-lg font-bold text-red-600 mb-2 flex items-center gap-1.5">
              <ShieldAlert className="w-5 h-5" /> Emergency Escrow Recovery (Sweep)
            </h3>
            <p className="text-xs text-[#A89880] mb-4">Allows the owner to recoup any locked advertising funds or sweep misrouted ERC-20 tokens immediately to the contract owner address in case of emergency issues.</p>
            
            <div className="flex flex-col md:flex-row gap-3">
              <input 
                type="text" 
                placeholder="ERC-20 Token address (0x...)"
                value={sweepTokenAddress}
                onChange={(e) => setSweepTokenAddress(e.target.value)}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl border-2 border-[#EADEC9] bg-[#FCFAF6] text-[#4E3629] focus:outline-none focus:border-[#744D2B]"
              />
              <input 
                type="text" 
                placeholder="Amount (6-decimals micro units)"
                value={sweepAmount}
                onChange={(e) => setSweepAmount(e.target.value)}
                className="w-full md:w-64 px-4 py-2.5 text-sm rounded-xl border-2 border-[#EADEC9] bg-[#FCFAF6] text-[#4E3629] focus:outline-none focus:border-[#744D2B]"
              />
              <button 
                onClick={() => handleWriteTx("emergencySweepToken", [sweepTokenAddress.trim(), BigInt(sweepAmount)], "Sweep Token Balance")}
                disabled={txPending || !sweepTokenAddress || !sweepAmount}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 shrink-0"
              >
                Sweep Balance
              </button>
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}
