import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { authorizeRestaurantSessionRequest } from './_auth.js';

const WASTE_PHOTO_FOLDER = 'wasteshift/waste-photos/';
const MAX_PHOTO_BYTES = 1536 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const config = {
  maxDuration: 30,
};

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow');
  response.status(status).json(body);
};

const isPlainObject = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readJsonBody = async (request) => {
  if (isPlainObject(request.body)) {
    return request.body;
  }

  if (typeof request.body === 'string') {
    return JSON.parse(request.body);
  }

  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const normalizePathPart = (value, fallback) => {
  const safeValue = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);

  return safeValue || fallback;
};

const normalizeFileExtension = (mimeType) => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
};

const parsePhotoBody = (body) => {
  const file = isPlainObject(body?.file) ? body.file : {};
  const dataUrl = String(body?.dataUrl || file.dataUrl || '').trim();
  const dataUrlMatch = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=]+)$/);
  const mimeType = String(file.mimeType || body?.mimeType || dataUrlMatch?.[1] || 'image/jpeg').toLowerCase();
  const base64 = String(file.data || body?.base64 || dataUrlMatch?.[2] || '')
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s+/g, '');

  if (!ALLOWED_MIME_TYPES.has(mimeType) || !base64) {
    throw Object.assign(new Error('Upload a JPG, PNG, or WEBP waste photo.'), { status: 400 });
  }

  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length === 0) {
    throw Object.assign(new Error('Waste photo data was empty.'), { status: 400 });
  }

  if (buffer.length > MAX_PHOTO_BYTES) {
    throw Object.assign(new Error('Waste photo is too large. Try a clearer cropped photo.'), { status: 413 });
  }

  return {
    buffer,
    mimeType,
    photoName: String(body?.photoName || file.name || '').trim(),
  };
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Use POST to save a waste photo.' });
    return;
  }

  const authorization = await authorizeRestaurantSessionRequest(request);

  if (!authorization.ok) {
    sendJson(response, authorization.status, authorization.body);
    return;
  }

  try {
    const body = await readJsonBody(request);
    const entryId = normalizePathPart(body?.entryId, '');

    if (!entryId) {
      sendJson(response, 400, { ok: false, message: 'Waste entry id is required before saving a photo.' });
      return;
    }

    const { buffer, mimeType, photoName } = parsePhotoBody(body);
    const uploadedAt = new Date().toISOString();
    const extension = normalizeFileExtension(mimeType);
    const pathname = [
      WASTE_PHOTO_FOLDER,
      normalizePathPart(authorization.databaseId, 'local'),
      '/',
      entryId,
      '/',
      uploadedAt.replace(/[:.]/g, '-'),
      '-',
      randomUUID(),
      '.',
      extension,
    ].join('');
    const blob = await put(pathname, buffer, {
      access: 'public',
      allowOverwrite: false,
      contentType: mimeType,
    });

    sendJson(response, 200, {
      ok: true,
      photoUrl: blob.url,
      photoPathname: blob.pathname,
      photoName,
      photoUploadedAt: uploadedAt,
      photoContentType: mimeType,
      photoSizeBytes: buffer.length,
    });
  } catch (error) {
    sendJson(response, error?.status || 500, {
      ok: false,
      message: error?.message || 'Could not save this waste photo.',
    });
  }
}
