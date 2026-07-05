import { createInvoiceKey, roundMoney } from '../utils/invoiceParsing';
import { createRecordId } from '../utils/ids';
import { roundUnitPrice } from '../utils/itemPriceCatalog';
import { createStockMovementId, createStockMovementRecord } from '../utils/stockLedger';
import {
  findDuplicateIngredient,
  getLatestPriceChange,
  normalizeIngredientRecord,
} from '../utils/ingredientIntelligence';

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
let anonymousAuthPromise = null;
let firestoreApiPromise = null;
let firebaseAuthPromise = null;

const getFirestoreApi = async () => {
  if (!firestoreApiPromise) {
    firestoreApiPromise = Promise.all([
      import('firebase/app'),
      import('firebase/firestore'),
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
      serverTimestamp: firestore.serverTimestamp,
      setDoc: firestore.setDoc,
      updateDoc: firestore.updateDoc,
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

const readCollection = async (collectionName, options = {}) => {
  const db = await getFirestoreDb();

  if (!db) {
    return [];
  }

  await ensureFirebaseAuth();
  const { collection, getDocs, limit, orderBy, query } = await getFirestoreApi();
  const constraints = [];

  if (options.orderByField) {
    constraints.push(orderBy(options.orderByField, options.direction || 'desc'));
  }

  if (options.limitCount) {
    constraints.push(limit(Math.max(1, Number(options.limitCount) || 1)));
  }

  const collectionRef = collection(db, collectionName);
  const snapshot = constraints.length > 0
    ? await getDocs(query(collectionRef, ...constraints))
    : await getDocs(collectionRef);
  return snapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));
};

const normalizeIngredient = (docData) => {
  const normalizedRecord = normalizeIngredientRecord(docData);

  if (!normalizedRecord || !normalizedRecord.active) {
    return null;
  }

  return {
    ...docData,
    ...normalizedRecord,
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
    baseUnit: sanitizeString(docData?.baseUnit),
    baseQuantity: sanitizeNumber(docData?.baseQuantity),
    costPerBaseUnitExVAT: sanitizeNumber(docData?.costPerBaseUnitExVAT),
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
  const { collection, getDocs } = await getFirestoreApi();
  const snapshot = await getDocs(collection(db, 'ingredients', ingredient.id, 'priceHistory'));
  const priceHistory = snapshot.docs
    .map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data(),
    }))
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

  return { ...ingredient, priceHistory };
};

