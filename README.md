# RetailFlow flat backend package

All files are at the repository root; there are no `api` or `lib` folders. `server.js` contains the database helper and all API endpoints.

## Deploy

1. Upload these root files to the GitHub repository and commit.
2. In Render, create a Web Service from this repository. Use the root directory, build command `npm install`, and start command `npm start`. `render.yaml` provides these settings.
3. In Render environment variables, enter the TiDB host, user, and password. Keep the database password secret.
4. Copy the Render service URL. In root `vercel.json`, replace `YOUR-RENDER-SERVICE` with the service's actual name, then commit the change.
5. Vercel redeploys and proxies `/api/*` to the Render backend. Check `https://YOUR-RENDER-SERVICE.onrender.com/health` first; it should return `status: ok`.

The Vercel rewrite cannot work until the placeholder in `vercel.json` is replaced with the real Render URL.
