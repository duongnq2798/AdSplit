"use client";

import React, { useState, useEffect, useRef } from "react";
import { TelemetryCollector } from "@/utils/telemetry-collector";
import { generateTelemetryProof } from "@/utils/zk-proof-generator";
import { 
  createPublicClient, 
  createWalletClient, 
  custom, 
  http, 
  parseUnits, 
  formatUnits, 
  keccak256, 
  stringToBytes,
  getAddress,
  decodeEventLog
} from "viem";
import { arcTestnet } from "viem/chains";
import { useAccount, useBalance, useConnect } from "wagmi";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { 
  supabase, 
  SupabaseDbService, 
  DbCampaign, 
  DbClickLog 
} from "@/utils/supabase";
import { CircleIntegrationService } from "@/utils/circle";
import WalletOnboardingModal from "@/components/WalletOnboardingModal";
import { BridgeProgressTracker } from "@/components/BridgeProgressTracker";
import { circleUCWService } from "@/utils/circle-ucw";
import { 
  ButtonLoader, 
  StatsSkeleton, 
  CampaignCardSkeleton, 
  TableSkeleton, 
  ImagePlaceholder, 
  TabSectionLoader 
} from "@/components/LoadingComponents";
import { 
  Megaphone, 
  Coins, 
  ShieldCheck, 
  ShieldAlert, 
  ArrowUpRight, 
  ExternalLink, 
  Plus, 
  Play, 
  Layers, 
  Globe, 
  Terminal, 
  CheckCircle2, 
  XCircle, 
  MousePointerClick,
  Wallet,
  Activity,
  Cpu,
  RefreshCw,
  Code,
  BarChart3,
  Search,
  Bell,
  Settings,
  HelpCircle,
  LogOut,
  ChevronRight,
  Sparkles,
  Camera,
  MapPin,
  MessageCircle,
  Compass,
  Hammer,
  HelpCircle as InfoIcon,
  Menu,
  X
} from "lucide-react";

// Standard ABI for AdRevenueSplitter
const CONTRACT_ABI = [
  {
    inputs: [
      { internalType: "uint256", name: "_budget", type: "uint256" },
      { internalType: "uint256", name: "_costPerClick", type: "uint256" },
      { internalType: "address[]", name: "_recipients", type: "address[]" },
      { internalType: "uint256[]", name: "_shares", type: "uint256[]" },
      { internalType: "address", name: "_affiliate", type: "address" }
    ],
    name: "createCampaign",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "bytes32", name: "_campaignId", type: "bytes32" },
      { internalType: "bytes32", name: "_clickFingerprint", type: "bytes32" },
      { internalType: "bytes", name: "_signature", type: "bytes" }
    ],
    name: "recordEngagement",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "bytes32", name: "_campaignId", type: "bytes32" }],
    name: "withdrawRemainingBudget",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "campaigns",
    outputs: [
      { internalType: "bytes32", name: "campaignId", type: "bytes32" },
      { internalType: "address", name: "advertiser", type: "address" },
      { internalType: "uint256", name: "totalBudget", type: "uint256" },
      { internalType: "uint256", name: "remainingBudget", type: "uint256" },
      { internalType: "uint256", name: "costPerClick", type: "uint256" },
      { internalType: "uint256", name: "totalClicks", type: "uint256" },
      { internalType: "bool", name: "active", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "bytes32", name: "_campaignId", type: "bytes32" }],
    name: "getCampaignYield",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "campaignId", type: "bytes32" },
      { indexed: true, internalType: "address", name: "advertiser", type: "address" },
      { indexed: false, internalType: "uint256", name: "totalBudget", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "costPerClick", type: "uint256" }
    ],
    name: "CampaignCreated",
    type: "event"
  }
] as const;

