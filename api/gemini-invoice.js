const DEFAULT_VAT_RATE = 0.15;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_SCAN_BYTES = 9 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const UNIT_ALIASES = {
  kgs: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  grams: 'g',
  gram: 'g',
  l: 'L',
  lt: 'L',
  ltr: 'L',
  litre: 'L',
  liter: 'L',
  litres: 'L',
  liters: 'L',
  ea: 'each',
  unit: 'each',
  units: 'each',
  cases: 'case',
  dozen: 'doz',
  packet: 'pkt',
  packets: 'pkt',
  pack: 'pkt',
  packs: 'pkt',
  bags: 'bag',
  boxes: 'box',
  bottles: 'bottle',
  btl: 'bottle',
  trays: 'tray',
  tins: 'tin',
  punnets: 'punnet',
  pp: 'punnet',
  bunches: 'bunch',
  heads: 'head',
  pillows: 'pillow',
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    supplierName: { type: 'STRING' },
    invoiceNumber: { type: 'STRING' },
    invoiceDate: { type: 'STRING' },
    vatMode: { type: 'STRING', enum: ['inclusive', 'exclusive'] },
    vatRate: { type: 'NUMBER' },
    notes: { type: 'STRING' },
    totals: {
      type: 'OBJECT',
      properties: {
        totalExVAT: { type: 'NUMBER' },
        totalVAT: { type: 'NUMBER' },
        totalIncVAT: { type: 'NUMBER' },
      },
    },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          itemName: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unit: { type: 'STRING' },
          unitPrice: { type: 'NUMBER' },
          lineTotal: { type: 'NUMBER' },
          exclusiveTotal: { type: 'NUMBER' },
          inclusiveTotal: { type: 'NUMBER' },
          vatAmount: { type: 'NUMBER' },
          confidence: { type: 'NUMBER' },
          rawLine: { type: 'STRING' },
        },
        required: ['itemName', 'quantity', 'unit', 'unitPrice', 'lineTotal'],
      },
    },
  },
  required: ['vatMode', 'vatRate', 'items'],
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
    return null;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }

  return 0;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return 0;
};

const roundMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
};

const normalizeTotals = ({ totals, vatRate }) => {
  const totalExVAT = roundMoney(firstFiniteNumber(
    totals?.totalExVAT,
    totals?.subtotal,
    totals?.subTotal,
    totals?.exclusiveTotal,
    totals?.totalExclusive
  ));
  const totalVAT = roundMoney(firstFiniteNumber(
    totals?.totalVAT,
    totals?.vat,
    totals?.vatAmount,
    totals?.tax,
    totals?.taxAmount
  ));
  const totalIncVAT = roundMoney(firstFiniteNumber(
    totals?.totalIncVAT,
    totals?.grandTotal,
    totals?.total,
    totals?.invoiceTotal,
    totals?.inclusiveTotal,
    totals?.totalInclusive
  ));
  const safeVatRate = normalizeVatRate(vatRate);

  if (totalExVAT > 0 && totalVAT > 0 && totalIncVAT <= 0) {
    return {
      totalExVAT,
      totalVAT,
      totalIncVAT: roundMoney(totalExVAT + totalVAT),
    };
  }

  if (totalIncVAT > 0 && totalVAT > 0 && totalExVAT <= 0) {
    return {
      totalExVAT: roundMoney(totalIncVAT - totalVAT),
      totalVAT,
      totalIncVAT,
    };
  }

  if (totalIncVAT > 0 && totalVAT <= 0 && totalExVAT <= 0 && safeVatRate > 0) {
    const calculatedExVAT = roundMoney(totalIncVAT / (1 + safeVatRate));

    return {
      totalExVAT: calculatedExVAT,
      totalVAT: roundMoney(totalIncVAT - calculatedExVAT),
      totalIncVAT,
    };
  }

  if (totalExVAT > 0 && totalVAT <= 0 && totalIncVAT <= 0 && safeVatRate > 0) {
    const calculatedVAT = roundMoney(totalExVAT * safeVatRate);

    return {
      totalExVAT,
      totalVAT: calculatedVAT,
      totalIncVAT: roundMoney(totalExVAT + calculatedVAT),
    };
  }

  return {
    totalExVAT,
    totalVAT,
    totalIncVAT,
  };
};

const normalizeVatMode = (value, fallback = 'inclusive') => (
  value === 'exclusive' || value === 'inclusive' ? value : fallback
);

const normalizeVatRate = (value, fallback = DEFAULT_VAT_RATE) => {
  const number = toNumber(value, fallback);

  if (number > 1) {
    return Math.max(0, number / 100);
  }

  return Math.max(0, number);
};

const normalizeUnit = (unit) => {
  const value = String(unit || '').trim().toLowerCase();

  if (!value) return 'each';
  return UNIT_ALIASES[value] || value;
};

const stripBase64Prefix = (value) => String(value || '')
  .replace(/^data:[^;]+;base64,/i, '')
  .replace(/\s+/g, '');

const getApproxBase64Bytes = (data) => Math.ceil(stripBase64Prefix(data).length * 0.75);

const getTextFromGeminiResponse = (payload) => (
  (payload?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => part?.text || '')
    .join('')
    .trim()
);

export const parseGeminiJsonText = (text) => {
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

  throw new Error('Gemini returned a response that was not valid invoice JSON.');
};

