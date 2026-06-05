-- Migration 01: Set up the custom adsplit schema, tables, indexes, and RLS policies
-- Created: 2026-06-02

-- Create schema adsplit if not exists
CREATE SCHEMA IF NOT EXISTS adsplit;

-- Enable UUID extension in public schema (standard Supabase default)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- Grant usage on schema to api roles
GRANT USAGE ON SCHEMA adsplit TO anon, authenticated, service_role;

-- 1. CAMPAIGNS TABLE
CREATE TABLE IF NOT EXISTS adsplit.campaigns (
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
CREATE TABLE IF NOT EXISTS adsplit.campaign_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id VARCHAR(66) REFERENCES adsplit.campaigns(id) ON DELETE CASCADE,
    creator_address VARCHAR(42) NOT NULL,
    creator_name VARCHAR(255) NOT NULL,
    share_bps INT NOT NULL, -- in basis points (e.g. 8500 = 85%)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. CLICK ENGAGEMENT LOGS (ORACLE TELEMETRY)
CREATE TABLE IF NOT EXISTS adsplit.click_logs (
    id VARCHAR(66) PRIMARY KEY,
    campaign_id VARCHAR(66) REFERENCES adsplit.campaigns(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('valid', 'bot_fraud', 'duplicate')),
    payout_usdc NUMERIC(20, 6) DEFAULT 0.000000,
    creator_payout_usdc NUMERIC(20, 6) DEFAULT 0.000000,
    platform_payout_usdc NUMERIC(20, 6) DEFAULT 0.000000,
    distributor_payout_usdc NUMERIC(20, 6) DEFAULT 0.000000
);

-- 4. BLACKLISTED IPS TABLE (AI ORACLE AUTO-BLOCK)
CREATE TABLE IF NOT EXISTS adsplit.ip_blacklist (
    ip_address VARCHAR(45) PRIMARY KEY,
    reason TEXT NOT NULL,
    blocked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add index on campaign active status for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON adsplit.campaigns(active);
CREATE INDEX IF NOT EXISTS idx_click_logs_ip ON adsplit.click_logs(ip_address);

-- Grant select/insert/update privileges to roles
GRANT ALL ON ALL TABLES IN SCHEMA adsplit TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA adsplit TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA adsplit TO anon, authenticated, service_role;

-- Enable RLS
ALTER TABLE adsplit.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsplit.campaign_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsplit.click_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsplit.ip_blacklist ENABLE ROW LEVEL SECURITY;

-- Campaigns Policies:
CREATE POLICY "Allow select campaigns for anyone" ON adsplit.campaigns FOR SELECT USING (true);
CREATE POLICY "Allow insert campaigns for service_role or authenticated" ON adsplit.campaigns FOR INSERT TO authenticated, service_role WITH CHECK (true);
CREATE POLICY "Allow update campaigns for service_role or authenticated" ON adsplit.campaigns FOR UPDATE TO authenticated, service_role USING (true) WITH CHECK (true);

-- Splits Policies:
CREATE POLICY "Allow select splits for anyone" ON adsplit.campaign_splits FOR SELECT USING (true);
CREATE POLICY "Allow insert splits for service_role or authenticated" ON adsplit.campaign_splits FOR INSERT TO authenticated, service_role WITH CHECK (true);

-- Click Logs Policies:
CREATE POLICY "Allow select click logs for anyone" ON adsplit.click_logs FOR SELECT USING (true);
CREATE POLICY "Allow insert click logs for service_role or authenticated" ON adsplit.click_logs FOR INSERT TO authenticated, service_role WITH CHECK (true);

-- IP Blacklist Policies:
CREATE POLICY "Allow select ip_blacklist for anyone" ON adsplit.ip_blacklist FOR SELECT USING (true);
CREATE POLICY "Allow insert ip_blacklist for service_role or authenticated" ON adsplit.ip_blacklist FOR INSERT TO authenticated, service_role WITH CHECK (true);
