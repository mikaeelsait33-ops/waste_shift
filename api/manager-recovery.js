import { getFirebaseAdmin } from './_firebaseAdmin.js';
import { verifyFirebaseIdToken } from './_firebaseIdentity.js';
import { createAccessSession } from './_accessSession.js';
import { createPinRecord } from './_pinVerification.js';
import { getHeaderValue, getRequestDatabaseId, safeSecretEquals } from './_auth.js';
import { loadCanonicalRestaurant } from './_singleShop.js';

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.status(status).json(body);
};

const readBody = (request) => {
  if (!request.body) return {};
  return typeof request.body === 'object' ? request.body : JSON.parse(request.body);
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Use POST for manager recovery.' });
    return;
  }

  const recoverySecret = String(process.env.WASTESHIFT_RECOVERY_SECRET || '').trim();
  const firebaseAdmin = getFirebaseAdmin();
  if (!recoverySecret || !firebaseAdmin) {
    sendJson(response, 503, {
      ok: false,
      code: 'manager_recovery_not_configured',
      message: 'One-time manager recovery is not configured.',
    });
    return;
  }

  try {
    const body = readBody(request);
    const providedSecret = String(body?.recoveryKey || '').trim();
    const databaseId = getRequestDatabaseId(request);
    const idToken = String(getHeaderValue(request, 'x-wasteshift-firebase-token') || '').trim();
    const managerId = String(body?.managerId || '').trim();
    const managerName = String(body?.name || '').trim();
    const managerPin = createPinRecord(body?.pin);

    if (!providedSecret || !safeSecretEquals(providedSecret, recoverySecret)) {
      sendJson(response, 403, { ok: false, code: 'manager_recovery_rejected', message: 'The recovery key was not accepted.' });
      return;
    }

    if (!databaseId || !idToken) {
      sendJson(response, 401, { ok: false, code: 'firebase_token_required', message: 'Refresh the app and try recovery again.' });
      return;
    }

    if (!managerId || !managerName || !managerPin) {
      sendJson(response, 400, { ok: false, message: 'Enter a manager name and a 4 to 8 digit PIN.' });
      return;
    }

    const decodedToken = await verifyFirebaseIdToken(idToken);
    const [canonicalRestaurant, managersSnapshot] = await Promise.all([
      loadCanonicalRestaurant(firebaseAdmin),
      firebaseAdmin.db.collection('managers').where('databaseId', '==', databaseId).get(),
    ]);
    const activeManagerExists = managersSnapshot.docs.some((snapshot) => {
      const manager = snapshot.data();
      return manager?.active !== false && manager?.removed !== true;
    });

    if (!canonicalRestaurant || canonicalRestaurant.databaseId !== databaseId || activeManagerExists) {
      sendJson(response, 409, {
        ok: false,
        code: 'manager_recovery_closed',
        message: 'One-time recovery is closed because manager access already exists or the restaurant is ambiguous.',
      });
      return;
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + SESSION_DURATION_MS);
    await firebaseAdmin.db.collection('managers').doc(`${databaseId}__${managerId}`).set({
      databaseId,
      id: managerId,
      name: managerName,
      role: 'Manager',
      roleKey: 'manager',
      staffSection: 'management',
      managerPin,
      active: true,
      removed: false,
      removedAt: '',
      createdAt: issuedAt.toISOString(),
      updatedAt: issuedAt.toISOString(),
      recoveredAt: issuedAt.toISOString(),
    });
    await Promise.all([
      firebaseAdmin.db.collection('managerSessions').doc(`${databaseId}__${decodedToken.uid}`).set({
        databaseId,
        uid: decodedToken.uid,
        managerId,
        managerName,
        roleKey: 'manager',
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        expiresAtEpochMs: expiresAt.getTime(),
        updatedAt: issuedAt.toISOString(),
      }),
      createAccessSession(firebaseAdmin, {
        databaseId,
        uid: decodedToken.uid,
        staffId: managerId,
        staffName: managerName,
        roleKey: 'manager',
        durationMs: SESSION_DURATION_MS,
      }),
    ]);

    sendJson(response, 200, {
      ok: true,
      manager: { id: managerId, name: managerName, role: 'Manager', roleKey: 'manager', staffSection: 'management' },
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Manager recovery failed.', error);
    sendJson(response, 503, { ok: false, code: 'manager_recovery_unavailable', message: 'Manager recovery is temporarily unavailable.' });
  }
}
