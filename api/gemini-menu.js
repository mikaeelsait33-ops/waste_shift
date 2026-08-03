import { authorizeManagerSessionRequest } from './_auth.js';
import { del, get } from '@vercel/blob';

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_FILES_PER_BATCH = 2;
const GEMINI_REQUEST_TIMEOUT_MS = 70_000;
const MAX_OUTPUT_TOKENS = 32768;
const MAX_STORED_GUIDE_BYTES = 50 * 1024 * 1024;
const GUIDE_FOLDER = 'wasteshift/make-line-guides/';
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
  maxDuration: 120,
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

export const createGeminiFileBatches = ({ file, guideFile, files }) => {
  const fileParts = normalizeGeminiFiles({ file, guideFile, files });

  if (
    fileParts.length <= MAX_IMAGE_FILES_PER_BATCH
    || fileParts.some((candidate) => candidate?.mimeType === 'application/pdf')
  ) {
    return [fileParts];
  }

  const batches = [];

  for (let index = 0; index < fileParts.length; index += MAX_IMAGE_FILES_PER_BATCH) {
    batches.push(fileParts.slice(index, index + MAX_IMAGE_FILES_PER_BATCH));
  }

  return batches;
};

export const createGeminiPrompt = ({ text = '', makeLineGuide = '' } = {}) => {
  const guideText = [
    String(text || '').trim(),
    String(makeLineGuide || '').trim(),
  ].filter(Boolean).join('\n\n');

  return `Extract restaurant recipes for WasteShift from a make-line or prep guide.
Return strict JSON only. The top-level shape must be {"dishes":[...],"warnings":[]}.
Read the entire document before answering. Return every dish, build, prep item, and recipe that has an actual portion or ingredient list; do not stop after the first page or a small sample.
Each dish must include: name, category, ingredients, optional instructions, optional sellingPrice, confidence, warnings.
Each ingredient must include: name, quantity, unit.
Use units like g, kg, ml, l, each, doz, slice, bun, bottle, packet where visible.
The make-line guide is the source of truth for portions. Use visible dish or build names as dish names, then use its explicit quantities exactly, especially grams and millilitres.
Do not treat the document as a customer-facing menu. Do not infer dishes from marketing descriptions.
Do not invent gram or millilitre amounts. When an exact amount is not visible in the make-line guide, set quantity to 1, unit to "each", and add a warning for human review.
Do not invent selling prices. Only return sellingPrice when it is explicitly visible in the guide or pasted text. Do not include markdown.
Do not omit later pages or return only a sample.

Make-line guide text:
${guideText.slice(0, 30000)}`;
};

