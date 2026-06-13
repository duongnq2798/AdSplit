import { NextResponse } from 'next/server';
import { createWalletClient, createPublicClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';

const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';

const ERC20_ABI = [
  {
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const;

export async function POST(request: Request) {
  try {
    const { walletAddress } = await request.json();
    if (!walletAddress) {
      return NextResponse.json({ error: 'walletAddress is required' }, { status: 400 });
    }

    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!deployerKey) {
      return NextResponse.json({ error: 'DEPLOYER_PRIVATE_KEY is not configured' }, { status: 500 });
    }

    const formattedKey = deployerKey.startsWith('0x') ? deployerKey : `0x${deployerKey}`;
    const account = privateKeyToAccount(formattedKey as `0x${string}`);

    const publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http('https://rpc.testnet.arc.network')
    });

    const walletClient = createWalletClient({
      chain: arcTestnet,
      transport: http('https://rpc.testnet.arc.network'),
      account
    });

    console.log(`[Fund API] Funding wallet ${walletAddress} with 0.1 USDC micro-grant on Arc Testnet...`);

    // Let's send a transaction of 0.1 USDC (6 decimals)
    const amount = parseUnits('0.1', 6);
    
    const { request: txRequest } = await publicClient.simulateContract({
      account,
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [walletAddress as `0x${string}`, amount]
    });

    const hash = await walletClient.writeContract(txRequest);
    console.log(`[Fund API] Micro-grant transaction sent: ${hash}`);

    return NextResponse.json({
      success: true,
      hash,
      amount: '0.1 USDC'
    });
  } catch (error: any) {
    console.error('[Fund API] Failed to send micro-grant:', error);
    // Even if funding fails (e.g. rate limit, balance issue, rpc down), we return a warning instead of 500
    // so the onboarding flow isn't completely blocked
    return NextResponse.json({
      success: false,
      warning: 'Micro-grant funding failed, but wallet setup is complete.',
      error: error.message
    });
  }
}
