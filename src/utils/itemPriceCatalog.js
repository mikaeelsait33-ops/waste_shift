export const PRICE_UNIT_OPTIONS = [
  { value: 'each', label: 'item / each' },
  { value: 'g', label: 'gram (g)' },
  { value: 'kg', label: 'kilogram (kg)' },
  { value: 'ml', label: 'millilitre (ml)' },
  { value: 'l', label: 'litre (L)' },
  { value: 'doz', label: 'dozen' },
  { value: 'case', label: 'case' },
  { value: 'pkt', label: 'packet' },
  { value: 'bag', label: 'bag' },
  { value: 'box', label: 'box' },
  { value: 'bottle', label: 'bottle' },
  { value: 'tray', label: 'tray' },
  { value: 'tin', label: 'tin' },
  { value: 'punnet', label: 'punnet' },
  { value: 'bunch', label: 'bunch' },
  { value: 'head', label: 'head' },
  { value: 'pillow', label: 'pillow' },
];

export const UNIT_CONVERSIONS = {
  each: { family: 'each', factor: 1 },
  g: { family: 'mass', factor: 1 },
  kg: { family: 'mass', factor: 1000 },
  ml: { family: 'volume', factor: 1 },
  l: { family: 'volume', factor: 1000 },
  doz: { family: 'each', factor: 12 },
  case: { family: 'case', factor: 1 },
  pkt: { family: 'pkt', factor: 1 },
  bag: { family: 'bag', factor: 1 },
  box: { family: 'box', factor: 1 },
  bottle: { family: 'bottle', factor: 1 },
  tray: { family: 'tray', factor: 1 },
  tin: { family: 'tin', factor: 1 },
  punnet: { family: 'punnet', factor: 1 },
  bunch: { family: 'bunch', factor: 1 },
  head: { family: 'head', factor: 1 },
  pillow: { family: 'pillow', factor: 1 },
};

const roundCurrency = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue * 100) / 100 : 0;
};

export const roundUnitPrice = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue * 10000) / 10000 : 0;
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

export const normalizeItemPriceUnit = (unit) => {
  const value = String(unit || '').trim().toLowerCase();

  if (!value) return 'each';
  if (['each', 'ea', 'item', 'items', 'unit', 'units', 'egg', 'eggs', 'bun', 'buns', 'roll', 'rolls', 'slice', 'slices', 'piece', 'pieces'].includes(value)) return 'each';
  if (['g', 'gram', 'grams'].includes(value)) return 'g';
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(value)) return 'kg';
  if (['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'].includes(value)) return 'ml';
  if (['l', 'lt', 'ltr', 'litre', 'litres', 'liter', 'liters'].includes(value)) return 'l';
  if (['doz', 'dozen'].includes(value)) return 'doz';
  if (['case', 'cases'].includes(value)) return 'case';
  if (['pkt', 'packet', 'pack', 'packets', 'packs'].includes(value)) return 'pkt';
  if (['bag', 'bags'].includes(value)) return 'bag';
  if (['box', 'boxes'].includes(value)) return 'box';
  if (['btl', 'bottle', 'bottles'].includes(value)) return 'bottle';
  if (['tray', 'trays'].includes(value)) return 'tray';
  if (['tin', 'tins'].includes(value)) return 'tin';
  if (['punnet', 'punnets', 'pp'].includes(value)) return 'punnet';
  if (['bunch', 'bunches'].includes(value)) return 'bunch';
  if (['head', 'heads'].includes(value)) return 'head';
  if (['pillow', 'pillows'].includes(value)) return 'pillow';
  return value;
};

export const getBaseUnitForPriceUnit = (unit) => {
  const normalizedUnit = normalizeItemPriceUnit(unit);

  if (['kg', 'g'].includes(normalizedUnit)) return 'g';
  if (['l', 'ml'].includes(normalizedUnit)) return 'ml';
  if (['doz', 'each'].includes(normalizedUnit)) return 'each';
  return UNIT_CONVERSIONS[normalizedUnit] ? normalizedUnit : 'each';
};

