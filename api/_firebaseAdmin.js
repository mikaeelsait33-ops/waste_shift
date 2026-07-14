import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const getAdminCredential = () => {
  const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();

  if (serviceAccountJson) {
    return cert(JSON.parse(serviceAccountJson));
  }

  const projectId = String(process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();

  return projectId && clientEmail && privateKey
    ? cert({ projectId, clientEmail, privateKey })
    : null;
};

// Returns null when the server is intentionally not configured with Admin credentials.
// API routes can then give a clear, fail-closed response instead of exposing Gemini.
export const getFirebaseAdmin = () => {
  try {
    const credential = getAdminCredential();

    if (!credential) {
      return null;
    }

    const app = getApps().length > 0
      ? getApps()[0]
      : initializeApp({ credential });

    return {
      db: getFirestore(app),
    };
  } catch (error) {
    console.error('Firebase Admin configuration could not be loaded.', error);
    return null;
  }
};
