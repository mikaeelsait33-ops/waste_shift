import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeGeminiMenuPayload } from '../api/gemini-menu.js';
import {
  buildMenuImportSaveItems,
  createMenuRecipeReview,
  getSmartMenuImportPlan,
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

const reviewPlan = getSmartMenuImportPlan(review);
assert.equal(reviewPlan.readyDishes.length, 0);
assert.equal(reviewPlan.reviewOnlyDishes.length, 1);

const smartReadyPlan = getSmartMenuImportPlan(createMenuRecipeReview([{
  name: 'Rocket Salad',
  category: 'Lunch',
  confidence: 0.9,
  ingredients: [
    { name: 'Rocket', quantity: 30, unit: 'g' },
    { name: 'New Dressing', quantity: 20, unit: 'ml' },
  ],
}], catalog));
assert.equal(smartReadyPlan.readyDishes.length, 1);
assert.equal(smartReadyPlan.reviewOnlyDishes.length, 0);
assert.equal(smartReadyPlan.unmatchedIngredients.length, 1);
assert.equal(smartReadyPlan.unmatchedIngredients[0].name, 'New Dressing');
assert.equal(smartReadyPlan.unmatchedIngredients[0].price, 0);

const recipeManagerSource = await readFile(new URL('../src/components/RecipeManager.jsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const firestoreMenuSource = await readFile(new URL('../src/services/firestoreMenuItems.js', import.meta.url), 'utf8');

assert.match(recipeManagerSource, /Save the basic item first/);
assert.match(recipeManagerSource, /Bulk add menu items/);
assert.match(recipeManagerSource, /Duplicate/);
assert.match(recipeManagerSource, /field-grid field-grid--three/);
assert.match(recipeManagerSource, /Add recipe costs/);
assert.match(recipeManagerSource, /onSaveMenuItem\?\.\(\{/);
assert.match(recipeManagerSource, /onCreateCatalogItems/);
assert.match(appSource, /category: normalizedCategory/);
assert.match(appSource, /handleCreateCatalogItems/);
assert.match(appSource, /saveFirestoreMenuItem\(\{/);
assert.match(firestoreMenuSource, /category: toSafeString\(category\)/);

console.log('Menu recipe import tests passed');
