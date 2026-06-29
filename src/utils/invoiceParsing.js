const DEFAULT_VAT_RATE = 0.15;
const UNIT_PATTERN = '(kg|kgs|kilogram|kilograms|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|each|ea|unit|units|case|cases|doz|dozen|pkt|packet|pack|box|boxes|bag|bags|btl|bottle|bottles|tray|trays|tin|tins|punnet|punnets|bunch|bunches|head|heads|pillow|pillows|pp)';
const UNIT_REGEX = new RegExp(`\\b${UNIT_PATTERN}\\b`, 'i');
const QUANTITY_UNIT_REGEX = new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*${UNIT_PATTERN}\\b`, 'i');
const UNIT_QUANTITY_REGEX = new RegExp(`\\b${UNIT_PATTERN}\\s*(\\d+(?:[.,]\\d+)?)\\b`, 'i');
const PACK_QUANTITY_REGEX = new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*[xX]\\s*(\\d+(?:[.,]\\d+)?)\\s*${UNIT_PATTERN}\\b`, 'i');
const NUMBER_TOKEN_REGEX = /(?:\b(?:ZAR|R)\s*)?-?\d+(?:[ ,]\d{3})*(?:[.,]\d{1,2})?/gi;
const MAX_REASONABLE_LINE_TOTAL = 250000;
const MAX_REASONABLE_UNIT_PRICE = 100000;
const MAX_REASONABLE_QUANTITY = 100000;
const CATEGORIES = ['Produce', 'Dairy', 'Meat', 'Dry Goods', 'Beverages', 'Other'];

export const INVOICE_CATEGORIES = CATEGORIES;

export const normalizeInvoiceName = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(fresh|frozen|chilled|whole|sliced|diced|case|pack|pkt|packet|bag|box|the|and|with)\b/g, ' ')
  .split(' ')
  .map((token) => {
    if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
    if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
    if (token.endsWith('s') && token.length > 3) return token.slice(0, -1);
    return token;
  })
  .filter(Boolean)
  .join(' ');

export const createInvoiceKey = (value) => normalizeInvoiceName(value)
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const normalizeNumericText = (value) => {
  const withoutCurrency = String(value ?? '')
    .replace(/\bzar\b/gi, '')
    .replace(/\br\s*/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^\d.,-]/g, '');

  if (!withoutCurrency || withoutCurrency === '-') return '';

  const lastComma = withoutCurrency.lastIndexOf(',');
  const lastDot = withoutCurrency.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    return decimalSeparator === ','
      ? withoutCurrency.replace(/\./g, '').replace(',', '.')
      : withoutCurrency.replace(/,/g, '');
  }

  if (lastComma >= 0) {
    const trailingDigits = withoutCurrency.length - lastComma - 1;
    return trailingDigits > 0 && trailingDigits <= 2
      ? withoutCurrency.replace(',', '.')
      : withoutCurrency.replace(/,/g, '');
  }

  const dotCount = (withoutCurrency.match(/\./g) || []).length;
  if (dotCount > 1) {
    const lastSeparator = withoutCurrency.lastIndexOf('.');
    return `${withoutCurrency.slice(0, lastSeparator).replace(/\./g, '')}.${withoutCurrency.slice(lastSeparator + 1)}`;
  }

  return withoutCurrency;
};

const parseNumericValue = (value) => {
  const parsed = Number.parseFloat(normalizeNumericText(value));
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseMoney = (value) => parseNumericValue(value);

export const roundMoney = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue * 100) / 100 : 0;
};

export const normalizeInvoiceUnit = (unit) => {
  const value = String(unit || '').trim().toLowerCase();

  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(value)) return 'kg';
  if (['g', 'gram', 'grams'].includes(value)) return 'g';
  if (['l', 'lt', 'ltr', 'liter', 'litre', 'liters', 'litres'].includes(value)) return 'L';
  if (value === 'ml') return 'ml';
  if (['ea', 'each', 'unit', 'units'].includes(value)) return 'each';
  if (['case', 'cases'].includes(value)) return 'case';
  if (['doz', 'dozen'].includes(value)) return 'doz';
  if (['pkt', 'packet', 'pack'].includes(value)) return 'pkt';
  if (['box', 'boxes'].includes(value)) return 'box';
  if (['bag', 'bags'].includes(value)) return 'bag';
  if (['btl', 'bottle', 'bottles'].includes(value)) return 'bottle';
  if (['tray', 'trays'].includes(value)) return 'tray';
  if (['tin', 'tins'].includes(value)) return 'tin';
  if (['punnet', 'punnets'].includes(value)) return 'punnet';
  if (['bunch', 'bunches'].includes(value)) return 'bunch';
  if (['head', 'heads'].includes(value)) return 'head';
  if (['pillow', 'pillows'].includes(value)) return 'pillow';
  if (value === 'pp') return 'punnet';
  return value || 'each';
};

