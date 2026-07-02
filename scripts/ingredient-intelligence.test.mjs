import assert from 'node:assert/strict';
import {
  buildCostReviewQueue,
  createRecipeCostSummary,
  findDuplicateIngredient,
  getLatestPriceChange,
  normalizeIngredientRecord,
} from '../src/utils/ingredientIntelligence.js';
import { sanitizeItemPriceCatalog } from '../src/utils/itemPriceCatalog.js';

const normalized = normalizeIngredientRecord({
  name: 'Tomatoes',
  currentPrice: 29.9,
  unit: 'kg',
  preferredSupplier: 'Raw Naturally',
});

assert.equal(normalized.id, 'tomato');
assert.equal(normalized.latestCost, 29.9);
assert.equal(normalized.defaultUnit, 'kg');
assert.equal(normalized.supplier, 'Raw Naturally');
assert.equal(normalized.active, true);

const duplicate = findDuplicateIngredient([
  { id: 'tomatoes', name: 'Tomatoes' },
  { id: 'milk', name: 'Milk' },
], { id: 'tomatoes_2', name: ' tomatoes ' });

assert.equal(duplicate.id, 'tomatoes');

const priceChange = getLatestPriceChange({
  name: 'Salmon',
  priceHistory: [
    { date: '2026-06-01', priceExVAT: 100 },
    { date: '2026-07-01', priceExVAT: 125 },
  ],
});

assert.equal(priceChange.previousCost, 100);
assert.equal(priceChange.latestCost, 125);
assert.equal(priceChange.changePercent, 25);
assert.equal(priceChange.direction, 'up');
assert.equal(priceChange.significant, true);

const itemPriceCatalog = sanitizeItemPriceCatalog({
  tomatoes: { name: 'Tomatoes', price: 30, unit: 'kg' },
});

const recipeSummary = createRecipeCostSummary({
  name: 'Tomato Toast',
  menuPrice: 95,
  ingredients: [
    { name: 'Tomatoes', quantity: '500g' },
    { name: 'Bread', quantity: '2', cost: 8 },
    { name: 'Basil', quantity: '5g' },
  ],
}, itemPriceCatalog);

assert.equal(recipeSummary.totalFoodCost, 23);
assert.equal(recipeSummary.grossProfit, 72);
assert.equal(recipeSummary.foodCostPercentage, 24.21);
assert.deepEqual(recipeSummary.missingIngredients.map((ingredient) => ingredient.name), ['Basil']);

const reviewQueue = buildCostReviewQueue({
  wasteItems: [
    { id: 'entry-1', name: 'Unknown waste', costStatus: 'needs_item_price', foodCostLost: 0 },
  ],
  ingredients: [
    { id: 'basil', name: 'Basil', latestCost: 0 },
    {
      id: 'salmon',
      name: 'Salmon',
      latestCost: 125,
      priceHistory: [
        { date: '2026-06-01', priceExVAT: 100 },
        { date: '2026-07-01', priceExVAT: 125 },
      ],
    },
  ],
  recipes: {
    toast: {
      name: 'Tomato Toast',
      ingredients: [{ name: 'Basil', quantity: '5g' }],
    },
  },
  invoiceLines: [
    { id: 'line-1', itemName: 'Mystery item', confidence: 0.4 },
  ],
  itemPriceCatalog,
});

assert.deepEqual(
  reviewQueue.map((item) => item.type).sort(),
  ['ingredient', 'invoice', 'price', 'recipe', 'waste']
);

console.log('Ingredient intelligence tests passed');
