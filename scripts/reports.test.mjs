import assert from 'node:assert/strict';
import {
  createAccountingExport,
  createShiftSummaryReport,
  rowsToCsv,
} from '../src/utils/reports.js';

const wasteItems = [
  {
    id: 'w1',
    name: 'Rocket',
    date: '06/07/2026',
    reason: 'Expired',
    department: 'Kitchen',
    status: 'logged',
    foodCostLost: 1.18,
    potentialRevenueLost: 5,
    grossProfitLost: 3.82,
  },
  {
    id: 'w2',
    name: 'Rocket',
    date: '06/07/2026',
    reason: 'Overproduction',
    department: 'Kitchen',
    status: 'voided',
    foodCostLost: 99,
  },
  {
    id: 'w3',
    name: 'Chicken',
    date: '05/07/2026',
    reason: 'Spoiled',
    department: 'Kitchen',
    status: 'logged',
    foodCostLost: 10.8,
  },
];

const invoices = [
  {
    id: 'inv1',
    supplierName: 'Raw Supplier',
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-07-06',
    totalExVAT: 100,
    vatAmount: 15,
    totalIncVAT: 115,
    status: 'confirmed',
  },
  {
    id: 'inv2',
    supplierName: 'Hidden Supplier',
    invoiceDate: '2026-07-06',
    totalExVAT: 500,
    status: 'voided',
  },
];

const summary = createShiftSummaryReport({
  wasteItems,
  invoices,
  stockMovements: [{ id: 'm1', createdAt: '2026-07-06T10:00:00.000Z' }],
  startDate: '2026-07-06',
  endDate: '2026-07-06',
  preparedBy: 'Manager',
});

assert.equal(summary.totals.wasteEntries, 1);
assert.equal(summary.totals.foodCostLost, 1.18);
assert.equal(summary.totals.invoiceCount, 2);
assert.equal(summary.totals.stockMovementCount, 1);
assert.equal(summary.topWastedItems[0].label, 'Rocket');

const accounting = createAccountingExport({
  invoices,
  startDate: '2026-07-06',
  endDate: '2026-07-06',
});

assert.equal(accounting.rows.length, 1);
assert.equal(accounting.rows[0].supplier, 'Raw Supplier');
assert.equal(accounting.supplierTotals[0].totalIncVAT, 115);

const csv = rowsToCsv(accounting.rows);
assert.match(csv, /supplier,invoiceNumber/);
assert.match(csv, /Raw Supplier,INV-1/);

console.log('Report tests passed');
