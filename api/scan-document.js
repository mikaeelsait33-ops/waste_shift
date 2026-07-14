import { authorizeManagerSessionRequest } from './_auth.js';
import { parseInvoiceText, roundMoney } from '../src/utils/invoiceParsing.js';

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const OCR_ENDPOINT = 'https://api.ocr.space/parse/image';
const MAX_SCAN_BYTES = 9 * 1024 * 1024;
const MIN_USABLE_OCR_TEXT_LENGTH = 80;
const ALLOWED_DOCUMENT_TYPES = new Set(['invoice', 'menu']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

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

const stripBase64Prefix = (value) => String(value || '')
  .replace(/^data:[^;]+;base64,/i, '')
  .replace(/\s+/g, '');

const getApproxBase64Bytes = (data) => Math.ceil(stripBase64Prefix(data).length * 0.75);

const toNullableString = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const toNullableNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? roundMoney(number) : null;
};

const clampConfidence = (value, fallback = 0.72) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};

const getGeminiText = (payload) => (
  (payload?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => part?.text || '')
    .join('')
    .trim()
);

const parseJsonText = (text) => {
  const trimmed = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
  }

  throw new Error('Gemini returned text that was not valid JSON.');
};

const normalizeWarnings = (warnings) => (
  (Array.isArray(warnings) ? warnings : [])
    .map((warning) => String(warning || '').trim())
    .filter(Boolean)
);

const createEmptyInvoiceExtraction = () => ({
  supplierName: null,
  invoiceNumber: null,
  invoiceDate: null,
  dueDate: null,
  currency: 'ZAR',
  subtotal: null,
  vatAmount: null,
  totalAmount: null,
  lineItems: [],
  warnings: [],
});

const createEmptyMenuExtraction = () => ({
  menuItems: [],
  warnings: [],
});

const normalizeInvoiceExtraction = (payload) => {
  const source = isPlainObject(payload?.invoice) ? payload.invoice : payload;
  const lineItems = (Array.isArray(source?.lineItems) ? source.lineItems : Array.isArray(source?.items) ? source.items : [])
    .map((item) => {
      const description = String(item?.description || item?.itemName || item?.name || '').trim();

      if (!description) {
        return null;
      }

      const quantity = toNullableNumber(item?.quantity);
      const lineTotal = toNullableNumber(item?.lineTotal ?? item?.inclusiveTotal ?? item?.exclusiveTotal);
      const unitPrice = toNullableNumber(item?.unitPrice);
      const confidence = clampConfidence(item?.confidence, 0.74);

      return {
        description,
        matchedIngredientName: toNullableString(item?.matchedIngredientName),
        quantity,
        purchaseUnit: toNullableString(item?.purchaseUnit || item?.unit),
        packSize: toNullableNumber(item?.packSize),
        packUnit: toNullableString(item?.packUnit),
        unitPrice,
        lineTotal,
        vatIncluded: typeof item?.vatIncluded === 'boolean' ? item.vatIncluded : null,
        category: toNullableString(item?.category),
        confidence,
        needsReview: item?.needsReview !== false || confidence < 0.82 || quantity === null || lineTotal === null,
        rawLine: String(item?.rawLine || description).trim(),
      };
    })
    .filter(Boolean);
  const warnings = normalizeWarnings(source?.warnings);

  if (!source?.supplierName) warnings.push('Supplier name was not clearly detected.');
  if (lineItems.length === 0) warnings.push('No reliable invoice line items were detected.');

  return {
    supplierName: toNullableString(source?.supplierName),
    invoiceNumber: toNullableString(source?.invoiceNumber),
    invoiceDate: toNullableString(source?.invoiceDate),
    dueDate: toNullableString(source?.dueDate),
    currency: String(source?.currency || 'ZAR').trim() || 'ZAR',
    subtotal: toNullableNumber(source?.subtotal ?? source?.totals?.totalExVAT),
    vatAmount: toNullableNumber(source?.vatAmount ?? source?.totals?.totalVAT),
    totalAmount: toNullableNumber(source?.totalAmount ?? source?.totals?.totalIncVAT),
    lineItems,
    warnings,
  };
};

