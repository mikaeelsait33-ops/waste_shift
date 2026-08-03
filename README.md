# WasteShift

WasteShift is a single-restaurant operations app for waste logging, invoice capture, raw ingredient pricing, recipe costing, stock control, and management reporting.

Business records live in Firebase Firestore so managers see the same invoices, waste entries, recipes, stock, and settings on every signed-in device. Waste photos and temporary large make-line guide uploads use Vercel Blob. OCR is not used: invoice images/PDFs and make-line guides are interpreted by Gemini, while CSV files are parsed directly.

## Daily Workflows

### Waste

1. Sign in with the restaurant's manager or staff code.
2. Open **Log Waste** and choose a raw ingredient or menu item.
3. Enter the amount, unit, reason, and optional photo.
4. Save the entry. WasteShift records the cost and deducts linked stock once.
5. Managers can review, filter, void, or restore entries in **Waste Log**.

New waste entries require a Firebase connection. WasteShift does not claim that a business record was saved when the server cannot confirm it.

### Invoices

1. Open **Inventory > Upload & Review**.
2. Upload a JPG, PNG, WebP, PDF, or CSV invoice.
3. Review the supplier, date, VAT, totals, quantities, units, and every extracted line.
4. Match lines to existing raw ingredients or create new ingredients.
5. Choose whether to update prices only, prices and stock, or save a historical invoice.
6. Confirm the invoice.

Confirmation atomically saves the invoice, supplier, raw ingredients, and price history. Stock posting is retry-safe and will not apply the same invoice movement twice. Confirmed invoices are grouped by supplier and can be searched by supplier, invoice number, and date.

### Make-Line Guides And Recipes

1. Open **Menu > Recipes**.
2. Upload the complete make-line guide as a PDF or image, or paste guide text.
3. Review all extracted dishes and exact ingredient portions.
4. Approve and save the import.

The full guide is processed in paced sections and saved as one Firebase batch. Recipe ingredients link to the raw ingredient library, so invoice prices flow into recipe food cost, margin, and waste value.

### Stock

Confirmed invoices can add received stock automatically. Waste entries deduct compatible raw ingredient units. Managers can also record a stock count, receipt, or usage adjustment. Every change creates a shared stock movement record.

## Access Model

WasteShift is configured for one restaurant and one primary manager account. The manager creates non-manager staff profiles with individual access codes. A valid restaurant session is required for Firestore and protected API operations.

There is no universal access key in the source code. Another device signs in at the production URL using the same manager profile and PIN created during first setup.

## Local Development

```powershell
npm.cmd install
npm.cmd run dev
```

Copy `.env.firebase.example` to `.env.local` and fill in the Firebase web configuration. Protected local API testing also needs Firebase Admin credentials and the relevant server keys.

## Environment

Browser-safe Firebase values:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Server-only Vercel values:

- `FIREBASE_SERVICE_ACCOUNT_JSON`, or the three separate Firebase Admin values
- `GEMINI_API_KEY`
- `BLOB_READ_WRITE_TOKEN` (only needed for large make-line guide uploads; waste photos are saved with their Firebase waste entry)
- Optional `GEMINI_MODEL` and `GEMINI_MENU_MODEL`

Never expose Firebase Admin credentials, Gemini keys, Blob tokens, PINs, or PIN hashes in a `VITE_*` variable.

Firebase Anonymous Authentication must be enabled. Deploy `firestore.rules` and `firestore.indexes.json` after linking the intended Firebase project:

```powershell
npm.cmd run firebase:deploy:firestore
```

## Verification

Run the complete local gate before deployment:

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run test:e2e
npm.cmd run test:stress
npm.cmd run build
```

The E2E suite verifies setup and lockout behavior plus the real manager workspace on desktop and mobile, including navigation, invoice sections, menu management, waste submission, and overflow checks. E2E mode does not write to production Firebase.

The stress suite generates large local fixtures by default. It refuses arbitrary production targets.

## Deployment

WasteShift is deployed to Vercel. Add the environment variables to the Vercel project, build, deploy the saved production output, then verify:

- the login/setup screen loads;
- the existing manager can sign in on a second device;
- one waste entry appears on both devices;
- one invoice can be reviewed, confirmed, found under its supplier, and posted to stock;
- a complete make-line guide import saves all approved recipes;
- stock and reports reflect those records.

## Data Safety

- Business records are stored in Firebase, not treated as device-local records.
- Confirmed invoice and waste stock movements are idempotent.
- Deletes are normally soft deletes or voids so audit history remains available.
- Destructive restaurant reset requires manager permission and an explicit `RESET` confirmation.
- **Settings > Data** exports configuration only. Live waste, invoices, stock, photos, accounts, and audit records remain in Firebase.
- Firebase Admin and Gemini operations run only through protected Vercel functions.
