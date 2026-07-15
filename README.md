# WasteShift

Food waste tracking app with Vercel hosting, Firebase Firestore live records, and local browser fallback storage.

## Local Development

```bash
npm.cmd install
npm.cmd run dev
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Local data is saved in browser storage while Firebase is used for shared menu items and waste entries when env vars are configured. Database backups can still be exported from the Database page.

## Testing And Beta Readiness

Core verification commands:

```bash
npm.cmd run lint
npm.cmd test
npm.cmd run test:e2e
npm.cmd run test:stress
npm.cmd run build
```

`npm.cmd test` runs unit and integration-style Node tests for waste calculations, invoice parsing, stock alerts, setup/menu import, shift sync/drafts, ingredient intelligence, performance helpers, auth/permissions, API route validation, and generated large datasets. These tests use mocks or local-only inputs and do not require production Firebase credentials or Gemini calls.

`npm.cmd run test:e2e` starts a local Vite server in E2E mode, runs Playwright browser checks for the setup wizard on desktop and mobile, then runs CI-safe source smoke checks over setup, login, waste logging, partial waste, dashboard, waste list filters, invoices, cost review, settings, and reset. E2E mode disables live Firebase calls so these checks do not need production credentials.

`npm.cmd run test:stress` is safe by default. It only generates local fixtures for 1,000/5,000 waste entries, 500 menu items, 500 ingredients, 100 staff, 500 inventory movements, and 100 invoices. To run HTTP stress checks, point it only at local/staging/preview:

```bash
set WASTESHIFT_STRESS_TARGET=http://127.0.0.1:5173
set WASTESHIFT_STRESS_CONCURRENCY=10
set WASTESHIFT_STRESS_REQUESTS=20
npm.cmd run test:stress
```

Do not run stress tests against production. The script refuses targets that are not localhost, staging, or preview-like URLs.

Test environment notes:

- Firebase app env vars are only required for live app testing, not basic unit tests.
- `GEMINI_API_KEY` is not required for tests; API tests verify missing-key and validation behavior without external calls.
- `WASTESHIFT_SYNC_SECRET` is tested with temporary mock values.
- CI runs `npm ci`, installs the Playwright Chromium browser, then runs lint, tests, E2E smoke, and build without production secrets.

Troubleshooting tests:

- If Firebase rules deploy fails, run `firebase login` locally and then `npm.cmd run firebase:deploy:firestore`.
- If `npm.cmd test` hangs, use the file-by-file runner output to identify the last printed script.
- If stress tests fail thresholds locally, reduce concurrency or check the dev server first.
- The client uses Firestore Lite for one-shot reads, writes, and transactions; production builds should not emit the previous oversized Firebase chunk warning.

Beta testing checklist:

- Publish Firestore rules before first setup.
- Complete setup with a manager PIN and at least one staff code.
- Log ingredient waste, menu waste, and partial menu waste.
- Confirm pending/failed sync messaging appears when offline.
- Import or manually enter a small invoice and confirm ingredient prices update.
- Reset only in a test restaurant after exporting data.

## Performance And Device Notes

WasteShift is optimized for current Chrome, Edge, and Safari on mobile phones, iPads/tablets, and small kitchen laptops. The dashboard opens to the current week by default, long waste logs render in batches, and the invoice review, invoice history, and raw ingredient library include load-more controls instead of rendering every record at once.

For best restaurant use, keep one browser tab open per device during service and use the Log screen for repeated entries. If loading feels slow, narrow the date range, clear inactive filters, archive/delete old test invoices, and check that Firebase is reachable.

Offline and weak-signal behavior:

- Waste entries can remain local with `pending` or `failed` sync status.
- Staff can retry failed sync from the waste logging flow.
- Large photo data URLs are stripped before Firestore writes; photos remain browser-local unless a future storage workflow is added.
- Draft waste forms are preserved during refresh/navigation where supported by the browser.

Safety behavior:

- Destructive reset/delete actions require confirmation.
- Normal ingredient, invoice, menu, and waste removal uses archive/void records so audit history is retained.
- Invoice duplicate checks warn before saving likely duplicates.
- Save buttons use guarded saving where duplicate submissions are risky.
- A friendly recovery screen appears if a UI section crashes, with retry and reload options.

Known MVP limitations:

- Very large historical datasets are still stored in simple Firestore collections.
- Invoice reporting is client-side over bounded pages after records load.
- Waste, invoice, stock movement, and price history reads are ordered, limited, and cursor-paged. Small reference collections still load in one bounded workspace request.
- Browser-local fallback data is device-specific and should not replace Firebase for live operations.

Environment variable checklist:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `OCR_SPACE_API_KEY` or `OCR_API_KEY`
- `GEMINI_API_KEY`
- Optional: `GEMINI_SCAN_MODEL`
- Optional: `GEMINI_MENU_MODEL`

Production API protection:

- Gemini menu imports, invoice scans, restaurant reset, and Firestore management writes use short-lived server-only access sessions. A manager enters their normal PIN once at sign-in; the browser never stores a Vercel API secret or PIN hash.
- Set `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel (recommended) to the complete JSON from Firebase Console > Project settings > Service accounts > Generate new private key. Alternatively set all three of `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, and `FIREBASE_ADMIN_PRIVATE_KEY`.
- `WASTESHIFT_MANAGER_API_SECRET` and `WASTESHIFT_API_SECRET` remain supported only for the legacy protected backup route. Do not add either value to any `VITE_*` variable or the browser.
- `WASTESHIFT_SYNC_SECRET` protects the optional Vercel Blob database backup route.
- `WASTESHIFT_RECOVERY_SECRET` is only needed for one-time recovery of a legacy single-shop database that has no server-side manager record. Recovery permanently closes after the first active manager is created.
- Store private keys with escaped newlines (`\n`) if Vercel stores them as a single-line value.
- In production, API routes fail closed when the needed secret is missing. Local development can still run without these secrets.
- `BLOB_READ_WRITE_TOKEN` is required when using the Vercel Blob backup database.

Production deployment checklist:

1. Add all `VITE_FIREBASE_*` values to Vercel and redeploy.
2. Enable Firebase Anonymous Auth. Deploy the Vercel app first, then publish `firestore.rules` plus `firestore.indexes.json` so the session API is available when the stricter rules become active.
3. Add `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel before enabling Gemini/OCR. This enables automatic manager sessions without any in-app API-key field.
4. Add `OCR_SPACE_API_KEY` or `OCR_API_KEY`, plus `GEMINI_API_KEY`, in Vercel for invoice and menu scanning.
5. Redeploy after adding the Firebase Admin credentials and API keys.
6. Add Vercel Blob storage and `BLOB_READ_WRITE_TOKEN` only if using server database backups.
7. Add `WASTESHIFT_SYNC_SECRET` if Vercel Blob backup load/save should be available from the app.
8. Run `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run build` before deploying.
9. After deploy, open the production URL on a manager device, complete setup, add staff, and verify one waste log plus one invoice confirmation.

