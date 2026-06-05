import { createPublicClient, http, hexToBytes, keccak256, getAddress, pad } from 'viem';
import { BridgeKit } from '@circle-fin/bridge-kit';
import { createAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2';

/**
 * CCTP Cross-Chain Bridge Configuration and Utility Service
 * 
 * Standardizes TokenMessenger, MessageTransmitter, and USDC contract addresses
 * for Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, and Arc Testnet.
 */

export const CCTP_NETWORKS = {
  Ethereum: {
    domain: 0,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
    messageTransmitter: '0x7865fAfC2db2093669d92c0F33AeEF291086BEFD',
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com'
  },
  Arbitrum: {
    domain: 3,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
    messageTransmitter: '0xE997d7d2F6E065a9A93Fa2175E878Fb9081F1f0A',
    rpc: 'https://arbitrum-sepolia-rpc.publicnode.com'
  },
  Base: {
    domain: 6,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
    messageTransmitter: '0x7865fAfC2db2093669d92c0F33AeEF291086BEFD',
    rpc: 'https://base-sepolia-rpc.publicnode.com'
  },
  Arc: {
    domain: 26,
    usdc: '0x3600000000000000000000000000000000000000',
    messageTransmitter: '0x386866f5056711516eB3bB9c41E47702f7413d78',
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    rpc: 'https://rpc.testnet.arc.network'
  }
} as const;

export type BridgeChain = 'Ethereum' | 'Arbitrum' | 'Base';

/**
 * Convert standard Ethereum address to bytes32 format for CCTP burn message
 */
export function addressToBytes32(address: string): `0x${string}` {
  return pad(getAddress(address), { size: 32 });
}

/**
 * Converts bytes32 format back to a standard address
 */
export function bytes32ToAddress(bytes32Str: string): string {
  return getAddress('0x' + bytes32Str.slice(-40));
}

export class CctpBridgeService {
  private bridgeKit: BridgeKit;

  constructor() {
    this.bridgeKit = new BridgeKit();
  }

  /**
   * Initiates a CCTP Bridge transfer using the Circle Bridge Kit SDK.
   * Burns USDC on the source chain to prepare it for minting on Arc L1.
   */
  async initiateBridgeTransfer(
    fromChain: BridgeChain,
    amount: string,
    destinationAddress: string,
    privateKey?: string
  ): Promise<{ txHash: string; messageHash: string }> {
    const key = privateKey || process.env.DEPLOYER_PRIVATE_KEY || process.env.NEXT_PUBLIC_PRIVATE_KEY;
    if (!key) {
      throw new Error('Private key is required to sign the CCTP burn transaction.');
    }

    const formattedKey = key.startsWith('0x') ? key : `0x${key}`;
    const adapter = createAdapterFromPrivateKey({
      privateKey: formattedKey as `0x${string}`,
    });

    const result = await this.bridgeKit.bridge({
      from: { adapter, chain: fromChain },
      to: { adapter, chain: 'Arc' as any, recipientAddress: destinationAddress },
      amount
    });

    const burnStep = result.steps.find((s) => s.name.toLowerCase().includes('burn') || s.txHash);
    const txHash = burnStep?.txHash || '';

    return {
      txHash,
      messageHash: ''
    };
  }
}
