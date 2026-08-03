import { handleUpload } from '@vercel/blob/client';
import { authorizeManagerSessionRequest } from './_auth.js';

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const GUIDE_FOLDER = 'wasteshift/make-line-guides/';
const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export const config = { maxDuration: 30 };

const sendJson = (response, status, body) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-robots-tag', 'noindex, nofollow');
  response.status(status).json(body);
};

const readBody = (request) => {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body);
  return {};
};

const readClientPayload = (clientPayload) => {
  try {
    return JSON.parse(String(clientPayload || '{}'));
  } catch {
    return {};
  }
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Use POST to upload a make-line guide.' });
    return;
  }

  let body;

  try {
    body = readBody(request);
  } catch {
    sendJson(response, 400, { ok: false, message: 'The guide upload request was invalid.' });
    return;
  }

  const isTokenRequest = body?.type === 'blob.generate-client-token';
  const authorization = isTokenRequest ? await authorizeManagerSessionRequest(request) : null;

  if (authorization && !authorization.ok) {
    sendJson(response, authorization.status, authorization.body);
    return;
  }

  try {
    const result = await handleUpload({
      request,
      body,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = readClientPayload(clientPayload);
        const databaseId = String(payload.databaseId || authorization?.databaseId || '').trim();

        if (!databaseId || !pathname.startsWith(`${GUIDE_FOLDER}${databaseId}/`)) {
          throw new Error('The guide upload path is invalid.');
        }

        if (authorization && authorization.databaseId !== databaseId) {
          throw new Error('The guide upload belongs to a different restaurant.');
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_SOURCE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ databaseId }),
        };
      },
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || 'The guide could not be uploaded to Vercel Blob.',
    });
  }
}