const createGeminiParts = ({ text, file, makeLineGuide, guideFile, files }) => {
  const fileParts = normalizeGeminiFiles({ file, guideFile, files });
  const combinedFileBytes = fileParts
    .filter((candidate) => candidate?.base64)
    .reduce((total, candidate) => total + Buffer.byteLength(candidate.base64, 'base64'), 0);

  if (combinedFileBytes > MAX_FILE_BYTES) {
    throw new Error('The make-line guide files are too large. Use smaller files or paste the guide as text.');
  }

  const parts = [{
    text: createGeminiPrompt({ text, makeLineGuide }),
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

export const createGeminiGenerationConfig = (model) => ({
  temperature: 0.1,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  responseMimeType: 'application/json',
  responseSchema: RESPONSE_SCHEMA,
  ...(String(model || '').includes('2.5')
    ? { thinkingConfig: { thinkingBudget: 0 } }
    : {}),
});

export const mergeGeminiMenuPayloads = (payloads) => {
  const dishesByName = new Map();
  const warnings = new Set();

  (Array.isArray(payloads) ? payloads : []).forEach((payload) => {
    const normalized = normalizeGeminiMenuPayload(payload);

    normalized.warnings.forEach((warning) => warnings.add(warning));
    normalized.dishes.forEach((dish) => {
      const key = dish.name.toLowerCase().replace(/\s+/g, ' ').trim();
      const existing = dishesByName.get(key);

      if (!existing) {
        dishesByName.set(key, {
          ...dish,
          ingredients: [...dish.ingredients],
          warnings: [...dish.warnings],
        });
        return;
      }

      const ingredientsByName = new Map(
        existing.ingredients.map((ingredient) => [ingredient.name.toLowerCase().trim(), ingredient]),
      );
      dish.ingredients.forEach((ingredient) => {
        const ingredientKey = ingredient.name.toLowerCase().trim();
        const currentIngredient = ingredientsByName.get(ingredientKey);

        if (
          !currentIngredient
          || (currentIngredient.quantity === null && ingredient.quantity !== null)
        ) {
          ingredientsByName.set(ingredientKey, ingredient);
        }
      });

      dishesByName.set(key, {
        ...existing,
        category: existing.category || dish.category,
        sellingPrice: existing.sellingPrice ?? dish.sellingPrice,
        instructions: existing.instructions || dish.instructions,
        ingredients: [...ingredientsByName.values()],
        confidence: Math.max(existing.confidence, dish.confidence),
        warnings: [...new Set([...existing.warnings, ...dish.warnings])],
      });
    });
  });

  return normalizeGeminiMenuPayload({
    dishes: [...dishesByName.values()],
    warnings: [...warnings],
  });
};

const createGeminiError = (message, status = 422, code = 'gemini_menu_failed') => (
  Object.assign(new Error(message), { status, code })
);

const callGemini = async ({ apiKey, model, text, file, makeLineGuide, guideFile, files }) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: createGeminiParts({ text, file, makeLineGuide, guideFile, files }) }],
          generationConfig: createGeminiGenerationConfig(model),
        }),
      },
    );
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = body?.error?.message || `Gemini request failed with status ${response.status}.`;

      if (response.status === 429) {
        throw createGeminiError(
          'Gemini is receiving too many requests right now. Wait a moment and retry this guide.',
          429,
          'gemini_rate_limited',
        );
      }

      throw createGeminiError(
        message,
        response.status >= 500 ? 502 : 422,
        response.status >= 500 ? 'gemini_unavailable' : 'gemini_menu_rejected',
      );
    }

    const responseText = getTextFromGeminiResponse(body);

    if (!responseText) {
      throw createGeminiError(
        'Gemini returned no recipe data for this guide. Retry once or upload the relevant guide pages only.',
        422,
        'gemini_empty_response',
      );
    }

    return normalizeGeminiMenuPayload(parseGeminiJsonText(responseText));
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createGeminiError(
        'Gemini took too long to read this guide. Retry once or upload fewer guide pages.',
        504,
        'gemini_menu_timeout',
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const uploadStoredGuideToGemini = async ({ buffer, mimeType, displayName, apiKey }) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);

  try {
    const startResponse = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
        'x-goog-upload-protocol': 'resumable',
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(buffer.length),
        'x-goog-upload-header-content-type': mimeType,
      },
      signal: controller.signal,
      body: JSON.stringify({ file: { display_name: displayName } }),
    });
    const startBody = await startResponse.json().catch(() => ({}));

    if (!startResponse.ok) {
      throw createGeminiError(startBody?.error?.message || 'Gemini rejected the guide file.', startResponse.status);
    }

    const uploadUrl = startResponse.headers.get('x-goog-upload-url');

    if (!uploadUrl) {
      throw createGeminiError('Gemini did not provide a file upload URL.', 502, 'gemini_file_upload_failed');
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'content-length': String(buffer.length),
        'x-goog-upload-offset': '0',
        'x-goog-upload-command': 'upload, finalize',
      },
      signal: controller.signal,
      body: buffer,
    });
    const uploadBody = await uploadResponse.json().catch(() => ({}));

    if (!uploadResponse.ok) {
      throw createGeminiError(uploadBody?.error?.message || 'Gemini could not store the guide file.', uploadResponse.status);
    }

    const file = uploadBody?.file || uploadBody;

    if (!file?.name || !file?.uri) {
      throw createGeminiError('Gemini returned an incomplete guide file.', 502, 'gemini_file_upload_failed');
    }

    return file;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createGeminiError('Gemini took too long to prepare the guide file.', 504, 'gemini_file_upload_timeout');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const waitForStoredGuide = async ({ file, apiKey }) => {
  if (String(file.state || '').toUpperCase() === 'ACTIVE') {
    return file;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < 30_000) {
    await wait(1_500);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, {
      headers: { accept: 'application/json', 'x-goog-api-key': apiKey },
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw createGeminiError(body?.error?.message || 'Gemini could not prepare the guide file.', response.status);
    }

    const nextFile = body?.file || body;
    const state = String(nextFile?.state || '').toUpperCase();

    if (state === 'ACTIVE') return nextFile;
    if (state === 'FAILED') {
      throw createGeminiError('Gemini could not process this guide file.', 422, 'gemini_file_processing_failed');
    }
  }

  throw createGeminiError('Gemini took too long to prepare this guide file.', 504, 'gemini_file_processing_timeout');
};

