# RetailERP

Retail ERP built with Next.js and MySQL/MariaDB: POS, products, warehouses, stock, procurement, customers,
suppliers, invoices, payments, reports, users and role-based access.

## Local development

1. Start MySQL (e.g. XAMPP).
2. Copy `.env.example` to `.env.local` and fill in the database settings.
3. Install and run:

```bash
npm install
npm run dev        # http://localhost:3000
npm run db:seed    # optional demo data and demo users (password Retail@123)
```

The schema in `db/schema.sql` is applied automatically on the first request. When the `users` table is empty,
a first administrator is created (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, default `admin@retailerp.local` / `Retail@123`
outside production).

## Deploying to Vercel with a cPanel database

1. **cPanel → MySQL Databases**: create the database and user, and give the user all privileges on it.
2. **cPanel → Remote MySQL**: add `%` as an access host (Vercel's IP addresses change).
3. **Vercel → Project → Settings → Environment Variables**: add `DB_HOST` (the server IP/hostname, not `localhost`),
   `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, plus `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the first login.
   See `.env.example` for optional settings.
4. Deploy. The first request creates/updates the tables and the administrator account.

## Checks

```bash
npx tsc --noEmit
npx eslint app scripts
```
