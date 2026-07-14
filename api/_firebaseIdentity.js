const getFirebaseApiKey = () => String(
  process.env.FIREBASE_WEB_API_KEY
  || process.env.VITE_FIREBASE_API_KEY
  || ''
).trim();

// Verifies the Firebase-issued ID token with Firebase Auth itself. This avoids
// the incompatible jwks-rsa dependency path in the Vercel Node runtime.
export const verifyFirebaseIdToken = async (idToken) => {
  const token = String(idToken || '').trim();
  const apiKey = getFirebaseApiKey();

  if (!token) {
    throw new Error('Firebase token is required.');
  }

  if (!apiKey) {
    throw new Error('Firebase web API key is not configured.');
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  const body = await response.json().catch(() => ({}));
  const firebaseUser = Array.isArray(body?.users) ? body.users[0] : null;
  const uid = String(firebaseUser?.localId || '').trim();

  if (!response.ok || !uid) {
    throw new Error(String(body?.error?.message || 'Firebase token was rejected.'));
  }

  return { uid };
};
