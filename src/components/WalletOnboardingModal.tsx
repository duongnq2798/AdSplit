'use client';

import React, { useState } from 'react';
import { Mail, Key, Loader2, CheckCircle2, Wallet, AlertCircle, X } from 'lucide-react';
import { circleUCWService } from '@/utils/circle-ucw';
import { supabase } from '@/utils/supabase';

interface WalletOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOnboarded: (walletAddress: string, email: string) => void;
}

export default function WalletOnboardingModal({ isOpen, onClose, onOnboarded }: WalletOnboardingModalProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'pin_setup' | 'saving' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [createdWallet, setCreatedWallet] = useState('');

  if (!isOpen) return null;

  const handleStartOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      // 1. Call secure API route to check user and generate session token/challenge
      const res = await fetch('/api/wallets/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to initialize session.');
      }

      const { userToken, encryptionKey, hasWallet, walletAddress, challengeId, userId } = data;

      // Set auth keys on SDK
      circleUCWService.setAuthentication(userToken, encryptionKey);

      if (hasWallet && walletAddress) {
        // User already has an embedded wallet. Sync and complete.
        setStatus('saving');
        await syncCreatorToDb(email, walletAddress, userId);
        setCreatedWallet(walletAddress);
        setStatus('success');
        setTimeout(() => {
          onOnboarded(walletAddress, email);
          onClose();
        }, 1500);
      } else if (challengeId) {
        // New user. Prompt user PIN setting iframe.
        setStatus('pin_setup');
        
        // Execute the challenge using Circle Web SDK (triggers PIN dialog overlay)
        console.log('[UCW Modal] Triggering Circle PIN entry challenge...');
        try {
          await circleUCWService.executeChallenge(challengeId);
          
          // PIN setup complete. Call token API again to retrieve the new wallet address.
          setStatus('loading');
          const verificationRes = await fetch('/api/wallets/user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });

          const verifiedData = await verificationRes.json();
          if (!verificationRes.ok || !verifiedData.walletAddress) {
            throw new Error('Failed to retrieve wallet address after PIN initialization.');
          }

          const newAddress = verifiedData.walletAddress;
          setStatus('saving');
          await syncCreatorToDb(email, newAddress, userId);
          setCreatedWallet(newAddress);
          setStatus('success');
          
          setTimeout(() => {
            onOnboarded(newAddress, email);
            onClose();
          }, 1500);
        } catch (sdkError: any) {
          console.error('[UCW Modal] SDK Challenge failed:', sdkError);
          throw new Error(sdkError?.message || 'PIN setup challenge failed or was cancelled.');
        }
      } else {
        throw new Error('Invalid server response (missing wallet or challenge ID).');
      }
    } catch (err: any) {
      console.error('[UCW Modal] Error during onboarding:', err);
      setErrorMessage(err.message || 'An unexpected error occurred.');
      setStatus('error');
    }
  };

  const syncCreatorToDb = async (creatorEmail: string, address: string, circleUserId: string) => {
    try {
      const { error } = await supabase
        .from('creators')
        .upsert({
          email: creatorEmail,
          wallet_address: address,
          user_id: circleUserId
        });
      
      if (error) throw error;
      console.log('[UCW Modal] Successfully synced creator wallet to Supabase creators profile.');
    } catch (e: any) {
      console.warn('[UCW Modal] Database sync warning (ignoring for sandbox demo):', e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="border-4 border-[#744D2B] bg-[#FCFAF6] w-full max-w-md rounded-3xl shadow-[0_8px_0_#744D2B] overflow-hidden relative animate-cozy-slide">
        
        {/* Header */}
        <div className="bg-[#744D2B] p-4 flex items-center justify-between text-[#FCFAF6]">
          <h3 className="text-md font-black uppercase tracking-wider flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Embedded Wallet Setup
          </h3>
          <button 
            onClick={onClose} 
            className="p-1 rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {status === 'idle' && (
            <form onSubmit={handleStartOnboarding} className="space-y-4">
              <div className="text-center space-y-2">
                <div className="inline-flex p-3 bg-[#F4C455]/20 border-2 border-[#744D2B] rounded-2xl text-[#744D2B]">
                  🍃
                </div>
                <h4 className="font-extrabold uppercase text-[#744D2B]">Cozy Onboarding</h4>
                <p className="text-xs text-[#8E7368] font-medium leading-relaxed">
                  Register or login gaslessly using your email address. You will set up a secure, non-custodial wallet with a custom PIN.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase text-[#744D2B]">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#744D2B]/50" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nook@island.com"
                    className="w-full pl-10 pr-4 py-3 bg-white border-3 border-[#744D2B] rounded-2xl text-sm font-bold text-[#744D2B] placeholder-[#744D2B]/35 focus:outline-none focus:ring-2 focus:ring-[#F4C455]"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-[#F4C455] border-3 border-[#744D2B] rounded-full text-sm font-black uppercase text-[#744D2B] shadow-[0_4px_0_#744D2B] hover:translate-y-0.5 hover:shadow-[0_2px_0_#744D2B] active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-2"
              >
                Continue Setup
              </button>
            </form>
          )}

          {status === 'loading' && (
            <div className="text-center py-8 space-y-4">
              <Loader2 className="w-10 h-10 mx-auto text-[#F4C455] animate-spin" />
              <div className="space-y-1">
                <h5 className="font-extrabold uppercase text-[#744D2B]">Syncing Circle Session</h5>
                <p className="text-xs text-[#8E7368] font-bold uppercase tracking-wider">Please wait...</p>
              </div>
            </div>
          )}

          {status === 'pin_setup' && (
            <div className="text-center py-8 space-y-4">
              <div className="inline-flex p-3.5 bg-[#F4C455]/20 border-2 border-[#744D2B] rounded-full animate-bounce">
                <Key className="w-6 h-6 text-[#744D2B]" />
              </div>
              <div className="space-y-2">
                <h5 className="font-extrabold uppercase text-[#744D2B]">Configure Wallet PIN</h5>
                <p className="text-xs text-[#8E7368] font-medium leading-relaxed px-4">
                  A secure Circle dialog has opened. Please set up a 6-digit PIN code in the popup to secure your user-controlled wallet.
                </p>
                <div className="bg-[#F4C455]/10 border-2 border-[#744D2B]/20 p-3 rounded-2xl text-[10px] text-[#744D2B] font-bold uppercase tracking-wider">
                  Do not close this page during setup.
                </div>
              </div>
            </div>
          )}

          {status === 'saving' && (
            <div className="text-center py-8 space-y-4">
              <Loader2 className="w-10 h-10 mx-auto text-[#744D2B] animate-spin" />
              <div className="space-y-1">
                <h5 className="font-extrabold uppercase text-[#744D2B]">Linking Wallet Address</h5>
                <p className="text-xs text-[#8E7368] font-bold uppercase tracking-wider">Updating database profile...</p>
              </div>
            </div>
          )}

          {status === 'success' && (
            <div className="text-center py-8 space-y-4">
              <div className="inline-flex p-3 bg-green-500/10 border-2 border-green-500 rounded-full text-green-500">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h5 className="font-extrabold uppercase text-green-700">Setup Successful!</h5>
                <p className="text-[10px] text-[#8E7368] font-mono break-all px-2">
                  Wallet: {createdWallet}
                </p>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <div className="inline-flex p-3 bg-red-500/10 border-2 border-red-500 rounded-full text-red-500">
                  <AlertCircle className="w-8 h-8" />
                </div>
                <h5 className="font-extrabold uppercase text-red-700">Onboarding Error</h5>
                <p className="text-xs text-red-600 font-medium leading-relaxed px-4">
                  {errorMessage}
                </p>
              </div>

              <button
                onClick={() => setStatus('idle')}
                className="w-full py-2.5 bg-white border-3 border-[#744D2B] rounded-full text-xs font-black uppercase text-[#744D2B] hover:bg-[#FCFAF6] transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
