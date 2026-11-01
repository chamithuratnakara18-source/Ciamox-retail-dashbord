# RetailFlow dashboard — Firebase prototype

This is the **main dashboard only**. The phone scanner is a separate website. Both websites use the same Firebase project, `ciamox-retail`, and its default Cloud Firestore database. All files in this ZIP are at its root; there are no subfolders or server routes.

## Connect Firebase

1. Use the existing default **Standard** Firestore database. Keep the demo rules that permit access; Production mode's default deny-all rules alone will block the dashboard. Use sample data only.
2. The registered Firebase web app configuration from the supplied screenshot is already in `firebase-config.js` in both packages. Do not add a second Firebase project. Firebase Hosting setup is optional because these pages can stay on Vercel.
3. Extract this ZIP and upload its **root files**, not the ZIP itself, to the root of `Ciamox-retail-dashbord`. Overwrite files with matching names and commit to `main`. This package overwrites the old SQL routing, backend, and old scanner page with inactive placeholders. Use the stable Vercel domain for the dashboard.

Do not carry over TiDB environment variables to Firebase. There is no Firebase login or role control in this prototype. The demo rules allow public access and may expire; do not store real shop transactions until access rules are designed and applied.

## Check the connection

Open the dashboard; its status should say `FIREBASE CONNECTED`. In the separate phone scanner, use **Inbound** to add a sample product and optional photo (or type its barcode manually), then refresh the dashboard inventory. Its photo appears beside the name; its sale price reads `Set at first sale` until the first checkout. Use **Sell** for one unit, set the sale price, and check that revenue and stock update. Record an expense to check net profit. If a permission error appears, inspect Firestore's database and rules.

In **Inventory**, each row has a **Delete** button. Confirming removes that product and its remaining stock, and records a negative stock adjustment in the existing `receipts` collection. Past sales and revenue are retained so the performance chart can still show historical stock. If the quantity or name changed after the row loaded, the operation stops and asks you to refresh.

In **Performance trend**, choose **From** and **To** using the English calendar. The chart defaults to the last 30 days and supports up to 366 days per view. Tap or point at the chart for exact daily values. The summary cards above it remain all-time/current totals.

Data previously stored in TiDB is not moved automatically. This prototype reads `products`, `receipts`, `sales`, and `expenses` collections in the new Firestore database.
