import { createInvoiceKey, roundMoney } from '../utils/invoiceParsing';
import { createRecordId } from '../utils/ids';
import { roundUnitPrice } from '../utils/itemPriceCatalog';
import { createStockMovementId, createStockMovementRecord } from '../utils/stockLedger';
import {
  findDuplicateIngredient,
  getLatestPriceChange,
  normalizeIngredientRecord,
} from '../utils/ingredientIntelligence';
import {
  buildInvoiceIngredientPricing,
  createMasterIngredientId,
  getPriceChangeFromBaseCost,
  normalizeMasterIngredientName,
  normalizeMasterIngredientRecord,
  uniqueMasterStrings,
} from '../utils/masterIngredients';
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

let firebaseAppInstance = null;
let firestoreInstance = null;
let authPersistencePromise = null;
let firestoreApiPromise = null;
let firebaseAuthPromise = null;

const getFirestoreApi = async () => {
  if (!firestoreApiPromise) {
    firestoreApiPromise = Promise.all([
      import('firebase/app'),
      import('firebase/firestore/lite'),
    ]).then(([firebaseApp, firestore]) => ({
      collection: firestore.collection,
      doc: firestore.doc,
      getDoc: firestore.getDoc,
      getDocs: firestore.getDocs,
      getFirestore: firestore.getFirestore,
      getApps: firebaseApp.getApps,
      deleteDoc: firestore.deleteDoc,
      increment: firestore.increment,
      initializeApp: firebaseApp.initializeApp,
      limit: firestore.limit,
      orderBy: firestore.orderBy,
      query: firestore.query,
      runTransaction: firestore.runTransaction,
      serverTimestamp: firestore.serverTimestamp,
      setDoc: firestore.setDoc,
      startAfter: firestore.startAfter,
      updateDoc: firestore.updateDoc,
      where: firestore.where,
    }));
  }

  return firestoreApiPromise;
};

const getFirebaseAuthApi = async () => {
  if (!firebaseAuthPromise) {
    firebaseAuthPromise = import('firebase/auth').then((auth) => ({
      browserLocalPersistence: auth.browserLocalPersistence,
      getAuth: auth.getAuth,
      setPersistence: auth.setPersistence,
      signInAnonymously: auth.signInAnonymously,
    }));
  }

  return firebaseAuthPromise;
};

export const invoiceFirestoreIsConfigured = () => hasFirebaseConfig;

const getFirestoreDb = async () => {
  if (!hasFirebaseConfig) {
    return null;
  }

  if (firestoreInstance) {
    return firestoreInstance;
  }

  const { getApps, getFirestore, initializeApp } = await getFirestoreApi();
  firebaseAppInstance = getApps().length > 0 ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  firestoreInstance = getFirestore(firebaseAppInstance);
  return firestoreInstance;
};

const ensureFirebaseAuth = async () => {
  if (!hasFirebaseConfig) {
    return null;
  }

  await getFirestoreDb();
  const {
    browserLocalPersistence,
    getAuth,
    setPersistence,
    signInAnonymously,
  } = await getFirebaseAuthApi();
  const auth = getAuth(firebaseAppInstance);

  if (!authPersistencePromise) {
    authPersistencePromise = setPersistence(auth, browserLocalPersistence)
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

const sanitizeString = (value) => String(value ?? '').trim();

const sanitizeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const createSupplierId = (supplierName) => createInvoiceKey(supplierName) || 'unknown_supplier';

const uniqueStrings = (values) => (
  [...new Set((Array.isArray(values) ? values : [])
    .map((value) => sanitizeString(value))
    .filter(Boolean))]
);

const getActiveDatabaseId = () => getClientDatabaseId() || 'local';

const scopeDocId = (id) => `${getActiveDatabaseId()}__${sanitizeString(id)}`;

const readCollectionPage = async (collectionName, options = {}) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { records: [], cursor: null, hasMore: false };
  }

  await ensureFirebaseAuth();
  const { collection, getDocs, limit, orderBy, query, startAfter, where } = await getFirestoreApi();
  const collectionRef = collection(db, collectionName);
  const constraints = [where('databaseId', '==', getActiveDatabaseId())];

  if (options.orderByField) {
    constraints.push(orderBy(options.orderByField, options.direction === 'asc' ? 'asc' : 'desc'));
  }

  if (options.cursor) {
    constraints.push(startAfter(options.cursor));
  }

  const limitCount = options.limitCount ? Math.max(1, Number(options.limitCount) || 1) : 0;
  if (options.limitCount) {
    constraints.push(limit(limitCount));
  }

  const snapshot = await getDocs(query(collectionRef, ...constraints));
  const records = snapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));

  return {
    records,
    cursor: snapshot.docs.at(-1) || null,
    hasMore: limitCount > 0 && snapshot.size === limitCount,
  };
};

const readCollection = async (collectionName, options = {}) => {
  const page = await readCollectionPage(collectionName, options);
  return page.records;
};

const normalizeIngredient = (docData) => {
  const normalizedRecord = normalizeIngredientRecord(docData);

  if (!normalizedRecord || !normalizedRecord.active) {
    return null;
  }

  return {
    ...docData,
    ...normalizedRecord,
    canonicalName: normalizedRecord.canonicalName || normalizedRecord.name,
    aliases: uniqueMasterStrings(normalizedRecord.aliases),
    previousRawNames: uniqueMasterStrings(normalizedRecord.previousRawNames),
    latestCostPerBaseUnit: sanitizeNumber(normalizedRecord.latestCostPerBaseUnit),
    lastInvoicePrice: sanitizeNumber(normalizedRecord.lastInvoicePrice),
    lastPurchaseQuantity: sanitizeNumber(normalizedRecord.lastPurchaseQuantity),
    lastPurchaseUnit: sanitizeString(normalizedRecord.lastPurchaseUnit || normalizedRecord.baseUnit),
    unit: normalizedRecord.defaultUnit,
    parLevel: sanitizeNumber(docData?.parLevel),
    reorderPoint: sanitizeNumber(docData?.reorderPoint),
    preferredSupplier: sanitizeString(docData?.preferredSupplier || normalizedRecord.supplier),
    supplierId: sanitizeString(docData?.supplierId),
    currentPrice: sanitizeNumber(docData?.currentPrice ?? normalizedRecord.latestCost),
    currentPriceIncVAT: sanitizeNumber(docData?.currentPriceIncVAT ?? docData?.lastPriceIncVAT ?? docData?.priceIncVAT),
    lastPriceExVAT: sanitizeNumber(docData?.lastPriceExVAT ?? docData?.priceExVAT ?? normalizedRecord.latestCost),
    lastPriceIncVAT: sanitizeNumber(docData?.lastPriceIncVAT ?? docData?.priceIncVAT),
    lastLineTotalExVAT: sanitizeNumber(docData?.lastLineTotalExVAT),
    lastLineTotalIncVAT: sanitizeNumber(docData?.lastLineTotalIncVAT),
    lastQuantity: sanitizeNumber(docData?.lastQuantity),
    lastUnit: sanitizeString(docData?.lastUnit || docData?.unit) || 'each',
    baseUnit: sanitizeString(normalizedRecord.baseUnit || docData?.baseUnit),
    baseQuantity: sanitizeNumber(docData?.baseQuantity),
    costPerBaseUnitExVAT: sanitizeNumber(docData?.costPerBaseUnitExVAT ?? normalizedRecord.latestCostPerBaseUnit),
    lastInvoiceDate: sanitizeString(docData?.lastInvoiceDate),
    linkedMenuItemIds: uniqueStrings(docData?.linkedMenuItemIds),
    linkedRecipeNames: uniqueStrings(docData?.linkedRecipeNames),
    priceHistory: Array.isArray(docData?.priceHistory) ? docData.priceHistory : [],
  };
};

