import { NextResponse } from 'next/server';

/**
 * Next.js API Route to handle Circle User-Controlled Wallets onboarding.
 * Registers user, gets userToken, checks if wallet exists, and initiates challenge.
 */
export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_CIRCLE_API_KEY || 'sandbox_key';
    const baseUrl = apiKey.startsWith('TEST_API_KEY') || apiKey === 'sandbox_key'
      ? 'https://api-sandbox.circle.com/v1'
      : 'https://api.circle.com/v1';

    // 1. Create a deterministic stable user ID from email
    const cleanEmail = email.toLowerCase().trim();
    const userId = `adsplit_user_${Buffer.from(cleanEmail).toString('hex').slice(0, 32)}`;

    // 2. Register user on Circle (ignore if already registered/409 Conflict)
    console.log(`[Circle UCW API] Registering user ${userId}...`);
    try {
      await fetch(`${baseUrl}/w3s/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ userId }),
      });
    } catch (err) {
      console.log('[Circle UCW API] User registration warning (may already exist):', err);
    }

    // 3. Generate User Token & Encryption Key
    console.log(`[Circle UCW API] Generating user token for ${userId}...`);
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
      console.error('[Circle UCW API] Token generation failed:', tokenData);
      return NextResponse.json({ error: 'Failed to generate user session token.' }, { status: 500 });
    }

    const { userToken, encryptionKey } = tokenData.data;

    // 4. Check if the user already has wallets
    console.log(`[Circle UCW API] Checking existing wallets for user...`);
    const walletRes = await fetch(`${baseUrl}/w3s/wallets`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-User-Token': userToken,
      },
    });

    const walletData = await walletRes.json();
    const wallets = walletData.data?.wallets || [];

    if (wallets.length > 0) {
      console.log(`[Circle UCW API] Found existing wallet for user: ${wallets[0].address}`);
      return NextResponse.json({
        success: true,
        userToken,
        encryptionKey,
        userId,
        walletAddress: wallets[0].address,
        hasWallet: true,
      });
    }

    // 5. If no wallet exists, generate a wallet initialization challenge
    console.log(`[Circle UCW API] No wallet found. Initializing new wallet challenge...`);
    const idempotencyKey = 'idemp_' + Math.random().toString(36).substring(2, 15);
    const initRes = await fetch(`${baseUrl}/w3s/user/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-User-Token': userToken,
      },
      body: JSON.stringify({
        idempotencyKey,
        blockchains: ['ETH-SEPOLIA'],
        accountType: 'EOA',
      }),
    });

    const initData = await initRes.json();
    if (!initRes.ok || !initData.data) {
      console.error('[Circle UCW API] Initialization challenge failed:', initData);
      return NextResponse.json({ error: 'Failed to initialize wallet challenge.' }, { status: 500 });
    }

    const { challengeId } = initData.data;

    return NextResponse.json({
      success: true,
      userToken,
      encryptionKey,
      userId,
      challengeId,
      hasWallet: false,
    });
  } catch (error: any) {
    console.error('[Circle UCW API] Error in user wallet route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