export const getBaseUnitInfo = (quantity, unit) => {
  const numericQuantity = Number(quantity);
  const safeQuantity = Number.isFinite(numericQuantity) && numericQuantity > 0 ? numericQuantity : 1;
  const normalizedUnit = normalizeInvoiceUnit(unit);

  if (normalizedUnit === 'kg') return { quantity: safeQuantity * 1000, unit: 'g' };
  if (normalizedUnit === 'g') return { quantity: safeQuantity, unit: 'g' };
  if (normalizedUnit === 'L') return { quantity: safeQuantity * 1000, unit: 'ml' };
  if (normalizedUnit === 'ml') return { quantity: safeQuantity, unit: 'ml' };
  if (normalizedUnit === 'doz') return { quantity: safeQuantity * 12, unit: 'each' };
  if (['case', 'pkt', 'box', 'bag', 'bottle', 'tray', 'tin', 'punnet', 'bunch', 'head', 'pillow'].includes(normalizedUnit)) {
    return { quantity: safeQuantity, unit: normalizedUnit };
  }
  return { quantity: safeQuantity, unit: 'each' };
};

export const calculateVatValues = ({ lineTotal, unitPrice, vatMode = 'inclusive', vatRate = DEFAULT_VAT_RATE }) => {
  const safeRate = Number.isFinite(Number(vatRate)) && Number(vatRate) >= 0 ? Number(vatRate) : DEFAULT_VAT_RATE;
  const total = roundMoney(lineTotal);
  const unit = Number.isFinite(Number(unitPrice)) ? Number(unitPrice) : total;
  const divisor = 1 + safeRate;

  if (vatMode === 'exclusive') {
    return {
      priceExVAT: roundMoney(total),
      vatAmount: roundMoney(total * safeRate),
      priceIncVAT: roundMoney(total * divisor),
      unitPriceExVAT: roundMoney(unit),
      unitPriceIncVAT: roundMoney(unit * divisor),
    };
  }

  return {
    priceExVAT: roundMoney(total / divisor),
    vatAmount: roundMoney(total - (total / divisor)),
    priceIncVAT: roundMoney(total),
    unitPriceExVAT: roundMoney(unit / divisor),
    unitPriceIncVAT: roundMoney(unit),
  };
};

export const detectVatMode = (text) => {
  const value = String(text || '').toLowerCase();

  if (/\b(excl|exclusive|excluding)\s*(vat|tax)\b/.test(value) || /\bvat\s*excl/.test(value)) {
    return 'exclusive';
  }

  if (/\b(incl|inclusive|including)\s*(vat|tax)\b/.test(value) || /\bvat\s*incl/.test(value)) {
    return 'inclusive';
  }

  return 'inclusive';
};

export const detectSupplierName = (text) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
  const explicitSupplier = lines
    .map((line) => line.match(/\b(?:supplier|from|vendor)\s*:?\s*(.+)$/i)?.[1])
    .find(Boolean);

  if (explicitSupplier) {
    return explicitSupplier.trim();
  }

  return lines.find((line) => (
    line.length >= 3
    && !/\b(invoice|tax|vat|date|statement|total|account|tel|phone|email|reg)\b/i.test(line)
    && !/\d{3,}/.test(line)
  )) || '';
};

