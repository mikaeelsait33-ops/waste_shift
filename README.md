# WasteShift

Food waste tracking app with local browser persistence and optional Vercel server sync.

## Local Development

```bash
npm.cmd install
npm.cmd run dev
```

Local data is saved in browser storage. Database backups can still be exported from the Database page.

## Vercel Server Sync

The app includes a Vercel serverless API at `api/database.js`. It saves one JSON database snapshot to Vercel Blob at `wasteshift/database.json`.

To enable it on Vercel:

1. Deploy the project to Vercel.
2. Add Vercel Blob storage to the project.
3. Make sure `BLOB_READ_WRITE_TOKEN` is available in the project environment variables.
4. Redeploy.

After that, the Database page will show server sync status and the app will auto-save to the server. Browser storage remains as a fallback.

Important: protect the Vercel deployment if this data is private, because the sync API is same-origin but not user-authenticated.
