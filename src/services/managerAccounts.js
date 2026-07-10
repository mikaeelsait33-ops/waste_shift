import { ensureFirebaseAuth, getFirestoreDb } from './firestoreMenuItems';
import { getClientDatabaseId } from '../utils/clientDatabaseId';

const toSafeString = (value) => String(value ?? '').trim();
const getActiveDatabaseId = () => getClientDatabaseId() || 'local';
const scopeDocId = (id) => `${getActiveDatabaseId()}__${toSafeString(id)}`;

const getFirestoreApi = async () => {
  const firestore = await import('firebase/firestore');

  return {
    doc: firestore.doc,
    serverTimestamp: firestore.serverTimestamp,
    setDoc: firestore.setDoc,
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
    managerPin: manager.managerPin || null,
    active: manager.removed !== true,
    removed: manager.removed === true,
    removedAt: toSafeString(manager.removedAt),
    createdAt: toSafeString(manager.createdAt) || now,
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  }, { merge: true });

  return { ok: true, id: managerId };
};