export const detectInvoiceDate = (text) => {
  const value = String(text || '');
  const explicitDate = value.match(/\b(?:invoice\s*)?date\s*:?\s*([0-3]?\d[/-][01]?\d[/-](?:20)?\d{2})/i)?.[1]
    || value.match(/\b((?:20)?\d{2}[/-][01]?\d[/-][0-3]?\d)\b/)?.[1]
    || value.match(/\b([0-3]?\d\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:20)?\d{2})\b/i)?.[1]
    || '';

  if (!explicitDate) return new Date().toISOString().slice(0, 10);

  const parsedDate = new Date(explicitDate);

  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString().slice(0, 10);
  }

  const slashMatch = explicitDate.match(/^([0-3]?\d)[/-]([01]?\d)[/-]((?:20)?\d{2})$/);

  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return new Date().toISOString().slice(0, 10);
};

const getDecimalPlaces = (value) => {
  const compact = String(value || '').replace(/\s+/g, '');
  const separatorIndex = Math.max(compact.lastIndexOf('.'), compact.lastIndexOf(','));

  if (separatorIndex < 0) return 0;

  const tail = compact.slice(separatorIndex + 1).replace(/\D/g, '');
  return tail.length > 0 && tail.length <= 2 ? tail.length : 0;
};

const cleanInvoiceLine = (line) => String(line || '')
  .replace(/[|;]/g, ' ')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\t/g, ' ')
  .replace(/(\d)[Oo](?=\d)/g, (_, digit) => `${digit}0`)
  .replace(/(\d)[Il](?=\d)/g, (_, digit) => `${digit}1`)
  .replace(/\s+/g, ' ')
  .trim();

const isNonLineItemLine = (line) => {
  const value = String(line || '').toLowerCase();
  const hasTableHeader = /\b(description|product|item)\b/.test(value)
    && /\b(qty|quantity|unit|price|amount|total)\b/.test(value);
  const hasDatePattern = /\b(?:[0-3]?\d[/-][01]?\d[/-](?:20)?\d{2}|(?:20)?\d{2}[/-][01]?\d[/-][0-3]?\d)\b/.test(value);
  const dateOnlyMetadata = hasDatePattern && !UNIT_REGEX.test(value) && !/\b(?:zar|r)\s*-?\d/i.test(value);

  return hasTableHeader
    || dateOnlyMetadata
    || /\b(subtotal|sub total|balance|amount due|grand total|total due|total exclusive|total inclusive|total vat|total discount|vat total|vat amount|tax total|invoice no|invoice number|invoice date|date issued|due date|customer|account|bank|branch|swift|iban|routing|sort code|tel|telephone|phone|cell|mobile|fax|email|website|address|street|road|po box|registration|reg no|vat no|vat number|tax no|tax number|company reg|page \d|statement|order no|delivery note|payment|reference|ref no)\b/i.test(value)
    || /^total\s*:/.test(value);
};

const extractNumberTokens = (line) => [...String(line || '').matchAll(NUMBER_TOKEN_REGEX)]
  .map((match) => ({
    raw: match[0],
    value: parseNumericValue(match[0]),
    index: match.index || 0,
    end: (match.index || 0) + match[0].length,
    hasCurrency: /\b(?:zar|r)\s*-?\d/i.test(match[0]),
    decimalPlaces: getDecimalPlaces(match[0]),
    hasPercent: String(line || '').slice((match.index || 0) + match[0].length).trimStart().startsWith('%'),
  }))
  .filter((token) => token.value !== null);

const tokenHasPriceShape = (token) => (
  token.hasCurrency
  || token.decimalPlaces > 0
  || Math.abs(token.value) >= 8
);

const lineHasPriceCandidate = (line) => (
  extractNumberTokens(line).some((token) => tokenHasPriceShape(token))
);