const normalizeMenuExtraction = (payload) => {
  const source = isPlainObject(payload?.menu) ? payload.menu : payload;
  const menuItems = (Array.isArray(source?.menuItems) ? source.menuItems : Array.isArray(source?.items) ? source.items : [])
    .map((item) => {
      const name = String(item?.name || '').trim();

      if (!name) {
        return null;
      }

      const itemConfidence = clampConfidence(item?.confidence, 0.7);
      const possibleIngredients = (Array.isArray(item?.possibleIngredients) ? item.possibleIngredients : Array.isArray(item?.components) ? item.components : [])
        .map((ingredient) => {
          const ingredientName = String(ingredient?.ingredientName || ingredient?.name || '').trim();

          if (!ingredientName) {
            return null;
          }

          const ingredientConfidence = clampConfidence(ingredient?.confidence, 0.52);
          return {
            ingredientName,
            quantity: toNullableNumber(ingredient?.quantity),
            unit: toNullableString(ingredient?.unit),
            confidence: ingredientConfidence,
            needsReview: ingredient?.needsReview !== false || ingredientConfidence < 0.9,
          };
        })
        .filter(Boolean);

      return {
        name,
        category: toNullableString(item?.category),
        sellingPrice: toNullableNumber(item?.sellingPrice ?? item?.price),
        description: toNullableString(item?.description),
        possibleIngredients,
        confidence: itemConfidence,
        needsReview: item?.needsReview !== false || itemConfidence < 0.86 || possibleIngredients.length > 0,
      };
    })
    .filter(Boolean);
  const warnings = normalizeWarnings(source?.warnings);

  if (menuItems.length === 0) warnings.push('No reliable menu items were detected.');

  return {
    menuItems,
    warnings,
  };
};

const getInvoiceConfidenceInputs = (invoice) => [
  invoice.supplierName ? 0.08 : 0,
  invoice.invoiceNumber ? 0.05 : 0,
  invoice.invoiceDate ? 0.05 : 0,
  invoice.totalAmount ? 0.06 : 0,
  invoice.lineItems.length > 0 ? 0.28 : 0,
  invoice.lineItems.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, invoice.lineItems.length) * 0.48,
];

const calculateExtractionConfidence = (documentType, extracted) => {
  if (documentType === 'invoice') {
    return Math.max(0, Math.min(1, getInvoiceConfidenceInputs(extracted).reduce((sum, value) => sum + value, 0)));
  }

  const items = extracted.menuItems || [];
  return Math.max(0, Math.min(1, (
    (items.length > 0 ? 0.4 : 0)
    + (items.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, items.length) * 0.6)
  )));
};

const getLowConfidenceFields = (documentType, extracted) => {
  const fields = [];

  if (documentType === 'invoice') {
    if (!extracted.supplierName) fields.push('supplierName');
    if (!extracted.invoiceDate) fields.push('invoiceDate');
    if (extracted.lineItems.length === 0) fields.push('lineItems');
    extracted.lineItems.forEach((item, index) => {
      if (item.needsReview || item.confidence < 0.75) {
        fields.push(`lineItems.${index}`);
      }
    });
    return fields;
  }

  if (extracted.menuItems.length === 0) fields.push('menuItems');
  extracted.menuItems.forEach((item, index) => {
    if (item.needsReview || item.confidence < 0.75) {
      fields.push(`menuItems.${index}`);
    }
  });
  return fields;
};

