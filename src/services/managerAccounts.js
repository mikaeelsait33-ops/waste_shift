import { ensureFirebaseAuth, getFirestoreDb } from './firestoreMenuItems';
import { getClientDatabaseId } from '../utils/clientDatabaseId';

const toSafeString = (value) => String(value ?? '').trim();
const getActiveDatabaseId = () => getClientDatabaseId() || 'local';
const scopeDocId = (id) => `${getActiveDatabaseId()}__${toSafeString(id)}`;

const getFirestoreApi = async () => {
  const firestore = await import('firebase/firestore/lite');

  return {
    collection: firestore.collection,
    doc: firestore.doc,
    getDocs: firestore.getDocs,
    query: firestore.query,
    serverTimestamp: firestore.serverTimestamp,
    setDoc: firestore.setDoc,
    where: firestore.where,
  };
};

export const saveManagerAccount = async (manager) => {
  const db = await getFirestoreDb();
  const managerId = toSafeString(manager?.id);
  const managerName = toSafeString(manager?.name);

  if (!db || !managerId || !managerName) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  const now = new Date().toISOString();

  await setDoc(doc(db, 'managers', scopeDocId(managerId)), {
    databaseId: getActiveDatabaseId(),
    id: managerId,
    name: managerName,
    role: 'Manager',
    roleKey: 'manager',
    staffSection: 'management',
    ...(manager.managerPin ? { managerPin: manager.managerPin } : {}),
    active: manager.removed !== true,
    removed: manager.removed === true,
    removedAt: toSafeString(manager.removedAt),
    createdAt: toSafeString(manager.createdAt) || now,
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  }, { merge: true });

  return { ok: true, id: managerId };
};

const sanitizeManagerAccount = (data) => {
  const managerId = toSafeString(data?.id);
  const managerName = toSafeString(data?.name);

  if (!managerId || !managerName) {
    return null;
  }

  return {
    id: managerId,
    name: managerName,
    role: 'Manager',
    staffSection: 'management',
    managerPin: data?.managerPin && typeof data.managerPin === 'object' ? data.managerPin : null,
    staffCode: null,
    removed: data?.removed === true || data?.active === false,
    removedAt: toSafeString(data?.removedAt),
    isCsvSeed: false,
  };
};

export const loadManagerAccounts = async () => {
  const db = await getFirestoreDb();

  if (!db) {
    return [];
  }

  await ensureFirebaseAuth();
  const { collection, getDocs, query, where } = await getFirestoreApi();
  const snapshot = await getDocs(query(
    collection(db, 'managers'),
    where('databaseId', '==', getActiveDatabaseId()),
  ));

  return snapshot.docs
    .map((docSnapshot) => sanitizeManagerAccount(docSnapshot.data()))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
};
