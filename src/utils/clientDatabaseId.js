export const CLIENT_DATABASE_ID_STORAGE_KEY = 'wasteShiftClientDatabaseId';

const LEGACY_DATABASE_QUERY_KEYS = ['restaurant', 'restaurantId', 'databaseId', 'db'];
let activeDatabaseId = '';

export const normalizeDatabaseId = (value) => (
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80)
);

const createClientDatabaseId = () => {
  if (globalThis.crypto?.randomUUID) {
    return normalizeDatabaseId(`ws_${globalThis.crypto.randomUUID()}`);
  }

  const randomPart = Math.random().toString(36).slice(2, 12);
  return normalizeDatabaseId(`ws_${Date.now().toString(36)}_${randomPart}`);
};

export const removeLegacyDatabaseQuery = () => {
  if (typeof window === 'undefined' || !window.history?.replaceState) {
    return;
  }

  const url = new URL(window.location.href);
  const hadLegacyQuery = LEGACY_DATABASE_QUERY_KEYS.some((key) => url.searchParams.has(key));

  if (!hadLegacyQuery) {
    return;
  }

  LEGACY_DATABASE_QUERY_KEYS.forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(window.history.state, '', url);
};

// This is used only by the automatic one-shop bootstrap. There is no UI for switching shops.
export const persistClientDatabaseId = (value) => {
  const databaseId = normalizeDatabaseId(value);

  if (!databaseId) {
    return '';
  }

  activeDatabaseId = databaseId;
  return activeDatabaseId;
};

export const getClientDatabaseId = () => {
  removeLegacyDatabaseQuery();

  if (activeDatabaseId) {
    return activeDatabaseId;
  }

  const nextId = createClientDatabaseId();
  return persistClientDatabaseId(nextId);
};

export const getClientDatabaseHeaders = (extraHeaders = {}) => {
  const databaseId = getClientDatabaseId();

  return {
    ...extraHeaders,
    ...(databaseId ? { 'x-wasteshift-database-id': databaseId } : {}),
  };
};
