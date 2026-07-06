import { createInvoiceKey, roundMoney } from './invoiceParsing.js';
import { calculateRecipeIngredientCost, createItemPriceKey } from './itemPriceCatalog.js';
import { getEntryFoodCostLost } from './wasteCalculations.js';
import { createMasterIngredientId, normalizeMasterIngredientRecord } from './masterIngredients.js';

export const SIGNIFICANT_PRICE_CHANGE_PERCENT = 10;

const toSafeString = (value) => String(value ?? '').trim();

export const createIngredientId = (name) => createMasterIngredientId(name) || createInvoiceKey(name);

export const normalizeIngredientRecord = (ingredient = {}) => {
  const masterIngredient = normalizeMasterIngredientRecord(ingredient);
  const name = toSafeString(masterIngredient?.name || ingredient.name || ingredient.ingredientName);
  const id = toSafeString(masterIngredient?.id || ingredient.id) || createIngredientId(name);
  const latestCost = roundMoney(ingredient.latestCost ?? ingredient.currentPrice ?? ingredient.lastPriceExVAT ?? ingredient.priceExVAT);
  const latestCostPerBaseUnit = Number(masterIngredient?.latestCostPerBaseUnit || 0);
  const costUnit = toSafeString(ingredient.costUnit || ingredient.lastUnit || ingredient.unit || ingredient.defaultUnit) || 'each';
  const defaultUnit = toSafeString(ingredient.defaultUnit || ingredient.unit || ingredient.lastUnit || masterIngredient?.baseUnit || ingredient.baseUnit) || costUnit;
  const supplier = toSafeString(ingredient.supplier || ingredient.source || ingredient.preferredSupplier || ingredient.supplierName);
  const active = ingredient.active !== false && !ingredient.isDeleted && !ingredient.deletedAt;

  if (!name || !id) {
    return null;
  }

  return {
    ...ingredient,
    ...masterIngredient,
    id,
    name,
    canonicalName: masterIngredient?.canonicalName || name,
    aliases: masterIngredient?.aliases || [],
    latestCostPerBaseUnit,
    lastInvoicePrice: masterIngredient?.lastInvoicePrice || latestCost,
    lastPurchaseQuantity: masterIngredient?.lastPurchaseQuantity || Number(ingredient.baseQuantity || ingredient.lastQuantity || 0),
    lastPurchaseUnit: masterIngredient?.lastPurchaseUnit || toSafeString(ingredient.baseUnit || ingredient.lastUnit || ingredient.unit),
    category: toSafeString(ingredient.category) || 'Other',
    defaultUnit,
    latestCost,
    costUnit,
    supplier,
    source: supplier,
    active,
    notes: toSafeString(ingredient.notes),
    createdAt: toSafeString(ingredient.createdAt),
    updatedAt: toSafeString(ingredient.updatedAt),
  };
};

export const findDuplicateIngredient = (ingredients, draft) => {
  const draftName = toSafeString(draft?.name);
  const draftId = toSafeString(draft?.id);
  const draftKey = createIngredientId(draftName);

  return (Array.isArray(ingredients) ? ingredients : [])
    .map(normalizeIngredientRecord)
    .filter(Boolean)
    .find((ingredient) => (
      ingredient.id !== draftId
      && (
        createIngredientId(ingredient.name) === draftKey
        || ingredient.name.toLowerCase() === draftName.toLowerCase()
      )
    )) || null;
};

export const getLatestPriceChange = (ingredient) => {
  const history = (Array.isArray(ingredient?.priceHistory) ? ingredient.priceHistory : [])
    .filter((entry) => Number(entry?.costPerBaseUnit ?? entry?.costPerBaseUnitExVAT ?? entry?.priceExVAT ?? entry?.price) > 0)
    .sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0));
  const latest = history[history.length - 1];
  const previous = history[history.length - 2];
  const latestCost = Number(latest?.costPerBaseUnit ?? latest?.costPerBaseUnitExVAT ?? latest?.priceExVAT ?? latest?.price ?? ingredient?.latestCostPerBaseUnit ?? ingredient?.latestCost ?? ingredient?.lastPriceExVAT ?? 0);
  const previousCost = Number(previous?.costPerBaseUnit ?? previous?.costPerBaseUnitExVAT ?? previous?.priceExVAT ?? previous?.price ?? 0);

  if (!latest || !previous || previousCost <= 0 || latestCost <= 0) {
    return {
      previousCost: 0,
      latestCost: roundMoney(latestCost),
      changeAmount: 0,
      changePercent: 0,
      direction: 'new',
      significant: false,
    };
  }

  const changeAmount = roundMoney(latestCost - previousCost);
  const changePercent = roundMoney((changeAmount / previousCost) * 100);

  return {
    previousCost: roundMoney(previousCost),
    latestCost: roundMoney(latestCost),
    changeAmount,
    changePercent,
    direction: changeAmount > 0 ? 'up' : changeAmount < 0 ? 'down' : 'flat',
    significant: Math.abs(changePercent) >= SIGNIFICANT_PRICE_CHANGE_PERCENT,
  };
};

