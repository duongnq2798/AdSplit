-- Supabase SQL Schema for AdSplit Protocol
-- Schema: adsplit (isolated custom schema for security and multi-tenant isolation)
-- Created: 2026-05-22
-- Updated: 2026-06-02

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

-- Add indexes on active status and IP address for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON adsplit.campaigns(active);
CREATE INDEX IF NOT EXISTS idx_click_logs_ip ON adsplit.click_logs(ip_address);

-- Grant select/insert/update privileges to roles
GRANT ALL ON ALL TABLES IN SCHEMA adsplit TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA adsplit TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA adsplit TO anon, authenticated, service_role;

-- Enable Row Level Security (RLS)
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

-- 5. MICRO BALANCES TABLE (x402 micro-settlements)
CREATE TABLE IF NOT EXISTS adsplit.micro_balances (
    campaign_id VARCHAR(66) NOT NULL,
    creator_address VARCHAR(42) NOT NULL,
    balance NUMERIC(20, 6) DEFAULT 0.000000,
    settling_amount NUMERIC(20, 6) DEFAULT 0.000000,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (campaign_id, creator_address)
);

ALTER TABLE adsplit.micro_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow select micro_balances for anyone" ON adsplit.micro_balances FOR SELECT USING (true);
CREATE POLICY "Allow all micro_balances for service_role or authenticated" ON adsplit.micro_balances FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON adsplit.micro_balances TO anon, authenticated, service_role;

-- 6. DATABASE FUNCTION TO SAFELY LOCK AND INITIATE SETTLEMENT
CREATE OR REPLACE FUNCTION adsplit.lock_micro_balances_for_settlement(threshold_val NUMERIC)
RETURNS TABLE (
    campaign_id VARCHAR(66),
    creator_address VARCHAR(42),
    settling_amount NUMERIC(20, 6)
) AS $$
BEGIN
    RETURN QUERY
    WITH target_rows AS (
        SELECT mb.campaign_id, mb.creator_address, mb.balance
        FROM adsplit.micro_balances mb
        WHERE mb.balance >= threshold_val AND mb.settling_amount = 0
        FOR UPDATE
    )
    UPDATE adsplit.micro_balances mb
    SET settling_amount = tr.balance
    FROM target_rows tr
    WHERE mb.campaign_id = tr.campaign_id AND mb.creator_address = tr.creator_address
    RETURNING mb.campaign_id, mb.creator_address, mb.settling_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION adsplit.lock_micro_balances_for_settlement(NUMERIC) TO anon, authenticated, service_role;

-- 7. DATABASE FUNCTION TO SAFELY INCREMENT MICRO BALANCE
CREATE OR REPLACE FUNCTION adsplit.increment_micro_balance(
    p_campaign_id VARCHAR(66),
    p_creator_address VARCHAR(42),
    p_amount NUMERIC(20, 6)
) RETURNS VOID AS $$
BEGIN
    INSERT INTO adsplit.micro_balances (campaign_id, creator_address, balance, settling_amount)
    VALUES (p_campaign_id, p_creator_address, p_amount, 0)
    ON CONFLICT (campaign_id, creator_address)
    DO UPDATE SET balance = adsplit.micro_balances.balance + p_amount, updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION adsplit.increment_micro_balance(VARCHAR, VARCHAR, NUMERIC) TO anon, authenticated, service_role;

-- 8. DATABASE FUNCTIONS TO CONFIRM OR ROLLBACK MICRO SETTLEMENTS
CREATE OR REPLACE FUNCTION adsplit.confirm_micro_settlement(
    p_campaign_id VARCHAR(66),
    p_creator_address VARCHAR(42),
    p_amount NUMERIC(20, 6)
) RETURNS VOID AS $$
BEGIN
    UPDATE adsplit.micro_balances
    SET balance = balance - p_amount,
        settling_amount = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE campaign_id = p_campaign_id AND creator_address = p_creator_address;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION adsplit.rollback_micro_settlement(
    p_campaign_id VARCHAR(66),
    p_creator_address VARCHAR(42)
) RETURNS VOID AS $$
BEGIN
    UPDATE adsplit.micro_balances
    SET settling_amount = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE campaign_id = p_campaign_id AND creator_address = p_creator_address;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION adsplit.confirm_micro_settlement(VARCHAR, VARCHAR, NUMERIC) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION adsplit.rollback_micro_settlement(VARCHAR, VARCHAR) TO anon, authenticated, service_role;

-- 9. GATEWAY DEPOSITS TABLE (x402 Micropayment channel advertiser balance)
CREATE TABLE IF NOT EXISTS adsplit.gateway_deposits (
    advertiser_address VARCHAR(42) PRIMARY KEY,
    balance NUMERIC(20, 6) DEFAULT 0.000000,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE adsplit.gateway_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow select gateway_deposits for anyone" ON adsplit.gateway_deposits FOR SELECT USING (true);
CREATE POLICY "Allow all gateway_deposits for service_role or authenticated" ON adsplit.gateway_deposits FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON adsplit.gateway_deposits TO anon, authenticated, service_role;

-- 10. DATABASE FUNCTION FOR DEPOSIT TO GATEWAY
CREATE OR REPLACE FUNCTION adsplit.deposit_to_gateway(
    p_advertiser VARCHAR(42),
    p_amount NUMERIC(20, 6)
) RETURNS VOID AS $$
BEGIN
    INSERT INTO adsplit.gateway_deposits (advertiser_address, balance)
    VALUES (p_advertiser, p_amount)
    ON CONFLICT (advertiser_address)
    DO UPDATE SET balance = adsplit.gateway_deposits.balance + p_amount, updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION adsplit.deposit_to_gateway(VARCHAR, NUMERIC) TO anon, authenticated, service_role;

-- 11. DATABASE FUNCTION FOR DEDUCT FROM GATEWAY WITH SUFFICIENCY CHECK
CREATE OR REPLACE FUNCTION adsplit.deduct_gateway_balance(
    p_advertiser VARCHAR(42),
    p_amount NUMERIC(20, 6)
) RETURNS BOOLEAN AS $$
DECLARE
    v_balance NUMERIC(20, 6);
BEGIN
    SELECT balance INTO v_balance FROM adsplit.gateway_deposits WHERE advertiser_address = p_advertiser FOR UPDATE;
    IF v_balance IS NULL OR v_balance < p_amount THEN
        RETURN FALSE;
    END IF;
    
    UPDATE adsplit.gateway_deposits
    SET balance = balance - p_amount, updated_at = CURRENT_TIMESTAMP
    WHERE advertiser_address = p_advertiser;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION adsplit.deduct_gateway_balance(VARCHAR, NUMERIC) TO anon, authenticated, service_role;
-- 12. CCTP BRIDGE CLAIMS TRACKING TABLE
CREATE TABLE IF NOT EXISTS adsplit.bridge_claims (
    burn_tx_hash VARCHAR(66) PRIMARY KEY,
    campaign_id VARCHAR(66) REFERENCES adsplit.campaigns(id) ON DELETE SET NULL,
    source_chain VARCHAR(50) NOT NULL,
    recipient_address VARCHAR(42) NOT NULL,
    amount NUMERIC(20, 6) NOT NULL,
    status VARCHAR(20) DEFAULT 'claiming',
    claim_tx_hash VARCHAR(66),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE adsplit.bridge_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow select bridge_claims for anyone" ON adsplit.bridge_claims FOR SELECT USING (true);
CREATE POLICY "Allow all bridge_claims for service_role or authenticated" ON adsplit.bridge_claims FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON adsplit.bridge_claims TO anon, authenticated, service_role;

