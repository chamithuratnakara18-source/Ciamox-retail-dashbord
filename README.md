# RetailFlow dashboard: AI camera checkout

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
