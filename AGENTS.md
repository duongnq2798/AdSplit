<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AdSplit Database Schema Rules
- **Schema Name**: Always use the custom database schema `adsplit` (lowercase, matching the project name) instead of the default `public` schema.
- **SQL / Schema definitions**: All tables, indexes, views, and functions MUST be created under the `adsplit` schema (e.g., `CREATE TABLE IF NOT EXISTS adsplit.campaigns`). Ensure appropriate schema usage and table privilege grants are given to Supabase roles (`anon`, `authenticated`, `service_role`).
- **Client Configuration**: Configure the Supabase client dynamically to target `adsplit` under the `db.schema` option:
  ```typescript
  createClient(supabaseUrl, supabaseAnonKey, {
    db: {
      schema: 'adsplit'
    }
  });
  ```
- **Database Queries**: Avoid hardcoding `public` or accessing raw tables outside the `adsplit` context in the frontend/backend application.
