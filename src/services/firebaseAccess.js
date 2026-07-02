import { inferRoleKey, normalizeAccessRoleKey } from '../utils/accessControl';
import { ensureFirebaseAuth, getFirestoreDb } from './firestoreMenuItems';

const STAFF_COLLECTION = 'staff';

const getFirestoreApi = async () => {
  const firestore = await import('firebase/firestore');

  return {
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    serverTimestamp: firestore.serverTimestamp,
    setDoc: firestore.setDoc,
  };
};

const toSafeString = (value) => String(value ?? '').trim();

export const createStaffProfilePayload = ({
  displayName,
  role,
  roleKey,
  active = true,
  staffId = '',
}) => ({
  displayName: toSafeString(displayName) || 'WasteShift user',
  roleKey: normalizeAccessRoleKey(roleKey || inferRoleKey(role)),
  active: active !== false,
  staffId: toSafeString(staffId),
});

export const saveCurrentUserStaffProfile = async ({
  displayName,
  role,
  roleKey,
  active = true,
  staffId = '',
} = {}) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  const user = await ensureFirebaseAuth();

  if (!user?.uid) {
    return { ok: false, skipped: true };
  }

  const { doc, getDoc, serverTimestamp, setDoc } = await getFirestoreApi();
  const profileRef = doc(db, STAFF_COLLECTION, user.uid);
  const existingProfile = await getDoc(profileRef).catch(() => null);
  const payload = createStaffProfilePayload({ displayName, role, roleKey, active, staffId });
  const now = new Date().toISOString();

  await setDoc(profileRef, {
    uid: user.uid,
    ...payload,
    lastLoginAt: now,
    lastLoginAtServer: serverTimestamp(),
    createdAt: existingProfile?.exists?.()
      ? existingProfile.data()?.createdAt || now
      : now,
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  }, { merge: true });

  return {
    ok: true,
    uid: user.uid,
    profile: {
      uid: user.uid,
      ...payload,
      lastLoginAt: now,
    },
  };
};
