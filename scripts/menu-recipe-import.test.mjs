import assert from 'node:assert/strict';
import { normalizeGeminiMenuPayload } from '../api/gemini-menu.js';
import {
  buildMenuImportSaveItems,
  createMenuRecipeReview,
} from '../src/utils/menuRecipeImport.js';

const catalog = {
  rocket: {
    key: 'rocket',
    ingredientId: 'rocket',
    name: 'Rocket',
    category: 'Produce',
    price: 117.9,
    unit: 'kg',
    baseUnit: 'g',
    costPerBaseUnit: 0.1179,
  },
  hollandaise: {
    key: 'hollandaise',
    ingredientId: 'hollandaise',
    name: 'Hollandaise',
    category: 'Sauces',
    price: 45,
    unit: 'l',
    baseUnit: 'ml',
    costPerBaseUnit: 0.045,
  },
};

const normalized = normalizeGeminiMenuPayload({
  dishes: [{
    name: 'Eggs Benedict',
    category: 'Breakfast',
    ingredients: [
      { name: 'Rocket', quantity: 10, unit: 'g' },
      { name: 'Hollandaise', quantity: 20, unit: 'each' },
    ],
    instructions: 'Toast and plate.',
    confidence: 0.91,
  }],
});

assert.equal(normalized.dishes.length, 1);
assert.equal(normalized.items[0].components[0].name, 'Rocket');

const review = createMenuRecipeReview(normalized.dishes, catalog);
assert.equal(review[0].ingredients[0].catalogKey, 'rocket');
assert.equal(review[0].ingredients[0].unitMismatch, false);
assert.equal(review[0].ingredients[1].catalogKey, 'hollandaise');
assert.equal(review[0].ingredients[1].unitMismatch, true);

const saveItems = buildMenuImportSaveItems(review, catalog);
assert.equal(saveItems[0].ingredients[0].ingredientId, 'rocket');
assert.equal(saveItems[0].ingredients[0].priceCatalogKey, 'rocket');
assert.equal(saveItems[0].ingredients[0].cost, 1.18);

console.log('Menu recipe import tests passed');
