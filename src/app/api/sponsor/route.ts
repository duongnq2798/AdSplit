import { NextResponse } from 'next/server';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

/**
 * Next.js API Route for Secure Sponsored Gasless Transactions
 * Runs exclusively on the server to protect private credentials (Entity Secret).
 * Uses the official @circle-fin/developer-controlled-wallets SDK.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { walletId, contractAddress, abiMethod, args } = body;

    const apiKey = process.env.NEXT_PUBLIC_CIRCLE_API_KEY || 'sandbox_key';
    const entitySecret = process.env.NEXT_PUBLIC_CIRCLE_ENTITY_SECRET || '';

    // If Entity Secret is configured, run secure transaction via Developer-Controlled Wallets SDK
    if (entitySecret && apiKey && apiKey !== 'sandbox_key') {
      console.log('[API Sponsor] Processing sponsored txn via Developer-Controlled Wallets SDK...');
      const walletsClient = initiateDeveloperControlledWalletsClient({
        apiKey,
        entitySecret,
      });

      let abiFunctionSignature = abiMethod;
      if (abiMethod === 'recordEngagement') {
        abiFunctionSignature = 'recordEngagement(bytes32,bytes32)';
      }

      const response = await walletsClient.createContractExecutionTransaction({
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters: args.map((arg: any) => arg.toString()),
        fee: {
          type: 'level',
          config: {
            feeLevel: 'MEDIUM',
          },
        },
        idempotencyKey: 'idempotency_' + Math.random().toString(36).substring(2, 15),
      });

      return NextResponse.json(response);
    }

    // Default fallback to manual API Relayer (Circle Sandbox) for rapid local dev / prototyping
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
        abiMethod,
        abiParameters: args,
        feeLevel: 'MEDIUM',
        sponsorGas: true,
      }),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[API Sponsor] Error executing sponsored transaction:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