export const createRecipeCostSummary = (recipe, itemPriceCatalog = {}) => {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  const rows = ingredients.map((ingredient) => {
    const calculated = calculateRecipeIngredientCost({ ingredient, itemPriceCatalog });
    const cost = roundMoney(calculated.cost);

    return {
      name: toSafeString(ingredient?.name),
      cost,
      source: calculated.source,
      missingCost: cost <= 0,
      priceCatalogKey: calculated.priceCatalogKey || createItemPriceKey(ingredient?.name),
    };
  });
  const totalFoodCost = roundMoney(rows.reduce((sum, row) => sum + row.cost, 0));
  const sellingPrice = Number(recipe?.menuPrice);
  const hasSellingPrice = Number.isFinite(sellingPrice) && sellingPrice > 0;

  return {
    totalFoodCost,
    sellingPrice: hasSellingPrice ? roundMoney(sellingPrice) : 0,
    grossProfit: hasSellingPrice ? roundMoney(sellingPrice - totalFoodCost) : 0,
    foodCostPercentage: hasSellingPrice ? roundMoney((totalFoodCost / sellingPrice) * 100) : null,
    missingIngredients: rows.filter((row) => row.missingCost),
    rows,
  };
};

export const buildCostReviewQueue = ({
  wasteItems = [],
  ingredients = [],
  recipes = {},
  invoiceLines = [],
  itemPriceCatalog = {},
}) => {
  const queue = [];

  (Array.isArray(wasteItems) ? wasteItems : [])
    .filter((entry) => ['needs_item_price', 'needs_ingredient_costs'].includes(String(entry?.costStatus || '')))
    .forEach((entry) => {
      queue.push({
        id: `waste_${entry.id}`,
        type: 'waste',
        label: entry.name || 'Waste entry',
        detail: entry.costStatus === 'needs_item_price' ? 'Missing ingredient price' : 'Missing recipe ingredient costs',
        severity: 'high',
        amount: getEntryFoodCostLost(entry),
      });
    });

  (Array.isArray(ingredients) ? ingredients : [])
    .map(normalizeIngredientRecord)
    .filter(Boolean)
    .filter((ingredient) => ingredient.active && Number(ingredient.latestCostPerBaseUnit || ingredient.latestCost || 0) <= 0)
    .forEach((ingredient) => {
      queue.push({
        id: `ingredient_${ingredient.id}`,
        type: 'ingredient',
        label: ingredient.name,
        detail: 'Ingredient has no latest cost',
        severity: 'medium',
      });
    });

  Object.entries(recipes || {}).forEach(([key, recipe]) => {
    const summary = createRecipeCostSummary(recipe, itemPriceCatalog);

    if (summary.missingIngredients.length > 0) {
      queue.push({
        id: `recipe_${key}`,
        type: 'recipe',
        label: recipe?.name || key,
        detail: `${summary.missingIngredients.length} component${summary.missingIngredients.length === 1 ? '' : 's'} missing cost`,
        severity: 'medium',
      });
    }
  });

  (Array.isArray(invoiceLines) ? invoiceLines : [])
    .filter((line) => Number(line?.confidence || 1) < 0.7 || line?.warning || line?.warnings?.length)
    .forEach((line) => {
      queue.push({
        id: `invoice_${line.id || line.itemName}`,
        type: 'invoice',
        label: line.itemName || line.name || 'Invoice line',
        detail: 'Low-confidence invoice line needs review',
        severity: 'medium',
      });
    });

  (Array.isArray(ingredients) ? ingredients : [])
    .map(normalizeIngredientRecord)
    .filter(Boolean)
    .map((ingredient) => ({ ingredient, change: getLatestPriceChange(ingredient) }))
    .filter(({ change }) => change.significant && change.direction === 'up')
    .forEach(({ ingredient, change }) => {
      queue.push({
        id: `price_${ingredient.id}`,
        type: 'price',
        label: ingredient.name,
        detail: `Price increased ${change.changePercent.toFixed(1)}%`,
        severity: 'high',
      });
    });

  return queue;
};
