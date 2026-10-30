# RetailFlow dashboard — Firebase prototype

This is the **main dashboard only**. The phone scanner is a separate website. Both websites use the same Firebase project, `ciamox-retail`, and its default Cloud Firestore database. All files in this ZIP are at its root; there are no subfolders or server routes.

## Connect Firebase

1. In Firebase Console → **Databases and storage → Firestore Database**, create the default **Standard** database. Choose **Test mode** for this short prototype; it permits public reads and writes. Use sample data only.
2. The registered Firebase web app configuration from the supplied screenshot is already in `firebase-config.js` in both packages. Do not add a second Firebase project. Firebase Hosting setup is optional because these pages can stay on Vercel.
3. Extract this ZIP and upload its **root files**, not the ZIP itself, to the root of `Ciamox-retail-dashbord`. Overwrite files with matching names and commit to `main`. This package overwrites the old SQL routing, backend, and old scanner page with inactive placeholders. Use the stable Vercel domain for the dashboard.

Do not carry over TiDB environment variables to Firebase. There is no Firebase login or role control in this prototype. Firestore Test mode is open to anyone, and its initial rules may expire; do not store real shop transactions until access rules are designed and applied.

## Check the connection

Open the dashboard; its status should say `FIREBASE CONNECTED`. In the separate phone scanner, use **Inbound** to add a sample product (or type its barcode manually), then refresh the dashboard inventory. Use **Sell** for one unit; the dashboard's revenue and stock should update. Record an expense to check net profit. If a permission error appears, inspect Firestore's database and rules.

Data previously stored in TiDB is not moved automatically. This prototype reads `products`, `receipts`, `sales`, and `expenses` collections in the new Firestore database.