## Invoice Scanning

The Invoices page scans invoice photos and PDFs through `api/scan-document.js`. The server calls OCR.space Engine 2 first, retries Engine 3 when OCR text is weak, then sends only the OCR text to Gemini Flash-Lite for structured JSON cleanup. Add `OCR_SPACE_API_KEY` or `OCR_API_KEY`, plus `GEMINI_API_KEY`, to local env and Vercel Project Settings > Environment Variables, then redeploy.

Manual entry remains available and every scanned line is editable before saving. Confirmed invoice records store the OCR raw text and scanner metadata for debugging.

## Ingredient Cost Intelligence

Confirmed invoices are the main source of truth for raw ingredient prices. When a manager reviews and saves an invoice, WasteShift updates `ingredients`, nested `ingredients/{id}/priceHistory`, top-level `priceHistory`, `stockLevels`, `suppliers`, and the saved invoice record.

The raw ingredient library shows the latest invoice cost, supplier, unit, price history, missing-cost warnings, and significant price jumps. New scanned invoice lines can be matched to an existing ingredient or saved as a new raw ingredient, and inactive ingredients can be archived without deleting their stock or price audit history.

Recipe and waste costing use the invoice-backed item price catalog where possible. If a waste item, recipe component, or invoice line has missing or low-confidence cost data, it appears in the cost review queue instead of blocking normal logging.

Recommended invoice workflow:

1. Upload or scan the invoice.
2. Review supplier, invoice date, VAT mode, totals, OCR/Gemini confidence, and every line.
3. Match each line to an existing raw ingredient or create a new one.
4. Choose prices only, prices + stock, or historical invoice.
5. Confirm the reviewed invoice.
6. Check the raw ingredient library and dashboard for missing costs, low stock, and price increases.

Troubleshooting invoice costs:

- If a recipe cost is missing, check that the raw ingredient name matches the recipe ingredient name closely.
- If prices look wrong, open the invoice review before saving and correct the quantity, unit, or unit price.
- If the same ingredient is scanned under a slightly different name, match it to the existing library item before saving.
- If a supplier invoice has unusual VAT, choose the correct VAT mode during review before confirming.

## First-Time Setup

On a fresh restaurant profile, WasteShift opens a setup wizard before the normal login screen. The wizard collects the restaurant name, optional branch, first manager name, management PIN, basic limits, optional staff codes, and optional menu items.

Non-sensitive setup progress is saved in the browser so a manager can refresh and continue. Manager PINs, confirmation PINs, and staff PINs are deliberately excluded and must be entered again after a refresh. The completed restaurant profile is saved to a database-scoped Firestore restaurant document with `currency: ZAR`, `timezone: Africa/Johannesburg`, and `setupCompleted: true`.

Staff codes entered during setup are shown once in the wizard but are stored as salted hashes in the server-only `staffAccounts` collection, not plain text or browser storage. Successful PIN checks create expiring `accessSessions` documents that Firestore rules use for role enforcement. Staff can also be added later from Settings > Staff.

## Menu Import

