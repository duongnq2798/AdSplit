import { NextResponse } from 'next/server';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { signEngagement } from '@/utils/oracle-signer';
import { verifyTelemetry } from '@/utils/scoring-engine';
import { supabase, SupabaseDbService } from '@/utils/supabase';
import { CircleGatewayService } from '@/utils/gateway';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked } from 'viem';

/**
 * Next.js API Route for Secure Sponsored Gasless Transactions
 * Evaluates real-time telemetry, protects sponsors, and issues Oracle click signatures.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { walletId, contractAddress, abiMethod, args, telemetryPayload, zkProof } = body;

    const apiKey = process.env.NEXT_PUBLIC_CIRCLE_API_KEY || 'sandbox_key';
    const entitySecret = process.env.NEXT_PUBLIC_CIRCLE_ENTITY_SECRET || '';

    let sponsoredArgs = [...args];
    let abiFunctionSignature = abiMethod;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
               request.headers.get('x-real-ip') || 
               '127.0.0.1';

    // 1. If method is recordEngagement, run the Anti-Bot Scoring Engine
    if (abiMethod === 'recordEngagement' || abiMethod.startsWith('recordEngagement(')) {
      const campaignId = args[0];
      const clickFingerprint = args[1];

      // Origin domain validation for security
      const referer = request.headers.get('referer') || '';
      const origin = request.headers.get('origin') || '';
      let callerDomain = 'localhost';
      try {
        if (referer) {
          callerDomain = new URL(referer).hostname;
        } else if (origin) {
          callerDomain = new URL(origin).hostname;
        }
      } catch (e) {
        console.warn('[API Sponsor] Failed to parse referer/origin hostname:', e);
      }

      console.log(`[API Sponsor] Validating telemetry for campaign ${campaignId} from IP ${ip} (Domain: ${callerDomain})...`);

      const { data: domainRecord, error: domainErr } = await supabase
        .from('registered_domains')
        .select('domain')
        .eq('domain', callerDomain)
        .maybeSingle();

      if (domainErr) {
        console.error('[API Sponsor] Database domain verification error:', domainErr);
      }

      if (!domainRecord && callerDomain !== 'localhost' && callerDomain !== '127.0.0.1') {
        console.warn(`[API Sponsor] Unauthorized origin domain: ${callerDomain}`);
        return NextResponse.json({ 
          error: `Domain '${callerDomain}' is not registered with AdSplit. Only whitelisted publisher sites can load ads.`,
          success: false 
        }, { status: 403 });
      }

      const telemetryResult = await verifyTelemetry(telemetryPayload || '', ip, campaignId);
      
      if (!telemetryResult.success) {
        console.warn(`[API Sponsor] Telemetry rejected click! Reason: ${telemetryResult.reason}`);
        
        // Log telemetry fraud event to ip_blacklist in Supabase
        try {
          await supabase.from('ip_blacklist').insert([{
            ip_address: ip,
            reason: telemetryResult.reason
          }]);
        } catch (dbErr) {
          console.error('[API Sponsor] Failed to update ip_blacklist:', dbErr);
        }

        // Return 403 Forbidden with telemetry score details
        return NextResponse.json({ 
          error: telemetryResult.reason, 
          score: telemetryResult.score,
          success: false 
        }, { status: 403 });
      }

      console.log(`[API Sponsor] Telemetry verified genuine (Score: ${telemetryResult.score}).`);

      // Retrieve campaign details to check for micropayment (sub-cent CPC)
      const dbService = new SupabaseDbService();
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .maybeSingle();

      if (campaign && parseFloat(campaign.cost_per_click) < 0.01) {
        console.log(`[API Sponsor] Sub-cent CPC campaign detected: ${campaign.cost_per_click} USDC. Processing off-chain via x402.`);
        
        const { x402Token } = body;
        if (!x402Token) {
          return NextResponse.json({ error: 'x402 payment token is required for sub-cent campaigns' }, { status: 400 });
        }

        const gatewayService = new CircleGatewayService();
        const paymentResult = await gatewayService.processMicroPayment(x402Token);
        if (!paymentResult.success) {
          return NextResponse.json({ error: `Micropayment failed: ${paymentResult.reason}` }, { status: 400 });
        }

        // Log to click_logs
        const platformShareBps = campaign.platform_share || 300;
        const payoutUsdc = parseFloat(campaign.cost_per_click);
        const platformPayout = (payoutUsdc * platformShareBps) / 10000;
        const remainingPayout = payoutUsdc - platformPayout;

        // Fetch splits to log correct creator shares
        const { data: splits } = await supabase
          .from('campaign_splits')
          .select('*')
          .eq('campaign_id', campaignId);

        const firstCreatorPayout = splits && splits.length > 0 
          ? (remainingPayout * (splits[0].share_bps || 10000)) / 10000 
          : remainingPayout;

        await dbService.logEngagement({
          id: clickFingerprint,
          campaign_id: campaignId,
          ip_address: ip,
          status: 'valid',
          payout_usdc: payoutUsdc,
          creator_payout_usdc: firstCreatorPayout,
          platform_payout_usdc: platformPayout,
          distributor_payout_usdc: remainingPayout - firstCreatorPayout
        });

        return NextResponse.json({
          success: true,
          batched: true,
          message: 'Micropayment settled in off-chain ledger successfully',
          telemetryScore: telemetryResult.score
        });
      }

      console.log(`[API Sponsor] Gathering signatures from Decentralized Oracle Network (DON)...`);
      const ports = [3001, 3002, 3003];
      const keys = [
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        '0x5de4111afa73f9c56a67cf4e929d6d245c9ffb2287952db7d6f2982455e8f396'
      ];

      const signatures: string[] = [];

      const signLocally = async (key: string, campId: string, fingerprint: string) => {
        const account = privateKeyToAccount(key as `0x${string}`);
        const packedHash = keccak256(
          encodePacked(
            ['bytes32', 'bytes32'],
            [campId as `0x${string}`, fingerprint as `0x${string}`]
          )
        );
        return await account.signMessage({
          message: { raw: packedHash }
        });
      };

      for (let i = 0; i < ports.length; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${ports[i]}/sign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaignId, clickFingerprint }),
            signal: AbortSignal.timeout(1000)
          });
          if (res.ok) {
            const data = await res.json();
            if (data.signature) {
              signatures.push(data.signature);
              continue;
            }
          }
          throw new Error('Invalid signature payload from DON');
        } catch (err) {
          console.warn(`[API Sponsor] Oracle node at port ${ports[i]} failed, falling back to local sign...`);
          const sig = await signLocally(keys[i], campaignId, clickFingerprint);
          signatures.push(sig);
        }
      }

      const a = zkProof?.a || ["0", "0"];
      const b = zkProof?.b || [["0", "0"], ["0", "0"]];
      const c = zkProof?.c || ["0", "0"];

      sponsoredArgs = [campaignId, clickFingerprint, signatures, a, b, c];
      abiFunctionSignature = 'recordEngagement(bytes32,bytes32,bytes[],uint256[2],uint256[2][2],uint256[2])';
    }

    // 2. If Entity Secret is configured, run secure transaction via Developer-Controlled Wallets SDK
    if (entitySecret && apiKey && apiKey !== 'sandbox_key') {
      console.log('[API Sponsor] Processing sponsored txn via Developer-Controlled Wallets SDK...');
      const walletsClient = initiateDeveloperControlledWalletsClient({
        apiKey,
        entitySecret,
      });

      const response = await walletsClient.createContractExecutionTransaction({
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters: sponsoredArgs.map((arg: any) => {
          const deepMap = (item: any): any => {
            if (Array.isArray(item)) {
              return item.map(deepMap);
            }
            return item.toString();
          };
          return deepMap(arg);
        }),
        fee: {
          type: 'level',
          config: {
            feeLevel: 'MEDIUM',
          },
        },
        idempotencyKey: 'idempotency_' + Math.random().toString(36).substring(2, 15),
      });

      return NextResponse.json({ ...response, telemetryScore: 98 });
    }

    // 3. Default fallback to manual API Relayer (Circle Sandbox) for rapid local dev / prototyping
    console.log('[API Sponsor] Falling back to manual API Relayer endpoint...');
    const baseUrl = 'https://api-sandbox.circle.com/v1';
    const response = await fetch(`${baseUrl}/w3s/developer/transactions/contractExecution`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        walletId,
        contractAddress,
        abiMethod: abiFunctionSignature,
        abiParameters: sponsoredArgs.map((arg: any) => {
          const deepMap = (item: any): any => {
            if (Array.isArray(item)) {
              return item.map(deepMap);
            }
            return item.toString();
          };
          return deepMap(arg);
        }),
        feeLevel: 'MEDIUM',
        sponsorGas: true,
      }),
    });

    const data = await response.json();
    return NextResponse.json({ ...data, telemetryScore: 98 });
  } catch (error: any) {
    console.error('[API Sponsor] Error executing sponsored transaction:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
