import { authorizeManagerSessionRequest } from './_auth.js';
import { getFirebaseAdmin } from './_firebaseAdmin.js';
import { isPinRecord } from './_pinVerification.js';

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.status(status).json(body);
};

const readJsonBody = async (request) => {
  if (!request.body) return {};
  if (typeof request.body === 'object') return request.body;
  return JSON.parse(request.body);
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Use POST to save a staff account.' });
    return;
  }

  const authorization = await authorizeManagerSessionRequest(request);
  if (!authorization.ok) {
    sendJson(response, authorization.status, authorization.body);
    return;
  }

  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) {
    sendJson(response, 503, { ok: false, message: 'Firebase Admin access is not configured.' });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const staff = body?.staff || {};
    const id = String(staff.id || '').trim();
    const name = String(staff.name || '').trim();
    const removed = staff.removed === true || staff.active === false;

    if (!id || !name || (!removed && !isPinRecord(staff.staffCode))) {
      sendJson(response, 400, { ok: false, message: 'A valid staff account and PIN record are required.' });
      return;
    }

    const now = new Date().toISOString();
    await firebaseAdmin.db.collection('staffAccounts').doc(`${authorization.databaseId}__${id}`).set({
      databaseId: authorization.databaseId,
      id,
      name,
      role: String(staff.role || 'Team').trim(),
      roleKey: String(staff.roleKey || 'waiter').trim().toLowerCase(),
      staffSection: String(staff.staffSection || '').trim(),
      staffCode: isPinRecord(staff.staffCode) ? staff.staffCode : null,
      active: !removed,
      removed,
      removedAt: removed ? String(staff.removedAt || now) : '',
      createdAt: String(staff.createdAt || now),
      updatedAt: now,
      updatedBy: authorization.managerId || 'Manager',
    }, { merge: true });

    sendJson(response, 200, { ok: true, id });
  } catch (error) {
    console.error('Could not save staff account.', error);
    sendJson(response, 503, { ok: false, message: 'Staff account could not be saved.' });
  }
}
