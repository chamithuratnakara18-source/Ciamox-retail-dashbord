# RetailFlow dashboard: AI camera checkout

## Finance save fix

The Finance selling price editor now updates the existing Firestore product in
a transaction. It checks the previously displayed price before writing, so a
price changed on another device is not overwritten. One-time costs are created
in the existing `expenses` collection. Both actions use the temporary public
Firestore permissions from the included `firestore.rules` and no longer depend
on missing nested Vercel API routes. Other API-backed actions still require
the root-level `api` directory on the dashboard Vercel deployment. Upload the
full package at the repository root; do not upload the ZIP file itself.

## Category and scanner

Category assignment now updates the existing Firestore product directly from
the dashboard, using the same browser write permission as the separate phone
scanner. This avoids the 404 from `/api/inventory/category` on deployments
without that nested route. The explicit `api/inventory/category.js` route is
also included for future server-based writes. Upload the whole package at the
dashboard repository root. The published Firestore rules must permit product
updates for this password-free preview. Other dashboard edits still require
the root-level `api` directory and Firebase Admin credentials on Vercel.

The explicit Vercel functions `api/ai-models.js` and
`api/ultralytics/sync.js` are required. If `/api/ai-models` returns 405,
check that the deployment contains these direct routes and that the current
`ai-counter.html` references `low-threshold-20261110-1`, rather than the
earlier `six-views-1` camera script. The latter means an older deployment is
still open. The Vercel cron URL returns 403 without its secret by design.

## Single-store Ultralytics photo sync pilot

This complete package includes a server-only link to one private Ultralytics
**dataset**. Upload the ZIP contents at the repository root, including `api/`.
In Vercel Project Settings → Environment Variables set
`ULTRALYTICS_SYNC_ENABLED=true`, `ULTRALYTICS_API_KEY` (a private Platform
key), `ULTRALYTICS_OWNER=chamithu-ratnakara`, and `ULTRALYTICS_DATASET=ciamox-retail` (the dataset URL slug under `/datasets/`,
which is separate from the project name). Set a random `CRON_SECRET` for the daily backfill route. Enable the
settings for **Production** when ready and redeploy. Vercel cron runs only on
production deployments; a preview branch will not run the schedule. Never
add the real key to Git.

The current separate phone scanner writes directly to Firestore, so its new
photos are picked up by the **daily server-side sync**. If inventory is sent
through this site's `POST /api/inventory`, the Firebase stock is saved first
and the upload starts during that request. The server sends the six photos as
**unlabeled** images with barcode and angle metadata.
If Platform is unavailable, stock stays saved; the API response reports
`trainingSync.status=failed` when that API was used. The next daily cron
retries; cron processes at most three photo sets per run. Existing six-view
products are backfilled by that protected daily job. The six photos still index into the
camera's existing local visual matcher independently of Ultralytics.

This does **not** train a YOLO detector or make newly added products instantly
recognizable by YOLO. Training a detector needs labeled counter images, a
validation split, a training job, and a deployed model. Do not use low-score
automatic cart matches as ground-truth labels. Dataset import jobs are
asynchronous; `queued` means accepted for processing, not that all six images
finished ingesting. This is a **single-store pilot**: the current API's
password-free preview mode and global `products` collection cannot isolate
multiple customer stores. Do not connect customer stores to this dataset.

This ZIP contains the complete dashboard. Upload the extracted contents to the
**root** of the dashboard GitHub repository on the AI camera branch, including
`api/`, both AI workers, `index.html`, and `vercel.json`. The separate phone
barcode scanner is not in this package. Check the Vercel preview before merging
this branch into `main`.

## Camera checkout

1. Open **AI Detection Cam**, start the camera, clear the counter, and press
   **Set empty counter**. Keep the camera fixed.
2. Make sure Firebase Products shows the inventory products and, where
   available, **Six views ready**. A single main photo can make a product
   technically ready while still giving weak matches.
3. Place separated items on the counter. The camera compares their crops to
   inventory photos, tracks each physical item, and adds eligible matches to
   the local cart after **two stable recognitions**.
4. Inspect every cart item and quantity, remove wrong items with the minus
   button or **Clear**, and only then take and complete payment. Completed
   sales are written through the existing Firebase-backed sales API.

The **Auto-add similarity threshold** ranges from **24% to 100%**, with 24% as
the default and minimum. It is a visual similarity score, **not measured
accuracy**. A candidate must also beat competing inventory products and the
calibrated empty scene. The **Auto-add eligible matches** checkbox can pause
all automatic additions. A score below your selected threshold stays out of
the cart. Changing the threshold rescans uncounted items.

At 24%, objects that only resemble an enrolled product can be added incorrectly.
For example, a hand or desk object may be mistaken for a packaged item. The
low-threshold mode does not wait for OCR; increasing the threshold and capturing
clear six-view photos can reduce these errors, but neither guarantees accuracy.
If a candidate fails a match check, it remains a manual suggestion or is not
shown. A known item that leaves and reappears may be checked quickly against a
recently accepted view. Each copy still has its own track and stock limit.

