import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const databaseApi = await readFile(new URL('../api/database.js', import.meta.url), 'utf8');
const adminResetApi = await readFile(new URL('../api/admin-reset.js', import.meta.url), 'utf8');
const firestoreMenuItems = await readFile(new URL('../src/services/firestoreMenuItems.js', import.meta.url), 'utf8');
const invoiceFirestore = await readFile(new URL('../src/services/invoiceFirestore.js', import.meta.url), 'utf8');
const apiHeaders = await readFile(new URL('../src/utils/apiHeaders.js', import.meta.url), 'utf8');
const clientDatabaseId = await readFile(new URL('../src/utils/clientDatabaseId.js', import.meta.url), 'utf8');

assert.match(databaseApi, /x-wasteshift-database-id/, 'Fallback database API must require a client database id.');
assert.match(databaseApi, /createDatabaseFolderPrefix/, 'Fallback database snapshots must be stored below a scoped folder.');
assert.doesNotMatch(databaseApi, /list\(\{ prefix: DATABASE_FOLDER/, 'Fallback database reads must not list one shared global database folder.');
assert.match(adminResetApi, /cache-control', 'no-store'/, 'Admin reset API responses must not be cacheable.');

assert.match(clientDatabaseId, /wasteShiftClientDatabaseId/, 'Client should persist one generated database id per browser install.');
assert.match(clientDatabaseId, /restaurant/, 'Client should support a restaurant share URL for additional devices.');
assert.match(clientDatabaseId, /setClientDatabaseId/, 'Client should allow a pasted restaurant code to select the shared database.');
assert.match(apiHeaders, /getClientDatabaseHeaders/, 'Protected API calls must include the client database scope header.');

for (const [name, source] of [
  ['firestoreMenuItems', firestoreMenuItems],
  ['invoiceFirestore', invoiceFirestore],
]) {
  assert.doesNotMatch(source, /anonymousAuthPromise/, `${name} must not cache a resolved anonymous user promise.`);
  assert.match(source, /browserSessionPersistence/, `${name} should use session-scoped Firebase auth persistence.`);
  assert.match(source, /setPersistence/, `${name} should set Firebase auth persistence before anonymous sign-in.`);
  assert.match(source, /databaseId/, `${name} should tag Firestore records with a database id.`);
}

assert.match(firestoreMenuItems, /where\('databaseId', '==', getActiveDatabaseId\(\)\)/, 'Main Firestore reads must be scoped by database id.');
assert.match(invoiceFirestore, /where\('databaseId', '==', getActiveDatabaseId\(\)\)/, 'Invoice Firestore reads must be scoped by database id.');
assert.match(invoiceFirestore, /scopeDocId/, 'Invoice Firestore writes must use scoped document ids to avoid id collisions.');

console.log('session isolation tests passed');
