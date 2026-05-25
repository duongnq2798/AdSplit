# AdSplit Developer Guide

## System Commands
* **Run Development Server:** `npm run dev`
* **Production Build:** `npm run build`
* **Linter Check:** `npm run lint`
* **TypeScript Compilation Check:** `npx tsc --noEmit`

## Architectural Conventions & Guidelines
* **Database Schema Rule:** The project uses a custom database schema named `adsplit` in Supabase rather than the default `public` schema.
* **SQL DDL (`supabase/schema.sql`):**
  * Create the schema: `CREATE SCHEMA IF NOT EXISTS adsplit;`
  * Set path: `SET search_path TO adsplit, public;`
  * Always qualify table creation: `CREATE TABLE IF NOT EXISTS adsplit.table_name (...)`
  * Ensure access grants are explicitly assigned to Supabase roles (`anon`, `authenticated`, `service_role`) for `adsplit` tables.
* **Supabase Client (`src/utils/supabase.ts`):** Always specify `db: { schema: 'adsplit' }` option inside `createClient`.
* **State Syncing:** Always route database actions through the `SupabaseDbService` defined in `src/utils/supabase.ts` or use the custom `supabase` client.

## Tech Stack Primitives
* **Web3 & L1 Blockchain:** Viem v2 + Wagmi + Circle Programmable Wallets / AppKit integration on the **Arc Testnet** (native USDC gas fee L1 network).
* **Styling:** TailwindCSS + custom HSL color tokens.