const createInvoicePrompt = ({ rawText, supplierHint }) => `You convert OCR text from South African restaurant supplier invoices into strict JSON.
Return JSON only. Do not include markdown. Do not invent missing values; use null when unclear.
Currency defaults to ZAR unless another currency is clearly shown.
Preserve original invoice item descriptions as much as possible.
Separate quantity, purchaseUnit, packSize, packUnit, unitPrice, and lineTotal where possible.
Any weak line must have confidence below 0.75 and needsReview true.
Supplier hint: ${supplierHint || 'none'}
OCR text:
${rawText.slice(0, 30000)}

Return this JSON shape:
{"supplierName":string|null,"invoiceNumber":string|null,"invoiceDate":"YYYY-MM-DD"|null,"dueDate":"YYYY-MM-DD"|null,"currency":"ZAR","subtotal":number|null,"vatAmount":number|null,"totalAmount":number|null,"lineItems":[{"description":string,"matchedIngredientName":string|null,"quantity":number|null,"purchaseUnit":string|null,"packSize":number|null,"packUnit":string|null,"unitPrice":number|null,"lineTotal":number|null,"vatIncluded":boolean|null,"category":string|null,"confidence":number,"needsReview":boolean}],"warnings":[string]}`;

const createMenuPrompt = ({ rawText }) => `You convert OCR text from a restaurant menu into strict JSON for manager review.
Return JSON only. Do not include markdown. Do not invent missing prices or exact recipe quantities.
Suggested ingredients from descriptions must be needsReview true.
OCR text:
${rawText.slice(0, 30000)}

Return this JSON shape:
{"menuItems":[{"name":string,"category":string|null,"sellingPrice":number|null,"description":string|null,"possibleIngredients":[{"ingredientName":string,"quantity":number|null,"unit":string|null,"confidence":number,"needsReview":boolean}],"confidence":number,"needsReview":boolean}],"warnings":[string]}`;

const callOcrSpace = async ({ apiKey, file, imageUrl, engine }) => {
  const params = new URLSearchParams();
  params.set('apikey', apiKey);
  params.set('OCREngine', String(engine));
  params.set('isTable', 'true');
  params.set('detectOrientation', 'true');
  params.set('scale', 'true');
  params.set('isOverlayRequired', 'false');
  params.set('language', 'auto');

  if (imageUrl) {
    params.set('url', imageUrl);
  } else {
    params.set('base64Image', `data:${file.mimeType};base64,${file.data}`);
    params.set('filetype', file.mimeType === 'application/pdf' ? 'PDF' : '');
  }

  const ocrResponse = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const bodyText = await ocrResponse.text();
  const payload = bodyText ? JSON.parse(bodyText) : {};

  if (!ocrResponse.ok || payload?.IsErroredOnProcessing) {
    const message = payload?.ErrorMessage || payload?.ErrorDetails || `OCR.space failed with status ${ocrResponse.status}.`;
    throw new Error(Array.isArray(message) ? message.join(' ') : String(message));
  }

  const parsedResults = Array.isArray(payload?.ParsedResults) ? payload.ParsedResults : [];
  const rawText = parsedResults
    .map((result) => String(result?.ParsedText || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const warnings = normalizeWarnings([
    ...(parsedResults.flatMap((result) => result?.ErrorMessage || [])),
    rawText.length < MIN_USABLE_OCR_TEXT_LENGTH ? `OCR Engine ${engine} returned very little text.` : '',
  ]);

  return {
    engineUsed: engine,
    rawText,
    textLength: rawText.length,
    warnings,
  };
};

const runOcrWithFallback = async ({ apiKey, file, imageUrl, preferredEngine }) => {
  const firstEngine = preferredEngine === 3 ? 3 : 2;
  const firstResult = await callOcrSpace({ apiKey, file, imageUrl, engine: firstEngine });

  if (firstResult.textLength >= MIN_USABLE_OCR_TEXT_LENGTH || firstEngine === 3) {
    return firstResult;
  }

  const retryResult = await callOcrSpace({ apiKey, file, imageUrl, engine: 3 });
  return {
    ...retryResult,
    warnings: [
      ...firstResult.warnings,
      `OCR Engine ${firstEngine} was weak, retried with Engine 3.`,
      ...retryResult.warnings,
    ],
  };
};

const callGeminiForStructuredJson = async ({ apiKey, model, documentType, rawText, supplierHint }) => {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const prompt = documentType === 'invoice'
    ? createInvoicePrompt({ rawText, supplierHint })
    : createMenuPrompt({ rawText });
  const geminiResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.05,
        responseMimeType: 'application/json',
      },
    }),
  });
  const bodyText = await geminiResponse.text();
  const payload = bodyText ? JSON.parse(bodyText) : {};

  if (!geminiResponse.ok) {
    throw new Error(payload?.error?.message || `Gemini request failed with status ${geminiResponse.status}.`);
  }

  return parseJsonText(getGeminiText(payload));
};