const getExplicitQuantity = (line) => {
  const packMatch = line.match(PACK_QUANTITY_REGEX);

  if (packMatch) {
    const packQuantity = parseNumericValue(packMatch[1]) || 1;
    const packSize = parseNumericValue(packMatch[2]) || 1;
    const unit = normalizeInvoiceUnit(packMatch[3]);

    return {
      quantity: packQuantity * packSize,
      displayQuantity: packQuantity,
      unit,
      span: {
        index: packMatch.index || 0,
        end: (packMatch.index || 0) + packMatch[0].length,
      },
    };
  }

  const quantityMatch = line.match(QUANTITY_UNIT_REGEX);

  if (quantityMatch) {
    return {
      quantity: parseNumericValue(quantityMatch[1]) || 1,
      unit: normalizeInvoiceUnit(quantityMatch[2]),
      span: {
        index: quantityMatch.index || 0,
        end: (quantityMatch.index || 0) + quantityMatch[0].length,
      },
    };
  }

  const unitQuantityMatch = line.match(UNIT_QUANTITY_REGEX);

  if (unitQuantityMatch) {
    return {
      quantity: parseNumericValue(unitQuantityMatch[2]) || 1,
      unit: normalizeInvoiceUnit(unitQuantityMatch[1]),
      span: {
        index: unitQuantityMatch.index || 0,
        end: (unitQuantityMatch.index || 0) + unitQuantityMatch[0].length,
      },
    };
  }

  const looseUnitMatch = line.match(UNIT_REGEX);

  return looseUnitMatch
    ? {
      quantity: 1,
      unit: normalizeInvoiceUnit(looseUnitMatch[1]),
      span: {
        index: looseUnitMatch.index || 0,
        end: (looseUnitMatch.index || 0) + looseUnitMatch[0].length,
      },
      unitOnly: true,
    }
    : null;
};

const isTokenInsideSpan = (token, span) => (
  span
  && token.index >= span.index
  && token.end <= span.end
);

const isLeadingCodeToken = (token, line) => {
  if (token.hasCurrency || token.decimalPlaces > 0) return false;

  const rawDigits = String(token.raw || '').replace(/\D/g, '');
  const before = line.slice(0, token.index).trim();
  const after = line.slice(token.end).trim();

  const leadingNumericCode = before === ''
    && rawDigits.length >= 3
    && /[a-z]/i.test(after);
  const prefixedSupplierCode = token.index < 28
    && rawDigits.length >= 1
    && rawDigits.length <= 5
    && /^[a-z\s.-]+$/i.test(before)
    && /-\s*[a-z]/i.test(after);

  return leadingNumericCode || prefixedSupplierCode;
};

const getLooseQuantityToken = (candidates) => {
  if (candidates.length >= 3) {
    const beforePrices = candidates[candidates.length - 3];
    if (!beforePrices.hasCurrency && beforePrices.decimalPlaces <= 2 && beforePrices.value > 0 && beforePrices.value <= 100) {
      return beforePrices;
    }
  }

  if (candidates.length === 2) {
    const [maybeQuantity, maybeTotal] = candidates;
    const wholeOrSimpleDecimal = maybeQuantity.decimalPlaces === 0 || maybeQuantity.value < 10;
    const dividesTotal = maybeTotal.value >= maybeQuantity.value && maybeTotal.value / maybeQuantity.value <= 250;

    if (!maybeQuantity.hasCurrency && wholeOrSimpleDecimal && maybeQuantity.value > 0 && maybeQuantity.value <= 100 && dividesTotal) {
      return maybeQuantity;
    }
  }

  return null;
};

const removeSpans = (line, spans) => (
  spans
    .filter((span) => span && Number.isFinite(span.index) && Number.isFinite(span.end) && span.end > span.index)
    .sort((a, b) => b.index - a.index)
    .reduce((nextLine, span) => `${nextLine.slice(0, span.index)} ${nextLine.slice(span.end)}`, line)
);