const normalizeLineItem = (lineItem, index) => {
  const itemName = String(lineItem?.itemName || '').trim();
  const quantity = Math.max(0, toNumber(lineItem?.quantity, 1)) || 1;
  const lineTotal = roundMoney(firstPositiveNumber(
    lineItem?.lineTotal,
    lineItem?.inclusiveTotal,
    lineItem?.exclusiveTotal
  ));
  const unitPrice = roundMoney(firstPositiveNumber(
    lineItem?.unitPrice,
    quantity > 0 ? lineTotal / quantity : lineTotal
  ));

  if (!itemName || lineTotal <= 0 || unitPrice <= 0) {
    return null;
  }

  return {
    id: `gemini-${index}`,
    itemName,
    quantity,
    unit: normalizeUnit(lineItem?.unit),
    unitPrice,
    lineTotal,
    exclusiveTotal: roundMoney(lineItem?.exclusiveTotal),
    inclusiveTotal: roundMoney(lineItem?.inclusiveTotal),
    vatAmount: roundMoney(lineItem?.vatAmount),
    confidence: Math.max(0, Math.min(1, toNumber(lineItem?.confidence, 0.82))),
    rawLine: String(lineItem?.rawLine || itemName).trim(),
  };
};

export const normalizeGeminiInvoicePayload = (payload, options = {}) => {
  const fallbackVatMode = normalizeVatMode(options.fallbackVatMode);
  const fallbackVatRate = normalizeVatRate(options.fallbackVatRate);
  const vatMode = normalizeVatMode(payload?.vatMode, fallbackVatMode);
  const vatRate = normalizeVatRate(payload?.vatRate, fallbackVatRate);
  const items = (Array.isArray(payload?.items) ? payload.items : [])
    .map((item, index) => normalizeLineItem(item, index))
    .filter(Boolean);
  const normalizedTotals = normalizeTotals({ totals: payload?.totals || payload, vatRate });

  return {
    supplierName: String(payload?.supplierName || '').trim(),
    invoiceNumber: String(payload?.invoiceNumber || '').trim(),
    invoiceDate: String(payload?.invoiceDate || '').trim(),
    vatMode,
    vatRate,
    notes: String(payload?.notes || '').trim(),
    totals: normalizedTotals,
    items,
  };
};

const createPrompt = ({ fileName, fallbackVatMode, fallbackVatRate }) => `
You are reading a supplier tax invoice for a restaurant inventory system.
Extract only real product line items from the invoice table.
Ignore bank details, payment references, account numbers, balances due, customer details, totals rows, signatures, headers, footers, and page numbers.

Important for South African invoices:
- Prices may be marked R or ZAR.
- Columns may include Description, Quantity, Excl Price, Disc %, VAT %, Exclusive Total, Inclusive Total.
- If a VAT % column is 0.00% for the product rows, return vatRate as 0.
- If VAT is not clear, use vatRate ${fallbackVatRate} and vatMode ${fallbackVatMode}.
- Extract invoiceNumber exactly as printed when visible.
- Return invoiceDate as YYYY-MM-DD when possible.
- In totals, return totalExVAT as subtotal before VAT, totalVAT as VAT/tax, and totalIncVAT as grand total.
- If VAT is not itemized but the grand total is visible, calculate VAT from the grand total using South African VAT at ${fallbackVatRate}.
- itemName should be the readable food/product name without supplier item codes.
- quantity must be the invoice quantity.
- unit should be one short unit such as kg, g, L, ml, each, case, doz, pkt, bag, box, bottle, tray, tin, punnet, bunch, head, or pillow.
- lineTotal and unitPrice must use the same VAT basis as vatMode.
- Use exclusiveTotal and inclusiveTotal when those exact columns are visible.
- Do not invent missing line items.

File name: ${fileName || 'invoice'}
`;

const callGemini = async ({ apiKey, model, file, fallbackVatMode, fallbackVatRate }) => {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: createPrompt({ fileName: file.name, fallbackVatMode, fallbackVatRate }) },
            {
              inlineData: {
                mimeType: file.mimeType,
                data: file.data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : {};

  if (!response.ok) {
    throw new Error(body?.error?.message || `Gemini request failed with status ${response.status}.`);
  }

  return body;
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
    return;
  }

  const apiKey = String(
    process.env.GEMINI_API_KEY
    || process.env.GOOGLE_API_KEY
    || process.env.GOOGLE_GENERATIVE_AI_API_KEY
    || ''
  ).trim();

  if (!apiKey) {
    sendJson(response, 503, {
      ok: false,
      message: 'Gemini API key is not configured. Add GEMINI_API_KEY to Vercel environment variables.',
    });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const file = body?.file;
    const fallbackVatMode = normalizeVatMode(body?.vatMode);
    const fallbackVatRate = normalizeVatRate(body?.vatRate);
    const mimeType = String(file?.mimeType || '').toLowerCase();
    const data = stripBase64Prefix(file?.data);

    if (!file?.name || !ALLOWED_MIME_TYPES.has(mimeType) || !data) {
      sendJson(response, 400, { ok: false, message: 'Upload a JPG, PNG, WEBP, or PDF invoice file.' });
      return;
    }

    if (getApproxBase64Bytes(data) > MAX_SCAN_BYTES) {
      sendJson(response, 413, { ok: false, message: 'Invoice file is too large. Use a clearer cropped photo or a smaller PDF.' });
      return;
    }

    const model = String(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
    const geminiResponse = await callGemini({
      apiKey,
      model,
      file: {
        name: String(file.name || 'invoice'),
        mimeType,
        data,
      },
      fallbackVatMode,
      fallbackVatRate,
    });
    const invoice = normalizeGeminiInvoicePayload(
      parseGeminiJsonText(getTextFromGeminiResponse(geminiResponse)),
      { fallbackVatMode, fallbackVatRate }
    );

    sendJson(response, 200, {
      ok: true,
      model,
      invoice,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error?.message || 'Could not scan this invoice with Gemini.',
    });
  }
}