const callGeminiStoredGuide = async ({ apiKey, model, buffer, mimeType, sourceName }) => {
  const uploadedFile = await uploadStoredGuideToGemini({
    buffer,
    mimeType,
    displayName: sourceName || 'make-line-guide',
    apiKey,
  });
  const activeFile = await waitForStoredGuide({ file: uploadedFile, apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: createGeminiPrompt() },
              { file_data: { mime_type: mimeType, file_uri: activeFile.uri } },
            ],
          }],
          generationConfig: createGeminiGenerationConfig(model),
        }),
      },
    );
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw createGeminiError(body?.error?.message || `Gemini request failed with status ${response.status}.`, response.status);
    }

    const responseText = getTextFromGeminiResponse(body);

    if (!responseText) {
      throw createGeminiError('Gemini returned no recipe data for this guide.', 422, 'gemini_empty_response');
    }

    return normalizeGeminiMenuPayload(parseGeminiJsonText(responseText));
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createGeminiError('Gemini took too long to read this guide. Retry once.', 504, 'gemini_menu_timeout');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const readStoredGuide = async (pathname) => {
  const stored = await get(pathname, { access: 'public' });

  if (!stored?.stream) {
    throw createGeminiError('The uploaded guide could not be opened.', 404, 'guide_file_not_found');
  }

  const buffer = Buffer.from(await new Response(stored.stream).arrayBuffer());

  if (!buffer.length || buffer.length > MAX_STORED_GUIDE_BYTES) {
    throw createGeminiError('The uploaded guide is empty or larger than the 50 MB limit.', 413, 'guide_file_too_large');
  }

  return buffer;
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
    const startedAt = Date.now();
    const body = await readJsonBody(request);
    const text = String(body?.text || '');
    const file = body?.file && isPlainObject(body.file) ? body.file : null;
    const files = Array.isArray(body?.files) ? body.files.filter(isPlainObject) : [];
    const makeLineGuide = String(body?.makeLineGuide || '');
    const guideFile = body?.guideFile && isPlainObject(body.guideFile) ? body.guideFile : null;
    const blobPathname = String(body?.blobPathname || '').trim();

    if (!text.trim() && !file?.base64 && files.every((nextFile) => !nextFile?.base64) && !makeLineGuide.trim() && !guideFile?.base64 && !blobPathname) {
      sendJson(response, 400, { ok: false, message: 'Provide pasted make-line guide text or a make-line guide file.' });
      return;
    }

    const model = process.env.GEMINI_MENU_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;

    if (blobPathname) {
      if (!blobPathname.startsWith(`${GUIDE_FOLDER}${authorization.databaseId}/`)) {
        sendJson(response, 403, { ok: false, message: 'This guide does not belong to the active restaurant.' });
        return;
      }

      const sourceMimeType = String(body?.sourceMimeType || '').toLowerCase();

      if (!ALLOWED_MIME_TYPES.has(sourceMimeType)) {
        sendJson(response, 400, { ok: false, message: 'The uploaded guide file type is not supported.' });
        return;
      }

      let buffer;

      try {
        buffer = await readStoredGuide(blobPathname);
        const normalized = await callGeminiStoredGuide({
          apiKey,
          model,
          buffer,
          mimeType: sourceMimeType,
          sourceName: String(body?.sourceName || 'make-line-guide'),
        });

        sendJson(response, 200, {
          ok: true,
          model,
          batchCount: 1,
          ...normalized,
        });
      } finally {
        await del(blobPathname).catch((error) => {
          console.warn('[gemini-menu] temporary guide cleanup failed', {
            pathname: blobPathname,
            message: error?.message || 'unknown cleanup error',
          });
        });
      }

      return;
    }

    const fileBatches = createGeminiFileBatches({ file, guideFile, files });
    const fileParts = normalizeGeminiFiles({ file, guideFile, files });
    const combinedFileBytes = fileParts.reduce(
      (total, candidate) => total + Buffer.byteLength(candidate.base64 || '', 'base64'),
      0,
    );

    console.info('[gemini-menu] extraction started', {
      requestId: String(request.headers?.['x-vercel-id'] || ''),
      databaseId: authorization.databaseId || '',
      model,
      fileCount: fileParts.length,
      fileBytes: combinedFileBytes,
      batchCount: fileBatches.length,
      hasText: Boolean(text.trim() || makeLineGuide.trim()),
    });

    const batchPayloads = await Promise.all(fileBatches.map(async (batchFiles, batchIndex) => {
      try {
        return await callGemini({
          apiKey,
          model,
          text,
          makeLineGuide,
          files: batchFiles,
        });
      } catch (error) {
        if (fileBatches.length > 1) {
          error.message = `Guide page batch ${batchIndex + 1} of ${fileBatches.length} failed. ${error.message}`;
        }
        throw error;
      }
    }));
    const normalized = mergeGeminiMenuPayloads(batchPayloads);

    console.info('[gemini-menu] extraction completed', {
      requestId: String(request.headers?.['x-vercel-id'] || ''),
      model,
      batchCount: fileBatches.length,
      dishCount: normalized.dishes.length,
      durationMs: Date.now() - startedAt,
    });

    sendJson(response, 200, {
      ok: true,
      model,
      batchCount: fileBatches.length,
      ...normalized,
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 422;

    console.error('[gemini-menu] extraction failed', {
      requestId: String(request.headers?.['x-vercel-id'] || ''),
      code: error?.code || 'gemini_menu_failed',
      status,
      message: error?.message || 'Could not import this make-line guide with Gemini.',
    });

    sendJson(response, status, {
      ok: false,
      code: error?.code || 'gemini_menu_failed',
      retryable: [429, 502, 504].includes(status),
      message: error?.message || 'Could not import this make-line guide with Gemini.',
    });
  }
}
