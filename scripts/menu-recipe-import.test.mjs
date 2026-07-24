import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import geminiMenuHandler, {
  createGeminiFileBatches,
  createGeminiGenerationConfig,
  createGeminiParts,
  mergeGeminiMenuPayloads,
  normalizeGeminiMenuPayload,
} from '../api/gemini-menu.js';
import {
  buildMenuImportSaveItems,
  createMenuRecipeReview,
  getSmartMenuImportPlan,
} from '../src/utils/menuRecipeImport.js';
import { createMakeLineGuideRequestBatches } from '../src/utils/makeLineGuideFiles.js';
import { mergeGeminiMenuImportPayloads } from '../src/utils/geminiMenuPayload.js';

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

const guideParts = createGeminiParts({
  text: 'Salmon Benedict R145',
  makeLineGuide: 'Salmon Benedict: 120g salmon, 35ml hollandaise.',
  guideFile: { mimeType: 'image/png', base64: 'aGVsbG8=' },
});
assert.equal(guideParts.length, 2);
assert.match(guideParts[0].text, /make-line guide is the source of truth/i);
assert.match(guideParts[0].text, /120g salmon/);

const multiPageGuideParts = createGeminiParts({
  files: [
    { mimeType: 'image/jpeg', base64: 'aGVsbG8=' },
    { mimeType: 'image/jpeg', base64: 'd29ybGQ=' },
  ],
});
assert.equal(multiPageGuideParts.length, 3);

const fivePageGuideFiles = Array.from({ length: 5 }, (_, index) => ({
  name: `page-${index + 1}.jpg`,
  mimeType: 'image/jpeg',
  base64: Buffer.from(`page-${index + 1}`).toString('base64'),
}));
const fivePageBatches = createGeminiFileBatches({ files: fivePageGuideFiles });
assert.deepEqual(fivePageBatches.map((batch) => batch.length), [2, 2, 1]);
assert.equal(createGeminiFileBatches({
  files: [
    { mimeType: 'application/pdf', base64: 'cGRm' },
    { mimeType: 'image/jpeg', base64: 'aW1hZ2U=' },
  ],
}).length, 1);

const fullGuideFiles = Array.from({ length: 11 }, (_, index) => ({
  name: `full-guide-page-${index + 1}.jpg`,
  mimeType: 'image/jpeg',
  base64: Buffer.from(`full-guide-page-${index + 1}`).toString('base64'),
}));
const fullGuideBatches = createMakeLineGuideRequestBatches(fullGuideFiles);
assert.deepEqual(fullGuideBatches.map((batch) => batch.length), [2, 2, 2, 2, 2, 1]);
assert.deepEqual(fullGuideBatches.flat().map((file) => file.name), fullGuideFiles.map((file) => file.name));

const clientMergedPayload = mergeGeminiMenuImportPayloads([
  { model: 'gemini-2.5-flash-lite', batchCount: 1, dishes: [{
    name: 'Full Guide Dish',
    category: 'Lunch',
    confidence: 0.72,
    ingredients: [{ name: 'Bun', quantity: null, unit: 'each' }],
  }] },
  { model: 'gemini-2.5-flash-lite', batchCount: 1, dishes: [{
    name: ' Full   Guide Dish ',
    confidence: 0.95,
    ingredients: [{ name: 'Bun', quantity: 1, unit: 'each' }, { name: 'Patty', quantity: 150, unit: 'g' }],
  }, {
    name: 'Second Full Guide Dish',
    category: 'Sides',
    confidence: 0.9,
    ingredients: [],
  }] },
]);
assert.equal(clientMergedPayload.requestBatchCount, 2);
assert.equal(clientMergedPayload.dishes.length, 2);
assert.equal(clientMergedPayload.dishes[0].ingredients.length, 2);
assert.equal(clientMergedPayload.dishes[0].confidence, 0.95);
assert.equal(clientMergedPayload.items.length, 2);

const generationConfig = createGeminiGenerationConfig('gemini-2.5-flash-lite');
assert.equal(generationConfig.thinkingConfig.thinkingBudget, 0);
assert.equal(generationConfig.maxOutputTokens, 8192);

const mergedPayload = mergeGeminiMenuPayloads([
  {
    dishes: [{
      name: 'Breakfast Burger',
      category: 'Breakfast',
      confidence: 0.7,
      ingredients: [{ name: 'Bun', quantity: 1, unit: 'each' }],
    }],
  },
  {
    dishes: [{
      name: '  Breakfast   Burger ',
      category: '',
      confidence: 0.92,
      ingredients: [
        { name: 'Bun', quantity: 1, unit: 'each' },
        { name: 'Egg', quantity: 2, unit: 'each' },
      ],
    }],
  },
]);
assert.equal(mergedPayload.dishes.length, 1);
assert.equal(mergedPayload.dishes[0].ingredients.length, 2);
assert.equal(mergedPayload.dishes[0].confidence, 0.92);

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
const appSource = [
  await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
  await readFile(new URL('../src/hooks/useInvoicePricing.js', import.meta.url), 'utf8'),
  await readFile(new URL('../src/hooks/useMenuRecipes.js', import.meta.url), 'utf8'),
].join('\n');
const firestoreMenuSource = await readFile(new URL('../src/services/firestoreMenuItems.js', import.meta.url), 'utf8');
const menuImportSource = await readFile(new URL('../src/components/MenuImport.jsx', import.meta.url), 'utf8');
const geminiMenuImportSource = await readFile(new URL('../src/services/geminiMenuImport.js', import.meta.url), 'utf8');