export const getCostPerBaseUnit = ({ price, unit, baseUnit, costPerBaseUnit }) => {
  const explicitCost = parsePrice(costPerBaseUnit);

  if (explicitCost !== null) {
    return roundUnitPrice(explicitCost);
  }

  const cleanPrice = parsePrice(price);
  const priceUnit = normalizeItemPriceUnit(unit);
  const normalizedBaseUnit = normalizeItemPriceUnit(baseUnit || getBaseUnitForPriceUnit(priceUnit));
  const priceMeta = UNIT_CONVERSIONS[priceUnit];
  const baseMeta = UNIT_CONVERSIONS[normalizedBaseUnit];

  if (cleanPrice === null || !priceMeta || !baseMeta || priceMeta.family !== baseMeta.family) {
    return 0;
  }

  return roundUnitPrice(cleanPrice / (priceMeta.factor / baseMeta.factor));
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
  const unit = normalizeItemPriceUnit(unitMatch?.[1] || 'each');

  return { quantity, unit };
};

export const formatIngredientQuantity = (quantity, unit) => {
  const numericQuantity = Number(quantity);
  const cleanUnit = normalizeItemPriceUnit(unit || 'each');

  if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
    return '';
  }

  const formattedQuantity = Number.isInteger(numericQuantity)
    ? String(numericQuantity)
    : String(Number(numericQuantity.toFixed(4))).replace(/0+$/, '').replace(/\.$/, '');

  return cleanUnit === 'each' ? formattedQuantity : `${formattedQuantity}${cleanUnit}`;
};

export const parseRecipeIngredientText = (ingredient) => {
  const rawName = String(
    typeof ingredient === 'string'
      ? ingredient
      : ingredient?.name || ingredient?.ingredientName || ingredient?.componentName || ''
  ).trim();
  const quantityFromFields = Number(ingredient?.quantityValue);
  const unitFromFields = normalizeItemPriceUnit(ingredient?.unit || ingredient?.quantityUnit || ingredient?.measuredUnit || '');
  const explicitQuantity = Number.isFinite(quantityFromFields) && quantityFromFields > 0 && unitFromFields
    ? { quantity: quantityFromFields, unit: unitFromFields }
    : parseIngredientQuantity(ingredient?.quantity);
  const parentheticalQuantity = rawName.match(/\(([^()]*\d[^()]*)\)\s*$/);
  const trailingQuantity = rawName.match(/\s[-\u2013\u2014]\s*(\d+(?:\.\d+)?\s*[a-zA-Z]+)\s*$/);
  const parsedFromName = parseIngredientQuantity(parentheticalQuantity?.[1] || trailingQuantity?.[1] || '');
  const parsedQuantity = explicitQuantity || parsedFromName;
  const cleanName = parsedFromName
    ? rawName
      .replace(/\s*\([^()]*\d[^()]*\)\s*$/, '')
      .replace(/\s[-\u2013\u2014]\s*\d+(?:\.\d+)?\s*[a-zA-Z]+\s*$/, '')
      .trim()
    : rawName;

  return {
    name: cleanName || rawName,
    quantity: parsedQuantity ? formatIngredientQuantity(parsedQuantity.quantity, parsedQuantity.unit) : String(ingredient?.quantity || '').trim(),
    quantityValue: parsedQuantity?.quantity ?? null,
    unit: parsedQuantity?.unit || '',
  };
};

