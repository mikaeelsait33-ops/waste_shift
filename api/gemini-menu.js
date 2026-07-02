import { authorizeManagerApiRequest } from './_auth.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          category: { type: 'STRING' },
          sellingPrice: { type: 'NUMBER' },
          description: { type: 'STRING' },
          portion: { type: 'STRING' },
          components: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                cost: { type: 'NUMBER' },
              },
              required: ['name'],
            },
          },
          confidence: { type: 'NUMBER' },
          warnings: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['name', 'confidence'],
      },
    },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: ['items'],
};

export const config = {
  maxDuration: 60,
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

export const parseGeminiJsonText = (text) => {
  const rawText = String(text || '').trim();
  const withoutFence = rawText
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  return JSON.parse(withoutFence);
};

const getTextFromGeminiResponse = (payload) => (
  payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || '')
    .join('\n')
    .trim() || ''
);

const normalizePrice = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
};

export const normalizeGeminiMenuPayload = (payload) => ({
  items: (Array.isArray(payload?.items) ? payload.items : [])
    .map((item) => {
      const name = String(item?.name || '').trim();

      if (!name) {
        return null;
      }

      return {
        name,
        category: String(item?.category || '').trim(),
        sellingPrice: normalizePrice(item?.sellingPrice),
        description: String(item?.description || '').trim(),
        portion: String(item?.portion || '').trim(),
        components: (Array.isArray(item?.components) ? item.components : [])
          .map((component) => ({
            name: String(component?.name || '').trim(),
            cost: normalizePrice(component?.cost) || 0,
          }))
          .filter((component) => component.name),
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
        warnings: Array.isArray(item?.warnings)
          ? item.warnings.map((warning) => String(warning || '').trim()).filter(Boolean)
          : [],
        source: 'gemini',
      };
    })
    .filter(Boolean),
  warnings: Array.isArray(payload?.warnings)
    ? payload.warnings.map((warning) => String(warning || '').trim()).filter(Boolean)
    : [],
});

const createGeminiParts = ({ text, file }) => {
  const parts = [{
    text: `Extract restaurant menu items for WasteShift.
Return JSON only. Use ZAR prices when visible.
Fields per item: name, category, sellingPrice, description, portion, components, confidence, warnings.
Do not invent prices or ingredients. If unclear, use warnings and lower confidence.
Menu text:
${String(text || '').slice(0, 20000)}`,
  }];

  if (file?.base64) {
    const byteLength = Buffer.byteLength(file.base64, 'base64');

    if (byteLength > MAX_FILE_BYTES) {
      throw new Error('This menu file is too large. Try a smaller PDF/image or paste the text.');
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimeType)) {
      throw new Error('Gemini menu import supports PDF, JPG, PNG, and WebP files.');
    }

    parts.push({
      inline_data: {
        mime_type: file.mimeType,
        data: file.base64,
      },
    });
  }

  return parts;
};

const callGemini = async ({ apiKey, model, text, file }) => {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: createGeminiParts({ text, file }) }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body?.error?.message || `Gemini request failed with status ${response.status}.`);
  }

  return body;
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Use POST for menu import.' });
    return;
  }

  const authorization = authorizeManagerApiRequest(request);

  if (!authorization.ok) {
    sendJson(response, authorization.status, authorization.body);
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;

  if (!apiKey) {
    sendJson(response, 503, {
      ok: false,
      message: 'Gemini API key is not configured. Add GEMINI_API_KEY to Vercel environment variables.',
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const text = String(body?.text || '');
    const file = body?.file && isPlainObject(body.file) ? body.file : null;

    if (!text.trim() && !file?.base64) {
      sendJson(response, 400, { ok: false, message: 'Provide pasted menu text or a menu file.' });
      return;
    }

    const model = process.env.GEMINI_MENU_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const geminiResponse = await callGemini({ apiKey, model, text, file });
    const normalized = normalizeGeminiMenuPayload(parseGeminiJsonText(getTextFromGeminiResponse(geminiResponse)));

    sendJson(response, 200, {
      ok: true,
      model,
      ...normalized,
    });
  } catch (error) {
    sendJson(response, 422, {
      ok: false,
      message: error?.message || 'Could not import this menu with Gemini.',
    });
  }
}
