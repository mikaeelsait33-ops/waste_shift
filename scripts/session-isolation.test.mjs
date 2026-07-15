import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const databaseApi = await readFile(new URL('../api/database.js', import.meta.url), 'utf8');
const adminResetApi = await readFile(new URL('../api/admin-reset.js', import.meta.url), 'utf8');
const firestoreMenuItems = await readFile(new URL('../src/services/firestoreMenuItems.js', import.meta.url), 'utf8');
const invoiceFirestore = await readFile(new URL('../src/services/invoiceFirestore.js', import.meta.url), 'utf8');
const apiHeaders = await readFile(new URL('../src/utils/apiHeaders.js', import.meta.url), 'utf8');
const clientDatabaseId = await readFile(new URL('../src/utils/clientDatabaseId.js', import.meta.url), 'utf8');
const restaurantFirestore = await readFile(new URL('../src/services/restaurantFirestore.js', import.meta.url), 'utf8');
const managerSessionService = await readFile(new URL('../src/services/managerSession.js', import.meta.url), 'utf8');
const managerSessionApi = await readFile(new URL('../api/manager-session.js', import.meta.url), 'utf8');
const staffSessionApi = await readFile(new URL('../api/staff-session.js', import.meta.url), 'utf8');
const accessSessionApi = await readFile(new URL('../api/_accessSession.js', import.meta.url), 'utf8');
const loginThrottleApi = await readFile(new URL('../api/_loginThrottle.js', import.meta.url), 'utf8');
const managerRecoveryApi = await readFile(new URL('../api/manager-recovery.js', import.meta.url), 'utf8');
const staffSessionService = await readFile(new URL('../src/services/staffSession.js', import.meta.url), 'utf8');
const restaurantAccessHook = await readFile(new URL('../src/hooks/useRestaurantAccess.js', import.meta.url), 'utf8');
const firestoreRules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
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
assert.match(clientDatabaseId, /persistClientDatabaseId/, 'Single-shop mode should be able to remember the one existing shop on a new device.');
assert.match(apiHeaders, /getClientDatabaseHeaders/, 'Protected API calls must include the client database scope header.');
assert.match(restaurantFirestore, /wasteShiftRestaurantProfiles/, 'Completed restaurant profiles should have a local reload fallback.');
assert.match(restaurantFirestore, /where\('setupCompleted', '==', true\)/, 'A new device should discover the one completed shop in Firestore.');
assert.match(restaurantFirestore, /limit\(2\)/, 'Automatic shop discovery must stop when more than one completed shop exists.');
assert.match(appSource, /didAdoptSingleShop/, 'The app should restart its initial data loaders after a new device joins the one shop.');
assert.match(appSource, /loadPersistedAuthSession/, 'App should restore a remembered local login.');
assert.doesNotMatch(appSource, /localStorage\.setItem\('wasteShiftSyncAccessKey'/, 'Sync secrets must not persist in browser storage.');
assert.match(managerSessionService, /method: 'DELETE'/, 'Client logout must revoke the server manager session.');
assert.match(managerSessionApi, /request\.method === 'DELETE'/, 'Manager session API must support explicit revocation.');
assert.match(managerSessionApi, /managerSessions.*\.delete\(\)/s, 'Manager session revocation must delete the matching server session.');
assert.match(managerSessionApi, /createAccessSession/, 'Manager login must create the Firestore authorization session.');
assert.match(staffSessionApi, /verifyPinRecord\(pin, staff\.staffCode\)/, 'Staff PINs must be verified by the server.');
assert.match(staffSessionApi, /createAccessSession/, 'Staff login must create the Firestore authorization session.');
assert.match(staffSessionApi, /loadManagerDirectory/, 'A fresh device must receive safe manager identities for login.');
assert.match(staffSessionApi, /migrateSingleShopLegacyAccess/, 'Single-shop mode must migrate legacy access records into the discovered restaurant scope.');
assert.match(staffSessionApi, /applyLegacySharedPins/, 'Legacy shared PIN settings must migrate into server-only person accounts.');
assert.match(staffSessionApi, /managerPin:\s*_managerPin/, 'The login directory must strip manager PIN records.');
assert.match(accessSessionApi, /expiresAtTimestamp/, 'Restaurant access sessions must store a rule-compatible expiry timestamp.');
assert.match(managerSessionApi, /checkPinAttemptAllowed/, 'Manager PIN verification must enforce login throttling.');
assert.match(staffSessionApi, /checkPinAttemptAllowed/, 'Staff PIN verification must enforce login throttling.');
assert.match(loginThrottleApi, /runTransaction/, 'PIN failure counters must update atomically across serverless instances.');
assert.match(managerRecoveryApi, /WASTESHIFT_RECOVERY_SECRET/, 'Legacy manager recovery must require a server-only secret.');
assert.match(managerRecoveryApi, /activeManagerExists/, 'Legacy manager recovery must close after the first active manager exists.');
assert.match(staffSessionService, /getAutomaticManagerApiHeaders/, 'Access requests must use authenticated API headers.');
assert.match(apiHeaders, /x-wasteshift-firebase-token/, 'Authenticated API headers must carry a Firebase identity token.');
assert.match(restaurantAccessHook, /serverRole === localRole/, 'Remembered browser roles must match the server-issued access role.');
assert.match(restaurantAccessHook, /serverSession\.staffId.*authSession\.staffId/, 'Remembered staff identities must match the server-issued access session.');
assert.match(firestoreRules, /function hasManagerAccess/, 'Firestore rules must enforce manager access centrally.');
assert.match(firestoreRules, /match \/accessSessions\/\{sessionId\}[\s\S]*allow read, write: if false;/, 'Client code must never read or write access-session documents directly.');
assert.match(firestoreRules, /match \/staffAccounts\/\{staffId\}[\s\S]*allow read, write: if false;/, 'Client code must never read staff PIN records directly.');
assert.match(firestoreRules, /match \/loginAttempts\/\{attemptId\}[\s\S]*allow read, write: if false;/, 'Client code must never read or alter PIN lockout records.');
assert.match(firestoreRules, /match \/appData\/\{snapshotId\}[\s\S]*hasManagerAccess/, 'Shared financial snapshots must require a server-verified manager session.');

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
assert.match(firestoreMenuItems, /wasteItems:\s*\[\]/, 'Waste history must not be embedded in the shared Firestore snapshot.');
assert.match(firestoreMenuItems, /staffPin:\s*null/, 'Legacy staff PINs must be removed from shared Firestore snapshots.');
assert.match(firestoreMenuItems, /managementPin:\s*null/, 'Legacy manager PINs must be removed from shared Firestore snapshots.');
assert.match(firestoreMenuItems, /orderBy\('createdAt', 'desc'\)/, 'Waste history must be ordered by Firestore.');
assert.match(firestoreMenuItems, /limit\(pageSize\)/, 'Waste history must be bounded by a Firestore query limit.');
assert.match(firestoreMenuItems, /startAfter\(options\.cursor\)/, 'Waste history must continue from a Firestore cursor.');
assert.match(invoiceFirestore, /where\('databaseId', '==', getActiveDatabaseId\(\)\)/, 'Invoice Firestore reads must be scoped by database id.');
assert.match(invoiceFirestore, /startAfter\(options\.cursor\)/, 'Invoice and stock history must support Firestore cursor pagination.');
assert.match(invoiceFirestore, /scopeDocId/, 'Invoice Firestore writes must use scoped document ids to avoid id collisions.');
assert.match(invoiceFirestore, /where: firestore\.where/, 'Firestore query helpers must expose where at runtime.');
assert.match(invoiceFirestore, /runTransaction: firestore\.runTransaction/, 'Invoice stock posting must expose Firestore transactions.');
assert.match(invoiceFirestore, /return runTransaction\(db/, 'Invoice stock posting must be atomic.');
assert.doesNotMatch(invoiceFirestore, /deleteDoc\(ingredientRef/, 'Ingredient deletion must preserve the audit record.');
assert.doesNotMatch(invoiceFirestore, /nestedDocsToDelete\.map\(\(docSnapshot\) => deleteDoc/, 'Invoice price history must be archived instead of hard deleted.');

console.log('session isolation tests passed');
