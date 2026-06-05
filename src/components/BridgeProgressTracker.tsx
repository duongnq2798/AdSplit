import React from 'react';

export interface BridgeStep {
  label: string;
  description: string;
  status: 'idle' | 'running' | 'success' | 'failed';
  txHash?: string;
  explorerUrl?: string;
}

interface BridgeProgressTrackerProps {
  steps: BridgeStep[];
  amount: number;
  sourceChain: string;
  destinationAddress: string;
  estimatedTimeLeft: string; // e.g. "45s"
}

export const BridgeProgressTracker: React.FC<BridgeProgressTrackerProps> = ({
  steps,
  amount,
  sourceChain,
  destinationAddress,
  estimatedTimeLeft
}) => {
  const getStatusColor = (status: BridgeStep['status']) => {
    switch (status) {
      case 'success':
        return 'text-green-400 bg-green-950 border-green-500/30';
      case 'failed':
        return 'text-red-400 bg-red-950 border-red-500/30';
      case 'running':
        return 'text-amber-400 bg-amber-950 border-amber-500/30 animate-pulse';
      default:
        return 'text-zinc-500 bg-zinc-900 border-zinc-800';
    }
  };

  const getStepIndicator = (status: BridgeStep['status'], index: number) => {
    switch (status) {
      case 'success':
        return (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-[10px] font-bold text-black shadow-[0_0_12px_rgba(34,197,94,0.5)]">
            ✓
          </span>
        );
      case 'failed':
        return (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-[0_0_12px_rgba(239,68,68,0.5)]">
            ✕
          </span>
        );
      case 'running':
        return (
          <span className="relative flex h-6 w-6 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-black">
              ⚡
            </span>
          </span>
        );
      default:
        return (
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] font-bold text-zinc-500">
            {index + 1}
          </span>
        );
    }
  };

  const isAnyStepActive = steps.some(s => s.status === 'running');
  const isAllSuccess = steps.every(s => s.status === 'success');

  return (
    <div className="rounded-xl border border-yellow-500/20 bg-zinc-950/70 p-4 font-mono text-xs text-zinc-300 shadow-2xl backdrop-blur-md">
      <div className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-2">
        <div>
          <span className="text-zinc-500 text-[10px] uppercase tracking-wider block">Bridge Transaction</span>
          <span className="text-amber-400 font-bold">{amount} USDC</span>
          <span className="text-zinc-500 text-[10px] ml-1">from {sourceChain} to Arc L1</span>
        </div>
        <div className="text-right">
          <span className="text-zinc-500 text-[10px] uppercase tracking-wider block">Est. Time Remaining</span>
          <span className="text-amber-400 font-bold">{isAllSuccess ? '0s' : estimatedTimeLeft}</span>
        </div>
      </div>

      <div className="space-y-4 relative">
        {steps.map((step, idx) => (
          <div key={idx} className="flex items-start space-x-3 relative">
            {idx < steps.length - 1 && (
              <div 
                className={`absolute left-3 top-6 w-[2px] h-[calc(100%-12px)] ${
                  step.status === 'success' ? 'bg-green-500' : 'bg-zinc-800'
                }`}
              />
            )}
            
            <div className="z-10">{getStepIndicator(step.status, idx)}</div>
            
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className={`font-semibold ${step.status === 'running' ? 'text-amber-400' : step.status === 'success' ? 'text-green-400' : step.status === 'failed' ? 'text-red-400' : 'text-zinc-400'}`}>
                  {step.label}
                </span>
                <span className={`text-[9px] border rounded px-1.5 py-0.5 ${getStatusColor(step.status)}`}>
                  {step.status.toUpperCase()}
                </span>
              </div>
              <p className="text-[10px] text-zinc-500 mt-0.5">{step.description}</p>
              
              {step.txHash && (
                <div className="mt-1 flex items-center space-x-1.5">
                  <span className="text-[9px] text-zinc-600">Tx:</span>
                  <a 
                    href={step.explorerUrl || '#'} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-[9px] text-amber-500/80 hover:text-amber-400 hover:underline truncate max-w-[200px]"
                  >
                    {step.txHash}
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {isAnyStepActive && (
        <div className="mt-4 flex items-center justify-center py-2 bg-zinc-900/40 rounded-lg border border-zinc-800 animate-pulse">
          <div className="h-2 w-2 rounded-full bg-amber-400 mr-2 animate-ping" />
          <span className="text-[10px] text-amber-400/80 uppercase">Processing Bridge & Verification</span>
        </div>
      )}

      {isAllSuccess && (
        <div className="mt-4 flex items-center justify-center py-2 bg-green-950/30 rounded-lg border border-green-500/20">
          <span className="text-[10px] text-green-400 font-bold uppercase">🎉 Bridge Success! Campaign Active</span>
        </div>
      )}
    </div>
  );
};
