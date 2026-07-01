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
let firebaseAppInstance = null;
let anonymousAuthPromise = null;
let firestoreApiPromise = null;
let firebaseAuthPromise = null;

const getFirestoreApi = async () => {
  if (!firestoreApiPromise) {
    firestoreApiPromise = Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
    ]).then(([firebaseApp, firestore]) => ({
      initializeApp: firebaseApp.initializeApp,
      getApps: firebaseApp.getApps,
      collection: firestore.collection,
      doc: firestore.doc,
      getDoc: firestore.getDoc,
      getDocs: firestore.getDocs,
      getFirestore: firestore.getFirestore,
      serverTimestamp: firestore.serverTimestamp,
      setDoc: firestore.setDoc,
    }));
  }

  return firestoreApiPromise;
};

const getFirebaseAuthApi = async () => {
  if (!firebaseAuthPromise) {
    firebaseAuthPromise = import('firebase/auth').then((auth) => ({
      getAuth: auth.getAuth,
      signInAnonymously: auth.signInAnonymously,
    }));
  }

  return firebaseAuthPromise;
};

export const firestoreIsConfigured = () => hasFirebaseConfig;

export const getFirestoreRuntimeInfo = () => ({
  configured: hasFirebaseConfig,
  projectId: FIREBASE_CONFIG.projectId || '',
});

export const getFirestoreDb = async () => {
  if (!hasFirebaseConfig) {
    return null;
  }

  if (firestoreInstance) {
    return firestoreInstance;
  }

  const { getApps, initializeApp, getFirestore } = await getFirestoreApi();
  firebaseAppInstance = getApps().length > 0 ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  firestoreInstance = getFirestore(firebaseAppInstance);
  return firestoreInstance;
};

export const ensureFirebaseAuth = async () => {
  if (!hasFirebaseConfig) {
    return null;
  }

  if (anonymousAuthPromise) {
    return anonymousAuthPromise;
  }

  anonymousAuthPromise = (async () => {
    await getFirestoreDb();
    const { getAuth, signInAnonymously } = await getFirebaseAuthApi();
    const auth = getAuth(firebaseAppInstance);

    if (auth.currentUser) {
      return auth.currentUser;
    }

    const credential = await signInAnonymously(auth);
    return credential.user;
  })();

  return anonymousAuthPromise;
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

const toSafeString = (value) => String(value ?? '').trim();

const toSafeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toSafeCurrency = (value, fallback = 0) => roundCurrency(toSafeNumber(value, fallback));

const removeUndefinedValues = (value) => {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedValues);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, removeUndefinedValues(entryValue)])
    );
  }

  return value;
};

const sanitizeWasteComponent = (component, index) => {
  const name = toSafeString(component?.name);

  if (!name) {
    return null;
  }

  return {
    key: toSafeString(component?.key) || createItemPriceKey(`${name}-${index}`),
    name,
    cost: toSafeCurrency(component?.cost),
  };
};

const stripLargeLocalFields = (entry) => {
  const photoUrl = toSafeString(entry?.photoUrl);

  if (!photoUrl.startsWith('data:image/')) {
    return entry;
  }

  return {
    ...entry,
    photoUrl: '',
    photoCapturedAt: '',
    hasPhoto: true,
  };
};

const createFirestoreAppDataPayload = (databaseData) => {
  const data = databaseData && typeof databaseData === 'object' ? databaseData : {};

  return removeUndefinedValues({
    ...data,
    wasteItems: Array.isArray(data.wasteItems)
      ? data.wasteItems.map(stripLargeLocalFields)
      : [],
  });
};