assert.match(recipeManagerSource, /make-line guide together/);
assert.match(recipeManagerSource, /Bulk add menu items/);
assert.match(recipeManagerSource, /Duplicate/);
assert.match(recipeManagerSource, /field-grid field-grid--three/);
assert.match(recipeManagerSource, /Add make-line guide/);
assert.match(recipeManagerSource, /onSaveMenuItem\?\.\(\{/);
assert.match(recipeManagerSource, /onCreateCatalogItems/);
assert.match(appSource, /category: normalizedCategory/);
assert.match(appSource, /handleCreateCatalogItems/);
assert.match(appSource, /linkRecipeIngredientsToCatalog/);
assert.match(appSource, /Make-line guide saved/);
assert.match(appSource, /saveFirestoreMenuItem\(\{/);
assert.match(firestoreMenuSource, /category: toSafeString\(category\)/);
assert.match(menuImportSource, /Upload make-line guide/);
assert.match(menuImportSource, /make-line-guide-file-gemini/);
assert.match(menuImportSource, /prepareMakeLineGuideFilePayloads/);
assert.match(menuImportSource, /fileBatches: preparedGuide\.fileBatches/);
assert.doesNotMatch(menuImportSource, /scan-document/);
assert.match(geminiMenuImportSource, /AbortController/);
assert.match(geminiMenuImportSource, /response\?\.status === 504/);
assert.match(geminiMenuImportSource, /response\?\.status === 413/);
assert.match(geminiMenuImportSource, /mergeGeminiMenuImportPayloads/);
assert.match(geminiMenuImportSource, /GEMINI_MAX_RETRIES/);
assert.match(geminiMenuImportSource, /retryAfterMs/);
assert.match(geminiMenuImportSource, /batches\.length > 4 \? 1/);

const originalFetch = global.fetch;
const originalApiKey = process.env.GEMINI_API_KEY;
const geminiRequests = [];

process.env.GEMINI_API_KEY = 'test-gemini-key';
global.fetch = async (url, options) => {
  const requestIndex = geminiRequests.length;
  const requestBody = JSON.parse(options.body);
  geminiRequests.push({ url: String(url), options, requestBody });

  const dishes = requestIndex < 2
    ? [{
        name: 'Batched Burger',
        category: 'Lunch',
        confidence: 0.8 + requestIndex * 0.1,
        ingredients: requestIndex === 0
          ? [{ name: 'Bun', quantity: 1, unit: 'each' }]
          : [{ name: 'Patty', quantity: 150, unit: 'g' }],
      }]
    : [{
        name: 'Side Salad',
        category: 'Sides',
        confidence: 0.9,
        ingredients: [{ name: 'Lettuce', quantity: 50, unit: 'g' }],
      }];

  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ dishes, warnings: [] }) }],
        },
      }],
    }),
  };
};

const handlerResponse = {
  statusCode: 0,
  payload: null,
  setHeader() {},
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
};

try {
  await geminiMenuHandler({
    method: 'POST',
    headers: {},
    body: {
      text: '',
      files: fivePageGuideFiles,
    },
  }, handlerResponse);
} finally {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalApiKey;
  }
}

assert.equal(handlerResponse.statusCode, 200);
assert.equal(handlerResponse.payload.batchCount, 3);
assert.equal(handlerResponse.payload.dishes.length, 2);
assert.equal(handlerResponse.payload.dishes.find((dish) => dish.name === 'Batched Burger').ingredients.length, 2);
assert.equal(geminiRequests.length, 3);
assert.ok(geminiRequests.every((request) => request.requestBody.contents[0].parts.length <= 3));
assert.ok(geminiRequests.every((request) => request.options.headers['x-goog-api-key'] === 'test-gemini-key'));
assert.ok(geminiRequests.every((request) => !request.url.includes('test-gemini-key')));

const timeoutFetch = global.fetch;
const timeoutApiKey = process.env.GEMINI_API_KEY;
const timeoutResponse = {
  statusCode: 0,
  payload: null,
  setHeader() {},
  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
};

process.env.GEMINI_API_KEY = 'test-gemini-key';
global.fetch = async () => {
  const error = new Error('aborted');
  error.name = 'AbortError';
  throw error;
};

try {
  await geminiMenuHandler({
    method: 'POST',
    headers: {},
    body: {
      text: 'Burger: 1 bun, 150g patty',
      files: [],
    },
  }, timeoutResponse);
} finally {
  global.fetch = timeoutFetch;
  if (timeoutApiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = timeoutApiKey;
  }
}

assert.equal(timeoutResponse.statusCode, 504);
assert.equal(timeoutResponse.payload.code, 'gemini_menu_timeout');
assert.equal(timeoutResponse.payload.retryable, true);

console.log('Menu recipe import tests passed');