const normalizeMenuItem = (docData) => {
  const name = sanitizeString(docData?.name);
  const id = sanitizeString(docData?.id || docData?.key) || createInvoiceKey(name);

  if (!name || !id) {
    return null;
  }

  return {
    ...docData,
    id,
    key: docData?.key || id,
    name,
    recipe: Array.isArray(docData?.recipe) ? docData.recipe : [],
    ingredients: Array.isArray(docData?.ingredients) ? docData.ingredients : [],
    components: Array.isArray(docData?.components) ? docData.components : [],
    totalCost: sanitizeNumber(docData?.totalCost),
  };
};

const normalizeStockLevel = (docData) => {
  const ingredientId = sanitizeString(docData?.ingredientId || docData?.id);

  if (!ingredientId) {
    return null;
  }

  return {
    ...docData,
    id: ingredientId,
    ingredientId,
    currentQty: sanitizeNumber(docData?.currentQty),
    unit: sanitizeString(docData?.unit) || 'each',
    lastInvoiceId: sanitizeString(docData?.lastInvoiceId),
  };
};

const normalizeStockMovement = (docData) => {
  const movementId = sanitizeString(docData?.movementId || docData?.id);
  const ingredientId = sanitizeString(docData?.ingredientId);

  if (!movementId || !ingredientId) {
    return null;
  }

  return {
    ...docData,
    id: movementId,
    movementId,
    ingredientId,
    ingredientName: sanitizeString(docData?.ingredientName),
    type: sanitizeString(docData?.type) || 'receive',
    quantityBase: sanitizeNumber(docData?.quantityBase),
    baseUnit: sanitizeString(docData?.baseUnit) || 'each',
    sourceType: sanitizeString(docData?.sourceType) || 'invoice',
    sourceId: sanitizeString(docData?.sourceId || docData?.invoiceId),
    invoiceId: sanitizeString(docData?.invoiceId || docData?.sourceId),
    invoiceNumber: sanitizeString(docData?.invoiceNumber),
    supplier: sanitizeString(docData?.supplier),
    invoiceDate: sanitizeString(docData?.invoiceDate),
    receivedDate: sanitizeString(docData?.receivedDate),
    previousQuantityBase: sanitizeNumber(docData?.previousQuantityBase),
    resultingQuantityBase: sanitizeNumber(docData?.resultingQuantityBase),
    status: sanitizeString(docData?.status) || 'ok',
    unitPriceExVAT: sanitizeNumber(docData?.unitPriceExVAT),
    lineTotalExVAT: sanitizeNumber(docData?.lineTotalExVAT),
    sortDate: sanitizeString(docData?.sortDate || docData?.receivedDate || docData?.invoiceDate),
  };
};

const withPriceHistory = async (ingredient) => {
  const db = await getFirestoreDb();

  if (!db || !ingredient?.id) {
    return ingredient;
  }

  await ensureFirebaseAuth();
  const { collection, getDocs, limit, orderBy, query } = await getFirestoreApi();
  const snapshot = await getDocs(query(
    collection(db, 'ingredients', scopeDocId(ingredient.id), 'priceHistory'),
    orderBy('date', 'desc'),
    limit(100),
  ));
  const priceHistory = snapshot.docs
    .map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data(),
    }))
    .filter((history) => (
      history.databaseId === getActiveDatabaseId()
      && history.isDeleted !== true
      && !['deleted', 'voided'].includes(String(history.status || '').toLowerCase())
    ))
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

  return { ...ingredient, priceHistory };
};

const normalizePriceHistory = (docData) => {
  if (
    docData?.isDeleted === true
    || ['deleted', 'voided'].includes(String(docData?.status || '').toLowerCase())
  ) {
    return null;
  }

  const ingredientId = sanitizeString(docData?.ingredientId);
  const supplierId = sanitizeString(docData?.supplierId) || createSupplierId(docData?.supplier);
  const date = sanitizeString(docData?.date);

  if (!ingredientId || !date) {
    return null;
  }

  return {
    ...docData,
    ingredientId,
    supplierId,
    supplier: sanitizeString(docData?.supplier),
    price: sanitizeNumber(docData?.price ?? docData?.priceExVAT),
    priceExVAT: sanitizeNumber(docData?.priceExVAT ?? docData?.price),
    priceIncVAT: sanitizeNumber(docData?.priceIncVAT),
    purchaseQuantity: sanitizeNumber(docData?.purchaseQuantity ?? docData?.quantity),
    purchaseUnit: sanitizeString(docData?.purchaseUnit ?? docData?.unit),
    convertedQuantity: sanitizeNumber(docData?.convertedQuantity ?? docData?.baseQuantity),
    baseUnit: sanitizeString(docData?.baseUnit),
    totalPrice: sanitizeNumber(docData?.totalPrice ?? docData?.linePriceExVAT ?? docData?.priceExVAT),
    costPerBaseUnit: sanitizeNumber(docData?.costPerBaseUnit ?? docData?.costPerBaseUnitExVAT),
    previousCostPerBaseUnit: sanitizeNumber(docData?.previousCostPerBaseUnit),
    percentageChange: sanitizeNumber(docData?.percentageChange ?? docData?.priceChangePercent),
    date,
    invoiceId: sanitizeString(docData?.invoiceId),
  };
};

