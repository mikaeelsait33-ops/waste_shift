import {
  UNIT_CONVERSIONS,
  createItemPriceKey,
  getBaseUnitForPriceUnit,
  normalizeItemPriceUnit,
  roundUnitPrice,
} from './itemPriceCatalog.js';
import { roundMoney } from './invoiceParsing.js';

const PACKAGE_UNITS = new Set(['case', 'pkt', 'bag', 'box', 'bottle', 'tray', 'tin', 'punnet', 'bunch', 'head', 'pillow']);
const PREP_WORDS = [
  'bits',
  'chopped',
  'diced',
  'grated',
  'sliced',
  'slice',
  'strips',
  'strip',
  'toasted',
  'fresh',
  'frozen',
  'whole',
  'peeled',
  'cooked',
  'raw',
];
const GENERIC_WORDS = [
  ...PREP_WORDS,
  'pack',
  'packet',
  'pkt',
  'case',
  'box',
  'bag',
  'tray',
  'bottle',
  'tin',
  'punnet',
  'bunch',
  'head',
  'pillow',
  'each',
  'unit',
  'per',
  'kg',
  'g',
  'gram',
  'grams',
  'l',
  'lt',
  'ltr',
  'litre',
  'litres',
  'liter',
  'liters',
  'ml',
];

const toSafeString = (value) => String(value ?? '').trim();

export const uniqueMasterStrings = (values) => (
  [...new Set((Array.isArray(values) ? values : [values])
    .flat()
    .map((value) => toSafeString(value))
    .filter(Boolean))]
);

const singularizeToken = (token) => {
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 3) return token.slice(0, -1);
  return token;
};

export const normalizeMasterIngredientName = (value) => {
  const genericPattern = new RegExp(`\\b(?:${GENERIC_WORDS.join('|')})\\b`, 'g');

  return toSafeString(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\d[^)]*\)/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:x\s*)?(?:kg|kgs|kilogram|kilograms|g|gram|grams|l|lt|ltr|litre|litres|liter|liters|ml)\b/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?\b/g, ' ')
    .replace(/\bx\s*\d+(?:[.,]\d+)?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(genericPattern, ' ')
    .split(' ')
    .map(singularizeToken)
    .filter(Boolean)
    .join(' ')
    .trim();
};

export const createMasterIngredientId = (name) => createItemPriceKey(normalizeMasterIngredientName(name) || name);

const cleanCanonicalName = (value) => {
  const raw = toSafeString(value);
  const withoutQuantity = raw
    .replace(/\s*\([^)]*\d[^)]*\)\s*$/g, '')
    .replace(/\s[-\u2013\u2014]\s*\d+(?:[.,]\d+)?\s*[a-zA-Z]+\s*$/g, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:x\s*)?(?:kg|kgs|kilogram|kilograms|g|gram|grams|l|lt|ltr|litre|litres|liter|liters|ml)\b/gi, ' ')
    .replace(/\b(?:pack|packet|case|box|bag|tray|bottle|tin|punnet|each|per kg)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return withoutQuantity || raw;
};

export const getMasterBaseUnit = (unit) => {
  const normalizedUnit = normalizeItemPriceUnit(unit || 'each');

  if (['kg', 'g'].includes(normalizedUnit)) return 'g';
  if (['l', 'ml'].includes(normalizedUnit)) return 'ml';
  if (['doz', 'each'].includes(normalizedUnit)) return 'each';
  if (PACKAGE_UNITS.has(normalizedUnit)) return normalizedUnit;
  return getBaseUnitForPriceUnit(normalizedUnit);
};

export const convertQuantityToBaseUnit = ({
  quantity = 1,
  unit = 'each',
  baseUnit = '',
  packageUnitCount = null,
} = {}) => {
  const safeQuantity = Number(quantity);
  const normalizedUnit = normalizeItemPriceUnit(unit || 'each');
  const targetBaseUnit = normalizeItemPriceUnit(baseUnit || getMasterBaseUnit(normalizedUnit));
  const packageCount = Number(packageUnitCount);
  const packageMatch = toSafeString(unit).toLowerCase().match(/^(?:case|box|pack|pkt|tray|bag)\s*(?:of)?\s*(\d+(?:[.,]\d+)?)$/);

  if (!Number.isFinite(safeQuantity) || safeQuantity <= 0) {
    return { canConvert: false, quantity: 0, unit: targetBaseUnit || normalizedUnit, reason: 'invalid_quantity' };
  }

  if (packageMatch) {
    const count = Number(String(packageMatch[1]).replace(',', '.')) || 0;
    return count > 0
      ? { canConvert: true, quantity: roundUnitPrice(safeQuantity * count), unit: 'each' }
      : { canConvert: false, quantity: safeQuantity, unit: normalizedUnit, reason: 'unknown_package_quantity' };
  }

  if (PACKAGE_UNITS.has(normalizedUnit)) {
    if (Number.isFinite(packageCount) && packageCount > 0) {
      return { canConvert: true, quantity: roundUnitPrice(safeQuantity * packageCount), unit: 'each' };
    }

    return { canConvert: false, quantity: safeQuantity, unit: normalizedUnit, reason: 'unknown_package_quantity' };
  }

  const sourceMeta = UNIT_CONVERSIONS[normalizedUnit];
  const targetMeta = UNIT_CONVERSIONS[targetBaseUnit];

  if (!sourceMeta || !targetMeta || sourceMeta.family !== targetMeta.family) {
    return { canConvert: false, quantity: safeQuantity, unit: targetBaseUnit || normalizedUnit, reason: 'unit_mismatch' };
  }

  return {
    canConvert: true,
    quantity: roundUnitPrice((safeQuantity * sourceMeta.factor) / targetMeta.factor),
    unit: targetBaseUnit,
  };
};

