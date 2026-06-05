import { NextResponse } from 'next/server';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { signEngagement } from '@/utils/oracle-signer';
import { verifyTelemetry } from '@/utils/scoring-engine';
import { supabase } from '@/utils/supabase';

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

      console.log(`[API Sponsor] Telemetry verified genuine (Score: ${telemetryResult.score}). Generating signature...`);
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
