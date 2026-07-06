import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { authorizeManagerApiRequest, apiIsProductionRuntime } from './_auth.js';

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

const getAdminCredential = () => {
  const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();

  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson));
  }

  const projectId = String(process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();

  if (projectId && clientEmail && privateKey) {
    return cert({ projectId, clientEmail, privateKey });
  }

  return null;
};

const getAdminDb = () => {
  const credential = getAdminCredential();

  if (!credential) {
    return null;
  }

  const app = getApps().length > 0
    ? getApps()[0]
    : initializeApp({ credential });

  return getFirestore(app);
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
    return response.status(405).json({ ok: false, message: 'Method not allowed.' });
  }

  const authorization = authorizeManagerApiRequest(request);

  if (!authorization.ok) {
    return response.status(authorization.status).json(authorization.body);
  }

  let body;

  try {
    body = parseBody(request);
  } catch {
    return response.status(400).json({ ok: false, message: 'Invalid reset request body.' });
  }

  if (body?.confirmation !== 'RESET') {
    return response.status(400).json({ ok: false, message: 'Type RESET to confirm.' });
  }

  const db = getAdminDb();

  if (!db) {
    const message = 'Server reset is not configured. Add Firebase Admin credentials and manager secret.';

    return response.status(apiIsProductionRuntime() ? 503 : 501).json({
      ok: false,
      code: 'firebase_admin_not_configured',
      message,
    });
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

    return response.status(errors.length > 0 ? 207 : 200).json({
      ok: errors.length === 0,
      deletedCounts,
      skippedCollections: [],
      errors,
      message: errors.length > 0
        ? 'Reset partially completed. Review deletedCounts and errors.'
        : 'Restaurant data reset. Complete setup again.',
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      deletedCounts,
      errors,
      message: error?.message || 'Reset failed.',
    });
  }
}
