import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection,
  getFirestore,
  getDocs,
  limit,
  query,
} from 'firebase/firestore/lite';

const handleSmokeFailure = (error) => {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code || error?.name || 'error',
    message: error?.message || String(error),
    hint: error?.code === 'permission-denied'
      ? 'Paste the latest firestore.rules into Firebase Console or deploy rules, then run this again.'
      : 'Check Firebase env vars, Anonymous Auth, and Firestore availability.',
  }, null, 2));
  process.exit(1);
};

process.on('uncaughtException', handleSmokeFailure);
process.on('unhandledRejection', handleSmokeFailure);

const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
    }),
);

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const missingKeys = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingKeys.length > 0) {
  throw new Error(`Missing Firebase config values: ${missingKeys.join(', ')}`);
}

const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);

await signInAnonymously(auth);
const restaurantSnapshot = await getDocs(query(collection(db, 'restaurants'), limit(10)));
const restaurantData = restaurantSnapshot.docs[0]?.data() || null;
let databaseId = String(restaurantData?.databaseId || restaurantSnapshot.docs[0]?.id || '').trim();
const productionBaseUrl = String(process.env.WASTESHIFT_SMOKE_BASE_URL || '').trim().replace(/\/$/, '');
let directoryCheck = { checked: false, readable: false, accountCount: 0, managerCount: 0 };
let canonicalShopCheck = { checked: false, selected: false, completedProfileCount: 0 };

if (productionBaseUrl && databaseId) {
  const idToken = await auth.currentUser.getIdToken();
  const commonHeaders = {
    'x-wasteshift-database-id': databaseId,
    'x-wasteshift-firebase-token': idToken,
  };
  const shopResponse = await fetch(`${productionBaseUrl}/api/staff-session?action=restaurant`, {
    cache: 'no-store',
    headers: commonHeaders,
  });
  const shopPayload = await shopResponse.json().catch(() => ({}));

  if (!shopResponse.ok || shopPayload?.ok === false || !shopPayload?.restaurant?.databaseId) {
    throw new Error(shopPayload?.message || `Canonical shop lookup returned HTTP ${shopResponse.status}.`);
  }

  databaseId = String(shopPayload.restaurant.databaseId).trim();
  canonicalShopCheck = {
    checked: true,
    selected: Boolean(databaseId),
    completedProfileCount: Number(shopPayload.completedProfileCount) || 0,
  };
  const response = await fetch(`${productionBaseUrl}/api/staff-session?action=directory`, {
    cache: 'no-store',
    headers: {
      'x-wasteshift-database-id': databaseId,
      'x-wasteshift-firebase-token': idToken,
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Production staff directory returned HTTP ${response.status}.`);
  }

  const accounts = Array.isArray(payload.staff) ? payload.staff : [];
  directoryCheck = {
    checked: true,
    readable: true,
    accountCount: accounts.length,
    managerCount: accounts.filter((account) => account?.roleKey === 'manager' || account?.roleKey === 'owner').length,
    credentialsExposed: accounts.some((account) => account?.staffCode || account?.managerPin),
  };
}

console.log(JSON.stringify({
  ok: true,
  projectId: config.projectId,
  anonymousAuth: Boolean(auth.currentUser?.uid),
  restaurantDiscoveryReadable: true,
  completedRestaurantFound: !restaurantSnapshot.empty,
  completedRestaurantDocumentsRead: restaurantSnapshot.size,
  canonicalShop: canonicalShopCheck,
  productionDirectory: directoryCheck,
  writesPerformed: false,
}, null, 2));

process.exit(0);