export const getMasterAliases = (ingredient = {}) => uniqueMasterStrings([
  ingredient.aliases,
  ingredient.previousRawNames,
  ingredient.invoiceNames,
  ingredient.canonicalName,
  ingredient.name,
  ingredient.ingredientName,
  ingredient.rawName,
]);

export const normalizeMasterIngredientRecord = (ingredient = {}) => {
  const canonicalName = cleanCanonicalName(ingredient.canonicalName || ingredient.name || ingredient.ingredientName || ingredient.rawName);
  const id = toSafeString(ingredient.id || ingredient.ingredientId || ingredient.key) || createMasterIngredientId(canonicalName);
  const baseUnit = normalizeItemPriceUnit(
    ingredient.baseUnit
    || ingredient.lastPurchaseUnit
    || ingredient.defaultUnit
    || ingredient.unit
    || 'each'
  );
  const latestCostPerBaseUnit = Number(
    ingredient.latestCostPerBaseUnit
    ?? ingredient.costPerBaseUnit
    ?? ingredient.costPerBaseUnitExVAT
    ?? ingredient.pricePerBaseUnit
    ?? 0
  );
  const latestCost = Number(
    ingredient.latestCost
    ?? ingredient.currentPrice
    ?? ingredient.lastPriceExVAT
    ?? ingredient.lastInvoicePrice
    ?? 0
  );
  const aliases = uniqueMasterStrings([
    getMasterAliases(ingredient),
    canonicalName,
    normalizeMasterIngredientName(canonicalName),
  ]);

  if (!canonicalName || !id) {
    return null;
  }

  return {
    ...ingredient,
    id,
    ingredientId: id,
    key: ingredient.key || id,
    name: ingredient.name || canonicalName,
    canonicalName,
    baseUnit,
    aliases,
    previousRawNames: uniqueMasterStrings(ingredient.previousRawNames),
    latestCostPerBaseUnit: Number.isFinite(latestCostPerBaseUnit) ? roundUnitPrice(latestCostPerBaseUnit) : 0,
    lastInvoicePrice: roundMoney(ingredient.lastInvoicePrice ?? ingredient.lastLineTotalExVAT ?? ingredient.priceExVAT ?? latestCost),
    lastPurchaseQuantity: Number(ingredient.lastPurchaseQuantity ?? ingredient.baseQuantity ?? ingredient.lastQuantity) || 0,
    lastPurchaseUnit: toSafeString(ingredient.lastPurchaseUnit || ingredient.baseUnit || ingredient.lastUnit || ingredient.unit) || baseUnit,
  };
};