export const normalizeRecipeIngredient = (ingredient, fallbackCategory = 'Other') => {
  const parsed = parseRecipeIngredientText(ingredient);

  return {
    ...(ingredient?.ingredientId ? { ingredientId: String(ingredient.ingredientId).trim() } : {}),
    ...(ingredient?.priceCatalogKey ? { priceCatalogKey: String(ingredient.priceCatalogKey).trim() } : {}),
    displayName: String(ingredient?.displayName || parsed.name || '').trim(),
    name: parsed.name,
    quantity: parsed.quantity,
    ...(parsed.quantityValue !== null ? { quantityValue: parsed.quantityValue } : {}),
    ...(parsed.unit ? { unit: parsed.unit } : {}),
    cost: parsePrice(ingredient?.cost) || 0,
    category: String(ingredient?.category || fallbackCategory || 'Other').trim() || 'Other',
  };
};

export const sanitizeItemPriceRecord = (record, fallbackKey = '') => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }

  const name = String(record.name || '').trim();
  const key = String(record.key || fallbackKey || createItemPriceKey(name)).trim();
  const ingredientId = String(record.ingredientId || record.matchedIngredientId || record.id || key).trim();
  const unit = normalizeItemPriceUnit(record.unit || record.priceUnit || 'each');
  const price = parsePrice(record.price ?? record.pricePerUnit ?? record.cost ?? record.latestCost ?? record.lastPriceExVAT ?? record.costPerBaseUnitExVAT);
  const baseUnit = normalizeItemPriceUnit(record.baseUnit || getBaseUnitForPriceUnit(unit));

  if (!key || !name || price === null || !UNIT_CONVERSIONS[unit]) {
    return null;
  }

  const costPerBaseUnit = getCostPerBaseUnit({
    price,
    unit,
    baseUnit,
    costPerBaseUnit: record.costPerBaseUnit ?? record.costPerBaseUnitExVAT ?? record.pricePerBaseUnit,
  });
  const pricingStatus = String(record.pricingStatus || '').trim()
    || (price > 0 || costPerBaseUnit > 0 ? 'priced' : 'needs_price');

  return {
    key,
    ingredientId,
    name,
    canonicalName: String(record.canonicalName || name).trim(),
    aliases: Array.isArray(record.aliases) ? record.aliases.map((alias) => String(alias || '').trim()).filter(Boolean) : [],
    category: String(record.category || 'Other').trim() || 'Other',
    price: roundCurrency(price),
    unit,
    baseUnit,
    costPerBaseUnit,
    updatedAt: String(record.updatedAt || ''),
    source: String(record.source || 'manual').trim() || 'manual',
    sourceInvoiceId: String(record.sourceInvoiceId || '').trim(),
    supplier: String(record.supplier || '').trim(),
    lastInvoiceDate: String(record.lastInvoiceDate || '').trim(),
    invoiceQuantity: Number(record.invoiceQuantity) || null,
    invoiceUnit: String(record.invoiceUnit || '').trim(),
    invoiceLinePriceExVAT: parsePrice(record.invoiceLinePriceExVAT ?? record.linePriceExVAT ?? record.priceExVAT),
    pricingStatus,
    linkedRecipeKeys: Array.isArray(record.linkedRecipeKeys)
      ? [...new Set(record.linkedRecipeKeys.map((value) => String(value || '').trim()).filter(Boolean))]
      : [],
    linkedRecipeNames: Array.isArray(record.linkedRecipeNames)
      ? [...new Set(record.linkedRecipeNames.map((value) => String(value || '').trim()).filter(Boolean))]
      : [],
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
  const directKey = String(itemName || '').trim();
  const normalizedKey = createItemPriceKey(itemName);

  if (cleanCatalog[directKey]) return cleanCatalog[directKey];
  if (cleanCatalog[normalizedKey]) return cleanCatalog[normalizedKey];

  return Object.values(cleanCatalog).find((record) => {
    if (!record) return false;
    const recordKeys = [
      record.key,
      record.ingredientId,
      record.id,
      record.name,
      record.canonicalName,
      ...(Array.isArray(record.aliases) ? record.aliases : []),
    ].map(createItemPriceKey).filter(Boolean);

    return recordKeys.includes(normalizedKey);
  }) || null;
};

