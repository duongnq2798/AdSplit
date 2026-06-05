import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http, keccak256, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet, sepolia, baseSepolia, arbitrumSepolia } from 'viem/chains';
import { createClient } from '@supabase/supabase-js';
import { CCTP_NETWORKS, bytes32ToAddress, addressToBytes32 } from '@/utils/cctp-bridge';

// Ensure targeting correct adsplit schema
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project-id.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'your-anon-key';

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: {
    schema: 'adsplit'
  }
});

const MessageSentABI = {
  anonymous: false,
  inputs: [{ indexed: false, name: 'message', type: 'bytes' }],
  name: 'MessageSent',
  type: 'event'
} as const;

const DepositForBurnABI = {
  anonymous: false,
  inputs: [
    { indexed: true, name: 'nonce', type: 'uint64' },
    { indexed: true, name: 'burnToken', type: 'address' },
    { indexed: false, name: 'amount', type: 'uint256' },
    { indexed: true, name: 'depositor', type: 'address' },
    { indexed: false, name: 'mintRecipient', type: 'bytes32' },
    { indexed: false, name: 'destinationDomain', type: 'uint32' },
    { indexed: false, name: 'destinationTokenMessenger', type: 'bytes32' },
    { indexed: false, name: 'destinationCaller', type: 'bytes32' }
  ],
  name: 'DepositForBurn',
  type: 'event'
} as const;