const normalizeInputFile = (body) => {
  const file = isPlainObject(body?.file) ? body.file : null;
  const base64Image = body?.base64Image || body?.base64;
  const mimeType = String(file?.mimeType || file?.type || body?.mimeType || 'image/jpeg').toLowerCase();
  const data = stripBase64Prefix(file?.data || file?.base64 || base64Image || '');
  const imageUrl = String(body?.imageUrl || '').trim();

  if (imageUrl) {
    return { imageUrl, file: null };
  }

  if (!data || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return { imageUrl: '', file: null };
  }

  if (getApproxBase64Bytes(data) > MAX_SCAN_BYTES) {
    throw new Error('This scan file is too large. Use a clearer cropped photo or a smaller PDF.');
  }

  return {
    imageUrl: '',
    file: {
      name: String(file?.name || body?.fileName || 'scan'),
      mimeType,
      data,
    },
  };
};

const createLegacyInvoiceFallback = (rawText, options) => {
  const parsed = parseInvoiceText(rawText, { vatRate: options?.vatRate || 0.15 });
  return normalizeInvoiceExtraction({
    supplierName: parsed.supplierName || null,
    invoiceDate: parsed.invoiceDate || null,
    currency: 'ZAR',
    subtotal: parsed.totals.totalExVAT || null,
    vatAmount: parsed.totals.totalVAT || null,
    totalAmount: parsed.totals.totalIncVAT || null,
    lineItems: parsed.items.map((item) => ({
      description: item.itemName,
      quantity: item.quantity,
      purchaseUnit: item.unit,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      confidence: Math.min(0.68, Number(item.confidence || 0.55)),
      needsReview: true,
      rawLine: item.rawLine,
    })),
    warnings: ['Gemini cleanup failed. WasteShift used a local OCR text parser; review carefully before saving.'],
  });
};

