import { createItemPriceKey, normalizeRecipeIngredient } from '../utils/itemPriceCatalog';
import { roundCurrency } from '../utils/wasteCalculations';
import { getClientDatabaseId } from '../utils/clientDatabaseId';

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
let authPersistencePromise = null;
let firestoreApiPromise = null;
let firebaseAuthPromise = null;

const getFirestoreApi = async () => {
  if (!firestoreApiPromise) {
    firestoreApiPromise = Promise.all([
      import('firebase/app'),
      import('firebase/firestore/lite'),
    ]).then(([firebaseApp, firestore]) => ({
      initializeApp: firebaseApp.initializeApp,
      getApps: firebaseApp.getApps,
      collection: firestore.collection,
      deleteDoc: firestore.deleteDoc,
      doc: firestore.doc,
      getDoc: firestore.getDoc,
      getDocs: firestore.getDocs,
      getFirestore: firestore.getFirestore,
      limit: firestore.limit,
      orderBy: firestore.orderBy,
      query: firestore.query,
      serverTimestamp: firestore.serverTimestamp,
      setDoc: firestore.setDoc,
      startAfter: firestore.startAfter,
      where: firestore.where,
      writeBatch: firestore.writeBatch,
    }));
  }

  return firestoreApiPromise;
};

const getFirebaseAuthApi = async () => {
  if (!firebaseAuthPromise) {
    firebaseAuthPromise = import('firebase/auth').then((auth) => ({
      getAuth: auth.getAuth,
      inMemoryPersistence: auth.inMemoryPersistence,
      setPersistence: auth.setPersistence,
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

const getActiveDatabaseId = () => getClientDatabaseId() || 'local';

const scopeDocId = (id) => `${getActiveDatabaseId()}__${toSafeString(id)}`;

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

  await getFirestoreDb();
  const {
    getAuth,
    inMemoryPersistence,
    setPersistence,
    signInAnonymously,
  } = await getFirebaseAuthApi();
  const auth = getAuth(firebaseAppInstance);

  if (!authPersistencePromise) {
    authPersistencePromise = setPersistence(auth, inMemoryPersistence)
      .catch((error) => {
        console.warn('Could not set Firebase session persistence.', error);
      });
  }

  await authPersistencePromise;
  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady();
  }

  if (auth.currentUser) {
    return auth.currentUser;
  }

  const credential = await signInAnonymously(auth);
  return credential.user;
};

const sanitizeComponent = (component, index) => {
  const normalizedIngredient = normalizeRecipeIngredient(component, component?.category || 'Other');
  const name = String(normalizedIngredient.name || '').trim();
  const cost = Number.parseFloat(component?.cost);

  if (!name) {
    return null;
  }

  return {
    key: component?.key || createItemPriceKey(`${name}-${index}`),
    name,
    ingredientId: toSafeString(component?.ingredientId || component?.priceCatalogKey),
    priceCatalogKey: toSafeString(component?.priceCatalogKey || component?.ingredientId),
    displayName: toSafeString(component?.displayName) || name,
    quantity: normalizedIngredient.quantity || '',
    quantityValue: normalizedIngredient.quantityValue ?? null,
    unit: normalizedIngredient.unit || '',
    cost: Number.isFinite(cost) && cost >= 0 ? roundCurrency(cost) : 0,
    category: normalizedIngredient.category || 'Other',
    costPerBaseUnit: Number.isFinite(Number(component?.costPerBaseUnit)) ? Number(component.costPerBaseUnit) : null,
    baseUnit: toSafeString(component?.baseUnit),
  };
};

const toSafeString = (value) => String(value ?? '').trim();

const toSafeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toSafeCurrency = (value, fallback = 0) => roundCurrency(toSafeNumber(value, fallback));

const WASTE_PHOTO_DATA_URL_PATTERN = /^data:image\/(?:jpe?g|png|webp);base64,/i;
const MAX_WASTE_PHOTO_DATA_URL_LENGTH = 600 * 1024;

const isLocalPhotoDataUrl = (value) => WASTE_PHOTO_DATA_URL_PATTERN.test(String(value || ''));

const getPersistedPhotoUrl = (value) => {
  const photoUrl = toSafeString(value);

  if (!photoUrl) {
    return '';
  }

  if (!isLocalPhotoDataUrl(photoUrl)) {
    return photoUrl;
  }

  return photoUrl.length <= MAX_WASTE_PHOTO_DATA_URL_LENGTH ? photoUrl : '';
};

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

const sanitizeStockDeduction = (deduction) => {
  const ingredientId = toSafeString(deduction?.ingredientId);
  const quantityBase = toSafeNumber(deduction?.quantityBase);

  if (!ingredientId || quantityBase <= 0) {
    return null;
  }

  return {
    ingredientId,
    ingredientName: toSafeString(deduction?.ingredientName) || ingredientId,
    quantityBase,
    baseUnit: toSafeString(deduction?.baseUnit) || 'each',
    cost: toSafeCurrency(deduction?.cost),
  };
};

const createFirestoreAppDataPayload = (databaseData) => {
  const data = databaseData && typeof databaseData === 'object' ? databaseData : {};
  const stripStaffCredentials = (records) => (Array.isArray(records) ? records : []).map((record) => {
    const { staffCode: _staffCode, managerPin: _managerPin, ...safeRecord } = record || {};
    return safeRecord;
  });

  return removeUndefinedValues({
    ...data,
    // Waste entries are stored separately so this shared snapshot stays below
    // Firestore's single-document size limit as history grows.
    wasteItems: [],
    customStaffList: stripStaffCredentials(data.customStaffList),
    staffList: stripStaffCredentials(data.staffList),
    authSettings: {
      ...(data.authSettings && typeof data.authSettings === 'object' ? data.authSettings : {}),
      staffPin: null,
      managementPin: null,
    },
  });
};

const APP_DATA_SECTION_FIELDS = {
  operations: ['budget', 'settings', 'portionProfiles'],
  menu: ['recipes', 'customMenuItems', 'itemPriceCatalog'],
  staff: ['customStaffList', 'staffList', 'authSettings'],
  inventory: ['storeRoomItems', 'storeRoomMovements', 'inventoryMovements'],
  audit: ['auditLog'],
};
const lastSyncedAppSectionFingerprints = new Map();

const createAppDataSections = (databaseData) => {
  const safeData = createFirestoreAppDataPayload(databaseData);

  return Object.fromEntries(Object.entries(APP_DATA_SECTION_FIELDS).map(([section, fields]) => [
    section,
    Object.fromEntries(fields
      .filter((field) => safeData[field] !== undefined)
      .map((field) => [field, safeData[field]])),
  ]));
};

const getAppSectionFingerprint = (sectionData) => JSON.stringify(sectionData || {});

const combineAppDataSections = (legacyData, sectionDataByName) => {
  const combined = {
    ...(legacyData && typeof legacyData === 'object' ? legacyData : {}),
  };

  Object.values(sectionDataByName).forEach((sectionData) => {
    if (sectionData && typeof sectionData === 'object') {
      Object.assign(combined, sectionData);
    }
  });

  return combined;
};

const createFirestoreWasteEntryPayload = (entry, authUser = null) => {
  const createdAt = toSafeString(entry?.createdAt) || new Date().toISOString();
  const photoUrl = getPersistedPhotoUrl(entry?.photoUrl);
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
    ingredientId: toSafeString(entry?.ingredientId || entry?.priceCatalogKey),
    priceCatalogKey: toSafeString(entry?.priceCatalogKey || entry?.ingredientId),
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
    createdByUid: toSafeString(entry?.createdByUid || authUser?.uid),
    createdBy: toSafeString(entry?.createdBy),
    lastEditedBy: toSafeString(entry?.lastEditedBy),
    status: toSafeString(entry?.status) || 'logged',
    voidedAt: toSafeString(entry?.voidedAt),
    voidedBy: toSafeString(entry?.voidedBy),
    voidReason: toSafeString(entry?.voidReason),
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
    stockDeductions: (Array.isArray(entry?.stockDeductions) ? entry.stockDeductions : [])
      .map(sanitizeStockDeduction)
      .filter(Boolean),
    hasPhoto: Boolean(photoUrl || entry?.hasPhoto || isLocalPhotoDataUrl(entry?.photoUrl)),
    photoUrl,
    photoStoragePath: toSafeString(entry?.photoStoragePath),
    photoName: toSafeString(entry?.photoName),
    photoCapturedAt: toSafeString(entry?.photoCapturedAt),
    photoUploadedAt: toSafeString(entry?.photoUploadedAt),
    photoMimeType: toSafeString(entry?.photoMimeType),
    photoSizeBytes: toSafeNumber(entry?.photoSizeBytes),
    photoUploadStatus: toSafeString(entry?.photoUploadStatus || (photoUrl ? 'stored_in_firestore' : '')),
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
    syncStatus: toSafeString(data?.syncStatus) || 'synced',
    syncError: toSafeString(data?.syncError),
    photoUrl: getPersistedPhotoUrl(data?.photoUrl),
    hasPhoto: Boolean(data?.hasPhoto || data?.photoUrl),
    photoStoragePath: toSafeString(data?.photoStoragePath),
    photoName: toSafeString(data?.photoName),
    photoCapturedAt: toSafeString(data?.photoCapturedAt),
    photoUploadedAt: toSafeString(data?.photoUploadedAt),
    photoMimeType: toSafeString(data?.photoMimeType),
    photoSizeBytes: toSafeNumber(data?.photoSizeBytes),
    photoUploadStatus: toSafeString(data?.photoUploadStatus),
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
    category: toSafeString(data?.category),
    menuPrice,
    totalCost,
    components,
    archived: Boolean(data?.archived),
    archivedAt: toSafeString(data?.archivedAt),
    archivedBy: toSafeString(data?.archivedBy),
  };
};

export const loadFirestoreMenuItems = async () => {
  const db = await getFirestoreDb();

  if (!db) {
    return [];
  }

  await ensureFirebaseAuth();
  const { collection, getDocs, query, where } = await getFirestoreApi();
  const snapshot = await getDocs(query(
    collection(db, 'menuItems'),
    where('databaseId', '==', getActiveDatabaseId()),
  ));
  return snapshot.docs.map(normalizeFirestoreMenuItem).filter(Boolean);
};

export const loadFirestoreWasteEntryPage = async (options = {}) => {
  const daysBack = Number.isFinite(Number(options.daysBack)) ? Math.max(1, Number(options.daysBack)) : null;
  const pageSize = Number.isFinite(Number(options.pageSize))
    ? Math.max(1, Math.min(500, Number(options.pageSize)))
    : 250;
  const db = await getFirestoreDb();

  if (!db) {
    return { entries: [], cursor: null, hasMore: false };
  }

  await ensureFirebaseAuth();
  const { collection, getDocs, limit, orderBy, query, startAfter, where } = await getFirestoreApi();
  const constraints = [where('databaseId', '==', getActiveDatabaseId())];

  if (daysBack) {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    constraints.push(where('createdAt', '>=', since.toISOString()));
  }

  constraints.push(orderBy('createdAt', 'desc'));
  if (options.cursor) {
    constraints.push(startAfter(options.cursor));
  }
  constraints.push(limit(pageSize));
  const snapshot = await getDocs(query(collection(db, 'wasteEntries'), ...constraints));
  const entries = snapshot.docs
    .map(normalizeFirestoreWasteEntry)
    .filter((entry) => entry.name && entry.reason)
    .sort((a, b) => new Date(a.createdAt || a.timestamp || 0).getTime() - new Date(b.createdAt || b.timestamp || 0).getTime());

  return {
    entries,
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.size === pageSize,
  };
};

export const loadFirestoreWasteEntries = async (options = {}) => {
  const page = await loadFirestoreWasteEntryPage({
    ...options,
    pageSize: options.pageSize ?? options.limit,
  });
  return page.entries;
};

export const loadFirestoreDatabaseSnapshot = async () => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { collection, getDocs, query, where } = await getFirestoreApi();
  const snapshot = await getDocs(query(
    collection(db, 'appData'),
    where('databaseId', '==', getActiveDatabaseId()),
  ));

  if (snapshot.empty) {
    lastSyncedAppSectionFingerprints.clear();
    return { ok: true, exists: false, data: null, updatedAt: '' };
  }

  const documents = snapshot.docs.map((documentSnapshot) => ({
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  }));
  const legacyDocument = documents.find((document) => document.id === scopeDocId('main'));
  const legacyData = legacyDocument?.data && typeof legacyDocument.data === 'object'
    ? legacyDocument.data
    : {};
  const legacySections = createAppDataSections(legacyData);
  const sectionDataByName = Object.fromEntries(Object.keys(APP_DATA_SECTION_FIELDS).map((section) => {
    const sectionDocument = documents.find((document) => document.section === section);
    const sectionData = sectionDocument?.data && typeof sectionDocument.data === 'object'
      ? sectionDocument.data
      : legacySections[section];

    lastSyncedAppSectionFingerprints.set(section, getAppSectionFingerprint(sectionData));
    return [section, sectionData];
  }));
  const updatedAt = documents
    .map((document) => toSafeString(document.updatedAtClient || document.exportedAt))
    .filter(Boolean)
    .sort()
    .at(-1) || '';

  return {
    ok: true,
    exists: true,
    data: combineAppDataSections(legacyData, sectionDataByName),
    updatedAt,
  };
};

export const saveFirestoreDatabaseSnapshot = async (databaseData) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  const sections = createAppDataSections(databaseData);
  const exportedAt = new Date().toISOString();
  const databaseId = getActiveDatabaseId();
  const changedSections = Object.entries(sections).filter(([section, sectionData]) => (
    lastSyncedAppSectionFingerprints.get(section) !== getAppSectionFingerprint(sectionData)
  ));

  if (changedSections.length === 0) {
    return { ok: true, unchanged: true, changedSections: [], updatedAt: exportedAt };
  }

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, writeBatch } = await getFirestoreApi();
  const batch = writeBatch(db);

  changedSections.forEach(([section, sectionData]) => {
    batch.set(doc(db, 'appData', scopeDocId(`section-${section}`)), {
      databaseId,
      section,
      data: sectionData,
      exportedAt,
      updatedAtClient: exportedAt,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });

  await batch.commit();
  changedSections.forEach(([section, sectionData]) => {
    lastSyncedAppSectionFingerprints.set(section, getAppSectionFingerprint(sectionData));
  });

  return {
    ok: true,
    changedSections: changedSections.map(([section]) => section),
    updatedAt: exportedAt,
  };
};

export const saveFirestoreMenuItem = async ({
  key,
  name,
  category = '',
  totalCost,
  menuPrice = null,
  components,
  archived = false,
  archivedAt = '',
  archivedBy = '',
}) => {
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
  await setDoc(doc(db, 'menuItems', scopeDocId(safeKey)), {
    databaseId: getActiveDatabaseId(),
    key: safeKey,
    name: safeName,
    category: toSafeString(category),
    totalCost: resolvedTotalCost,
    ...(menuPrice !== null && menuPrice !== undefined ? { menuPrice: roundCurrency(Number(menuPrice) || 0) } : {}),
    components: safeComponents,
    archived: Boolean(archived),
    archivedAt: toSafeString(archivedAt),
    archivedBy: toSafeString(archivedBy),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { ok: true };
};

export const saveFirestoreRecipe = async ({ key, name, category = '', menuPrice = null, ingredients = [], instructions = '' }) => {
  const db = await getFirestoreDb();
  const safeName = String(name || '').trim();
  const safeKey = key || createItemPriceKey(safeName);

  if (!db || !safeKey || !safeName) {
    return { ok: false, skipped: true };
  }

  const safeIngredients = (Array.isArray(ingredients) ? ingredients : [])
    .map(sanitizeComponent)
    .filter(Boolean);

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  await setDoc(doc(db, 'recipes', scopeDocId(safeKey)), removeUndefinedValues({
    databaseId: getActiveDatabaseId(),
    key: safeKey,
    name: safeName,
    category: toSafeString(category),
    ...(menuPrice !== null && menuPrice !== undefined ? { menuPrice: roundCurrency(Number(menuPrice) || 0) } : {}),
    ingredients: safeIngredients,
    instructions: toSafeString(instructions),
    updatedAt: serverTimestamp(),
  }), { merge: true });

  return { ok: true };
};

export const saveFirestoreMenuBundle = async (items = []) => {
  const db = await getFirestoreDb();
  const safeItems = (Array.isArray(items) ? items : [])
    .map((item) => {
      const name = toSafeString(item?.name);
      const key = toSafeString(item?.key) || createItemPriceKey(name);
      const components = (Array.isArray(item?.components) ? item.components : [])
        .map(sanitizeComponent)
        .filter(Boolean);

      if (!name || !key) {
        return null;
      }

      return {
        ...item,
        key,
        name,
        category: toSafeString(item?.category),
        components,
        totalCost: Number.isFinite(Number(item?.totalCost))
          ? roundCurrency(Number(item.totalCost))
          : roundCurrency(components.reduce((sum, component) => sum + component.cost, 0)),
      };
    })
    .filter(Boolean);

  if (!db || safeItems.length === 0) {
    return { ok: false, skipped: true, savedCount: 0 };
  }

  if (safeItems.length > 200) {
    throw new Error('Save make-line guides in groups of 200 recipes or fewer.');
  }

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, writeBatch } = await getFirestoreApi();
  const batch = writeBatch(db);
  const databaseId = getActiveDatabaseId();

  safeItems.forEach((item) => {
    const commonFields = {
      databaseId,
      key: item.key,
      name: item.name,
      category: item.category,
      ...(item.menuPrice !== null && item.menuPrice !== undefined
        ? { menuPrice: roundCurrency(Number(item.menuPrice) || 0) }
        : {}),
      updatedAt: serverTimestamp(),
    };

    batch.set(doc(db, 'menuItems', scopeDocId(item.key)), {
      ...commonFields,
      totalCost: item.totalCost,
      components: item.components,
      archived: false,
      archivedAt: '',
      archivedBy: '',
    }, { merge: true });
    batch.set(doc(db, 'recipes', scopeDocId(item.key)), removeUndefinedValues({
      ...commonFields,
      ingredients: item.components,
      instructions: toSafeString(item?.instructions),
    }), { merge: true });
  });

  await batch.commit();
  return { ok: true, savedCount: safeItems.length };
};

export const archiveFirestoreMenuItem = async (key, archivedBy = 'WasteShift user') => {
  const db = await getFirestoreDb();
  const safeKey = toSafeString(key);

  if (!db || !safeKey) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  const archivedAt = new Date().toISOString();

  await setDoc(doc(db, 'menuItems', scopeDocId(safeKey)), {
    databaseId: getActiveDatabaseId(),
    key: safeKey,
    archived: true,
    archivedAt,
    archivedBy: toSafeString(archivedBy) || 'WasteShift user',
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { ok: true, archivedAt };
};

export const restoreFirestoreMenuItem = async (key) => {
  const db = await getFirestoreDb();
  const safeKey = toSafeString(key);

  if (!db || !safeKey) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();

  await setDoc(doc(db, 'menuItems', scopeDocId(safeKey)), {
    databaseId: getActiveDatabaseId(),
    key: safeKey,
    archived: false,
    archivedAt: '',
    archivedBy: '',
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { ok: true };
};

export const deleteFirestoreMenuItems = async (itemKeys = []) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true, deletedCount: 0 };
  }

  await ensureFirebaseAuth();
  const { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } = await getFirestoreApi();
  const safeKeys = [...new Set((Array.isArray(itemKeys) ? itemKeys : [])
    .map((key) => String(key || '').trim())
    .filter(Boolean))];

  if (safeKeys.length > 0) {
    const archiveResults = await Promise.all(safeKeys.map(async (key) => {
      const docRef = doc(db, 'menuItems', scopeDocId(key));
      const docSnapshot = await getDoc(docRef).catch(() => null);

      if (!docSnapshot?.exists?.() || docSnapshot.data()?.databaseId !== getActiveDatabaseId()) {
        return false;
      }

      await setDoc(docRef, {
        archived: true,
        archivedAt: new Date().toISOString(),
        archivedBy: 'Bulk menu wipe',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      return true;
    }));

    return { ok: true, deletedCount: archiveResults.filter(Boolean).length };
  }

  const snapshot = await getDocs(query(
    collection(db, 'menuItems'),
    where('databaseId', '==', getActiveDatabaseId()),
  ));
  await Promise.all(snapshot.docs.map((docSnapshot) => setDoc(docSnapshot.ref, {
    archived: true,
    archivedAt: new Date().toISOString(),
    archivedBy: 'Bulk menu wipe',
    updatedAt: serverTimestamp(),
  }, { merge: true })));

  return { ok: true, deletedCount: snapshot.docs.length };
};

export const saveFirestoreWasteEntry = async (entry) => {
  const db = await getFirestoreDb();
  const safeEntryId = toSafeString(entry?.id);

  if (!db || !safeEntryId) {
    return { ok: false, skipped: true };
  }

  if (isLocalPhotoDataUrl(entry?.photoUrl) && !getPersistedPhotoUrl(entry.photoUrl)) {
    throw new Error('This photo is too large to save. Choose a smaller photo and try again.');
  }

  const authUser = await ensureFirebaseAuth();
  const payload = createFirestoreWasteEntryPayload(entry, authUser);

  if (!payload.name || !payload.reason) {
    return { ok: false, skipped: true };
  }

  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  await setDoc(doc(db, 'wasteEntries', scopeDocId(safeEntryId)), {
    databaseId: getActiveDatabaseId(),
    ...payload,
    firestoreSavedAt: serverTimestamp(),
  }, { merge: true });

  return { ok: true, id: safeEntryId };
};
