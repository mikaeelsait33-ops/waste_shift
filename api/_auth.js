import { timingSafeEqual } from 'node:crypto';
import { getFirebaseAdmin } from './_firebaseAdmin.js';
import { verifyFirebaseIdToken } from './_firebaseIdentity.js';
import { loadValidAccessSession } from './_accessSession.js';

export const apiIsProductionRuntime = () => (
  process.env.VERCEL_ENV === 'production'
  || process.env.NODE_ENV === 'production'
);

export const getConfiguredManagerSecret = () => String(
  process.env.WASTESHIFT_MANAGER_API_SECRET
  || process.env.WASTESHIFT_API_SECRET
  || ''
).trim();

export const getConfiguredSyncSecret = () => String(
  process.env.WASTESHIFT_SYNC_SECRET
  || ''
).trim();

const getConfiguredManagerApiSecrets = () => (
  [...new Set([
    getConfiguredManagerSecret(),
    getConfiguredSyncSecret(),
  ].filter(Boolean))]
);

export const getHeaderValue = (request, headerName) => {
  const headerValue = request.headers?.[headerName] ?? request.headers?.[headerName.toLowerCase()];

  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
};

export const safeSecretEquals = (providedSecret, expectedSecret) => {
  const provided = Buffer.from(String(providedSecret || ''));
  const expected = Buffer.from(String(expectedSecret || ''));

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
};

const getBearerToken = (request) => {
  const authorization = String(getHeaderValue(request, 'authorization') || '').trim();
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  return bearerMatch?.[1]?.trim() || '';
};

export const getManagerApiSecret = (request) => (
  String(getHeaderValue(request, 'x-wasteshift-manager-secret') || '').trim()
  || String(getHeaderValue(request, 'x-wasteshift-sync-secret') || '').trim()
  || getBearerToken(request)
);

const getFirebaseIdToken = (request) => (
  String(getHeaderValue(request, 'x-wasteshift-firebase-token') || '').trim()
  || getBearerToken(request)
);

export const getRequestDatabaseId = (request) => (
  String(getHeaderValue(request, 'x-wasteshift-database-id') || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80)
);

export const managerApiProtectionIsConfigured = () => getConfiguredManagerApiSecrets().length > 0;

export const authorizeManagerApiRequest = (request) => {
  const managerSecrets = getConfiguredManagerApiSecrets();

  if (managerSecrets.length === 0) {
    if (!apiIsProductionRuntime()) {
      return { ok: true, mode: 'local-open' };
    }

    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: 'manager_api_secret_not_configured',
        message: 'Manager API protection is not configured. Add WASTESHIFT_MANAGER_API_SECRET in production.',
      },
    };
  }

  const providedSecret = getManagerApiSecret(request);

  if (!providedSecret) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        code: 'manager_api_secret_required',
        message: 'Manager authorization is required for this action.',
      },
    };
  }

  if (!managerSecrets.some((managerSecret) => safeSecretEquals(providedSecret, managerSecret))) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        code: 'manager_api_secret_invalid',
        message: 'Manager authorization was rejected.',
      },
    };
  }

  return { ok: true, mode: 'secret' };
};

const managerSessionError = (status, code, message) => ({
  ok: false,
  status,
  body: { ok: false, code, message },
});

const DEFAULT_RESTAURANT_ACCESS_ROLES = ['owner', 'manager', 'chef', 'barista', 'waiter'];

// Gemini/OCR requests prove a manager PIN once, then use a Firebase-authenticated,
// server-only session. Local development retains the existing protected-route helper.
export const authorizeManagerSessionRequest = async (request) => {
  const firebaseAdmin = getFirebaseAdmin();

  if (!firebaseAdmin) {
    if (!apiIsProductionRuntime()) {
      return authorizeManagerApiRequest(request);
    }

    return managerSessionError(
      503,
      'firebase_manager_session_not_configured',
      'Automatic manager access is not configured on the server. Add Firebase Admin credentials in Vercel.',
    );
  }

  const databaseId = getRequestDatabaseId(request);
  const idToken = getFirebaseIdToken(request);

  if (!databaseId) {
    return managerSessionError(400, 'database_id_required', 'Restaurant data link is missing. Re-open this restaurant link and try again.');
  }

  if (!idToken) {
    return managerSessionError(401, 'manager_session_required', 'Sign in with a manager PIN before using Gemini.');
  }

  let decodedToken;

  try {
    decodedToken = await verifyFirebaseIdToken(idToken);
  } catch {
    return managerSessionError(401, 'manager_session_required', 'Your manager session has expired. Lock and sign in again.');
  }

  try {
    const sessionId = `${databaseId}__${decodedToken.uid}`;
    const sessionSnapshot = await firebaseAdmin.db.collection('managerSessions').doc(sessionId).get();
    const session = sessionSnapshot.exists ? sessionSnapshot.data() : null;
    const expiresAt = new Date(String(session?.expiresAt || '')).getTime();

    if (
      !session
      || session.databaseId !== databaseId
      || session.uid !== decodedToken.uid
      || session.roleKey !== 'manager'
      || !Number.isFinite(expiresAt)
      || expiresAt <= Date.now()
    ) {
      return managerSessionError(403, 'manager_session_rejected', 'Sign in with your manager PIN before using Gemini.');
    }

    return {
      ok: true,
      mode: 'firebase-manager-session',
      databaseId,
      managerId: String(session.managerId || ''),
      uid: decodedToken.uid,
    };
  } catch (error) {
    console.error('Could not verify manager session.', error);
    return managerSessionError(503, 'manager_session_unavailable', 'Manager access is temporarily unavailable. Please try again.');
  }
};

