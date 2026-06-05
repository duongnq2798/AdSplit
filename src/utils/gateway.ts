import { recoverMessageAddress, keccak256, encodePacked, getAddress } from 'viem';
import { SupabaseDbService } from './supabase';

/**
 * x402 Micropayments Protocol Buyer-Seller Gateway Flow
 * 
 * Manages advertiser Gateway deposits and validates cryptographic off-chain
 * payment tokens (x402) signed by advertisers before crediting creators.
 */

export interface X402PaymentToken {
  advertiser: string;
  campaignId: string;
  creator: string;
  amount: number; // Amount in micro-USDC (6 decimals integer, e.g., 500 = 0.0005 USDC)
  nonce: number;
  signature: string; // Advertiser signature over keccak256 hash of parameters
}

export class CircleGatewayService {
  private db = new SupabaseDbService();

  /**
   * Deposit USDC into the advertiser's Gateway off-chain balance ledger.
   */
  async depositToGateway(advertiserAddress: string, amount: number): Promise<boolean> {
    if (!advertiserAddress || amount <= 0) return false;
    try {
      return await this.db.depositToGateway(getAddress(advertiserAddress), amount);
    } catch (err) {
      console.error('Error depositing to gateway:', err);
      return false;
    }
  }

  /**
   * Retrieves the current Gateway balance of an advertiser.
   */
  async getGatewayBalance(advertiserAddress: string): Promise<number> {
    if (!advertiserAddress) return 0;
    try {
      return await this.db.getGatewayBalance(getAddress(advertiserAddress));
    } catch (err) {
      console.error('Error fetching gateway balance:', err);
      return 0;
    }
  }

  /**
   * Verifies the EIP-191 signature of an off-chain x402 payment token.
   */
  async verifyX402PaymentSignature(token: X402PaymentToken): Promise<boolean> {
    try {
      const { advertiser, campaignId, creator, amount, nonce, signature } = token;
      
      const messageHash = keccak256(
        encodePacked(
          ['address', 'bytes32', 'address', 'uint256', 'uint256'],
          [
            getAddress(advertiser),
            campaignId as `0x${string}`,
            getAddress(creator),
            BigInt(amount),
            BigInt(nonce)
          ]
        )
      );

      const recoveredAddress = await recoverMessageAddress({
        message: { raw: messageHash },
        signature: signature as `0x${string}`
      });

      return getAddress(recoveredAddress) === getAddress(advertiser);
    } catch (err) {
      console.error('Failed to verify x402 payment signature:', err);
      return false;
    }
  }

  /**
   * Process a micro-payment off-chain:
   * 1. Validate signature.
   * 2. Lock and deduct gateway balance from advertiser.
   * 3. Increment creator's micro balance.
   */
  async processMicroPayment(token: X402PaymentToken): Promise<{ success: boolean; reason?: string }> {
    // 1. Verify payment token signature
    const isSignatureValid = await this.verifyX402PaymentSignature(token);
    if (!isSignatureValid) {
      return { success: false, reason: 'INVALID_SIGNATURE' };
    }

    // Amount conversion: token.amount is micro-USDC (6 decimals int, e.g. 500 = $0.0005)
    // Convert to standard float for DB decimal numeric storage
    const usdcAmount = token.amount / 1_000_000;

    const advertiserAddress = getAddress(token.advertiser);
    const creatorAddress = getAddress(token.creator);

    // 2. Lock and deduct advertiser's Gateway balance (atomic db check and subtract)
    const deducted = await this.db.deductGatewayBalance(advertiserAddress, usdcAmount);
    if (!deducted) {
      return { success: false, reason: 'INSUFFICIENT_GATEWAY_BALANCE' };
    }

    // 3. Increment creator's off-chain micro balance ledger
    const incremented = await this.db.incrementMicroBalance(token.campaignId, creatorAddress, usdcAmount);
    if (!incremented) {
      // Rollback deduction if ledger update fails
      await this.db.depositToGateway(advertiserAddress, usdcAmount);
      return { success: false, reason: 'LEDGER_UPDATE_FAILED' };
    }

    return { success: true };
  }
}