## Verification

Run `node --test tests/*.test.cjs` for the deterministic camera checks. They
cover duplicate tracks, removal and re-entry, background rejection, competing
products, low-threshold eligibility, and repeat matching. Actual webcam speed,
false-positive rate, and Firebase writes must be tested on the deployed preview
with real goods and unknown objects. The four-second multi-item goal has not
been verified on your camera.

## Existing dashboard and Finance features

This package keeps the existing dashboard UI and removes the sign-in screen for now. It is the **main dashboard only**; the phone scanner is a separate website. The default Firebase project is `ciamox-retail`.

## Access warning

This is an unauthenticated preview. Anyone who can reach the site can read store products, costs, sales, receipts, and Finance records, and can submit inventory, POS, category, supplier profile, price, and expense changes. The included Firestore rules allow public reads; the server API accepts writes without a sign-in. Use test data only and do not expose this version publicly. Add authentication and role checks before using real store data.

## Run the preview

1. Extract the ZIP into the Vercel project root and keep the `api` folder. Use Node.js 22; Firebase Admin SDK 14 requires Node.js 22 or later.
2. In Vercel Project Settings → Environment Variables, add `FIREBASE_PROJECT_ID=ciamox-retail` and `FIREBASE_SERVICE_ACCOUNT_JSON`. Store the service-account JSON only as a Vercel secret; never place it in `firebase-config.js`, source control, or the ZIP. Give this runtime account only the Firestore access the API needs.
3. For a local preview, set the same variables in your local environment. `.env.example` lists their names.
4. Publish the included `firestore.rules` only on a test Firebase project. For this temporary preview it permits scanner and category writes directly to products and receipts; this is unsafe for real store data.
5. The phone scanner is separate and is not included. Its direct Firestore writes use the same published rules. If it calls the dashboard API from another site, set `RETAILFLOW_SCANNER_ORIGIN` to its exact HTTPS origin.

The Firebase web config in `firebase-config.js` contains public app identifiers, not service-account credentials. This single Firebase project models one store and does not provide tenant separation. **Restore Firebase Authentication, server token/role checks, and authenticated Firestore rules before adding real data or using this on a public site.**

Product category cards retain the compact layout with product name, supplier, manufacture date, and expiry date below each photo.

## Suppliers

The Suppliers tab uses the supplied `supplier-dashboard.html` layout and reads the same Firebase project as the phone scanner. Supplier names come from inbound products and receipts recorded by the scanner; saved profile details only enrich those existing suppliers, so profile-only placeholders do not appear. Live Firestore updates refresh the dashboard. The four summary cards calculate supplier count, countries recorded, average and longest lead time, and average quality from saved records; missing lead-time and quality values stay marked as **Not tracked**. Use **Add supplier data** to save city, country, supplier type, latitude, longitude, lead time, quality, and defect rate. **Delete supplier** hides the supplier while retaining product and receipt history; a new scanner receipt restores it. A map marker appears only after both coordinates are saved; map tiles use OpenStreetMap with visible attribution. Supplier profile records are stored in the `suppliers` collection; the included rules allow reads and deny browser writes, while `/api/suppliers` performs profile writes and archive actions. Publish the updated supplier read rule if the deployed rules do not already permit reading `suppliers`.

For Vercel, the project root must be the folder containing `index.html`, `package.json`, `vercel.json`, and the `api/` directory. Keep `api/suppliers.js` at that root-relative path; it is a standalone function for supplier save and archive requests. If `/api/suppliers` returns 404, the deployed project root does not include the function; after correcting the root and redeploying, a GET to `/api/suppliers` should return 405 (the function exists but requires POST or DELETE), not 404.

## Check the connection

Open the dashboard and confirm the status changes to `FIREBASE CONNECTED`. Inventory, POS, Dashboard, Finance, and analytics use the existing Firebase records. This preview has no per-staff access controls.

## Dashboard overview

Choose **Day**, **Month**, or **Year** and a date at the top. Revenue and orders count completed sales for that period. Their change compares with the preceding day, month, or year; for a current, unfinished month or year the comparison covers the same elapsed portion of the prior period. When the previous period is zero, the badge says **New activity** instead of showing an infinite percentage. The orange revenue and green gross profit chart groups a month by seven-day spans and a year by month; day view shows one daily total because sales do not have reliable hourly data. Missing purchase cost leaves gross profit unavailable rather than zero.

**Stock Alerts** and **Products** describe current inventory regardless of the selected sales period. Out of stock is Critical; 1–5 units is Low. Filter alerts with All, Critical, or Low. **Best Selling Item Share** has its own period and date controls. Its 3D ring sizes slices by units sold, including products later removed from inventory. Every sold product has its own color, without grouping later products into Other. The Bar chart includes every product sold in either the selected or previous matching period. A product keeps the same color in both views; the light shade of that color represents its previous-period bar. Scroll horizontally when many products are shown. The ring's depth is visual only; all numbers are derived from recorded sale items. If there are no matching sales, it shows an empty state.

