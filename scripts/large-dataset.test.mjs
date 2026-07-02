import assert from 'node:assert/strict';
import { buildCostReviewQueue } from '../src/utils/ingredientIntelligence.js';
import { getVisiblePage, limitDashboardRows } from '../src/utils/listPerformance.js';
import { createTodayShiftSummary } from '../src/utils/wasteSync.js';
import { createLargeDataset } from './large-dataset-fixtures.mjs';

const startedAt = performance.now();
const dataset = createLargeDataset();
const generatedInMs = performance.now() - startedAt;

assert.equal(dataset.wasteItems1000.length, 1000);
assert.equal(dataset.wasteItems5000.length, 5000);
assert.equal(dataset.menuItems.length, 500);
assert.equal(dataset.ingredients.length, 500);
assert.equal(dataset.staff.length, 100);
assert.equal(dataset.inventoryMovements.length, 500);
assert.equal(dataset.invoices.length, 100);
assert.ok(generatedInMs < 2000, `Large dataset generator took ${generatedInMs}ms`);

const firstPage = getVisiblePage(dataset.wasteItems5000, { limit: 25 });
assert.equal(firstPage.visibleCount, 25);
assert.equal(firstPage.totalCount, 5000);
assert.equal(firstPage.hasMore, true);

const dashboardRows = limitDashboardRows(dataset.wasteItems5000.map((item) => ({
  label: item.name,
  value: item.foodCostLost,
})));
assert.equal(dashboardRows.length, 12);

const summary = createTodayShiftSummary(dataset.wasteItems5000, new Date(2026, 0, 1));
assert.ok(summary.entryCount > 0);
assert.ok(summary.latestEntries.length <= 5);

const queue = buildCostReviewQueue({
  wasteItems: dataset.wasteItems1000,
  ingredients: dataset.ingredients,
  invoiceLines: [{ id: 'low-confidence', itemName: 'Unknown', confidence: 0.3 }],
  recipes: {},
  itemPriceCatalog: {},
});
assert.ok(queue.length > 0);
assert.ok(queue.some((item) => item.type === 'waste'));
assert.ok(queue.some((item) => item.type === 'ingredient'));
assert.ok(queue.some((item) => item.type === 'invoice'));

console.log('large dataset tests passed');
