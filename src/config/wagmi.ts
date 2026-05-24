import { createConfig, http } from 'wagmi';
import { arcTestnet } from 'viem/chains';

/**
 * AdSplit Wagmi Client Configuration
 * 
 * Natively targets the Arc Testnet where USDC is the native gas token.
 * Chain ID: 5042002 (hex: 0x4CEF52)
 * RPC Endpoint: https://rpc.testnet.arc.network
 * Explorer: https://testnet.arcscan.app
 */

export const config = createConfig({
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http('https://rpc.testnet.arc.network'),
  },
});

// Double check decimals constraints for native gas vs ERC-20
export const ARC_METRICS = {
  chainId: 5042002,
  usdcAddress: '0x3600000000000000000000000000000000000000', // ERC-20 stablecoin on Arc
  eurcAddress: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  cctpDomain: 26,
  nativeGasDecimals: 18, // Native gas is calculated with 18 decimals
  erc20UsdcDecimals: 6,   // ERC-20 USDC has 6 decimals
};