const cleanItemName = (line) => cleanInvoiceLine(line)
  .replace(/^\s*[A-Z]{2,}(?:\s+[A-Z]{2,}){0,3}\s*-\s*\d{1,5}\s*-\s*/, '')
  .replace(/^\s*[A-Z]{2,}(?:\s+[A-Z]{2,}){0,3}\s*-\s*/, '')
  .replace(/^\s*(?:\d{3,}|[a-z]{1,4}\d{2,}|sku\s*\d+|code\s*\d+)[\s:.-]+/i, '')
  .replace(/\b(description|qty|quantity|unit price|amount|line total|total|price|item|code|sku|excl|incl|vat)\b/gi, ' ')
  .replace(/%/g, ' ')
  .replace(/[\u00ae\u00a9\u2122]/g, ' ')
  .replace(/\s+-\s+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isValidItemName = (name) => {
  const value = String(name || '').trim();
  const letters = value.match(/[a-z]/gi) || [];
  const alphanumeric = value.match(/[a-z0-9]/gi) || [];
  const symbolCount = value.replace(/[a-z0-9\s]/gi, '').length;

  return letters.length >= 2
    && alphanumeric.length >= 3
    && symbolCount <= Math.max(2, alphanumeric.length);
};

const hasReasonableLineValues = ({ lineTotal, unitPrice, quantity }) => (
  Number.isFinite(lineTotal)
  && Number.isFinite(unitPrice)
  && Number.isFinite(quantity)
  && lineTotal >= 0.01
  && lineTotal <= MAX_REASONABLE_LINE_TOTAL
  && unitPrice >= 0.01
  && unitPrice <= MAX_REASONABLE_UNIT_PRICE
  && quantity > 0
  && quantity <= MAX_REASONABLE_QUANTITY
);

const getSupplierTableColumns = (tokens, line) => {
  if (!Array.isArray(tokens) || tokens.length < 4) return null;

  const percentCount = tokens.filter((token) => token.hasPercent).length;
  const currencyTokens = tokens.filter((token) => token.hasCurrency);
  const hasTableEvidence = percentCount >= 1
    || currencyTokens.length >= 3
    || /\b(excl\.?\s*price|disc\s*%|vat\s*%|exclusive\s+total|inclusive\s+total)\b/i.test(line);

  if (!hasTableEvidence) return null;

  const usableTokens = tokens.filter((token) => !token.hasPercent);
  const unitPriceToken = usableTokens.find((token) => (
    token.hasCurrency
    && token.value > 0
    && token.value <= MAX_REASONABLE_UNIT_PRICE
  ));

  if (!unitPriceToken) return null;

  const quantityToken = usableTokens
    .filter((token) => (
      token.index < unitPriceToken.index
      && !token.hasCurrency
      && token.value > 0
      && token.value <= MAX_REASONABLE_QUANTITY
    ))
    .at(-1);
  const lineTotalToken = [...usableTokens]
    .reverse()
    .find((token) => (
      token.hasCurrency
      && token.index > unitPriceToken.index
      && token.value > 0
      && token.value <= MAX_REASONABLE_LINE_TOTAL
    ));

  if (!quantityToken || !lineTotalToken) return null;

  return {
    quantityToken,
    unitPriceToken,
    lineTotalToken,
    removeTokens: tokens.filter((token) => token.index >= quantityToken.index),
  };
};

const normalizeInvoiceLines = (text) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(cleanInvoiceLine)
    .filter((line) => line.length > 0);
  const merged = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];

    if (
      nextLine
      && !isNonLineItemLine(line)
      && !isNonLineItemLine(nextLine)
      && !lineHasPriceCandidate(line)
      && lineHasPriceCandidate(nextLine)
      && /[a-z]/i.test(line)
    ) {
      merged.push(`${line} ${nextLine}`);
      index += 1;
    } else {
      merged.push(line);
    }
  }

  return merged;
};

