import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { 
  metaMaskWallet, 
  rainbowWallet, 
  coinbaseWallet, 
  walletConnectWallet,
  injectedWallet
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { arcTestnet } from 'viem/chains';

/**
 * AdSplit Wagmi Client Configuration
 * 
 * Natively targets the Arc Testnet where USDC is the native gas token.
 * Chain ID: 5042002 (hex: 0x4CEF52)
 * RPC Endpoint: https://rpc.testnet.arc.network
 * Explorer: https://testnet.arcscan.app
 */

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '43e2e8e811568de51268b94876fa774e';

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Recommended',
      wallets: [injectedWallet, metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet],
    },
  ],
  {
    appName: 'AdSplit',
    projectId,
  }
);

export const config = createConfig({
  connectors: [injected(), ...connectors],
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: http('https://rpc.testnet.arc.network'),
  },
  ssr: true,
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
