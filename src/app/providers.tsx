'use client';

import React from 'react';
import { RainbowKitProvider, Theme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/config/wagmi';
import '@rainbow-me/rainbowkit/styles.css';

const queryClient = new QueryClient();

// Custom RainbowKit Theme designed exactly to match the Cozy, Premium Neobrutalist NookPhone Style of AdSplit!
const cozyRainbowKitTheme: Theme = {
  blurs: {
    modalOverlay: 'blur(8px)',
  },
  colors: {
    accentColor: '#F4C455', // Primary cozy yellow
    accentColorForeground: '#744D2B', // Cozy brown text
    actionButtonBorder: '#744D2B',
    actionButtonBorderMobile: '#744D2B',
    actionButtonSecondaryBackground: '#FCFAF6',
    closeButton: '#744D2B',
    closeButtonBackground: '#FCFAF6',
    connectButtonBackground: '#FFFFFF',
    connectButtonBackgroundError: '#FEF9E7',
    connectButtonInnerBackground: '#FFFFFF',
    connectButtonText: '#744D2B',
    connectButtonTextError: '#E25252',
    connectionIndicator: '#35C7A4',
    downloadBottomCardBackground: '#FCFAF6',
    downloadTopCardBackground: '#FCFAF6',
    error: '#E25252',
    generalBorder: '#744D2B',
    generalBorderDim: '#744D2B',
    menuItemBackground: '#FCFAF6',
    modalBackground: '#FFFFFF',
    modalBorder: '#744D2B',
    modalText: '#744D2B',
    modalTextDim: '#8E7368',
    modalTextSecondary: '#8E7368',
    profileAction: '#FCFAF6',
    profileActionHover: '#FEF9E7',
    profileForeground: '#FCFAF6',
    selectedOptionBorder: '#744D2B',
    standby: '#F4C455',
    modalBackdrop: 'rgba(116, 77, 43, 0.2)',
  },
  fonts: {
    body: 'var(--font-geist-sans), sans-serif',
  },
  radii: {
    actionButton: '20px',
    connectButton: '20px',
    menuButton: '20px',
    modal: '28px',
    modalMobile: '28px',
  },
  shadows: {
    connectButton: '0 4px 0 #744D2B',
    dialog: '0 12px 0 #744D2B',
    profileDetailsAction: '0 4px 0 #744D2B',
    selectedOption: '0 4px 0 #744D2B',
    selectedWallet: '0 4px 0 #744D2B',
    walletLogo: '0 4px 0 #744D2B',
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider 
          theme={cozyRainbowKitTheme}
          modalSize="wide"
          showRecentTransactions={true}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
