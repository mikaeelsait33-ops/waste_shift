const ACCESS_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

const normalizeRoleKey = (roleKey) => {
  const value = String(roleKey || '').trim().toLowerCase();
  return ['owner', 'manager', 'chef', 'barista', 'waiter'].includes(value) ? value : 'waiter';
};

export const getAccessSessionId = (databaseId, uid) => `${databaseId}__${uid}`;

export const createAccessSession = async (firebaseAdmin, {
  databaseId,
  uid,
  staffId,
  staffName,
  roleKey,
  durationMs = ACCESS_SESSION_DURATION_MS,
}) => {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + durationMs);
  const session = {
    databaseId,
    uid,
    staffId: String(staffId || '').trim(),
    staffName: String(staffName || '').trim(),
    roleKey: normalizeRoleKey(roleKey),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    expiresAtEpochMs: expiresAt.getTime(),
    expiresAtTimestamp: firebaseAdmin.Timestamp.fromDate(expiresAt),
    updatedAt: issuedAt.toISOString(),
  };

  await firebaseAdmin.db
    .collection('accessSessions')
    .doc(getAccessSessionId(databaseId, uid))
    .set(session);

  return session;
};

export const deleteAccessSession = async (firebaseAdmin, databaseId, uid) => {
  await firebaseAdmin.db
    .collection('accessSessions')
    .doc(getAccessSessionId(databaseId, uid))
    .delete();
};

export const loadValidAccessSession = async (firebaseAdmin, databaseId, uid) => {
  const snapshot = await firebaseAdmin.db
    .collection('accessSessions')
    .doc(getAccessSessionId(databaseId, uid))
    .get();
  const session = snapshot.exists ? snapshot.data() : null;

  if (
    !session
    || session.databaseId !== databaseId
    || session.uid !== uid
    || !Number.isFinite(Number(session.expiresAtEpochMs))
    || Number(session.expiresAtEpochMs) <= Date.now()
  ) {
    return null;
  }

  return session;
};
