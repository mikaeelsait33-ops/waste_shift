# WasteShift

Food waste tracking app with Vercel hosting, Firebase Firestore live records, and local browser fallback storage.

## Local Development

```bash
npm.cmd install
npm.cmd run dev
```

Local data is saved in browser storage while Firebase is used for shared menu items and waste entries when env vars are configured. Database backups can still be exported from the Database page.

## Invoice Scanning

The Invoices page runs OCR entirely in the browser with Tesseract.js. JPG and PNG files are scanned directly; PDFs are rendered to an image with pdf.js before OCR. No paid invoice API or backend OCR route is required.

The invoice module writes to:

- `ingredients`
- `ingredients/{id}/priceHistory`
- `stockLevels`
- `invoices`
- `suppliers`
- `settings/invoiceConfig`

After publishing Firestore rules, run:

```bash
npm.cmd run firebase:smoke
```

That verifies menu, waste, invoice, ingredient, supplier, settings, and stock writes.

## Firebase + Vercel

Firebase is the live data layer:

- `menuItems` stores menu item names, total costs, and component costs.
- `wasteEntries` stores logged waste entries using the app entry id as the Firestore document id, so retries update the same entry instead of creating duplicates.
- Large local-only fields, such as photo data URLs, are not mirrored into Firestore.

Vercel is the hosting layer. Add the `VITE_FIREBASE_*` variables from `.env.firebase.example` to Vercel Project Settings > Environment Variables, then redeploy.

## Vercel Backup

The app also includes an optional Vercel serverless API at `api/database.js`. It saves full JSON database snapshots to Vercel Blob under `wasteshift/databases/`.

To enable Vercel backups:

1. Add Vercel Blob storage to the project.
2. Make sure `BLOB_READ_WRITE_TOKEN` is available in the project environment variables.
3. Optionally set `WASTESHIFT_SYNC_SECRET` to protect backup load/save.
4. Redeploy.

When Firebase is configured, Vercel backup is manual from Settings > Database. Browser storage remains a fallback.