export const mergeMasterIngredientSources = (...ingredientSources) => {
  const ingredientsById = new Map();
  const idByCanonicalName = new Map();

  ingredientSources
    .flatMap((source) => (Array.isArray(source) ? source : []))
    .forEach((ingredient) => {
      const normalizedIngredient = normalizeMasterIngredientRecord(ingredient);

      if (!normalizedIngredient) {
        return;
      }

      const canonicalKey = normalizeMasterIngredientName(
        normalizedIngredient.canonicalName || normalizedIngredient.name
      );
      const existingId = ingredientsById.has(normalizedIngredient.id)
        ? normalizedIngredient.id
        : idByCanonicalName.get(canonicalKey);
      const targetId = existingId || normalizedIngredient.id;
      const existingIngredient = ingredientsById.get(targetId);
      const mergedIngredient = normalizeMasterIngredientRecord({
        ...(existingIngredient || {}),
        ...normalizedIngredient,
        id: targetId,
        ingredientId: targetId,
        key: targetId,
        aliases: uniqueMasterStrings([
          existingIngredient?.aliases,
          existingIngredient?.previousRawNames,
          normalizedIngredient.aliases,
          normalizedIngredient.previousRawNames,
        ]),
        previousRawNames: uniqueMasterStrings([
          existingIngredient?.previousRawNames,
          normalizedIngredient.previousRawNames,
        ]),
      });

      if (!mergedIngredient) {
        return;
      }

      ingredientsById.set(targetId, mergedIngredient);
      if (canonicalKey) {
        idByCanonicalName.set(canonicalKey, targetId);
      }
    });

  return [...ingredientsById.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const tokenScore = (source, target) => {
  const sourceTokens = source.split(' ').filter(Boolean);
  const targetTokens = target.split(' ').filter(Boolean);

  if (!source || !target || sourceTokens.length === 0 || targetTokens.length === 0) {
    return 0;
  }

  if (source === target) return 1;
  if (source.includes(target) || target.includes(source)) return 0.88;

  const shared = sourceTokens.filter((sourceToken) => (
    targetTokens.some((targetToken) => (
      sourceToken === targetToken
      || (sourceToken.length > 3 && targetToken.includes(sourceToken))
      || (targetToken.length > 3 && sourceToken.includes(targetToken))
    ))
  )).length;

  return shared / Math.max(sourceTokens.length, targetTokens.length);
};

export const matchMasterIngredient = (rawName, ingredients = []) => {
  const normalizedRawName = normalizeMasterIngredientName(rawName);
  const candidates = (Array.isArray(ingredients) ? ingredients : [])
    .map(normalizeMasterIngredientRecord)
    .filter(Boolean);

  if (!normalizedRawName) {
    return {
      ingredient: null,
      score: 0,
      matchConfidence: 0,
      matchType: 'empty_name',
      needsReview: true,
      normalizedRawName,
    };
  }

  const exact = candidates.find((ingredient) => (
    getMasterAliases(ingredient).some((alias) => normalizeMasterIngredientName(alias) === normalizedRawName)
  ));

  if (exact) {
    return {
      ingredient: exact,
      score: 1,
      matchConfidence: 1,
      matchType: 'exact_alias',
      needsReview: false,
      normalizedRawName,
    };
  }

  const ranked = candidates
    .map((ingredient) => {
      const aliases = getMasterAliases(ingredient);
      const bestScore = aliases.reduce((score, alias) => Math.max(score, tokenScore(normalizedRawName, normalizeMasterIngredientName(alias))), 0);

      return { ingredient, score: roundUnitPrice(bestScore) };
    })
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];

  if (!best || best.score < 0.6) {
    return {
      ingredient: null,
      score: best?.score || 0,
      matchConfidence: best?.score || 0,
      matchType: 'manual_required',
      needsReview: true,
      normalizedRawName,
    };
  }

  const ambiguous = second && best.score - second.score < 0.08;
  const needsReview = best.score < 0.85 || ambiguous;

  return {
    ingredient: best.ingredient,
    score: best.score,
    matchConfidence: best.score,
    matchType: needsReview ? (ambiguous ? 'ambiguous_fuzzy' : 'fuzzy_review') : 'fuzzy',
    needsReview,
    normalizedRawName,
  };
};

export const buildInvoiceIngredientPricing = (lineItem = {}, row = {}) => {
  const explicitQuantity = Number(row.convertedQuantity ?? row.baseQuantity ?? lineItem.baseQuantity);
  const explicitBaseUnit = normalizeItemPriceUnit(row.baseUnit || lineItem.baseUnit || '');

  if (Number.isFinite(explicitQuantity) && explicitQuantity > 0 && explicitBaseUnit) {
    const totalPrice = Number(row.totalPrice ?? row.priceExVAT ?? lineItem.priceExVAT ?? lineItem.lineTotal ?? 0);

    return {
      canConvert: !PACKAGE_UNITS.has(explicitBaseUnit),
      convertedQuantity: roundUnitPrice(explicitQuantity),
      baseUnit: explicitBaseUnit,
      totalPrice: roundMoney(totalPrice),
      costPerBaseUnit: explicitQuantity > 0 ? roundUnitPrice(totalPrice / explicitQuantity) : 0,
      reason: PACKAGE_UNITS.has(explicitBaseUnit) ? 'unknown_package_quantity' : '',
    };
  }

  const converted = convertQuantityToBaseUnit({
    quantity: row.quantity ?? row.invoiceQuantity ?? lineItem.quantity,
    unit: row.unit ?? row.invoiceUnit ?? lineItem.unit,
    baseUnit: row.baseUnit,
    packageUnitCount: row.packageUnitCount ?? lineItem.packageUnitCount,
  });
  const totalPrice = Number(row.totalPrice ?? row.priceExVAT ?? lineItem.priceExVAT ?? lineItem.lineTotal ?? 0);

  return {
    canConvert: converted.canConvert,
    convertedQuantity: converted.quantity,
    baseUnit: converted.unit,
    totalPrice: roundMoney(totalPrice),
    costPerBaseUnit: converted.quantity > 0 ? roundUnitPrice(totalPrice / converted.quantity) : 0,
    reason: converted.reason || '',
  };
};

export const getPriceChangeFromBaseCost = (previousCost, nextCost) => {
  const previous = Number(previousCost);
  const next = Number(nextCost);

  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(next) || next <= 0) {
    return 0;
  }

  return roundMoney(((next - previous) / previous) * 100);
};
