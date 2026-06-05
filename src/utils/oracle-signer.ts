import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked } from 'viem';

/**
 * Signs the campaign engagement click data with the oracle's private key.
 * Used on the server-side to generate a valid cryptographic signature for AdRevenueSplitter.sol.
 */
export async function signEngagement(
  campaignId: string,
  clickFingerprint: string
): Promise<string> {
  const privateKey = process.env.ORACLE_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  
  if (!privateKey) {
    throw new Error('Oracle private key is not configured in environment variables.');
  }

  // Ensure private key starts with '0x'
  const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(formattedPrivateKey as `0x${string}`);

  // Pack and hash the campaign ID and click fingerprint using keccak256
  const messageHash = keccak256(
    encodePacked(
      ['bytes32', 'bytes32'],
      [campaignId as `0x${string}`, clickFingerprint as `0x${string}`]
    )
  );

  // Sign the EIP-191 message hash
  const signature = await account.signMessage({
    message: { raw: messageHash }
  });

  return signature;
}