export const linkRecipeIngredientsToCatalog = ({
  ingredients,
  itemPriceCatalog,
  recipeKey = '',
  recipeName = '',
  source = 'recipe-make-line',
}) => {
  const safeCatalog = sanitizeItemPriceCatalog(itemPriceCatalog);
  const nextCatalog = { ...safeCatalog };
  const createdRecords = [];
  const safeRecipeKey = String(recipeKey || '').trim();
  const safeRecipeName = String(recipeName || '').trim();

  const linkedIngredients = (Array.isArray(ingredients) ? ingredients : [])
    .map((ingredient) => {
      const normalizedIngredient = normalizeRecipeIngredient(ingredient, ingredient?.category || 'Other');
      const name = String(normalizedIngredient.name || '').trim();

      if (!name) {
        return null;
      }

      const requestedId = String(
        normalizedIngredient.ingredientId
        || normalizedIngredient.priceCatalogKey
        || ''
      ).trim();
      let catalogRecord = findItemPriceRecord(nextCatalog, requestedId)
        || findItemPriceRecord(nextCatalog, name);

      if (!catalogRecord) {
        const key = requestedId || createItemPriceKey(name);
        const requestedUnit = normalizeItemPriceUnit(normalizedIngredient.unit || 'each');
        const unit = UNIT_CONVERSIONS[requestedUnit] ? requestedUnit : 'each';

        catalogRecord = sanitizeItemPriceRecord({
          key,
          ingredientId: key,
          name,
          category: normalizedIngredient.category || 'Other',
          price: 0,
          unit,
          baseUnit: getBaseUnitForPriceUnit(unit),
          costPerBaseUnit: 0,
          pricingStatus: 'needs_price',
          source,
          updatedAt: new Date().toISOString(),
          linkedRecipeKeys: safeRecipeKey ? [safeRecipeKey] : [],
          linkedRecipeNames: safeRecipeName ? [safeRecipeName] : [],
        });

        if (catalogRecord) {
          nextCatalog[catalogRecord.key] = catalogRecord;
          createdRecords.push(catalogRecord);
        }
      }

      if (!catalogRecord) {
        return normalizedIngredient;
      }

      return {
        ...normalizedIngredient,
        ingredientId: catalogRecord.ingredientId || catalogRecord.key,
        priceCatalogKey: catalogRecord.key,
      };
    })
    .filter(Boolean);

  return {
    ingredients: linkedIngredients,
    itemPriceCatalog: nextCatalog,
    createdRecords,
  };
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

  if (cleanRecord.pricingStatus === 'needs_price' || (cleanRecord.price <= 0 && cleanRecord.costPerBaseUnit <= 0)) {
    return { canCalculate: false, cost: 0, quantityInPriceUnit: 0 };
  }

  const sourceQuantity = unit === 'portion' && Number(measuredQuantity) > 0
    ? Number(measuredQuantity)
    : Number(quantity);
  const sourceUnit = unit === 'portion' && measuredUnit
    ? normalizeItemPriceUnit(measuredUnit)
    : normalizeItemPriceUnit(unit);
  const sourceMeta = UNIT_CONVERSIONS[sourceUnit];
  const priceMeta = UNIT_CONVERSIONS[cleanRecord.unit];
  const baseMeta = UNIT_CONVERSIONS[cleanRecord.baseUnit];

  if (!Number.isFinite(sourceQuantity) || sourceQuantity <= 0 || !sourceMeta || !priceMeta || !baseMeta || sourceMeta.family !== priceMeta.family || sourceMeta.family !== baseMeta.family) {
    return { canCalculate: false, cost: 0, quantityInPriceUnit: 0 };
  }

  const quantityInPriceUnit = (sourceQuantity * sourceMeta.factor) / priceMeta.factor;
  const quantityInBaseUnit = (sourceQuantity * sourceMeta.factor) / baseMeta.factor;

  return {
    canCalculate: true,
    cost: roundCurrency(quantityInBaseUnit * cleanRecord.costPerBaseUnit),
    quantityInPriceUnit,
    quantityInBaseUnit,
  };
};