export const scanDocumentFromBody = async (body) => {
  const documentType = String(body?.documentType || '').trim().toLowerCase();

  if (!ALLOWED_DOCUMENT_TYPES.has(documentType)) {
    return {
      status: 400,
      body: {
        success: false,
        ok: false,
        message: 'documentType must be "invoice" or "menu".',
      },
    };
  }

  const ocrApiKey = String(process.env.OCR_SPACE_API_KEY || process.env.OCR_API_KEY || '').trim();
  const geminiApiKey = String(
    process.env.GEMINI_API_KEY
    || process.env.GOOGLE_API_KEY
    || process.env.GOOGLE_GENERATIVE_AI_API_KEY
    || ''
  ).trim();

  if (!ocrApiKey || !geminiApiKey) {
    return {
      status: 503,
      body: {
        success: false,
        ok: false,
        message: !ocrApiKey
          ? 'OCR.space API key is not configured. Add OCR_SPACE_API_KEY or OCR_API_KEY to Vercel environment variables.'
          : 'Gemini API key is not configured. Add GEMINI_API_KEY to Vercel environment variables.',
      },
    };
  }

  const { file, imageUrl } = normalizeInputFile(body);

  if (!file && !imageUrl) {
    return {
      status: 400,
      body: {
        success: false,
        ok: false,
        message: 'Upload a JPG, PNG, WEBP, or PDF scan file.',
      },
    };
  }

  const errors = [];
  let ocr;

  try {
    ocr = await runOcrWithFallback({
      apiKey: ocrApiKey,
      file,
      imageUrl,
      preferredEngine: Number(body?.preferredEngine) === 3 ? 3 : 2,
    });
  } catch (error) {
    return {
      status: 502,
      body: {
        success: false,
        ok: false,
        documentType,
        ocr: {
          engineUsed: Number(body?.preferredEngine) === 3 ? 3 : 2,
          rawText: '',
          textLength: 0,
          warnings: [],
        },
        extracted: documentType === 'invoice' ? createEmptyInvoiceExtraction() : createEmptyMenuExtraction(),
        confidence: 0,
        lowConfidenceFields: [documentType === 'invoice' ? 'lineItems' : 'menuItems'],
        needsReview: true,
        errors: [error?.message || 'OCR.space could not read this document.'],
        message: error?.message || 'OCR.space could not read this document.',
      },
    };
  }

  if (!ocr.rawText) {
    return {
      status: 422,
      body: {
        success: false,
        ok: false,
        documentType,
        ocr,
        extracted: documentType === 'invoice' ? createEmptyInvoiceExtraction() : createEmptyMenuExtraction(),
        confidence: 0,
        lowConfidenceFields: [documentType === 'invoice' ? 'lineItems' : 'menuItems'],
        needsReview: true,
        errors: ['OCR returned no readable text.'],
        message: 'OCR returned no readable text.',
      },
    };
  }

  let extracted;

  try {
    const model = String(process.env.GEMINI_SCAN_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
    const geminiPayload = await callGeminiForStructuredJson({
      apiKey: geminiApiKey,
      model,
      documentType,
      rawText: ocr.rawText,
      supplierHint: body?.supplierHint,
    });
    extracted = documentType === 'invoice'
      ? normalizeInvoiceExtraction(geminiPayload)
      : normalizeMenuExtraction(geminiPayload);
  } catch (error) {
    errors.push(error?.message || 'Gemini could not structure the OCR text.');
    extracted = documentType === 'invoice'
      ? createLegacyInvoiceFallback(ocr.rawText, body)
      : {
          ...createEmptyMenuExtraction(),
          warnings: ['Gemini cleanup failed. Use the OCR text for manual review.'],
        };
  }

  const invalidExtraction = documentType === 'invoice'
    ? !extracted.supplierName && extracted.lineItems.length === 0
    : extracted.menuItems.length === 0;
  const confidence = calculateExtractionConfidence(documentType, extracted);
  const lowConfidenceFields = getLowConfidenceFields(documentType, extracted);
  const needsReview = true;
  const status = invalidExtraction ? 422 : 200;

  return {
    status,
    body: {
      success: !invalidExtraction,
      ok: !invalidExtraction,
      documentType,
      ocr,
      extracted,
      confidence,
      lowConfidenceFields,
      needsReview,
      errors,
      scannerMetadata: {
        ocrEngineUsed: ocr.engineUsed,
        scanDateTime: new Date().toISOString(),
        documentType,
        confidence,
        reviewStatus: invalidExtraction ? 'failed' : 'needs_review',
        restaurantId: String(body?.restaurantId || '').trim(),
      },
      ...(invalidExtraction ? { message: documentType === 'invoice' ? 'Invoice scan needs manual review because no supplier or line items were found.' : 'Menu scan needs manual review because no menu items were found.' } : {}),
    },
  };
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { success: false, ok: false, message: 'Use POST for document scanning.' });
    return;
  }

  const authorization = await authorizeManagerSessionRequest(request);

  if (!authorization.ok) {
    sendJson(response, authorization.status, authorization.body);
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = await scanDocumentFromBody(body);
    sendJson(response, result.status, result.body);
  } catch (error) {
    sendJson(response, 500, {
      success: false,
      ok: false,
      message: error?.message || 'Could not scan this document.',
    });
  }
}
