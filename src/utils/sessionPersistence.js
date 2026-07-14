export const AUTH_SESSION_STORAGE_KEY = 'wasteShiftAuthSession';

export const sanitizeAuthSession = (session) => {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return null;
  }

  const staffId = String(session.staffId || '').trim();
  if (!staffId) {
    return null;
  }

  return {
    mode: session.mode === 'management' ? 'management' : 'staff',
    staffId,
    staffName: String(session.staffName || '').trim(),
    roleKey: String(session.roleKey || '').trim(),
    startedAt: String(session.startedAt || '').trim(),
    databaseId: String(session.databaseId || '').trim(),
  };
};

export const clearPersistedAuthSession = () => {
  try {
    globalThis.localStorage?.removeItem(AUTH_SESSION_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in strict privacy modes.
  }

  try {
    globalThis.sessionStorage?.removeItem(AUTH_SESSION_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in strict privacy modes.
  }
};

export const loadPersistedAuthSession = (databaseId) => {
  try {
    const savedSession = globalThis.localStorage?.getItem(AUTH_SESSION_STORAGE_KEY)
      || globalThis.sessionStorage?.getItem(AUTH_SESSION_STORAGE_KEY);
    const session = savedSession ? sanitizeAuthSession(JSON.parse(savedSession)) : null;
    const activeDatabaseId = String(databaseId || '').trim();

    if (!session || (session.databaseId && session.databaseId !== activeDatabaseId)) {
      return null;
    }

    const migratedSession = { ...session, databaseId: activeDatabaseId };
    globalThis.localStorage?.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(migratedSession));
    globalThis.sessionStorage?.removeItem(AUTH_SESSION_STORAGE_KEY);
    return migratedSession;
  } catch {
    clearPersistedAuthSession();
    return null;
  }
};

export const savePersistedAuthSession = (session, databaseId) => {
  const safeSession = sanitizeAuthSession({
    ...session,
    databaseId: session?.databaseId || databaseId,
  });

  if (!safeSession) {
    clearPersistedAuthSession();
    return null;
  }

  try {
    globalThis.localStorage?.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(safeSession));
    globalThis.sessionStorage?.removeItem(AUTH_SESSION_STORAGE_KEY);
    return safeSession;
  } catch {
    return null;
  }
};
