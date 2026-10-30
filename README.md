# RetailFlow store hub and scanner

`index.html` is the main hub. Its left sidebar contains only Dashboard and Inventory. `scanner.html` is a separate scanner page; it is not a tab in the hub. Both pages use the same `/api` routes and PostgreSQL database, so inbound receipts and completed sales appear in the hub. Dashboard and inventory refresh automatically while open.

## What is included

- Dashboard: all-time revenue, gross profit, net profit, units on hand, and a 30-day line chart.
- Inventory: current products, quantity, original sale price, latest arrival date, and supplier.
- Separate phone scanner: inbound receipt form and Sell cart.
- Vercel API routes for inventory, sales, dashboard data, and operating expenses.

Revenue uses the saved original sale price. Gross profit subtracts the weighted average purchase cost from inbound receipts. Net profit subtracts recorded expenses. The first receipt sets the barcode's original sale price; later receipts preserve it and add stock.

## SQL and Vercel setup

1. Create a PostgreSQL database (Neon PostgreSQL works with Vercel).
2. Run `schema.sql` in its SQL editor. It creates the required tables and adds cost/expense columns to the earlier scanner schema.
3. Add the database's pooled connection string to Vercel as the server-side environment variable `DATABASE_URL`, then redeploy. Do not put the connection string in either HTML page or commit it to GitHub.
4. Keep `index.html`, `scanner.html`, `package.json`, `api/`, and `lib/` at the Vercel project root. Open the hub at `/` and launch the separate scanner at `/scanner.html`.

The prototype does not yet include staff sign-in or roles. Add authentication before exposing its write API for a public shop.
