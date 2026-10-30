# RetailFlow dashboard (separate app)

This ZIP contains only the dashboard and its protected Vercel backend. Every file is in the ZIP root. Upload its extracted files to the root of `Ciamox-retail-dashbord` on GitHub and commit. If the previous scanner files remain in that repository, delete `scanner.html` and `scanner-app.js` there; uploading a ZIP cannot remove existing GitHub files. The `vercel.json` here does not serve scanner pages.

Set these Vercel **Production** environment variables in the `ciamox-retail-main` project: `TIDB_HOST` (host only), `TIDB_PORT` (`4000`), `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_DATABASE` (`retailflow`), `RETAILFLOW_ADMIN_PASSWORD` (at least 20 characters), and `RETAILFLOW_SESSION_SECRET` (different random value, at least 32 characters). Use Secret type for passwords and the session secret. After saving variables, redeploy the latest `main` deployment.

Open `https://ciamox-retail-main.vercel.app/login.html` and sign in. `/api/auth/status` should return 401 before sign-in. `/api/dashboard` should then return dashboard JSON after sign-in. A 503 means the two sign-in variables are missing or too short; a 500 after sign-in points to TiDB variables, connectivity, or the schema. The existing TiDB `retailflow` tables should match `schema.sql`; do not rerun it unnecessarily.

The TiDB password previously pasted into chat should be rotated in TiDB Cloud and updated in Vercel. Do not upload a real `.env` file. The data API uses an HttpOnly, Secure, signed cookie and checks the origin of writes. This is one shared store login; it does not provide per-employee accounts or distributed rate limiting.
