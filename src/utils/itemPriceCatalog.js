export const PRICE_UNIT_OPTIONS = [
  { value: 'each', label: 'item / each' },
  { value: 'g', label: 'gram (g)' },
  { value: 'kg', label: 'kilogram (kg)' },
  { value: 'ml', label: 'millilitre (ml)' },
  { value: 'l', label: 'litre (L)' },
];

const UNIT_CONVERSIONS = {
  each: { family: 'count', factor: 1 },
  g: { family: 'mass', factor: 1 },
  kg: { family: 'mass', factor: 1000 },
  ml: { family: 'volume', factor: 1 },
  l: { family: 'volume', factor: 1000 },
};

const roundCurrency = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue * 100) / 100 : 0;
};

export const createItemPriceKey = (itemName) => String(itemName || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' ')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const parsePrice = (value) => {
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const parseQuantityNumber = (value) => {
  const text = String(value || '').trim();
  const mixedFractionMatch = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);

  if (mixedFractionMatch) {
    const [, whole, numerator, denominator] = mixedFractionMatch;
    const denominatorValue = Number(denominator);
    return denominatorValue > 0 ? Number(whole) + (Number(numerator) / denominatorValue) : Number.NaN;
  }

  const fractionMatch = text.match(/^(\d+)\s*\/\s*(\d+)/);

  if (fractionMatch) {
    const [, numerator, denominator] = fractionMatch;
    const denominatorValue = Number(denominator);
    return denominatorValue > 0 ? Number(numerator) / denominatorValue : Number.NaN;
  }

  const numericMatch = text.match(/^-?\d+(?:\.\d+)?/);
  return numericMatch ? Number(numericMatch[0]) : Number.NaN;
};

const normalizeUnit = (unit) => {
  const value = String(unit || '').trim().toLowerCase();

  if (!value) return 'each';
  if (['each', 'ea', 'item', 'items', 'unit', 'units'].includes(value)) return 'each';
  if (['g', 'gram', 'grams'].includes(value)) return 'g';
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(value)) return 'kg';
  if (['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'].includes(value)) return 'ml';
  if (['l', 'lt', 'ltr', 'litre', 'litres', 'liter', 'liters'].includes(value)) return 'l';
  return value;
};

export const parseIngredientQuantity = (quantityLabel) => {
  const text = String(quantityLabel || '').trim();

  if (!text) {
    return null;
  }

  const quantity = parseQuantityNumber(text);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const unitMatch = text.match(/(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)/);
  const unit = normalizeUnit(unitMatch?.[1] || 'each');

  return { quantity, unit };
};

export const sanitizeItemPriceRecord = (record, fallbackKey = '') => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const name = String(record.name || '').trim();
  const key = String(record.key || fallbackKey || createItemPriceKey(name)).trim();
  const unit = normalizeUnit(record.unit || record.priceUnit || 'each');
  const price = parsePrice(record.price ?? record.pricePerUnit ?? record.cost);

  if (!key || !name || price === null || !UNIT_CONVERSIONS[unit]) {
    return null;
  }

  return {
    key,
    name,
    category: String(record.category || 'Other').trim() || 'Other',
    price: roundCurrency(price),
    unit,
    updatedAt: String(record.updatedAt || ''),
  };
};

export const sanitizeItemPriceCatalog = (catalog) => {
  const entries = Array.isArray(catalog)
    ? catalog.map((record) => [record?.key || createItemPriceKey(record?.name), record])
    : Object.entries(
      catalog && typeof catalog === 'object' && !Array.isArray(catalog)
        ? catalog
        : {}
    );

  return entries.reduce((acc, [key, record]) => {
    const cleanRecord = sanitizeItemPriceRecord(record, key);

    if (cleanRecord) {
      acc[cleanRecord.key] = cleanRecord;
    }

    return acc;
  }, {});
};

export const findItemPriceRecord = (catalog, itemName) => {
  const cleanCatalog = catalog && typeof catalog === 'object' && !Array.isArray(catalog) ? catalog : {};
  return cleanCatalog[createItemPriceKey(itemName)] || null;
};

export const calculateItemPriceCost = ({
  priceRecord,
  quantity,
  unit,
  measuredQuantity,
  measuredUnit,
}) => {
  const cleanRecord = sanitizeItemPriceRecord(priceRecord);

  if (!cleanRecord) {
    return { canCalculate: false, cost: 0, quantityInPriceUnit: 0 };
  }

  const sourceQuantity = unit === 'portion' && Number(measuredQuantity) > 0
    ? Number(measuredQuantity)
    : Number(quantity);
  const sourceUnit = unit === 'portion' && measuredUnit
    ? normalizeUnit(measuredUnit)
    : normalizeUnit(unit);
  const sourceMeta = UNIT_CONVERSIONS[sourceUnit];
  const priceMeta = UNIT_CONVERSIONS[cleanRecord.unit];

  if (!Number.isFinite(sourceQuantity) || sourceQuantity <= 0 || !sourceMeta || !priceMeta || sourceMeta.family !== priceMeta.family) {
    return { canCalculate: false, cost: 0, quantityInPriceUnit: 0 };
  }

  const quantityInPriceUnit = (sourceQuantity * sourceMeta.factor) / priceMeta.factor;

  return {
    canCalculate: true,
    cost: roundCurrency(quantityInPriceUnit * cleanRecord.price),
    quantityInPriceUnit,
  };
};

export const calculateRecipeIngredientCost = ({ ingredient, itemPriceCatalog, multiplier = 1 }) => {
  const safeMultiplier = Number(multiplier);
  const record = findItemPriceRecord(itemPriceCatalog, ingredient?.name);
  const parsedQuantity = parseIngredientQuantity(ingredient?.quantity);

  if (record && parsedQuantity && Number.isFinite(safeMultiplier) && safeMultiplier > 0) {
    const calculated = calculateItemPriceCost({
      priceRecord: record,
      quantity: parsedQuantity.quantity * safeMultiplier,
      unit: parsedQuantity.unit,
    });

    if (calculated.canCalculate) {
      return {
        cost: calculated.cost,
        baseCost: roundCurrency(calculated.cost / safeMultiplier),
        source: 'catalog',
        priceCatalogKey: record.key,
        pricePerUnit: record.price,
        priceUnit: record.unit,
      };
    }
  }

  const safeBaseCost = Number(ingredient?.cost) || 0;
  const safeCostMultiplier = Number.isFinite(safeMultiplier) && safeMultiplier > 0 ? safeMultiplier : 1;

  return {
    cost: roundCurrency(safeBaseCost * safeCostMultiplier),
    baseCost: roundCurrency(safeBaseCost),
    source: safeBaseCost > 0 ? 'manual' : 'missing',
    priceCatalogKey: '',
    pricePerUnit: null,
    priceUnit: '',
  };
};