export const authorizeRestaurantSessionRequest = async (request, options = {}) => {
  const firebaseAdmin = getFirebaseAdmin();

  if (!firebaseAdmin) {
    if (!apiIsProductionRuntime()) {
      return authorizeManagerApiRequest(request);
    }

    return managerSessionError(
      503,
      'firebase_access_not_configured',
      'Restaurant access is not configured on the server. Add Firebase Admin credentials in Vercel.',
    );
  }

  const databaseId = getRequestDatabaseId(request);
  const idToken = getFirebaseIdToken(request);

  if (!databaseId) {
    return managerSessionError(400, 'database_id_required', 'Restaurant data link is missing. Re-open this restaurant link and try again.');
  }

  if (!idToken) {
    return managerSessionError(401, 'restaurant_session_required', 'Sign in before saving shared waste photos.');
  }

  let decodedToken;

  try {
    decodedToken = await verifyFirebaseIdToken(idToken);
  } catch {
    return managerSessionError(401, 'firebase_token_invalid', 'Your sign-in session has expired. Lock and sign in again.');
  }

  try {
    const session = await loadValidAccessSession(firebaseAdmin, databaseId, decodedToken.uid);
    const allowedRoles = Array.isArray(options.allowedRoles) && options.allowedRoles.length > 0
      ? options.allowedRoles
      : DEFAULT_RESTAURANT_ACCESS_ROLES;

    if (!session || !allowedRoles.includes(session.roleKey)) {
      return managerSessionError(403, 'restaurant_session_rejected', 'Sign in to this restaurant before saving shared waste photos.');
    }

    return {
      ok: true,
      mode: 'firebase-restaurant-session',
      databaseId,
      staffId: String(session.staffId || ''),
      roleKey: String(session.roleKey || ''),
      uid: decodedToken.uid,
    };
  } catch (error) {
    console.error('Could not verify restaurant session.', error);
    return managerSessionError(503, 'restaurant_session_unavailable', 'Restaurant access is temporarily unavailable. Please try again.');
  }
};

export const authorizeSyncApiRequest = (request) => {
  const managerSecret = getConfiguredManagerSecret();
  const syncSecret = getConfiguredSyncSecret();

  if (!managerSecret && !syncSecret) {
    if (!apiIsProductionRuntime()) {
      return { ok: true, mode: 'local-open' };
    }

    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: 'sync_api_secret_not_configured',
        requiresSecret: true,
        message: 'Server sync protection is not configured. Add WASTESHIFT_SYNC_SECRET or WASTESHIFT_MANAGER_API_SECRET in production.',
      },
    };
  }

  const providedManagerSecret = getManagerApiSecret(request);
  const providedSyncSecret = String(getHeaderValue(request, 'x-wasteshift-sync-secret') || '').trim();

  if (!providedManagerSecret && !providedSyncSecret) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        code: 'sync_api_secret_required',
        requiresSecret: true,
        message: 'Server sync is protected. Add the server sync access key.',
      },
    };
  }

  if (
    (managerSecret && providedManagerSecret && safeSecretEquals(providedManagerSecret, managerSecret))
    || (syncSecret && providedSyncSecret && safeSecretEquals(providedSyncSecret, syncSecret))
  ) {
    return { ok: true, mode: 'secret' };
  }

  return {
    ok: false,
    status: 403,
    body: {
      ok: false,
      code: 'sync_api_secret_invalid',
      requiresSecret: true,
      message: 'Server sync access key is incorrect.',
    },
  };
};
