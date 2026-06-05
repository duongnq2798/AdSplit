import { NextResponse } from 'next/server';

/**
 * Next.js API Route to initiate a transfer transaction for User-Controlled Wallets.
 * Fetches user token, looks up wallet ID, locates the USDC token ID, and generates the challenge.
 */
export async function POST(request: Request) {
  try {
    const { email, destinationAddress, amount } = await request.json();
    if (!email || !destinationAddress || !amount) {
      return NextResponse.json({ error: 'Email, destinationAddress, and amount are required.' }, { status: 400 });
    }

    const apiKey = process.env.CIRCLE_API_KEY || process.env.NEXT_PUBLIC_CIRCLE_API_KEY || 'sandbox_key';
    const baseUrl = apiKey.startsWith('TEST_API_KEY') || apiKey === 'sandbox_key'
      ? 'https://api-sandbox.circle.com/v1'
      : 'https://api.circle.com/v1';

    // 1. Re-generate deterministic user ID
    const cleanEmail = email.toLowerCase().trim();
    const userId = `adsplit_user_${Buffer.from(cleanEmail).toString('hex').slice(0, 32)}`;

    // 2. Generate a fresh User Session Token
    console.log(`[Circle Transfer API] Generating user token for transfer of ${userId}...`);
    const tokenRes = await fetch(`${baseUrl}/w3s/users/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ userId }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.data) {
      return NextResponse.json({ error: 'Failed to generate user session token.' }, { status: 500 });
    }

    const { userToken, encryptionKey } = tokenData.data;

    // 3. Get the user's wallets
    console.log(`[Circle Transfer API] Looking up wallets...`);
    const walletRes = await fetch(`${baseUrl}/w3s/wallets`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-User-Token': userToken,
      },
    });

    const walletData = await walletRes.json();
    const wallets = walletData.data?.wallets || [];
    if (wallets.length === 0) {
      return NextResponse.json({ error: 'User does not have an active wallet.' }, { status: 404 });
    }

    const walletId = wallets[0].id;

    // 4. Get the wallet balances to locate the correct token ID
    console.log(`[Circle Transfer API] Fetching balances for wallet ${walletId}...`);
    const balanceRes = await fetch(`${baseUrl}/w3s/wallets/${walletId}/balances`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-User-Token': userToken,
      },
    });

    const balanceData = await balanceRes.json();
    const tokenBalances = balanceData.data?.tokenBalances || [];
    
    // Find USDC token or any available token in the wallet
    let targetTokenId = '';
    const usdcToken = tokenBalances.find((tb: any) => tb.token.symbol === 'USDC' || tb.token.symbol === 'USDC.e');
    if (usdcToken) {
      targetTokenId = usdcToken.token.id;
    } else if (tokenBalances.length > 0) {
      // Fallback to first available token (e.g. native gas token)
      targetTokenId = tokenBalances[0].token.id;
    } else {
      return NextResponse.json({ error: 'No tokens found in the user wallet to transfer.' }, { status: 400 });
    }

    // 5. Initiate the transfer transaction challenge
    console.log(`[Circle Transfer API] Initiating transfer challenge to destination ${destinationAddress}...`);
    const idempotencyKey = 'idemp_tx_' + Math.random().toString(36).substring(2, 15);
    const transferRes = await fetch(`${baseUrl}/w3s/user/transactions/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-User-Token': userToken,
      },
      body: JSON.stringify({
        idempotencyKey,
        walletId,
        destinationAddress,
        amounts: [amount.toString()],
        tokenId: targetTokenId,
        feeLevel: 'MEDIUM',
      }),
    });

    const transferData = await transferRes.json();
    if (!transferRes.ok || !transferData.data) {
      console.error('[Circle Transfer API] Failed to create transfer challenge:', transferData);
      return NextResponse.json({ error: transferData.message || 'Failed to create transfer challenge.' }, { status: 500 });
    }

    const { challengeId } = transferData.data;

    return NextResponse.json({
      success: true,
      userToken,
      encryptionKey,
      challengeId,
    });
  } catch (error: any) {
    console.error('[Circle Transfer API] Error in transfer route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
