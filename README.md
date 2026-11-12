# RetailFlow flat GitHub upload

All files in this archive belong at the repository root. There are no source directories. The root `retailflow-api.js` is built as one Vercel Node function through the legacy `builds` configuration in `vercel.json`; `/api/*` URLs are rewritten to it. Root HTML and browser JavaScript are explicitly built as static files. `retailflow-sync.js` is a server-only dependency bundled into the function.

Extract this ZIP and select all extracted files on GitHub’s Add file → Upload files page on the AI-product-detection-cam branch. Uploading the ZIP as one file does not deploy the app. Check the staged list includes `retailflow-api.js`, `retailflow-sync.js`, and `vercel.json` at the root. Once Vercel preview deploys, test GET `/api/health` (requires configured Firebase Admin credentials), PUT `/api/ai-models` through the camera UI, and the protected cron. Do not merge until the API routes and one real product scan work. Existing `api__*` root files can be removed later; the new build list excludes them.

This is still the password-free single-store pilot. Uploaded photos go to Ultralytics as unlabeled references and do not automatically train YOLO. Keep API keys only in Vercel environment variables.
