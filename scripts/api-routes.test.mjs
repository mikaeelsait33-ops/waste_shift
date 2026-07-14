import assert from 'node:assert/strict';

let importCounter = 0;

const createSha256Base64 = async (value) => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(value).digest('base64');
};

const createResponse = () => ({
  headers: {},
  statusCode: 0,
  body: null,
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  },
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const callHandler = async (handler, request) => {
  const response = createResponse();
  await handler({
    headers: {},
    body: null,
    ...request,
  }, response);
  return response;
};

const importDatabaseHandler = async ({ syncSecret = '' } = {}) => {
  if (syncSecret) {
    process.env.WASTESHIFT_SYNC_SECRET = syncSecret;
  } else {
    delete process.env.WASTESHIFT_SYNC_SECRET;
  }

  return (await import(`../api/database.js?case=${importCounter++}`)).default;
};

const importAdminResetHandler = async () => (
  (await import(`../api/admin-reset.js?case=${importCounter++}`)).default
);

const importManagerSessionHandler = async () => (
  (await import(`../api/manager-session.js?case=${importCounter++}`)).default
);

const managerSessionHelpers = await import(`../api/manager-session.js?case=${importCounter++}`);
const firebaseIdentityHelpers = await import(`../api/_firebaseIdentity.js?case=${importCounter++}`);
const testManagerPinRecord = {
  algorithm: 'sha256-salt-v1',
  salt: 'test-salt',
  hash: await createSha256Base64('test-salt:4826'),
};

assert.equal(managerSessionHelpers.verifyManagerPin('4826', testManagerPinRecord), true);
assert.equal(managerSessionHelpers.verifyManagerPin('4827', testManagerPinRecord), false);
assert.equal(managerSessionHelpers.verifyManagerPin('bad', testManagerPinRecord), false);
assert.equal(typeof firebaseIdentityHelpers.verifyFirebaseIdToken, 'function');

const databaseHelpers = await import(`../api/database.js?case=${importCounter++}`);

assert.equal(databaseHelpers.normalizeDatabaseId('restaurant one!'), 'restaurant_one_');
assert.equal(databaseHelpers.createDatabaseFolderPrefix('tenant_a'), 'wasteshift/databases/tenant_a/');
assert.notEqual(
  databaseHelpers.createDatabaseFolderPrefix('tenant_a'),
  databaseHelpers.createDatabaseFolderPrefix('tenant_b'),
);

delete process.env.VERCEL_ENV;
delete process.env.WASTESHIFT_MANAGER_API_SECRET;
const databaseOpenHandler = await importDatabaseHandler();

let response = await callHandler(databaseOpenHandler, {
  method: 'DELETE',
});
assert.equal(response.statusCode, 405);
assert.equal(response.body.ok, false);

response = await callHandler(databaseOpenHandler, {
  method: 'POST',
  body: '{"data":{"wasteItems":"not-array"}}',
});
assert.equal(response.statusCode, 400);
assert.match(response.body.message, /wasteItems/);

response = await callHandler(databaseOpenHandler, {
  method: 'POST',
  headers: { 'content-length': String(6 * 1024 * 1024) },
  body: JSON.stringify({ data: {} }),
});
assert.equal(response.statusCode, 413);

response = await callHandler(databaseOpenHandler, {
  method: 'POST',
  body: '{bad json',
});
assert.equal(response.statusCode, 400);
assert.equal(response.body.ok, false);

process.env.VERCEL_ENV = 'production';
delete process.env.WASTESHIFT_MANAGER_API_SECRET;
const databaseProductionMissingSecretHandler = await importDatabaseHandler();
const adminResetProductionMissingSecretHandler = await importAdminResetHandler();

response = await callHandler(databaseProductionMissingSecretHandler, {
  method: 'GET',
});
assert.equal(response.statusCode, 503);
assert.equal(response.body.code, 'sync_api_secret_not_configured');

response = await callHandler(adminResetProductionMissingSecretHandler, {
  method: 'POST',
  body: JSON.stringify({ confirmation: 'RESET' }),
});
assert.equal(response.statusCode, 503);
assert.equal(response.body.code, 'firebase_manager_session_not_configured');
assert.equal(response.headers['cache-control'], 'no-store');

const databaseProductionSyncOnlyHandler = await importDatabaseHandler({ syncSecret: 'safe-test-secret' });

response = await callHandler(databaseProductionSyncOnlyHandler, {
  method: 'GET',
});
assert.equal(response.statusCode, 401);

response = await callHandler(databaseProductionSyncOnlyHandler, {
  method: 'POST',
  headers: { 'x-wasteshift-sync-secret': 'safe-test-secret' },
  body: JSON.stringify({ data: { wasteItems: 'bad' } }),
});
assert.equal(response.statusCode, 400);

delete process.env.VERCEL_ENV;
const databaseProtectedHandler = await importDatabaseHandler({ syncSecret: 'safe-test-secret' });

response = await callHandler(databaseProtectedHandler, {
  method: 'GET',
});
assert.equal(response.statusCode, 401);
assert.equal(response.body.requiresSecret, true);
assert.doesNotMatch(JSON.stringify(response.body), /safe-test-secret/);

response = await callHandler(databaseProtectedHandler, {
  method: 'GET',
  headers: { 'x-wasteshift-sync-secret': 'wrong' },
});
assert.equal(response.statusCode, 403);
assert.equal(response.body.requiresSecret, true);
assert.doesNotMatch(JSON.stringify(response.body), /safe-test-secret/);

response = await callHandler(databaseProtectedHandler, {
  method: 'POST',
  headers: { 'x-wasteshift-sync-secret': 'safe-test-secret' },
  body: JSON.stringify({ data: { wasteItems: 'bad' } }),
});
assert.equal(response.statusCode, 400);

response = await callHandler(databaseProtectedHandler, {
  method: 'GET',
  headers: { 'x-wasteshift-sync-secret': 'safe-test-secret' },
});
assert.equal(response.statusCode, 400);
assert.equal(response.body.code, 'database_id_required');
assert.equal(response.headers['cache-control'], 'no-store');

delete process.env.WASTESHIFT_SYNC_SECRET;
process.env.WASTESHIFT_MANAGER_API_SECRET = 'manager-api-secret';

const databaseManagerProtectedHandler = await importDatabaseHandler();

response = await callHandler(databaseManagerProtectedHandler, {
  method: 'POST',
  body: JSON.stringify({ data: { wasteItems: 'bad' } }),
});
assert.equal(response.statusCode, 401);
assert.equal(response.body.code, 'sync_api_secret_required');

response = await callHandler(databaseManagerProtectedHandler, {
  method: 'POST',
  headers: { 'x-wasteshift-manager-secret': 'wrong' },
  body: JSON.stringify({ data: { wasteItems: 'bad' } }),
});
assert.equal(response.statusCode, 403);
assert.equal(response.body.code, 'sync_api_secret_invalid');

response = await callHandler(databaseManagerProtectedHandler, {
  method: 'POST',
  headers: { 'x-wasteshift-manager-secret': 'manager-api-secret' },
  body: JSON.stringify({ data: { wasteItems: 'bad' } }),
});
assert.equal(response.statusCode, 400);

delete process.env.WASTESHIFT_MANAGER_API_SECRET;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
delete process.env.OCR_SPACE_API_KEY;

const menuHandler = (await import(`../api/gemini-menu.js?case=${importCounter++}`)).default;
const invoiceHandler = (await import(`../api/gemini-invoice.js?case=${importCounter++}`)).default;
const scanDocumentHandler = (await import(`../api/scan-document.js?case=${importCounter++}`)).default;

response = await callHandler(menuHandler, { method: 'GET' });
assert.equal(response.statusCode, 405);

response = await callHandler(menuHandler, {
  method: 'POST',
  body: JSON.stringify({ text: 'Coffee R35' }),
});
assert.equal(response.statusCode, 503);
assert.match(response.body.message, /Gemini API key/);

response = await callHandler(invoiceHandler, { method: 'GET' });
assert.equal(response.statusCode, 405);

response = await callHandler(invoiceHandler, {
  method: 'POST',
  body: JSON.stringify({ file: { name: 'invoice.jpg', mimeType: 'image/jpeg', data: 'abc' } }),
});
assert.equal(response.statusCode, 503);
assert.match(response.body.message, /Gemini API key/);

response = await callHandler(scanDocumentHandler, { method: 'GET' });
assert.equal(response.statusCode, 405);

response = await callHandler(scanDocumentHandler, {
  method: 'POST',
  body: JSON.stringify({ documentType: 'invoice', file: { name: 'invoice.jpg', mimeType: 'image/jpeg', data: 'abc' } }),
});
assert.equal(response.statusCode, 503);
assert.match(response.body.message, /OCR\.space API key/);

process.env.VERCEL_ENV = 'production';
const productionMenuHandler = (await import(`../api/gemini-menu.js?case=${importCounter++}`)).default;
const productionInvoiceHandler = (await import(`../api/gemini-invoice.js?case=${importCounter++}`)).default;
const productionScanDocumentHandler = (await import(`../api/scan-document.js?case=${importCounter++}`)).default;

response = await callHandler(productionMenuHandler, {
  method: 'POST',
  body: JSON.stringify({ text: 'Coffee R35' }),
});
assert.equal(response.statusCode, 503);
assert.equal(response.body.code, 'firebase_manager_session_not_configured');

response = await callHandler(productionInvoiceHandler, {
  method: 'POST',
  body: JSON.stringify({ file: { name: 'invoice.jpg', mimeType: 'image/jpeg', data: 'abc' } }),
});
assert.equal(response.statusCode, 503);
assert.equal(response.body.code, 'firebase_manager_session_not_configured');

response = await callHandler(productionScanDocumentHandler, {
  method: 'POST',
  body: JSON.stringify({ documentType: 'invoice', file: { name: 'invoice.jpg', mimeType: 'image/jpeg', data: 'abc' } }),
});
assert.equal(response.statusCode, 503);
assert.equal(response.body.code, 'firebase_manager_session_not_configured');

delete process.env.VERCEL_ENV;

delete process.env.WASTESHIFT_MANAGER_API_SECRET;
process.env.WASTESHIFT_SYNC_SECRET = 'safe-test-secret';
process.env.GEMINI_API_KEY = 'test-key';

response = await callHandler(menuHandler, {
  method: 'POST',
  headers: { 'x-wasteshift-sync-secret': 'safe-test-secret' },
  body: JSON.stringify({ text: '' }),
});
assert.equal(response.statusCode, 400);
assert.notEqual(response.body.code, 'manager_api_secret_required');

delete process.env.WASTESHIFT_SYNC_SECRET;
delete process.env.GEMINI_API_KEY;

process.env.WASTESHIFT_MANAGER_API_SECRET = 'manager-api-secret';
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.FIREBASE_ADMIN_PROJECT_ID;
delete process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
delete process.env.FIREBASE_ADMIN_PRIVATE_KEY;

const adminResetHandler = await importAdminResetHandler();
const managerSessionHandler = await importManagerSessionHandler();

response = await callHandler(managerSessionHandler, {
  method: 'GET',
});
assert.equal(response.statusCode, 405);

response = await callHandler(managerSessionHandler, {
  method: 'POST',
  body: JSON.stringify({ managerId: 'manager_nadia', pin: '4826' }),
});
assert.equal(response.statusCode, 503);
assert.equal(response.body.code, 'firebase_manager_session_not_configured');

response = await callHandler(adminResetHandler, {
  method: 'GET',
});
assert.equal(response.statusCode, 405);

response = await callHandler(adminResetHandler, {
  method: 'POST',
  headers: { 'x-wasteshift-manager-secret': 'wrong' },
  body: JSON.stringify({ confirmation: 'RESET' }),
});
assert.equal(response.statusCode, 403);

response = await callHandler(adminResetHandler, {
  method: 'POST',
  headers: { 'x-wasteshift-manager-secret': 'manager-api-secret' },
  body: JSON.stringify({ confirmation: 'NOPE' }),
});
assert.equal(response.statusCode, 400);

response = await callHandler(adminResetHandler, {
  method: 'POST',
  headers: { 'x-wasteshift-manager-secret': 'manager-api-secret' },
  body: JSON.stringify({ confirmation: 'RESET' }),
});
assert.equal(response.statusCode, 501);
assert.equal(response.body.code, 'firebase_admin_not_configured');

response = await callHandler(menuHandler, {
  method: 'POST',
  body: JSON.stringify({ text: 'Coffee R35' }),
});
assert.equal(response.statusCode, 401);
assert.equal(response.body.code, 'manager_api_secret_required');

response = await callHandler(invoiceHandler, {
  method: 'POST',
  headers: { 'x-wasteshift-manager-secret': 'wrong' },
  body: JSON.stringify({ file: { name: 'invoice.jpg', mimeType: 'image/jpeg', data: 'abc' } }),
});
assert.equal(response.statusCode, 403);
assert.equal(response.body.code, 'manager_api_secret_invalid');

response = await callHandler(menuHandler, {
  method: 'POST',
  headers: { 'x-wasteshift-manager-secret': 'manager-api-secret' },
  body: JSON.stringify({ text: 'Coffee R35' }),
});
assert.equal(response.statusCode, 503);
assert.match(response.body.message, /Gemini API key/);

delete process.env.WASTESHIFT_MANAGER_API_SECRET;
process.env.GEMINI_API_KEY = 'test-key';
let fetchWasCalled = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  fetchWasCalled = true;
  throw new Error('External fetch should not be reached for validation failures.');
};

