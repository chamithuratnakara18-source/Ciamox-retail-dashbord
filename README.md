# RetailFlow dashboard — Firebase prototype

This is the **main dashboard only**. The phone scanner is a separate website. Both websites use the same Firebase project, `ciamox-retail`, and its default Cloud Firestore database. All files in this ZIP are at its root; there are no subfolders or server routes.

## Connect Firebase

1. Use the existing default **Standard** Firestore database. Keep the demo rules that permit access; Production mode's default deny-all rules alone will block the dashboard. Use sample data only.
2. The registered Firebase web app configuration from the supplied screenshot is already in `firebase-config.js` in both packages. Do not add a second Firebase project. Firebase Hosting setup is optional because these pages can stay on Vercel.
3. Extract this ZIP and upload its **root files**, not the ZIP itself, to the root of `Ciamox-retail-dashbord`. Overwrite files with matching names and commit to `main`. This package overwrites the old SQL routing, backend, and old scanner page with inactive placeholders. Use the stable Vercel domain for the dashboard.

Do not carry over TiDB environment variables to Firebase. There is no Firebase login or role control in this prototype. The demo rules allow public access and may expire; do not store real shop transactions until access rules are designed and applied.

## Check the connection

Open the dashboard; its status should say `FIREBASE CONNECTED`. In the separate phone scanner, use **Inbound** to add a sample product and optional photo (or type its barcode manually), then refresh the dashboard inventory. Its photo appears beside the name. Open **Finance** to enter a selling price. In the scanner's **Sell** screen, scan the product; it appears in the dashboard's **POS Sale → Current Order** without an extra send step. Complete the sale in POS Sale and check that revenue and stock update. If a permission error appears, inspect Firestore's database and rules for the existing `receipts` collection.

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

In **Inventory**, each row has a **Delete** button. Confirming removes that product and its remaining stock, and records a negative stock adjustment in the existing `receipts` collection. Past sales and revenue are retained so the performance chart can still show historical stock. If the quantity or name changed after the row loaded, the operation stops and asks you to refresh.

In **Performance trend**, choose **From** and **To** using the English calendar. The chart defaults to the last completed calendar month, compared with the month before it. For a custom full month it uses the preceding full month; for other ranges it uses the immediately preceding range of the same length. Choose one metric to compare: revenue, gross profit, net profit (cash basis), or units in stock. The peach line shows the previous period and the orange line shows the selected period, aligned by relative position when months have different lengths. Tap or point at the chart for exact daily values. It supports up to 366 selected days per view. Revenue and gross profit cards are all-time, while the net profit card is this month. Net profit in the chart requires a saved monthly plan for each month shown; recurring monthly bills are placed on the first day of that month. If an old month has no plan snapshot, its net profit line is unavailable instead of showing a false zero.

Data previously stored in TiDB is not moved automatically. This prototype reads `products`, `receipts`, `sales`, and `expenses` collections in the new Firestore database.
