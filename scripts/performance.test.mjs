import assert from 'node:assert/strict';
import {
  DEFAULT_PAGE_SIZE,
  MAX_DASHBOARD_ROWS,
  clampListLimit,
  getVisiblePage,
  limitDashboardRows,
} from '../src/utils/listPerformance.js';

const records = Array.from({ length: 80 }, (_, index) => ({ id: `row-${index + 1}` }));

let page = getVisiblePage(records);
assert.equal(page.visibleCount, DEFAULT_PAGE_SIZE);
assert.equal(page.totalCount, 80);
assert.equal(page.hasMore, true);
assert.equal(page.nextLimit, DEFAULT_PAGE_SIZE * 2);
assert.equal(page.records[0].id, 'row-1');
assert.equal(page.records.at(-1).id, `row-${DEFAULT_PAGE_SIZE}`);

page = getVisiblePage(records, { limit: 70, fallbackLimit: 20 });
assert.equal(page.visibleCount, 70);
assert.equal(page.hasMore, true);
assert.equal(page.nextLimit, 80);

page = getVisiblePage(records, { limit: 500, fallbackLimit: 20 });
assert.equal(page.visibleCount, 80);
assert.equal(page.hasMore, false);

assert.equal(clampListLimit('bad', { fallback: 30, min: 10, max: 100 }), 30);
assert.equal(clampListLimit(5, { fallback: 30, min: 10, max: 100 }), 10);
assert.equal(clampListLimit(5000, { fallback: 30, min: 10, max: 100 }), 100);
assert.equal(limitDashboardRows(records).length, MAX_DASHBOARD_ROWS);
assert.equal(limitDashboardRows(records, 4).length, 4);

console.log('performance helper tests passed');
