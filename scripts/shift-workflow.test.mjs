import assert from 'node:assert/strict';
import {
  createWasteDraftPayload,
  wasteDraftHasContent,
} from '../src/utils/wasteDrafts.js';
import {
  createTodayShiftSummary,
  getWasteEntrySyncStatus,
  wasteEntryNeedsCostReview,
} from '../src/utils/wasteSync.js';

const blankDraft = createWasteDraftPayload({
  formType: 'single',
  quantity: '1',
  reason: 'Expired',
});
assert.equal(wasteDraftHasContent(blankDraft), false);

const ingredientDraft = createWasteDraftPayload({
  formType: 'single',
  name: 'Tomatoes',
  quantity: '2',
  unit: 'kg',
  reason: 'Spoiled',
});
assert.equal(ingredientDraft.fields.name, 'Tomatoes');
assert.equal(wasteDraftHasContent(ingredientDraft), true);

assert.equal(getWasteEntrySyncStatus({ syncStatus: 'pending' }), 'pending');
assert.equal(getWasteEntrySyncStatus({ status: 'logged' }), 'local');
assert.equal(wasteEntryNeedsCostReview({ costStatus: 'needs_item_price' }), true);
assert.equal(wasteEntryNeedsCostReview({ costStatus: 'catalog' }), false);

const today = new Date(2026, 6, 1, 12, 0, 0);
const summary = createTodayShiftSummary([
  {
    id: 'one',
    name: 'Tomatoes',
    date: '01/07/2026',
    reason: 'Spoiled',
    syncStatus: 'synced',
    costStatus: 'catalog',
    createdAt: '2026-07-01T09:00:00.000Z',
  },
  {
    id: 'two',
    name: 'Burger',
    date: '01/07/2026',
    reason: 'Dropped',
    syncStatus: 'failed',
    costStatus: 'needs_ingredient_costs',
    createdAt: '2026-07-01T10:00:00.000Z',
  },
  {
    id: 'old',
    name: 'Milk',
    date: '30/06/2026',
    reason: 'Expired',
    syncStatus: 'pending',
    costStatus: 'needs_item_price',
    createdAt: '2026-06-30T10:00:00.000Z',
  },
], today);

assert.equal(summary.entryCount, 2);
assert.equal(summary.pendingSyncCount, 1);
assert.equal(summary.costReviewCount, 1);
assert.equal(summary.latestEntries[0].id, 'two');
assert.deepEqual(summary.topReasons, [
  { reason: 'Spoiled', count: 1 },
  { reason: 'Dropped', count: 1 },
]);

console.log('shift workflow tests passed');
