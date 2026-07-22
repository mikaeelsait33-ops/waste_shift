import assert from 'node:assert/strict';
import { createRecordId } from '../src/utils/ids.js';
import {
  mergeMenuItems,
  sanitizeMenuItems,
  sanitizeSettings,
  sanitizeStoreRoomItems,
} from '../src/utils/appData.js';

const firstId = createRecordId('waste');
const secondId = createRecordId('waste');

assert.match(firstId, /^waste_/);
assert.match(secondId, /^waste_/);
assert.notEqual(firstId, secondId);
assert.match(createRecordId('Store Movement'), /^store_movement_/);

assert.deepEqual(sanitizeSettings({
  dailyWasteValueLimit: '250.50',
  dailyWasteEntryLimit: '8',
}), {
  dailyWasteValueLimit: 250.5,
  dailyWasteEntryLimit: 8,
});
assert.deepEqual(sanitizeSettings({ dailyWasteValueLimit: -1, dailyWasteEntryLimit: 'bad' }), {
  dailyWasteValueLimit: 0,
  dailyWasteEntryLimit: 0,
});

const menuItems = sanitizeMenuItems([
  { name: 'Salmon Benedict', price: 'R 125.00', category: 'Breakfast' },
  { name: 'Salmon Benedict', price: 999 },
  { name: '' },
]);
assert.equal(menuItems.length, 1);
assert.equal(menuItems[0].menuPrice, 125);
assert.equal(menuItems[0].category, 'Breakfast');

const mergedMenu = mergeMenuItems(
  [{ key: 'salmon_benedict', name: 'Salmon Benedict', menuPrice: 100 }],
  [{ key: 'salmon_benedict', name: 'Salmon Benedict', menuPrice: 125, category: 'Breakfast' }],
  { salmon_benedict: { ingredients: [{ name: 'Salmon' }] } },
);
assert.equal(mergedMenu[0].menuPrice, 125);
assert.equal(mergedMenu[0].ingredientCount, 1);

const stockItems = sanitizeStoreRoomItems([
  { name: 'Rocket', quantity: '1.2345', parLevel: '2', unit: 'kg' },
  { name: 'Rocket', quantity: 9 },
]);
assert.equal(stockItems.length, 1);
assert.equal(stockItems[0].quantity, 1.235);
assert.equal(stockItems[0].unit, 'kg');

console.log('foundation tests passed');
