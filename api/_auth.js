import { timingSafeEqual } from 'node:crypto';

const getConfiguredManagerSecret = () => String(
  process.env.WASTESHIFT_MANAGER_API_SECRET
  || process.env.WASTESHIFT_API_SECRET
  || ''
).trim();

export const getHeaderValue = (request, headerName) => {
  const headerValue = request.headers?.[headerName] ?? request.headers?.[headerName.toLowerCase()];

  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
};

const safeSecretEquals = (providedSecret, expectedSecret) => {
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
    return { ok: true, mode: 'open' };
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
