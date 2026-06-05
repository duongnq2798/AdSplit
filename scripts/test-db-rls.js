// Integration Test for Database Schema & RLS Policies
// Executed under Node.js (ESM)
// Usage: node scripts/test-db-rls.js

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Parse .env manually to avoid extra dependencies
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Error: .env file not found.');
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      env[key] = value;
    }
  });
  return env;
}

async function runTests() {
  console.log('--- STARTING DATABASE SCHEMA & RLS INTEGRATION TESTS ---');
  const env = loadEnv();
  
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Error: Supabase configurations missing in .env file.');
    process.exit(1);
  }

  console.log('Supabase Project URL:', supabaseUrl);
  console.log('Target Schema:', 'adsplit');

  // Initialize Anonymous Client (Client-Side Simulation)
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: 'adsplit' }
  });

  // TEST 1: Read campaigns (Allowed by policy "Allow select campaigns for anyone")
  console.log('\n[Test 1] Testing anonymous read access to adsplit.campaigns...');
  const { data: campaigns, error: readError } = await anonClient
    .from('campaigns')
    .select('*')
    .limit(1);

  if (readError) {
    console.error('❌ Test 1 Failed: Anonymous read was blocked or failed.', readError.message);
  } else {
    console.log('✅ Test 1 Passed: Anonymous read allowed. Active campaigns count in result:', campaigns.length);
  }

  // TEST 2: Anonymous Insert campaign (Blocked by policy - restricted to authenticated/service_role)
  console.log('\n[Test 2] Testing anonymous write access to adsplit.campaigns (Should be Blocked)...');
  const dummyCampaign = {
    id: '0xmock_test_campaign_' + Math.floor(Math.random() * 100000),
    title: 'Unauthorized Test Campaign',
    advertiser: '0x0000000000000000000000000000000000000000',
    total_budget: 100.0,
    remaining_budget: 100.0,
    cost_per_click: 1.0,
    active: true
  };

  const { error: writeError } = await anonClient
    .from('campaigns')
    .insert([dummyCampaign]);

  if (writeError) {
    console.log('✅ Test 2 Passed: Anonymous insert was successfully blocked. Reason:', writeError.message);
  } else {
    console.error('❌ Test 2 Failed: Anonymous insert succeeded! RLS is not blocking unauthorized writes.');
  }

  // TEST 3: Service Role Access (Backend simulation)
  console.log('\n[Test 3] Testing backend service_role access...');
  if (!serviceRoleKey) {
    console.log('⚠️ Skipping Test 3: SUPABASE_SERVICE_ROLE_KEY not found in env variables.');
  } else {
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      db: { schema: 'adsplit' }
    });

    console.log('Inserting test campaign via service_role...');
    const { error: serviceInsertError } = await serviceClient
      .from('campaigns')
      .insert([dummyCampaign]);

    if (serviceInsertError) {
      console.error('❌ Test 3 Failed: Service role insert was blocked.', serviceInsertError.message);
    } else {
      console.log('✅ Test 3 Passed: Service role insert succeeded!');
      
      // Cleanup the inserted test campaign
      console.log('Cleaning up test campaign...');
      const { error: deleteError } = await serviceClient
        .from('campaigns')
        .delete()
        .eq('id', dummyCampaign.id);

      if (deleteError) {
        console.warn('Cleanup warning: Failed to delete test campaign.', deleteError.message);
      } else {
        console.log('Test campaign cleaned up successfully.');
      }
    }
  }

  console.log('\n--- DATABASE INTEGRATION TESTS CONCLUDED ---');
}

runTests().catch(err => {
  console.error('Unhandled test execution error:', err);
  process.exit(1);
});
