# RetailFlow · GitHub + Vercel + TiDB

This package is for **one GitHub repository and one Vercel project**. There is no Render service. All files are in the ZIP root, with no subfolders. The public dashboard and scanner use `/api/...` on the same Vercel domain. `backend.js` is a Vercel Node function and is the only file that connects to TiDB.

## Deploy

1. Extract the ZIP locally. Upload **all extracted files** to the **root** of your existing dashboard GitHub repository (`Ciamox-retail-dashbord`), then commit. GitHub's upload screen does not extract ZIP files. Keep file names exactly as given. In particular, upload `backend.js`, `vercel.json`, and `login.html`.
2. In the **ciamox-retail-main** Vercel project, open **Settings → Environment Variables**. Set the variables below for **Production**. Do not put passwords in GitHub or in any HTML/JS file.
3. The TiDB `retailflow` database must already contain the tables from `schema.sql` (inventory, inventory_receipts, sales, sale_items, operating_expenses). Do not rerun `schema.sql` if those tables already exist.
4. Pushing to `main` should start a production deployment. If the environment variables were added or changed after the last deployment, redeploy the latest commit. Open your **stable production domain** `https://ciamox-retail-main.vercel.app/login.html` after it is Ready, rather than the old `...-jvefr9nqz.vercel.app` deployment link.
5. Sign in with `RETAILFLOW_ADMIN_PASSWORD`; open the dashboard at `/` and scanner at `/scanner.html`. Check `/api/auth/status` after signing in; it should return `{"authenticated":true}`. `/api/dashboard` should return JSON, not a Vercel 404 page. If it says database request failed, check the five `TIDB_...` values and the schema.

## Vercel environment variables

| Key | Value |
| --- | --- |
| `TIDB_HOST` | TiDB public host only, no `mysql://` or port |
| `TIDB_PORT` | `4000` |
| `TIDB_USER` | TiDB connection user from the TiDB Connect dialog |
| `TIDB_PASSWORD` | Current TiDB connection password |
| `TIDB_DATABASE` | `retailflow` |
| `RETAILFLOW_ADMIN_PASSWORD` | Your unique store sign-in password, at least 20 characters |
| `RETAILFLOW_SESSION_SECRET` | A different random secret, at least 32 characters |

The TiDB password shared earlier in chat should be rotated in TiDB Cloud, then updated in Vercel before redeploying. Never upload a real `.env` file. `.env.example` contains placeholders only.

## Security and routing

All data API endpoints require a signed, 8-hour, HttpOnly, Secure, SameSite=Strict cookie. Writes require a same-origin request. TiDB uses TLS certificate validation and parameterized SQL queries. The HTML and JavaScript are public assets, so anyone can see the interface, but the data and writes require sign-in. The shared store password has no individual user accounts or rate limiting; for a larger team, add managed authentication and server-side login throttling.

`vercel.json` explicitly builds the root `backend.js` function and maps `/api/dashboard`, `/api/inventory`, `/api/sales`, `/api/expenses`, and `/api/auth/...` to it. It also lists the public flat files. Old `render.yaml` or `server.js` files in the GitHub repository are not used by this Vercel configuration, but you may remove them later to avoid confusion.