response = await callHandler(menuHandler, {
  method: 'POST',
  body: JSON.stringify({ text: '' }),
});
assert.equal(response.statusCode, 400);
assert.equal(fetchWasCalled, false);

response = await callHandler(invoiceHandler, {
  method: 'POST',
  body: JSON.stringify({ file: { name: 'bad.txt', mimeType: 'text/plain', data: 'abc' } }),
});
assert.equal(response.statusCode, 400);
assert.equal(fetchWasCalled, false);

globalThis.fetch = originalFetch;
delete process.env.GEMINI_API_KEY;
delete process.env.VERCEL_ENV;

process.env.OCR_SPACE_API_KEY = 'ocr-test-key';
process.env.GEMINI_API_KEY = 'gemini-test-key';
const scannerFetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  scannerFetchCalls.push({ url: String(url), body: String(options.body || '') });

  if (String(url).includes('ocr.space') && scannerFetchCalls.length === 1) {
    return {
      ok: true,
      text: async () => JSON.stringify({
        IsErroredOnProcessing: false,
        ParsedResults: [{ ParsedText: 'tiny' }],
      }),
    };
  }

  if (String(url).includes('ocr.space') && scannerFetchCalls.length === 2) {
    return {
      ok: true,
      text: async () => JSON.stringify({
        IsErroredOnProcessing: false,
        ParsedResults: [{
          ParsedText: 'Raw Naturally Nutritious\nTax Invoice INV-123 Date 2026-07-01\nDescription Quantity Unit Price Total\nTomatoes Kg 2 R29.90 R59.80\nTotal R59.80',
        }],
      }),
    };
  }

  return {
    ok: true,
    text: async () => JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              supplierName: 'Raw Naturally Nutritious',
              invoiceNumber: 'INV-123',
              invoiceDate: '2026-07-01',
              currency: 'ZAR',
              subtotal: 59.8,
              vatAmount: 0,
              totalAmount: 59.8,
              lineItems: [{
                description: 'Tomatoes Kg',
                quantity: 2,
                purchaseUnit: 'kg',
                unitPrice: 29.9,
                lineTotal: 59.8,
                vatIncluded: false,
                category: 'Produce',
                confidence: 0.94,
                needsReview: false,
              }],
              warnings: [],
            }),
          }],
        },
      }],
    }),
  };
};

