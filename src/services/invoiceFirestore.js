import { createInvoiceKey, roundMoney } from '../utils/invoiceParsing';

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

const readCollection = async (collectionName) => {
  const db = await getFirestoreDb();

  if (!db) {
    return [];
  }

  await ensureFirebaseAuth();
  const { collection, getDocs } = await getFirestoreApi();
  const snapshot = await getDocs(collection(db, collectionName));
  return snapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data(),
  }));
};

const normalizeIngredient = (docData) => {
  if (docData?.isDeleted || docData?.deletedAt) {
    return null;
  }

  const name = sanitizeString(docData?.name || docData?.ingredientName);
  const id = sanitizeString(docData?.id) || createInvoiceKey(name);

  if (!name || !id) {
    return null;
  }

  return {
    ...docData,
    id,
    name,
    category: sanitizeString(docData?.category) || 'Other',
    unit: sanitizeString(docData?.unit) || 'each',
    parLevel: sanitizeNumber(docData?.parLevel),
    reorderPoint: sanitizeNumber(docData?.reorderPoint),
    preferredSupplier: sanitizeString(docData?.preferredSupplier),
    supplierId: sanitizeString(docData?.supplierId),
    currentPrice: sanitizeNumber(docData?.currentPrice ?? docData?.lastPriceExVAT ?? docData?.priceExVAT),
    currentPriceIncVAT: sanitizeNumber(docData?.currentPriceIncVAT ?? docData?.lastPriceIncVAT ?? docData?.priceIncVAT),
    lastPriceExVAT: sanitizeNumber(docData?.lastPriceExVAT ?? docData?.priceExVAT),
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
    costPerBaseUnitExVAT: roundMoney(latestHistory.costPerBaseUnitExVAT),
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
      invoices: [],
      suppliers: [],
      settings: { vatRate: 0.15 },
    };
  }

  const [ingredientDocs, menuItemDocs, stockDocs, invoiceDocs, supplierDocs, priceHistoryDocs] = await Promise.all([
    readCollection('ingredients'),
    readCollection('menuItems'),
    readCollection('stockLevels'),
    readCollection('invoices'),
    readCollection('suppliers'),
    readCollection('priceHistory'),
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
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  const supplierName = sanitizeString(ingredientDraft?.preferredSupplier);
  const supplierId = sanitizeString(ingredientDraft?.supplierId) || createSupplierId(supplierName);
  const payload = {
    id,
    name,
    category: sanitizeString(ingredientDraft?.category) || 'Other',
    unit: sanitizeString(ingredientDraft?.unit) || 'each',
    parLevel: sanitizeNumber(ingredientDraft?.parLevel),
    reorderPoint: sanitizeNumber(ingredientDraft?.reorderPoint),
    preferredSupplier: supplierName,
    supplierId,
    linkedMenuItemIds: uniqueStrings(ingredientDraft?.linkedMenuItemIds),
    linkedRecipeNames: uniqueStrings(ingredientDraft?.linkedRecipeNames),
    currentPrice: sanitizeNumber(ingredientDraft?.currentPrice ?? ingredientDraft?.lastPriceExVAT),
    currentPriceIncVAT: sanitizeNumber(ingredientDraft?.currentPriceIncVAT ?? ingredientDraft?.lastPriceIncVAT),
    lastPriceExVAT: sanitizeNumber(ingredientDraft?.lastPriceExVAT),
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
  lineItems,
  ingredientRows,
  totals,
  extractedTotals,
  vatRate,
  vatMode,
  rawText,
}) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  const safeSupplierName = sanitizeString(supplierName) || 'Unknown supplier';
  const safeInvoiceId = sanitizeString(invoiceId) || `invoice_${Date.now()}`;
  const safeLineItems = Array.isArray(lineItems) ? lineItems : [];
  const safeTotals = totals || {};
  const safeExtractedTotals = extractedTotals || {};
  const safeInvoiceDate = sanitizeString(invoiceDate) || new Date().toISOString().slice(0, 10);
  const safeInvoiceNumber = sanitizeString(invoiceNumber) || safeInvoiceId;
  const supplierId = createSupplierId(safeSupplierName);

  await ensureFirebaseAuth();
  const { doc, getDoc, increment, serverTimestamp, setDoc } = await getFirestoreApi();
  const supplierRef = doc(db, 'suppliers', supplierId);
  const supplierSnapshot = await getDoc(supplierRef).catch(() => null);

  await setDoc(doc(db, 'invoices', safeInvoiceId), {
    id: safeInvoiceId,
    invoiceDate: safeInvoiceDate,
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
    status: 'confirmed',
    vatRate: sanitizeNumber(vatRate, 0.15),
    vatMode: sanitizeString(vatMode) || 'inclusive',
    rawText: sanitizeString(rawText).slice(0, 12000),
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
        price: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        priceExVAT: roundMoney(row.unitPriceExVAT ?? row.priceExVAT),
        priceIncVAT: roundMoney(row.unitPriceIncVAT ?? row.priceIncVAT),
        linePriceExVAT: roundMoney(row.priceExVAT),
        linePriceIncVAT: roundMoney(row.priceIncVAT),
        quantity: sanitizeNumber(row.invoiceQuantity),
        unit: sanitizeString(row.invoiceUnit || row.priceUnit || row.unit) || 'each',
        baseQuantity: sanitizeNumber(row.baseQuantity),
        baseUnit: sanitizeString(row.baseUnit),
        costPerBaseUnitExVAT: roundMoney(row.costPerBaseUnitExVAT),
        invoiceId: safeInvoiceId,
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'ingredients', ingredientId), {
        id: ingredientId,
        name: sanitizeString(row.ingredientName),
        category: sanitizeString(row.category) || 'Other',
        unit: sanitizeString(row.priceUnit || row.invoiceUnit || row.unit) || 'each',
        preferredSupplier: safeSupplierName,
        supplierId,
        parLevel: sanitizeNumber(row.parLevel),
        reorderPoint: sanitizeNumber(row.reorderPoint),
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
        costPerBaseUnitExVAT: roundMoney(row.costPerBaseUnitExVAT),
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

export const updateStockFromInvoice = async ({ invoiceId, lineItems, ingredientRows }) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, getDoc, serverTimestamp, setDoc, updateDoc } = await getFirestoreApi();
  const updates = [];

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

    await setDoc(stockRef, {
      ingredientId,
      currentQty: nextQty,
      unit: lineItem.baseUnit || lineItem.unit || row.unit || 'each',
      lastUpdated: serverTimestamp(),
      lastInvoiceId: invoiceId,
      status,
      parLevel,
      reorderPoint,
    }, { merge: true });

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
    await updateDoc(doc(db, 'invoices', invoiceId), {
      stockUpdatedAt: serverTimestamp(),
      stockUpdateCount: updates.length,
      status: 'stock-updated',
    });
  }

  return { ok: true, updates };
};

export const loadInvoiceDashboardStats = async () => {
  if (!hasFirebaseConfig) {
    return {
      totalSpendThisMonth: 0,
      topIngredients: [],
      priceIncreasesThisMonth: [],
      lowStockCount: 0,
      lastInvoice: null,
    };
  }

  const workspace = await loadInvoiceWorkspaceData();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const activeInvoices = workspace.invoices.filter((invoice) => String(invoice.status || '').toLowerCase() !== 'deleted');
  const invoicesThisMonth = activeInvoices.filter((invoice) => (
    new Date(invoice.invoiceDate || invoice.scannedAt || 0) >= monthStart
  ));
  const topIngredients = [...workspace.ingredients]
    .sort((a, b) => Number(b.lastPriceExVAT || 0) - Number(a.lastPriceExVAT || 0))
    .slice(0, 5)
    .map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      priceExVAT: roundMoney(ingredient.lastPriceExVAT),
    }));
  const priceIncreasesThisMonth = workspace.ingredients
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
    lowStockCount: workspace.stockLevels.filter((stock) => stock.status === 'low').length,
    lastInvoice: activeInvoices[0] || null,
  };
};
