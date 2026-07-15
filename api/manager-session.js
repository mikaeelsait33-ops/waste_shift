import { getFirebaseAdmin } from './_firebaseAdmin.js';
import { verifyFirebaseIdToken } from './_firebaseIdentity.js';
import { getRequestDatabaseId, getHeaderValue } from './_auth.js';
import { createAccessSession, deleteAccessSession } from './_accessSession.js';
import { checkPinAttemptAllowed, clearPinFailures, recordPinFailure } from './_loginThrottle.js';
import { verifyPinRecord } from './_pinVerification.js';

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow');
  response.status(status).json(body);
};

const readJsonBody = async (request) => {
  if (!request.body) {
    return {};
  }

  if (typeof request.body === 'object') {
    return request.body;
  }

  return JSON.parse(request.body);
};

export const verifyManagerPin = verifyPinRecord;

export default async function handler(request, response) {
  if (!['POST', 'DELETE'].includes(request.method)) {
    sendJson(response, 405, { ok: false, message: 'Use POST to establish or DELETE to close a manager session.' });
    return;
  }

  const firebaseAdmin = getFirebaseAdmin();

  if (!firebaseAdmin) {
    sendJson(response, 503, {
      ok: false,
      code: 'firebase_manager_session_not_configured',
      message: 'Automatic manager access is not configured on the server. Add Firebase Admin credentials in Vercel.',
    });
    return;
  }

  const databaseId = getRequestDatabaseId(request);
  const idToken = String(getHeaderValue(request, 'x-wasteshift-firebase-token') || '').trim();

  if (!databaseId) {
    sendJson(response, 400, { ok: false, code: 'database_id_required', message: 'Restaurant data link is missing.' });
    return;
  }

  if (!idToken) {
    sendJson(response, 401, { ok: false, code: 'firebase_token_required', message: 'Sign in before creating a manager session.' });
    return;
  }

  let body;
  let decodedToken;

  try {
    [body, decodedToken] = await Promise.all([
      readJsonBody(request),
      verifyFirebaseIdToken(idToken),
    ]);
  } catch {
    sendJson(response, 401, { ok: false, code: 'firebase_token_invalid', message: 'Sign in again and retry.' });
    return;
  }

  if (request.method === 'DELETE') {
    try {
      await Promise.all([
        firebaseAdmin.db.collection('managerSessions').doc(`${databaseId}__${decodedToken.uid}`).delete(),
        deleteAccessSession(firebaseAdmin, databaseId, decodedToken.uid),
      ]);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      console.error('Could not close manager session.', error);
      sendJson(response, 503, {
        ok: false,
        code: 'manager_session_unavailable',
        message: 'Manager access could not be closed on the server. Please try again.',
      });
    }
    return;
  }

  const managerId = String(body?.managerId || '').trim();
  const pin = String(body?.pin || '').trim();

  if (!managerId || !/^\d{4,8}$/.test(pin)) {
    sendJson(response, 400, { ok: false, message: 'A manager account and valid manager PIN are required.' });
    return;
  }

  try {
    const attemptIdentity = {
      databaseId,
      uid: decodedToken.uid,
      accountType: 'manager',
      accountId: managerId,
    };
    const attemptStatus = await checkPinAttemptAllowed(firebaseAdmin, attemptIdentity);
    if (!attemptStatus.allowed) {
      response.setHeader('retry-after', String(attemptStatus.retryAfterSeconds));
      sendJson(response, 429, {
        ok: false,
        code: 'manager_pin_locked',
        message: 'Too many PIN attempts. Wait a few minutes and try again.',
      });
      return;
    }

    const managerSnapshot = await firebaseAdmin.db
      .collection('managers')
      .doc(`${databaseId}__${managerId}`)
      .get();
    const manager = managerSnapshot.exists ? managerSnapshot.data() : null;

    if (
      !manager
      || manager.databaseId !== databaseId
      || manager.id !== managerId
      || manager.roleKey !== 'manager'
      || manager.active === false
      || manager.removed === true
      || !verifyManagerPin(pin, manager.managerPin)
    ) {
      await recordPinFailure(firebaseAdmin, attemptIdentity);
      sendJson(response, 403, { ok: false, code: 'manager_pin_rejected', message: 'Manager PIN was not accepted.' });
      return;
    }

    await clearPinFailures(firebaseAdmin, attemptIdentity);

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + SESSION_DURATION_MS);

    await firebaseAdmin.db.collection('managerSessions').doc(`${databaseId}__${decodedToken.uid}`).set({
      databaseId,
      uid: decodedToken.uid,
      managerId,
      managerName: String(manager.name || '').trim(),
      roleKey: 'manager',
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      expiresAtEpochMs: expiresAt.getTime(),
      updatedAt: issuedAt.toISOString(),
    });
    await createAccessSession(firebaseAdmin, {
      databaseId,
      uid: decodedToken.uid,
      staffId: managerId,
      staffName: manager.name,
      roleKey: 'manager',
      durationMs: SESSION_DURATION_MS,
    });

    sendJson(response, 200, {
      ok: true,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Could not establish manager session.', error);
    sendJson(response, 503, {
      ok: false,
      code: 'manager_session_unavailable',
      message: 'Manager access is temporarily unavailable. Please try again.',
    });
  }
}
