# RetailFlow dashboard — Firebase prototype

This is the **main dashboard only**. The phone scanner is a separate website. Both websites use the same Firebase project, `ciamox-retail`, and its default Cloud Firestore database. All files in this ZIP are at its root; there are no subfolders or server routes.

## Connect Firebase

1. Use the existing default **Standard** Firestore database. Keep the demo rules that permit access; Production mode's default deny-all rules alone will block the dashboard. Use sample data only.
2. The registered Firebase web app configuration from the supplied screenshot is already in `firebase-config.js` in both packages. Do not add a second Firebase project. Firebase Hosting setup is optional because these pages can stay on Vercel.
3. Extract this ZIP and upload its **root files**, not the ZIP itself, to the root of `Ciamox-retail-dashbord`. Overwrite files with matching names and commit to `main`. This package overwrites the old SQL routing, backend, and old scanner page with inactive placeholders. Use the stable Vercel domain for the dashboard.

Do not carry over TiDB environment variables to Firebase. There is no Firebase login or role control in this prototype. The demo rules allow public access and may expire; do not store real shop transactions until access rules are designed and applied.

## Check the connection

Open the dashboard; its status should say `FIREBASE CONNECTED`. In the separate phone scanner, use **Inbound** to add a sample product and optional photo (or type its barcode manually), then refresh the dashboard inventory. Its photo appears beside the name. Open **Finance** to enter a selling price. In the scanner's **Sell** screen, scan the product; it appears in the dashboard's **POS Sale → Current Order** without an extra send step. Complete the sale in POS Sale and check that revenue and stock update. If a permission error appears, inspect Firestore's database and rules for the existing `receipts` collection.

## Dashboard overview

Choose **Day**, **Month**, or **Year** and a date at the top. Revenue and orders count completed sales for that period. Their change compares with the preceding day, month, or year; for a current, unfinished month or year the comparison covers the same elapsed portion of the prior period. When the previous period is zero, the badge says **New activity** instead of showing an infinite percentage. The orange revenue and green gross profit chart groups a month by seven-day spans and a year by month; day view shows one daily total because sales do not have reliable hourly data. Missing purchase cost leaves gross profit unavailable rather than zero.

**Stock Alerts** and **Products** describe current inventory regardless of the selected sales period. Out of stock is Critical; 1–5 units is Low. Filter alerts with All, Critical, or Low. **Best Selling Item Share** has its own period and date controls. Its 3D ring sizes slices by units sold, including products later removed from inventory. Every sold product has its own color, without grouping later products into Other. The Bar chart includes every product sold in either the selected or previous matching period. A product keeps the same color in both views; the light shade of that color represents its previous-period bar. Scroll horizontally when many products are shown. The ring's depth is visual only; all numbers are derived from recorded sale items. If there are no matching sales, it shows an empty state.

## POS Sale

The left side shows searchable product photo cards and an **In stock** filter. Tap a priced, stocked product to add it, or scan it in the phone scanner's **Sell** mode. Both methods update the same live order at `receipts/pos-active` (reserved `pos_order` document). The right side shows quantities, prices, subtotal, and total. Change quantities, remove an item, or clear the order there. Choose Cash, Card, or QR and click **Complete sale** after collecting payment. Card and QR choices record the method only; the app does not charge the customer. Checkout reads the current shared order and stock in a Firestore transaction, writes one sale, reduces stock, then clears the order; a second checkout of the cleared order cannot create another sale. The scanner's Sell screen is now a remote scanner for this order and does not checkout separately.

Set selling prices in **Finance** before checkout. A phone can still scan a product missing a price into the order, but checkout stays unavailable until the price and purchase cost are present. If more than one phone is scanning, they share this single active order for the store. The phone's **Clear history** button clears only its local scan history; use **Clear order** on the dashboard to empty the shared order.

## Finance

The **Inventory pricing** table shows each product's current weighted average purchase cost from Inbound, editable selling price, and gross profit per unit (`selling price - purchase cost`). The gross profit preview changes while you type. Click **Save price** to use that price for future sales. Past sales keep their recorded prices and costs. The POS uses the current saved price at checkout.

Click the arrow on **Monthly costs** to expand or collapse the form. Enter water, electricity, gas, sewage, total employee salaries, and the full monthly mortgage payment **including interest**. Fields that do not apply can be left blank. Enter at least one monthly cost before saving; until then, gross profit remains visible and net profit says **Unavailable**.

The **Monthly cash commitments** total tells you how much to keep for these bills. There is no per-item allocation because the app no longer asks how many units you expect to sell. Product rows still show instant gross profit per unit as you enter a selling price.

The four Finance summary rings show **Fixed costs / month** (the saved utilities, salaries, and full mortgage payment), **Product purchase cost / month** (positive Inbound receipt quantity × purchase price), **Gross profit / month** (sales less their recorded product cost), and **Net profit / month** (cash basis). Each badge shows the signed amount changed against the **previous calendar month**. Product purchase cost is money spent receiving stock, not the cost of goods sold in the gross profit calculation, so do not subtract it a second time. Stock deletions do not erase purchase history. The ring is decorative; its arc does not represent a percentage.

Saving Monthly costs also saves a plan snapshot for the current month. After installing this update, save the existing monthly amounts once to record this month's baseline. Previous fixed costs and net profit changes appear only after a plan was saved in that previous month. Existing plans saved before this update have no historical snapshots, so their previous month comparison reads **Previous month unavailable**. An incomplete purchase cost record makes that month's purchasing total unavailable rather than displaying a misleading zero.

The monthly net figure calculates **gross profit − utilities − salaries − the full mortgage payment − one-time expenses**. It works with a combined mortgage payment and can be negative when costs exceed gross profit. This is **cash after bills**, which differs from formal accounting net income because mortgage principal is a cash payment rather than a profit expense. Gross profit remains visible and net profit says **Unavailable** only when no monthly plan is saved or this month's sale cost data is missing. Do not record the same recurring bill in **One-time expense** or it will count twice. Editing the monthly plan recalculates the current month and saves a historical snapshot for that month.

In **Inventory**, each row has a **Delete** button. Confirming removes that product and its remaining stock, and records a negative stock adjustment in the existing `receipts` collection. Past sales and revenue are retained in history. If the quantity or name changed after the row loaded, the operation stops and asks you to refresh.

The Dashboard has no Financial snapshot or Performance trend panel. The Revenue Chart still provides day, month, and year views of completed sales. Monthly financial totals and the **One-time expense** action are in Finance.

Data previously stored in TiDB is not moved automatically. This prototype reads `products`, `receipts`, `sales`, and `expenses` collections in the new Firestore database.