const createLineItemFromLine = ({ line, index, vatMode, vatRate }) => {
  if (isNonLineItemLine(line)) return null;

  const tokens = extractNumberTokens(line);
  const explicitQuantity = getExplicitQuantity(line);
  const codeTokens = tokens.filter((token) => isLeadingCodeToken(token, line));
  const tokensWithoutCodes = tokens.filter((token) => !codeTokens.includes(token));
  const tableColumns = getSupplierTableColumns(tokensWithoutCodes, line);
  const tableQuantityUsesExplicitUnit = Boolean(
    tableColumns
    && explicitQuantity?.span
    && isTokenInsideSpan(tableColumns.quantityToken, explicitQuantity.span)
  );
  const tokensForGenericParsing = tokensWithoutCodes.filter((token) => (
    !isTokenInsideSpan(token, explicitQuantity?.span)
  ));
  const looseQuantityToken = explicitQuantity || tableColumns ? null : getLooseQuantityToken(tokensForGenericParsing);
  const priceCandidates = tokensWithoutCodes.filter((token) => (
    token !== looseQuantityToken
    && !tableColumns?.removeTokens.includes(token)
    && !isTokenInsideSpan(token, explicitQuantity?.span)
  ));
  const priceTokens = tableColumns
    ? [tableColumns.unitPriceToken, tableColumns.lineTotalToken]
    : priceCandidates.length >= 2
      ? priceCandidates.slice(-2)
      : priceCandidates.slice(-1);

  if (priceTokens.length === 0) return null;

  const lineTotal = tableColumns?.lineTotalToken.value || priceTokens[priceTokens.length - 1].value;
  const quantity = tableColumns?.quantityToken.value || explicitQuantity?.quantity || looseQuantityToken?.value || 1;
  const unit = tableColumns
    ? tableQuantityUsesExplicitUnit || explicitQuantity?.unitOnly
      ? explicitQuantity.unit
      : 'each'
    : explicitQuantity?.unit || 'each';
  const unitPrice = tableColumns?.unitPriceToken.value
    || (priceTokens.length >= 2
      ? priceTokens[0].value
      : quantity > 1
        ? lineTotal / quantity
        : lineTotal);

  if (!hasReasonableLineValues({ lineTotal, unitPrice, quantity })) {
    return null;
  }

  const removeNameSpans = [
    ...(tableColumns
      ? tableColumns.removeTokens
      : priceTokens).map((token) => ({ index: token.index, end: token.end })),
    tableColumns
      ? tableQuantityUsesExplicitUnit
        ? { index: explicitQuantity.span.index, end: tableColumns.quantityToken.index }
        : explicitQuantity?.unitOnly
          ? explicitQuantity.span
          : null
      : explicitQuantity?.span,
    looseQuantityToken ? { index: looseQuantityToken.index, end: looseQuantityToken.end } : null,
  ];
  const name = cleanItemName(removeSpans(line, removeNameSpans));

  if (!isValidItemName(name)) {
    return null;
  }

  const vat = calculateVatValues({ lineTotal, unitPrice, vatMode, vatRate });
  const base = getBaseUnitInfo(quantity, unit);
  const costPerBaseUnitExVAT = base.quantity > 0 ? roundMoney(vat.priceExVAT / base.quantity) : 0;
  const confidence = roundMoney(Math.min(0.96, 0.48
    + (priceTokens.length >= 2 ? 0.22 : 0.1)
    + (explicitQuantity ? 0.12 : 0)
    + (looseQuantityToken ? 0.06 : 0)
    + (name.length > 3 ? 0.1 : 0)));

  return {
    id: `line-${index}-${createInvoiceKey(name) || Math.random().toString(36).slice(2)}`,
    itemName: name,
    quantity,
    unit,
    unitPrice: roundMoney(unitPrice),
    lineTotal: roundMoney(lineTotal),
    vatMode,
    vatRate,
    vatAmount: vat.vatAmount,
    priceExVAT: vat.priceExVAT,
    priceIncVAT: vat.priceIncVAT,
    unitPriceExVAT: vat.unitPriceExVAT,
    unitPriceIncVAT: vat.unitPriceIncVAT,
    baseQuantity: base.quantity,
    baseUnit: base.unit,
    costPerBaseUnitExVAT,
    rawLine: line,
    confidence,
  };
};

export const parseInvoiceText = (text, { vatRate = DEFAULT_VAT_RATE } = {}) => {
  const rawText = String(text || '');
  const vatMode = detectVatMode(rawText);
  const lines = normalizeInvoiceLines(rawText);
  const items = lines
    .map((line, index) => createLineItemFromLine({ line, index, vatMode, vatRate }))
    .filter(Boolean);

  return {
    supplierName: detectSupplierName(rawText),
    invoiceDate: detectInvoiceDate(rawText),
    vatMode,
    vatRate,
    items,
    rawText,
    totals: summarizeInvoiceItems(items),
  };
};

export const summarizeInvoiceItems = (items) => (
  (Array.isArray(items) ? items : []).reduce((summary, item) => ({
    totalExVAT: roundMoney(summary.totalExVAT + Number(item?.priceExVAT || 0)),
    totalVAT: roundMoney(summary.totalVAT + Number(item?.vatAmount || 0)),
    totalIncVAT: roundMoney(summary.totalIncVAT + Number(item?.priceIncVAT || 0)),
  }), { totalExVAT: 0, totalVAT: 0, totalIncVAT: 0 })
);

