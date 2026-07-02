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
- Invoice duplicate checks warn before saving likely duplicates.
- Save buttons use guarded saving where duplicate submissions are risky.
- A friendly recovery screen appears if a UI section crashes, with retry and reload options.

Known MVP limitations:

- Very large historical datasets are still stored in simple Firestore collections.
- Invoice reporting is client-side after records load.
- The app does not yet use advanced Firestore cursor pagination for every collection.
- Browser-local fallback data is device-specific and should not replace Firebase for live operations.

Environment variable checklist:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `GEMINI_API_KEY`
- Optional: `GEMINI_MENU_MODEL`

## Invoice Scanning

The Invoices page can scan invoice photos and PDFs with Gemini through the serverless route at `api/gemini-invoice.js`. Add `GEMINI_API_KEY` to local env and Vercel Project Settings > Environment Variables, then redeploy. Manual entry remains available and every scanned line is editable before saving.

## Ingredient Cost Intelligence

Confirmed invoices are the main source of truth for raw ingredient prices. When a manager reviews and saves an invoice, WasteShift updates `ingredients`, nested `ingredients/{id}/priceHistory`, top-level `priceHistory`, `stockLevels`, `suppliers`, and the saved invoice record.

The raw ingredient library shows the latest invoice cost, supplier, unit, price history, missing-cost warnings, and significant price jumps. New scanned invoice lines can be matched to an existing ingredient or saved as a new raw ingredient, and raw ingredients can be deleted from the library when they are no longer used.

Recipe and waste costing use the invoice-backed item price catalog where possible. If a waste item, recipe component, or invoice line has missing or low-confidence cost data, it appears in the cost review queue instead of blocking normal logging.

Recommended invoice workflow:

1. Upload or scan the invoice.
2. Review supplier, invoice date, VAT mode, totals, and every line.
3. Match each line to an existing raw ingredient or create a new one.
4. Save the reviewed invoice.
5. Check the raw ingredient library and dashboard for missing costs, low stock, and price increases.

Troubleshooting invoice costs:

- If a recipe cost is missing, check that the raw ingredient name matches the recipe ingredient name closely.
- If prices look wrong, open the invoice review before saving and correct the quantity, unit, or unit price.
- If the same ingredient is scanned under a slightly different name, match it to the existing library item before saving.
- If a supplier invoice has unusual VAT, choose the correct VAT mode during review before confirming.

## First-Time Setup

On a fresh restaurant profile, WasteShift opens a setup wizard before the normal login screen. The wizard collects the restaurant name, optional branch, first manager name, management PIN, basic limits, optional staff codes, and optional menu items.

Setup progress is saved in the browser so a manager can refresh and continue. The completed restaurant profile is saved to Firestore at `restaurants/main` with `currency: ZAR`, `timezone: Africa/Johannesburg`, and `setupCompleted: true`.

Staff codes entered during setup are shown once in the wizard but are stored as salted hashes, not plain text. Staff can also be added later from Settings > Staff.

## Menu Import

Menu items can be added manually in the setup wizard or later in Settings > Menu & Recipes. The import panel supports pasted text, CSV files, and Gemini-assisted PDF/image extraction through `api/gemini-menu.js`.

Gemini setup:

- Add `GEMINI_API_KEY` to local env and Vercel Project Settings > Environment Variables.
- Optional: set `GEMINI_MENU_MODEL`; otherwise the app uses `gemini-2.5-flash`.
- Redeploy after changing Vercel env vars.

Supported menu import files:

- `.csv`
- `.txt`
- `.pdf`
- `.jpg`, `.png`, `.webp`

Every import opens a review list first. Managers can edit item names/categories/prices, approve valid rows, reject bad rows, approve high-confidence rows, and then save only approved items. If Gemini is missing or fails, text and CSV import still work.

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
