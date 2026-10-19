<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes

- Database: MySQL/MariaDB (XAMPP locally). Connection via `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (defaults: localhost/3306/root/""/retailerp). Pool lives in `app/lib/db.ts`.
- Schema: `db/schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS`, all tables utf8mb4) is applied via `ensureSchema()` only when `settings.__schema_version` differs from `SCHEMA_VERSION` in `app/lib/db.ts` — bump it whenever schema/migrations change. It also converts non-utf8mb4 tables (cPanel defaults to latin1) and only creates the database if it does not exist. Demo data: `npm run db:seed` (applies schema + `db/seed.sql`).
- Hosting: deployed on Vercel against a remote cPanel MySQL. Config only via env vars (see `.env.example`; never hardcode credentials). Pool is cached on `globalThis` and small on Vercel (`DB_POOL_LIMIT`, default 3). `next.config.ts` traces `db/schema.sql` into the serverless bundle.
- API routes use helpers in `app/lib/crud.ts` (`crudRoutes`, `handle`, `pickFields` whitelists columns). Responses are `{ success, data }` or `{ success: false, message }`.
- List pages (customers, suppliers, payments, invoices) use `app/components/ModulePage.tsx`. Shared non-client helpers (`money`, `today`) live in `app/lib/format.ts` — server components must not import functions from `"use client"` files.
- Print views: `/invoices/[id]/print`, `/pos/receipt/[saleNumber]` (append `?autoprint` to open the print dialog).
- All pages read/write MySQL; there is no hardcoded business data left in pages (only navigation/UI config such as `menuItems`, table columns, warehouse types).
- Auth: DB sessions (`users`, `user_sessions`; scrypt hashes in `app/lib/password.ts`, session logic in `app/lib/auth.ts`, httpOnly cookie `retailerp_session`). Login at `/login`, APIs under `/api/auth/*` (login, logout, me = profile/change password), user admin at `/users` + `/api/users`.
- Authorization: roles Administrator / Manager / Cashier / Storekeeper. The single source of truth is `app/lib/permissions.ts` (`PAGE_ACCESS`, `API_ACCESS`; DELETE also requires Administrator/Manager). Every API using `handle()` is authenticated + role-checked by path/method; pass `{ access: "public" | "authenticated" }` to opt out. New API folders MUST be added to `API_ACCESS` (unlisted = denied). New module pages need a `layout.tsx` using `RouteGuard` and an entry in `PAGE_ACCESS`. `proxy.ts` only does an optimistic cookie redirect.
- The acting user inside API handlers is `currentUser()` / `currentUserName()` from `app/lib/auth.ts` (AsyncLocalStorage set by `handle()`); used for `stock_movements.user_name`, returns, PO `requested_by`. Client components use `useAuth()` from `app/components/AuthProvider.tsx`; `UserMenu` shows the account menu.
- First run with an empty `users` table creates `admin@retailerp.local` / `Retail@123` (override with `ADMIN_EMAIL`/`ADMIN_PASSWORD`; required in production). `npm run db:seed` adds demo users admin/manager/cashier/storekeeper `@retailerp.local`, password `Retail@123`.
- Inventory: stock per product per warehouse lives in `stock_levels`. Every quantity change MUST go through `changeStock()` in `app/lib/stock.ts` (row lock, negative-stock check, writes `stock_movements`). Used by POS sales (`/api/pos`), adjustments/counts/transfers (`/api/stockmanagement`), PO receipts (`/api/procurement`) and opening stock (`/api/products`).
- POS prices are always loaded from `products` server-side; held sales (`status: HELD`) do not move stock.
- `npm run db:seed` also generates ~60 days of demo POS sales with `DEMO-` sale numbers (delete with `DELETE FROM sales WHERE sale_number LIKE 'DEMO-%'`).
- Verify: `npx tsc --noEmit`, `npx eslint app scripts` (both clean).
