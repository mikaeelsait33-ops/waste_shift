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
  void AUTH_SESSION_STORAGE_KEY;
};

export const loadPersistedAuthSession = (databaseId) => {
  void databaseId;
  clearPersistedAuthSession();
  return null;
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

  void databaseId;
  clearPersistedAuthSession();
  return safeSession;
};