response = await callHandler(scanDocumentHandler, {
  method: 'POST',
  body: JSON.stringify({
    documentType: 'invoice',
    file: { name: 'invoice.jpg', mimeType: 'image/jpeg', data: 'aW52b2ljZQ==' },
  }),
});
assert.equal(response.statusCode, 200);
assert.equal(response.body.success, true);
assert.equal(response.body.ocr.engineUsed, 3);
assert.equal(response.body.extracted.supplierName, 'Raw Naturally Nutritious');
assert.equal(response.body.extracted.lineItems[0].description, 'Tomatoes Kg');
assert.match(scannerFetchCalls[0].body, /OCREngine=2/);
assert.match(scannerFetchCalls[1].body, /OCREngine=3/);
assert.match(scannerFetchCalls[2].url, /gemini-2\.5-flash-lite/);

fetchWasCalled = false;
globalThis.fetch = async () => {
  fetchWasCalled = true;
  throw new Error('External fetch should not be reached for scanner validation failures.');
};
response = await callHandler(scanDocumentHandler, {
  method: 'POST',
  body: JSON.stringify({
    documentType: 'invoice',
    file: { name: 'bad.txt', mimeType: 'text/plain', data: 'abc' },
  }),
});
assert.equal(response.statusCode, 400);
assert.equal(fetchWasCalled, false);

globalThis.fetch = originalFetch;
delete process.env.OCR_SPACE_API_KEY;
delete process.env.GEMINI_API_KEY;

console.log('API route tests passed');
