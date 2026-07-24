import { authorizeManagerSessionRequest } from './_auth.js';
import { getFirebaseAdmin } from './_firebaseAdmin.js';
import { createSafeRestaurantResponse, loadCanonicalRestaurant } from './_singleShop.js';

const CLEANUP_CONFIRMATION = 'CLEAN DUPLICATES';

const SCOPED_COLLECTIONS = [
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
  'managers',
  'managerSessions',
  'accessSessions',
  'staffAccounts',
  'loginAttempts',
];

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow');
  response.status(status).json(body);
};

const readJsonBody = (request) => {
  if (!request.body) return {};
  if (typeof request.body === 'object') return request.body;
  return JSON.parse(request.body);
};

const toSafeString = (value) => String(value || '').trim();

export const getDocDatabaseId = (documentSnapshot) => {
  const explicitDatabaseId = toSafeString(documentSnapshot.data()?.databaseId);
  if (explicitDatabaseId) return explicitDatabaseId;

  const documentId = toSafeString(documentSnapshot.id);
  return documentId.includes('__') ? documentId.split('__')[0] : '';
};

export const summarizeDocuments = (documents) => {
  const byCollection = {};
  const byDatabaseId = {};

  documents.forEach((entry) => {
    byCollection[entry.collection] = (byCollection[entry.collection] || 0) + 1;
    byDatabaseId[entry.databaseId] = (byDatabaseId[entry.databaseId] || 0) + 1;
  });

  return {
    totalDocuments: documents.length,
    byCollection,
    byDatabaseId,
    examples: documents.slice(0, 20).map((entry) => ({
      collection: entry.collection,
      id: entry.id,
      databaseId: entry.databaseId,
    })),
  };
};

export const findDuplicateDocuments = async (db, canonicalDatabaseId) => {
  const duplicates = [];
  const restaurantSnapshot = await db.collection('restaurants').get();

  restaurantSnapshot.docs.forEach((documentSnapshot) => {
    const data = documentSnapshot.data() || {};
    const databaseId = toSafeString(data.databaseId || documentSnapshot.id);

    if (databaseId && databaseId !== canonicalDatabaseId && data.setupCompleted === true) {
      duplicates.push({
        collection: 'restaurants',
        id: documentSnapshot.id,
        databaseId,
        ref: documentSnapshot.ref,
      });
    }
  });

  for (const collectionName of SCOPED_COLLECTIONS) {
    const snapshot = await db.collection(collectionName).get();

    snapshot.docs.forEach((documentSnapshot) => {
      const databaseId = getDocDatabaseId(documentSnapshot);

      if (databaseId && databaseId !== canonicalDatabaseId) {
        duplicates.push({
          collection: collectionName,
          id: documentSnapshot.id,
          databaseId,
          ref: documentSnapshot.ref,
        });
      }
    });
  }

  return duplicates;
};

export const deleteDocuments = async (db, documents) => {
  if (documents.length === 0) {
    return { deletedCount: 0 };
  }

  if (typeof db.recursiveDelete === 'function') {
    for (const entry of documents) {
      await db.recursiveDelete(entry.ref);
    }

    return { deletedCount: documents.length, recursive: true };
  }

  let deletedCount = 0;
  for (let index = 0; index < documents.length; index += 450) {
    const batch = db.batch();
    const batchDocuments = documents.slice(index, index + 450);

    batchDocuments.forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
    deletedCount += batchDocuments.length;
  }

  return { deletedCount, recursive: false };
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Use POST.' });
    return;
  }

  const authorization = await authorizeManagerSessionRequest(request);
  if (!authorization.ok) {
    sendJson(response, authorization.status, authorization.body);
    return;
  }

  const firebaseAdmin = getFirebaseAdmin();
  if (!firebaseAdmin) {
    sendJson(response, 503, {
      ok: false,
      code: 'firebase_admin_not_configured',
      message: 'Firebase Admin access is not configured.',
    });
    return;
  }

  let body;
  try {
    body = readJsonBody(request);
  } catch {
    sendJson(response, 400, { ok: false, message: 'Invalid JSON body.' });
    return;
  }

  const canonicalRestaurant = await loadCanonicalRestaurant(firebaseAdmin);
  const canonicalDatabaseId = toSafeString(canonicalRestaurant?.databaseId);

  if (!canonicalDatabaseId) {
    sendJson(response, 404, { ok: false, message: 'No canonical Firebase restaurant was found.' });
    return;
  }

  if (authorization.databaseId !== canonicalDatabaseId) {
    sendJson(response, 409, {
      ok: false,
      code: 'non_canonical_session',
      canonicalRestaurant: createSafeRestaurantResponse(canonicalRestaurant),
      message: 'Sign in again so this device joins the canonical restaurant before cleanup.',
    });
    return;
  }

  const duplicateDocuments = await findDuplicateDocuments(firebaseAdmin.db, canonicalDatabaseId);
  const summary = summarizeDocuments(duplicateDocuments);
  const dryRun = body?.confirmation !== CLEANUP_CONFIRMATION;

  if (dryRun) {
    sendJson(response, 200, {
      ok: true,
      dryRun: true,
      canonicalRestaurant: createSafeRestaurantResponse(canonicalRestaurant),
      summary,
      message: summary.totalDocuments === 0
        ? 'No duplicate Firebase scopes were found.'
        : `Dry run found ${summary.totalDocuments} duplicate Firebase document${summary.totalDocuments === 1 ? '' : 's'}.`,
    });
    return;
  }

  const deleteResult = await deleteDocuments(firebaseAdmin.db, duplicateDocuments);

  sendJson(response, 200, {
    ok: true,
    dryRun: false,
    canonicalRestaurant: createSafeRestaurantResponse(canonicalRestaurant),
    summary,
    deletedCount: deleteResult.deletedCount,
    recursiveDelete: deleteResult.recursive,
    message: `Deleted ${deleteResult.deletedCount} duplicate Firebase document${deleteResult.deletedCount === 1 ? '' : 's'}.`,
  });
}
