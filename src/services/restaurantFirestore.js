import { getFirestoreDb, ensureFirebaseAuth } from './firestoreMenuItems';
import { getAutomaticManagerApiHeaders } from '../utils/apiHeaders';
import { getClientDatabaseId, persistClientDatabaseId } from '../utils/clientDatabaseId';

const getRestaurantProfileRef = () => ['restaurants', getClientDatabaseId() || 'local'];
const getFirestoreApi = async () => {
  const firestore = await import('firebase/firestore/lite');

  return {
    collection: firestore.collection,
    deleteDoc: firestore.deleteDoc,
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    getDocs: firestore.getDocs,
    limit: firestore.limit,
    query: firestore.query,
    serverTimestamp: firestore.serverTimestamp,
    setDoc: firestore.setDoc,
    where: firestore.where,
  };
};

const toSafeString = (value) => String(value ?? '').trim();
const scopeDocId = (id) => `${getClientDatabaseId() || 'local'}__${toSafeString(id)}`;
export const RESTAURANT_PROFILE_CACHE_KEY = 'wasteShiftRestaurantProfiles';

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

export const loadCachedRestaurantProfile = () => {
  if (typeof localStorage === 'undefined') {
    return createDefaultRestaurantProfile();
  }

  try {
    const databaseId = getClientDatabaseId() || 'local';
    const profiles = JSON.parse(localStorage.getItem(RESTAURANT_PROFILE_CACHE_KEY) || '{}');
    return sanitizeRestaurantProfile(profiles?.[databaseId]);
  } catch {
    return createDefaultRestaurantProfile();
  }
};

export const cacheRestaurantProfile = (profile) => {
  if (typeof localStorage === 'undefined') {
    return sanitizeRestaurantProfile(profile);
  }

  const safeProfile = sanitizeRestaurantProfile(profile);

  try {
    const databaseId = getClientDatabaseId() || 'local';
    const profiles = JSON.parse(localStorage.getItem(RESTAURANT_PROFILE_CACHE_KEY) || '{}');
    localStorage.setItem(RESTAURANT_PROFILE_CACHE_KEY, JSON.stringify({
      ...(profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {}),
      [databaseId]: safeProfile,
    }));
  } catch {
    return safeProfile;
  }

  return safeProfile;
};

const findSingleCompletedRestaurant = async (db) => {
  const { collection, getDocs, limit, query, where } = await getFirestoreApi();
  const completedRestaurants = await getDocs(query(
    collection(db, 'restaurants'),
    where('setupCompleted', '==', true),
    limit(2),
  ));

  // A new device can join automatically only when this app has exactly one shop.
  if (completedRestaurants.size !== 1) {
    return null;
  }

  const restaurant = completedRestaurants.docs[0];
  const databaseId = persistClientDatabaseId(restaurant.data()?.databaseId || restaurant.id);

  if (!databaseId) {
    return null;
  }

  return restaurant.data();
};

export const loadRestaurantProfile = async () => {
  const db = await getFirestoreDb();

  if (!db) {
    return { ok: false, skipped: true, profile: loadCachedRestaurantProfile() };
  }

  await ensureFirebaseAuth();
  const { doc, getDoc } = await getFirestoreApi();
  const snapshot = await getDoc(doc(db, ...getRestaurantProfileRef()));

  if (!snapshot.exists()) {
    const singleRestaurant = await findSingleCompletedRestaurant(db);

    if (singleRestaurant) {
      const profile = cacheRestaurantProfile(singleRestaurant);
      return {
        ok: true,
        exists: true,
        source: 'firestore-single-shop-bootstrap',
        didAdoptSingleShop: true,
        profile,
      };
    }

    const cachedProfile = loadCachedRestaurantProfile();
    return {
      ok: true,
      exists: false,
      source: cachedProfile.setupCompleted ? 'cache' : 'empty',
      profile: cachedProfile,
    };
  }

  const profile = cacheRestaurantProfile(snapshot.data());

  return {
    ok: true,
    exists: true,
    source: 'firestore',
    profile,
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
  await setDoc(doc(db, ...getRestaurantProfileRef()), {
    databaseId: getClientDatabaseId() || 'local',
    ...safeProfile,
    setupCompleted,
    setupCompletedAt: setupCompleted ? safeProfile.setupCompletedAt || now : '',
    createdAt: safeProfile.createdAt || now,
    updatedAt: now,
    updatedAtServer: serverTimestamp(),
  }, { merge: true });

  const savedProfile = cacheRestaurantProfile({
    ...safeProfile,
    setupCompleted,
    setupCompletedAt: setupCompleted ? safeProfile.setupCompletedAt || now : '',
    createdAt: safeProfile.createdAt || now,
    updatedAt: now,
  });

  return {
    ok: true,
    profile: savedProfile,
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
  await setDoc(doc(db, 'menuImports', scopeDocId(safeId)), {
    databaseId: getClientDatabaseId() || 'local',
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
      headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
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
