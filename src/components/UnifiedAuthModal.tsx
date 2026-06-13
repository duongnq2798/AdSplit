'use client';

import React, { useState, useEffect } from 'react';
import { Mail, Key, Loader2, CheckCircle2, Wallet, AlertCircle, X, Sparkles, ChevronRight, Lock } from 'lucide-react';
import { circleUCWService } from '@/utils/circle-ucw';
import { supabase } from '@/utils/supabase';

interface UnifiedAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (session: {
    authType: 'circle' | 'web3' | 'mock';
    email?: string;
    walletAddress: string;
  }) => void;
  openWeb3Connect: () => void;
}

export default function UnifiedAuthModal({ isOpen, onClose, onSuccess, openWeb3Connect }: UnifiedAuthModalProps) {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'select' | 'email_input' | 'google_loading' | 'pin_setup' | 'funding' | 'success' | 'error'>('select');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [createdWallet, setCreatedWallet] = useState('');
  const [userId, setUserId] = useState('');
  const [isCircleOffline, setIsCircleOffline] = useState(false);

  // Persistence keys
  useEffect(() => {
    // Check if there was a pending pin setup in localStorage
    if (typeof window !== 'undefined' && localStorage.getItem('adsplit_pin_pending_email')) {
      const pendingEmail = localStorage.getItem('adsplit_pin_pending_email') || '';
      setEmail(pendingEmail);
    }
  }, []);

  if (!isOpen) return null;

  const handleCircleOnboarding = async (targetEmail: string, isGoogle = false) => {
    setLoading(true);
    setErrorMessage('');
    
    if (isGoogle) {
      setStep('google_loading');
      // Simulate OIDC login popup delay
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } else {
      setStep('pin_setup');
    }

    try {
      // 1. Call secure API route to check user and generate session token/challenge
      const res = await fetch('/api/wallets/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      });

      // Handle Circle API offline or error gracefully
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Circle API returned an error.');
      }

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to initialize session.');
      }

      const { userToken, encryptionKey, hasWallet, walletAddress, challengeId, userId: circleUserId } = data;
      setUserId(circleUserId);

      // Set auth keys on SDK
      circleUCWService.setAuthentication(userToken, encryptionKey);

      if (hasWallet && walletAddress) {
        // User already has an embedded wallet. Complete.
        setCreatedWallet(walletAddress);
        await syncCreatorToDb(targetEmail, walletAddress, circleUserId);
        
        // Let's do a quick mock/verification step
        setStep('success');
        localStorage.removeItem('adsplit_pin_pending_email');
        setTimeout(() => {
          onSuccess({
            authType: 'circle',
            email: targetEmail,
            walletAddress,
          });
          onClose();
        }, 1500);
      } else if (challengeId) {
        // New user. Prompt user PIN setting iframe.
        // Save pending setup state to handle mid-setup exit
        localStorage.setItem('adsplit_pin_pending_email', targetEmail);
        localStorage.setItem('adsplit_pin_pending_challenge', challengeId);
        localStorage.setItem('adsplit_pin_pending_userid', circleUserId);

        console.log('[UCW Auth] Triggering Circle PIN entry challenge...');
        
        try {
          await circleUCWService.executeChallenge(challengeId);
          
          // PIN setup complete. Call token API again to retrieve the new wallet address.
          setStep('funding');
          
          const verificationRes = await fetch('/api/wallets/user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: targetEmail }),
          });

          const verifiedData = await verificationRes.json();
          if (!verificationRes.ok || !verifiedData.walletAddress) {
            throw new Error('Failed to retrieve wallet address after PIN initialization.');
          }

          const newAddress = verifiedData.walletAddress;
          setCreatedWallet(newAddress);
          await syncCreatorToDb(targetEmail, newAddress, circleUserId);

          // Trigger auto-funding micro-grant
          try {
            await fetch('/api/wallets/fund', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ walletAddress: newAddress }),
            });
          } catch (fundErr) {
            console.warn('[UCW Auth] Funding warning:', fundErr);
          }

          setStep('success');
          localStorage.removeItem('adsplit_pin_pending_email');
          localStorage.removeItem('adsplit_pin_pending_challenge');
          localStorage.removeItem('adsplit_pin_pending_userid');

          setTimeout(() => {
            onSuccess({
              authType: 'circle',
              email: targetEmail,
              walletAddress: newAddress,
            });
            onClose();
          }, 1500);
        } catch (sdkError: any) {
          console.error('[UCW Auth] SDK Challenge failed:', sdkError);
          throw new Error(sdkError?.message || 'PIN setup challenge failed or was cancelled.');
        }
      } else {
        throw new Error('Invalid server response (missing wallet or challenge ID).');
      }
    } catch (err: any) {
      console.error('[UCW Auth] Error during onboarding:', err);
      // Fallback check
      if (err.message.includes('fetch') || err.message.includes('offline') || err.message.includes('API') || isCircleOffline) {
        setIsCircleOffline(true);
        // Fallback to local mock sandbox
        handleMockAuth(targetEmail);
      } else {
        setErrorMessage(err.message || 'An unexpected error occurred.');
        setStep('error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMockAuth = async (targetEmail: string) => {
    setStep('pin_setup');
    await new Promise((resolve) => setTimeout(resolve, 1200)); // simulate pin setup dialog
    
    // Generate deterministic mock address based on email
    const clean = targetEmail.toLowerCase().trim();
    const hash = clean.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const mockAddress = `0x36${hash.toString(16).padEnd(38, '0')}`;
    
    setStep('funding');
    await new Promise((resolve) => setTimeout(resolve, 800)); // simulate micro-grant funding
    
    setCreatedWallet(mockAddress);
    setStep('success');
    
    // Clear pending
    localStorage.removeItem('adsplit_pin_pending_email');
    localStorage.removeItem('adsplit_pin_pending_challenge');
    localStorage.removeItem('adsplit_pin_pending_userid');
    
    setTimeout(() => {
      onSuccess({
        authType: 'mock',
        email: targetEmail,
        walletAddress: mockAddress,
      });
      onClose();
    }, 1500);
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
    } catch (e: any) {
      console.warn('[UCW Auth] Database sync warning (ignoring for sandbox):', e.message);
    }
  };

  const handleResumePending = () => {
    const pendingEmail = localStorage.getItem('adsplit_pin_pending_email') || '';
    if (pendingEmail) {
      handleCircleOnboarding(pendingEmail);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
      <div className="border-4 border-[#744D2B] bg-[#FCFAF6] w-full max-w-md rounded-[32px] shadow-[0_12px_24px_rgba(116,77,43,0.15)] overflow-hidden relative animate-cozy-slide">
        
        {/* Warning Banner for offline mode */}
        {isCircleOffline && (
          <div className="bg-[#E25252] text-[#FCFAF6] px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-center flex items-center justify-center gap-1.5 border-b-4 border-[#744D2B]">
            <AlertCircle className="w-3.5 h-3.5" />
            Demo Mode - Circle API offline. Fallback active.
          </div>
        )}

        {/* Header */}
        <div className="bg-[#744D2B] p-5 flex items-center justify-between text-[#FCFAF6]">
          <div className="space-y-0.5">
            <h3 className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
              <Wallet className="w-5 h-5 text-[#F4C455] cozy-bounce" />
              Sign In to AdSplit
            </h3>
            <p className="text-[9px] text-[#FCFAF6]/75 uppercase font-bold tracking-widest leading-none">
              Unified Account Portal
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'select' && (
            <div className="space-y-4">
              <div className="text-center space-y-2 pb-2">
                <div className="inline-flex p-3 bg-[#F4C455]/20 border-2 border-[#744D2B] rounded-2xl text-[#744D2B]">
                  🍃
                </div>
                <h4 className="font-extrabold uppercase text-sm text-[#744D2B]">Choose Auth Method</h4>
                <p className="text-xs text-[#8E7368] font-medium leading-relaxed px-4">
                  Log in gaslessly using email or Google social sign-in. Crypto natives can connect their Web3 wallet.
                </p>
              </div>

              {localStorage.getItem('adsplit_pin_pending_email') && (
                <div className="p-3 bg-amber-500/10 border-2 border-amber-500 rounded-2xl flex items-center justify-between text-xs text-amber-700 font-bold">
                  <div className="flex items-center gap-1.5">
                    <Lock className="w-4 h-4" />
                    <span>Pending PIN Setup detected</span>
                  </div>
                  <button 
                    onClick={handleResumePending}
                    className="px-2.5 py-1 bg-amber-500 text-white rounded-lg text-[10px] uppercase font-black hover:bg-amber-600 transition-colors cursor-pointer"
                  >
                    Resume
                  </button>
                </div>
              )}

              <div className="space-y-2.5 pt-2">
                <button
                  onClick={() => handleCircleOnboarding(`google_${Math.random().toString(36).substring(2, 8)}@gmail.com`, true)}
                  className="w-full py-3 bg-white border-3 border-[#744D2B] rounded-2xl text-xs font-black uppercase text-[#744D2B] shadow-[0_4px_0_#744D2B] hover:translate-y-0.5 hover:shadow-[0_2px_0_#744D2B] active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-3 cursor-pointer"
                >
                  <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
                  </svg>
                  Continue with Google
                </button>

                <button
                  onClick={() => setStep('email_input')}
                  className="w-full py-3 bg-white border-3 border-[#744D2B] rounded-2xl text-xs font-black uppercase text-[#744D2B] shadow-[0_4px_0_#744D2B] hover:translate-y-0.5 hover:shadow-[0_2px_0_#744D2B] active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-3 cursor-pointer"
                >
                  <Mail className="w-4.5 h-4.5 text-[#7FB3D5]" />
                  Continue with Email
                </button>

                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t-2 border-[#744D2B]/10"></div>
                  <span className="flex-shrink mx-4 text-[9px] text-[#A78E84] font-black uppercase tracking-wider">or Web3 fallback</span>
                  <div className="flex-grow border-t-2 border-[#744D2B]/10"></div>
                </div>

                <button
                  onClick={() => {
                    openWeb3Connect();
                    onClose();
                  }}
                  className="w-full py-3 bg-[#F4C455] border-3 border-[#744D2B] rounded-2xl text-xs font-black uppercase text-[#744D2B] shadow-[0_4px_0_#744D2B] hover:translate-y-0.5 hover:shadow-[0_2px_0_#744D2B] active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-3 cursor-pointer"
                >
                  <Wallet className="w-4.5 h-4.5" />
                  Connect Web3 Wallet
                </button>
              </div>
            </div>
          )}

          {step === 'email_input' && (
            <form onSubmit={(e) => {
              e.preventDefault();
              if (email && email.includes('@')) {
                handleCircleOnboarding(email);
              }
            }} className="space-y-4">
              <div className="text-center space-y-1 pb-1">
                <h4 className="font-extrabold uppercase text-[#744D2B] text-sm">Enter Your Email</h4>
                <p className="text-[10px] text-[#8E7368] font-bold uppercase">Setup secure PIN password next</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-[#744D2B] tracking-wider block">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#744D2B]/50" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nook@island.com"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border-3 border-[#744D2B] rounded-xl text-xs font-bold text-[#744D2B] placeholder-[#744D2B]/35 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  className="w-1/3 py-2.5 bg-white border-3 border-[#744D2B] rounded-full text-xs font-black uppercase text-[#744D2B] hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="w-2/3 py-2.5 bg-[#F4C455] border-3 border-[#744D2B] rounded-full text-xs font-black uppercase text-[#744D2B] shadow-[0_4px_0_#744D2B] hover:translate-y-0.5 hover:shadow-[0_2px_0_#744D2B] active:translate-y-1 active:shadow-none transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  Send OTP & PIN Setup
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {step === 'google_loading' && (
            <div className="text-center py-8 space-y-4">
              <Loader2 className="w-10 h-10 mx-auto text-[#E25252] animate-spin" />
              <div className="space-y-1 animate-pulse">
                <h5 className="font-extrabold uppercase text-[#744D2B] text-sm">OIDC Google Verification</h5>
                <p className="text-[10px] text-[#8E7368] font-bold uppercase tracking-wider">Signing in with Google Account...</p>
              </div>
            </div>
          )}

          {step === 'pin_setup' && (
            <div className="text-center py-8 space-y-4">
              <div className="inline-flex p-3.5 bg-[#F4C455]/20 border-2 border-[#744D2B] rounded-full animate-bounce">
                <Lock className="w-6 h-6 text-[#744D2B]" />
              </div>
              <div className="space-y-2">
                <h5 className="font-extrabold uppercase text-[#744D2B] text-sm">Configure Wallet PIN</h5>
                <p className="text-xs text-[#8E7368] font-medium leading-relaxed px-4">
                  A secure Circle dialog has opened. Please set up a 6-digit PIN code to secure your non-custodial wallet.
                </p>
                <div className="bg-[#F4C455]/10 border-2 border-[#744D2B]/20 p-3 rounded-2xl text-[10px] text-[#744D2B] font-bold uppercase tracking-wider">
                  Do not close this page during setup.
                </div>
              </div>
            </div>
          )}

          {step === 'funding' && (
            <div className="text-center py-8 space-y-4">
              <Loader2 className="w-10 h-10 mx-auto text-[#35C7A4] animate-spin" />
              <div className="space-y-1">
                <h5 className="font-extrabold uppercase text-green-700 text-sm">Funding Gas & Micro-grant</h5>
                <p className="text-[10px] text-[#8E7368] font-bold uppercase tracking-wider">Airdropping Arc Testnet Tokens...</p>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-8 space-y-4">
              <div className="inline-flex p-3 bg-green-500/10 border-2 border-green-500 rounded-full text-green-500">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h5 className="font-extrabold uppercase text-green-700 text-sm">Access Granted!</h5>
                <p className="text-[10px] text-[#8E7368] font-mono break-all px-4 mt-1 bg-[#FCFAF6] border border-[#744D2B]/10 py-1.5 rounded-lg select-all">
                  {createdWallet}
                </p>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                <div className="inline-flex p-3 bg-red-500/10 border-2 border-red-500 rounded-full text-red-500">
                  <AlertCircle className="w-8 h-8" />
                </div>
                <h5 className="font-extrabold uppercase text-red-700 text-sm">Authentication Error</h5>
                <p className="text-xs text-red-600 font-medium leading-relaxed px-4">
                  {errorMessage}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep('select')}
                  className="w-1/2 py-2.5 bg-white border-3 border-[#744D2B] rounded-full text-xs font-black uppercase text-[#744D2B] hover:bg-[#FCFAF6] transition-colors cursor-pointer"
                >
                  Start Over
                </button>
                <button
                  onClick={() => handleMockAuth(email || 'mock_user@domain.com')}
                  className="w-1/2 py-2.5 bg-[#F4C455] border-3 border-[#744D2B] rounded-full text-xs font-black uppercase text-[#744D2B] hover:bg-[#FCFAF6] transition-colors cursor-pointer"
                >
                  Demo Sandbox Mode
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
