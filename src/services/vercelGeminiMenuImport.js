import { createRecordId } from '../utils/ids';
import {
  getAutomaticManagerApiHeaders,
  getManagerApiErrorMessage,
} from '../utils/apiHeaders';
import { getClientDatabaseId } from '../utils/clientDatabaseId';

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

const safeFileName = (name) => {
  const normalized = String(name || 'make-line-guide')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);

  return normalized || 'make-line-guide';
};

const normalizeMimeType = (file) => {
  const type = String(file?.type || '').toLowerCase().trim();
  const name = String(file?.name || '').toLowerCase();

  if (type && ALLOWED_MIME_TYPES.has(type)) return type;
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return '';
};

const validateGuide = (file) => {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('Choose a make-line guide PDF, JPG, PNG, or WebP file.');
  }

  if (!file.size || file.size > MAX_SOURCE_BYTES) {
    throw new Error('This guide is empty or larger than the 50 MB upload limit.');
  }

  const mimeType = normalizeMimeType(file);

  if (!mimeType) {
    throw new Error('Upload a PDF, JPG, PNG, or WebP make-line guide.');
  }

  return mimeType;
};

export const uploadMakeLineGuideToVercel = async (file, { onProgress } = {}) => {
  const mimeType = validateGuide(file);
  const { upload } = await import('@vercel/blob/client');
  const databaseId = getClientDatabaseId() || 'local';
  const pathname = `wasteshift/make-line-guides/${databaseId}/${createRecordId('guide')}-${safeFileName(file.name)}`;
  const clientPayload = JSON.stringify({ databaseId, documentType: 'make-line-guide' });

  onProgress?.('Uploading the complete make-line guide...');
  const blob = await upload(pathname, file, {
    access: 'public',
    handleUploadUrl: '/api/gemini-menu-upload',
    clientPayload,
    headers: await getAutomaticManagerApiHeaders(),
    contentType: mimeType,
    multipart: file.size > 5 * 1024 * 1024,
    onUploadProgress: ({ percentage }) => {
      onProgress?.(`Uploading the complete make-line guide... ${Math.round(percentage)}%`);
    },
  });

  onProgress?.('Gemini is reading the complete guide...');
  const response = await fetch('/api/gemini-menu', {
    method: 'POST',
    headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      blobPathname: blob.pathname,
      sourceName: file.name,
      sourceMimeType: mimeType,
      sourceType: 'make-line-guide',
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.ok === false || payload?.success === false) {
    throw new Error(getManagerApiErrorMessage(payload, 'Gemini could not read this make-line guide.'));
  }

  return payload;
};