const mergeTopLevelPriceHistory = (ingredients, priceHistoryDocs) => {
  const historyByIngredient = new Map();

  (Array.isArray(priceHistoryDocs) ? priceHistoryDocs : [])
    .map(normalizePriceHistory)
    .filter(Boolean)
    .forEach((history) => {
      const currentHistory = historyByIngredient.get(history.ingredientId) || [];
      currentHistory.push(history);
      historyByIngredient.set(history.ingredientId, currentHistory);
    });

  return ingredients.map((ingredient) => {
    const mergedHistory = [
      ...(Array.isArray(ingredient.priceHistory) ? ingredient.priceHistory : []),
      ...(historyByIngredient.get(ingredient.id) || []),
    ];
    const seen = new Set();
    const priceHistory = mergedHistory
      .filter((history) => {
        const key = history.id || `${history.invoiceId}-${history.ingredientId}-${history.date}-${history.priceExVAT}`;

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

    return { ...ingredient, priceHistory };
  });
};

const getTopLevelPriceHistoryDocs = async (db) => {
  const { collection, getDocs, query, where } = await getFirestoreApi();
  const snapshot = await getDocs(query(
    collection(db, 'priceHistory'),
    where('databaseId', '==', getActiveDatabaseId()),
  )).catch(() => ({ docs: [] }));

  return snapshot.docs.map((docSnapshot) => ({
    docSnapshot,
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));
};

const getIngredientPriceHistoryDocs = async (db, ingredientId) => {
  const { collection, getDocs } = await getFirestoreApi();
  const snapshot = await getDocs(collection(db, 'ingredients', scopeDocId(ingredientId), 'priceHistory')).catch(() => ({ docs: [] }));

  return snapshot.docs.map((docSnapshot) => ({
    docSnapshot,
    id: docSnapshot.id,
    ...docSnapshot.data(),
  })).filter((history) => history.databaseId === getActiveDatabaseId());
};

const getLatestIngredientHistory = async (db, ingredientId, excludedInvoiceId = '') => {
  const [topLevelHistory, nestedHistory] = await Promise.all([
    getTopLevelPriceHistoryDocs(db),
    getIngredientPriceHistoryDocs(db, ingredientId),
  ]);
  const seen = new Set();

  return [...topLevelHistory, ...nestedHistory]
    .map(normalizePriceHistory)
    .filter((history) => (
      history
      && history.ingredientId === ingredientId
      && history.invoiceId !== excludedInvoiceId
    ))
    .filter((history) => {
      const key = history.id || `${history.invoiceId}-${history.date}-${history.priceExVAT}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())[0] || null;
};

const refreshIngredientLatestPrice = async (db, ingredientId, excludedInvoiceId = '') => {
  const safeIngredientId = sanitizeString(ingredientId);

  if (!safeIngredientId) {
    return;
  }

  const { doc, getDoc, serverTimestamp, setDoc } = await getFirestoreApi();
  const ingredientRef = doc(db, 'ingredients', scopeDocId(safeIngredientId));
  const ingredientSnapshot = await getDoc(ingredientRef).catch(() => null);

  if (!ingredientSnapshot?.exists?.()) {
    return;
  }

  if (ingredientSnapshot.data()?.databaseId !== getActiveDatabaseId()) {
    return;
  }

  const latestHistory = await getLatestIngredientHistory(db, safeIngredientId, excludedInvoiceId);

  if (!latestHistory) {
    await setDoc(ingredientRef, {
      latestCost: 0,
      costUnit: 'each',
      currentPrice: 0,
      currentPriceIncVAT: 0,
      lastPriceExVAT: 0,
      lastPriceIncVAT: 0,
      lastLineTotalExVAT: 0,
      lastLineTotalIncVAT: 0,
      costPerBaseUnitExVAT: 0,
      latestCostPerBaseUnit: 0,
      lastInvoicePrice: 0,
      lastPurchaseQuantity: 0,
      lastPurchaseUnit: '',
      lastInvoiceDate: '',
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return;
  }

  await setDoc(ingredientRef, {
    supplierId: latestHistory.supplierId,
    preferredSupplier: latestHistory.supplier,
    supplier: latestHistory.supplier,
    source: latestHistory.supplier,
    active: true,
    latestCost: roundMoney(latestHistory.priceExVAT),
    costUnit: sanitizeString(latestHistory.unit) || 'each',
    currentPrice: roundMoney(latestHistory.priceExVAT),
    currentPriceIncVAT: roundMoney(latestHistory.priceIncVAT),
    lastPriceExVAT: roundMoney(latestHistory.priceExVAT),
    lastPriceIncVAT: roundMoney(latestHistory.priceIncVAT),
    lastLineTotalExVAT: roundMoney(latestHistory.linePriceExVAT),
    lastLineTotalIncVAT: roundMoney(latestHistory.linePriceIncVAT),
    lastQuantity: sanitizeNumber(latestHistory.quantity),
    lastUnit: sanitizeString(latestHistory.unit) || 'each',
    baseQuantity: sanitizeNumber(latestHistory.convertedQuantity ?? latestHistory.baseQuantity),
    baseUnit: sanitizeString(latestHistory.baseUnit),
    costPerBaseUnitExVAT: roundUnitPrice(latestHistory.costPerBaseUnit ?? latestHistory.costPerBaseUnitExVAT),
    latestCostPerBaseUnit: roundUnitPrice(latestHistory.costPerBaseUnit ?? latestHistory.costPerBaseUnitExVAT),
    lastInvoicePrice: roundMoney(latestHistory.totalPrice ?? latestHistory.linePriceExVAT),
    lastPurchaseQuantity: sanitizeNumber(latestHistory.convertedQuantity ?? latestHistory.baseQuantity),
    lastPurchaseUnit: sanitizeString(latestHistory.baseUnit),
    lastInvoiceDate: latestHistory.date,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

export const loadInvoiceWorkspaceData = async () => {
  if (!hasFirebaseConfig) {
    return {
      ingredients: [],
      menuItems: [],
      stockLevels: [],
      stockMovements: [],
      invoices: [],
      suppliers: [],
      settings: { vatRate: 0.15 },
    };
  }

  const [ingredientDocs, menuItemDocs, stockDocs, stockMovementPage, invoicePage, supplierDocs, priceHistoryDocs] = await Promise.all([
    readCollection('ingredients'),
    readCollection('menuItems'),
    readCollection('stockLevels'),
    readCollectionPage('stockMovements', { orderByField: 'createdAt', limitCount: 250 }),
    readCollectionPage('invoices', { orderByField: 'invoiceDate', limitCount: 150 }),
    readCollection('suppliers'),
    readCollection('priceHistory', { orderByField: 'date', limitCount: 500 }),
  ]);
  const db = await getFirestoreDb();
  const { doc, getDoc } = await getFirestoreApi();
  const settingsSnapshot = await getDoc(doc(db, 'settings', scopeDocId('invoiceConfig')));
  const ingredientsWithSubHistory = await Promise.all(
    ingredientDocs
      .map(normalizeIngredient)
      .filter(Boolean)
      .map(withPriceHistory)
  );
  const ingredients = mergeTopLevelPriceHistory(ingredientsWithSubHistory, priceHistoryDocs);

  return {
    ingredients,
    menuItems: menuItemDocs.map(normalizeMenuItem).filter(Boolean),
    stockLevels: stockDocs.map(normalizeStockLevel).filter(Boolean),
    stockMovements: stockMovementPage.records
      .map(normalizeStockMovement)
      .filter(Boolean)
      .sort((a, b) => new Date(b.sortDate || 0).getTime() - new Date(a.sortDate || 0).getTime()),
    invoices: invoicePage.records.sort((a, b) => new Date(b.invoiceDate || b.scannedAt || 0).getTime() - new Date(a.invoiceDate || a.scannedAt || 0).getTime()),
    suppliers: supplierDocs,
    pagination: {
      invoices: { cursor: invoicePage.cursor, hasMore: invoicePage.hasMore },
      stockMovements: { cursor: stockMovementPage.cursor, hasMore: stockMovementPage.hasMore },
    },
    settings: {
      vatRate: sanitizeNumber(settingsSnapshot.data()?.vatRate, 0.15),
    },
  };
};

export const loadInvoiceHistoryPage = async ({ cursor = null, pageSize = 150 } = {}) => {
  const page = await readCollectionPage('invoices', {
    orderByField: 'invoiceDate',
    limitCount: Math.max(1, Math.min(300, Number(pageSize) || 150)),
    cursor,
  });
  return {
    records: page.records.sort((a, b) => new Date(b.invoiceDate || b.scannedAt || 0).getTime() - new Date(a.invoiceDate || a.scannedAt || 0).getTime()),
    cursor: page.cursor,
    hasMore: page.hasMore,
  };
};

export const loadStockMovementPage = async ({ cursor = null, pageSize = 250 } = {}) => {
  const page = await readCollectionPage('stockMovements', {
    orderByField: 'createdAt',
    limitCount: Math.max(1, Math.min(500, Number(pageSize) || 250)),
    cursor,
  });
  return {
    records: page.records.map(normalizeStockMovement).filter(Boolean),
    cursor: page.cursor,
    hasMore: page.hasMore,
  };
};

export const saveInvoiceSettings = async ({ vatRate }) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  await setDoc(doc(db, 'settings', scopeDocId('invoiceConfig')), {
    databaseId: getActiveDatabaseId(),
    vatRate: sanitizeNumber(vatRate, 0.15),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { ok: true };
};

export const saveIngredient = async (ingredientDraft) => {
  const db = await getFirestoreDb();
  const masterDraft = normalizeMasterIngredientRecord(ingredientDraft);
  const name = sanitizeString(masterDraft?.name || ingredientDraft?.name);
  const id = sanitizeString(ingredientDraft?.id || masterDraft?.id) || createMasterIngredientId(name) || createInvoiceKey(name);

  if (!db || !name || !id) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const existingIngredients = (await readCollection('ingredients')).map(normalizeIngredient).filter(Boolean);
  const duplicateIngredient = findDuplicateIngredient(existingIngredients, { ...ingredientDraft, id, name });

  if (duplicateIngredient) {
    return {
      ok: false,
      duplicate: true,
      message: `${name} already exists as ${duplicateIngredient.name}.`,
      ingredient: duplicateIngredient,
    };
  }

  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  const supplierName = sanitizeString(ingredientDraft?.preferredSupplier);
  const supplierId = sanitizeString(ingredientDraft?.supplierId) || createSupplierId(supplierName);
  const latestCost = sanitizeNumber(ingredientDraft?.latestCost ?? ingredientDraft?.currentPrice ?? ingredientDraft?.lastPriceExVAT);
  const costUnit = sanitizeString(ingredientDraft?.costUnit || ingredientDraft?.unit) || 'each';
  const latestCostPerBaseUnit = roundUnitPrice(ingredientDraft?.latestCostPerBaseUnit ?? ingredientDraft?.costPerBaseUnit ?? ingredientDraft?.costPerBaseUnitExVAT);
  const baseUnit = sanitizeString(masterDraft?.baseUnit || ingredientDraft?.baseUnit || ingredientDraft?.unit) || costUnit;
  const payload = {
    databaseId: getActiveDatabaseId(),
    id,
    key: id,
    name,
    canonicalName: sanitizeString(masterDraft?.canonicalName || name),
    aliases: uniqueMasterStrings([
      masterDraft?.aliases,
      ingredientDraft?.aliases,
      name,
      normalizeMasterIngredientName(name),
    ]),
    previousRawNames: uniqueMasterStrings(ingredientDraft?.previousRawNames),
    baseUnit,
    category: sanitizeString(ingredientDraft?.category) || 'Other',
    unit: sanitizeString(ingredientDraft?.unit) || costUnit,
    defaultUnit: sanitizeString(ingredientDraft?.defaultUnit || ingredientDraft?.unit || baseUnit) || costUnit,
    parLevel: sanitizeNumber(ingredientDraft?.parLevel),
    reorderPoint: sanitizeNumber(ingredientDraft?.reorderPoint),
    preferredSupplier: supplierName,
    supplier: supplierName,
    source: supplierName,
    supplierId,
    active: ingredientDraft?.active !== false,
    notes: sanitizeString(ingredientDraft?.notes),
    linkedMenuItemIds: uniqueStrings(ingredientDraft?.linkedMenuItemIds),
    linkedRecipeNames: uniqueStrings(ingredientDraft?.linkedRecipeNames),
    latestCost,
    latestCostPerBaseUnit,
    lastInvoicePrice: sanitizeNumber(ingredientDraft?.lastInvoicePrice ?? ingredientDraft?.lastLineTotalExVAT ?? latestCost),
    lastPurchaseQuantity: sanitizeNumber(ingredientDraft?.lastPurchaseQuantity ?? ingredientDraft?.baseQuantity ?? ingredientDraft?.lastQuantity),
    lastPurchaseUnit: sanitizeString(ingredientDraft?.lastPurchaseUnit || ingredientDraft?.baseUnit || ingredientDraft?.lastUnit || baseUnit),
    costUnit,
    currentPrice: latestCost,
    currentPriceIncVAT: sanitizeNumber(ingredientDraft?.currentPriceIncVAT ?? ingredientDraft?.lastPriceIncVAT),
    lastPriceExVAT: sanitizeNumber(ingredientDraft?.lastPriceExVAT ?? latestCost),
    lastPriceIncVAT: sanitizeNumber(ingredientDraft?.lastPriceIncVAT),
    costPerBaseUnitExVAT: latestCostPerBaseUnit,
    updatedAt: serverTimestamp(),
    createdAt: ingredientDraft?.createdAt || serverTimestamp(),
  };

  await setDoc(doc(db, 'ingredients', scopeDocId(id)), payload, { merge: true });
  if (supplierName) {
    await setDoc(doc(db, 'suppliers', scopeDocId(supplierId)), {
      databaseId: getActiveDatabaseId(),
      id: supplierId,
      name: supplierName,
      contactInfo: sanitizeString(ingredientDraft?.supplierContactInfo),
      paymentTerms: sanitizeString(ingredientDraft?.supplierPaymentTerms),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  return { ok: true, ingredient: payload };
};

export const saveIngredientPriceRecord = async (priceRecord) => {
  const db = await getFirestoreDb();
  const masterRecord = normalizeMasterIngredientRecord(priceRecord);
  const name = sanitizeString(masterRecord?.name || priceRecord?.name);
  const id = sanitizeString(priceRecord?.id || priceRecord?.key || masterRecord?.id) || createMasterIngredientId(name) || createInvoiceKey(name);

  if (!db || !name || !id) {
    return { ok: false, skipped: true };
  }

  const unit = sanitizeString(priceRecord?.unit || priceRecord?.priceUnit) || 'each';
  const latestCost = sanitizeNumber(priceRecord?.price ?? priceRecord?.latestCost ?? priceRecord?.lastPriceExVAT);
  const baseUnit = sanitizeString(masterRecord?.baseUnit || priceRecord?.baseUnit);
  const costPerBaseUnitExVAT = sanitizeNumber(priceRecord?.costPerBaseUnit);

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  const payload = {
    databaseId: getActiveDatabaseId(),
    id,
    key: id,
    name,
    canonicalName: sanitizeString(masterRecord?.canonicalName || name),
    aliases: uniqueMasterStrings([
      masterRecord?.aliases,
      priceRecord?.aliases,
      name,
      normalizeMasterIngredientName(name),
    ]),
    previousRawNames: uniqueMasterStrings(priceRecord?.previousRawNames),
    category: sanitizeString(priceRecord?.category) || 'Other',
    unit,
    defaultUnit: baseUnit || unit,
    active: true,
    source: sanitizeString(priceRecord?.source) || 'Manual ingredient price',
    latestCost,
    latestCostPerBaseUnit: roundUnitPrice(costPerBaseUnitExVAT),
    lastInvoicePrice: sanitizeNumber(priceRecord?.lastInvoicePrice ?? latestCost),
    lastPurchaseQuantity: sanitizeNumber(priceRecord?.lastPurchaseQuantity ?? 1),
    lastPurchaseUnit: baseUnit || unit,
    costUnit: unit,
    currentPrice: latestCost,
    lastPriceExVAT: latestCost,
    baseUnit,
    costPerBaseUnitExVAT: roundUnitPrice(costPerBaseUnitExVAT),
    updatedAt: serverTimestamp(),
    createdAt: priceRecord?.createdAt || serverTimestamp(),
  };

  await setDoc(doc(db, 'ingredients', scopeDocId(id)), payload, { merge: true });

  return { ok: true, ingredient: payload };
};

export const deleteIngredient = async (ingredientId) => {
  const db = await getFirestoreDb();
  const id = sanitizeString(ingredientId);

  if (!db || !id) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, getDoc, serverTimestamp, setDoc } = await getFirestoreApi();
  const ingredientRef = doc(db, 'ingredients', scopeDocId(id));
  const ingredientSnapshot = await getDoc(ingredientRef);
  const ingredient = ingredientSnapshot.data() || {};

  if (ingredientSnapshot.exists() && ingredient.databaseId !== getActiveDatabaseId()) {
    return { ok: false, skipped: true };
  }

  await setDoc(ingredientRef, {
    databaseId: getActiveDatabaseId(),
    id,
    name: sanitizeString(ingredient.name || ingredient.ingredientName) || id,
    category: sanitizeString(ingredient.category) || 'Other',
    unit: sanitizeString(ingredient.unit) || 'each',
    active: false,
    isDeleted: true,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { ok: true, ingredientId: id };
};

export const saveConfirmedInvoice = async ({
  invoiceId,
  invoiceNumber,
  supplierName,
  invoiceDate,
  receivedDate,
  lineItems,
  ingredientRows,
  totals,
  extractedTotals,
  vatRate,
  vatMode,
  rawText,
  scannerMetadata = null,
  confirmedBy = '',
  stockPostingStatus = 'not_posted',
}) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  const safeSupplierName = sanitizeString(supplierName) || 'Unknown supplier';
  const safeInvoiceId = sanitizeString(invoiceId) || createRecordId('invoice');
  const safeLineItems = Array.isArray(lineItems) ? lineItems : [];
  const safeTotals = totals || {};
  const safeExtractedTotals = extractedTotals || {};
  const safeInvoiceDate = sanitizeString(invoiceDate) || new Date().toISOString().slice(0, 10);
  const safeReceivedDate = sanitizeString(receivedDate) || safeInvoiceDate;
  const safeInvoiceNumber = sanitizeString(invoiceNumber) || safeInvoiceId;
  const supplierId = createSupplierId(safeSupplierName);
  const confirmedAt = new Date().toISOString();
  const safeStockPostingStatus = ['not_posted', 'posted', 'prices_only', 'historical', 'historical_posted'].includes(stockPostingStatus)
    ? stockPostingStatus
    : 'not_posted';

  await ensureFirebaseAuth();
  const { doc, getDoc, increment, serverTimestamp, setDoc } = await getFirestoreApi();
  const supplierRef = doc(db, 'suppliers', scopeDocId(supplierId));
  const supplierSnapshot = await getDoc(supplierRef).catch(() => null);

  await setDoc(doc(db, 'invoices', scopeDocId(safeInvoiceId)), {
    databaseId: getActiveDatabaseId(),
    id: safeInvoiceId,
    invoiceDate: safeInvoiceDate,
    receivedDate: safeReceivedDate,
    date: safeInvoiceDate,
    invoiceNumber: safeInvoiceNumber,
    supplier: safeSupplierName,
    supplierId,
    totalExVAT: roundMoney(safeTotals.totalExVAT),
    subtotal: roundMoney(safeTotals.totalExVAT),
    totalVAT: roundMoney(safeTotals.totalVAT),
    vat: roundMoney(safeTotals.totalVAT),
    totalIncVAT: roundMoney(safeTotals.totalIncVAT),
    total: roundMoney(safeTotals.totalIncVAT),
    extractedTotals: {
      totalExVAT: roundMoney(safeExtractedTotals.totalExVAT),
      totalVAT: roundMoney(safeExtractedTotals.totalVAT),
      totalIncVAT: roundMoney(safeExtractedTotals.totalIncVAT),
    },
    totalsSource: 'reviewed-line-items',
    lineItems: safeLineItems,
    ingredientRows: Array.isArray(ingredientRows) ? ingredientRows : [],
    scannedAt: new Date().toISOString(),
    status: safeStockPostingStatus === 'prices_only'
      ? 'prices_only'
      : safeStockPostingStatus === 'historical'
        ? 'historical'
        : 'confirmed',
    confirmedAt,
    confirmedBy: sanitizeString(confirmedBy) || 'WasteShift user',
    stockPostingStatus: safeStockPostingStatus,
    stockPostedAt: '',
    stockPostedBy: '',
    stockMovementIds: [],
    vatRate: sanitizeNumber(vatRate, 0.15),
    vatMode: sanitizeString(vatMode) || 'inclusive',
    rawText: sanitizeString(rawText).slice(0, 12000),
    scannerMetadata: scannerMetadata && typeof scannerMetadata === 'object'
      ? {
          ocrEngineUsed: sanitizeNumber(scannerMetadata.ocrEngineUsed),
          scanDateTime: sanitizeString(scannerMetadata.scanDateTime),
          documentType: sanitizeString(scannerMetadata.documentType || 'invoice'),
          confidence: sanitizeNumber(scannerMetadata.confidence),
          reviewStatus: sanitizeString(scannerMetadata.reviewStatus || 'needs_review'),
          restaurantId: sanitizeString(scannerMetadata.restaurantId),
        }
      : null,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(supplierRef, {
    databaseId: getActiveDatabaseId(),
    id: supplierId,
    name: safeSupplierName,
    contactInfo: sanitizeString(supplierSnapshot?.data()?.contactInfo),
    paymentTerms: sanitizeString(supplierSnapshot?.data()?.paymentTerms),
    lastInvoiceDate: safeInvoiceDate,
    totalSpend: increment(roundMoney(safeTotals.totalExVAT)),
    ingredientCount: Array.isArray(ingredientRows) ? new Set(ingredientRows.map((row) => row.ingredientId).filter(Boolean)).size : 0,
    ...(!supplierSnapshot?.exists?.() ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await Promise.all((Array.isArray(ingredientRows) ? ingredientRows : [])
    .filter((row) => row?.ingredientId && row?.ingredientName)
    .map(async (row) => {
      const ingredientId = sanitizeString(row.ingredientId);
      const pricing = buildInvoiceIngredientPricing({}, row);
      const previousCostPerBaseUnit = sanitizeNumber(row.previousCostPerBaseUnit ?? row.previousCostPerBaseUnitExVAT ?? row.previousCostPerBaseUnitCost);
      const costPerBaseUnit = roundUnitPrice(row.costPerBaseUnit ?? row.costPerBaseUnitExVAT ?? pricing.costPerBaseUnit);
      const priceChangePercent = getPriceChangeFromBaseCost(previousCostPerBaseUnit, costPerBaseUnit) || sanitizeNumber(row.priceChangePercent);
      const canonicalName = sanitizeString(row.canonicalName || row.ingredientName);
      const rowAliases = uniqueMasterStrings([
        row.aliases,
        row.rawName,
        row.normalizedRawName,
        row.ingredientName,
        canonicalName,
      ]);
      const historyId = `${safeInvoiceDate}-${safeInvoiceId}-${row.lineItemId || ingredientId}`.replace(/[^a-z0-9_-]/gi, '_');
      const historyPayload = {
        databaseId: getActiveDatabaseId(),
        ingredientId,
        rawName: sanitizeString(row.rawName || row.ingredientName),
        matchedIngredientId: sanitizeString(row.matchedIngredientId || ingredientId),
        canonicalName,
        supplierId,
        supplier: safeSupplierName,
        date: safeInvoiceDate,
        previousCost: roundMoney(row.previousPriceExVAT),
        newCost: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        previousCostPerBaseUnit: roundUnitPrice(previousCostPerBaseUnit),
        costPerBaseUnit,
        percentageChange: roundMoney(priceChangePercent),
        changedAt: safeInvoiceDate,
        changedBy: 'Invoice review',
        significantChange: Math.abs(Number(priceChangePercent || 0)) >= 10,
        priceChangePercent: roundMoney(priceChangePercent),
        price: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        priceExVAT: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        priceIncVAT: roundMoney(row.unitPriceIncVAT ?? row.priceIncVAT),
        linePriceExVAT: roundMoney(row.totalPrice ?? row.priceExVAT),
        linePriceIncVAT: roundMoney(row.priceIncVAT),
        quantity: sanitizeNumber(row.invoiceQuantity),
        unit: sanitizeString(row.invoiceUnit || row.priceUnit || row.unit) || 'each',
        purchaseQuantity: sanitizeNumber(row.quantity ?? row.invoiceQuantity),
        purchaseUnit: sanitizeString(row.unit || row.invoiceUnit || row.priceUnit) || 'each',
        convertedQuantity: sanitizeNumber(row.convertedQuantity ?? row.baseQuantity ?? pricing.convertedQuantity),
        baseQuantity: sanitizeNumber(row.convertedQuantity ?? row.baseQuantity ?? pricing.convertedQuantity),
        baseUnit: sanitizeString(row.baseUnit || pricing.baseUnit),
        totalPrice: roundMoney(row.totalPrice ?? row.priceExVAT),
        costPerBaseUnitExVAT: costPerBaseUnit,
        matchConfidence: sanitizeNumber(row.matchConfidence ?? row.matchScore),
        matchType: sanitizeString(row.matchType),
        needsReview: Boolean(row.needsReview),
        invoiceId: safeInvoiceId,
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'ingredients', scopeDocId(ingredientId)), {
        databaseId: getActiveDatabaseId(),
        id: ingredientId,
        key: ingredientId,
        name: sanitizeString(row.ingredientName),
        canonicalName,
        aliases: rowAliases,
        previousRawNames: uniqueMasterStrings([
          row.previousRawNames,
          row.rawName,
        ]),
        category: sanitizeString(row.category) || 'Other',
        unit: sanitizeString(row.priceUnit || row.invoiceUnit || row.unit) || 'each',
        defaultUnit: sanitizeString(row.baseUnit || pricing.baseUnit || row.priceUnit || row.invoiceUnit || row.unit) || 'each',
        preferredSupplier: safeSupplierName,
        supplier: safeSupplierName,
        source: safeSupplierName,
        supplierId,
        active: true,
        notes: sanitizeString(row.notes),
        parLevel: sanitizeNumber(row.parLevel),
        reorderPoint: sanitizeNumber(row.reorderPoint),
        latestCost: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        latestCostPerBaseUnit: costPerBaseUnit,
        lastInvoicePrice: roundMoney(row.totalPrice ?? row.priceExVAT),
        lastPurchaseQuantity: sanitizeNumber(row.convertedQuantity ?? row.baseQuantity ?? pricing.convertedQuantity),
        lastPurchaseUnit: sanitizeString(row.baseUnit || pricing.baseUnit),
        costUnit: sanitizeString(row.invoiceUnit || row.priceUnit || row.unit) || 'each',
        currentPrice: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        currentPriceIncVAT: roundMoney(row.unitPriceIncVAT ?? row.priceIncVAT),
        lastPriceExVAT: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        lastPriceIncVAT: roundMoney(row.unitPriceIncVAT ?? row.priceIncVAT),
        lastLineTotalExVAT: roundMoney(row.totalPrice ?? row.priceExVAT),
        lastLineTotalIncVAT: roundMoney(row.priceIncVAT),
        lastQuantity: sanitizeNumber(row.invoiceQuantity),
        lastUnit: sanitizeString(row.invoiceUnit || row.priceUnit || row.unit) || 'each',
        baseQuantity: sanitizeNumber(row.convertedQuantity ?? row.baseQuantity ?? pricing.convertedQuantity),
        baseUnit: sanitizeString(row.baseUnit || pricing.baseUnit),
        costPerBaseUnitExVAT: costPerBaseUnit,
        linkedMenuItemIds: uniqueStrings(row.linkedMenuItemIds),
        linkedRecipeNames: uniqueStrings(row.linkedRecipeNames),
        lastInvoiceDate: safeInvoiceDate,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await Promise.all([
        setDoc(doc(db, 'ingredients', scopeDocId(ingredientId), 'priceHistory', historyId), historyPayload, { merge: true }),
        setDoc(doc(db, 'priceHistory', scopeDocId(`${ingredientId}-${historyId}`)), {
          id: `${ingredientId}-${historyId}`,
          ...historyPayload,
        }, { merge: true }),
      ]);
    }));

  return { ok: true, invoiceId: safeInvoiceId };
};

export const softDeleteInvoice = async (invoiceId, { deletedBy = '' } = {}) => {
  const db = await getFirestoreDb();
  const safeInvoiceId = sanitizeString(invoiceId);

  if (!db || !safeInvoiceId) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { collection, doc, getDoc, getDocs, increment, serverTimestamp, setDoc, updateDoc } = await getFirestoreApi();
  const invoiceRef = doc(db, 'invoices', scopeDocId(safeInvoiceId));
  const invoiceSnapshot = await getDoc(invoiceRef);

  if (!invoiceSnapshot.exists()) {
    return { ok: false, skipped: true };
  }

  const invoice = invoiceSnapshot.data() || {};

  if (invoice.databaseId !== getActiveDatabaseId()) {
    return { ok: false, skipped: true };
  }

  if (String(invoice.status || '').toLowerCase() === 'deleted') {
    return { ok: true, invoiceId: safeInvoiceId, alreadyDeleted: true };
  }

  const topLevelHistorySnapshot = await getDocs(collection(db, 'priceHistory')).catch(() => ({ docs: [] }));
  const topLevelDocsToDelete = topLevelHistorySnapshot.docs.filter((docSnapshot) => (
    docSnapshot.data()?.databaseId === getActiveDatabaseId()
    &&
    sanitizeString(docSnapshot.data()?.invoiceId) === safeInvoiceId
  ));
  const ingredientIds = uniqueStrings([
    ...(Array.isArray(invoice.ingredientRows) ? invoice.ingredientRows.map((row) => row?.ingredientId) : []),
    ...topLevelDocsToDelete.map((docSnapshot) => docSnapshot.data()?.ingredientId),
  ]);
  let removedHistoryCount = topLevelDocsToDelete.length;

  const safeDeletedBy = sanitizeString(deletedBy) || 'System';

  await Promise.all(topLevelDocsToDelete.map((docSnapshot) => setDoc(docSnapshot.ref, {
    status: 'deleted',
    isDeleted: true,
    deletedAt: serverTimestamp(),
    deletedBy: safeDeletedBy,
  }, { merge: true })));

  await Promise.all(ingredientIds.map(async (ingredientId) => {
    const historySnapshot = await getDocs(collection(db, 'ingredients', scopeDocId(ingredientId), 'priceHistory')).catch(() => ({ docs: [] }));
    const nestedDocsToDelete = historySnapshot.docs.filter((docSnapshot) => (
      docSnapshot.data()?.databaseId === getActiveDatabaseId()
      &&
      sanitizeString(docSnapshot.data()?.invoiceId) === safeInvoiceId
    ));

    removedHistoryCount += nestedDocsToDelete.length;
    await Promise.all(nestedDocsToDelete.map((docSnapshot) => setDoc(docSnapshot.ref, {
      status: 'deleted',
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedBy: safeDeletedBy,
    }, { merge: true })));
  }));

  await Promise.all(ingredientIds.map((ingredientId) => refreshIngredientLatestPrice(db, ingredientId, safeInvoiceId)));

  await updateDoc(invoiceRef, {
    status: 'deleted',
    deletedAt: serverTimestamp(),
    deletedBy: safeDeletedBy,
    previousStatus: sanitizeString(invoice.status) || 'confirmed',
    priceHistoryRemoved: removedHistoryCount,
    updatedAt: serverTimestamp(),
  });

  const supplierId = sanitizeString(invoice.supplierId);

  if (supplierId) {
    await setDoc(doc(db, 'suppliers', scopeDocId(supplierId)), {
      databaseId: getActiveDatabaseId(),
      totalSpend: increment(-roundMoney(invoice.totalExVAT)),
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }

  return {
    ok: true,
    invoiceId: safeInvoiceId,
    removedHistoryCount,
    affectedIngredientCount: ingredientIds.length,
  };
};

export const updateStockFromInvoice = async ({
  invoiceId,
  lineItems,
  ingredientRows,
  postingMode = 'posted',
  postedBy = '',
}) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, runTransaction, serverTimestamp } = await getFirestoreApi();
  const invoiceRef = doc(db, 'invoices', scopeDocId(invoiceId));
  const nextPostingStatus = postingMode === 'historical_posted' ? 'historical_posted' : 'posted';
  const safeLineItems = Array.isArray(lineItems) ? lineItems : [];
  const postingGroups = new Map();

  (Array.isArray(ingredientRows) ? ingredientRows : []).forEach((row) => {
    const ingredientId = sanitizeString(row?.ingredientId);
    const lineItem = safeLineItems.find((item) => item.id === row.lineItemId);

    if (!ingredientId || !lineItem) {
      return;
    }

    const group = postingGroups.get(ingredientId) || { ingredientId, row, items: [] };
    group.items.push({ row, lineItem });
    postingGroups.set(ingredientId, group);
  });

  return runTransaction(db, async (transaction) => {
    const invoiceSnapshot = await transaction.get(invoiceRef);
    const invoiceData = invoiceSnapshot.data() || {};

    if (!invoiceSnapshot.exists() || invoiceData.databaseId !== getActiveDatabaseId()) {
      return { ok: false, skipped: true, updates: [], stockMovementIds: [] };
    }

    const currentPostingStatus = sanitizeString(invoiceData.stockPostingStatus);

    if (['posted', 'historical_posted'].includes(currentPostingStatus)) {
      return {
        ok: true,
        alreadyPosted: true,
        updates: [],
        stockMovementIds: Array.isArray(invoiceData.stockMovementIds) ? invoiceData.stockMovementIds : [],
        message: 'Stock was already updated for this invoice.',
      };
    }

    const groups = [...postingGroups.values()];
    const stockRefs = groups.map((group) => doc(db, 'stockLevels', scopeDocId(group.ingredientId)));
    const stockSnapshots = await Promise.all(stockRefs.map((stockRef) => transaction.get(stockRef)));
    const updates = [];
    const stockMovementIds = [];

    groups.forEach((group, groupIndex) => {
      const stockRef = stockRefs[groupIndex];
      const stockSnapshot = stockSnapshots[groupIndex];
      const startingQty = sanitizeNumber(stockSnapshot.data()?.currentQty);
      const parLevel = sanitizeNumber(group.row.parLevel);
      const reorderPoint = sanitizeNumber(group.row.reorderPoint);
      let runningQty = startingQty;
      let lastMovementId = '';

      group.items.forEach(({ row, lineItem }) => {
        const incomingQty = sanitizeNumber(lineItem.baseQuantity || lineItem.quantity, 0);
        const previousQty = runningQty;
        runningQty = roundMoney(runningQty + incomingQty);
        const status = parLevel > 0 && runningQty > parLevel
          ? 'overstocked'
          : reorderPoint > 0 && runningQty <= reorderPoint
            ? 'low'
            : 'ok';
        const movementId = createStockMovementId({
          invoiceId,
          lineItemId: lineItem.id || row.lineItemId,
          ingredientId: group.ingredientId,
        });
        const movementRecord = createStockMovementRecord({
          movementId,
          invoiceId,
          invoiceNumber: invoiceData.invoiceNumber,
          supplier: invoiceData.supplier,
          invoiceDate: invoiceData.invoiceDate,
          receivedDate: invoiceData.receivedDate,
          lineItem,
          ingredientRow: row,
          previousQty,
          incomingQty,
          nextQty: runningQty,
          unit: lineItem.baseUnit || lineItem.unit || row.unit || 'each',
          status,
          postingMode: nextPostingStatus,
          postedBy,
          createdAt: serverTimestamp(),
        });

        lastMovementId = movementId;
        stockMovementIds.push(movementId);
        transaction.set(doc(db, 'stockMovements', scopeDocId(movementId)), {
          databaseId: getActiveDatabaseId(),
          ...movementRecord,
        }, { merge: true });
        updates.push({
          ingredientId: group.ingredientId,
          ingredientName: row.ingredientName,
          previousQty,
          incomingQty,
          currentQty: runningQty,
          unit: lineItem.baseUnit || lineItem.unit || row.unit || 'each',
          status,
        });
      });

      const finalStatus = parLevel > 0 && runningQty > parLevel
        ? 'overstocked'
        : reorderPoint > 0 && runningQty <= reorderPoint
          ? 'low'
          : 'ok';
      const finalLineItem = group.items[group.items.length - 1]?.lineItem || {};
      transaction.set(stockRef, {
        databaseId: getActiveDatabaseId(),
        ingredientId: group.ingredientId,
        currentQty: runningQty,
        unit: finalLineItem.baseUnit || finalLineItem.unit || group.row.unit || 'each',
        lastUpdated: serverTimestamp(),
        lastInvoiceId: invoiceId,
        lastMovementId,
        status: finalStatus,
        parLevel,
        reorderPoint,
      }, { merge: true });
    });

    transaction.update(invoiceRef, {
      stockUpdatedAt: serverTimestamp(),
      stockUpdateCount: updates.length,
      stockPostingStatus: nextPostingStatus,
      stockPostedAt: serverTimestamp(),
      stockPostedBy: sanitizeString(postedBy) || 'WasteShift user',
      stockMovementIds,
      status: nextPostingStatus === 'historical_posted' ? 'historical_stock' : 'posted_to_stock',
    });

    return { ok: true, updates, stockMovementIds };
  });
};

export const loadInvoiceDashboardStats = async () => {
  if (!hasFirebaseConfig) {
    return {
      totalSpendThisMonth: 0,
      totalSpendTodayExVAT: 0,
      totalSpendThisWeekExVAT: 0,
      totalSpendThisWeekIncVAT: 0,
      totalVatThisWeek: 0,
      totalSpendThisMonthExVAT: 0,
      totalSpendThisMonthIncVAT: 0,
      invoiceCountThisWeek: 0,
      topSuppliersThisWeek: [],
      topIngredients: [],
      priceIncreasesThisMonth: [],
      significantPriceIncreaseCount: 0,
      missingCostCount: 0,
      missingCostIngredients: [],
      lowStockCount: 0,
      lastInvoice: null,
    };
  }

  const [ingredientDocs, invoiceDocs, stockDocs, priceHistoryDocs] = await Promise.all([
    readCollection('ingredients'),
    readCollection('invoices', { orderByField: 'invoiceDate', limitCount: 500 }),
    readCollection('stockLevels'),
    readCollection('priceHistory', { orderByField: 'date', limitCount: 1000 }),
  ]);
  const ingredients = mergeTopLevelPriceHistory(
    ingredientDocs.map(normalizeIngredient).filter(Boolean),
    priceHistoryDocs
  );
  const invoices = invoiceDocs.sort((a, b) => (
    new Date(b.invoiceDate || b.scannedAt || 0).getTime() - new Date(a.invoiceDate || a.scannedAt || 0).getTime()
  ));
  const stockLevels = stockDocs.map(normalizeStockLevel).filter(Boolean);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const weekStart = new Date(todayStart);
  const dayOfWeek = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const inactiveStatuses = new Set(['deleted', 'voided', 'cancelled', 'canceled']);
  const getInvoiceDate = (invoice) => new Date(invoice.invoiceDate || invoice.scannedAt || invoice.createdAt || 0);
  const getInvoiceExVat = (invoice) => Number(invoice.totalExVAT ?? invoice.totalExVat ?? invoice.subtotal ?? 0);
  const getInvoiceVat = (invoice) => Number(invoice.vatAmount ?? invoice.totalVAT ?? invoice.totalVat ?? 0);
  const getInvoiceIncVat = (invoice) => {
    const explicitTotal = Number(invoice.totalIncVAT ?? invoice.totalIncVat ?? invoice.totalAmount ?? invoice.total ?? 0);

    return explicitTotal > 0 ? explicitTotal : getInvoiceExVat(invoice) + getInvoiceVat(invoice);
  };
  const activeInvoices = invoices.filter((invoice) => !inactiveStatuses.has(String(invoice.status || '').toLowerCase()));
  const invoicesToday = activeInvoices.filter((invoice) => {
    const invoiceDate = getInvoiceDate(invoice);
    return invoiceDate >= todayStart && invoiceDate < tomorrowStart;
  });
  const invoicesThisWeek = activeInvoices.filter((invoice) => {
    const invoiceDate = getInvoiceDate(invoice);
    return invoiceDate >= weekStart && invoiceDate < tomorrowStart;
  });
  const invoicesThisMonth = activeInvoices.filter((invoice) => (
    getInvoiceDate(invoice) >= monthStart
  ));
  const suppliersThisWeek = invoicesThisWeek.reduce((acc, invoice) => {
    const supplier = String(invoice.supplier || invoice.supplierName || 'Unknown supplier').trim() || 'Unknown supplier';
    const current = acc.get(supplier) || { supplier, invoiceCount: 0, totalExVAT: 0, totalIncVAT: 0 };

    current.invoiceCount += 1;
    current.totalExVAT += getInvoiceExVat(invoice);
    current.totalIncVAT += getInvoiceIncVat(invoice);
    acc.set(supplier, current);
    return acc;
  }, new Map());
  const normalizedIngredients = ingredients
    .map(normalizeIngredientRecord)
    .filter(Boolean);
  const missingCostIngredients = normalizedIngredients
    .filter((ingredient) => ingredient.active && Number(ingredient.latestCost || 0) <= 0)
    .map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      supplier: ingredient.supplier || ingredient.preferredSupplier || '',
    }));
  const significantPriceIncreases = ingredients
    .map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      latestDate: new Date(ingredient.lastInvoiceDate || 0),
      change: getLatestPriceChange(ingredient),
    }))
    .filter((item) => (
      item.change.significant
      && item.change.direction === 'up'
      && item.latestDate >= monthStart
    ));
  const topIngredients = [...ingredients]
    .sort((a, b) => Number(b.lastPriceExVAT || 0) - Number(a.lastPriceExVAT || 0))
    .slice(0, 5)
    .map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      priceExVAT: roundMoney(ingredient.lastPriceExVAT),
    }));
  const priceIncreasesThisMonth = ingredients
    .map((ingredient) => {
      const history = Array.isArray(ingredient.priceHistory) ? ingredient.priceHistory : [];
      const latest = history[history.length - 1];
      const previous = history[history.length - 2];
      const latestDate = latest?.date ? new Date(latest.date) : null;
      const increasePercent = previous?.priceExVAT > 0
        ? roundMoney(((Number(latest?.priceExVAT || 0) - Number(previous.priceExVAT)) / Number(previous.priceExVAT)) * 100)
        : 0;

      return {
        id: ingredient.id,
        name: ingredient.name,
        increasePercent,
        latestDate,
      };
    })
    .filter((item) => item.increasePercent > 0 && item.latestDate && item.latestDate >= monthStart);

  return {
    totalSpendTodayExVAT: roundMoney(invoicesToday.reduce((sum, invoice) => sum + getInvoiceExVat(invoice), 0)),
    totalSpendThisWeekExVAT: roundMoney(invoicesThisWeek.reduce((sum, invoice) => sum + getInvoiceExVat(invoice), 0)),
    totalSpendThisWeekIncVAT: roundMoney(invoicesThisWeek.reduce((sum, invoice) => sum + getInvoiceIncVat(invoice), 0)),
    totalVatThisWeek: roundMoney(invoicesThisWeek.reduce((sum, invoice) => sum + getInvoiceVat(invoice), 0)),
    totalSpendThisMonthExVAT: roundMoney(invoicesThisMonth.reduce((sum, invoice) => sum + getInvoiceExVat(invoice), 0)),
    totalSpendThisMonthIncVAT: roundMoney(invoicesThisMonth.reduce((sum, invoice) => sum + getInvoiceIncVat(invoice), 0)),
    totalSpendThisMonth: roundMoney(invoicesThisMonth.reduce((sum, invoice) => sum + getInvoiceExVat(invoice), 0)),
    invoiceCountThisWeek: invoicesThisWeek.length,
    topSuppliersThisWeek: [...suppliersThisWeek.values()]
      .sort((a, b) => b.totalExVAT - a.totalExVAT)
      .slice(0, 5)
      .map((supplier) => ({
        ...supplier,
        totalExVAT: roundMoney(supplier.totalExVAT),
        totalIncVAT: roundMoney(supplier.totalIncVAT),
      })),
    topIngredients,
    priceIncreasesThisMonth,
    significantPriceIncreaseCount: significantPriceIncreases.length,
    missingCostCount: missingCostIngredients.length,
    missingCostIngredients: missingCostIngredients.slice(0, 5),
    lowStockCount: stockLevels.filter((stock) => stock.status === 'low').length,
    lastInvoice: activeInvoices[0] || null,
  };
};