## POS Sale

The left side shows searchable product photo cards and an **In stock** filter. Tap a priced, stocked product to add it to the current order. Phone scanning can use the same order after the separate scanner is updated to call this API; its direct Firestore writes work while the temporary preview rules are published. The right side shows quantities, prices, subtotal, and total. Change quantities, remove an item, or clear the order there. Choose Cash, Card, or QR and click **Complete sale** after collecting payment. Card and QR choices record the method only; the app does not charge the customer. Checkout reads the current shared order and stock in a Firestore transaction, writes one sale, reduces stock, then clears the order; a second checkout of the cleared order cannot create another sale. The API supports remote scan updates, but the scanner source is not included in this ZIP.

Set selling prices in **Finance** before checkout. A product without a price or purchase cost cannot be checked out. The active order is shared store-wide. Use **Clear order** on the dashboard to empty it.

## Finance

The **Inventory pricing** table shows each product's current weighted average purchase cost from Inbound, editable selling price, and gross profit per unit (`selling price - purchase cost`). The gross profit preview changes while you type. Click **Save price** to use that price for future sales. Past sales keep their recorded prices and costs. The POS uses the current saved price at checkout.

Click the arrow on **Monthly costs** to expand or collapse the form. Enter water, electricity, gas, sewage, total employee salaries, and the full monthly mortgage payment **including interest**. Fields that do not apply can be left blank. Enter at least one monthly cost before saving; until then, gross profit remains visible and net profit says **Unavailable**.

The **Monthly cash commitments** total tells you how much to keep for these bills. There is no per-item allocation because the app no longer asks how many units you expect to sell. Product rows still show instant gross profit per unit as you enter a selling price.

The four Finance summary rings show **Fixed costs / month** (the saved utilities, salaries, and full mortgage payment), **Product purchase cost / month** (positive Inbound receipt quantity × purchase price), **Gross profit / month** (sales less their recorded product cost), and **Net profit / month** (cash basis). Each badge shows the signed amount changed against the **previous calendar month**. Product purchase cost is money spent receiving stock, not the cost of goods sold in the gross profit calculation, so do not subtract it a second time. Stock deletions do not erase purchase history. The ring is decorative; its arc does not represent a percentage.

Saving Monthly costs also saves a plan snapshot for the current month. After installing this update, save the existing monthly amounts once to record this month's baseline. Previous fixed costs and net profit changes appear only after a plan was saved in that previous month. Existing plans saved before this update have no historical snapshots, so their previous month comparison reads **Previous month unavailable**. An incomplete purchase cost record makes that month's purchasing total unavailable rather than displaying a misleading zero.

The monthly net figure calculates **gross profit − utilities − salaries − the full mortgage payment − one-time expenses**. It works with a combined mortgage payment and can be negative when costs exceed gross profit. This is **cash after bills**, which differs from formal accounting net income because mortgage principal is a cash payment rather than a profit expense. Gross profit remains visible and net profit says **Unavailable** only when no monthly plan is saved or this month's sale cost data is missing. Do not record the same recurring bill in **One-time expense** or it will count twice. Editing the monthly plan recalculates the current month and saves a historical snapshot for that month.

In **Inventory**, each row has an **Add category** action before **Delete**. Choose to create a category or assign the product to an existing one. The category is stored on the existing product document, and the Product categories tab derives its list from those products; no extra Firestore collection or rule is required. The tab has category filters, product search, and cards showing stock, supplier, manufacture date, and expiry date. The inbound API stores optional manufacture and expiry dates on the product record. **Inventory analytics** follows the dashboard's pale background, heading, rounded white cards, navy text, green accents, and chart-title styling, while keeping the four analysis panels and interactions from the supplied `inventory-dashboard.html`. It uses live product, receipt, and sale records: stock-value category treemap with product drilldown, ABC analysis, expiry chart and table, and running-out chart and table. Category names, products, values, expiry dates, and sales rates are read from Firebase; sample categories and records are not used. The stockout window can be changed to 7, 30, or 90 days. Stock-value charts and ABC classification require saved purchase costs. Products without expiry dates are omitted from expiry risk, and products without recent sales have no stockout estimate. Each row also has a **Delete** button. Confirming removes that product and its remaining stock, and records a negative stock adjustment in the existing `receipts` collection. Past sales and revenue are retained in history. If the quantity or name changed after the row loaded, the operation stops and asks you to refresh.

The Dashboard has no Financial snapshot or Performance trend panel. The Revenue Chart still provides day, month, and year views of completed sales. Monthly financial totals and the **One-time expense** action are in Finance.

Data previously stored in TiDB is not moved automatically. This prototype reads `products`, `receipts`, `sales`, and `expenses` collections in the new Firestore database.
