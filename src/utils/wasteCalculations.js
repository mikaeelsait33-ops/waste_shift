import { calculateRecipeIngredientCost } from './itemPriceCatalog.js';

export const WASTE_REASONS = [
  'Dropped',
  'Burnt',
  'Expired',
  'Spoiled',
  'Customer returned',
  'Wrong order',
  'Overproduction',
  'Damaged delivery',
  'Supplier issue',
  'Prep mistake',
  'Portion error',
  'Quality issue',
  'Staff meal',
  'Other',
];

export const WASTE_CATEGORY_OPTIONS = [
  { value: 'Produce', label: 'Produce' },
  { value: 'Dairy', label: 'Dairy & Eggs' },
  { value: 'Bakery', label: 'Bakery & Grains' },
  { value: 'Meat/Poultry', label: 'Meat & Poultry' },
  { value: 'Pantry', label: 'Pantry Goods' },
  { value: 'Coffee/Tea', label: 'Coffee & Tea' },
  { value: 'Drinks', label: 'Drinks' },
  { value: 'Other', label: 'Other' },
];

export const DEFAULT_WASTE_CLASSIFICATION = 'actual_food';

export const WASTE_CLASSIFICATION_OPTIONS = [
  {
    value: DEFAULT_WASTE_CLASSIFICATION,
    label: 'Actual food wastage',
    shortLabel: 'Food wastage',
  },
  {
    value: 'operational',
    label: 'Operational waste',
    shortLabel: 'Operational',
  },
];

export const getWasteClassificationMeta = (classification) => (
  WASTE_CLASSIFICATION_OPTIONS.find((option) => option.value === classification)
  || WASTE_CLASSIFICATION_OPTIONS[0]
);

export const PREVENTABLE_REASONS = new Set([
  'Burnt',
  'Expired',
  'Spoiled',
  'Wrong order',
  'Overproduction',
  'Prep mistake',
  'Portion error',
  'Quality issue',
  'Passed Expiration Date',
  'Spoiled/Overripe',
  'Kitchen Prep Mistake',
]);

export const roundCurrency = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue * 100) / 100 : 0;
};

export const parsePositiveNumber = (value) => {
  const numericValue = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

export const getRecipeIngredientTotal = (ingredients, itemPriceCatalog = {}) => (
  roundCurrency(
    (Array.isArray(ingredients) ? ingredients : [])
      .reduce((sum, ingredient) => (
        sum + calculateRecipeIngredientCost({ ingredient, itemPriceCatalog }).cost
      ), 0)
  )
);

export const getMenuSellingPrice = (menuItem, recipe) => {
  const explicitPrice = menuItem?.menuPrice ?? menuItem?.price ?? recipe?.menuPrice;
  const parsedPrice = Number(explicitPrice);

  return Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : 0;
};

const formatScaledNumber = (value) => {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

export const scaleQuantityLabel = (quantityLabel, multiplier) => {
  const text = String(quantityLabel || '').trim();
  const safeMultiplier = Number(multiplier);

  if (!text || !Number.isFinite(safeMultiplier) || safeMultiplier <= 0) {
    return text;
  }

  if (safeMultiplier === 1) {
    return text;
  }

  const mixedFractionMatch = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)(.*)$/);
  if (mixedFractionMatch) {
    const [, whole, numerator, denominator, suffix] = mixedFractionMatch;
    const denominatorValue = Number(denominator);
    const numericValue = denominatorValue > 0
      ? Number(whole) + (Number(numerator) / denominatorValue)
      : Number.NaN;

    if (Number.isFinite(numericValue)) {
      return `${formatScaledNumber(numericValue * safeMultiplier)}${suffix}`;
    }
  }

  const fractionMatch = text.match(/^(\d+)\s*\/\s*(\d+)(.*)$/);
  if (fractionMatch) {
    const [, numerator, denominator, suffix] = fractionMatch;
    const denominatorValue = Number(denominator);
    const numericValue = denominatorValue > 0 ? Number(numerator) / denominatorValue : Number.NaN;

    if (Number.isFinite(numericValue)) {
      return `${formatScaledNumber(numericValue * safeMultiplier)}${suffix}`;
    }
  }

  const numericMatch = text.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (numericMatch) {
    const [, amount, suffix] = numericMatch;
    const numericValue = Number(amount);

    if (Number.isFinite(numericValue)) {
      return `${formatScaledNumber(numericValue * safeMultiplier)}${suffix}`;
    }
  }

  return `${text} x ${formatScaledNumber(safeMultiplier)}`;
};

