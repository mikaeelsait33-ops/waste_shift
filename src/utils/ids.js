export const createRecordId = (prefix = 'record') => {
  const safePrefix = String(prefix || 'record')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'record';

  if (globalThis.crypto?.randomUUID) {
    return `${safePrefix}_${globalThis.crypto.randomUUID()}`;
  }

  const bytes = new Uint8Array(16);

  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure record ID generation is unavailable in this browser.');
  }

  globalThis.crypto.getRandomValues(bytes);

  const fallbackId = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `${safePrefix}_${fallbackId}`;
};