const MessageTransmitterABI = [
  {
    inputs: [
      { internalType: 'bytes', name: 'message', type: 'bytes' },
      { internalType: 'bytes', name: 'attestation', type: 'bytes' }
    ],
    name: 'receiveMessage',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const;

export async function POST(req: NextRequest) {
  try {
    const { burnTxHash, fromChain, campaignId } = await req.json();

    if (!burnTxHash || !fromChain) {
      return NextResponse.json({ error: 'Missing burnTxHash or fromChain parameter' }, { status: 400 });
    }

    const sourceNetwork = CCTP_NETWORKS[fromChain as keyof typeof CCTP_NETWORKS];
    if (!sourceNetwork) {
      return NextResponse.json({ error: `Unsupported source chain: ${fromChain}` }, { status: 400 });
    }

    // Determine target viem chain definition for RPC client
    const sourceChainDef = 
      fromChain === 'Ethereum' ? sepolia : 
      fromChain === 'Arbitrum' ? arbitrumSepolia : 
      baseSepolia;

    // 1. Fetch transaction receipt on the source chain (with RPC error handling)
    let receipt;
    try {
      const publicClient = createPublicClient({
        chain: sourceChainDef,
        transport: http(sourceNetwork.rpc),
      });

      receipt = await publicClient.getTransactionReceipt({ hash: burnTxHash });
    } catch (rpcErr: any) {
      console.error(`Source chain RPC failure for ${fromChain}:`, rpcErr);
      return NextResponse.json({ 
        error: 'Failed to query source chain RPC. Please verify the transaction hash or try again later.', 
        details: rpcErr?.message 
      }, { status: 502 });
    }

    if (!receipt) {
      return NextResponse.json({ error: 'Transaction receipt not found on source chain' }, { status: 404 });
    }

    // 2. Decode MessageSent and DepositForBurn logs
    let messageHex: `0x${string}` | undefined;
    let mintRecipientBytes32: string | undefined;
    let amountRaw: bigint | undefined;

    try {
      const messageSentLogs = parseEventLogs({
        abi: [MessageSentABI],
        eventName: 'MessageSent',
        logs: receipt.logs
      });

      const depositForBurnLogs = parseEventLogs({
        abi: [DepositForBurnABI],
        eventName: 'DepositForBurn',
        logs: receipt.logs
      });

      if (messageSentLogs.length > 0) {
        messageHex = messageSentLogs[0].args.message;
      }
      if (depositForBurnLogs.length > 0) {
        mintRecipientBytes32 = depositForBurnLogs[0].args.mintRecipient;
        amountRaw = depositForBurnLogs[0].args.amount;
      }
    } catch (decodeErr) {
      console.error('Failed to parse CCTP logs:', decodeErr);
      return NextResponse.json({ error: 'Failed to decode CCTP logs from receipt' }, { status: 400 });
    }

    if (!messageHex || !mintRecipientBytes32 || amountRaw === undefined) {
      return NextResponse.json({ error: 'Receipt is missing required CCTP logs' }, { status: 400 });
    }

    const recipientAddress = bytes32ToAddress(mintRecipientBytes32);
    const amountUSDC = Number(amountRaw) / 1000000;

    // 3. Security Check: Validate campaign advertiser matches destination recipient
    if (campaignId) {
      const { data: campaign, error: campaignErr } = await supabase
        .from('campaigns')
        .select('advertiser, active')
        .eq('id', campaignId)
        .maybeSingle();

      if (campaignErr) {
        console.error('Database campaign lookup error:', campaignErr);
        return NextResponse.json({ error: 'Failed to verify campaign metadata' }, { status: 500 });
      }

      if (!campaign) {
        return NextResponse.json({ error: `Campaign not found in database: ${campaignId}` }, { status: 404 });
      }

      if (recipientAddress.toLowerCase() !== campaign.advertiser.toLowerCase()) {
        return NextResponse.json({ 
          error: `Security violation: USDC recipient ${recipientAddress} does not match campaign advertiser ${campaign.advertiser}` 
        }, { status: 403 });
      }
    }

    // 4. Compute Message Hash and double-claim check
    const messageHash = keccak256(messageHex);

    // Save claim status to DB to prevent concurrent execution replay attacks
    try {
      const { error: insertErr } = await supabase
        .from('bridge_claims')
        .insert([{
          burn_tx_hash: burnTxHash,
          campaign_id: campaignId || null,
          source_chain: fromChain,
          recipient_address: recipientAddress,
          amount: amountUSDC,
          status: 'claiming'
        }]);

      if (insertErr && insertErr.code === '23505') {
        return NextResponse.json({ error: 'This transaction is already being claimed or has been completed.' }, { status: 409 });
      }
    } catch (dbErr) {
      console.warn('Replay check table bridge_claims might not be active, bypassing...', dbErr);
    }

    // 5. Poll Attestation service (Iris Sandbox API)
    const attestationUrl = `https://iris-api-sandbox.circle.com/v1/attestations/${messageHash}`;
    let attestationHex = '';
    let retries = 10;
    
    while (retries > 0) {
      try {
        console.log(`Polling CCTP attestation for message ${messageHash} (attempts left: ${retries})...`);
        const res = await fetch(attestationUrl);
        const data = await res.json();
        
        if (data && data.status === 'complete' && data.attestation) {
          attestationHex = data.attestation;
          break;
        }
      } catch (pollErr) {
        console.warn('Error polling attestation:', pollErr);
      }
      
      retries--;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    if (!attestationHex) {
      // Keep track of pending state
      try {
        await supabase
          .from('bridge_claims')
          .update({ status: 'pending_attestation' })
          .eq('burn_tx_hash', burnTxHash);
      } catch {}

      return NextResponse.json({ 
        status: 'PENDING_ATTESTATION', 
        messageHash, 
        messageHex,
        recipientAddress,
        amountUSDC,
        message: 'Circle CCTP attestation is still processing. Please try again in a few seconds.'
      });
    }

    // 6. Claim USDC on Arc Testnet via MessageTransmitter
    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!deployerKey) {
      return NextResponse.json({ error: 'Server configuration error: missing DEPLOYER_PRIVATE_KEY' }, { status: 500 });
    }

    let claimTxHash: `0x${string}`;
    try {
      const formattedKey = deployerKey.startsWith('0x') ? deployerKey : `0x${deployerKey}`;
      const account = privateKeyToAccount(formattedKey as `0x${string}`);

      const client = createWalletClient({
        account,
        chain: arcTestnet,
        transport: http(CCTP_NETWORKS.Arc.rpc)
      });

      const publicArcClient = createPublicClient({
        chain: arcTestnet,
        transport: http(CCTP_NETWORKS.Arc.rpc)
      });

      const { request } = await publicArcClient.simulateContract({
        account,
        address: CCTP_NETWORKS.Arc.messageTransmitter,
        abi: MessageTransmitterABI,
        functionName: 'receiveMessage',
        args: [messageHex, attestationHex as `0x${string}`],
      });

      claimTxHash = await client.writeContract(request);
      await publicArcClient.waitForTransactionReceipt({ hash: claimTxHash });
    } catch (claimErr: any) {
      console.error('CCTP receiveMessage execution failed on Arc:', claimErr);

      // Rollback database state if claim failed so it can be re-triggered
      try {
        await supabase
          .from('bridge_claims')
          .update({ status: 'failed' })
          .eq('burn_tx_hash', burnTxHash);
      } catch {}

      return NextResponse.json({ 
        error: 'Mint claiming failed on Arc L1. The message may already have been claimed.', 
        details: claimErr?.message || claimErr 
      }, { status: 500 });
    }

    // 7. Update DB state on success: Campaign Activation & Bridge Claims complete
    try {
      await supabase
        .from('bridge_claims')
        .update({ 
          status: 'success', 
          claim_tx_hash: claimTxHash 
        })
        .eq('burn_tx_hash', burnTxHash);

      if (campaignId) {
        await supabase
          .from('campaigns')
          .update({ 
            active: true, 
            remaining_budget: amountUSDC 
          })
          .eq('id', campaignId);
      }
    } catch (updateErr) {
      console.error('Failed to sync final CCTP status to database:', updateErr);
    }

    return NextResponse.json({
      status: 'SUCCESS',
      recipientAddress,
      amountUSDC,
      claimTxHash,
      messageHash
    });

  } catch (err: any) {
    console.error('Unhandled bridge attestation API error:', err);
    return NextResponse.json({ error: 'Internal server error', details: err?.message }, { status: 500 });
  }
}
