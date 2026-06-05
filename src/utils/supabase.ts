import { createClient } from '@supabase/supabase-js';

/**
 * AdSplit Supabase Database Client Configuration
 * 
 * Target Schema Name: adsplit
 * Synchronizes campaign escrow states, IP blacklists, and real-time click 
 * engagement oracle reports.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project-id.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: {
    schema: 'adsplit'
  }
});

export interface DbCampaign {
  id: string;
  title: string;
  advertiser: string;
  total_budget: number;
  remaining_budget: number;
  cost_per_click: number;
  total_clicks: number;
  active: boolean;
  platform_share: number;
  distributor_share: number;
}

export interface DbClickLog {
  id: string;
  campaign_id: string;
  ip_address: string;
  status: 'valid' | 'bot_fraud' | 'duplicate';
  payout_usdc: number;
  creator_payout_usdc: number;
  platform_payout_usdc: number;
  distributor_payout_usdc: number;
  timestamp?: string;
}

export class SupabaseDbService {
  /**
   * Fetch all campaigns sorted by creation date
   */
  async getActiveCampaigns(): Promise<DbCampaign[]> {
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('Supabase not connected. Falling back to local state:', e);
      return [];
    }
  }

  /**
   * Save a new campaign escrow deployment
   */
  async saveCampaign(campaign: DbCampaign, splits: { creator_address: string; creator_name: string; share_bps: number }[]): Promise<boolean> {
    try {
      const { error: campaignErr } = await supabase
        .from('campaigns')
        .insert([campaign]);

      if (campaignErr) throw campaignErr;

      const formattedSplits = splits.map(s => ({
        campaign_id: campaign.id,
        ...s
      }));

      const { error: splitErr } = await supabase
        .from('campaign_splits')
        .insert(formattedSplits);

      if (splitErr) throw splitErr;

      return true;
    } catch (e: any) {
      console.error('Failed to sync campaign to database:', e?.message || e, 'Details:', e?.details, 'Hint:', e?.hint, 'Code:', e?.code);
      return false;
    }
  }

  async logEngagement(log: DbClickLog): Promise<boolean> {
    try {
      // Check if parent campaign exists in database to prevent Foreign Key Violation
      const { data: parentCampaign } = await supabase
        .from('campaigns')
        .select('id')
        .eq('id', log.campaign_id)
        .maybeSingle();

      if (!parentCampaign) {
        // Parent campaign doesn't exist (e.g. pre-seeded mockup campaign clicked in Sandbox)
        // Dynamically insert a dummy parent campaign so click logging works flawlessly!
        const isDefaultMockup = log.campaign_id.startsWith('0xad000');
        const dummyCampaign: DbCampaign = {
          id: log.campaign_id,
          title: isDefaultMockup 
            ? (log.campaign_id === '0xad0001bc93' ? 'Circle Web3 Developer Drive' : 'Google Cloud Starter Credits')
            : `Sandbox Escrow Campaign (${log.campaign_id.substring(0, 8)})`,
          advertiser: '0xd91455cCe706509F67cD6303Cec089B5F319D72A',
          total_budget: 10.00,
          remaining_budget: 9.80,
          cost_per_click: log.payout_usdc > 0 ? log.payout_usdc : 0.02,
          total_clicks: 0,
          active: true,
          platform_share: 300,
          distributor_share: 1000
        };

        const { error: seedErr } = await supabase
          .from('campaigns')
          .insert([dummyCampaign]);

        if (seedErr) {
          console.warn('Failed to auto-seed dummy parent campaign:', seedErr.message);
        }
      }

      const { error } = await supabase
        .from('click_logs')
        .insert([log]);

      if (error) throw error;

      // If marked as bot fraud, auto-sync to blacklist table
      if (log.status === 'bot_fraud') {
        await supabase
          .from('ip_blacklist')
          .insert([{
            ip_address: log.ip_address,
            reason: 'AUTO_BLOCKED: Click fraud flood pattern detected by AI Oracle Node'
          }]);
      }

      return true;
    } catch (e: any) {
      console.error('Failed to sync click log to database:', e?.message || e, 'Details:', e?.details, 'Hint:', e?.hint, 'Code:', e?.code);
      return false;
    }
  }

  /**
   * Safely increment a creator's micro-payout balance for a campaign
   */
  async incrementMicroBalance(campaignId: string, creatorAddress: string, amount: number): Promise<boolean> {
    try {
      const { error } = await supabase.rpc('increment_micro_balance', {
        p_campaign_id: campaignId,
        p_creator_address: creatorAddress,
        p_amount: amount
      });
      if (error) throw error;
      return true;
    } catch (e: any) {
      console.error('Failed to increment micro balance:', e?.message || e);
      return false;
    }
  }

  /**
   * Lock micro balances exceeding a threshold for batch settlement on-chain
   */
  async lockMicroBalancesForSettlement(threshold: number): Promise<{ campaign_id: string; creator_address: string; settling_amount: number }[]> {
    try {
      const { data, error } = await supabase.rpc('lock_micro_balances_for_settlement', {
        threshold_val: threshold
      });
      if (error) throw error;
      return data || [];
    } catch (e: any) {
      console.error('Failed to lock micro balances for settlement:', e?.message || e);
      return [];
    }
  }

  /**
   * Confirm successful batch settlement on-chain, subtracting from total balance
   */
  async confirmSettlement(campaignId: string, creatorAddress: string, amount: number): Promise<boolean> {
    try {
      const { error } = await supabase.rpc('confirm_micro_settlement', {
        p_campaign_id: campaignId,
        p_creator_address: creatorAddress,
        p_amount: amount
      });
      if (error) throw error;
      return true;
    } catch (e: any) {
      console.error('Failed to confirm settlement:', e?.message || e);
      return false;
    }
  }

  /**
   * Rollback a failed batch settlement, resetting the settling amount back to available balance
   */
  async rollbackSettlement(campaignId: string, creatorAddress: string): Promise<boolean> {
    try {
      const { error } = await supabase.rpc('rollback_micro_settlement', {
        p_campaign_id: campaignId,
        p_creator_address: creatorAddress
      });
      if (error) throw error;
      return true;
    } catch (e: any) {
      console.error('Failed to rollback settlement:', e?.message || e);
      return false;
    }
  }

  /**
   * Deposit USDC to Circle Gateway off-chain balance ledger for an advertiser
   */
  async depositToGateway(advertiser: string, amount: number): Promise<boolean> {
    try {
      const { error } = await supabase.rpc('deposit_to_gateway', {
        p_advertiser: advertiser,
        p_amount: amount
      });
      if (error) throw error;
      return true;
    } catch (e: any) {
      console.error('Failed to deposit to gateway:', e?.message || e);
      return false;
    }
  }

  /**
   * Deduct advertiser's gateway balance during micropayments (x402 clicks)
   */
  async deductGatewayBalance(advertiser: string, amount: number): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('deduct_gateway_balance', {
        p_advertiser: advertiser,
        p_amount: amount
      });
      if (error) throw error;
      return !!data;
    } catch (e: any) {
      console.error('Failed to deduct gateway balance:', e?.message || e);
      return false;
    }
  }

  /**
   * Retrieve current gateway balance of an advertiser
   */
  async getGatewayBalance(advertiser: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('gateway_deposits')
        .select('balance')
        .eq('advertiser_address', advertiser)
        .maybeSingle();
      if (error) throw error;
      return data ? parseFloat(data.balance) : 0;
    } catch (e: any) {
      console.error('Failed to get gateway balance:', e?.message || e);
      return 0;
    }
  }
}

export interface DbMicroBalance {
  campaign_id: string;
  creator_address: string;
  balance: number;
  settling_amount: number;
  updated_at?: string;
}

