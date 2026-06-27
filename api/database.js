import { randomUUID, timingSafeEqual } from 'node:crypto';
import { get, list, put } from '@vercel/blob';

const LEGACY_DATABASE_PATH = 'wasteshift/database.json';
const DATABASE_FOLDER = 'wasteshift/databases/';
const DATABASE_NAME = 'WasteShift Server Database';
const DATABASE_VERSION = 1;
const MAX_DATABASE_BYTES = 5 * 1024 * 1024;
const SYNC_SECRET = String(process.env.WASTESHIFT_SYNC_SECRET || '').trim();

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow');
  response.status(status).json(body);
};

const getHeaderValue = (request, headerName) => {
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

const authorizeRequest = (request, response) => {
  if (!SYNC_SECRET) {
    return true;
  }

  const providedSecret = String(getHeaderValue(request, 'x-wasteshift-sync-secret') || '').trim();

  if (!providedSecret) {
    sendJson(response, 401, {
      ok: false,
      requiresSecret: true,
      message: 'Server sync is protected. Add the server sync access key.',
    });
    return false;
  }

  if (!safeSecretEquals(providedSecret, SYNC_SECRET)) {
    sendJson(response, 403, {
      ok: false,
      requiresSecret: true,
      message: 'Server sync access key is incorrect.',
    });
    return false;
  }

  return true;
};

const requestBodyIsTooLarge = (request) => {
  const contentLength = Number(getHeaderValue(request, 'content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > MAX_DATABASE_BYTES;
};

const readJsonBody = (request) => {
  if (!request.body) {
    return null;
  }

  if (typeof request.body === 'string') {
    try {
      return JSON.parse(request.body);
    } catch {
      return null;
    }
  }

  return request.body;
};

const isPlainObject = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const validateDatabaseData = (data) => {
  if (!isPlainObject(data)) {
    return 'Expected a database data object.';
  }

  const jsonSize = Buffer.byteLength(JSON.stringify(data), 'utf8');

  if (jsonSize > MAX_DATABASE_BYTES) {
    return 'Database snapshot is too large.';
  }

  const arrayFields = ['wasteItems', 'staffList', 'customStaffList', 'customMenuItems', 'inventoryMovements', 'auditLog'];
  const objectFields = ['recipes', 'portionProfiles', 'settings'];

  for (const field of arrayFields) {
    if (data[field] !== undefined && !Array.isArray(data[field])) {
      return `Invalid database field: ${field}.`;
    }
  }

  for (const field of objectFields) {
    if (data[field] !== undefined && !isPlainObject(data[field])) {
      return `Invalid database field: ${field}.`;
    }
  }

  if (Array.isArray(data.wasteItems) && data.wasteItems.length > 50000) {
    return 'Database has too many waste entries.';
  }

  if (Array.isArray(data.auditLog) && data.auditLog.length > 5000) {
    return 'Audit log is too large.';
  }

  return '';
};

const createSnapshotPath = (updatedAt) => {
  const timestamp = updatedAt.replace(/[:.]/g, '-');
  const id = randomUUID();

  return `${DATABASE_FOLDER}${timestamp}-${id}.json`;
};

const readSnapshotBlob = async (pathname) => {
  const result = await get(pathname, { access: 'private' });

  if (!result?.stream) {
    return null;
  }

  const text = await new Response(result.stream).text();
  return JSON.parse(text);
};

const readDatabase = async () => {
  const { blobs } = await list({ prefix: DATABASE_FOLDER, limit: 1000 });
  const latestBlob = [...blobs]
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .find((blob) => blob.pathname.endsWith('.json'));

  if (latestBlob) {
    return readSnapshotBlob(latestBlob.pathname);
  }

  return readSnapshotBlob(LEGACY_DATABASE_PATH);
};

const writeDatabase = async (data) => {
  const updatedAt = new Date().toISOString();
  const pathname = createSnapshotPath(updatedAt);
  const snapshot = {
    name: DATABASE_NAME,
    version: DATABASE_VERSION,
    updatedAt,
    data,
  };

  const blob = await put(pathname, JSON.stringify(snapshot, null, 2), {
    access: 'private',
    allowOverwrite: false,
    contentType: 'application/json',
  });

  return {
    snapshot,
    blob: {
      pathname: blob.pathname,
      etag: blob.etag,
      uploadedAt: blob.uploadedAt,
    },
  };
};

export default async function handler(request, response) {
  if (!authorizeRequest(request, response)) {
    return;
  }

  if (request.method === 'GET') {
    try {
      const snapshot = await readDatabase();
      sendJson(response, 200, { ok: true, exists: Boolean(snapshot), snapshot });
      return;
    } catch (error) {
      const message = error?.message || 'Server database is not configured yet.';
      const isMissingBlob = /not found|404/i.test(message);

      sendJson(response, isMissingBlob ? 200 : 503, {
        ok: isMissingBlob,
        exists: false,
        snapshot: null,
        message: isMissingBlob ? 'No server database has been saved yet.' : message,
      });
      return;
    }
  }

  if (request.method === 'POST') {
    if (requestBodyIsTooLarge(request)) {
      sendJson(response, 413, { ok: false, message: 'Database snapshot is too large.' });
      return;
    }

    const body = readJsonBody(request);
    const data = body?.data;
    const validationError = validateDatabaseData(data);

    if (validationError) {
      sendJson(response, 400, { ok: false, message: validationError });
      return;
    }

    try {
      const saved = await writeDatabase(data);
      sendJson(response, 200, {
        ok: true,
        updatedAt: saved.snapshot.updatedAt,
        snapshot: saved.snapshot,
        blob: saved.blob,
      });
      return;
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error?.message || 'Could not save the database on the server.',
      });
      return;
    }
  }

  sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
}
