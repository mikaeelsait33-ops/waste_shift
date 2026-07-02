const DB_NAME = 'wasteshift-drafts';
const STORE_NAME = 'drafts';
const DB_VERSION = 1;
export const WASTE_FORM_DRAFT_ID = 'waste-form';

export const createWasteDraftPayload = (fields) => ({
  id: WASTE_FORM_DRAFT_ID,
  savedAt: new Date().toISOString(),
  fields: {
    formType: fields?.formType || 'single',
    menuSearch: fields?.menuSearch || '',
    name: fields?.name || '',
    quantity: fields?.quantity || '1',
    unit: fields?.unit || 'each',
    portionAmount: fields?.portionAmount || '',
    portionUnit: fields?.portionUnit || 'g',
    category: fields?.category || 'Produce',
    wasteClassification: fields?.wasteClassification || '',
    reason: fields?.reason || 'Expired',
    customReason: fields?.customReason || '',
    selectedStaffId: fields?.selectedStaffId || '',
    cost: fields?.cost || '',
    notes: fields?.notes || '',
    wasteDate: fields?.wasteDate || '',
    selectedRecipeKey: fields?.selectedRecipeKey || '',
    selectedComponentKeys: Array.isArray(fields?.selectedComponentKeys) ? fields.selectedComponentKeys : [],
  },
});

export const wasteDraftHasContent = (fields) => {
  const data = fields?.fields || fields || {};

  return Boolean(
    String(data.name || '').trim()
    || String(data.menuSearch || '').trim()
    || String(data.notes || '').trim()
    || String(data.customReason || '').trim()
    || String(data.cost || '').trim()
    || data.formType === 'recipe'
    || String(data.quantity || '1') !== '1'
    || String(data.reason || 'Expired') !== 'Expired'
  );
};

const openDraftDb = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) {
    resolve(null);
    return;
  }

  const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;

    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Could not open draft storage.'));
});

const withDraftStore = async (mode, action) => {
  const db = await openDraftDb();

  if (!db) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = action(store);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(new Error('Could not update draft storage.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(new Error('Could not update draft storage.'));
    };
  });
};

export const saveWasteFormDraft = async (fields) => (
  withDraftStore('readwrite', (store) => store.put(createWasteDraftPayload(fields)))
);

export const loadWasteFormDraft = async () => (
  withDraftStore('readonly', (store) => store.get(WASTE_FORM_DRAFT_ID))
);

export const deleteWasteFormDraft = async () => (
  withDraftStore('readwrite', (store) => store.delete(WASTE_FORM_DRAFT_ID))
);

