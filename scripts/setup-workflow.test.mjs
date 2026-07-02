import assert from 'node:assert/strict';
import {
  createImportHistoryRecord,
  normalizeImportedMenuItems,
  parseMenuCsvText,
  parseMenuPlainText,
} from '../src/utils/menuImport.js';
import {
  RESTAURANT_RESET_CONFIRMATION,
  createEmptyRestaurantData,
  validateRestaurantResetConfirmation,
} from '../src/utils/restaurantReset.js';
import {
  normalizeGeminiMenuPayload,
  parseGeminiJsonText,
} from '../api/gemini-menu.js';

const textItems = parseMenuPlainText('Breakfast: Salmon Benedict R85\nCoffee R32');
assert.equal(textItems.length, 2);
assert.equal(textItems[0].name, 'Salmon Benedict');
assert.equal(textItems[0].category, 'Breakfast');
assert.equal(textItems[0].sellingPrice, 85);

const csvItems = parseMenuCsvText('name,price,category\nBurger,120,Mains\nCake,55,Dessert');
assert.equal(csvItems.length, 2);
assert.equal(csvItems[1].name, 'Cake');
assert.equal(csvItems[1].sellingPrice, 55);

const reviewedItems = normalizeImportedMenuItems([
  { name: 'Burger', sellingPrice: 120, confidence: 0.9, approved: true },
  { name: 'Burger', sellingPrice: 125, confidence: 0.9, approved: true },
  { name: '', sellingPrice: 10, confidence: 0.9, approved: true },
], [{ name: 'Cake' }]);
assert.equal(reviewedItems[0].approved, true);
assert.equal(reviewedItems[1].approved, false);
assert.ok(reviewedItems[1].warnings.includes('Duplicate inside this import.'));
assert.ok(reviewedItems[2].warnings.includes('Missing item name.'));

const historyRecord = createImportHistoryRecord({
  importType: 'csv',
  sourceName: 'menu.csv',
  importedBy: 'Nadia',
  reviewedItems: [
    { approved: true },
    { approved: false, rejected: true },
  ],
  warnings: ['Price missing'],
});
assert.match(historyRecord.id, /^menu_import_/);
assert.equal(historyRecord.approvedCount, 1);
assert.equal(historyRecord.rejectedCount, 1);

const geminiPayload = normalizeGeminiMenuPayload(parseGeminiJsonText(`
{
  "items": [
    {
      "name": "Flat White",
      "category": "Coffee",
      "sellingPrice": 38,
      "components": [{"name": "Milk"}],
      "confidence": 0.93
    }
  ]
}
`));
assert.equal(geminiPayload.items.length, 1);
assert.equal(geminiPayload.items[0].name, 'Flat White');
assert.equal(geminiPayload.items[0].components[0].name, 'Milk');

assert.equal(validateRestaurantResetConfirmation(RESTAURANT_RESET_CONFIRMATION), true);
assert.equal(validateRestaurantResetConfirmation('reset'), true);
assert.equal(validateRestaurantResetConfirmation('delete'), false);

const emptyData = createEmptyRestaurantData();
assert.deepEqual(emptyData.wasteItems, []);
assert.deepEqual(emptyData.recipes, {});
assert.deepEqual(emptyData.customStaffList, []);

console.log('setup workflow tests passed');
