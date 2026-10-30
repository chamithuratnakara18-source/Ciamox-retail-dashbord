# RetailFlow store hub and phone scanner

`index.html` is the main hub. `scanner.html` is the separate phone scanner. Both use the same Vercel API and TiDB MySQL database: inbound receipts and completed sales update the hub inventory and dashboard.

## Features

- Dashboard: revenue, gross profit, net profit, units on hand, and a 30-day trend.
- Inventory: current stock, barcode, sale price, arrival date, and supplier.
- Scanner: inbound receipt form and a sell cart that checks stock before completing a sale.
- Server-side Vercel API routes in `api/`; database credentials are read only from server environment variables.

Revenue uses the saved sale price. Gross profit subtracts the recorded weighted-average unit cost. Net profit subtracts recorded expenses. The first inbound receipt sets a product's sale price; later receipts preserve it and add stock.

## Database and deployment

The schema is TiDB/MySQL, not PostgreSQL. The tables are `inventory`, `inventory_receipts`, `sales`, `sale_items`, and `operating_expenses`.

1. Import this repository into Vercel from GitHub. Keep `index.html`, `scanner.html`, `hub.js`, `scanner-app.js`, `api/`, `lib/`, and `package.json` at the project root.
2. Connect the TiDB Starter instance to the Vercel project using the TiDB Cloud Vercel integration. Choose **Cluster**, database `retailflow`, and **General**. TiDB should add `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, and `TIDB_DATABASE` to the Vercel project.
3. Redeploy after the environment variables are added. Open `/` for the hub and `/scanner.html` on the phone for scanning.
4. Keep the database password out of the browser files and GitHub. If you set the values manually, add them under Vercel **Settings → Environment Variables** and redeploy.

## Important before real customer use

This version has no staff sign-in or user roles. Do not expose the write API to a public shop until authentication and authorization are added. Verify the TiDB public-endpoint network rules for Vercel before deployment; do not open database access broadly without a deliberate security review.
