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

const importAdminResetHandler = async () => (
  (await import(`../api/admin-reset.js?case=${importCounter++}`)).default
);

const importManagerSessionHandler = async () => (
  (await import(`../api/manager-session.js?case=${importCounter++}`)).default
);

const importStaffSessionHandler = async () => (
  (await import(`../api/staff-session.js?case=${importCounter++}`)).default
);

const importStaffAccountsHandler = async () => (
  (await import(`../api/staff-accounts.js?case=${importCounter++}`)).default
);

const importManagerBootstrapHandler = async () => (
  (await import(`../api/manager-bootstrap.js?case=${importCounter++}`)).default
);

const importWastePhotoHandler = async () => (
  (await import(`../api/waste-photo.js?case=${importCounter++}`)).default
);

const importWasteStockHandler = async () => (
  (await import(`../api/waste-stock.js?case=${importCounter++}`)).default
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

const cleanupHelpers = await import(`../api/admin-cleanup-duplicates.js?case=${importCounter++}`);

assert.equal(cleanupHelpers.getDocDatabaseId({
  id: 'main',
  data: () => ({}),
}), '');
assert.equal(cleanupHelpers.getDocDatabaseId({
  id: 'old_shop__invoice_1',
  data: () => ({}),
}), 'old_shop');
assert.equal(cleanupHelpers.getDocDatabaseId({
  id: 'anything',
  data: () => ({ databaseId: 'explicit_shop' }),
}), 'explicit_shop');

const makeFakeDoc = (collectionName, id, data) => ({
  id,
  ref: { collectionName, id },
  data: () => data,
});
const fakeCleanupCollections = {
  restaurants: [
    makeFakeDoc('restaurants', 'canonical_shop', { databaseId: 'canonical_shop', setupCompleted: true }),
    makeFakeDoc('restaurants', 'old_shop', { databaseId: 'old_shop', setupCompleted: true }),
    makeFakeDoc('restaurants', 'draft_shop', { databaseId: 'draft_shop', setupCompleted: false }),
  ],
  appData: [
    makeFakeDoc('appData', 'main', { exportedAt: '2026-01-01' }),
    makeFakeDoc('appData', 'canonical_shop__main', {}),
    makeFakeDoc('appData', 'old_shop__main', {}),
  ],
  invoices: [
    makeFakeDoc('invoices', 'canonical_invoice', { databaseId: 'canonical_shop' }),
    makeFakeDoc('invoices', 'old_invoice', { databaseId: 'old_shop' }),
  ],
};
const fakeCleanupDb = {
  collection: (collectionName) => ({
    get: async () => {
      const docs = fakeCleanupCollections[collectionName] || [];
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  }),
};
const duplicateDocuments = await cleanupHelpers.findDuplicateDocuments(fakeCleanupDb, 'canonical_shop');
assert.deepEqual(
  duplicateDocuments.map((entry) => `${entry.collection}:${entry.id}`).sort(),
  ['appData:old_shop__main', 'invoices:old_invoice', 'restaurants:old_shop'],
);
assert.equal(cleanupHelpers.summarizeDocuments(duplicateDocuments).totalDocuments, 3);

delete process.env.VERCEL_ENV;
delete process.env.WASTESHIFT_MANAGER_API_SECRET;
process.env.VERCEL_ENV = 'production';
const adminResetProductionMissingSecretHandler = await importAdminResetHandler();
let response;

response = await callHandler(adminResetProductionMissingSecretHandler, {
  method: 'POST',
  body: JSON.stringify({ confirmation: 'RESET' }),
});
assert.equal(response.statusCode, 503);
assert.equal(response.body.code, 'firebase_manager_session_not_configured');
assert.equal(response.headers['cache-control'], 'no-store');

delete process.env.VERCEL_ENV;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

const menuHandler = (await import(`../api/gemini-menu.js?case=${importCounter++}`)).default;
const invoiceHandler = (await import(`../api/gemini-invoice.js?case=${importCounter++}`)).default;
const wastePhotoHandler = await importWastePhotoHandler();
const wasteStockHandler = await importWasteStockHandler();

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

response = await callHandler(wastePhotoHandler, { method: 'GET' });
assert.equal(response.statusCode, 405);

response = await callHandler(wasteStockHandler, { method: 'GET' });
assert.equal(response.statusCode, 405);

response = await callHandler(wasteStockHandler, {
  method: 'POST',
  body: JSON.stringify({ entryId: 'waste_1' }),
});
assert.equal(response.statusCode, 503);
assert.equal(response.body.code, 'firebase_access_not_configured');

response = await callHandler(wastePhotoHandler, {
  method: 'POST',
  body: JSON.stringify({ entryId: 'waste_1', dataUrl: 'data:text/plain;base64,abc' }),
});
assert.equal(response.statusCode, 400);
assert.match(response.body.message, /JPG, PNG, or WEBP/);

process.env.VERCEL_ENV = 'production';
const productionMenuHandler = (await import(`../api/gemini-menu.js?case=${importCounter++}`)).default;
const productionInvoiceHandler = (await import(`../api/gemini-invoice.js?case=${importCounter++}`)).default;

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

delete process.env.VERCEL_ENV;

process.env.WASTESHIFT_MANAGER_API_SECRET = 'manager-api-secret';
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.FIREBASE_ADMIN_PROJECT_ID;
delete process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
delete process.env.FIREBASE_ADMIN_PRIVATE_KEY;

const adminResetHandler = await importAdminResetHandler();
const managerSessionHandler = await importManagerSessionHandler();
const staffSessionHandler = await importStaffSessionHandler();
const staffAccountsHandler = await importStaffAccountsHandler();
const managerBootstrapHandler = await importManagerBootstrapHandler();

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

response = await callHandler(staffSessionHandler, {
  method: 'POST',
  body: JSON.stringify({ staffId: 'staff_nadia', pin: '4826' }),
});
assert.equal(response.statusCode, 503);
assert.equal(response.body.code, 'firebase_access_not_configured');

process.env.VERCEL_ENV = 'production';
response = await callHandler(staffAccountsHandler, {
  method: 'POST',
  body: JSON.stringify({ staff: { id: 'staff_nadia', name: 'Nadia' } }),
});
assert.equal(response.statusCode, 503);
assert.equal(response.body.code, 'firebase_manager_session_not_configured');
delete process.env.VERCEL_ENV;

response = await callHandler(managerBootstrapHandler, {
  method: 'POST',
  body: JSON.stringify({ name: 'Nadia', managerId: 'staff_nadia', pin: '4826' }),
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

globalThis.fetch = originalFetch;
delete process.env.GEMINI_API_KEY;

console.log('API route tests passed');
