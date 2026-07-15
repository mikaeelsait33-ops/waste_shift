import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const databaseApi = await readFile(new URL('../api/database.js', import.meta.url), 'utf8');
const adminResetApi = await readFile(new URL('../api/admin-reset.js', import.meta.url), 'utf8');
const firestoreMenuItems = await readFile(new URL('../src/services/firestoreMenuItems.js', import.meta.url), 'utf8');
const invoiceFirestore = await readFile(new URL('../src/services/invoiceFirestore.js', import.meta.url), 'utf8');
const apiHeaders = await readFile(new URL('../src/utils/apiHeaders.js', import.meta.url), 'utf8');
const clientDatabaseId = await readFile(new URL('../src/utils/clientDatabaseId.js', import.meta.url), 'utf8');
const restaurantFirestore = await readFile(new URL('../src/services/restaurantFirestore.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

assert.match(databaseApi, /x-wasteshift-database-id/, 'Fallback database API must require a client database id.');
assert.match(databaseApi, /createDatabaseFolderPrefix/, 'Fallback database snapshots must be stored below a scoped folder.');
assert.doesNotMatch(databaseApi, /list\(\{ prefix: DATABASE_FOLDER/, 'Fallback database reads must not list one shared global database folder.');
assert.match(adminResetApi, /cache-control', 'no-store'/, 'Admin reset API responses must not be cacheable.');

assert.match(clientDatabaseId, /wasteShiftClientDatabaseId/, 'Client should persist one generated database id per browser install.');
assert.doesNotMatch(clientDatabaseId, /getClientDatabaseShareUrl/, 'Single-shop mode must not expose a restaurant sharing link.');
assert.doesNotMatch(clientDatabaseId, /setClientDatabaseId/, 'Single-shop mode must not allow switching the active restaurant database.');
assert.doesNotMatch(clientDatabaseId, /keepDatabaseIdInUrl/, 'Single-shop mode must not put internal database identifiers in the URL.');
assert.match(clientDatabaseId, /removeLegacyDatabaseQuery/, 'Single-shop mode should clean old restaurant-sharing URLs after loading.');
assert.match(apiHeaders, /getClientDatabaseHeaders/, 'Protected API calls must include the client database scope header.');
assert.match(restaurantFirestore, /wasteShiftRestaurantProfiles/, 'Completed restaurant profiles should have a local reload fallback.');
assert.match(appSource, /loadPersistedAuthSession/, 'App should restore a remembered local login.');

for (const [name, source] of [
  ['firestoreMenuItems', firestoreMenuItems],
  ['invoiceFirestore', invoiceFirestore],
]) {
  assert.doesNotMatch(source, /anonymousAuthPromise/, `${name} must not cache a resolved anonymous user promise.`);
  assert.match(source, /browserLocalPersistence/, `${name} should keep Firebase auth across browser restarts.`);
  assert.match(source, /authStateReady/, `${name} should wait for a restored Firebase user before signing in again.`);
  assert.match(source, /setPersistence/, `${name} should set Firebase auth persistence before anonymous sign-in.`);
  assert.match(source, /databaseId/, `${name} should tag Firestore records with a database id.`);
}

assert.match(firestoreMenuItems, /where\('databaseId', '==', getActiveDatabaseId\(\)\)/, 'Main Firestore reads must be scoped by database id.');
assert.match(invoiceFirestore, /where\('databaseId', '==', getActiveDatabaseId\(\)\)/, 'Invoice Firestore reads must be scoped by database id.');
assert.match(invoiceFirestore, /scopeDocId/, 'Invoice Firestore writes must use scoped document ids to avoid id collisions.');

console.log('session isolation tests passed');
