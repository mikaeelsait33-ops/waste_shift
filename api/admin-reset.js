import { authorizeManagerSessionRequest, apiIsProductionRuntime } from './_auth.js';
import { getFirebaseAdmin } from './_firebaseAdmin.js';

const RESET_COLLECTIONS = [
  'appData',
  'menuItems',
  'wasteEntries',
  'ingredients',
  'recipes',
  'inventory',
  'stockLevels',
  'stockMovements',
  'invoices',
  'suppliers',
  'priceHistory',
  'menuImports',
  'auditLogs',
  'settings',
  'managerSessions',
  'accessSessions',
  'staffAccounts',
  'loginAttempts',
];

const parseBody = (request) => {
  if (!request.body) {
    return {};
  }

  if (typeof request.body === 'object') {
    return request.body;
  }

  return JSON.parse(request.body);
};

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow');
  response.status(status).json(body);
};

const deleteCollection = async (db, collectionPath, batchSize = 250) => {
  let deletedCount = 0;

  while (true) {
    const snapshot = await db.collection(collectionPath).limit(batchSize).get();

    if (snapshot.empty) {
      break;
    }

    const batch = db.batch();
    snapshot.docs.forEach((documentSnapshot) => {
      batch.delete(documentSnapshot.ref);
    });
    await batch.commit();
    deletedCount += snapshot.size;

    if (snapshot.size < batchSize) {
      break;
    }
  }

  return deletedCount;
};

const deleteIngredientPriceHistory = async (db) => {
  const snapshot = await db.collection('ingredients').get();
  let deletedCount = 0;

  for (const documentSnapshot of snapshot.docs) {
    deletedCount += await deleteCollection(db, `ingredients/${documentSnapshot.id}/priceHistory`);
  }

  return deletedCount;
};

export default async function handler(request, response) {
  response.setHeader('content-type', 'application/json');

  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
    return;
  }

  const authorization = await authorizeManagerSessionRequest(request);

  if (!authorization.ok) {
    sendJson(response, authorization.status, authorization.body);
    return;
  }

  let body;

  try {
    body = parseBody(request);
  } catch {
    sendJson(response, 400, { ok: false, message: 'Invalid reset request body.' });
    return;
  }

  if (body?.confirmation !== 'RESET') {
    sendJson(response, 400, { ok: false, message: 'Type RESET to confirm.' });
    return;
  }

  const db = getFirebaseAdmin()?.db || null;

  if (!db) {
    const message = 'Server reset is not configured. Add Firebase Admin credentials and manager secret.';

    sendJson(response, apiIsProductionRuntime() ? 503 : 501, {
      ok: false,
      code: 'firebase_admin_not_configured',
      message,
    });
    return;
  }

  const deletedCounts = {};
  const errors = [];

  try {
    deletedCounts['ingredients/priceHistory'] = await deleteIngredientPriceHistory(db);

    for (const collectionName of RESET_COLLECTIONS) {
      try {
        deletedCounts[collectionName] = await deleteCollection(db, collectionName);
      } catch (error) {
        errors.push({
          collection: collectionName,
          message: error?.message || 'Delete failed.',
        });
      }
    }

    await db.collection('restaurants').doc('main').set({
      restaurantName: '',
      branchName: '',
      currency: 'ZAR',
      timezone: 'Africa/Johannesburg',
      setupCompleted: false,
      setupCompletedAt: '',
      createdAt: '',
      updatedAt: new Date().toISOString(),
    }, { merge: false });

    sendJson(response, errors.length > 0 ? 207 : 200, {
      ok: errors.length === 0,
      deletedCounts,
      skippedCollections: [],
      errors,
      message: errors.length > 0
        ? 'Reset partially completed. Review deletedCounts and errors.'
        : 'Restaurant data reset. Complete setup again.',
    });
    return;
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      deletedCounts,
      errors,
      message: error?.message || 'Reset failed.',
    });
    return;
  }
}
