import { createHash } from 'node:crypto';

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

const getAttemptId = ({ databaseId, uid, accountType, accountId }) => (
  createHash('sha256')
    .update([databaseId, uid, accountType, accountId].map((value) => String(value || '').trim()).join(':'))
    .digest('hex')
);

const getAttemptRef = (firebaseAdmin, identity) => (
  firebaseAdmin.db.collection('loginAttempts').doc(getAttemptId(identity))
);

export const checkPinAttemptAllowed = async (firebaseAdmin, identity) => {
  const snapshot = await getAttemptRef(firebaseAdmin, identity).get();
  const lockUntilMs = Number(snapshot.exists ? snapshot.data()?.lockUntilMs : 0);

  if (Number.isFinite(lockUntilMs) && lockUntilMs > Date.now()) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((lockUntilMs - Date.now()) / 1000)),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
};

export const recordPinFailure = async (firebaseAdmin, identity) => {
  const attemptRef = getAttemptRef(firebaseAdmin, identity);
  const now = Date.now();

  return firebaseAdmin.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attemptRef);
    const previous = snapshot.exists ? snapshot.data() : {};
    const previousWindowStartedAtMs = Number(previous?.windowStartedAtMs);
    const withinWindow = Number.isFinite(previousWindowStartedAtMs)
      && now - previousWindowStartedAtMs < ATTEMPT_WINDOW_MS;
    const attempts = (withinWindow ? Number(previous?.attempts) || 0 : 0) + 1;
    const lockUntilMs = attempts >= MAX_ATTEMPTS ? now + LOCK_DURATION_MS : 0;

    transaction.set(attemptRef, {
      databaseId: String(identity.databaseId || '').trim(),
      uid: String(identity.uid || '').trim(),
      accountType: String(identity.accountType || '').trim(),
      accountId: String(identity.accountId || '').trim(),
      attempts,
      windowStartedAtMs: withinWindow ? previousWindowStartedAtMs : now,
      lockUntilMs,
      updatedAt: new Date(now).toISOString(),
    });

    return { attempts, locked: lockUntilMs > now };
  });
};

export const clearPinFailures = async (firebaseAdmin, identity) => {
  await getAttemptRef(firebaseAdmin, identity).delete();
};
