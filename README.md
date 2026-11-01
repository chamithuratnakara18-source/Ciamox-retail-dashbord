# RetailFlow dashboard — Firebase prototype

This is the **main dashboard only**. The phone scanner is a separate website. Both websites use the same Firebase project, `ciamox-retail`, and its default Cloud Firestore database. All files in this ZIP are at its root; there are no subfolders or server routes.

## Connect Firebase

1. Use the existing default **Standard** Firestore database. Keep the demo rules that permit access; Production mode's default deny-all rules alone will block the dashboard. Use sample data only.
2. The registered Firebase web app configuration from the supplied screenshot is already in `firebase-config.js` in both packages. Do not add a second Firebase project. Firebase Hosting setup is optional because these pages can stay on Vercel.
3. Extract this ZIP and upload its **root files**, not the ZIP itself, to the root of `Ciamox-retail-dashbord`. Overwrite files with matching names and commit to `main`. This package overwrites the old SQL routing, backend, and old scanner page with inactive placeholders. Use the stable Vercel domain for the dashboard.

Do not carry over TiDB environment variables to Firebase. There is no Firebase login or role control in this prototype. The demo rules allow public access and may expire; do not store real shop transactions until access rules are designed and applied.

## Check the connection

Open the dashboard; its status should say `FIREBASE CONNECTED`. In the separate phone scanner, use **Inbound** to add a sample product and optional photo (or type its barcode manually), then refresh the dashboard inventory. Its photo appears beside the name. Open **Finance** to enter a selling price, or set it at the first checkout in the scanner's **Sell** screen. Check that revenue and stock update. If a permission error appears, inspect Firestore's database and rules.

## Finance

The **Inventory pricing** table shows each product's current weighted average purchase cost from Inbound, editable selling price, and gross profit per unit (`selling price - purchase cost`). The gross profit preview changes while you type. Click **Save price** to use that price for future sales. Past sales keep their recorded prices and costs. If the scanner has a cart with an older price, rescan before completing that sale.

The **Monthly costs** form accepts water, electricity, gas, sewage, total employee salaries, the full monthly mortgage payment, and the interest part of that payment. Fields that do not apply can be left blank. Enter at least one monthly cost before saving; until then, gross profit remains visible and net profit says **Unavailable**. For a mortgage, the interest portion is required for the net profit estimate. The full mortgage payment is included in cash commitments because the principal must still be paid, although principal is not a profit expense.

Enter **Expected units sold per month** to see the amount to set aside from each sold unit: `monthly cash commitments / expected monthly units`. The Finance table also shows `gross profit per unit - set-aside per unit` as a planning estimate. The expected unit count only affects the allocation per sale; it does not change recorded sales. If no unit count is entered, the set-aside stays **Unavailable**.

The net profit estimate is for **this month**: monthly gross profit minus utility costs, salaries, mortgage interest, and one-time expenses recorded for this month. The separate cash figure subtracts the full mortgage payment instead. These are estimates using the saved monthly plan, not finalized accounting statements. Do not record the same recurring bill in **One-time expense** or it will count twice. Editing the monthly plan recalculates the current month; this prototype does not retain past monthly plans.

In **Inventory**, each row has a **Delete** button. Confirming removes that product and its remaining stock, and records a negative stock adjustment in the existing `receipts` collection. Past sales and revenue are retained so the performance chart can still show historical stock. If the quantity or name changed after the row loaded, the operation stops and asks you to refresh.

In **Performance trend**, choose **From** and **To** using the English calendar. The chart defaults to the last 30 days and supports up to 366 days per view. Tap or point at the chart for exact daily values. Revenue and gross profit cards are all-time, while the net profit estimate is this month. The chart's net line is available for the current month after monthly costs are saved; it places the recurring monthly cost on the first day of the month. Historical net figures are unavailable because past monthly plans are not retained.

Data previously stored in TiDB is not moved automatically. This prototype reads `products`, `receipts`, `sales`, and `expenses` collections in the new Firestore database.
