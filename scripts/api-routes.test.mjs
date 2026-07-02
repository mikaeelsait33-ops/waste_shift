import assert from 'node:assert/strict';

let importCounter = 0;

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

delete process.env.WASTESHIFT_SYNC_SECRET;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

const menuHandler = (await import(`../api/gemini-menu.js?case=${importCounter++}`)).default;
const invoiceHandler = (await import(`../api/gemini-invoice.js?case=${importCounter++}`)).default;

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

console.log('API route tests passed');
