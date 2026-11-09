# RT-DETRv2 object proposals and automatic Firebase product indexing

Upload **all contents of this package** to the dashboard repository root, including
`api/`, `ai-detector-worker.js`, `ai-vision-worker.js`, `ai-scan-engine.js`,
`ai-counter.js`, `ai-counter.html`, `hub.js`, and `index.html`. Replace matching
files together. This is the full dashboard package; the phone scanner remains
separate. After Vercel reports Ready, hard-refresh the dashboard.

The AI camera downloads a quantized RT-DETRv2 R18 ONNX object detector in a
background worker. Its boxes help split objects that foreground segmentation
merged. Each box must also overlap a change from the calibrated empty counter,
then DINOv2 must match a Firebase inventory photo before it can be added to the
cart. Packages the generic detector does not find still use foreground proposals.
The detector is trained on general COCO objects, **not your specific medicine
cartons**; the six scanner photos provide product identity references rather
than fine-tuning RT-DETR. Do not treat similarity scores as payment certainty.

The camera subscribes to changes in Firestore `products`. New or updated scanner
photos trigger a Firebase refresh and automatic indexing, without a manual camera
sample. The original product stock, sales, category, supplier and finance logic
is retained. The existing `products` read and update permissions must allow
the AI reference field to be saved. No extra Firebase collection is required.

Test with two separated products, new inventory uploaded while the camera is
open, and an unrelated moving object. Set empty counter after moving the camera.
The first model download and CPU inference can be slow on some devices; no
real camera speed or recognition accuracy has been measured in this workspace.
If the detector cannot load, the status says so and the previous foreground
proposal path remains usable. The 18 deterministic camera tests and syntax
checks passed; live browser and Firebase tests remain to be run on your setup.

## Previous release notes

# Two-product scanner, Firebase sample saves, and automatic cart

This is the **complete dashboard**, with the root-level `api` folder. Extract
the ZIP and upload its contents at the dashboard repository root. Deploy the
branch you actually upload to, and hard-refresh when Vercel reports Ready.
The old screen with “3 items in view”, “Hold briefly”, and a 32% similarity
setting is the previous build, not the inventory-verified camera in this ZIP.

The camera now leaves a narrow visible gap between two products unmerged and
does not discard a stable product match for slight camera motion. It only
draws boxes for inventory-verified objects. **Auto-add verified products** is
enabled by default: it adds each separately tracked product to the cart once
after two matching observations, a high similarity score, a clear margin over
the second-best product, and a clear lead over the empty background. The
ordinary minimum similarity slider cannot be set below 72% in this build;
automatic addition requires at least 82%. Check the cart before taking
payment. Items that touch or overlap may still be impossible to count
separately with this image-matching model; leave a visible gap.

Optional **Save camera samples** now writes `aiCameraSamples` directly to
the same Firebase `products/{barcode}` document as the scanner photos,
then reads that field back on refresh. It does not call the `/api/ai-models`
route that returned “Operation not available” for extra samples. The
existing product read/update Firestore rules must permit this write. The
server inbound route now merges stock fields so later deliveries do not
erase these reference fields. No new Firebase collection or Storage bucket
is needed for these short embedding vectors. The dashboard does not upload
raw camera sample images to Firestore.

Verification: 15 Node tests passed, including two separated products,
small camera motion, background rejection, and automatic-add safeguards.
JavaScript syntax checks passed. Actual camera accuracy and Firestore writes
on your deployment were not available to test here; verify both after deploy.

# Inventory-verified camera focus

This package changes the camera display and checkout candidate list so
movement alone never counts as a product. When **Set empty counter** is
pressed, the camera embeds five empty-scene views as negative references.
It compares each changed region to the six inventory photo references and
to those empty-scene views. For a broad region containing a hand or cloth,
it also checks four overlapping smaller views and focuses the outline on
the strongest accepted product region. A region must exceed the configured
similarity, beat the next inventory product, beat the empty scene by at
least six similarity points, and match twice before its name/box appears.
Unrecognized regions remain unmarked and cannot be added through the camera.

Upload the **complete contents** of this ZIP at the dashboard repository
root, retaining the root-level `api` folder. Hard-refresh the deployment
after it reaches Ready. Recalibrate with an actually empty counter after
moving the camera. The camera has to finish preparing both inventory and
empty-scene references before scanning.

This is conservative image matching, **not** a trained object detector.
Unknown objects with similar colors/shapes can still look like a product,
and a real product against very different lighting or a cluttered scene can
be missed. Validate on the actual products and surroundings before enabling
Auto-add. The 12 unit tests cover candidate rejection, choosing the matching
region, segmentation, and tracking; they do not measure live camera accuracy.

# Earlier camera focus and automatic inventory recognition