export const getIngredientMatch = (itemName, ingredients) => {
  const source = normalizeInvoiceName(itemName);
  const sourceTokens = source.split(' ').filter(Boolean);

  if (!source) {
    return { ingredient: null, score: 0 };
  }

  const ranked = (Array.isArray(ingredients) ? ingredients : [])
    .map((ingredient) => {
      const target = normalizeInvoiceName(ingredient?.name || ingredient?.ingredientName);
      const targetTokens = target.split(' ').filter(Boolean);
      const shared = sourceTokens.filter((token) => targetTokens.includes(token));
      const score = source === target
        ? 1
        : source.includes(target) || target.includes(source)
          ? 0.86
          : shared.length / Math.max(sourceTokens.length || 1, targetTokens.length || 1);

      return { ingredient, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.score >= 0.42 ? ranked[0] : { ingredient: null, score: ranked[0]?.score || 0 };
};

const getRecipeIngredientName = (ingredient) => (
  ingredient?.ingredientName || ingredient?.name || ingredient?.componentName || ''
);

export const getMenuRecipeRows = (menuItem) => {
  const recipeRows = Array.isArray(menuItem?.recipe)
    ? menuItem.recipe
    : Array.isArray(menuItem?.ingredients)
      ? menuItem.ingredients
      : Array.isArray(menuItem?.components)
        ? menuItem.components
        : [];

  return recipeRows
    .map((ingredient) => ({
      ingredientName: getRecipeIngredientName(ingredient),
      quantity: Number(ingredient?.quantity) || 1,
      unit: normalizeInvoiceUnit(ingredient?.unit || ingredient?.quantityUnit || 'each'),
      cost: Number(ingredient?.cost) || 0,
    }))
    .filter((ingredient) => ingredient.ingredientName);
};

export const calculateRecipeCostImpact = ({ lineItems, menuItems, ingredients }) => {
  const matchedItems = (Array.isArray(lineItems) ? lineItems : [])
    .map((lineItem) => ({
      lineItem,
      match: getIngredientMatch(lineItem.itemName, ingredients),
    }))
    .filter((item) => item.match.ingredient);

  return (Array.isArray(menuItems) ? menuItems : [])
    .map((menuItem) => {
      const recipeRows = getMenuRecipeRows(menuItem);
      let oldContribution = 0;
      let newContribution = 0;
      const affectedIngredients = [];

      recipeRows.forEach((recipeRow) => {
        const matched = matchedItems.find(({ match }) => (
          normalizeInvoiceName(match.ingredient?.name) === normalizeInvoiceName(recipeRow.ingredientName)
        ));

        if (!matched) return;

        const recipeBase = getBaseUnitInfo(recipeRow.quantity, recipeRow.unit);

        if (recipeBase.unit !== matched.lineItem.baseUnit) {
          return;
        }

        const oldUnitPrice = Number(matched.match.ingredient?.lastPriceExVAT)
          || Number(matched.match.ingredient?.priceExVAT)
          || Number(recipeRow.cost)
          || 0;
        const oldBase = getBaseUnitInfo(matched.match.ingredient?.lastQuantity || 1, matched.match.ingredient?.unit || matched.lineItem.unit);
        const oldCostPerBase = oldBase.quantity > 0 && oldBase.unit === recipeBase.unit
          ? oldUnitPrice / oldBase.quantity
          : oldUnitPrice;
        const oldCost = roundMoney(recipeRow.cost || (oldCostPerBase * recipeBase.quantity));
        const newCost = roundMoney(matched.lineItem.costPerBaseUnitExVAT * recipeBase.quantity);

        oldContribution += oldCost;
        newContribution += newCost;
        affectedIngredients.push({
          ingredientName: recipeRow.ingredientName,
          oldCost,
          newCost,
        });
      });

      if (affectedIngredients.length === 0) {
        return null;
      }

      const oldCostPerPortion = roundMoney(Number(menuItem?.totalCost) || recipeRows.reduce((sum, row) => sum + Number(row.cost || 0), 0) || oldContribution);
      const newCostPerPortion = roundMoney(Math.max(0, oldCostPerPortion - oldContribution + newContribution));
      const percentChange = oldCostPerPortion > 0
        ? roundMoney(((newCostPerPortion - oldCostPerPortion) / oldCostPerPortion) * 100)
        : 0;

      return {
        menuItemId: menuItem.id || menuItem.key || createInvoiceKey(menuItem.name),
        menuItemName: menuItem.name,
        oldCostPerPortion,
        newCostPerPortion,
        percentChange,
        suggestedSellingPrice: roundMoney(newCostPerPortion / 0.3),
        affectedIngredients,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));
};
