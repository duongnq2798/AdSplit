import { NextRequest, NextResponse } from 'next/server';
import { CctpBridgeService, BridgeChain } from '@/utils/cctp-bridge';

export async function POST(req: NextRequest) {
  try {
    const { fromChain, amount, destinationAddress } = await req.json();

    if (!fromChain || !amount || !destinationAddress) {
      return NextResponse.json({ error: 'Missing fromChain, amount, or destinationAddress' }, { status: 400 });
    }

    const bridgeService = new CctpBridgeService();
    
    console.log(`Initiating backend burn of ${amount} USDC from ${fromChain} to recipient ${destinationAddress}...`);
    
    const result = await bridgeService.initiateBridgeTransfer(
      fromChain as BridgeChain,
      amount,
      destinationAddress
    );

    return NextResponse.json({
      status: 'SUCCESS',
      burnTxHash: result.txHash,
      messageHash: result.messageHash
    });
  } catch (err: any) {
    console.error('Failed to execute burn transaction on source chain:', err);
    return NextResponse.json({ 
      error: 'Failed to execute burn transaction on source chain. RPC node error or rate limits.', 
      details: err?.message || err 
    }, { status: 500 });
  }
}