export const buildRecipeIngredientBreakdown = (recipe, quantity, itemPriceCatalog = {}) => {
  const multiplier = parsePositiveNumber(quantity) || 1;
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];

  return ingredients.map((ingredient) => {
    const resolvedCost = calculateRecipeIngredientCost({ ingredient, itemPriceCatalog, multiplier });

    return {
      ...ingredient,
      baseQuantity: ingredient?.quantity || '',
      baseCost: resolvedCost.baseCost,
      quantity: scaleQuantityLabel(ingredient?.quantity, multiplier),
      cost: resolvedCost.cost,
      costSource: resolvedCost.source,
      priceCatalogKey: resolvedCost.priceCatalogKey,
      pricePerUnit: resolvedCost.pricePerUnit,
      priceUnit: resolvedCost.priceUnit,
    };
  });
};

export const calculateMenuWasteFinancials = ({ recipe, menuItem, quantity, itemPriceCatalog = {} }) => {
  const itemCount = parsePositiveNumber(quantity);
  const ingredientCostPerItem = getRecipeIngredientTotal(recipe?.ingredients, itemPriceCatalog);
  const sellingPrice = getMenuSellingPrice(menuItem, recipe);
  const foodCostLost = roundCurrency(ingredientCostPerItem * itemCount);
  const potentialRevenueLost = roundCurrency(sellingPrice * itemCount);
  const hasIngredientCosts = ingredientCostPerItem > 0;
  const grossProfitLost = hasIngredientCosts
    ? roundCurrency(potentialRevenueLost - foodCostLost)
    : 0;
  const foodCostPercentage = hasIngredientCosts && sellingPrice > 0
    ? roundCurrency((ingredientCostPerItem / sellingPrice) * 100)
    : null;

  return {
    itemCount,
    ingredientCostPerItem,
    sellingPrice,
    foodCostLost,
    potentialRevenueLost,
    grossProfitLost,
    foodCostPercentage,
    costStatus: hasIngredientCosts ? 'calculated' : 'needs_ingredient_costs',
    ingredients: buildRecipeIngredientBreakdown(recipe, itemCount, itemPriceCatalog),
  };
};

export const getEntryFoodCostLost = (entry) => (
  roundCurrency(entry?.foodCostLost ?? entry?.cost)
);

export const getEntryPotentialRevenueLost = (entry) => (
  roundCurrency(entry?.potentialRevenueLost ?? (entry?.isRecipe ? entry?.cost : 0))
);

export const getEntryGrossProfitLost = (entry) => (
  roundCurrency(entry?.grossProfitLost ?? 0)
);

export const createInventoryMovementsFromEntry = (entry) => {
  if (!entry?.id) {
    return [];
  }

  const commonFields = {
    wasteEntryId: entry.id,
    date: entry.date,
    time: entry.time || '',
    staff: entry.staff || '',
    reason: 'Waste logged',
    createdAt: entry.createdAt || new Date().toISOString(),
  };

  if (entry.isRecipe && Array.isArray(entry.ingredients)) {
    return entry.ingredients.map((ingredient, index) => ({
      id: `${entry.id}-ingredient-${index}`,
      ...commonFields,
      ingredientName: ingredient?.name || 'Unknown ingredient',
      changeLabel: ingredient?.quantity || '',
      changeAmount: null,
      unit: '',
      costImpact: roundCurrency(ingredient?.cost),
    }));
  }

  return [{
    id: `${entry.id}-single`,
    ...commonFields,
    ingredientName: entry.name || 'Unknown item',
    changeLabel: `${entry.measuredQuantity || entry.quantity || ''} ${entry.measuredUnit || entry.unit || ''}`.trim(),
    changeAmount: Number.isFinite(Number(entry.measuredQuantity))
      ? -Math.abs(Number(entry.measuredQuantity))
      : null,
    unit: entry.measuredUnit || entry.unit || '',
    costImpact: getEntryFoodCostLost(entry),
  }];
};
