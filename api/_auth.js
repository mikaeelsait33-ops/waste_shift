import { timingSafeEqual } from 'node:crypto';

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

export const managerApiProtectionIsConfigured = () => Boolean(getConfiguredManagerSecret());

export const authorizeManagerApiRequest = (request) => {
  const managerSecret = getConfiguredManagerSecret();

  if (!managerSecret) {
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

  if (!safeSecretEquals(providedSecret, managerSecret)) {
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