const normalizePriceHistory = (docData) => {
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
  const { collection, getDocs } = await getFirestoreApi();
  const snapshot = await getDocs(collection(db, 'priceHistory')).catch(() => ({ docs: [] }));

  return snapshot.docs.map((docSnapshot) => ({
    docSnapshot,
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));
};

const getIngredientPriceHistoryDocs = async (db, ingredientId) => {
  const { collection, getDocs } = await getFirestoreApi();
  const snapshot = await getDocs(collection(db, 'ingredients', ingredientId, 'priceHistory')).catch(() => ({ docs: [] }));

  return snapshot.docs.map((docSnapshot) => ({
    docSnapshot,
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));
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
  const ingredientRef = doc(db, 'ingredients', safeIngredientId);
  const ingredientSnapshot = await getDoc(ingredientRef).catch(() => null);

  if (!ingredientSnapshot?.exists?.()) {
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
    baseQuantity: sanitizeNumber(latestHistory.baseQuantity),
    baseUnit: sanitizeString(latestHistory.baseUnit),
    costPerBaseUnitExVAT: roundUnitPrice(latestHistory.costPerBaseUnitExVAT),
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

  const [ingredientDocs, menuItemDocs, stockDocs, stockMovementDocs, invoiceDocs, supplierDocs, priceHistoryDocs] = await Promise.all([
    readCollection('ingredients'),
    readCollection('menuItems'),
    readCollection('stockLevels'),
    readCollection('stockMovements', { orderByField: 'createdAt', limitCount: 500 }),
    readCollection('invoices', { orderByField: 'invoiceDate', limitCount: 300 }),
    readCollection('suppliers'),
    readCollection('priceHistory', { orderByField: 'date', limitCount: 750 }),
  ]);
  const db = await getFirestoreDb();
  const { doc, getDoc } = await getFirestoreApi();
  const settingsSnapshot = await getDoc(doc(db, 'settings', 'invoiceConfig'));
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
    stockMovements: stockMovementDocs
      .map(normalizeStockMovement)
      .filter(Boolean)
      .sort((a, b) => new Date(b.sortDate || 0).getTime() - new Date(a.sortDate || 0).getTime()),
    invoices: invoiceDocs.sort((a, b) => new Date(b.invoiceDate || b.scannedAt || 0).getTime() - new Date(a.invoiceDate || a.scannedAt || 0).getTime()),
    suppliers: supplierDocs,
    settings: {
      vatRate: sanitizeNumber(settingsSnapshot.data()?.vatRate, 0.15),
    },
  };
};

export const saveInvoiceSettings = async ({ vatRate }) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  await setDoc(doc(db, 'settings', 'invoiceConfig'), {
    vatRate: sanitizeNumber(vatRate, 0.15),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { ok: true };
};

export const saveIngredient = async (ingredientDraft) => {
  const db = await getFirestoreDb();
  const name = sanitizeString(ingredientDraft?.name);
  const id = sanitizeString(ingredientDraft?.id) || createInvoiceKey(name);

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
  const payload = {
    id,
    name,
    category: sanitizeString(ingredientDraft?.category) || 'Other',
    unit: sanitizeString(ingredientDraft?.unit) || costUnit,
    defaultUnit: sanitizeString(ingredientDraft?.defaultUnit || ingredientDraft?.unit) || costUnit,
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
    costUnit,
    currentPrice: latestCost,
    currentPriceIncVAT: sanitizeNumber(ingredientDraft?.currentPriceIncVAT ?? ingredientDraft?.lastPriceIncVAT),
    lastPriceExVAT: sanitizeNumber(ingredientDraft?.lastPriceExVAT ?? latestCost),
    lastPriceIncVAT: sanitizeNumber(ingredientDraft?.lastPriceIncVAT),
    updatedAt: serverTimestamp(),
    createdAt: ingredientDraft?.createdAt || serverTimestamp(),
  };

  await setDoc(doc(db, 'ingredients', id), payload, { merge: true });
  if (supplierName) {
    await setDoc(doc(db, 'suppliers', supplierId), {
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
  const name = sanitizeString(priceRecord?.name);
  const id = sanitizeString(priceRecord?.id || priceRecord?.key) || createInvoiceKey(name);

  if (!db || !name || !id) {
    return { ok: false, skipped: true };
  }

  const unit = sanitizeString(priceRecord?.unit || priceRecord?.priceUnit) || 'each';
  const latestCost = sanitizeNumber(priceRecord?.price ?? priceRecord?.latestCost ?? priceRecord?.lastPriceExVAT);
  const baseUnit = sanitizeString(priceRecord?.baseUnit);
  const costPerBaseUnitExVAT = sanitizeNumber(priceRecord?.costPerBaseUnit);

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  const payload = {
    id,
    key: id,
    name,
    category: sanitizeString(priceRecord?.category) || 'Other',
    unit,
    defaultUnit: baseUnit || unit,
    active: true,
    source: sanitizeString(priceRecord?.source) || 'Manual ingredient price',
    latestCost,
    costUnit: unit,
    currentPrice: latestCost,
    lastPriceExVAT: latestCost,
    baseUnit,
    costPerBaseUnitExVAT: roundUnitPrice(costPerBaseUnitExVAT),
    updatedAt: serverTimestamp(),
    createdAt: priceRecord?.createdAt || serverTimestamp(),
  };

  await setDoc(doc(db, 'ingredients', id), payload, { merge: true });

  return { ok: true, ingredient: payload };
};

export const deleteIngredient = async (ingredientId) => {
  const db = await getFirestoreDb();
  const id = sanitizeString(ingredientId);

  if (!db || !id) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } = await getFirestoreApi();
  const ingredientRef = doc(db, 'ingredients', id);
  const ingredientSnapshot = await getDoc(ingredientRef);
  const ingredient = ingredientSnapshot.data() || {};

  await setDoc(ingredientRef, {
    id,
    name: sanitizeString(ingredient.name || ingredient.ingredientName) || id,
    category: sanitizeString(ingredient.category) || 'Other',
    unit: sanitizeString(ingredient.unit) || 'each',
    isDeleted: true,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  const historySnapshot = await getDocs(collection(db, 'ingredients', id, 'priceHistory')).catch(() => ({ docs: [] }));

  await Promise.all(historySnapshot.docs.map((docSnapshot) => deleteDoc(docSnapshot.ref).catch(() => {})));
  await Promise.all([
    deleteDoc(doc(db, 'stockLevels', id)).catch(() => {}),
    deleteDoc(ingredientRef).catch(() => {}),
  ]);

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
  const supplierRef = doc(db, 'suppliers', supplierId);
  const supplierSnapshot = await getDoc(supplierRef).catch(() => null);

  await setDoc(doc(db, 'invoices', safeInvoiceId), {
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
      const historyId = `${safeInvoiceDate}-${safeInvoiceId}-${row.lineItemId || ingredientId}`.replace(/[^a-z0-9_-]/gi, '_');
      const historyPayload = {
        ingredientId,
        supplierId,
        supplier: safeSupplierName,
        date: safeInvoiceDate,
        previousCost: roundMoney(row.previousPriceExVAT),
        newCost: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        changedAt: safeInvoiceDate,
        changedBy: 'Invoice review',
        significantChange: Math.abs(Number(row.priceChangePercent || 0)) >= 10,
        priceChangePercent: roundMoney(row.priceChangePercent),
        price: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        priceExVAT: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        priceIncVAT: roundMoney(row.unitPriceIncVAT ?? row.priceIncVAT),
        linePriceExVAT: roundMoney(row.priceExVAT),
        linePriceIncVAT: roundMoney(row.priceIncVAT),
        quantity: sanitizeNumber(row.invoiceQuantity),
        unit: sanitizeString(row.invoiceUnit || row.priceUnit || row.unit) || 'each',
        baseQuantity: sanitizeNumber(row.baseQuantity),
        baseUnit: sanitizeString(row.baseUnit),
        costPerBaseUnitExVAT: roundUnitPrice(row.costPerBaseUnitExVAT),
        invoiceId: safeInvoiceId,
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'ingredients', ingredientId), {
        id: ingredientId,
        name: sanitizeString(row.ingredientName),
        category: sanitizeString(row.category) || 'Other',
        unit: sanitizeString(row.priceUnit || row.invoiceUnit || row.unit) || 'each',
        defaultUnit: sanitizeString(row.priceUnit || row.invoiceUnit || row.unit) || 'each',
        preferredSupplier: safeSupplierName,
        supplier: safeSupplierName,
        source: safeSupplierName,
        supplierId,
        active: true,
        notes: sanitizeString(row.notes),
        parLevel: sanitizeNumber(row.parLevel),
        reorderPoint: sanitizeNumber(row.reorderPoint),
        latestCost: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        costUnit: sanitizeString(row.invoiceUnit || row.priceUnit || row.unit) || 'each',
        currentPrice: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        currentPriceIncVAT: roundMoney(row.unitPriceIncVAT ?? row.priceIncVAT),
        lastPriceExVAT: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        lastPriceIncVAT: roundMoney(row.unitPriceIncVAT ?? row.priceIncVAT),
        lastLineTotalExVAT: roundMoney(row.priceExVAT),
        lastLineTotalIncVAT: roundMoney(row.priceIncVAT),
        lastQuantity: sanitizeNumber(row.invoiceQuantity),
        lastUnit: sanitizeString(row.invoiceUnit || row.priceUnit || row.unit) || 'each',
        baseQuantity: sanitizeNumber(row.baseQuantity),
        baseUnit: sanitizeString(row.baseUnit),
        costPerBaseUnitExVAT: roundUnitPrice(row.costPerBaseUnitExVAT),
        linkedMenuItemIds: uniqueStrings(row.linkedMenuItemIds),
        linkedRecipeNames: uniqueStrings(row.linkedRecipeNames),
        lastInvoiceDate: safeInvoiceDate,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await Promise.all([
        setDoc(doc(db, 'ingredients', ingredientId, 'priceHistory', historyId), historyPayload, { merge: true }),
        setDoc(doc(db, 'priceHistory', `${ingredientId}-${historyId}`), {
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
  const { collection, deleteDoc, doc, getDoc, getDocs, increment, serverTimestamp, setDoc, updateDoc } = await getFirestoreApi();
  const invoiceRef = doc(db, 'invoices', safeInvoiceId);
  const invoiceSnapshot = await getDoc(invoiceRef);

  if (!invoiceSnapshot.exists()) {
    return { ok: false, skipped: true };
  }

  const invoice = invoiceSnapshot.data() || {};

  if (String(invoice.status || '').toLowerCase() === 'deleted') {
    return { ok: true, invoiceId: safeInvoiceId, alreadyDeleted: true };
  }

  const topLevelHistorySnapshot = await getDocs(collection(db, 'priceHistory')).catch(() => ({ docs: [] }));
  const topLevelDocsToDelete = topLevelHistorySnapshot.docs.filter((docSnapshot) => (
    sanitizeString(docSnapshot.data()?.invoiceId) === safeInvoiceId
  ));
  const ingredientIds = uniqueStrings([
    ...(Array.isArray(invoice.ingredientRows) ? invoice.ingredientRows.map((row) => row?.ingredientId) : []),
    ...topLevelDocsToDelete.map((docSnapshot) => docSnapshot.data()?.ingredientId),
  ]);
  let removedHistoryCount = topLevelDocsToDelete.length;

  await Promise.all(topLevelDocsToDelete.map((docSnapshot) => deleteDoc(docSnapshot.ref)));

  await Promise.all(ingredientIds.map(async (ingredientId) => {
    const historySnapshot = await getDocs(collection(db, 'ingredients', ingredientId, 'priceHistory')).catch(() => ({ docs: [] }));
    const nestedDocsToDelete = historySnapshot.docs.filter((docSnapshot) => (
      sanitizeString(docSnapshot.data()?.invoiceId) === safeInvoiceId
    ));

    removedHistoryCount += nestedDocsToDelete.length;
    await Promise.all(nestedDocsToDelete.map((docSnapshot) => deleteDoc(docSnapshot.ref)));
  }));

  await Promise.all(ingredientIds.map((ingredientId) => refreshIngredientLatestPrice(db, ingredientId, safeInvoiceId)));

  await updateDoc(invoiceRef, {
    status: 'deleted',
    deletedAt: serverTimestamp(),
    deletedBy: sanitizeString(deletedBy) || 'System',
    previousStatus: sanitizeString(invoice.status) || 'confirmed',
    priceHistoryRemoved: removedHistoryCount,
    updatedAt: serverTimestamp(),
  });

  const supplierId = sanitizeString(invoice.supplierId);

  if (supplierId) {
    await setDoc(doc(db, 'suppliers', supplierId), {
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
  const { doc, getDoc, serverTimestamp, setDoc, updateDoc } = await getFirestoreApi();
  const invoiceRef = doc(db, 'invoices', invoiceId);
  const invoiceSnapshot = await getDoc(invoiceRef);
  const invoiceData = invoiceSnapshot.data() || {};
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

  const updates = [];
  const stockMovementIds = [];
  const nextPostingStatus = postingMode === 'historical_posted' ? 'historical_posted' : 'posted';

  for (const row of Array.isArray(ingredientRows) ? ingredientRows : []) {
    const ingredientId = sanitizeString(row?.ingredientId);
    const lineItem = (Array.isArray(lineItems) ? lineItems : []).find((item) => item.id === row.lineItemId);

    if (!ingredientId || !lineItem) {
      continue;
    }

    const stockRef = doc(db, 'stockLevels', ingredientId);
    const stockSnapshot = await getDoc(stockRef);
    const currentQty = sanitizeNumber(stockSnapshot.data()?.currentQty);
    const incomingQty = sanitizeNumber(lineItem.baseQuantity || lineItem.quantity, 0);
    const nextQty = roundMoney(currentQty + incomingQty);
    const parLevel = sanitizeNumber(row.parLevel);
    const reorderPoint = sanitizeNumber(row.reorderPoint);
    const status = parLevel > 0 && nextQty > parLevel
      ? 'overstocked'
      : reorderPoint > 0 && nextQty <= reorderPoint
        ? 'low'
        : 'ok';
    const movementId = createStockMovementId({
      invoiceId,
      lineItemId: lineItem.id || row.lineItemId,
      ingredientId,
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
      previousQty: currentQty,
      incomingQty,
      nextQty,
      unit: lineItem.baseUnit || lineItem.unit || row.unit || 'each',
      status,
      postingMode: nextPostingStatus,
      postedBy,
      createdAt: serverTimestamp(),
    });

    stockMovementIds.push(movementId);

    await Promise.all([
      setDoc(stockRef, {
        ingredientId,
        currentQty: nextQty,
        unit: lineItem.baseUnit || lineItem.unit || row.unit || 'each',
        lastUpdated: serverTimestamp(),
        lastInvoiceId: invoiceId,
        lastMovementId: movementId,
        status,
        parLevel,
        reorderPoint,
      }, { merge: true }),
      setDoc(doc(db, 'stockMovements', movementId), movementRecord, { merge: true }),
    ]);

    updates.push({
      ingredientId,
      ingredientName: row.ingredientName,
      previousQty: currentQty,
      incomingQty,
      currentQty: nextQty,
      unit: lineItem.baseUnit || lineItem.unit || row.unit || 'each',
      status,
    });
  }

  if (invoiceId) {
    await updateDoc(invoiceRef, {
      stockUpdatedAt: serverTimestamp(),
      stockUpdateCount: updates.length,
      stockPostingStatus: nextPostingStatus,
      stockPostedAt: serverTimestamp(),
      stockPostedBy: sanitizeString(postedBy) || 'WasteShift user',
      stockMovementIds,
      status: nextPostingStatus === 'historical_posted' ? 'historical_stock' : 'posted_to_stock',
    });
  }

  return { ok: true, updates, stockMovementIds };
};

export const loadInvoiceDashboardStats = async () => {
  if (!hasFirebaseConfig) {
    return {
      totalSpendThisMonth: 0,
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
    readCollection('invoices'),
    readCollection('stockLevels'),
    readCollection('priceHistory'),
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
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const activeInvoices = invoices.filter((invoice) => String(invoice.status || '').toLowerCase() !== 'deleted');
  const invoicesThisMonth = activeInvoices.filter((invoice) => (
    new Date(invoice.invoiceDate || invoice.scannedAt || 0) >= monthStart
  ));
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
    totalSpendThisMonth: roundMoney(invoicesThisMonth.reduce((sum, invoice) => sum + Number(invoice.totalExVAT || 0), 0)),
    topIngredients,
    priceIncreasesThisMonth,
    significantPriceIncreaseCount: significantPriceIncreases.length,
    missingCostCount: missingCostIngredients.length,
    missingCostIngredients: missingCostIngredients.slice(0, 5),
    lowStockCount: stockLevels.filter((stock) => stock.status === 'low').length,
    lastInvoice: activeInvoices[0] || null,
  };
};
