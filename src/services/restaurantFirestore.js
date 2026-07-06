import { getFirestoreDb, ensureFirebaseAuth } from './firestoreMenuItems';
import { getManagerApiHeaders } from '../utils/apiHeaders';

const RESTAURANT_PROFILE_REF = ['restaurants', 'main'];
const getFirestoreApi = async () => {
  const firestore = await import('firebase/firestore');

  return {
    collection: firestore.collection,
    deleteDoc: firestore.deleteDoc,
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    getDocs: firestore.getDocs,
    serverTimestamp: firestore.serverTimestamp,
    setDoc: firestore.setDoc,
  };
};

const toSafeString = (value) => String(value ?? '').trim();

export const createDefaultRestaurantProfile = () => ({
  restaurantName: '',
  branchName: '',
  currency: 'ZAR',
  timezone: 'Africa/Johannesburg',
  setupCompleted: false,
  setupCompletedAt: '',
  createdAt: '',
  updatedAt: '',
});

export const sanitizeRestaurantProfile = (profile) => {
  const data = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};

  return {
    restaurantName: toSafeString(data.restaurantName || data.name),
    branchName: toSafeString(data.branchName || data.locationName),
    currency: toSafeString(data.currency) || 'ZAR',
    timezone: toSafeString(data.timezone) || 'Africa/Johannesburg',
    setupCompleted: Boolean(data.setupCompleted),
    setupCompletedAt: toSafeString(data.setupCompletedAt),
    createdAt: toSafeString(data.createdAt),
    updatedAt: toSafeString(data.updatedAt),
  };
};

export const loadRestaurantProfile = async () => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true, profile: createDefaultRestaurantProfile() };
  }

  await ensureFirebaseAuth();
  const { doc, getDoc } = await getFirestoreApi();
  const snapshot = await getDoc(doc(db, ...RESTAURANT_PROFILE_REF));

  if (!snapshot.exists()) {
    return { ok: true, exists: false, profile: createDefaultRestaurantProfile() };
  }

  return {
    ok: true,
    exists: true,
    profile: sanitizeRestaurantProfile(snapshot.data()),
  };
};

export const saveRestaurantProfile = async (profile, options = {}) => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true };
  }

  const safeProfile = sanitizeRestaurantProfile(profile);
  const now = new Date().toISOString();
  const setupCompleted = Boolean(options.completeSetup || safeProfile.setupCompleted);

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  await setDoc(doc(db, ...RESTAURANT_PROFILE_REF), {
    ...safeProfile,
    setupCompleted,
    setupCompletedAt: setupCompleted ? safeProfile.setupCompletedAt || now : '',
    createdAt: safeProfile.createdAt || now,
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  }, { merge: true });

  return {
    ok: true,
    profile: {
      ...safeProfile,
      setupCompleted,
      setupCompletedAt: setupCompleted ? safeProfile.setupCompletedAt || now : '',
      createdAt: safeProfile.createdAt || now,
      updatedAt: now,
    },
  };
};

export const saveMenuImportHistory = async (historyRecord) => {
  const db = await getFirestoreDb();
  const safeId = toSafeString(historyRecord?.id);

  if (!db || !safeId) {
    return { ok: false, skipped: true };
  }

  await ensureFirebaseAuth();
  const { doc, serverTimestamp, setDoc } = await getFirestoreApi();
  await setDoc(doc(db, 'menuImports', safeId), {
    ...historyRecord,
    createdAtServer: serverTimestamp(),
  }, { merge: true });

  return { ok: true, id: safeId };
};

export const resetRestaurantFirestoreData = async () => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('/api/admin-reset', {
      method: 'POST',
      headers: getManagerApiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ confirmation: 'RESET' }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body?.ok) {
      const message = body?.message
        || 'Server reset is not configured. Add Firebase Admin credentials and manager secret.';
      throw new Error(message);
    }

    return body;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Reset timed out. Check Vercel function logs and try again.');
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};
