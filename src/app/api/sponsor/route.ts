import { NextResponse } from 'next/server';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { signEngagement } from '@/utils/oracle-signer';
import { verifyTelemetry } from '@/utils/scoring-engine';
import { supabase, SupabaseDbService } from '@/utils/supabase';
import { CircleGatewayService } from '@/utils/gateway';

/**
 * Next.js API Route for Secure Sponsored Gasless Transactions
 * Evaluates real-time telemetry, protects sponsors, and issues Oracle click signatures.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { walletId, contractAddress, abiMethod, args, telemetryPayload } = body;

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
      console.log(`[API Sponsor] Validating telemetry for campaign ${campaignId} from IP ${ip}...`);

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

      console.log(`[API Sponsor] Generating on-chain signature for standard click...`);
      const signature = await signEngagement(campaignId, clickFingerprint);
      sponsoredArgs = [campaignId, clickFingerprint, signature];
      abiFunctionSignature = 'recordEngagement(bytes32,bytes32,bytes)';
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
        abiParameters: sponsoredArgs.map((arg: any) => arg.toString()),
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
        abiParameters: sponsoredArgs,
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
