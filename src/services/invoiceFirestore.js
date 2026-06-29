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
    lastPriceExVAT: sanitizeNumber(docData?.lastPriceExVAT ?? docData?.priceExVAT),
    lastPriceIncVAT: sanitizeNumber(docData?.lastPriceIncVAT ?? docData?.priceIncVAT),
    lastInvoiceDate: sanitizeString(docData?.lastInvoiceDate),
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

  const [ingredientDocs, menuItemDocs, stockDocs, invoiceDocs, supplierDocs] = await Promise.all([
    readCollection('ingredients'),
    readCollection('menuItems'),
    readCollection('stockLevels'),
    readCollection('invoices'),
    readCollection('suppliers'),
  ]);
  const db = await getFirestoreDb();
  const { doc, getDoc } = await getFirestoreApi();
  const settingsSnapshot = await getDoc(doc(db, 'settings', 'invoiceConfig'));
  const ingredients = await Promise.all(
    ingredientDocs
      .map(normalizeIngredient)
      .filter(Boolean)
      .map(withPriceHistory)
  );

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
  const payload = {
    id,
    name,
    category: sanitizeString(ingredientDraft?.category) || 'Other',
    unit: sanitizeString(ingredientDraft?.unit) || 'each',
    parLevel: sanitizeNumber(ingredientDraft?.parLevel),
    reorderPoint: sanitizeNumber(ingredientDraft?.reorderPoint),
    preferredSupplier: sanitizeString(ingredientDraft?.preferredSupplier),
    linkedMenuItemIds: Array.isArray(ingredientDraft?.linkedMenuItemIds) ? ingredientDraft.linkedMenuItemIds : [],
    lastPriceExVAT: sanitizeNumber(ingredientDraft?.lastPriceExVAT),
    lastPriceIncVAT: sanitizeNumber(ingredientDraft?.lastPriceIncVAT),
    updatedAt: serverTimestamp(),
    createdAt: ingredientDraft?.createdAt || serverTimestamp(),
  };

  await setDoc(doc(db, 'ingredients', id), payload, { merge: true });
  return { ok: true, ingredient: payload };
};

export const saveConfirmedInvoice = async ({
  invoiceId,
  supplierName,
  invoiceDate,
  lineItems,
  ingredientRows,
  totals,
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
  const safeInvoiceDate = sanitizeString(invoiceDate) || new Date().toISOString().slice(0, 10);
  const supplierId = createInvoiceKey(safeSupplierName) || 'unknown_supplier';

  await ensureFirebaseAuth();
  const { doc, increment, serverTimestamp, setDoc } = await getFirestoreApi();

  await setDoc(doc(db, 'invoices', safeInvoiceId), {
    id: safeInvoiceId,
    invoiceDate: safeInvoiceDate,
    supplier: safeSupplierName,
    supplierId,
    totalExVAT: roundMoney(safeTotals.totalExVAT),
    totalVAT: roundMoney(safeTotals.totalVAT),
    totalIncVAT: roundMoney(safeTotals.totalIncVAT),
    lineItems: safeLineItems,
    scannedAt: new Date().toISOString(),
    status: 'confirmed',
    vatRate: sanitizeNumber(vatRate, 0.15),
    vatMode: sanitizeString(vatMode) || 'inclusive',
    rawText: sanitizeString(rawText).slice(0, 12000),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(doc(db, 'suppliers', supplierId), {
    id: supplierId,
    name: safeSupplierName,
    lastInvoiceDate: safeInvoiceDate,
    totalSpend: increment(roundMoney(safeTotals.totalExVAT)),
    ingredientCount: Array.isArray(ingredientRows) ? new Set(ingredientRows.map((row) => row.ingredientId).filter(Boolean)).size : 0,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await Promise.all((Array.isArray(ingredientRows) ? ingredientRows : [])
    .filter((row) => row?.ingredientId && row?.ingredientName)
    .map(async (row) => {
      const ingredientId = sanitizeString(row.ingredientId);
      const historyId = `${safeInvoiceDate}-${safeInvoiceId}`.replace(/[^a-z0-9_-]/gi, '_');

      await setDoc(doc(db, 'ingredients', ingredientId), {
        id: ingredientId,
        name: sanitizeString(row.ingredientName),
        category: sanitizeString(row.category) || 'Other',
        unit: sanitizeString(row.unit) || 'each',
        preferredSupplier: safeSupplierName,
        parLevel: sanitizeNumber(row.parLevel),
        reorderPoint: sanitizeNumber(row.reorderPoint),
        lastPriceExVAT: roundMoney(row.priceExVAT),
        lastPriceIncVAT: roundMoney(row.priceIncVAT),
        lastInvoiceDate: safeInvoiceDate,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await setDoc(doc(db, 'ingredients', ingredientId, 'priceHistory', historyId), {
        date: safeInvoiceDate,
        supplier: safeSupplierName,
        priceExVAT: roundMoney(row.priceExVAT),
        priceIncVAT: roundMoney(row.priceIncVAT),
        invoiceId: safeInvoiceId,
        createdAt: serverTimestamp(),
      }, { merge: true });
    }));

  return { ok: true, invoiceId: safeInvoiceId };
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
  const invoicesThisMonth = workspace.invoices.filter((invoice) => (
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
    lastInvoice: workspace.invoices[0] || null,
  };
};