Menu items can be added manually in the setup wizard or later in Settings > Menu & Recipes. The import panel supports pasted text, CSV files, and OCR-assisted PDF/image extraction through `api/scan-document.js`.

Scanner setup:

- Add `OCR_SPACE_API_KEY` or `OCR_API_KEY` to local env and Vercel Project Settings > Environment Variables.
- Add `GEMINI_API_KEY` to local env and Vercel Project Settings > Environment Variables.
- Optional: set `GEMINI_SCAN_MODEL`; otherwise the app uses `gemini-2.5-flash-lite`.
- Redeploy after changing Vercel env vars.

Supported menu import files:

- `.csv`
- `.txt`
- `.pdf`
- `.jpg`, `.png`, `.webp`

Every import opens a review list first. Managers can edit item names/categories/prices, approve valid rows, reject bad rows, approve high-confidence rows, and then save only approved items. Scanned menu descriptions may include suggested ingredients for review, but WasteShift does not silently create finalized recipes from menu scans. If OCR/Gemini is missing or fails, text and CSV import still work.

Import history is saved in Firestore under `menuImports`.

## Reset Restaurant Data

Managers can reset restaurant data from Settings > Danger. The reset requires typing `RESET` and clears business data such as staff, menu items, ingredients, recipes, inventory, waste entries, invoices, audit logs, and cached browser setup data.

After reset, the app returns to the setup wizard. Firebase must be configured before setup can be completed again.

## Daily Staff Workflow

Staff log in with the profile and code issued by management. The fastest flow during a shift is:

1. Open Log.
2. Keep the current staff member selected.
3. Choose Ingredient/stock or Menu item/drink.
4. Use a recent item, search, or type the item name.
5. Tap a quick quantity and quick reason.
6. Add an optional note/photo only when useful.
7. Tap Log waste.

The form defaults to the current date/time, quantity `1`, and common waste reasons. The submit button disables while saving to prevent double entries.

### Ingredient Waste

Use Ingredient/stock for raw stock such as tomatoes, milk, coffee beans, or prep portions. Supported units are `each`, `g`, `kg`, `ml`, `L`, and `portion`.

If invoice/item price data exists, WasteShift calculates the cost automatically. If price data is missing, staff can still save the entry; it will be marked as needing price review.

### Menu Waste And Partial Waste

Use Menu item/drink for finished items. Search the menu, then either leave all components selected for a full item or select only the wasted components for partial waste.

WasteShift shows food cost, selling price/revenue impact where available, and missing-cost warnings. Missing costs do not block saving; entries are marked for cost review.

### Repeat Last Entry

Use Repeat last to log the previous waste item again with the current time and current staff member. This is useful for repeated prep or service waste.

### Drafts

Unfinished waste forms are auto-saved as drafts in IndexedDB. If the page refreshes, the draft is restored and can be finished or discarded with Clear form.

Drafts are not real waste entries and do not affect dashboard totals or reports.

### Pending Sync

When Firebase is unavailable or the device is offline, entries are kept locally with `pending` or `failed` sync status. WasteShift retries when the browser comes back online, and staff can use Retry sync from the form after a failed save.

### Cost Review

`Needs price` or `Needs ingredient costs` means the entry was saved but management should add invoice/item price data later. These entries remain visible in the waste log and dashboard.

### Tablet/Mobile Tips

Keep the browser open on the Log screen during service, use recent items and quick reason buttons, and avoid attaching photos unless management needs evidence. On tablets, use the search field plus quick quantity buttons for the fastest entry flow.

Troubleshooting failed imports:

- If Gemini says the key is missing, check `GEMINI_API_KEY` in Vercel and redeploy.
- If a PDF/image fails, try a smaller or clearer file.
- If extracted rows look wrong, reject them and use pasted text or CSV import.
- Duplicate or missing-price rows must be fixed before they can be approved.

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

That performs a read-only connectivity check for Firebase Anonymous Auth and restaurant discovery. It does not create or modify production records.

## Firebase + Vercel

Firebase is the live data layer:

- `menuItems` stores menu item names, total costs, and component costs.
- `wasteEntries` stores logged waste entries using the app entry id as the Firestore document id, so retries update the same entry instead of creating duplicates.
- `accessSessions`, `managerSessions`, `staffAccounts`, and `loginAttempts` are server-only authorization collections managed by Vercel functions and denied to browser clients.
- Large local-only fields, such as photo data URLs, are not mirrored into Firestore.

Vercel is the hosting layer. Add the `VITE_FIREBASE_*` variables from `.env.firebase.example` to Vercel Project Settings > Environment Variables, then redeploy.

## Vercel Backup

The app also includes an optional Vercel serverless API at `api/database.js`. It saves full JSON database snapshots to Vercel Blob under `wasteshift/databases/`.

To enable Vercel backups:

1. Add Vercel Blob storage to the project.
2. Make sure `BLOB_READ_WRITE_TOKEN` is available in the project environment variables.
3. Set `WASTESHIFT_SYNC_SECRET` to protect backup load/save in production.
4. Redeploy.

When Firebase is configured, Vercel backup is manual from Settings > Database. Browser storage remains a fallback.
