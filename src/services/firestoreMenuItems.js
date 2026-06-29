import { createItemPriceKey } from '../utils/itemPriceCatalog';
import { roundCurrency } from '../utils/wasteCalculations';

const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Boolean(
  FIREBASE_CONFIG.apiKey
  && FIREBASE_CONFIG.projectId
  && FIREBASE_CONFIG.appId
);

let firestoreInstance = null;
let firestoreApiPromise = null;

const getFirestoreApi = async () => {
  if (!firestoreApiPromise) {
    firestoreApiPromise = Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
    ]).then(([firebaseApp, firestore]) => ({
      initializeApp: firebaseApp.initializeApp,
      getApps: firebaseApp.getApps,
      addDoc: firestore.addDoc,
      collection: firestore.collection,
      doc: firestore.doc,
      getDocs: firestore.getDocs,
      getFirestore: firestore.getFirestore,
      serverTimestamp: firestore.serverTimestamp,
      setDoc: firestore.setDoc,
    }));
  }

  return firestoreApiPromise;
};

export const firestoreIsConfigured = () => hasFirebaseConfig;

export const getFirestoreDb = async () => {
  if (!hasFirebaseConfig) {
    return null;
  }

  if (firestoreInstance) {
    return firestoreInstance;
  }

  const { getApps, initializeApp, getFirestore } = await getFirestoreApi();
  const app = getApps().length > 0 ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  firestoreInstance = getFirestore(app);
  return firestoreInstance;
};

const sanitizeComponent = (component, index) => {
  const name = String(component?.name || '').trim();
  const cost = Number.parseFloat(component?.cost);

  if (!name) {
    return null;
  }

  return {
    key: component?.key || createItemPriceKey(`${name}-${index}`),
    name,
    cost: Number.isFinite(cost) && cost >= 0 ? roundCurrency(cost) : 0,
  };
};

export const normalizeFirestoreMenuItem = (docSnapshot) => {
  const data = docSnapshot.data();
  const name = String(data?.name || '').trim();
  const key = data?.key || docSnapshot.id || createItemPriceKey(name);

  if (!name || !key) {
    return null;
  }

  const components = (Array.isArray(data?.components) ? data.components : [])
    .map(sanitizeComponent)
    .filter(Boolean);
  const totalCost = Number.isFinite(Number(data?.totalCost))
    ? roundCurrency(Number(data.totalCost))
    : roundCurrency(components.reduce((sum, component) => sum + component.cost, 0));
  const menuPrice = Number.isFinite(Number(data?.menuPrice)) ? roundCurrency(Number(data.menuPrice)) : null;

  return {
    key,
    firestoreId: docSnapshot.id,
    name,
    menuPrice,
    totalCost,
    components,
  };
};

export const loadFirestoreMenuItems = async () => {
  const db = await getFirestoreDb();

  if (!db) {
    return [];
  }

  const { collection, getDocs } = await getFirestoreApi();
  const snapshot = await getDocs(collection(db, 'menuItems'));
  return snapshot.docs.map(normalizeFirestoreMenuItem).filter(Boolean);
};

export const saveFirestoreMenuItem = async ({ key, name, totalCost, menuPrice = null, components }) => {
  const db = await getFirestoreDb();
  const safeName = String(name || '').trim();
  const safeKey = key || createItemPriceKey(safeName);

  if (!db || !safeKey || !safeName) {
    return { ok: false, skipped: true };
  }

  const safeComponents = (Array.isArray(components) ? components : [])
    .map(sanitizeComponent)
    .filter(Boolean);
  const resolvedTotalCost = Number.isFinite(Number(totalCost))
    ? roundCurrency(Number(totalCost))
    : roundCurrency(safeComponents.reduce((sum, component) => sum + component.cost, 0));

  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  await setDoc(doc(db, 'menuItems', safeKey), {
    key: safeKey,
    name: safeName,
    totalCost: resolvedTotalCost,
    ...(menuPrice !== null && menuPrice !== undefined ? { menuPrice: roundCurrency(Number(menuPrice) || 0) } : {}),
    components: safeComponents,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { ok: true };
};

export const saveFirestoreWasteEntry = async (entry) => {
  const db = await getFirestoreDb();

  if (!db || !entry?.id) {
    return { ok: false, skipped: true };
  }

  const { addDoc, collection, serverTimestamp } = await getFirestoreApi();
  await addDoc(collection(db, 'wasteEntries'), {
    ...entry,
    firestoreSavedAt: serverTimestamp(),
  });

  return { ok: true };
};
