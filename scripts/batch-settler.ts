import hre from "hardhat";
import { SupabaseDbService } from "../src/utils/supabase.js";

/**
 * Batch Settlement Daemon Script (x402 micro-settlements)
 * 
 * Sweep off-chain creator credit ledgers that exceed the $1.00 threshold,
 * dispatching them in a single batch on-chain txn. Locks records and
 * handles rollbacks gracefully in case of blockchain transaction failures.
 */

async function main() {
  console.log("Starting batch settlement sweep for micro-CPC clicks...");

  const db = new SupabaseDbService();
  const threshold = 1.0; // 1.00 USDC threshold for batching sweeps

  // 1. Lock database records that exceed the $1 threshold
  console.log(`Locking all creator micro balances exceeding $${threshold.toFixed(2)} for settlement...`);
  const lockedBalances = await db.lockMicroBalancesForSettlement(threshold);

  if (lockedBalances.length === 0) {
    console.log("No micro balances exceed the $1.00 settlement threshold. Execution finished.");
    return;
  }

  console.log(`Locked ${lockedBalances.length} pending micro-settlement(s):`);
  console.table(lockedBalances);

  // Group by campaign and creator to merge balances in the batch if duplicates exist
  const batchMap: Record<string, { campaignId: string; creatorAddress: string; amount: bigint }> = {};
  for (const item of lockedBalances) {
    const key = `${item.campaign_id.toLowerCase()}-${item.creator_address.toLowerCase()}`;
    const amountBigInt = BigInt(Math.round(item.settling_amount * 1_000_000)); // convert float to 6 decimals integer
    if (batchMap[key]) {
      batchMap[key].amount += amountBigInt;
    } else {
      batchMap[key] = {
        campaignId: item.campaign_id,
        creatorAddress: item.creator_address,
        amount: amountBigInt
      };
    }
  }

  const campaignIds: string[] = [];
  const creators: string[] = [];
  const amounts: bigint[] = [];

  for (const key of Object.keys(batchMap)) {
    const item = batchMap[key];
    campaignIds.push(item.campaignId);
    creators.push(item.creatorAddress);
    amounts.push(item.amount);
  }

  console.log(`Aggregated batch targets:`);
  console.log("Campaign IDs:", campaignIds);
  console.log("Creators:", creators);
  console.log("Amounts (6 decimals):", amounts.map(a => a.toString()));

  // 2. Fetch the contract instance
  const contractAddress = process.env.NEXT_PUBLIC_AD_REVENUE_SPLITTER_ADDRESS || "0xE75D12e1E29370A0346A25D5ef371B2B990a3c91";
  console.log(`Target Contract Address: ${contractAddress}`);

  const [deployer] = await (hre as any).ethers.getSigners();
  console.log(`Broadcasting transaction from: ${deployer.address}`);

  const AdRevenueSplitter = await (hre as any).ethers.getContractFactory("AdRevenueSplitter");
  const contract = AdRevenueSplitter.attach(contractAddress) as any;

  try {
    // 3. Dispatch the on-chain batch sweep
    console.log("Sending executeBatchEngagement transaction to Arc Testnet...");
    const tx = await contract.executeBatchEngagement(campaignIds, creators, amounts);
    console.log(`Transaction sent. Hash: ${tx.hash}`);
    
    console.log("Waiting for confirmation...");
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt?.blockNumber}. Gas used: ${receipt?.gasUsed.toString()}`);

    // 4. Confirm settlement in DB to deduct from balance and reset settling_amount to 0
    console.log("On-chain batch transaction succeeded. Confirming settlement in database ledger...");
    for (const item of lockedBalances) {
      const confirmed = await db.confirmSettlement(item.campaign_id, item.creator_address, item.settling_amount);
      if (confirmed) {
        console.log(`Confirmed settlement of $${item.settling_amount.toFixed(6)} for creator ${item.creator_address} in campaign ${item.campaign_id}`);
      } else {
        console.error(`Failed to confirm database settlement for creator ${item.creator_address}`);
      }
    }
  } catch (err: any) {
    console.error("Batch transaction failed! Rolling back locked balances in database...");
    console.error(err);

    // Rollback locked balances in DB so they can be tried in the next run
    for (const item of lockedBalances) {
      const rolledBack = await db.rollbackSettlement(item.campaign_id, item.creator_address);
      if (rolledBack) {
        console.log(`Rolled back settlement lock for creator ${item.creator_address} in campaign ${item.campaign_id}`);
      } else {
        console.error(`Failed to rollback database lock for creator ${item.creator_address}`);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