The camera now discards tiny changed regions such as fabric texture, print,
reflections, and movement at the edge. It joins adjacent fragments of a
package before drawing a box, while retaining a second separated product.
The 10 segmentation and tracking tests pass. This is a noise filter, not a
semantic object detector: first fix the camera over an empty counter, click
**Set empty counter**, then show the products against that stable background.
Holding a box in front of a moving person or changing the background after
calibration can still produce false regions. Review the cart before payment.

# Six-view AI reference indexing

This full dashboard package prepares the six front, back, top, bottom, left,
and right photos saved by the phone scanner for recognition. **Upload the
contents at the dashboard repository root**, including the root-level `api`
directory. The separate phone scanner does not need a new upload for this
dashboard change. The existing Firestore product read and update permissions are required.
The optional server AI-model copy uses Vercel Firebase Admin credentials.

Open **AI Detection Cam → Firebase Products** and wait for **Six views ready**
beside each enrolled product. The camera reads the six photos directly from
Firestore, so it does not rely on a nested `/api/inventory` route. The DINOv2
model loads while the product list loads. WebGPU groups six photos into one
inference request; CPU groups them into three requests of two photos to avoid
large memory spikes. A successful result is cached on this device before it
is saved with the Firebase product and, when available, through `/api/ai-models`.
A refreshed inventory keeps a cached result only when all six source photos
still match. The optional camera-example panel is collapsed; there is no
manual photo capture step for products showing **Six views ready**. If both
Firebase save routes fail, the camera reports that the references are ready
only on the current device. Products without six views can still use their
main photo or manually labelled camera samples.

This is reference indexing, not fine-tuning the DINOv2 network. The first
model download and CPU speed depend on the device and connection; no honest
one-minute guarantee is possible without timing your actual phone/computer.
Test visually similar packages with **Self-test accuracy**, then verify
real counter scans before turning on automatic cart additions. No new
Firestore rule or Storage bucket is needed for the existing photo fields.

## Verification for this change

- JavaScript syntax checks passed for the camera and hub.
- The eight existing camera tracking tests passed.
- A real-browser run and a live Firebase/model speed measurement were not
  available in this environment; verify the deployed camera on your device.

# Finance save fix

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

Deploy the matching phone scanner package. New inbound products capture front, back, top, bottom, left and right views in Firestore. AI Detection Cam alone requests these larger photos, computes six reference embeddings, and saves them with the Firebase product and, when available, in `aiCounterModels` via `/api/ai-models`. Ordinary dashboard inventory requests do not download the six photos. Existing manually labelled camera samples remain separate. The model begins loading when the camera page opens, so the first recognition may take longer than later scans.

# Fast multi-item AI camera update

This ZIP contains the full dashboard with the camera fix retained. Extract and upload its contents at the repository root, replacing matching files and preserving the `api` folder. Do not upload the ZIP itself. Wait for Vercel to show Ready, then hard-refresh the dashboard. This scanner update does not require new Firebase rules or environment variables when the supplied base is already connected. The package includes the new `api/ai-models.js` route; ensure that file is uploaded along with the rest of the contents.

## Start scanning

1. Open **AI Detection Cam**, press **Start camera**, and allow camera access.
2. Keep the camera fixed. Clear the counter and press **Set empty counter**. Wait for the model and inventory photos to finish preparing; the first model download can take time.
3. Place up to eight products with visible gaps between them. Boxes show inventory product names and image similarity. Green matches can be added together using **Add matched items**. Enable **Auto-add stable matches** only after checking recognition with your products.
4. Review the cart before payment. Uncertain matches require selection from current inventory. Remove counted products fully before scanning the next group.

Recognition reads current products, photos, prices, and stock directly from Firestore. Saved training samples are supported; add clear views of each package when products look alike. Similarity percentages are not calibrated probabilities of correctness. Touching products, hands, camera movement, reflections, and poor lighting can prevent reliable segmentation. Keep products separated and recalibrate after moving the camera.

The model runs in a worker and batches crops to keep the camera responsive. It uses WebGPU when an adapter is available and otherwise CPU inference. Speed depends on the device; no fixed frame-rate guarantee. Inventory photos are cached for faster subsequent loads and their labelled descriptors are saved with the Firebase product and through `/api/ai-models` when that endpoint is available. Products without a photo still need cashier-labelled camera examples. The existing sales API remains responsible for saving sales and changing Firebase stock.

## Validation for this update

- Eight automated segmentation, tracking, duplicate-counting, and stale-result tests passed: `node --test tests/ai-scan-engine.test.cjs`.
- Browser workflow checked with three simulated items, duplicate protection, cart totals, payment, and a local API fixture.
- Real DINO model loading and inference checked against synthetic camera frames under the supplied Content Security Policy, including CPU fallback.
- Physical webcam recognition and production Firebase writes were not tested here. Test with your actual stock before relying on automatic additions.

---

# RetailFlow dashboard — password-free preview

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
