import { authorizeManagerSessionRequest } from './_auth.js';

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
    dishes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          category: { type: 'STRING' },
          ingredients: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                quantity: { type: 'NUMBER' },
                unit: { type: 'STRING' },
              },
              required: ['name', 'quantity', 'unit'],
            },
          },
          instructions: { type: 'STRING' },
          sellingPrice: { type: 'NUMBER' },
          confidence: { type: 'NUMBER' },
          warnings: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['name', 'category', 'ingredients'],
      },
    },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: ['dishes'],
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

export const normalizeGeminiMenuPayload = (payload) => {
  const rawDishes = Array.isArray(payload?.dishes)
    ? payload.dishes
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
  const dishes = rawDishes
    .map((item) => {
      const name = String(item?.name || '').trim();

      if (!name) {
        return null;
      }

      return {
        name,
        category: String(item?.category || '').trim(),
        sellingPrice: normalizePrice(item?.sellingPrice),
        instructions: String(item?.instructions || item?.description || '').trim(),
        ingredients: (Array.isArray(item?.ingredients) ? item.ingredients : Array.isArray(item?.components) ? item.components : [])
          .map((ingredient) => ({
            name: String(ingredient?.name || ingredient?.ingredientName || '').trim(),
            quantity: Number.isFinite(Number(ingredient?.quantity)) && Number(ingredient.quantity) > 0
              ? Number(ingredient.quantity)
              : null,
            unit: String(ingredient?.unit || '').trim(),
          }))
          .filter((ingredient) => ingredient.name),
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
        warnings: Array.isArray(item?.warnings)
          ? item.warnings.map((warning) => String(warning || '').trim()).filter(Boolean)
          : [],
        source: 'gemini',
      };
    })
    .filter(Boolean);

  return {
    dishes,
    items: dishes.map((dish) => ({
      name: dish.name,
      category: dish.category,
      sellingPrice: dish.sellingPrice,
      description: dish.instructions,
      components: dish.ingredients.map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
      })),
      confidence: dish.confidence,
      warnings: dish.warnings,
      source: dish.source,
    })),
    warnings: Array.isArray(payload?.warnings)
    ? payload.warnings.map((warning) => String(warning || '').trim()).filter(Boolean)
    : [],
  };
};

const normalizeGeminiFiles = ({ file, guideFile, files }) => (
  [
    ...(Array.isArray(files) ? files : []),
    file,
    guideFile,
  ].filter((candidate) => candidate?.base64)
);

const createGeminiParts = ({ text, file, makeLineGuide, guideFile, files }) => {
  const fileParts = normalizeGeminiFiles({ file, guideFile, files });
  const combinedFileBytes = fileParts
    .filter((candidate) => candidate?.base64)
    .reduce((total, candidate) => total + Buffer.byteLength(candidate.base64, 'base64'), 0);

  if (combinedFileBytes > MAX_FILE_BYTES) {
    throw new Error('The make-line guide files are too large. Use smaller files or paste the guide as text.');
  }

  const guideText = [
    String(text || '').trim(),
    String(makeLineGuide || '').trim(),
  ].filter(Boolean).join('\n\n');

  const parts = [{
    text: `Extract restaurant recipes for WasteShift from a make-line or prep guide.
Return strict JSON only. The top-level shape must be {"dishes":[...],"warnings":[]}.
Each dish must include: name, category, ingredients, optional instructions, optional sellingPrice, confidence, warnings.
Each ingredient must include: name, quantity, unit.
Use units like g, kg, ml, l, each, doz, slice, bun, bottle, packet where visible.
The make-line guide is the source of truth for portions. Use visible dish or build names as dish names, then use its explicit quantities exactly, especially grams and millilitres.
Do not treat the document as a customer-facing menu. Do not infer dishes from marketing descriptions.
Do not invent gram or millilitre amounts. When an exact amount is not visible in the make-line guide, set quantity to 1, unit to "each", and add a warning for human review.
Do not invent selling prices. Only return sellingPrice when it is explicitly visible in the guide or pasted text. Do not include markdown.

Make-line guide text:
${guideText.slice(0, 30000)}`,
  }];

  const appendFilePart = (nextFile, label) => {
    if (!nextFile?.base64) {
      return;
    }

    const byteLength = Buffer.byteLength(nextFile.base64, 'base64');

    if (byteLength > MAX_FILE_BYTES) {
      throw new Error(`This ${label} file is too large. Try a smaller PDF/image or paste the text.`);
    }

    if (!ALLOWED_MIME_TYPES.has(nextFile.mimeType)) {
      throw new Error(`Gemini make-line guide import supports PDF, JPG, PNG, and WebP ${label} files.`);
    }

    parts.push({
      inline_data: {
        mime_type: nextFile.mimeType,
        data: nextFile.base64,
      },
    });
  };

  fileParts.forEach((nextFile, index) => {
    appendFilePart(nextFile, fileParts.length === 1 ? 'make-line guide' : `make-line guide page ${index + 1}`);
  });

  return parts;
};

export { createGeminiParts };

const callGemini = async ({ apiKey, model, text, file, makeLineGuide, guideFile, files }) => {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: createGeminiParts({ text, file, makeLineGuide, guideFile, files }) }],
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
    sendJson(response, 405, { ok: false, message: 'Use POST for make-line guide import.' });
    return;
  }

  const authorization = await authorizeManagerSessionRequest(request);

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
    const files = Array.isArray(body?.files) ? body.files.filter(isPlainObject) : [];
    const makeLineGuide = String(body?.makeLineGuide || '');
    const guideFile = body?.guideFile && isPlainObject(body.guideFile) ? body.guideFile : null;

    if (!text.trim() && !file?.base64 && files.every((nextFile) => !nextFile?.base64) && !makeLineGuide.trim() && !guideFile?.base64) {
      sendJson(response, 400, { ok: false, message: 'Provide pasted make-line guide text or a make-line guide file.' });
      return;
    }

    const model = process.env.GEMINI_MENU_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const geminiResponse = await callGemini({ apiKey, model, text, file, makeLineGuide, guideFile, files });
    const normalized = normalizeGeminiMenuPayload(parseGeminiJsonText(getTextFromGeminiResponse(geminiResponse)));

    sendJson(response, 200, {
      ok: true,
      model,
      ...normalized,
    });
  } catch (error) {
    sendJson(response, 422, {
      ok: false,
      message: error?.message || 'Could not import this make-line guide with Gemini.',
    });
  }
}
