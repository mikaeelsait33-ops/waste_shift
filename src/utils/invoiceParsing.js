const DEFAULT_VAT_RATE = 0.15;
const UNIT_PATTERN = '(kg|kgs|kilogram|kilograms|g|gram|grams|l|lt|liter|litre|liters|litres|ml|each|ea|unit|units|case|cases|doz|dozen|pkt|packet|pack|box|bag)';
const UNIT_REGEX = new RegExp(`\\b${UNIT_PATTERN}\\b`, 'i');
const MONEY_REGEX = /(?:R|ZAR)?\s*-?\d+(?:[,\s]\d{3})*(?:\.\d{1,2})?/gi;
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

export const parseMoney = (value) => {
  const cleaned = String(value ?? '')
    .replace(/zar/gi, '')
    .replace(/r/gi, '')
    .replace(/\s+/g, '')
    .replace(/,/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const roundMoney = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue * 100) / 100 : 0;
};

export const normalizeInvoiceUnit = (unit) => {
  const value = String(unit || '').trim().toLowerCase();

  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(value)) return 'kg';
  if (['g', 'gram', 'grams'].includes(value)) return 'g';
  if (['l', 'lt', 'liter', 'litre', 'liters', 'litres'].includes(value)) return 'L';
  if (value === 'ml') return 'ml';
  if (['ea', 'each', 'unit', 'units'].includes(value)) return 'each';
  if (['case', 'cases'].includes(value)) return 'case';
  if (['doz', 'dozen'].includes(value)) return 'doz';
  if (['pkt', 'packet', 'pack'].includes(value)) return 'pkt';
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
  return { quantity: safeQuantity, unit: normalizedUnit === 'case' || normalizedUnit === 'pkt' ? normalizedUnit : 'each' };
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

const removeMoneyValues = (line) => line.replace(MONEY_REGEX, ' ').replace(/\s+/g, ' ').trim();

const createLineItemFromLine = ({ line, index, vatMode, vatRate }) => {
  const matches = [...line.matchAll(MONEY_REGEX)]
    .map((match) => ({
      value: parseMoney(match[0]),
      index: match.index || 0,
      raw: match[0],
    }))
    .filter((match) => match.value !== null);

  if (matches.length === 0 || /\b(subtotal|balance|amount due|grand total|total due|vat total)\b/i.test(line)) {
    return null;
  }

  const lineTotal = matches[matches.length - 1].value;
  const unitPrice = matches.length >= 2 ? matches[matches.length - 2].value : lineTotal;
  const textBeforeFirstPrice = line.slice(0, matches[0].index).trim();
  const unitMatch = textBeforeFirstPrice.match(new RegExp(`(?:^|\\s)(\\d+(?:[.,]\\d+)?)\\s*${UNIT_PATTERN}\\b`, 'i'));
  const looseUnitMatch = textBeforeFirstPrice.match(UNIT_REGEX);
  const quantity = unitMatch ? Number.parseFloat(unitMatch[1].replace(',', '.')) : 1;
  const unit = normalizeInvoiceUnit(unitMatch?.[2] || looseUnitMatch?.[1] || 'each');
  let name = textBeforeFirstPrice;

  if (unitMatch) {
    name = textBeforeFirstPrice.slice(0, unitMatch.index).trim();
  } else if (looseUnitMatch) {
    name = textBeforeFirstPrice.slice(0, looseUnitMatch.index).trim();
  }

  name = removeMoneyValues(name)
    .replace(/^\d+[\s.-]*/, '')
    .replace(/\b(qty|quantity|item|code|sku)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name || name.length < 2 || /^\d+$/.test(name)) {
    return null;
  }

  const vat = calculateVatValues({ lineTotal, unitPrice, vatMode, vatRate });
  const base = getBaseUnitInfo(quantity, unit);
  const costPerBaseUnitExVAT = base.quantity > 0 ? roundMoney(vat.priceExVAT / base.quantity) : 0;

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
    confidence: matches.length >= 2 ? 0.82 : 0.62,
  };
};

export const parseInvoiceText = (text, { vatRate = DEFAULT_VAT_RATE } = {}) => {
  const rawText = String(text || '');
  const vatMode = detectVatMode(rawText);
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
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
