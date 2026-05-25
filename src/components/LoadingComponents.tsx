'use client';

import React from 'react';

/**
 * AdSplit Cozy Loading Component Library
 * 
 * High-performance, 60fps, Neobrutalist cozy loading components
 * custom-tailored to the project's Animal Crossing / NookPhone style.
 */

// 1. Inline Spinner for buttons and compact status areas
export function ButtonLoader({ text }: { text?: string }) {
  return (
    <span className="flex items-center justify-center gap-2 select-none">
      <span className="spinner-inline shrink-0" />
      <span className="font-extrabold uppercase tracking-wider">{text || 'Processing...'}</span>
    </span>
  );
}

// 2. Tactile Stats Box Skeleton loader
export function StatsSkeleton() {
  return (
    <div className="border-3 border-[#744D2B] bg-[#FCFAF6] p-4 rounded-3xl shadow-[0_4px_0_#744D2B] space-y-3 relative overflow-hidden">
      <div className="shimmer skeleton h-3.5 w-16" />
      <div className="shimmer skeleton h-6 w-24" />
      <div className="shimmer skeleton h-3.5 w-full" />
      <div className="absolute inset-0 pointer-events-none border-2 border-transparent rounded-[24px] overflow-hidden"></div>
    </div>
  );
}

// 3. Neobrutalist Campaign Card Skeleton
export function CampaignCardSkeleton() {
  return (
    <div className="blueprint-panel p-5 space-y-4 bg-white relative overflow-hidden">
      {/* Title block */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="shimmer skeleton h-5 w-3/4" />
          <div className="shimmer skeleton h-3.5 w-1/2" />
        </div>
        <div className="shimmer skeleton h-6 w-14 rounded-full" />
      </div>

      <hr className="border-2 border-[#744D2B]/10" />

      {/* Numerical Metrics */}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border-2 border-[#744D2B]/10 bg-[#FCFAF6] p-3 rounded-2xl space-y-1.5">
            <div className="shimmer skeleton h-2.5 w-12" />
            <div className="shimmer skeleton h-4 w-16" />
          </div>
        ))}
      </div>

      {/* Campaign Info / Owner block */}
      <div className="flex items-center gap-3 bg-[#FCFAF6] border-2 border-[#744D2B]/10 p-3 rounded-2xl">
        <div className="shimmer skeleton h-7 w-7 rounded-full shrink-0" />
        <div className="space-y-1.5 flex-1">
          <div className="shimmer skeleton h-2.5 w-2/3" />
          <div className="shimmer skeleton h-2 w-1/2" />
        </div>
      </div>

      {/* Custom footer actions */}
      <div className="pt-1 flex items-center justify-between gap-3">
        <div className="shimmer skeleton h-9 w-28 rounded-full" />
        <div className="shimmer skeleton h-7 w-12 rounded-full" />
      </div>
    </div>
  );
}

// 4. Compact Table / Row Skeleton
export function TableSkeleton() {
  return (
    <div className="blueprint-panel p-5 bg-white space-y-4 relative overflow-hidden">
      {/* Table Header mock */}
      <div className="flex items-center justify-between pb-3 border-b-2 border-[#744D2B]/20">
        <div className="shimmer skeleton h-4 w-28" />
        <div className="shimmer skeleton h-4 w-16" />
      </div>

      {/* Dynamic Rows */}
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div 
            key={i} 
            className="flex items-center justify-between p-3.5 border-2 border-[#744D2B]/10 rounded-2xl bg-[#FCFAF6]"
          >
            <div className="flex items-center gap-3 flex-1">
              <div className="shimmer skeleton h-6 w-6 rounded-full shrink-0" />
              <div className="space-y-1.5 flex-1">
                <div className="shimmer skeleton h-3 w-1/3" />
                <div className="shimmer skeleton h-2.5 w-1/2" />
              </div>
            </div>
            <div className="shimmer skeleton h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// 5. Image Loading Placeholder with shimmer
export function ImagePlaceholder({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [loaded, setLoaded] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement>(null);

  React.useEffect(() => {
    if (imgRef.current && imgRef.current.complete) {
      setLoaded(true);
    }
  }, []);

  return (
    <div className="relative overflow-hidden w-full h-full bg-[#FCFAF6] flex items-center justify-center">
      {!loaded && (
        <div className="absolute inset-0 shimmer flex items-center justify-center">
          <span className="text-[10px] text-[#A78E84] font-black uppercase tracking-wider animate-pulse-gentle">
            Loading Media...
          </span>
        </div>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`${className || ''} transition-all duration-500 ease-out ${loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

// 6. Section Page Loader Transition
export function TabSectionLoader() {
  return (
    <div className="blueprint-panel p-12 bg-white flex flex-col items-center justify-center text-center space-y-4 min-h-[300px]">
      <div className="h-14 w-14 bg-[#F4C455] border-3 border-[#744D2B] rounded-2xl flex items-center justify-center text-[#744D2B] font-bold text-2xl shadow-[0_4px_0_#744D2B] cozy-bounce animate-pulse-gentle">
        🍃
      </div>
      <div className="space-y-1.5">
        <h4 className="text-sm font-black uppercase text-[#744D2B] tracking-wider">
          Syncing Ledger Records...
        </h4>
        <p className="text-[10px] text-[#8E7368] font-bold uppercase tracking-widest leading-none">
          Arc L1 Node • Supabase Escrow DB
        </p>
      </div>
    </div>
  );
}
