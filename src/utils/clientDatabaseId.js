export const CLIENT_DATABASE_ID_STORAGE_KEY = 'wasteShiftClientDatabaseId';

const DATABASE_ID_QUERY_KEYS = ['restaurant', 'restaurantId', 'databaseId', 'db'];

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

export const resolveClientDatabaseId = (value) => {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return '';
  }

  try {
    const url = new URL(rawValue);

    for (const queryKey of DATABASE_ID_QUERY_KEYS) {
      const databaseId = normalizeDatabaseId(url.searchParams.get(queryKey));

      if (databaseId) {
        return databaseId;
      }
    }

    return '';
  } catch {
    const queryMatch = rawValue.match(/[?&](?:restaurant|restaurantId|databaseId|db)=([^&#]+)/i);

    if (queryMatch?.[1]) {
      return normalizeDatabaseId(decodeURIComponent(queryMatch[1]));
    }
  }

  return normalizeDatabaseId(rawValue);
};

const getDatabaseIdFromUrl = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  const params = new URLSearchParams(window.location.search);

  for (const queryKey of DATABASE_ID_QUERY_KEYS) {
    const databaseId = normalizeDatabaseId(params.get(queryKey));

    if (databaseId) {
      return databaseId;
    }
  }

  return '';
};

const keepDatabaseIdInUrl = (databaseId) => {
  if (
    !databaseId
    || typeof window === 'undefined'
    || !window.history?.replaceState
  ) {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set('restaurant', databaseId);
  DATABASE_ID_QUERY_KEYS
    .filter((queryKey) => queryKey !== 'restaurant')
    .forEach((queryKey) => url.searchParams.delete(queryKey));

  if (url.toString() !== window.location.href) {
    window.history.replaceState(window.history.state, '', url);
  }
};

export const setClientDatabaseId = (value) => {
  if (typeof localStorage === 'undefined') {
    return '';
  }

  const databaseId = resolveClientDatabaseId(value);

  if (!databaseId) {
    return '';
  }

  localStorage.setItem(CLIENT_DATABASE_ID_STORAGE_KEY, databaseId);
  keepDatabaseIdInUrl(databaseId);
  return databaseId;
};

export const getClientDatabaseId = () => {
  if (typeof localStorage === 'undefined') {
    return '';
  }

  const requestedDatabaseId = getDatabaseIdFromUrl();

  if (requestedDatabaseId) {
    localStorage.setItem(CLIENT_DATABASE_ID_STORAGE_KEY, requestedDatabaseId);
    keepDatabaseIdInUrl(requestedDatabaseId);
    return requestedDatabaseId;
  }

  const existingId = normalizeDatabaseId(localStorage.getItem(CLIENT_DATABASE_ID_STORAGE_KEY));

  if (existingId) {
    keepDatabaseIdInUrl(existingId);
    return existingId;
  }

  const nextId = createClientDatabaseId();
  localStorage.setItem(CLIENT_DATABASE_ID_STORAGE_KEY, nextId);
  keepDatabaseIdInUrl(nextId);
  return nextId;
};

export const getClientDatabaseHeaders = (extraHeaders = {}) => {
  const databaseId = getClientDatabaseId();

  return {
    ...extraHeaders,
    ...(databaseId ? { 'x-wasteshift-database-id': databaseId } : {}),
  };
};

export const getClientDatabaseShareUrl = () => {
  const databaseId = getClientDatabaseId();

  if (!databaseId) {
    return '';
  }

  if (typeof window === 'undefined') {
    return databaseId;
  }

  const url = new URL(window.location.href);
  url.searchParams.set('restaurant', databaseId);
  DATABASE_ID_QUERY_KEYS
    .filter((queryKey) => queryKey !== 'restaurant')
    .forEach((queryKey) => url.searchParams.delete(queryKey));
  url.hash = '';
  return url.toString();
};
