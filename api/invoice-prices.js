const MAX_TEXT_LENGTH = 20000;
const MAX_FILE_DATA_LENGTH = 6 * 1024 * 1024;
const OPENAI_MODEL = process.env.OPENAI_INVOICE_MODEL || 'gpt-4.1-mini';

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

const parsePriceValue = (value) => {
  const cleanedValue = String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');
  const normalizedValue = cleanedValue.includes(',') && !cleanedValue.includes('.')
    ? cleanedValue.replace(',', '.')
    : cleanedValue.replace(/,/g, '');
  const parsedValue = Number.parseFloat(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const isSummaryLine = (line) => (
  /\b(subtotal|sub total|total|balance|amount due|vat|tax|change|cash|card|eft|payment)\b/i.test(line)
);

const cleanDescription = (value) => String(value || '')
  .replace(/\b(inv|invoice|tax|vat|qty|quantity|price|amount|total|unit)\b/gi, ' ')
  .replace(/\b\d+(?:[.,]\d+)?\s*(kg|g|ml|l|lt|ea|each|x|pcs|units?)\b/gi, ' ')
  .replace(/^[\s#:\-.,/\\\dA-Z]{1,12}(?=\s+[A-Za-z])/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

const inferInvoiceItemsFromText = (invoiceText) => {
  const lines = String(invoiceText || '')
    .slice(0, MAX_TEXT_LENGTH)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 4 && !isSummaryLine(line));

  return lines
    .map((line) => {
      const amountMatches = [...line.matchAll(/(?:R\s*)?-?\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})|-?\d+(?:[.,]\d{2})/gi)];

      if (amountMatches.length === 0) {
        return null;
      }

      const amounts = amountMatches
        .map((match) => ({
          raw: match[0],
          index: match.index || 0,
          value: parsePriceValue(match[0]),
        }))
        .filter((amount) => amount.value !== null && amount.value > 0);

      if (amounts.length === 0) {
        return null;
      }

      const lineTotal = amounts[amounts.length - 1].value;
      const unitPrice = amounts.length > 1 ? amounts[amounts.length - 2].value : lineTotal;
      const firstAmountIndex = amounts[0].index;
      const rawDescription = line.slice(0, firstAmountIndex);
      const description = cleanDescription(rawDescription || line.replace(amountMatches.map((match) => match[0]).join(' '), ''));

      if (!description || description.length < 2) {
        return null;
      }

      const possibleQuantity = amounts.length > 2 ? amounts[amounts.length - 3].value : null;
      const inferredQuantity = possibleQuantity && unitPrice > 0 && Math.abs((possibleQuantity * unitPrice) - lineTotal) < 0.05
        ? possibleQuantity
        : null;

      return {
        description,
        quantity: inferredQuantity,
        unit: '',
        unitPrice,
        lineTotal,
        confidence: amounts.length > 1 ? 0.68 : 0.48,
        rawLine: line,
      };
    })
    .filter(Boolean)
    .slice(0, 60);
};

const extractOutputText = (payload) => {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text;
  }

  if (!Array.isArray(payload?.output)) {
    return '';
  }

  return payload.output
    .flatMap((outputItem) => Array.isArray(outputItem?.content) ? outputItem.content : [])
    .map((contentItem) => contentItem?.text || '')
    .filter(Boolean)
    .join('\n');
};

const parseJsonFromText = (text) => {
  const trimmedText = String(text || '').trim();

  try {
    return JSON.parse(trimmedText);
  } catch {
    const jsonMatch = trimmedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
};

const sanitizeExtractedItems = (items) => (
  (Array.isArray(items) ? items : [])
    .map((item) => {
      const description = cleanDescription(item?.description || item?.name || item?.item);
      const unitPrice = parsePriceValue(item?.unitPrice ?? item?.unit_price ?? item?.price);
      const lineTotal = parsePriceValue(item?.lineTotal ?? item?.line_total ?? item?.total);
      const quantity = parsePriceValue(item?.quantity ?? item?.qty);
      const confidence = Number(item?.confidence);

      if (!description || (unitPrice === null && lineTotal === null)) {
        return null;
      }

      return {
        description,
        quantity,
        unit: String(item?.unit || '').trim(),
        unitPrice: unitPrice ?? lineTotal,
        lineTotal: lineTotal ?? unitPrice,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.72,
        rawLine: String(item?.rawLine || item?.raw_line || '').trim(),
      };
    })
    .filter(Boolean)
    .slice(0, 80)
);

const extractWithOpenAi = async ({ invoiceText, fileDataUrl, fileType }) => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured. Paste invoice text or add the key on Vercel to scan photos.');
  }

  const content = [
    {
      type: 'input_text',
      text: [
        'Extract purchasable line items and prices from this restaurant supplier invoice.',
        'Return only JSON with this shape:',
        '{"items":[{"description":"string","quantity":number|null,"unit":"string","unitPrice":number|null,"lineTotal":number|null,"confidence":number,"rawLine":"string"}]}',
        'Exclude subtotal, VAT, tax, payment, delivery fee, balance, and grand total lines.',
        'Use South African rand numeric values with no currency symbols.',
        invoiceText ? `Invoice text:\n${invoiceText.slice(0, MAX_TEXT_LENGTH)}` : '',
      ].filter(Boolean).join('\n\n'),
    },
  ];

  if (fileDataUrl && /^data:image\//i.test(fileDataUrl)) {
    content.push({
      type: 'input_image',
      image_url: fileDataUrl,
    });
  } else if (fileDataUrl && fileType === 'application/pdf') {
    throw new Error('PDF image scanning is not enabled yet. Export the invoice text or upload a photo/image of the invoice.');
  }

  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [{
        role: 'user',
        content,
      }],
      max_output_tokens: 2200,
    }),
  });

  const payload = await openAiResponse.json().catch(() => ({}));

  if (!openAiResponse.ok) {
    throw new Error(payload?.error?.message || 'Invoice scan failed.');
  }

  const parsedPayload = parseJsonFromText(extractOutputText(payload));
  const items = sanitizeExtractedItems(parsedPayload?.items);

  if (items.length === 0) {
    throw new Error('No invoice price lines were found.');
  }

  return items;
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
    return;
  }

  const body = readJsonBody(request);
  const invoiceText = String(body?.invoiceText || '').slice(0, MAX_TEXT_LENGTH);
  const fileDataUrl = String(body?.fileDataUrl || '');
  const fileType = String(body?.fileType || '');

  if (!invoiceText && !fileDataUrl) {
    sendJson(response, 400, { ok: false, message: 'Upload an invoice image or paste invoice text.' });
    return;
  }

  if (fileDataUrl && fileDataUrl.length > MAX_FILE_DATA_LENGTH) {
    sendJson(response, 413, { ok: false, message: 'That invoice file is too large. Use a smaller photo or paste invoice text.' });
    return;
  }

  if (fileDataUrl || process.env.OPENAI_API_KEY) {
    try {
      const items = await extractWithOpenAi({ invoiceText, fileDataUrl, fileType });
      sendJson(response, 200, { ok: true, source: 'ai', model: OPENAI_MODEL, items });
      return;
    } catch (error) {
      if (fileDataUrl && !invoiceText) {
        sendJson(response, 422, { ok: false, message: error?.message || 'Could not scan that invoice.' });
        return;
      }
    }
  }

  const items = inferInvoiceItemsFromText(invoiceText);
  sendJson(response, 200, {
    ok: true,
    source: 'text',
    message: items.length > 0 ? '' : 'No invoice price lines were found in the pasted text.',
    items,
  });
}
