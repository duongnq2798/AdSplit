import { NextResponse } from 'next/server';
import { SupabaseDbService } from '@/utils/supabase';

export async function GET() {
  try {
    const dbService = new SupabaseDbService();
    const campaigns = await dbService.getActiveCampaigns();
    // Filter only active ones with remaining budget > 0
    const activeCampaigns = campaigns.filter(c => c.active && c.remaining_budget > 0);
    return NextResponse.json({ success: true, campaigns: activeCampaigns });
  } catch (error: any) {
    console.error('[API Campaigns] Failed to fetch campaigns:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