const createFirestoreWasteEntryPayload = (entry) => {
  const createdAt = toSafeString(entry?.createdAt) || new Date().toISOString();
  const wastedComponents = (Array.isArray(entry?.wastedComponents) ? entry.wastedComponents : [])
    .map(sanitizeWasteComponent)
    .filter(Boolean);
  const selectedComponentKeys = Array.isArray(entry?.selectedComponentKeys)
    ? entry.selectedComponentKeys.map(toSafeString).filter(Boolean)
    : wastedComponents.map((component) => component.key);

  return removeUndefinedValues({
    localEntryId: toSafeString(entry?.id),
    name: toSafeString(entry?.name),
    itemType: toSafeString(entry?.itemType),
    recipeKey: toSafeString(entry?.recipeKey),
    category: toSafeString(entry?.category),
    quantity: toSafeNumber(entry?.quantity, 1),
    unit: toSafeString(entry?.unit),
    measuredQuantity: toSafeString(entry?.measuredQuantity),
    measuredUnit: toSafeString(entry?.measuredUnit),
    portionSize: toSafeString(entry?.portionSize),
    portionSizeUnit: toSafeString(entry?.portionSizeUnit),
    reason: toSafeString(entry?.reason),
    notes: toSafeString(entry?.notes),
    wasteClassification: toSafeString(entry?.wasteClassification),
    wasteClassificationLabel: toSafeString(entry?.wasteClassificationLabel),
    staffId: toSafeString(entry?.staffId),
    staff: toSafeString(entry?.staff),
    staffRole: toSafeString(entry?.staffRole),
    department: toSafeString(entry?.department),
    date: toSafeString(entry?.date),
    time: toSafeString(entry?.time),
    timestamp: createdAt,
    createdAt,
    createdBy: toSafeString(entry?.createdBy),
    lastEditedBy: toSafeString(entry?.lastEditedBy),
    status: toSafeString(entry?.status) || 'logged',
    cost: toSafeCurrency(entry?.cost ?? entry?.foodCostLost),
    foodCostLost: toSafeCurrency(entry?.foodCostLost ?? entry?.cost),
    sellingPrice: entry?.sellingPrice === null || entry?.sellingPrice === undefined
      ? null
      : toSafeCurrency(entry.sellingPrice),
    potentialRevenueLost: toSafeCurrency(entry?.potentialRevenueLost),
    grossProfitLost: toSafeCurrency(entry?.grossProfitLost),
    foodCostPercentage: entry?.foodCostPercentage === null || entry?.foodCostPercentage === undefined
      ? null
      : toSafeNumber(entry.foodCostPercentage),
    costStatus: toSafeString(entry?.costStatus),
    partialWaste: Boolean(entry?.partialWaste),
    allComponentsSelected: Boolean(entry?.allComponentsSelected),
    totalComponentCount: toSafeNumber(entry?.totalComponentCount),
    wastedComponentCount: toSafeNumber(entry?.wastedComponentCount),
    totalMenuItemCost: toSafeCurrency(entry?.totalMenuItemCost),
    selectedComponentKeys,
    componentsWasted: Array.isArray(entry?.componentsWasted)
      ? entry.componentsWasted.map(toSafeString).filter(Boolean)
      : wastedComponents.map((component) => component.name),
    wastedComponents,
    hasPhoto: Boolean(entry?.photoUrl),
    photoName: toSafeString(entry?.photoName),
    photoCapturedAt: toSafeString(entry?.photoCapturedAt),
  });
};

const normalizeFirestoreWasteEntry = (docSnapshot) => {
  const data = docSnapshot.data();

  return removeUndefinedValues({
    ...data,
    id: toSafeString(data?.localEntryId) || docSnapshot.id,
    name: toSafeString(data?.name),
    quantity: toSafeNumber(data?.quantity, 1),
    cost: toSafeCurrency(data?.cost ?? data?.foodCostLost),
    foodCostLost: toSafeCurrency(data?.foodCostLost ?? data?.cost),
    photoUrl: '',
    photoName: toSafeString(data?.photoName),
    photoCapturedAt: toSafeString(data?.photoCapturedAt),
  });
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

  await ensureFirebaseAuth();
  const { collection, getDocs } = await getFirestoreApi();
  const snapshot = await getDocs(collection(db, 'menuItems'));
  return snapshot.docs.map(normalizeFirestoreMenuItem).filter(Boolean);
};

export const loadFirestoreWasteEntries = async () => {
  const db = await getFirestoreDb();

  if (!db) {
    return [];
  }

  await ensureFirebaseAuth();
  const { collection, getDocs } = await getFirestoreApi();
  const snapshot = await getDocs(collection(db, 'wasteEntries'));
  return snapshot.docs
    .map(normalizeFirestoreWasteEntry)
    .filter((entry) => entry.name && entry.reason)
    .sort((a, b) => new Date(a.createdAt || a.timestamp || 0).getTime() - new Date(b.createdAt || b.timestamp || 0).getTime());
};

export const loadFirestoreDatabaseSnapshot = async () => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, getDoc } = await getFirestoreApi();
  const snapshot = await getDoc(doc(db, 'appData', 'main'));

  if (!snapshot.exists()) {
    return { ok: true, exists: false, data: null, updatedAt: '' };
  }

  const snapshotData = snapshot.data();

  return {
    ok: true,
    exists: true,
    data: snapshotData?.data || {},
    updatedAt: toSafeString(snapshotData?.updatedAtClient || snapshotData?.exportedAt),
  };
};

export const saveFirestoreDatabaseSnapshot = async (databaseData) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  const safeData = createFirestoreAppDataPayload(databaseData);
  const exportedAt = new Date().toISOString();

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  await setDoc(doc(db, 'appData', 'main'), {
    data: safeData,
    exportedAt,
    updatedAtClient: exportedAt,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await Promise.all((Array.isArray(databaseData?.wasteItems) ? databaseData.wasteItems : [])
    .map((entry) => saveFirestoreWasteEntry(entry).catch((error) => {
      console.warn('Could not sync waste entry while saving Firebase database snapshot.', error);
      return null;
    })));

  return { ok: true, updatedAt: exportedAt };
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

  await ensureFirebaseAuth();
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
  const safeEntryId = toSafeString(entry?.id);

  if (!db || !safeEntryId) {
    return { ok: false, skipped: true };
  }

  const payload = createFirestoreWasteEntryPayload(entry);

  if (!payload.name || !payload.reason) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  await setDoc(doc(db, 'wasteEntries', safeEntryId), {
    ...payload,
    firestoreSavedAt: serverTimestamp(),
  }, { merge: true });

  return { ok: true, id: safeEntryId };
};