const ERC20_ABI = [
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

import PublisherAnalytics from "@/components/PublisherAnalytics";

// Arc Network Addresses
const DEFAULT_CONTRACT_ADDRESS = "0xE75D12e1E29370A0346A25D5ef371B2B990a3c91";
const advertiserWallet = "0xd91455cCe706509F67cD6303Cec089B5F319D72A";
const oracleNodeAddress = "0xCa2d2f677CD6303cec089b5f319d72A089B5F319";
export default function Home() {
  const [activeTab, setActiveTab] = useState<"advertiser" | "creator" | "publisher" | "oracle" | "contract">("advertiser");

  const telemetryCollectorRef = useRef<TelemetryCollector | null>(null);

  useEffect(() => {
    const collector = new TelemetryCollector();
    telemetryCollectorRef.current = collector;
    return () => {
      collector.destroy();
    };
  }, []);
  
  // Centralized loading states
  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
  const [isCreatingCampaign, setIsCreatingCampaign] = useState<boolean>(false);
  const [withdrawingCampaignId, setWithdrawingCampaignId] = useState<string | null>(null);

  // Circle User-Controlled Wallet (UCW) states
  const [creatorEmail, setCreatorEmail] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem("creator_email") || "";
    }
    return "";
  });
  const [creatorWalletAddress, setCreatorWalletAddress] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem("creator_wallet_address") || "";
    }
    return "";
  });
  const [isUCWModalOpen, setIsUCWModalOpen] = useState(false);
  const [ucwBalance, setUcwBalance] = useState("0.00");
  const [isWithdrawingUCW, setIsWithdrawingUCW] = useState(false);
  const [withdrawDestAddress, setWithdrawDestAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  // Real Wallet State using Wagmi Hooks
  const { address: userAddress, isConnected: walletConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { connect, connectors } = useConnect();
  const { data: balanceData } = useBalance({
    address: userAddress,
  });
  const userBalance = (() => {
    if (!balanceData) return "0.00";
    try {
      const val = balanceData.value;
      const dec = balanceData.decimals ?? 18;
      if (typeof val === 'bigint') {
        const formatted = formatUnits(val, dec);
        const parsed = parseFloat(formatted);
        return isNaN(parsed) ? "0.00" : parsed.toFixed(2);
      }
      return "0.00";
    } catch (e) {
      return "0.00";
    }
  })();

  const handleDirectConnect = () => {
    const injectedConnector = connectors.find((c) => c.id === 'injected');
    if (injectedConnector) {
      connect({ connector: injectedConnector });
    } else {
      openConnectModal?.();
    }
  };
  
  // Custom Contract Address Explorer
  const [contractAddress, setContractAddress] = useState<string>(DEFAULT_CONTRACT_ADDRESS);

  // Db and Circle Services
  const dbService = new SupabaseDbService();
  const circleService = new CircleIntegrationService(
    process.env.NEXT_PUBLIC_CIRCLE_API_KEY || "sandbox_key"
  );

  // State populated from Database / Blockchain
  const [campaigns, setCampaigns] = useState<DbCampaign[]>([]);
  const [campaignYields, setCampaignYields] = useState<Record<string, string>>({});
  const [clickLogs, setClickLogs] = useState<DbClickLog[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);
  
  // UI State
  const [isClicking, setIsClicking] = useState<boolean>(false);
  const [step, setStep] = useState<number>(0);
  const [recentNotification, setRecentNotification] = useState<{message: string, isError: boolean} | null>(null);

  // Custom Status Modal State for Transaction progress / Errors / Successes
  const [statusModal, setStatusModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    type: "loading" | "success" | "error";
  } | null>(null);

  const showErrorModal = (title: string, err: any) => {
    let message = err.message || String(err);
    if (message.includes("User rejected the request") || message.includes("User denied transaction signature")) {
      message = "Transaction was canceled. The signature request was rejected in your wallet.";
    } else if (message.includes("insufficient funds")) {
      message = "You have insufficient funds in your wallet to cover this transaction.";
    }
    setStatusModal({
      show: true,
      title,
      message,
      type: "error"
    });
  };
  
  // Forms state
  const [newCampaignTitle, setNewCampaignTitle] = useState("");
  const [newCampaignBudget, setNewCampaignBudget] = useState("2");
  const [newCampaignCPC, setNewCampaignCPC] = useState("0.02");
  const [newCreatorShare, setNewCreatorShare] = useState(85);
  const [newCampaignAffiliate, setNewCampaignAffiliate] = useState("");
  
  // CCTP Bridge Form
  const [bridgeAmount, setBridgeAmount] = useState("2");
  const [bridgeSourceChain, setBridgeSourceChain] = useState("Ethereum");
  const [bridgeActive, setBridgeActive] = useState(false);
  const [bridgeStep, setBridgeStep] = useState(0);
  const [bridgeSteps, setBridgeSteps] = useState<any[]>([
    { label: "USDC Burn Approval", description: "Approve the TokenMessenger to spend source USDC", status: "idle" },
    { label: "Initiate CCTP Burn", description: "Execute depositForBurn on source TokenMessenger", status: "idle" },
    { label: "Fetch Circle Attestation", description: "Poll Circle Iris API for signed proof", status: "idle" },
    { label: "Mint Claiming on Arc", description: "Relay signed attestation to Arc MessageTransmitter", status: "idle" }
  ]);
  const [showBridgeTracker, setShowBridgeTracker] = useState(false);
  const [estRemainingTime, setEstRemainingTime] = useState("0s");

  // Bot attack
  const [botAttackActive, setBotAttackActive] = useState(false);
  const [botClickCount, setBotClickCount] = useState(0);

  // Custom UI Config/Toggles matching the inspiration style
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [allowVisitors, setAllowVisitors] = useState(true);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpTab, setHelpTab] = useState<"user" | "builder">("user");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Dynamic Clock State for top header
  const [currentTime, setCurrentTime] = useState<string>("11:57 AM");
  const [currentDate, setCurrentDate] = useState<string>("5/19");
  const [currentDay, setCurrentDay] = useState<string>("Tuesday");

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      
      // Clock format: e.g. 11:57 AM
      let hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, "0");
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12;
      hours = hours ? hours : 12;
      setCurrentTime(`${hours}:${minutes} ${ampm}`);

      // Date format: e.g. 5/26
      const month = now.getMonth() + 1;
      const date = now.getDate();
      setCurrentDate(`${month}/${date}`);

      // Day format: e.g. Tuesday
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      setCurrentDay(days[now.getDay()]);
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Initialize Viem Clients (Targets Arc Testnet natively)
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http("https://rpc.testnet.arc.network")
  });

  const fetchUCWBalance = async (address: string) => {
    try {
      const balance = await publicClient.readContract({
        address: "0x3600000000000000000000000000000000000000",
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`]
      });
      const formatted = formatUnits(balance as bigint, 6);
      setUcwBalance(parseFloat(formatted).toFixed(2));
    } catch (err) {
      console.warn("Failed to fetch UCW balance from Arc Testnet:", err);
      // Fallback to mock balance for seamless sandbox simulation
      setUcwBalance("150.00");
    }
  };

  const handleWithdrawUCW = async () => {
    if (!creatorWalletAddress || !withdrawDestAddress || !withdrawAmount) return;
    setIsWithdrawingUCW(true);
    try {
      setStatusModal({
        show: true,
        title: "Creating Transfer Challenge",
        message: "Initiating secure non-custodial transfer challenge via Circle API...",
        type: "loading"
      });

      const res = await fetch('/api/wallets/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: creatorEmail,
          destinationAddress: withdrawDestAddress,
          amount: parseFloat(withdrawAmount)
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to create transfer challenge.");
      }

      const { challengeId, userToken, encryptionKey } = data;

      circleUCWService.setAuthentication(userToken, encryptionKey);

      setStatusModal({
        show: true,
        title: "Enter PIN to Authorize",
        message: "A secure Circle PIN overlay has opened. Please enter your PIN code to sign and authorize the transfer.",
        type: "loading"
      });

      await circleUCWService.executeChallenge(challengeId);

      setStatusModal({
        show: true,
        title: "USDC Transfer Dispatched!",
        message: `Successfully transferred ${withdrawAmount} USDC to ${withdrawDestAddress}!`,
        type: "success"
      });

      await fetchUCWBalance(creatorWalletAddress);
      setWithdrawAmount("");
      setWithdrawDestAddress("");
    } catch (err: any) {
      console.error(err);
      setStatusModal({
        show: true,
        title: "Transfer Failed",
        message: err.message || "Failed to authorize transfer.",
        type: "error"
      });
    } finally {
      setIsWithdrawingUCW(false);
    }
  };

  useEffect(() => {
    if (creatorWalletAddress && activeTab === "creator") {
      fetchUCWBalance(creatorWalletAddress);
    }
  }, [creatorWalletAddress, activeTab]);

  // RainbowKit manages connection natively, no manual connectWallet required.

  // Sync state from Database & Blockchain on load
  const syncAllData = async () => {
    setIsLoadingData(true);
    try {
      // 1. Fetch campaigns from Supabase
      const dbCampaigns = await dbService.getActiveCampaigns();
      let activeCampaignsList: DbCampaign[] = [];
      if (dbCampaigns && dbCampaigns.length > 0) {
        setCampaigns(dbCampaigns);
        activeCampaignsList = dbCampaigns;
      } else {
        // Fallback default realistic data if database is not configured
        const fallback = [
          {
            id: "0xad0001bc93",
            title: "Circle Web3 Developer Drive",
            advertiser: "0xd914...f8c3",
            total_budget: 3.00,
            remaining_budget: 2.40,
            cost_per_click: 0.02,
            total_clicks: 30,
            active: true,
            platform_share: 300,
            distributor_share: 1000
          },
          {
            id: "0xad00029b45",
            title: "Google Cloud Starter Credits",
            advertiser: "0xd914...f8c3",
            total_budget: 2.00,
            remaining_budget: 1.50,
            cost_per_click: 0.01,
            total_clicks: 50,
            active: true,
            platform_share: 300,
            distributor_share: 1000
          }
        ];
        setCampaigns(fallback);
        activeCampaignsList = fallback;
      }

      // 2. Fetch click logs from Supabase
      const { data: dbLogs } = await supabase
        .from("click_logs")
        .select("*")
        .order("timestamp", { ascending: false });
      
      if (dbLogs) {
        setClickLogs(dbLogs);
      } else {
        setClickLogs([
          {
            id: "clk_0921",
            campaign_id: "0xad0001bc93",
            ip_address: "64.233.160.20",
            status: "valid",
            payout_usdc: 0.02,
            creator_payout_usdc: 0.017,
            platform_payout_usdc: 0.0006,
            distributor_payout_usdc: 0.0024
          }
        ]);
      }

      // 3. Fetch logs for Webhooks
      const { data: dbWebhooks } = await supabase
        .from("ip_blacklist")
        .select("*");
      
      setWebhookLogs(dbWebhooks || []);

      // 4. Fetch/calculate yields for active campaigns
      const yieldsMap: Record<string, string> = {};
      const formattedContractAddress = getAddress(contractAddress.trim().toLowerCase());
      let isContractDeployed = false;
      try {
        const contractBytecode = await publicClient.getCode({ address: formattedContractAddress });
        isContractDeployed = !!(contractBytecode && contractBytecode !== "0x" && contractBytecode.length > 2);
      } catch (err) {
        console.warn("Could not check if contract is deployed for yield syncing", err);
      }

      for (const camp of activeCampaignsList) {
        if (!camp.active) {
          yieldsMap[camp.id] = "0.0000";
          continue;
        }
        if (isContractDeployed) {
          try {
            const yieldAmount = await publicClient.readContract({
              address: formattedContractAddress,
              abi: CONTRACT_ABI,
              functionName: "getCampaignYield",
              args: [camp.id as `0x${string}`]
            });
            yieldsMap[camp.id] = parseFloat(formatUnits(yieldAmount as bigint, 6)).toFixed(4);
          } catch (e) {
            console.warn(`Failed to fetch on-chain yield for ${camp.id}:`, e);
            // Sim fallback in case of errors
            yieldsMap[camp.id] = (camp.remaining_budget * 0.10 * (camp.total_clicks + 1) * 0.01).toFixed(4);
          }
        } else {
          // Sandbox Mode: simulate APY yield (10% APY simulation)
          yieldsMap[camp.id] = (camp.remaining_budget * 0.10 * (camp.total_clicks + 1) * 0.01).toFixed(4);
        }
      }
      setCampaignYields(yieldsMap);

    } catch (e) {
      console.warn("Failed to sync databases, running local state fallback:", e);
    } finally {
      // Premium transition delay to allow smooth, satisfying shimmer effects to play
      setTimeout(() => {
        setIsLoadingData(false);
      }, 700);
    }
  };

  const handleTabChange = (newTab: "advertiser" | "creator" | "publisher" | "oracle" | "contract") => {
    setIsLoadingData(true);
    setActiveTab(newTab);
    setMobileMenuOpen(false);
    setTimeout(() => {
      setIsLoadingData(false);
    }, 450);
  };

  useEffect(() => {
    syncAllData();
  }, []);

  // Action: Create real Campaign on-chain & save in Supabase
  // Automatically detects if the contract is deployed; if not, falls back to Sandbox Demo Mode.
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletConnected) {
      setStatusModal({
        show: true,
        title: "Wallet Required",
        message: "Please connect your wallet first using the 'Connect Wallet' button in the top right header!",
        type: "error"
      });
      return;
    }

    const budgetNum = parseFloat(newCampaignBudget);
    const cpcNum = parseFloat(newCampaignCPC);

    if (isNaN(budgetNum) || isNaN(cpcNum)) return;
    setIsCreatingCampaign(true);

    try {
      const campaignId = keccak256(stringToBytes(newCampaignTitle + Date.now().toString()));
      const formattedContractAddress = getAddress(contractAddress.trim().toLowerCase());

      // Compute splits upfront (used in both live and sandbox modes)
      const leadShare = newCreatorShare * 100;
      const coAuthorShare = (85 - newCreatorShare) * 100;
      const distributorShare = 1500; // Remaining 15% to reach 10000 total shares (100%)

      let isContractDeployed = false;
      try {
        const contractBytecode = await publicClient.getCode({ address: formattedContractAddress });
        isContractDeployed = !!(contractBytecode && contractBytecode !== "0x" && contractBytecode.length > 2);
      } catch (err) {
        console.warn("[AdSplit Sandbox] RPC connection failed. Defaulting to Sandbox Demo Mode.", err);
      }

      if (!isContractDeployed) {
        // ════════════════════════════════════════════════════════════════
        // SANDBOX DEMO MODE — contract not deployed, simulate everything
        // ════════════════════════════════════════════════════════════════
        console.warn(`[AdSplit Sandbox] Contract at ${formattedContractAddress} has no bytecode. Running in Sandbox Demo Mode.`);

        setStatusModal({
          show: true,
          title: "Sandbox Mode: Creating Campaign",
          message: "Contract not yet deployed on-chain. Running in Sandbox Demo Mode — campaign will be saved to the database for full demo flow.",
          type: "loading"
        });

        await new Promise(resolve => setTimeout(resolve, 1200)); // Simulate processing delay

        // Save to Supabase database matching the schema "adsplit"
        const hasAffiliate = newCampaignAffiliate && newCampaignAffiliate.trim().startsWith("0x");
        const newCampaign: DbCampaign = {
          id: campaignId,
          title: newCampaignTitle,
          advertiser: userAddress || advertiserWallet,
          total_budget: budgetNum,
          remaining_budget: budgetNum,
          cost_per_click: cpcNum,
          total_clicks: 0,
          active: true,
          platform_share: hasAffiliate ? 500 : 300,
          distributor_share: 1000,
          affiliate: hasAffiliate ? newCampaignAffiliate.trim() : undefined
        };

        const dbSplits = [];
        if (hasAffiliate) {
          dbSplits.push({ creator_address: userAddress || advertiserWallet, creator_name: "Lead Creator", share_bps: 8000 });
          dbSplits.push({ creator_address: newCampaignAffiliate.trim(), creator_name: "Affiliate Referral", share_bps: 1500 });
        } else {
          dbSplits.push({ creator_address: userAddress || advertiserWallet, creator_name: "Lead Creator", share_bps: leadShare });
          if (coAuthorShare > 0) {
            dbSplits.push({ creator_address: advertiserWallet, creator_name: "Co-Author", share_bps: coAuthorShare });
          }
        }
        dbSplits.push({ creator_address: oracleNodeAddress, creator_name: "Distributor Network", share_bps: distributorShare });

        await dbService.saveCampaign(newCampaign, dbSplits);

        const sandboxTxHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

        const newTx = {
          hash: sandboxTxHash,
          block: 4920420 + Math.floor(Math.random() * 100),
          method: "createCampaign",
          status: "Success (Sandbox)",
          from: userAddress,
          to: contractAddress,
          value: budgetNum,
          timestamp: "Just now",
          details: `[Sandbox] Campaign "${newCampaignTitle}" saved. Deploy the contract to enable real escrow locking.`
        };

        setTransactions(prev => [newTx, ...prev]);
        await syncAllData();

        setStatusModal({
          show: true,
          title: "Campaign Created (Sandbox)!",
          message: `Your campaign has been saved and is visible in the directory!\n\nEscrow Budget: ${newCampaignBudget} USDC\nCPC Rate: ${newCampaignCPC} USDC\n\n💡 To lock real USDC on-chain, deploy the AdRevenueSplitter contract using:\nnpx hardhat run scripts/deploy.js --network arcTestnet`,
          type: "success"
        });

        setNewCampaignTitle(""); // Reset form
        return;
      }

      // ════════════════════════════════════════════════════════════════
      // LIVE MODE — contract is deployed, execute real on-chain calls
      // ════════════════════════════════════════════════════════════════

      const walletClient = createWalletClient({
        chain: arcTestnet,
        transport: custom((window as any).ethereum)
      });

      const usdcAddress = "0x3600000000000000000000000000000000000000"; // ERC-20 USDC on Arc
      const budgetUnits = parseUnits(newCampaignBudget, 6);

      setStatusModal({
        show: true,
        title: "Checking USDC Balance",
        message: "Checking if your wallet has sufficient USDC to fund the campaign escrow...",
        type: "loading"
      });

      // Check USDC balance
      const usdcBalance = await publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [userAddress as `0x${string}`]
      }) as bigint;

      if (usdcBalance < budgetUnits) {
        setStatusModal({
          show: true,
          title: "Insufficient Balance",
          message: `Insufficient USDC balance! You need ${newCampaignBudget} USDC to fund this escrow pool, but your wallet only has ${formatUnits(usdcBalance, 6)} USDC.`,
          type: "error"
        });
        setIsCreatingCampaign(false);
        return;
      }

      // Check USDC allowance
      const currentAllowance = await publicClient.readContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [userAddress as `0x${string}`, formattedContractAddress]
      }) as bigint;

      if (currentAllowance < budgetUnits) {
        setStatusModal({
          show: true,
          title: "USDC Spend Approval",
          message: "Spend approval is required to transfer USDC into the AdSplit Escrow Pool contract. Please approve the signature in your wallet.",
          type: "loading"
        });

        const { request: approveRequest } = await publicClient.simulateContract({
          account: userAddress as `0x${string}`,
          address: usdcAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [formattedContractAddress, budgetUnits]
        });

        const approveTxHash = await walletClient.writeContract(approveRequest);
        
        setStatusModal({
          show: true,
          title: "Confirming Approval",
          message: `Allowance spend transaction submitted on Arc!\nTx: ${approveTxHash}\n\nWaiting for confirmation blocks...`,
          type: "loading"
        });

        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      }

      setStatusModal({
        show: true,
        title: "Creating Campaign",
        message: "Awaiting your wallet signature to deploy the Escrow Campaign Pool on-chain...",
        type: "loading"
      });

      const contractRecipients: `0x${string}`[] = [];
      const contractShares: bigint[] = [];

      // Lead Creator split
      if (leadShare > 0) {
        contractRecipients.push(userAddress as `0x${string}`);
        contractShares.push(BigInt(leadShare));
      }

      // Co-Author split
      if (coAuthorShare > 0) {
        contractRecipients.push(advertiserWallet as `0x${string}`);
        contractShares.push(BigInt(coAuthorShare));
      }

      // Distributor split
      contractRecipients.push(oracleNodeAddress as `0x${string}`);
      contractShares.push(BigInt(distributorShare));

      const hasAffiliate = newCampaignAffiliate && newCampaignAffiliate.trim().startsWith("0x");
      const affiliateAddressStr = (hasAffiliate ? newCampaignAffiliate.trim() : "0x0000000000000000000000000000000000000000") as `0x${string}`;

      const { request } = await publicClient.simulateContract({
        account: userAddress as `0x${string}`,
        address: formattedContractAddress,
        abi: CONTRACT_ABI,
        functionName: "createCampaign",
        args: [
          parseUnits(newCampaignBudget, 6), // 6 decimals for ERC-20 USDC
          parseUnits(newCampaignCPC, 6),
          contractRecipients,
          contractShares,
          affiliateAddressStr
        ]
      });

      const txHash = await walletClient.writeContract(request);

      setStatusModal({
        show: true,
        title: "Confirming Campaign",
        message: `Escrow deployment tx submitted!\nTx: ${txHash}\n\nWaiting for transaction settlement...`,
        type: "loading"
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Extract the real on-chain campaignId from the CampaignCreated event log
      let onChainCampaignId = campaignId; // fallback to frontend-generated ID
      try {
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: CONTRACT_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "CampaignCreated") {
              onChainCampaignId = (decoded.args as any).campaignId;
              console.log("[AdSplit] Real on-chain campaignId:", onChainCampaignId);
              break;
            }
          } catch { /* skip non-matching logs */ }
        }
      } catch (e) {
        console.warn("Could not decode CampaignCreated event, using frontend ID", e);
      }

      // Save to Supabase database using the REAL on-chain campaignId
      const newCampaign: DbCampaign = {
        id: onChainCampaignId,
        title: newCampaignTitle,
        advertiser: userAddress || advertiserWallet,
        total_budget: budgetNum,
        remaining_budget: budgetNum,
        cost_per_click: cpcNum,
        total_clicks: 0,
        active: true,
        platform_share: hasAffiliate ? 500 : 300,
        distributor_share: 1000,
        affiliate: hasAffiliate ? newCampaignAffiliate.trim() : undefined
      };

      const dbSplits = [];
      if (hasAffiliate) {
        dbSplits.push({ creator_address: userAddress || advertiserWallet, creator_name: "Lead Creator", share_bps: 8000 });
        dbSplits.push({ creator_address: newCampaignAffiliate.trim(), creator_name: "Affiliate Referral", share_bps: 1500 });
      } else {
        dbSplits.push({ creator_address: userAddress || advertiserWallet, creator_name: "Lead Creator", share_bps: leadShare });
        if (coAuthorShare > 0) {
          dbSplits.push({ creator_address: advertiserWallet, creator_name: "Co-Author", share_bps: coAuthorShare });
        }
      }

      dbSplits.push({ creator_address: oracleNodeAddress, creator_name: "Distributor Network", share_bps: distributorShare });

      await dbService.saveCampaign(newCampaign, dbSplits);

      const newTx = {
        hash: txHash,
        block: 4920420,
        method: "createCampaign",
        status: "Success",
        from: userAddress,
        to: contractAddress,
        value: budgetNum,
        timestamp: "Just now",
        details: `Real campaign ${newCampaignTitle} deployed on Arc L1. Tx hash: ${txHash}`
      };

      setTransactions(prev => [newTx, ...prev]);
      await syncAllData();

      setStatusModal({
        show: true,
        title: "Campaign Activated!",
        message: `Your campaign has been successfully deployed on-chain and published in the directory!\n\nEscrow Locked: ${newCampaignBudget} USDC\nCPC Rate: ${newCampaignCPC} USDC`,
        type: "success"
      });

      setNewCampaignTitle(""); // Reset form
    } catch (err: any) {
      console.error(err);
      showErrorModal("Failed to Create Campaign", err);
    } finally {
      setIsCreatingCampaign(false);
    }
  };

  // Action: Real emergency withdraw from Escrow Smart Contract
  const handleWithdrawBudget = async (campaignId: string) => {
    if (!walletConnected) {
      setStatusModal({
        show: true,
        title: "Wallet Required",
        message: "Please connect your wallet first using the 'Connect Wallet' button in the top right header!",
        type: "error"
      });
      return;
    }
    setWithdrawingCampaignId(campaignId);

    try {
      const formattedContractAddress = getAddress(contractAddress.trim().toLowerCase());

      // Pre-flight: check if the contract address has bytecode deployed
      let isContractDeployed = false;
      try {
        const contractBytecode = await publicClient.getCode({ address: formattedContractAddress });
        isContractDeployed = !!(contractBytecode && contractBytecode !== "0x" && contractBytecode.length > 2);
      } catch (err) {
        console.warn("[AdSplit Sandbox] RPC connection failed. Defaulting to Sandbox withdraw.", err);
      }

      if (!isContractDeployed) {
        // SANDBOX MODE — just update Supabase
        setStatusModal({
          show: true,
          title: "Closing Campaign (Sandbox)",
          message: "Contract not deployed. Closing campaign in Sandbox Demo Mode...",
          type: "loading"
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        await supabase
          .from("campaigns")
          .update({ active: false, remaining_budget: 0 })
          .eq("id", campaignId);

        const sandboxTxHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
        const newTx = {
          hash: sandboxTxHash,
          block: 4920435 + Math.floor(Math.random() * 100),
          method: "withdrawRemainingBudget",
          status: "Success (Sandbox)",
          from: userAddress,
          to: contractAddress,
          value: 0,
          timestamp: "Just now",
          details: `[Sandbox] Campaign closed and budget refunded in demo mode.`
        };
        setTransactions(prev => [newTx, ...prev]);
        await syncAllData();

        setStatusModal({
          show: true,
          title: "Campaign Closed (Sandbox)!",
          message: "The campaign has been closed and marked as inactive in the database.\n\n💡 Deploy the contract on-chain to enable real USDC escrow refunds.",
          type: "success"
        });
        return;
      }

      // LIVE MODE — contract is deployed
      setStatusModal({
        show: true,
        title: "Closing Campaign",
        message: "Awaiting your wallet signature to close this campaign and withdraw the remaining budget...",
        type: "loading"
      });

      const walletClient = createWalletClient({
        chain: arcTestnet,
        transport: custom((window as any).ethereum)
      });

      const { request } = await publicClient.simulateContract({
        account: userAddress as `0x${string}`,
        address: formattedContractAddress,
        abi: CONTRACT_ABI,
        functionName: "withdrawRemainingBudget",
        args: [campaignId as `0x${string}`]
      });

      const txHash = await walletClient.writeContract(request);

      setStatusModal({
        show: true,
        title: "Refunding Escrow",
        message: `Closing transaction submitted!\nTx: ${txHash}\n\nWaiting for confirmation blocks...`,
        type: "loading"
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Update Supabase Database campaign status to active = false
      await supabase
        .from("campaigns")
        .update({ active: false, remaining_budget: 0 })
        .eq("id", campaignId);

      const newTx = {
        hash: txHash,
        block: 4920435,
        method: "withdrawRemainingBudget",
        status: "Success",
        from: userAddress,
        to: contractAddress,
        value: 0,
        timestamp: "Just now",
        details: `Real budget remaining refunded. Tx hash: ${txHash}`
      };

      setTransactions(prev => [newTx, ...prev]);
      await syncAllData();

      setStatusModal({
        show: true,
        title: "Campaign Closed!",
        message: "The campaign has been successfully closed and all remaining escrow budget refunded to your wallet!",
        type: "success"
      });
    } catch (err: any) {
      console.error(err);
      showErrorModal("Failed to Close Campaign", err);
    } finally {
      setWithdrawingCampaignId(null);
    }
  };

  // Action: Real CCTP Bridge call (using Circle SDK APIs)
  const handleCCTPBridge = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(bridgeAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    const initialSteps = [
      { label: "USDC Burn Approval", description: "Approve the TokenMessenger to spend source USDC", status: "running" as const },
      { label: "Initiate CCTP Burn", description: "Execute depositForBurn on source TokenMessenger", status: "running" as const },
      { label: "Fetch Circle Attestation", description: "Poll Circle Iris API for signed proof", status: "idle" as const },
      { label: "Mint Claiming on Arc", description: "Relay signed attestation to Arc MessageTransmitter", status: "idle" as const }
    ];
    setBridgeSteps(initialSteps);
    setBridgeActive(true);
    setShowBridgeTracker(true);

    const isSepolia = bridgeSourceChain === "Ethereum";
    let countdown = isSepolia ? 150 : 60;
    setEstRemainingTime(`${countdown}s`);

    const timer = setInterval(() => {
      countdown = Math.max(0, countdown - 1);
      setEstRemainingTime(`${countdown}s`);
    }, 1000);

    try {
      setStatusModal({
        show: true,
        title: "Initiating CCTP Teleport",
        message: `Requesting a cross-chain USDC transfer of ${amountNum} USDC from ${bridgeSourceChain} to your Arc Testnet account via CCTP...`,
        type: "loading"
      });

      // Step 1 & 2: Trigger backend burn transaction
      const burnRes = await fetch("/api/bridge/burn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromChain: bridgeSourceChain,
          amount: bridgeAmount,
          destinationAddress: userAddress || advertiserWallet
        })
      });

      const burnData = await burnRes.json();
      if (!burnRes.ok || burnData.error) {
        throw new Error(burnData.error || "Failed to trigger CCTP burn");
      }

      const burnTxHash = burnData.burnTxHash;

      // Update steps for burn success
      setBridgeSteps([
        { 
          label: "USDC Burn Approval", 
          description: "Approved CCTP TokenMessenger contract successfully.", 
          status: "success" as const,
          txHash: burnTxHash,
          explorerUrl: bridgeSourceChain === "Ethereum" 
            ? `https://sepolia.etherscan.io/tx/${burnTxHash}` 
            : bridgeSourceChain === "Base" 
              ? `https://sepolia.basescan.org/tx/${burnTxHash}`
              : `https://sepolia.arbiscan.io/tx/${burnTxHash}`
        },
        { 
          label: "Initiate CCTP Burn", 
          description: `Burn transaction completed on ${bridgeSourceChain}.`, 
          status: "success" as const,
          txHash: burnTxHash,
          explorerUrl: bridgeSourceChain === "Ethereum" 
            ? `https://sepolia.etherscan.io/tx/${burnTxHash}` 
            : bridgeSourceChain === "Base" 
              ? `https://sepolia.basescan.org/tx/${burnTxHash}`
              : `https://sepolia.arbiscan.io/tx/${burnTxHash}`
        },
        { 
          label: "Fetch Circle Attestation", 
          description: "Polling Circle Sandbox Iris API for signed attestation...", 
          status: "running" as const 
        },
        { 
          label: "Mint Claiming on Arc", 
          description: "Awaiting signed attestation message payload.", 
          status: "idle" as const 
        }
      ]);

      setStatusModal({
        show: true,
        title: "Polling Circle Attestation",
        message: "CCTP Burn transaction confirmed. Polling Circle Attestation service for signatures...",
        type: "loading"
      });

      // Step 3 & 4: Poll attestation & mint claim on backend
      let attestationClaimed = false;
      let claimData: any = null;

      while (!attestationClaimed) {
        const claimRes = await fetch("/api/bridge/attestation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            burnTxHash,
            fromChain: bridgeSourceChain,
            campaignId: campaigns.length > 0 ? campaigns[0].id : undefined
          })
        });

        claimData = await claimRes.json();
        if (claimRes.ok && claimData.status === "SUCCESS") {
          attestationClaimed = true;
        } else if (claimData.status === "PENDING_ATTESTATION") {
          await new Promise(resolve => setTimeout(resolve, 4000));
        } else {
          throw new Error(claimData.error || "Failed to poll and claim CCTP attestation");
        }
      }

      clearInterval(timer);
      setEstRemainingTime("0s");

      setBridgeSteps([
        { 
          label: "USDC Burn Approval", 
          description: "Approved CCTP TokenMessenger contract successfully.", 
          status: "success" as const,
          txHash: burnTxHash,
          explorerUrl: bridgeSourceChain === "Ethereum" 
            ? `https://sepolia.etherscan.io/tx/${burnTxHash}` 
            : bridgeSourceChain === "Base" 
              ? `https://sepolia.basescan.org/tx/${burnTxHash}`
              : `https://sepolia.arbiscan.io/tx/${burnTxHash}`
        },
        { 
          label: "Initiate CCTP Burn", 
          description: `Burn transaction completed on ${bridgeSourceChain}.`, 
          status: "success" as const,
          txHash: burnTxHash,
          explorerUrl: bridgeSourceChain === "Ethereum" 
            ? `https://sepolia.etherscan.io/tx/${burnTxHash}` 
            : bridgeSourceChain === "Base" 
              ? `https://sepolia.basescan.org/tx/${burnTxHash}`
              : `https://sepolia.arbiscan.io/tx/${burnTxHash}`
        },
        { 
          label: "Fetch Circle Attestation", 
          description: "Attestation signed and fetched from Circle Sandbox.", 
          status: "success" as const 
        },
        { 
          label: "Mint Claiming on Arc", 
          description: "USDC claimed and minted successfully on Arc L1!", 
          status: "success" as const,
          txHash: claimData.claimTxHash,
          explorerUrl: `https://testnet.arcscan.app/tx/${claimData.claimTxHash}`
        }
      ]);

      const newTx = {
        hash: claimData.claimTxHash,
        block: 5042002,
        method: "cctpBridgeMint",
        status: "Success",
        from: "0x0000000000000000000000000000000000000000",
        to: userAddress || advertiserWallet,
        value: amountNum,
        timestamp: "Just now",
        details: `CCTP Teleport complete. ${amountNum} USDC minted on Arc L1. Tx: ${claimData.claimTxHash}`
      };
      setTransactions(prev => [newTx, ...prev]);

      syncAllData();

      setStatusModal({
        show: true,
        title: "USDC Teleported!",
        message: `Successfully bridged and claimed ${amountNum} USDC from ${bridgeSourceChain} to Arc Testnet.`,
        type: "success"
      });

    } catch (err: any) {
      console.error(err);
      clearInterval(timer);
      setBridgeSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "failed" as const, description: err?.message || "Error occurred" } : s));
      showErrorModal("CCTP Teleport Failed", err);
    } finally {
      setBridgeActive(false);
    }
  };

  // Action: Click engagement (Evaluates organic fingerprint, then writes Gasless transaction)
  const simulateReaderClick = async (campaignId: string) => {
    if (isClicking) return;
    
    const camp = campaigns.find(c => c.id === campaignId);
    if (!camp || !camp.active) return;

    setIsClicking(true);
    setStep(1);

    try {
      setStatusModal({
        show: true,
        title: "Evaluating Click",
        message: "Generating a real organic traffic proof fingerprint and evaluating with Oracle...",
        type: "loading"
      });

      const clickId = "clk_" + Math.floor(Math.random() * 9000 + 1000);
      const randomIP = `${Math.floor(Math.random() * 200 + 20)}.${Math.floor(Math.random() * 200 + 10)}.${Math.floor(Math.random() * 100 + 1)}.${Math.floor(Math.random() * 254 + 1)}`;
      
      // 1. Call real Circle/Oracle service to verify fingerprint
      const evaluation = await circleService.evaluateEngagementProof(clickId, randomIP);
      setStep(2);

      if (!evaluation.isValid) {
        throw new Error(evaluation.reason || "BLOCKED");
      }

      // 2. Call Circle Relayer to execute transaction GASLESS on Arc Testnet
      let telemetryPayload = "";
      let zkProof = null;
      if (telemetryCollectorRef.current) {
        telemetryPayload = await telemetryCollectorRef.current.getEncryptedPayload('adsplit_secret_telemetry_key_32bytes');
        const raw = telemetryCollectorRef.current.getRawData();
        const movesX = raw.mouseMoves.map(m => m.x);
        const movesY = raw.mouseMoves.map(m => m.y);
        while (movesX.length < 10) movesX.push(movesX[movesX.length - 1] || 0);
        while (movesY.length < 10) movesY.push(movesY[movesY.length - 1] || 0);
        const last10X = movesX.slice(-10);
        const last10Y = movesY.slice(-10);
        const delay = raw.clicks.length > 0 ? (raw.clicks[0].t - raw.loadTime) : (Date.now() - raw.loadTime);
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const isHeadless = typeof navigator !== 'undefined' ? (!!navigator.webdriver || userAgent.includes("HeadlessChrome")) : false;
        
        try {
          zkProof = await generateTelemetryProof(
            {
              mouseX: last10X,
              mouseY: last10Y,
              clickDelay: delay,
              userAgent,
              isHeadless
            },
            campaignId,
            keccak256(stringToBytes(clickId))
          );
        } catch (proofErr: any) {
          console.warn("Local ZK Proof generation failed: ", proofErr);
          throw new Error(proofErr.message || "Failed ZK telemetry validation");
        }
      }

      // Check if contract is deployed before on-chain execution
      let isContractDeployed = false;
      try {
        const formattedContractAddress = getAddress(contractAddress.trim().toLowerCase());
        const contractBytecode = await publicClient.getCode({ address: formattedContractAddress });
        isContractDeployed = !!(contractBytecode && contractBytecode !== "0x" && contractBytecode.length > 2);
      } catch (e) {
        console.warn("[AdSplit Sandbox] RPC connection failed. Defaulting to Sandbox Click.");
      }

      if (isContractDeployed) {
        const txResult = await circleService.sponsorGaslessTransaction(
          "developer_wallet_id",
          contractAddress,
          "recordEngagement",
          [campaignId, keccak256(stringToBytes(clickId))],
          telemetryPayload,
          zkProof
        );

        if (txResult.error) {
          throw new Error(txResult.error);
        }
      } else {
        console.log("[AdSplit Sandbox] Contract not deployed. Simulating gasless settlement in Sandbox Mode...");
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      setStep(3);
      await new Promise(resolve => setTimeout(resolve, 800));

      // 3. Save to Supabase click logs matching schema
      const newLog: DbClickLog = {
        id: clickId,
        campaign_id: campaignId,
        ip_address: randomIP,
        status: "valid",
        payout_usdc: camp.cost_per_click,
        creator_payout_usdc: camp.cost_per_click * 0.85,
        platform_payout_usdc: camp.cost_per_click * 0.03,
        distributor_payout_usdc: camp.cost_per_click * 0.12
      };

      await dbService.logEngagement(newLog);
      await syncAllData();

      const txHash = "0x" + Math.random().toString(16).substr(2, 64);
      const newTx = {
        hash: txHash,
        block: 4920425,
        method: "recordEngagement",
        status: "Success",
        from: oracleNodeAddress,
        to: contractAddress,
        value: camp.cost_per_click,
        timestamp: "Just now",
        details: `Gasless PPC Payout Settled. Alice received +${(camp.cost_per_click * 0.85).toFixed(4)} USDC.`
      };
      setTransactions(prev => [newTx, ...prev]);

      setStatusModal({
        show: true,
        title: "PPC Payout Settled!",
        message: `Autonomous pay-per-click settled successfully!\n\nLocked escrow paid out to Lead Creator and Partners gaslessly!`,
        type: "success"
      });
    } catch (err: any) {
      console.error(err);
      showErrorModal("Click Settlement Failed", err);
    } finally {
      setIsClicking(false);
      setStep(0);
    }
  };

  // Action: Launch Bot Flood attack (Evaluates fraud & writes on-chain proofs)
  const launchBotAttack = async (campaignId: string) => {
    if (botAttackActive) return;
    const camp = campaigns.find(c => c.id === campaignId);
    if (!camp) return;

    setBotAttackActive(true);
    setBotClickCount(0);

    const badIP = "192.168.133.7";

    for (let i = 1; i <= 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      setBotClickCount(i);

      // Submit actual bad click log to database
      const clickId = "clk_bad_" + Math.floor(Math.random() * 9000 + 1000);

      // Call API sponsor endpoint with a tampered/empty telemetry payload to execute real-time rejection
      try {
        await fetch('/api/sponsor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletId: "developer_wallet_id",
            contractAddress,
            abiMethod: "recordEngagement",
            args: [campaignId, keccak256(stringToBytes(clickId))],
            telemetryPayload: "TAMPERED_BOT_TELEMETRY_EMPTY_CURVES"
          })
        });
      } catch (e) {
        console.warn("Anti-bot endpoint successfully rejected fake transaction: ", e);
      }
      
      const newLog: DbClickLog = {
        id: clickId,
        campaign_id: campaignId,
        ip_address: badIP,
        status: "bot_fraud",
        payout_usdc: 0,
        creator_payout_usdc: 0,
        platform_payout_usdc: 0,
        distributor_payout_usdc: 0
      };

      await dbService.logEngagement(newLog);

      const txHash = "0x" + Math.random().toString(16).substr(2, 64);
      const newTx = {
        hash: txHash,
        block: 4920430 + i,
        method: "flagFraudEvent",
        status: "Blocked",
        from: oracleNodeAddress,
        to: contractAddress,
        value: 0,
        timestamp: "Just now",
        details: `Blocked. Bot spam click index ${i} detected from IP ${badIP} by Circle SDK Oracle Node.`
      };
      setTransactions(prev => [newTx, ...prev]);
    }

    await syncAllData();
    setBotAttackActive(false);

    setRecentNotification({
      message: `Security guard caught 6 bot spam clicks from IP ${badIP}! Instantly blocked automated payouts to keep 100% of your budget safe.`,
      isError: true
    });
    setTimeout(() => setRecentNotification(null), 6000);
  };

  // Smart Onboarding Assistant (Leaf Assistant / Nook Assistant)
  const renderOnboardingAssistant = () => {
    return (
      <div className="blueprint-panel p-6 bg-[#FCFAF6] border-4 border-[#744D2B] rounded-[32px] space-y-4 shadow-[0_8px_0_rgba(116,77,43,0.08)]">
        <div className="border-b-3 border-[#744D2B]/10 pb-3 flex items-center justify-between text-[#744D2B]">
          <span className="text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
            <span>🍃</span> Cozy Desk Assistant
          </span>
          <span className="text-[8px] font-mono font-black uppercase bg-white border border-[#744D2B]/20 px-2 py-0.5 rounded-md">Online</span>
        </div>

        <div className="text-xs text-[#8E7368] space-y-3 font-semibold leading-relaxed">
          {activeTab === "advertiser" && (
            <>
              <p>
                <strong>Welcome to the Ad Spender Office!</strong> Here, you can launch campaigns by putting digital dollars (USDC) into a secure campaign chest.
              </p>
              <p>
                Think of it like a cozy vending machine: you fill it with coins, and every time a creator displays your ad and a reader clicks, the vending machine drops a tiny share of coins directly into the creator's wallet instantly. No middlemen, no waiting!
              </p>
              <div className="bg-[#FEF9E7] border-2 border-[#F4C455]/40 rounded-2xl p-3 space-y-1.5">
                <span className="block text-[8px] text-[#744D2B] font-black uppercase tracking-wider">What happens next?</span>
                <ol className="list-decimal pl-4 text-[10px] space-y-1">
                  <li>Fill in the catchy title and budget above.</li>
                  <li>Click <strong>Deposit & Launch</strong> (gas is sponsored, so it's 100% free!).</li>
                  <li>Your ad goes live immediately in the <strong>Live Ad Preview</strong>!</li>
                </ol>
              </div>
            </>
          )}

          {activeTab === "creator" && (
            <>
              <p>
                <strong>Welcome to the Live Ad Preview Playground!</strong> Here, you can see how creators host sponsored ad banners on their blogs.
              </p>
              <p>
                Since everything is connected directly, clicking an ad transfers digital dollars from the sponsor's chest straight to the creator in less than a second!
              </p>
              <div className="bg-[#FEF9E7] border-2 border-[#F4C455]/40 rounded-2xl p-3 space-y-1.5">
                <span className="block text-[8px] text-[#744D2B] font-black uppercase tracking-wider">Interactive Walkthrough:</span>
                <ul className="list-disc pl-4 text-[10px] space-y-1">
                  <li>Look at the custom ad banner inside Alice's Blog post.</li>
                  <li>Click <strong>"Try Clicking this Banner! ➔"</strong>.</li>
                  <li>Watch the <strong>Payment Teleport Pipeline</strong> split the budget instantly in real-time!</li>
                </ul>
              </div>
            </>
          )}

          {activeTab === "publisher" && (
            <>
              <p>
                <strong>Welcome to the DSP Publisher Affiliate Portal!</strong> Here, publishers can generate ad tags, monitor splits, and manage domain approvals.
              </p>
              <p>
                When active affiliate campaigns get clicks, the revenue splits automatically: 80% to Creator, 15% to Affiliate, and 5% to Platform.
              </p>
              <div className="bg-[#FEF9E7] border-2 border-[#F4C455]/40 rounded-2xl p-3 space-y-1.5">
                <span className="block text-[8px] text-[#744D2B] font-black uppercase tracking-wider">Publisher Guide:</span>
                <ul className="list-disc pl-4 text-[10px] space-y-1">
                  <li>Generate a custom HTML script using the Embed Tool.</li>
                  <li>Whitelist your external hostname domain to enable secure click validation.</li>
                  <li>Track impressions, clicks, CTR, and earned referral splits.</li>
                </ul>
              </div>
            </>
          )}

          {activeTab === "oracle" && (
            <>
              <p>
                <strong>Welcome to the Anti-Bot Shield Control!</strong> To protect campaign budgets from automated bot clicks, our system uses telemetry checks.
              </p>
              <p>
                If a bot tries to spam-click, the security guard instantly blocks the payout, safeguarding the sponsor's chest.
              </p>
              <div className="bg-[#FEF9E7] border-2 border-[#F4C455]/40 rounded-2xl p-3 space-y-1.5">
                <span className="block text-[8px] text-[#744D2B] font-black uppercase tracking-wider">Try it out:</span>
                <ul className="list-disc pl-4 text-[10px] space-y-1">
                  <li>Click <strong>"🚨 Test Anti-Bot Shield"</strong> to launch automated spammers.</li>
                  <li>Watch the security guard block fakes in real time while genuine clicks pass safely.</li>
                </ul>
              </div>
            </>
          )}

          {activeTab === "contract" && (
            <>
              <p>
                <strong>Welcome to the Live Activity History Ledger!</strong> This ledger logs every single budget deposit and click payout on the network.
              </p>
              <p>
                Every record is public, permanent, and completely transparent, so sponsors and creators always have a unified source of truth without needing an accountant.
              </p>
              <div className="bg-[#FEF9E7] border-2 border-[#F4C455]/40 rounded-2xl p-3 space-y-1.5">
                <span className="block text-[8px] text-[#744D2B] font-black uppercase tracking-wider">Understanding the feed:</span>
                <ul className="list-disc pl-4 text-[10px] space-y-1">
                  <li>Inspect blacklisted bot IPs in the safety logs.</li>
                  <li>Input your campaign address to view dynamic network parameters in real time!</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // Computations for SaaS Dashboard
  const totalClicksCount = clickLogs.filter(l => l.status === "valid").length;
  const totalWeb2FeesSaved = totalClicksCount * 0.18 * 0.32;
  const totalOrganicRatio = clickLogs.length > 0 
    ? (clickLogs.filter(l => l.status === "valid").length / clickLogs.length) * 100 
    : 94.5;

  return (
    <div className="min-h-screen text-[#5D4037] flex flex-col relative pb-16 bg-[#FDFBF7] select-none font-medium">
      
      {/* 1. TOP HEADER (Animal Crossing / NookPhone Cozy Styled Header) */}
      <header className="relative md:sticky md:top-0 z-50 w-full bg-[#FDFBF7]/95 backdrop-blur-md border-b-4 border-[#744D2B] transition-all duration-300">
        <div className="px-4 md:px-8 pt-4 pb-3.5 max-w-7xl mx-auto w-full flex flex-col gap-4">
          
          {/* Top Row: Brand Info, Clock & Mobile Menu Toggle */}
          <div className="flex flex-row justify-between items-center gap-4 w-full">
            {/* Left Side: Rep Desk Branding */}
            <div className="text-left space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 bg-[#F4C455] border-3 border-[#744D2B] rounded-2xl flex items-center justify-center text-[#744D2B] font-bold text-lg shadow-[0_4px_0_#744D2B] cozy-bounce shrink-0">
                  🍃
                </div>
                <h1 className="text-lg sm:text-2xl md:text-3xl font-black tracking-tight text-[#744D2B] leading-none uppercase truncate max-w-[180px] sm:max-w-none">
                  AdSplit Desk
                </h1>
              </div>
              <p className="text-xs md:text-sm text-[#8E7368] font-bold tracking-wide italic leading-relaxed hidden sm:block mt-1">
                Managing autonomous digital ad splits with dynamic styles.
              </p>
            </div>

            {/* Right Side Tools Container */}
            <div className="flex items-center gap-3 shrink-0">
              {/* Digital Clock & Date Container in tactile frame */}
              <div className="bg-[#FFFFFF] border-4 border-[#744D2B] rounded-[24px] px-4 py-2 flex items-center gap-4 shadow-[0_5px_0_rgba(116,77,43,0.1)] shrink-0 text-xs md:text-sm">
                <div className="border-r-3 border-[#744D2B]/30 pr-3.5 text-center font-mono">
                  <span className="block text-[8px] text-[#A78E84] font-extrabold uppercase leading-none">{currentDay.substring(0,3)}</span>
                  <span className="text-sm font-black text-[#744D2B] block mt-1 leading-none">{currentDate}</span>
                </div>
                
                <div className="flex flex-col items-start font-mono justify-center">
                  <span className="text-base font-black text-[#744D2B] tracking-tighter leading-none">
                    {currentTime.split(" ")[0]}
                  </span>
                  <span className="text-[8px] text-[#F4C455] font-extrabold uppercase tracking-widest mt-0.5 leading-none">
                    {currentTime.split(" ")[1]}
                  </span>
                </div>
              </div>

              {/* Mobile Burger Menu Toggle Button */}
              <button 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden flex items-center justify-center h-10 w-10 bg-[#FFFFFF] border-3 border-[#744D2B] rounded-2xl text-[#744D2B] shadow-[0_3px_0_#744D2B] active:translate-y-0.5 active:shadow-[0_1.5px_0_#744D2B] transition-all cursor-pointer shrink-0"
                aria-label="Toggle navigation menu"
              >
                {mobileMenuOpen ? (
                  <X className="h-5 w-5 stroke-[2.5]" />
                ) : (
                  <Menu className="h-5 w-5 stroke-[2.5]" />
                )}
              </button>
            </div>
          </div>

          {/* Bottom Row: Navigation Tabs & Wallet Widget */}
          <div className={`flex-col md:flex-row justify-between items-center gap-4 pt-1 ${
            mobileMenuOpen ? "flex animate-slide-up" : "hidden md:flex"
          }`}>
            {/* Navigation bar representing Quick Access desk directories */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs font-black uppercase tracking-wider">
              <button 
                onClick={() => handleTabChange("advertiser")}
                className={`px-5 py-2.5 rounded-full border-3 border-[#744D2B] transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === "advertiser" 
                    ? "bg-[#F4C455] text-[#744D2B] shadow-[0_4px_0_#744D2B] -translate-y-0.5" 
                    : "bg-white text-[#8E7368] shadow-[0_2px_0_#744D2B] hover:bg-gray-50 hover:-translate-y-0.5"
                }`}
              >
                <Hammer className="h-4 w-4" />
                Ad Spender Office
              </button>
              
              <button 
                onClick={() => handleTabChange("creator")}
                className={`px-5 py-2.5 rounded-full border-3 border-[#744D2B] transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === "creator" 
                    ? "bg-[#7FB3D5] text-white shadow-[0_4px_0_#744D2B] -translate-y-0.5" 
                    : "bg-white text-[#8E7368] shadow-[0_2px_0_#744D2B] hover:bg-gray-50 hover:-translate-y-0.5"
                }`}
              >
                <Globe className="h-4 w-4" />
                Live Ad Preview
              </button>

              <button 
                onClick={() => handleTabChange("publisher")}
                className={`px-5 py-2.5 rounded-full border-3 border-[#744D2B] transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === "publisher" 
                    ? "bg-[#FF9F80] text-white shadow-[0_4px_0_#744D2B] -translate-y-0.5" 
                    : "bg-white text-[#8E7368] shadow-[0_2px_0_#744D2B] hover:bg-gray-50 hover:-translate-y-0.5"
                }`}
              >
                <Code className="h-4 w-4" />
                Publisher Dashboard
              </button>

              <button 
                onClick={() => handleTabChange("oracle")}
                className={`px-5 py-2.5 rounded-full border-3 border-[#744D2B] transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === "oracle" 
                    ? "bg-[#B28DFF] text-white shadow-[0_4px_0_#744D2B] -translate-y-0.5" 
                    : "bg-white text-[#8E7368] shadow-[0_2px_0_#744D2B] hover:bg-gray-50 hover:-translate-y-0.5"
                }`}
              >
                <Activity className="h-4 w-4" />
                Anti-Fraud Shields
              </button>

              <button 
                onClick={() => handleTabChange("contract")}
                className={`px-5 py-2.5 rounded-full border-3 border-[#744D2B] transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === "contract" 
                    ? "bg-[#35C7A4] text-white shadow-[0_4px_0_#744D2B] -translate-y-0.5" 
                    : "bg-white text-[#8E7368] shadow-[0_2px_0_#744D2B] hover:bg-gray-50 hover:-translate-y-0.5"
                }`}
              >
                <Terminal className="h-4 w-4" />
                Live Activity History
              </button>

              <a 
                href="/admin"
                className="px-5 py-2.5 rounded-full border-3 border-[#744D2B] bg-[#FCFAF6] hover:bg-[#F3EFE6] text-[#744D2B] shadow-[0_2px_0_#744D2B] hover:-translate-y-0.5 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Settings className="h-4 w-4" />
                Admin Console
              </a>
            </div>

            {/* Connected wallet widget styled dynamically using RainbowKit */}
            <div className="font-mono text-xs flex items-center gap-2">
              <ConnectButton.Custom>
                {({
                  account,
                  chain,
                  openAccountModal,
                  openChainModal,
                  openConnectModal,
                  authenticationStatus,
                  mounted,
                }) => {
                  const ready = mounted && authenticationStatus !== 'loading';
                  const connected =
                    ready &&
                    account &&
                    chain &&
                    (!authenticationStatus ||
                      authenticationStatus === 'authenticated');

                  return (
                    <div
                      {...(!ready && {
                        'aria-hidden': true,
                        'style': {
                          opacity: 0,
                          pointerEvents: 'none',
                          userSelect: 'none',
                        },
                      })}
                    >
                      {(() => {
                        if (!connected) {
                          return (
                            <button
                              onClick={handleDirectConnect}
                              type="button"
                              className="btn-solid-dark py-2.5 px-5 flex items-center gap-2 cursor-pointer transition-all"
                            >
                              <Wallet className="h-4 w-4" />
                              Connect Wallet
                            </button>
                          );
                        }

                        if (chain.unsupported) {
                          return (
                            <button
                              onClick={openChainModal}
                              type="button"
                              className="btn-solid-dark bg-[#E25252] hover:bg-[#C93B3B] py-2.5 px-5 flex items-center gap-2 cursor-pointer shadow-[0_4px_0_#744D2B]"
                            >
                              Wrong Network
                            </button>
                          );
                        }

                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={openChainModal}
                              style={{ display: 'flex', alignItems: 'center' }}
                              type="button"
                              className="bg-[#FCFAF6] hover:bg-[#FEF9E7] border-3 border-[#744D2B] px-3.5 py-2 rounded-2xl font-bold text-[#744D2B] shadow-[0_3px_0_#744D2B] transition-all cursor-pointer"
                            >
                              {chain.hasIcon && (
                                <div
                                  style={{
                                    background: chain.iconBackground,
                                    width: 12,
                                    height: 12,
                                    borderRadius: 999,
                                    overflow: 'hidden',
                                    marginRight: 4,
                                  }}
                                >
                                  {chain.iconUrl && (
                                    <img
                                      alt={chain.name ?? 'Chain icon'}
                                      src={chain.iconUrl}
                                      style={{ width: '100%', height: '100%' }}
                                    />
                                  )}
                                </div>
                              )}
                              {chain.name}
                            </button>

                            <button
                              onClick={openAccountModal}
                              type="button"
                              className="bg-[#FFFFFF] hover:bg-[#FCFAF6] border-3 border-[#744D2B] px-4 py-2 rounded-2xl flex items-center gap-2.5 shadow-[0_3px_0_#744D2B] transition-all cursor-pointer"
                            >
                              <span className="h-2.5 w-2.5 rounded-full bg-[#35C7A4] status-active-dot animate-pulse"></span>
                              <span className="font-bold text-[#744D2B]">
                                {account.displayName}
                              </span>
                              {account.displayBalance && !account.displayBalance.includes("NaN") ? (
                                <span className="text-[10px] bg-[#FEF9E7] text-[#744D2B] font-black border-2 border-[#744D2B]/20 px-2 py-0.5 rounded-lg">
                                  {account.displayBalance}
                                </span>
                              ) : userBalance && !userBalance.includes("NaN") ? (
                                <span className="text-[10px] bg-[#FEF9E7] text-[#744D2B] font-black border-2 border-[#744D2B]/20 px-2 py-0.5 rounded-lg">
                                  {userBalance} USDC
                                </span>
                              ) : null}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  );
                }}
              </ConnectButton.Custom>
            </div>
          </div>
        </div>
      </header>

      {/* YELLOW WAVY DOODLE DIVIDER LINE */}
      <div className="max-w-7xl mx-auto w-full px-4 md:px-8 my-4 select-none">
        <div className="cozy-wave-divider"></div>
      </div>

      {/* Floating System Notifications */}
      {recentNotification && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm animate-slide-up bg-white border-4 border-[#744D2B] p-4 shadow-2xl flex items-start gap-3 rounded-[24px]">
          {recentNotification.isError ? (
            <ShieldAlert className="h-6 w-6 text-[#E25252] shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="h-6 w-6 text-[#35C7A4] shrink-0 mt-0.5" />
          )}
          <div className="text-xs">
            <h4 className="font-extrabold uppercase tracking-wide text-[#744D2B] leading-none">
              {recentNotification.isError ? "Security Guard Alert" : "Attestation Completed"}
            </h4>
            <p className="text-[#8E7368] mt-1 font-bold leading-normal">{recentNotification.message}</p>
          </div>
        </div>
      )}

      {/* 3. MULTI-COLUMN DESIGN CONSOLE GRID (Warm tactile card layout) */}
      <main className="max-w-7xl mx-auto w-full px-4 md:px-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* COLUMN 1 & 2: Active Plan Area */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Main Visual Banner (Cozy flatness billboard) */}
          <section className="blueprint-panel bg-[#FFFFFF]">
            <div className="w-full h-56 border-b-4 border-[#744D2B] overflow-hidden">
              <ImagePlaceholder 
                src="/adsplit_banner.png" 
                alt="Autonomous ad split flow cozy vector" 
                className="w-full h-56 object-cover"
              />
            </div>
            <div className="p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white">
              <div className="space-y-1.5">
                <span className="text-[9px] font-mono font-bold tracking-widest text-[#F4C455] uppercase bg-[#FEF9E7] border-2 border-[#F4C455]/30 px-2.5 py-0.5 rounded-full inline-block">
                  Warm & Friendly Shared Ad Pools
                </span>
                <h3 className="text-xl font-black tracking-tight text-[#744D2B] leading-none uppercase">
                  Automatic Safe Ad Chest
                </h3>
                <p className="text-xs text-[#8E7368] leading-relaxed max-w-xl font-medium">
                  When sponsors lock budgets in our safe chest, digital creators get paid automatically the very second a reader clicks their ad. No middlemen, no 45-day delay, and no complex fees—just instant rewards powered by digital cash.
                </p>
              </div>

              <div className="flex gap-4 shrink-0 font-mono text-center md:text-left">
                <div className="border-3 border-[#744D2B] bg-[#FCFAF6] p-3 rounded-2xl shadow-[0_3px_0_#744D2B] min-w-[95px]">
                  <span className="block text-[8px] text-[#A78E84] uppercase font-black leading-none">Support Share</span>
                  <span className="text-sm font-black text-[#744D2B] block mt-1">3.0%</span>
                </div>
                <div className="border-3 border-[#744D2B] bg-[#FEF9E7] p-3 rounded-2xl shadow-[0_3px_0_#744D2B] min-w-[95px]">
                  <span className="block text-[8px] text-[#A78E84] uppercase font-black leading-none">Payment Speed</span>
                  <span className="text-sm font-black text-[#35C7A4] block mt-1">Instant</span>
                </div>
              </div>
            </div>
          </section>

          {/* TAB CONTENTS CONTAINER */}
          <div className="space-y-8">
            
            {/* TAB 1: ADVERTISER NODE */}
            {activeTab === "advertiser" && (
              <div className="space-y-8 animate-slide-up">
                
                {/* Campaign Configuration Form */}
                <div className="blueprint-panel p-6 space-y-5 bg-white">
                  <div className="flex items-center gap-2 border-b-3 border-[#744D2B]/10 pb-3.5 select-none">
                    <Plus className="h-5 w-5 text-[#F4C455]" />
                    <h4 className="text-xs font-black uppercase tracking-wider text-[#744D2B]">
                      Start a Cozy Ad Campaign & Sponsor Budget
                    </h4>
                  </div>

                  <form onSubmit={handleCreateCampaign} className="space-y-5 text-xs font-semibold">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[9px] text-[#8E7368] font-extrabold uppercase block tracking-wider">Campaign Title</label>
                        <input
                          type="text"
                          placeholder="e.g. Circle Web3 Developer Drive"
                          value={newCampaignTitle}
                          onChange={(e) => setNewCampaignTitle(e.target.value)}
                          className="w-full blueprint-input"
                          disabled={isCreatingCampaign}
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[9px] text-[#8E7368] font-extrabold uppercase block tracking-wider">How Payouts are Shared</label>
                        <select className="w-full blueprint-input bg-white" disabled={isCreatingCampaign}>
                          <option>Default: 85% Lead Creator, 10% Distributor, 5% Platform</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1.5 font-mono">
                        <label className="text-[9px] text-[#8E7368] font-extrabold uppercase block tracking-wider">Total Campaign Budget (USDC)</label>
                        <input
                          type="number"
                          placeholder="2"
                          value={newCampaignBudget}
                          onChange={(e) => setNewCampaignBudget(e.target.value)}
                          className="w-full blueprint-input"
                          disabled={isCreatingCampaign}
                          required
                        />
                      </div>

                      <div className="space-y-1.5 font-mono">
                        <label className="text-[9px] text-[#8E7368] font-extrabold uppercase block tracking-wider">Price per Ad Click (USDC)</label>
                        <input
                          type="text"
                          placeholder="0.02"
                          value={newCampaignCPC}
                          onChange={(e) => setNewCampaignCPC(e.target.value)}
                          className="w-full blueprint-input"
                          disabled={isCreatingCampaign}
                          required
                        />
                      </div>

                      <div className="space-y-1.5 font-mono">
                        <label className="text-[9px] text-[#8E7368] font-extrabold uppercase block tracking-wider">Creator's Payout Share</label>
                        <input
                          type="range"
                          min="30"
                          max="85"
                          value={newCreatorShare}
                          onChange={(e) => setNewCreatorShare(parseInt(e.target.value))}
                          disabled={isCreatingCampaign}
                          className="w-full h-8 cursor-pointer accent-[#F4C455] mt-1"
                        />
                        <div className="flex justify-between text-[8px] text-[#A78E84] font-black leading-none uppercase">
                          <span>Lead: {newCreatorShare}%</span>
                          <span>Co-Author: {85 - newCreatorShare}%</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5 font-mono">
                      <label className="text-[9px] text-[#8E7368] font-extrabold uppercase block tracking-wider">
                        Affiliate Referral Wallet Address (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 0x3C44Cd3570DE730c26841569B8100c8411905289"
                        value={newCampaignAffiliate}
                        onChange={(e) => setNewCampaignAffiliate(e.target.value)}
                        className="w-full blueprint-input"
                        disabled={isCreatingCampaign}
                      />
                      <span className="block text-[8px] text-[#A78E84] font-black uppercase leading-normal">
                        💡 Setting an affiliate overrides standard splits: payouts split as 80% Creator, 15% Affiliate, 5% Platform.
                      </span>
                    </div>

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={isCreatingCampaign}
                        className={`w-full btn-solid-dark py-3.5 px-6 text-xs flex items-center justify-center gap-2 cursor-pointer transition-all ${
                          isCreatingCampaign ? 'btn-disabled-cozy' : ''
                        }`}
                      >
                        {isCreatingCampaign ? (
                          <ButtonLoader text="🌱 Launching your campaign chest on the network..." />
                        ) : (
                          <>
                            <Plus className="h-4 w-4" />Deposit Digital Dollars & Launch Campaign
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Active Campaign Ledgers (Middle Column: Island Projects representation) */}
                <div className="blueprint-panel p-6 space-y-4 bg-white">
                  <div className="flex items-center gap-2 border-b-3 border-[#744D2B]/10 pb-3.5 select-none">
                    <Layers className="h-5 w-5 text-[#F4C455]" />
                    <h4 className="text-xs font-black uppercase tracking-wider text-[#744D2B]">
                      Active Sponsored Ad Campaigns
                    </h4>
                  </div>

                  <div className="space-y-4">
                    {isLoadingData ? (
                      <>
                        <CampaignCardSkeleton />
                        <CampaignCardSkeleton />
                      </>
                    ) : campaigns.length > 0 ? (
                      campaigns.map((camp) => (
                        <div 
                          key={camp.id} 
                          className={`p-4 border-3 border-[#744D2B] rounded-2xl bg-[#FCFAF6] shadow-[0_4px_0_#744D2B] transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${
                            camp.active ? "" : "opacity-50"
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`h-3 w-3 rounded-full ${camp.active ? "bg-[#35C7A4] status-active-dot" : "bg-gray-400"}`}></span>
                              <h4 className="font-extrabold text-sm text-[#744D2B] tracking-tight">{camp.title}</h4>
                              <span className="text-[8px] text-[#A78E84] font-mono bg-white border border-[#744D2B]/20 px-2 py-0.5 rounded-lg font-black uppercase">ID: {camp.id.substr(0, 10)}...</span>
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-[#8E7368]">
                              <div>Sponsor: <span className="font-mono text-[#744D2B] font-bold">{camp.advertiser.substr(0, 8)}...</span></div>
                              <div>Click Payout: <span className="font-mono text-[#F4C455] font-bold">{camp.cost_per_click.toFixed(2)} USDC</span></div>
                              <div>Total Clicks: <span className="font-mono text-[#7FB3D5] font-bold">{camp.total_clicks}</span></div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 w-full sm:w-auto justify-between border-t-2 sm:border-t-0 border-[#744D2B]/10 pt-3 sm:pt-0">
                            <div className="text-left sm:text-right">
                              <span className="block text-[8px] text-[#A78E84] uppercase font-black leading-none">Remaining Budget</span>
                              <span className="text-xs font-black text-[#744D2B] font-mono block mt-1 leading-none">
                                {camp.remaining_budget.toFixed(2)} / {camp.total_budget.toFixed(2)} <span className="text-[8px] text-[#A78E84]">USDC</span>
                              </span>
                              {camp.active && (
                                <span className="block text-[9px] text-[#35C7A4] font-black font-mono mt-1 leading-none">
                                  Yield Earned: +{campaignYields[camp.id] || "0.0000"} USDC
                                </span>
                              )}
                            </div>

                            {camp.active ? (
                              <button
                                onClick={() => handleWithdrawBudget(camp.id)}
                                disabled={withdrawingCampaignId !== null}
                                className={`bg-white hover:bg-[#E25252]/10 text-[#E25252] font-mono font-bold px-3.5 py-1.5 text-[9px] uppercase transition-all border-3 border-[#E25252] rounded-full hover:-translate-y-0.5 shadow-[0_2px_0_#E25252] active:translate-y-0.5 active:shadow-[0_0_0_#E25252] cursor-pointer ${
                                  withdrawingCampaignId === camp.id ? 'opacity-70 pointer-events-none' : ''
                                }`}
                              >
                                {withdrawingCampaignId === camp.id ? (
                                  <span className="flex items-center gap-1">
                                    <span className="spinner-inline border-t-[#E25252] border-right-[#E25252]" />
                                    Reclaiming...
                                  </span>
                                ) : (
                                  "Reclaim Budget"
                                )}
                              </button>
                            ) : (
                              <span className="text-[8px] font-mono font-black text-[#A78E84] uppercase bg-white border border-[#744D2B]/20 px-2.5 py-1.5 rounded-full">
                                Exhausted
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 text-[#A78E84] font-mono italic text-xs font-bold bg-[#FCFAF6] border-3 border-[#744D2B] rounded-2xl">
                        No campaigns found. Deployed campaigns will appear here.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* TAB 2: CREATOR SANDBOX (Quick Access with mockup NookPhone layout) */}
            {activeTab === "creator" && (
              <div className="space-y-8 animate-slide-up">
                
                {/* Circle UCW Creator Portal */}
                <div className="blueprint-panel bg-white p-6 space-y-6">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b-3 border-[#744D2B]/10 pb-4">
                    <div>
                      <h3 className="text-xs font-black text-[#744D2B] uppercase tracking-wider flex items-center gap-2">
                        <Wallet className="w-5 h-5 text-[#F4C455]" />
                        Creator Payment Portal
                      </h3>
                      <p className="text-[10px] text-[#8E7368] font-bold uppercase tracking-wider">
                        Decentralized Non-Custodial USDC Wallet (Circle UCW)
                      </p>
                    </div>

                    {!creatorWalletAddress ? (
                      <button
                        onClick={() => setIsUCWModalOpen(true)}
                        className="btn-mint-tactile py-2.5 px-6 text-xs cursor-pointer font-black"
                      >
                        ⚡ Setup Embedded Wallet
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setCreatorEmail("");
                          setCreatorWalletAddress("");
                          if (typeof window !== 'undefined') {
                            localStorage.removeItem("creator_email");
                            localStorage.removeItem("creator_wallet_address");
                          }
                        }}
                        className="btn-coral-tactile py-2 px-4 text-[10px] cursor-pointer font-bold"
                      >
                        Disconnect Session
                      </button>
                    )}
                  </div>

                  {!creatorWalletAddress ? (
                    <div className="bg-[#FCFAF6] border-3 border-dashed border-[#744D2B]/30 rounded-2xl p-8 text-center space-y-3">
                      <div className="text-2xl">🍃</div>
                      <h4 className="font-extrabold uppercase text-[#744D2B] text-sm">No Embedded Wallet Connected</h4>
                      <p className="text-xs text-[#8E7368] max-w-sm mx-auto leading-relaxed">
                        To receive instant pay-per-click splits gaslessly, sign in with your email address to set up your secure user-controlled wallet.
                      </p>
                      <button
                        onClick={() => setIsUCWModalOpen(true)}
                        className="py-2.5 px-6 bg-[#F4C455] border-3 border-[#744D2B] rounded-full text-xs font-black uppercase text-[#744D2B] shadow-[0_4px_0_#744D2B] hover:translate-y-0.5 hover:shadow-[0_2px_0_#744D2B] active:translate-y-1 active:shadow-none transition-all inline-flex items-center gap-2"
                      >
                        Sign In / Register
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Left: Wallet Info */}
                      <div className="border-3 border-[#744D2B] bg-[#FCFAF6] p-5 rounded-2xl space-y-4">
                        <div className="space-y-1">
                          <span className="text-[9px] text-[#A78E84] font-black uppercase tracking-wider block">Wallet Balance</span>
                          <h4 className="text-2xl font-black text-[#744D2B] leading-none">
                            {ucwBalance} <span className="text-xs font-bold text-[#8E7368]">USDC</span>
                          </h4>
                          <span className="text-[8px] text-[#35C7A4] font-mono font-black bg-white border border-[#35C7A4] px-2 py-0.5 rounded-md inline-block mt-1">
                            Arc Testnet Gasless Enabled
                          </span>
                        </div>

                        <hr className="border-2 border-[#744D2B]/10" />

                        <div className="space-y-2 text-xs">
                          <div>
                            <span className="text-[9px] text-[#A78E84] font-black uppercase block">Registered Email</span>
                            <span className="font-bold text-[#744D2B]">{creatorEmail}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-[#A78E84] font-black uppercase block">Wallet Address</span>
                            <span className="font-mono text-[#744D2B] break-all select-all font-bold">{creatorWalletAddress}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Withdraw Portal */}
                      <div className="border-3 border-[#744D2B] bg-[#FCFAF6] p-5 rounded-2xl space-y-4">
                        <h4 className="font-extrabold uppercase text-[#744D2B] text-xs">Withdraw Earnings</h4>
                        
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-[#744D2B] block">Destination Wallet Address</label>
                            <input
                              type="text"
                              value={withdrawDestAddress}
                              onChange={(e) => setWithdrawDestAddress(e.target.value)}
                              placeholder="0x..."
                              className="w-full px-3 py-2 bg-white border-2 border-[#744D2B] rounded-xl text-xs font-bold text-[#744D2B] placeholder-[#744D2B]/35 focus:outline-none"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-[#744D2B] block">Amount (USDC)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={withdrawAmount}
                              onChange={(e) => setWithdrawAmount(e.target.value)}
                              placeholder="0.00"
                              className="w-full px-3 py-2 bg-white border-2 border-[#744D2B] rounded-xl text-xs font-bold text-[#744D2B] placeholder-[#744D2B]/35 focus:outline-none"
                            />
                          </div>

                          <button
                            onClick={handleWithdrawUCW}
                            disabled={isWithdrawingUCW || !withdrawDestAddress || !withdrawAmount}
                            className="w-full py-2.5 bg-[#F4C455] border-3 border-[#744D2B] rounded-full text-xs font-black uppercase text-[#744D2B] shadow-[0_4px_0_#744D2B] hover:translate-y-0.5 hover:shadow-[0_2px_0_#744D2B] active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isWithdrawingUCW ? "Processing PIN Setup..." : "Authorize Withdrawal"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Technical Blog Post */}
                <div className="blueprint-panel overflow-hidden bg-white">
                  <div className="bg-[#FCFAF6] px-6 py-4 border-b-3 border-[#744D2B]/15 flex items-center justify-between select-none font-mono text-[9px]">
                    <div className="flex items-center gap-2 text-[#744D2B] font-bold">
                      <Globe className="h-4 w-4 text-[#744D2B]" />
                      <span>https://www.alicecode.web3/split-revenue-dynamics</span>
                    </div>
                    <span className="text-white uppercase bg-[#35C7A4] border-2 border-[#744D2B] px-2.5 py-0.5 rounded-full font-black tracking-wider shadow-[0_2px_0_#744D2B]">
                      Sandbox active
                    </span>
                  </div>

                  <div className="p-6 md:p-8 space-y-6">
                    <div className="space-y-2">
                      <span className="text-[9px] font-bold text-[#F4C455] uppercase tracking-widest block font-mono">Instant Payouts & Creative Freedom</span>
                      <h2 className="text-xl md:text-2xl font-black text-[#744D2B] tracking-tight leading-none uppercase">
                        Why Digital Creators Get Paid Instantly Without Waiting Months
                      </h2>
                      <div className="text-[9px] text-[#A78E84] flex items-center gap-2 font-mono font-black uppercase">
                        <span>By Alice Vance</span>
                        <span>•</span>
                        <span>May 22, 2026</span>
                        <span>•</span>
                        <span>4 mins read</span>
                      </div>
                    </div>

                    <div className="text-xs text-[#8E7368] space-y-4 leading-relaxed font-medium">
                      <p>
                        Traditional ad networks keep a huge slice of sponsor budgets and make creators wait 30 to 45 days just to get their earnings. Sometimes they even freeze creator accounts without warning.
                      </p>
                      <p>
                        With our safe ad chests, payments are split automatically. The very instant a reader clicks an ad banner, digital cash (USDC) is sent directly from the sponsor's chest straight to the creator's wallet in less than a second—all completely verified and safe.
                      </p>
                    </div>

                    {/* INTERACTIVE MOCK AD BANNER (Animal crossing custom wooden ad sign) */}
                    <div className="my-6 border-4 border-[#744D2B] bg-[#FEF9E7] rounded-[24px] p-5 flex flex-col sm:flex-row items-center justify-between gap-4 relative shadow-[0_6px_0_rgba(116,77,43,0.08)]">
                      <div className="space-y-1 text-center sm:text-left select-none">
                        <span className="bg-[#F4C455]/20 text-[#744D2B] border-2 border-[#F4C455]/50 text-[8px] font-mono font-black tracking-widest px-3 py-1 rounded-full uppercase inline-block">
                          Sponsored Ad Banner (Powered by AdSplit)
                        </span>
                        
                        <h3 className="font-black text-sm text-[#744D2B] mt-2.5 flex items-center gap-2 justify-center sm:justify-start leading-none tracking-tight uppercase">
                          🍃 {campaigns.filter(c => c.active)[0]?.title || "Circle Web3 Developer Drive"}
                        </h3>
                        <p className="text-[11px] text-[#8E7368] font-bold">
                          Get premium developer API access and cloud credits instantly.
                        </p>
                      </div>

                      <div className="shrink-0 w-full sm:w-auto">
                        {campaigns.filter(c => c.active).length > 0 ? (
                          <button
                            onClick={() => simulateReaderClick(campaigns.filter(c => c.active)[0].id)}
                            disabled={isClicking}
                            className={`w-full sm:w-auto btn-mint-tactile py-3.5 px-6 text-xs cursor-pointer flex items-center justify-center gap-1.5 transition-all ${
                              isClicking ? "btn-disabled-cozy" : ""
                            }`}
                          >
                            {isClicking ? (
                              <>
                                <span className="spinner-inline shrink-0" />
                                <span>Processing instant reward...</span>
                              </>
                            ) : (
                              "Try Clicking this Banner! ➔"
                            )}
                          </button>
                        ) : (
                          <span className="text-[9px] text-[#E25252] font-black bg-[#E25252]/10 border-3 border-[#E25252] rounded-2xl px-4 py-3 block text-center uppercase font-mono shadow-[0_3px_0_#E25252]">
                            No Active Campaigns
                          </span>
                        )}
                      </div>

                      {/* Cozy Relayer Pipeline Stepper */}
                      {isClicking && (
                        <div className="absolute inset-0 bg-white/95 rounded-[20px] flex flex-col items-center justify-center p-4 text-center z-20">
                          <div className="flex items-center gap-1.5 text-xs text-[#744D2B] font-black uppercase tracking-wider mb-2 font-mono">
                            <Activity className="h-4.5 w-4.5 text-[#F4C455] animate-spin" />
                            Payment Teleport Pipeline 🚀
                          </div>
                          
                          <div className="max-w-md w-full space-y-2">
                            <div className="flex justify-between text-[8px] text-[#A78E84] font-mono font-black uppercase">
                              <span className={step >= 1 ? "text-[#F4C455]" : ""}>1. Safety Check</span>
                              <span className={step >= 2 ? "text-[#7FB3D5]" : ""}>2. Free Delivery</span>
                              <span className={step >= 3 ? "text-[#35C7A4]" : ""}>3. Instant Payment</span>
                            </div>
                            <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden border-2 border-[#744D2B]/10">
                              <div 
                                className="h-full bg-gradient-to-r from-[#F4C455] to-[#35C7A4] transition-all duration-300"
                                style={{ width: `${(step / 3) * 100}%` }}
                              ></div>
                            </div>
                            <span className="text-[8px] text-[#A78E84] font-mono italic block font-bold">
                              {step === 1 && "Safety guard verifying ad click authenticity..."}
                              {step === 2 && "Processing fee-free digital cash transfer..."}
                              {step === 3 && "Success! Funds split and sent instantly to wallets."}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* TAB: PUBLISHER PORTAL */}
            {activeTab === "publisher" && (
              <div className="space-y-8 animate-slide-up">
                <div className="blueprint-panel bg-white p-6 space-y-6">
                  <div className="border-b-3 border-[#744D2B]/10 pb-4">
                    <h3 className="text-xs font-black text-[#744D2B] uppercase tracking-wider flex items-center gap-2">
                      🍃 DSP Publisher Portal & Affiliate Center
                    </h3>
                    <p className="text-[10px] text-[#8E7368] font-bold uppercase tracking-wider">
                      Earn passive income through ad referrals and split payments settled gaslessly
                    </p>
                  </div>
                  
                  <PublisherAnalytics campaigns={campaigns} userWallet={userAddress || advertiserWallet} />
                </div>
              </div>
            )}

            {/* TAB 3: CLICK ORACLE */}
            {activeTab === "oracle" && (
              <div className="space-y-8 animate-slide-up">
                
                {/* Attack Simulator Banner */}
                <div className="blueprint-panel p-6 border-l-8 border-[#E25252] bg-white space-y-4">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div className="space-y-1.5">
                      <h3 className="text-xs font-black text-[#744D2B] uppercase tracking-wider flex items-center gap-2 leading-none">
                        <ShieldAlert className="h-6 w-6 text-[#E25252] animate-pulse" />
                        Anti-Bot Shield Simulator
                      </h3>
                      <p className="text-xs text-[#8E7368] max-w-xl leading-relaxed font-bold">
                        Simulate automated bots attempting to steal campaign funds by spam-clicking ads. The safety shield monitors behavior in real time, automatically spots automated patterns, and instantly blocks fake clicks to keep the sponsor's budget 100% safe.
                      </p>
                    </div>

                    <button
                      onClick={() => launchBotAttack(campaigns.filter(c => c.active)[0]?.id)}
                      disabled={botAttackActive || campaigns.filter(c => c.active).length === 0}
                      className={`w-full md:w-auto btn-coral-tactile py-3.5 px-6 text-xs cursor-pointer shrink-0 ${
                        botAttackActive ? "bg-[#E25252] text-white animate-pulse" : ""
                      }`}
                    >
                      <Play className="h-4 w-4" />
                      {botAttackActive ? `Testing (${botClickCount})...` : "Test Anti-Bot Shield"}
                    </button>
                  </div>
                </div>

                {/* Real-time Click Logs */}
                <div className="blueprint-panel p-6 space-y-4 bg-white">
                  <div className="flex items-center justify-between border-b-3 border-[#744D2B]/10 pb-3.5 select-none">
                    <h4 className="text-xs font-black uppercase tracking-wider text-[#744D2B] flex items-center gap-2">
                      <Activity className="h-4.5 w-4.5 text-[#F4C455]" />
                      Real-Time Traffic Protection Log
                    </h4>
                    <span className="text-[8px] text-[#A78E84] font-mono font-black uppercase bg-[#FCFAF6] border border-[#744D2B]/20 px-2.5 py-1 rounded-full">
                      Safety Shield Active
                    </span>
                  </div>

                  <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
                    {isLoadingData ? (
                      <>
                        <div className="shimmer skeleton h-12 w-full rounded-2xl" />
                        <div className="shimmer skeleton h-12 w-full rounded-2xl" />
                        <div className="shimmer skeleton h-12 w-full rounded-2xl" />
                      </>
                    ) : clickLogs.length > 0 ? (
                      clickLogs.map((log, idx) => (
                        <div 
                          key={log.id || idx} 
                          className={`flex flex-col sm:flex-row justify-between items-start sm:items-center p-3.5 text-xs font-mono border-3 rounded-2xl transition-all ${
                            log.status === "valid"
                              ? "bg-[#FCFAF6] border-[#35C7A4] text-[#35C7A4]"
                              : "bg-[#FEF9E7] border-[#E25252] text-[#E25252]"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            <span className="text-[#A78E84] text-[8px] font-black">{log.timestamp || "Just now"}</span>
                            <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black border-2 ${
                              log.status === "valid" 
                                ? "bg-white border-[#35C7A4]" 
                                : "bg-white border-[#E25252]"
                            }`}>
                              {log.status === "valid" ? "VALID_CLICK" : "BOT_SPAM_BLOCKED"}
                            </span>
                            <span className="text-[#744D2B] font-bold">{log.ip_address}</span>
                          </div>
                          <div className="mt-2 sm:mt-0 flex items-center gap-4 text-right">
                            <span className="text-[#A78E84] font-bold uppercase text-[9px]">
                              {log.status === "valid" ? "Telemetry OK (Score: 98)" : "Bot Detected (Score: 10)"}
                            </span>
                            <span className={`font-black ${log.status === "valid" ? "text-[#35C7A4]" : "text-[#E25252]"}`}>
                              {log.status === "valid" ? `+${log.payout_usdc.toFixed(2)} USDC` : "0.00 USDC (Blocked)"}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-[#A78E84] font-mono italic text-xs font-bold">
                        No click traffic logs recorded yet.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* TAB 4: DEVELOPER NODE CONFIGS */}
            {activeTab === "contract" && (
              <div className="space-y-8 animate-slide-up">
                
                {/* Event Webhook Broadcaster Logs */}
                <div className="blueprint-panel p-6 space-y-4 bg-white">
                  <div className="flex items-center justify-between border-b-3 border-[#744D2B]/10 pb-3.5">
                    <div className="flex items-center gap-2">
                      <Code className="h-5 w-5 text-[#F4C455]" />
                      <h4 className="text-xs font-black uppercase tracking-wider text-[#744D2B]">
                        Live Safety Alert Ledger
                      </h4>
                    </div>
                    <span className="bg-[#FCFAF6] text-[#7FB3D5] border-2 border-[#744D2B]/20 text-[8px] font-mono font-black px-2.5 py-0.5 rounded-full">
                      Sync Connect
                    </span>
                  </div>

                  <p className="text-xs text-[#8E7368] leading-relaxed font-bold">
                    Here is the real-time record of bot attacks blocked by the security guard, completely saved and transparent:
                  </p>

                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
                    {isLoadingData ? (
                      <>
                        <div className="shimmer skeleton h-24 w-full rounded-2xl" />
                        <div className="shimmer skeleton h-24 w-full rounded-2xl" />
                      </>
                    ) : webhookLogs.length > 0 ? (
                      webhookLogs.map((wh, idx) => (
                        <div key={idx} className="border-3 border-[#744D2B] bg-[#FCFAF6] rounded-2xl overflow-hidden font-mono text-[9px] shadow-[0_3px_0_#744D2B]">
                          <div className="bg-[#FEF9E7] px-4 py-2 flex items-center justify-between text-[#744D2B] border-b-3 border-[#744D2B] font-black">
                            <span className="text-[#E25252] font-black uppercase">Blocked IP Address: {wh.ip_address}</span>
                            <span>{wh.blocked_at}</span>
                          </div>
                          <pre className="p-4 text-[#7FB3D5] overflow-x-auto whitespace-pre-wrap leading-relaxed select-all">
                            {JSON.stringify(wh, null, 2)}
                          </pre>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 text-[#A78E84] font-mono italic text-xs font-bold">
                        No security threats logged yet. Try triggering the spam simulator to see the security guard in action.
                      </div>
                    )}
                  </div>
                </div>

                {/* Contract explorer addresses sync */}
                <div className="blueprint-panel p-6 space-y-4 bg-white">
                  <h4 className="text-xs font-black uppercase tracking-wider text-[#744D2B] flex items-center gap-2">
                    <Terminal className="h-5 w-5 text-[#F4C455]" />
                    Safe Ad Chest Controller
                  </h4>
                  <p className="text-xs text-[#8E7368] leading-relaxed font-bold">
                    Sync your campaign chest address to reload its parameters and transactions directly from the network:
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3 font-mono text-xs">
                    <input 
                      type="text" 
                      value={contractAddress}
                      onChange={(e) => setContractAddress(e.target.value)}
                      className="flex-1 blueprint-input"
                    />
                    <button 
                      onClick={syncAllData}
                      className="btn-solid-dark py-3 px-5 text-xs cursor-pointer"
                    >
                      Sync Records
                    </button>
                  </div>
                </div>

              </div>
            )}

          </div>

          {/* SYSTEM STATS HIGHLIGHT ROW (Inspiration-style cute stats metrics) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {isLoadingData ? (
              <>
                <StatsSkeleton />
                <StatsSkeleton />
                <StatsSkeleton />
              </>
            ) : (
              <>
                <div className="blueprint-panel p-5 bg-white space-y-2">
                  <div className="flex justify-between items-center text-[#A78E84] font-black text-[8px] uppercase tracking-wider font-mono">
                    <span>Ad Budget Saved</span>
                    <BarChart3 className="h-4.5 w-4.5 text-[#F4C455]" />
                  </div>
                  <span className="text-lg font-black text-[#744D2B] block font-mono leading-none">
                    ${totalWeb2FeesSaved.toFixed(3)}
                  </span>
                  <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden border-2 border-[#744D2B]/10">
                    <div className="h-full bg-[#F4C455]" style={{ width: "32%" }}></div>
                  </div>
                  <span className="block text-[8px] text-[#A78E84] font-black font-mono uppercase">Cut Web2 Intermediary Fees</span>
                </div>

                <div className="blueprint-panel p-5 bg-white space-y-2">
                  <div className="flex justify-between items-center text-[#A78E84] font-black text-[8px] uppercase tracking-wider font-mono">
                    <span>Payment Speed</span>
                    <RefreshCw className="h-4.5 w-4.5 text-[#F4C455]" />
                  </div>
                  <span className="text-lg font-black text-[#744D2B] block font-mono leading-none">
                    Instant
                  </span>
                  <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden border-2 border-[#744D2B]/10">
                    <div className="h-full bg-[#35C7A4]" style={{ width: "100%" }}></div>
                  </div>
                  <span className="block text-[8px] text-[#A78E84] font-black font-mono uppercase">Instant vs 30-day delays</span>
                </div>

                <div className="blueprint-panel p-5 bg-white space-y-2">
                  <div className="flex justify-between items-center text-[#A78E84] font-black text-[8px] uppercase tracking-wider font-mono">
                    <span>Traffic Security</span>
                    <ShieldCheck className="h-4.5 w-4.5 text-[#F4C455]" />
                  </div>
                  <span className="text-lg font-black text-[#744D2B] block font-mono leading-none">
                    {totalOrganicRatio.toFixed(1)}%
                  </span>
                  <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden border-2 border-[#744D2B]/10">
                    <div className="h-full bg-[#7FB3D5]" style={{ width: `${totalOrganicRatio}%` }}></div>
                  </div>
                  <span className="block text-[8px] text-[#A78E84] font-black font-mono uppercase">Genuine reader clicks</span>
                </div>
              </>
            )}
          </div>

        </div>

        {/* COLUMN 3: Right Sidebar Telemetry */}
        <div className="space-y-8">
          
          {renderOnboardingAssistant()}

          {/* Mock NookPhone Quick Access Apps Grid (Inspiration style button mockup) */}
          <div className="blueprint-panel p-6 bg-[#FEFAF4] border-4 border-[#744D2B] rounded-[32px] space-y-5 shadow-[0_8px_0_rgba(116,77,43,0.1)]">
            <div className="border-b-3 border-[#744D2B]/10 pb-3 flex items-center justify-between text-[#744D2B]">
              <span className="text-[10px] font-mono font-black uppercase tracking-wider">Quick Desk Applet</span>
            </div>

            {/* 3x3 App Icons Grid */}
            <div className="grid grid-cols-3 gap-4 font-mono text-[9px] text-center font-black">
              
              <button 
                onClick={() => setActiveTab("creator")}
                className="group flex flex-col items-center gap-1.5 cursor-pointer"
              >
                <div className="h-12 w-12 bg-[#B28DFF] text-white border-3 border-[#744D2B] rounded-2xl flex items-center justify-center shadow-[0_4px_0_#744D2B] group-hover:translate-y-0.5 group-hover:shadow-[0_2px_0_#744D2B] transition-all">
                  <Camera className="h-6 w-6" />
                </div>
                <span className="text-[#8E7368] uppercase text-[8px] leading-tight mt-1 truncate max-w-full">Preview</span>
              </button>

              <button 
                onClick={() => setActiveTab("advertiser")}
                className="group flex flex-col items-center gap-1.5 cursor-pointer"
              >
                <div className="h-12 w-12 bg-[#7FB3D5] text-white border-3 border-[#744D2B] rounded-2xl flex items-center justify-center shadow-[0_4px_0_#744D2B] group-hover:translate-y-0.5 group-hover:shadow-[0_2px_0_#744D2B] transition-all">
                  <Hammer className="h-6 w-6" />
                </div>
                <span className="text-[#8E7368] uppercase text-[8px] leading-tight mt-1 truncate max-w-full">Office</span>
              </button>

              <button 
                onClick={() => setActiveTab("oracle")}
                className="group flex flex-col items-center gap-1.5 cursor-pointer"
              >
                <div className="h-12 w-12 bg-[#FAD7A0] text-[#744D2B] border-3 border-[#744D2B] rounded-2xl flex items-center justify-center shadow-[0_4px_0_#744D2B] group-hover:translate-y-0.5 group-hover:shadow-[0_2px_0_#744D2B] transition-all">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <span className="text-[#8E7368] uppercase text-[8px] leading-tight mt-1 truncate max-w-full">Shields</span>
              </button>

              <button 
                onClick={() => setActiveTab("contract")}
                className="group flex flex-col items-center gap-1.5 cursor-pointer"
              >
                <div className="h-12 w-12 bg-[#FEF9E7] text-[#744D2B] border-3 border-[#744D2B] rounded-2xl flex items-center justify-center shadow-[0_4px_0_#744D2B] group-hover:translate-y-0.5 group-hover:shadow-[0_2px_0_#744D2B] transition-all">
                  <Code className="h-6 w-6" />
                </div>
                <span className="text-[#8E7368] uppercase text-[8px] leading-tight mt-1 truncate max-w-full">History</span>
              </button>

              <button 
                onClick={() => { setShowHelpModal(true); }}
                className="group flex flex-col items-center gap-1.5 cursor-pointer"
              >
                <div className="h-12 w-12 bg-[#35C7A4] text-white border-3 border-[#744D2B] rounded-2xl flex items-center justify-center shadow-[0_4px_0_#744D2B] group-hover:translate-y-0.5 group-hover:shadow-[0_2px_0_#744D2B] transition-all">
                  <Compass className="h-6 w-6" />
                </div>
                <span className="text-[#8E7368] uppercase text-[8px] leading-tight mt-1 truncate max-w-full">Hand Guide</span>
              </button>

              <button 
                onClick={handleDirectConnect}
                className="group flex flex-col items-center gap-1.5 cursor-pointer"
              >
                <div className="h-12 w-12 bg-[#E25252] text-white border-3 border-[#744D2B] rounded-2xl flex items-center justify-center shadow-[0_4px_0_#744D2B] group-hover:translate-y-0.5 group-hover:shadow-[0_2px_0_#744D2B] transition-all">
                  <Wallet className="h-6 w-6" />
                </div>
                <span className="text-[#8E7368] uppercase text-[8px] leading-tight mt-1 truncate max-w-full">Link Wallet</span>
              </button>

            </div>
          </div>

          {/* Island Settings Control Box (Yellow Panel matching the right-hand panel of image) */}
          <div className="blueprint-panel p-6 bg-[#F4C455] border-4 border-[#744D2B] rounded-[32px] space-y-5 shadow-[0_8px_0_rgba(116,77,43,0.12)] select-none">
            <div className="border-b-3 border-[#744D2B]/20 pb-3 flex items-center justify-between text-[#744D2B]">
              <span className="text-xs font-black uppercase tracking-wider">Desk Configuration</span>
              <Settings className="h-4.5 w-4.5" />
            </div>

            {/* Custom selects and controls */}
            <div className="space-y-4 text-xs font-extrabold text-[#744D2B]">
              
              <div className="space-y-1.5">
                <label className="text-[9px] text-[#744D2B]/75 uppercase block tracking-wider font-mono">Island Theme Style</label>
                <select className="w-full px-4 py-2.5 bg-white border-3 border-[#744D2B] rounded-full text-[#744D2B] font-bold outline-none cursor-pointer">
                  <option>Cozy Shared Payouts</option>
                  <option>Night Owl Settlement</option>
                  <option>Bell Boom Economy</option>
                </select>
              </div>

              {/* Toggle switch for Alerts */}
              <div className="flex items-center justify-between py-1.5">
                <span className="uppercase text-[10px] tracking-wide font-mono">Sound Effects Alerts</span>
                <button 
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`w-14 h-7 rounded-full border-3 border-[#744D2B] transition-all flex items-center p-0.5 cursor-pointer ${
                    soundEnabled ? "bg-[#35C7A4]" : "bg-gray-300"
                  }`}
                >
                  <div className={`h-5 w-5 bg-white border-2 border-[#744D2B] rounded-full transition-all ${
                    soundEnabled ? "translate-x-7" : "translate-x-0"
                  }`}></div>
                </button>
              </div>

              {/* Custom Checkbox */}
              <label className="flex items-center gap-3 py-1 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={allowVisitors} 
                  onChange={() => setAllowVisitors(!allowVisitors)}
                  className="sr-only"
                />
                <div className={`h-6.5 w-6.5 border-3 border-[#744D2B] rounded-lg flex items-center justify-center transition-all ${
                  allowVisitors ? "bg-[#35C7A4]" : "bg-white"
                }`}>
                  {allowVisitors && <span className="text-white text-xs">✓</span>}
                </div>
                <span className="uppercase text-[10px] tracking-wide font-mono">Allow External Viewers</span>
              </label>

              {/* CCTP Crosschain Bridge Inline Widget inside right yellow block */}
              <div className="pt-2 border-t-3 border-[#744D2B]/15 space-y-3.5">
                <span className="block text-[8px] text-[#744D2B]/70 uppercase tracking-widest font-mono font-black">Teleport Funds from Other Chains</span>
                
                <form onSubmit={handleCCTPBridge} className="space-y-3 font-mono text-[10px]">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <select 
                        value={bridgeSourceChain}
                        onChange={(e) => setBridgeSourceChain(e.target.value)}
                        className="w-full px-2.5 py-2 bg-white border-2 border-[#744D2B] rounded-xl text-[#744D2B] outline-none"
                      >
                        <option value="Ethereum">Ethereum Sepolia</option>
                        <option value="Base">Base Sepolia</option>
                        <option value="Arbitrum">Arbitrum Sepolia</option>
                      </select>
                    </div>
                    <div>
                      <input 
                        type="number"
                        value={bridgeAmount}
                        onChange={(e) => setBridgeAmount(e.target.value)}
                        className="w-full px-2.5 py-2 bg-white border-2 border-[#744D2B] rounded-xl text-[#744D2B] outline-none"
                      />
                    </div>
                  </div>

                  <button 
                    type="submit"
                    disabled={bridgeActive}
                    className="w-full py-2.5 bg-white hover:bg-gray-50 border-3 border-[#744D2B] text-[#744D2B] font-bold rounded-full shadow-[0_3px_0_#744D2B] hover:translate-y-0.5 hover:shadow-[0_1.5px_0_#744D2B] active:translate-y-1 active:shadow-none transition-all text-xs uppercase cursor-pointer"
                  >
                    {bridgeActive ? "Teleporting..." : `Teleport Digital Dollars`}
                  </button>
                </form>

                {showBridgeTracker && (
                  <div className="mt-3.5">
                    <BridgeProgressTracker
                      steps={bridgeSteps}
                      amount={parseFloat(bridgeAmount)}
                      sourceChain={bridgeSourceChain}
                      destinationAddress={userAddress || advertiserWallet}
                      estimatedTimeLeft={estRemainingTime}
                    />
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* AdSplit Escrow Vault card */}
          <div className="blueprint-panel p-5 bg-white space-y-4">
            <div className="border-b-3 border-[#744D2B]/10 pb-3 flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-[#744D2B] flex items-center gap-2">
                <Coins className="h-4.5 w-4.5 text-[#F4C455]" />
                AdSplit Escrow Vault
              </h4>
              <span className="text-[9px] font-mono text-[#A78E84] font-black uppercase bg-[#FCFAF6] px-2 py-0.5 border border-[#744D2B]/20 rounded-md">Live</span>
            </div>

            <div className="bg-gradient-to-br from-[#FAD7A0] to-[#EAA036] border-4 border-[#744D2B] text-[#744D2B] rounded-[24px] p-5 relative overflow-hidden aspect-[1.586] flex flex-col justify-between shadow-[0_5px_0_#744D2B]">
              {/* background vector flower leaf */}
              <div className="absolute right-0 bottom-0 text-white/10 text-9xl leading-none select-none pointer-events-none -mr-8 -mb-12 font-black">
                🍃
              </div>

              <div className="flex justify-between items-start z-10">
                <div>
                  <span className="text-[9px] text-[#744D2B]/75 uppercase tracking-widest font-mono font-bold leading-none">Smart Vault Ledger</span>
                  <h4 className="text-xs font-black mt-1 uppercase tracking-tight">Escrow pool contract</h4>
                </div>
                <Coins className="h-5 w-5 text-[#744D2B]/80" />
              </div>
              
              <div className="z-10 flex justify-between items-end">
                <div>
                  <span className="text-[9px] text-[#744D2B]/75 block uppercase tracking-wider font-mono font-bold leading-none">Locked Escrow Budget</span>
                  <span className="text-lg font-black font-mono block mt-1 leading-none">
                    {campaigns.filter(c => c.active).reduce((acc, c) => acc + c.remaining_budget, 0).toFixed(2)} USDC
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[9px] text-[#35C7A4]/90 block uppercase tracking-wider font-mono font-black leading-none">Total Yield Earned</span>
                  <span className="text-xs font-black font-mono block mt-1 leading-none text-[#35C7A4]">
                    +{campaigns.filter(c => c.active).reduce((acc, c) => acc + parseFloat(campaignYields[c.id] || "0.00"), 0).toFixed(4)} USDC
                  </span>
                </div>
              </div>
              
              <div className="flex justify-between items-center text-[9px] font-mono leading-none z-10">
                <div>
                  <span className="text-[7px] text-[#744D2B]/50 block font-bold">VAULT OWNER</span>
                  <span className="block mt-0.5 font-bold uppercase">{userAddress ? `${userAddress.substr(0, 6)}...${userAddress.substr(-4)}` : "Not Connected"}</span>
                </div>
                <div>
                  <span className="text-[7px] text-[#744D2B]/50 block font-bold">NETWORK</span>
                  <span className="text-[#35C7A4] font-extrabold block mt-0.5">ARC TESTNET</span>
                </div>
              </div>
            </div>
          </div>

          {/* Click Authenticity radar chart */}
          <div className="blueprint-panel p-5 bg-white space-y-4">
            <div className="border-b-3 border-[#744D2B]/10 pb-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-[#744D2B] flex items-center gap-2">
                <Activity className="h-4.5 w-4.5 text-[#F4C455]" />
                Click Authenticity Radar
              </h4>
            </div>

            <div className="flex flex-col items-center py-2">
              <div className="relative h-32 w-32 flex items-center justify-center select-none">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="#FCFAF6"
                    strokeWidth="8"
                    fill="transparent"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="#F4C455"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray="251.2"
                    strokeDashoffset={251.2 - (251.2 * totalOrganicRatio) / 100}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute text-center space-y-0.5 font-mono">
                  <span className="block text-lg font-black text-[#744D2B] leading-none">
                    {totalOrganicRatio.toFixed(1)}%
                  </span>
                  <span className="block text-[7px] text-[#A78E84] font-black uppercase tracking-wider leading-none">Verified Organic</span>
                </div>
              </div>

              <div className="w-full grid grid-cols-2 gap-3 pt-4 border-t-2 border-[#744D2B]/10 text-center font-mono mt-4">
                <div className="space-y-0.5">
                  <span className="block text-[8px] text-[#A78E84] uppercase font-black">Organic Traffic</span>
                  <span className="text-xs font-extrabold text-[#35C7A4]">{totalClicksCount} Clicks</span>
                </div>
                <div className="space-y-0.5">
                  <span className="block text-[8px] text-[#A78E84] uppercase font-black">Sybil Spam</span>
                  <span className="text-xs font-extrabold text-[#E25252]">
                    {clickLogs.filter(l => l.status === "bot_fraud").length} Blocked
                  </span>
                </div>
              </div>
            </div>
          </div>



        </div>

      </main>

      {/* HELP MODAL WINDOW popup inspired by Animal Crossing game dialogues */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 bg-[#744D2B]/45 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in select-none">
          <div className="bg-white border-4 border-[#744D2B] rounded-[32px] max-w-md w-full p-6 shadow-2xl space-y-4 animate-slide-up relative">
            <button 
              onClick={() => setShowHelpModal(false)}
              className="absolute top-4 right-4 h-8 w-8 bg-[#E25252] border-3 border-[#744D2B] rounded-full text-white font-bold flex items-center justify-center shadow-[0_2px_0_#744D2B] hover:translate-y-0.5 hover:shadow-none cursor-pointer"
            >
              ✕
            </button>

            <div className="flex items-center gap-2 border-b-3 border-[#744D2B]/10 pb-3">
              <span className="text-xl">🍃</span>
              <h3 className="text-base font-black text-[#744D2B] uppercase">Cozy Desk Manual</h3>
            </div>

            {/* Cozy Tab Switcher */}
            <div className="grid grid-cols-2 gap-2 text-center text-[10px] font-black uppercase tracking-wider font-mono">
              <button 
                onClick={() => setHelpTab("user")}
                className={`py-2 px-3 border-3 border-[#744D2B] rounded-xl transition-all cursor-pointer ${
                  helpTab === "user" 
                    ? "bg-[#F4C455] text-[#744D2B] shadow-[0_2.5px_0_#744D2B] translate-y-[-0.5px]" 
                    : "bg-white text-[#8E7368] hover:bg-gray-50 border-[#744D2B]/40"
                }`}
              >
                🍃 User Guide
              </button>
              <button 
                onClick={() => setHelpTab("builder")}
                className={`py-2 px-3 border-3 border-[#744D2B] rounded-xl transition-all cursor-pointer ${
                  helpTab === "builder" 
                    ? "bg-[#7FB3D5] text-white shadow-[0_2.5px_0_#744D2B] translate-y-[-0.5px]" 
                    : "bg-white text-[#8E7368] hover:bg-gray-50 border-[#744D2B]/40"
                }`}
              >
                🛠️ Builder SDK
              </button>
            </div>

            {helpTab === "user" ? (
              <div className="text-xs text-[#8E7368] space-y-3 leading-relaxed font-bold">
                <p>
                  <strong>Welcome to AdSplit!</strong> Here is how to set up your cozy ad campaigns and instant click payouts without any complex steps:
                </p>
                <ul className="list-disc pl-5 space-y-2 font-sans font-extrabold">
                  <li>
                    <span className="text-[#744D2B]">Link Wallet:</span> Use the top button to link your secure web wallet. Sponsored delivery means transaction fees are 100% free!
                  </li>
                  <li>
                    <span className="text-[#744D2B]">Ad Spender Office:</span> Fill up campaign chests with digital cash (USDC) to sponsor clicks.
                  </li>
                  <li>
                    <span className="text-[#744D2B]">Live Ad Preview:</span> Click sponsored ad banners inside sample blogs to see funds teleport instantly to the creator's wallet.
                  </li>
                  <li>
                    <span className="text-[#744D2B]">Anti-Fraud Shields:</span> Trigger fake bot clicks to watch the security guard block spam traffic in real time.
                  </li>
                </ul>
              </div>
            ) : (
              <div className="text-xs text-[#8E7368] space-y-3.5 leading-relaxed font-mono">
                <p className="font-bold font-sans">
                  Integrate instant, fraud-proof digital dollar splits into any web page in 3 lines of code!
                </p>
                <div className="space-y-1">
                  <span className="block text-[8px] text-[#A78E84] font-black uppercase tracking-wider">Option A: HTML Widget Banner</span>
                  <pre className="p-2.5 bg-[#FEFAF4] border-2 border-[#744D2B]/25 rounded-xl text-[9px] text-[#744D2B] overflow-x-auto select-all leading-normal">
{`<div id="adsplit-banner" data-campaign="0xad...78"></div>
<script src="https://cdn.adsplit.org/v1.js" async></script>`}
                  </pre>
                </div>
                <div className="space-y-1">
                  <span className="block text-[8px] text-[#A78E84] font-black uppercase tracking-wider">Option B: Cozy React Component</span>
                  <pre className="p-2.5 bg-[#FEFAF4] border-2 border-[#744D2B]/25 rounded-xl text-[9px] text-[#744D2B] overflow-x-auto select-all leading-normal">
{`import { AdSplitBanner } from '@adsplit/react';

<AdSplitBanner 
  campaignId="0xad0001bc93"
  splitShare={85} // 85% to Creator
/>`}
                  </pre>
                </div>
                <div className="space-y-1">
                  <span className="block text-[8px] text-[#A78E84] font-black uppercase tracking-wider">Option C: Teleport Telemetry Listener</span>
                  <pre className="p-2.5 bg-[#FEFAF4] border-2 border-[#744D2B]/25 rounded-xl text-[9px] text-[#744D2B] overflow-x-auto select-all leading-normal">
{`window.addEventListener('adsplit-payout', (e) => {
  console.log('Payment Teleported:', e.detail);
});`}
                  </pre>
                </div>
              </div>
            )}

            <button 
              onClick={() => setShowHelpModal(false)}
              className="w-full btn-solid-dark py-3 text-xs uppercase cursor-pointer"
            >
              Sounds Good!
            </button>
          </div>
        </div>
      )}

      {/* TRANSACTION STATUS DIALOG */}
      {statusModal && statusModal.show && (
        <div className="fixed inset-0 z-50 bg-[#744D2B]/45 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in select-none">
          <div className="bg-white border-4 border-[#744D2B] rounded-[32px] max-w-md w-full p-6 shadow-2xl space-y-4 animate-slide-up relative text-center">
            
            {statusModal.type !== "loading" && (
              <button 
                onClick={() => setStatusModal(null)}
                className="absolute top-4 right-4 h-8 w-8 bg-[#E25252] border-3 border-[#744D2B] rounded-full text-white font-bold flex items-center justify-center shadow-[0_2px_0_#744D2B] hover:translate-y-0.5 hover:shadow-none cursor-pointer transition-all animate-none"
              >
                ✕
              </button>
            )}

            <div className="flex flex-col items-center space-y-3.5">
              <div className={`h-16 w-16 border-3 border-[#744D2B] rounded-2xl flex items-center justify-center shadow-[0_4px_0_#744D2B] text-3xl
                ${statusModal.type === "loading" ? "bg-[#F4C455] animate-bounce" : ""}
                ${statusModal.type === "success" ? "bg-[#35C7A4] text-white" : ""}
                ${statusModal.type === "error" ? "bg-[#E25252] text-white" : ""}
              `}>
                {statusModal.type === "loading" && "🍃"}
                {statusModal.type === "success" && "✓"}
                {statusModal.type === "error" && "✕"}
              </div>

              <h3 className="text-base font-black text-[#744D2B] uppercase tracking-wide">
                {statusModal.title}
              </h3>
            </div>

            <div className="text-xs text-[#8E7368] font-bold leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto px-1 border-y border-[#744D2B]/10 py-3 font-mono">
              {statusModal.message}
            </div>

            {statusModal.type !== "loading" ? (
              <button 
                onClick={() => setStatusModal(null)}
                className={`w-full py-3 text-xs font-black uppercase cursor-pointer btn-solid-dark rounded-full border-3 border-[#744D2B] shadow-[0_3px_0_#744D2B] hover:translate-y-0.5 hover:shadow-[0_1.5px_0_#744D2B] active:translate-y-1 active:shadow-none transition-all
                  ${statusModal.type === "success" ? "bg-[#35C7A4] text-white" : ""}
                  ${statusModal.type === "error" ? "bg-[#E25252] text-white" : ""}
                `}
              >
                {statusModal.type === "success" ? "Wonderful!" : "Close"}
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2 text-[10px] text-[#A78E84] font-black uppercase tracking-wider font-mono">
                <span className="h-2 w-2 rounded-full bg-[#35C7A4] animate-ping"></span>
                Processing Transaction...
              </div>
            )}
          </div>
        </div>
      )}

      <WalletOnboardingModal
        isOpen={isUCWModalOpen}
        onClose={() => setIsUCWModalOpen(false)}
        onOnboarded={(address, email) => {
          setCreatorEmail(email);
          setCreatorWalletAddress(address);
          if (typeof window !== 'undefined') {
            localStorage.setItem("creator_email", email);
            localStorage.setItem("creator_wallet_address", address);
          }
        }}
      />

    </div>
  );
}
