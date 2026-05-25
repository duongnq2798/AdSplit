-- Supabase SQL Schema for AdSplit Protocol
-- Schema: public (default Supabase exposed schema)
-- Created: 2026-05-22
-- Updated: 2026-05-26

-- Enable UUID extension in public schema (standard Supabase default)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- 1. CAMPAIGNS TABLE
CREATE TABLE IF NOT EXISTS public.campaigns (
    id VARCHAR(66) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    advertiser VARCHAR(42) NOT NULL,
    total_budget NUMERIC(20, 6) NOT NULL,
    remaining_budget NUMERIC(20, 6) NOT NULL,
    cost_per_click NUMERIC(20, 6) NOT NULL,
    total_clicks INT DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    platform_share INT DEFAULT 300, -- in basis points (3.0%)
    distributor_share INT DEFAULT 1000, -- in basis points (10.0%)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. CREATORS SPLIT TABLE
CREATE TABLE IF NOT EXISTS public.campaign_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id VARCHAR(66) REFERENCES public.campaigns(id) ON DELETE CASCADE,
    creator_address VARCHAR(42) NOT NULL,
    creator_name VARCHAR(255) NOT NULL,
    share_bps INT NOT NULL, -- in basis points (e.g. 8500 = 85%)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. CLICK ENGAGEMENT LOGS (ORACLE TELEMETRY)
CREATE TABLE IF NOT EXISTS public.click_logs (
    id VARCHAR(66) PRIMARY KEY,
    campaign_id VARCHAR(66) REFERENCES public.campaigns(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('valid', 'bot_fraud', 'duplicate')),
    payout_usdc NUMERIC(20, 6) DEFAULT 0.000000,
    creator_payout_usdc NUMERIC(20, 6) DEFAULT 0.000000,
    platform_payout_usdc NUMERIC(20, 6) DEFAULT 0.000000,
    distributor_payout_usdc NUMERIC(20, 6) DEFAULT 0.000000
);

-- 4. BLACKLISTED IPS TABLE (AI ORACLE AUTO-BLOCK)
CREATE TABLE IF NOT EXISTS public.ip_blacklist (
    ip_address VARCHAR(45) PRIMARY KEY,
    reason TEXT NOT NULL,
    blocked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add index on campaign active status for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON public.campaigns(active);
CREATE INDEX IF NOT EXISTS idx_click_logs_ip ON public.click_logs(ip_address);

-- 5. DISABLE RLS FOR HACKATHON DEMO (allows anon key full access)
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.click_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_blacklist ENABLE ROW LEVEL SECURITY;

-- Allow all operations for anon and authenticated roles (hackathon demo only)
CREATE POLICY "Allow all for campaigns" ON public.campaigns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for campaign_splits" ON public.campaign_splits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for click_logs" ON public.click_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for ip_blacklist" ON public.ip_blacklist FOR ALL USING (true) WITH CHECK (true);
