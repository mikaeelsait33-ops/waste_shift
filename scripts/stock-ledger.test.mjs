import assert from 'node:assert/strict';

import {
  createStockMovementId,
  createStockMovementRecord,
  summarizeStockMovement,
} from '../src/utils/stockLedger.js';

const movementId = createStockMovementId({
  invoiceId: 'invoice/raw-001',
  lineItemId: 'line tomato kg',
  ingredientId: 'tomatoes',
});

assert.equal(movementId, 'invoice_raw-001_line_tomato_kg_tomatoes');

const movement = createStockMovementRecord({
  movementId,
  invoiceId: 'invoice/raw-001',
  invoiceNumber: 'RAW-1001',
  supplier: 'Raw Naturally Nutritious',
  invoiceDate: '2026-07-03',
  receivedDate: '2026-07-04',
  lineItem: {
    id: 'line tomato kg',
    itemName: 'Tomatoes Kg',
    baseUnit: 'g',
    unitPriceExVAT: 29.9,
    priceExVAT: 62.79,
  },
  ingredientRow: {
    ingredientId: 'tomatoes',
    ingredientName: 'Tomatoes',
  },
  previousQty: 500,
  incomingQty: 2100,
  nextQty: 2600,
  unit: 'g',
  status: 'ok',
  postingMode: 'posted',
  postedBy: 'Manager',
  createdAt: 'SERVER_TIME',
});

assert.equal(movement.movementId, movementId);
assert.equal(movement.type, 'receive');
assert.equal(movement.quantityBase, 2100);
assert.equal(movement.baseUnit, 'g');
assert.equal(movement.sourceType, 'invoice');
assert.equal(movement.sourceId, 'invoice/raw-001');
assert.equal(movement.ingredientName, 'Tomatoes');
assert.equal(movement.previousQuantityBase, 500);
assert.equal(movement.resultingQuantityBase, 2600);
assert.equal(movement.postedBy, 'Manager');

const historicalMovement = createStockMovementRecord({
  movementId: 'historical_1',
  invoiceId: 'invoice-2',
  lineItem: { id: 'line-2', itemName: 'Eggs', unit: 'each' },
  ingredientRow: { ingredientId: 'eggs', ingredientName: 'Eggs' },
  incomingQty: 30,
  nextQty: 30,
  postingMode: 'historical_posted',
});

assert.equal(historicalMovement.type, 'historical_receive');
assert.equal(historicalMovement.baseUnit, 'each');

assert.deepEqual(summarizeStockMovement(movement), {
  ingredientId: 'tomatoes',
  ingredientName: 'Tomatoes',
  quantityBase: 2100,
  baseUnit: 'g',
  sourceId: 'invoice/raw-001',
});

console.log('Stock ledger tests passed');