export const createItemPriceCatalogFromInvoice = ({
  lineItems,
  ingredientRows,
  invoiceId = '',
  supplierName = '',
  invoiceDate = '',
}) => {
  const rows = Array.isArray(ingredientRows) ? ingredientRows : [];
  const items = Array.isArray(lineItems) ? lineItems : [];

  return rows.reduce((catalog, row) => {
    const lineItem = items.find((item) => item.id === row?.lineItemId);
    const name = String(row?.ingredientName || row?.canonicalName || lineItem?.itemName || '').trim();
    const unit = normalizeItemPriceUnit(row?.priceUnit || lineItem?.unit || row?.unit || 'each');
    const invoiceQuantity = Number(row?.invoiceQuantity ?? lineItem?.quantity ?? 1);
    const linePriceExVAT = Number(row?.totalPrice ?? row?.priceExVAT ?? lineItem?.priceExVAT ?? lineItem?.lineTotal ?? 0);
    const unitPrice = Number(row?.unitPriceExVAT ?? lineItem?.unitPriceExVAT ?? lineItem?.unitPrice ?? (invoiceQuantity > 0 ? linePriceExVAT / invoiceQuantity : 0));
    const baseUnit = normalizeItemPriceUnit(row?.baseUnit || lineItem?.baseUnit || getBaseUnitForPriceUnit(unit));
    const costPerBaseUnit = getCostPerBaseUnit({
      price: unitPrice,
      unit,
      baseUnit,
      costPerBaseUnit: row?.costPerBaseUnit ?? row?.costPerBaseUnitExVAT ?? lineItem?.costPerBaseUnitExVAT,
    });
    const key = String(row?.ingredientId || row?.matchedIngredientId || '').trim() || createItemPriceKey(name);

    if (!name || !key || !UNIT_CONVERSIONS[unit] || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      return catalog;
    }

    const record = sanitizeItemPriceRecord({
      key,
      ingredientId: key,
      name,
      canonicalName: row?.canonicalName || name,
      aliases: row?.aliases,
      category: row?.category || 'Other',
      price: unitPrice,
      unit,
      baseUnit,
      costPerBaseUnit,
      source: 'invoice',
      sourceInvoiceId: invoiceId,
      supplier: supplierName,
      lastInvoiceDate: invoiceDate,
      invoiceQuantity,
      invoiceUnit: row?.invoiceUnit || lineItem?.unit || unit,
      invoiceLinePriceExVAT: linePriceExVAT,
      updatedAt: new Date().toISOString(),
    });

    if (record) {
      catalog[record.key] = record;
    }

    return catalog;
  }, {});
};

export const calculateRecipeIngredientCost = ({ ingredient, itemPriceCatalog, multiplier = 1 }) => {
  const safeMultiplier = Number(multiplier);
  const parsedIngredient = parseRecipeIngredientText(ingredient);
  const record = findItemPriceRecord(itemPriceCatalog, ingredient?.ingredientId)
    || findItemPriceRecord(itemPriceCatalog, ingredient?.priceCatalogKey)
    || findItemPriceRecord(itemPriceCatalog, parsedIngredient.name)
    || findItemPriceRecord(itemPriceCatalog, ingredient?.name);
  const parsedQuantity = parsedIngredient.quantityValue !== null && parsedIngredient.unit
    ? { quantity: parsedIngredient.quantityValue, unit: parsedIngredient.unit }
    : parseIngredientQuantity(ingredient?.quantity);

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
        ingredientId: record.ingredientId || record.key,
        priceCatalogKey: record.key,
        pricePerUnit: record.price,
        priceUnit: record.unit,
        costPerBaseUnit: record.costPerBaseUnit,
        baseUnit: record.baseUnit,
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
    costPerBaseUnit: null,
    baseUnit: '',
  };
};
