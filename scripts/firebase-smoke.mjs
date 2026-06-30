import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

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

const menuItemRef = doc(db, 'menuItems', 'salmon_benedict');
await setDoc(menuItemRef, {
  key: 'salmon_benedict',
  name: 'Salmon Benedict',
  totalCost: 85,
  components: [
    { key: 'salmon', name: 'Salmon', cost: 45 },
    { key: 'english_muffin', name: 'English Muffin', cost: 8 },
    { key: 'hollandaise', name: 'Hollandaise', cost: 12 },
    { key: 'poached_egg', name: 'Poached Egg', cost: 10 },
  ],
  updatedAt: serverTimestamp(),
}, { merge: true });

const snapshot = await getDoc(menuItemRef);
const data = snapshot.data();
const now = new Date().toISOString();
const wasteEntryRef = doc(db, 'wasteEntries', 'firebase_smoke_partial_waste');
const wasteEntry = {
  localEntryId: 'firebase_smoke_partial_waste',
  name: 'Salmon Benedict',
  itemType: 'menuItem',
  recipeKey: 'salmon_benedict',
  quantity: 1,
  unit: 'portion',
  reason: 'Smoke test',
  notes: '',
  staff: 'Firebase smoke test',
  date: now.slice(0, 10),
  time: now.slice(11, 16),
  timestamp: now,
  createdAt: now,
  createdBy: 'Firebase smoke test',
  status: 'logged',
  cost: 45,
  foodCostLost: 45,
  partialWaste: true,
  allComponentsSelected: false,
  totalComponentCount: 4,
  wastedComponentCount: 1,
  totalMenuItemCost: 85,
  selectedComponentKeys: ['salmon'],
  componentsWasted: ['Salmon'],
  wastedComponents: [{ key: 'salmon', name: 'Salmon', cost: 45 }],
  hasPhoto: false,
  firestoreSavedAt: serverTimestamp(),
};

await setDoc(wasteEntryRef, wasteEntry, { merge: true });
await setDoc(wasteEntryRef, {
  ...wasteEntry,
  notes: 'Idempotent update verified',
  firestoreSavedAt: serverTimestamp(),
}, { merge: true });

const wasteSnapshot = await getDoc(wasteEntryRef);
const wasteData = wasteSnapshot.data();
const invoiceConfigRef = doc(db, 'settings', 'invoiceConfig');
await setDoc(invoiceConfigRef, {
  vatRate: 0.15,
  updatedAt: serverTimestamp(),
}, { merge: true });

const ingredientRef = doc(db, 'ingredients', 'smoke_salmon');
await setDoc(ingredientRef, {
  id: 'smoke_salmon',
  name: 'Smoke Salmon',
  category: 'Meat',
  unit: 'g',
  parLevel: 5000,
  reorderPoint: 1500,
  preferredSupplier: 'Firebase smoke test',
  lastPriceExVAT: 45,
  lastPriceIncVAT: 51.75,
  updatedAt: serverTimestamp(),
}, { merge: true });

await setDoc(doc(db, 'ingredients', 'smoke_salmon', 'priceHistory', 'firebase_smoke_invoice'), {
  date: now.slice(0, 10),
  supplier: 'Firebase smoke test',
  priceExVAT: 45,
  priceIncVAT: 51.75,
  invoiceId: 'firebase_smoke_invoice',
  createdAt: serverTimestamp(),
}, { merge: true });

await setDoc(doc(db, 'suppliers', 'firebase_smoke_test'), {
  id: 'firebase_smoke_test',
  name: 'Firebase smoke test',
  lastInvoiceDate: now.slice(0, 10),
  totalSpend: 45,
  ingredientCount: 1,
  updatedAt: serverTimestamp(),
}, { merge: true });

await setDoc(doc(db, 'invoices', 'firebase_smoke_invoice'), {
  id: 'firebase_smoke_invoice',
  invoiceDate: now.slice(0, 10),
  supplier: 'Firebase smoke test',
  supplierId: 'firebase_smoke_test',
  totalExVAT: 45,
  totalVAT: 6.75,
  totalIncVAT: 51.75,
  lineItems: [{
    id: 'firebase_smoke_partial_waste',
    itemName: 'Smoke Salmon',
    quantity: 1,
    unit: 'kg',
    priceExVAT: 45,
    priceIncVAT: 51.75,
  }],
  scannedAt: now,
  status: 'confirmed',
  vatRate: 0.15,
  vatMode: 'exclusive',
  updatedAt: serverTimestamp(),
}, { merge: true });

await setDoc(doc(db, 'stockLevels', 'smoke_salmon'), {
  ingredientId: 'smoke_salmon',
  currentQty: 1000,
  unit: 'g',
  lastUpdated: serverTimestamp(),
  lastInvoiceId: 'firebase_smoke_invoice',
  status: 'ok',
  parLevel: 5000,
  reorderPoint: 1500,
}, { merge: true });

const deleteIngredientRef = doc(db, 'ingredients', 'firebase_smoke_delete_me');
const deleteHistoryRef = doc(db, 'ingredients', 'firebase_smoke_delete_me', 'priceHistory', 'firebase_smoke_delete_invoice');
const deleteStockRef = doc(db, 'stockLevels', 'firebase_smoke_delete_me');

await setDoc(deleteIngredientRef, {
  id: 'firebase_smoke_delete_me',
  name: 'Firebase Smoke Delete Me',
  category: 'Other',
  unit: 'each',
  updatedAt: serverTimestamp(),
}, { merge: true });
await setDoc(deleteHistoryRef, {
  date: now.slice(0, 10),
  supplier: 'Firebase smoke test',
  priceExVAT: 1,
  priceIncVAT: 1,
  invoiceId: 'firebase_smoke_delete_invoice',
  createdAt: serverTimestamp(),
}, { merge: true });
await setDoc(deleteStockRef, {
  ingredientId: 'firebase_smoke_delete_me',
  currentQty: 1,
  unit: 'each',
  lastUpdated: serverTimestamp(),
}, { merge: true });
await setDoc(deleteIngredientRef, {
  id: 'firebase_smoke_delete_me',
  name: 'Firebase Smoke Delete Me',
  category: 'Other',
  unit: 'each',
  isDeleted: true,
  deletedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}, { merge: true });

const invoiceSnapshot = await getDoc(doc(db, 'invoices', 'firebase_smoke_invoice'));
const stockSnapshot = await getDoc(doc(db, 'stockLevels', 'smoke_salmon'));
const deletedIngredientSnapshot = await getDoc(deleteIngredientRef);

console.log(JSON.stringify({
  menuItem: {
    ok: snapshot.exists(),
    item: data?.name,
    totalCost: data?.totalCost,
    components: Array.isArray(data?.components)
      ? data.components.map((component) => component.name)
      : [],
  },
  wasteEntry: {
    ok: wasteSnapshot.exists(),
    id: wasteData?.localEntryId,
    item: wasteData?.name,
    foodCostLost: wasteData?.foodCostLost,
    componentsWasted: wasteData?.componentsWasted || [],
    notes: wasteData?.notes || '',
  },
  invoiceModule: {
    invoiceSaved: invoiceSnapshot.exists(),
    stockSaved: stockSnapshot.exists(),
    ingredient: 'Smoke Salmon',
    rawIngredientDeleteVerified: deletedIngredientSnapshot.data()?.isDeleted === true,
  },
}, null, 2));

process.exit(0);
