import { inferRoleKey, normalizeAccessRoleKey } from '../utils/accessControl';
import { ensureFirebaseAuth, getFirestoreDb } from './firestoreMenuItems';

const STAFF_COLLECTION = 'staff';
const STAFF_ACCESS_COLLECTION = 'staffAccess';

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
  accessGrantId = '',
}) => ({
  displayName: toSafeString(displayName) || 'WasteShift user',
  roleKey: normalizeAccessRoleKey(roleKey || inferRoleKey(role)),
  active: active !== false,
  staffId: toSafeString(staffId),
  accessGrantId: toSafeString(accessGrantId),
});

export const saveCurrentUserStaffProfile = async ({
  displayName,
  role,
  roleKey,
  active = true,
  staffId = '',
  accessGrantId = '',
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
  const payload = createStaffProfilePayload({ displayName, role, roleKey, active, staffId, accessGrantId });
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

export const syncStaffAccessGrant = async ({
  staffId,
  displayName,
  role,
  roleKey,
  accessGrantId,
  active = true,
} = {}) => {
  const db = await getFirestoreDb();
  const safeStaffId = toSafeString(staffId);
  const safeGrantId = toSafeString(accessGrantId);

  if (!db || !safeStaffId || !safeGrantId) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  const safeRoleKey = normalizeAccessRoleKey(roleKey || inferRoleKey(role));
  const now = new Date().toISOString();

  await setDoc(doc(db, STAFF_ACCESS_COLLECTION, safeStaffId), {
    staffId: safeStaffId,
    displayName: toSafeString(displayName) || safeStaffId,
    roleKey: safeRoleKey,
    active: active !== false,
    accessGrantId: safeGrantId,
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  }, { merge: true });

  return { ok: true, staffId: safeStaffId };
};
