import assert from 'node:assert/strict';
import { createLowStockAlerts, parseUsageQuantity } from '../src/utils/stockAlerts.js';

assert.deepEqual(parseUsageQuantity({ changeAmount: -2, unit: 'kg' }), {
  quantity: 2,
  unit: 'kg',
});
assert.deepEqual(parseUsageQuantity({ changeLabel: '250g' }), {
  quantity: 250,
  unit: 'g',
});

const now = new Date();
const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const alerts = createLowStockAlerts({
  ingredients: [
    { id: 'tomatoes', name: 'Tomatoes' },
    { id: 'milk', name: 'Milk' },
  ],
  stockLevels: [
    { ingredientId: 'tomatoes', currentQty: 2, unit: 'kg', reorderPoint: 1, status: 'ok' },
    { ingredientId: 'milk', currentQty: 1, unit: 'L', reorderPoint: 2, status: 'ok' },
  ],
  inventoryMovements: [
    { ingredientName: 'Tomatoes', changeLabel: '500g', createdAt: daysAgo(1) },
    { ingredientName: 'Tomatoes', changeLabel: '500g', createdAt: daysAgo(2) },
    { ingredientName: 'Tomatoes', changeLabel: '500g', createdAt: daysAgo(3) },
    { ingredientName: 'Tomatoes', changeLabel: '500g', createdAt: daysAgo(4) },
  ],
  usageWindowDays: 5,
  riskDays: 6,
});

assert.equal(alerts.length, 2);
assert.equal(alerts[0].ingredientName, 'Milk');
assert.equal(alerts[0].severity, 'critical');
assert.equal(alerts[1].ingredientName, 'Tomatoes');
assert.equal(alerts[1].severity, 'watch');
assert.equal(alerts[1].projectedDaysLeft, 5);

console.log('stock alert tests passed');
