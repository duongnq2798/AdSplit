-- Migration 02: Set up the creators profile table inside the adsplit schema
-- Created: 2026-06-02

-- Create the creators profile table
CREATE TABLE IF NOT EXISTS adsplit.creators (
    email VARCHAR(255) PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS
ALTER TABLE adsplit.creators ENABLE ROW LEVEL SECURITY;

-- Creators Policies
CREATE POLICY "Allow select creators for anyone" ON adsplit.creators FOR SELECT USING (true);
CREATE POLICY "Allow insert creators for anyone" ON adsplit.creators FOR INSERT TO anon, authenticated, service_role WITH CHECK (true);
CREATE POLICY "Allow update creators for anyone" ON adsplit.creators FOR UPDATE TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- Grant privileges
GRANT ALL ON adsplit.creators TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE ON adsplit.creators TO anon, authenticated;
