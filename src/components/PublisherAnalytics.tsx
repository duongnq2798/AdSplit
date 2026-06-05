"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import { 
  Code2, 
  TrendingUp, 
  MousePointerClick, 
  DollarSign, 
  Percent, 
  Copy, 
  Check, 
  Globe, 
  Plus, 
  ShieldCheck, 
  Users 
} from 'lucide-react';

interface PublisherAnalyticsProps {
  campaigns: any[];
  userWallet: string;
}

export default function PublisherAnalytics({ campaigns, userWallet }: PublisherAnalyticsProps) {
  // Stats state
  const [impressions, setImpressions] = useState(145800);
  const [clicks, setClicks] = useState(2916);
  const [revenue, setRevenue] = useState(58.32);
  const [affiliateRewards, setAffiliateRewards] = useState(12.45);
  
  // Whitelist domains state
  const [domains, setDomains] = useState<{ domain: string; publisher_wallet: string }[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [isAddingDomain, setIsAddingDomain] = useState(false);
  const [domainStatus, setDomainStatus] = useState<string | null>(null);

  // Snippet generator state
  const [selectedCampaign, setSelectedCampaign] = useState(campaigns[0]?.id || '');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (campaigns.length > 0 && !selectedCampaign) {
      setSelectedCampaign(campaigns[0].id);
    }
  }, [campaigns, selectedCampaign]);

  // Load Whitelisted domains from Supabase
  const loadDomains = async () => {
    try {
      const { data, error } = await supabase
        .from('registered_domains')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setDomains(data || []);
    } catch (e) {
      console.warn('Fallback to local mock domains list:', e);
      setDomains([
        { domain: 'localhost', publisher_wallet: userWallet || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
        { domain: 'my-publisher-site.com', publisher_wallet: userWallet || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' }
      ]);
    }
  };

  useEffect(() => {
    loadDomains();
  }, []);

  // Handle adding new whitelisted domain
  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain.trim()) return;

    setIsAddingDomain(true);
    setDomainStatus(null);

    const cleanDomain = newDomain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].trim();

    try {
      const { error } = await supabase
        .from('registered_domains')
        .insert([{
          domain: cleanDomain,
          publisher_wallet: userWallet || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
        }]);

      if (error) throw error;

      setDomainStatus(`Successfully registered: ${cleanDomain}`);
      setNewDomain('');
      loadDomains();
    } catch (err: any) {
      console.error('Failed to register domain:', err);
      // Fallback local state for local testing
      setDomains(prev => [{ domain: cleanDomain, publisher_wallet: userWallet || '0x70997970' }, ...prev]);
      setDomainStatus(`Registered local: ${cleanDomain}`);
      setNewDomain('');
    } finally {
      setIsAddingDomain(false);
      setTimeout(() => setDomainStatus(null), 3000);
    }
  };

  // Build snippet
  const host = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const generatedCode = `<div data-adsplit-zone="banner-1"${selectedCampaign ? ` data-campaign-id="${selectedCampaign}"` : ''}></div>\n<script src="${host}/adsplit-tag.js" async></script>`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // CTR computation
  const ctr = ((clicks / impressions) * 100).toFixed(2);

  // Weekly analytics representation (custom SVG path calculation)
  const chartData = [
    { day: 'Mon', clicks: 310, rev: 6.2 },
    { day: 'Tue', clicks: 420, rev: 8.4 },
    { day: 'Wed', clicks: 380, rev: 7.6 },
    { day: 'Thu', clicks: 510, rev: 10.2 },
    { day: 'Fri', clicks: 490, rev: 9.8 },
    { day: 'Sat', clicks: 390, rev: 7.8 },
    { day: 'Sun', clicks: 416, rev: 8.32 }
  ];

  // Calculate SVG line points
  const width = 500;
  const height = 150;
  const points = chartData.map((d, index) => {
    const x = (index / (chartData.length - 1)) * (width - 40) + 20;
    const y = height - ((d.clicks / 600) * (height - 30) + 15);
    return `${x},${y}`;
  }).join(' ');

  // Calculate area path
  const areaPoints = `${points} ${width - 20},${height} 20,${height}`;

  return (
    <div className="space-y-8">
      {/* 1. Header & Quick Analytics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Impressions */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-blue-500/50 transition-all duration-300">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Impressions</span>
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <TrendingUp size={16} />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-bold text-slate-100">{impressions.toLocaleString()}</h3>
            <span className="text-xs text-emerald-400 font-medium mt-1 flex items-center gap-1">
              +14.2% <span className="text-slate-500">vs last week</span>
            </span>
          </div>
        </div>

        {/* Clicks */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-violet-500/50 transition-all duration-300">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Clicks</span>
            <div className="p-2 bg-violet-500/10 rounded-lg text-violet-400">
              <MousePointerClick size={16} />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-bold text-slate-100">{clicks.toLocaleString()}</h3>
            <span className="text-xs text-emerald-400 font-medium mt-1 flex items-center gap-1">
              +8.7% <span className="text-slate-500">vs last week</span>
            </span>
          </div>
        </div>

        {/* CTR */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-amber-500/50 transition-all duration-300">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">CTR</span>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <Percent size={16} />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-bold text-slate-100">{ctr}%</h3>
            <span className="text-xs text-emerald-400 font-medium mt-1 flex items-center gap-1">
              +0.2% <span className="text-slate-500">vs benchmark</span>
            </span>
          </div>
        </div>

        {/* Ad Earnings */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-emerald-500/50 transition-all duration-300">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Publisher Revenue</span>
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <DollarSign size={16} />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-bold text-slate-100">{revenue.toFixed(2)} <span className="text-sm font-semibold text-emerald-400">USDC</span></h3>
            <span className="text-xs text-slate-500 mt-1 block">USDC gasless payouts settled</span>
          </div>
        </div>

        {/* Affiliate Rewards */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-pink-500/50 transition-all duration-300">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Referral Split (15%)</span>
            <div className="p-2 bg-pink-500/10 rounded-lg text-pink-400">
              <Users size={16} />
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-2xl font-bold text-slate-100">{affiliateRewards.toFixed(2)} <span className="text-sm font-semibold text-pink-400">USDC</span></h3>
            <span className="text-xs text-pink-400 mt-1 block font-medium">15% commission accrued</span>
          </div>
        </div>
      </div>

      {/* 2. Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Clicks & Revenue Trend Line */}
        <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h4 className="text-sm font-bold text-slate-100">Performance Trend</h4>
              <p className="text-xs text-slate-400 mt-0.5">Track daily click analytics & earnings</p>
            </div>
            <div className="flex gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Clicks</span>
            </div>
          </div>

          <div className="relative">
            {/* Custom SVG Line Chart */}
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible">
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {/* Grid Lines */}
              <line x1="20" y1={height - 15} x2={width - 20} y2={height - 15} stroke="#1e293b" strokeWidth="1" />
              <line x1="20" y1={height / 2} x2={width - 20} y2={height / 2} stroke="#1e293b" strokeWidth="1" />
              <line x1="20" y1="15" x2={width - 20} y2="15" stroke="#1e293b" strokeWidth="1" />
              
              {/* Area */}
              <polygon points={areaPoints} fill="url(#chartGradient)" />

              {/* Path line */}
              <polyline fill="none" stroke="#3b82f6" strokeWidth="2.5" points={points} />

              {/* Data points */}
              {chartData.map((d, index) => {
                const x = (index / (chartData.length - 1)) * (width - 40) + 20;
                const y = height - ((d.clicks / 600) * (height - 30) + 15);
                return (
                  <g key={index} className="group">
                    <circle cx={x} cy={y} r="4" fill="#1e293b" stroke="#3b82f6" strokeWidth="2" />
                    <text x={x} y={y - 10} textAnchor="middle" fill="#fff" className="text-[9px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 duration-200">
                      {d.clicks}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* X Axis labels */}
            <div className="flex justify-between px-4 mt-2">
              {chartData.map((d, i) => (
                <span key={i} className="text-[10px] text-slate-500 font-semibold">{d.day}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Campaign Share Breakdown */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-100">DSP Publisher Shares</h4>
            <p className="text-xs text-slate-400 mt-0.5">Automatic breakdown on click settlement</p>
          </div>
          
          <div className="my-6 space-y-4">
            {/* Creator share */}
            <div>
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-slate-300">Creator payout</span>
                <span className="text-emerald-400">80.0%</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full rounded-full" style={{ width: '80%' }}></div>
              </div>
            </div>

            {/* Affiliate share */}
            <div>
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-slate-300">Affiliate split</span>
                <span className="text-pink-400">15.0%</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div className="bg-pink-500 h-full rounded-full" style={{ width: '15%' }}></div>
              </div>
            </div>

            {/* Platform share */}
            <div>
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-slate-300">Platform fee</span>
                <span className="text-blue-400">5.0%</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div className="bg-blue-500 h-full rounded-full" style={{ width: '5%' }}></div>
              </div>
            </div>
          </div>

          <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800/80 flex items-start gap-2">
            <ShieldCheck className="text-emerald-400 shrink-0 mt-0.5" size={14} />
            <p className="text-[10px] text-slate-400 leading-normal">
              Splits are enforced natively by `AdRevenueSplitter.sol` upon execution. Payouts resolve to wallets instantly without admin locks.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Code Snippet Generator & Whitelist Domain Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Code Snippet Generator */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Code2 className="text-blue-400" size={18} />
            <h4 className="text-sm font-bold text-slate-100">Ad Tag Embed Tool</h4>
          </div>
          <p className="text-xs text-slate-400 leading-normal">
            Generate and place ad spots on your external websites. The script handles interactive banners, tracks real mouse telemetry, and records clicks automatically.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Select Campaign Ad Banner</label>
              <select 
                value={selectedCampaign}
                onChange={(e) => setSelectedCampaign(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              >
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.cost_per_click} USDC/click)
                  </option>
                ))}
                {campaigns.length === 0 && (
                  <option value="">No campaigns available</option>
                )}
              </select>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">HTML Script Embed Code</label>
                <button 
                  onClick={copyToClipboard}
                  className="flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy Code'}
                </button>
              </div>
              <pre className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300 font-mono overflow-x-auto whitespace-pre leading-relaxed">
                {generatedCode}
              </pre>
            </div>
          </div>
        </div>

        {/* Publisher Whitelisted Domains */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="text-violet-400" size={18} />
            <h4 className="text-sm font-bold text-slate-100">Registered Publisher Domains</h4>
          </div>
          <p className="text-xs text-slate-400 leading-normal">
            For security, the ad server only processes telemetry checks and registers kliks originating from whitelisted publisher domains.
          </p>

          <form onSubmit={handleAddDomain} className="flex gap-2">
            <input 
              type="text" 
              placeholder="e.g. adsplit-publisher.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              className="grow bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500"
            />
            <button 
              type="submit" 
              disabled={isAddingDomain}
              className="bg-violet-600 hover:bg-violet-500 transition-colors text-white font-bold text-xs px-4 py-2 rounded-lg flex items-center gap-1.5"
            >
              <Plus size={14} />
              Add
            </button>
          </form>

          {domainStatus && (
            <div className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-lg">
              {domainStatus}
            </div>
          )}

          <div className="border border-slate-800 rounded-lg overflow-hidden max-h-[140px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                  <th className="p-2.5">Hostname Domain</th>
                  <th className="p-2.5">Publisher Wallet Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-950/20">
                {domains.map((dom, i) => (
                  <tr key={i} className="hover:bg-slate-900/30">
                    <td className="p-2.5 font-mono text-slate-200">{dom.domain}</td>
                    <td className="p-2.5 font-mono text-slate-400">
                      {dom.publisher_wallet.slice(0, 10)}...{dom.publisher_wallet.slice(-8)}
                    </td>
                  </tr>
                ))}
                {domains.length === 0 && (
                  <tr>
                    <td colSpan={2} className="p-4 text-center text-slate-500 font-medium">No domains whitelisted</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
