import { get, list, put } from '@vercel/blob';

const LEGACY_DATABASE_PATH = 'wasteshift/database.json';
const DATABASE_FOLDER = 'wasteshift/databases/';
const DATABASE_NAME = 'WasteShift Server Database';
const DATABASE_VERSION = 1;

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.status(status).json(body);
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

const createSnapshotPath = (updatedAt) => {
  const timestamp = updatedAt.replace(/[:.]/g, '-');
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
    const body = readJsonBody(request);
    const data = body?.data;

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      sendJson(response, 400, { ok: false, message: 'Expected a database data object.' });
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
