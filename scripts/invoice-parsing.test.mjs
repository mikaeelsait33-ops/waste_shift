import assert from 'node:assert/strict';
import {
  parseInvoiceText,
  parseMoney,
  roundMoney,
} from '../src/utils/invoiceParsing.js';

const getOnlyItem = (text) => {
  const parsed = parseInvoiceText(text, { vatRate: 0.15 });

  assert.equal(parsed.items.length, 1);
  return parsed.items[0];
};

assert.equal(parseMoney('R1 234,50'), 1234.5);
assert.equal(parseMoney('ZAR 1,234.50'), 1234.5);

let item = getOnlyItem(`
Cape Foods
Invoice date: 28/06/2026
Description Qty Unit Price Total
SALMON FILLET 2 kg R45.00 R90.00
Subtotal R90.00
`);

assert.equal(item.itemName.toLowerCase(), 'salmon fillet');
assert.equal(item.quantity, 2);
assert.equal(item.unit, 'kg');
assert.equal(item.unitPrice, 45);
assert.equal(item.lineTotal, 90);
assert.equal(item.baseQuantity, 2000);
assert.equal(item.baseUnit, 'g');

item = getOnlyItem('12345 Chicken Breast 5 kg 72.50 362.50');
assert.equal(item.itemName, 'Chicken Breast');
assert.equal(item.quantity, 5);
assert.equal(item.unit, 'kg');
assert.equal(item.unitPrice, 72.5);
assert.equal(item.lineTotal, 362.5);

item = getOnlyItem('2 kg Tomatoes R18,50 R37,00');
assert.equal(item.itemName, 'Tomatoes');
assert.equal(item.quantity, 2);
assert.equal(item.unit, 'kg');
assert.equal(item.unitPrice, 18.5);
assert.equal(item.lineTotal, 37);

item = getOnlyItem(`
Fresh Milk Full Cream
6 x 2L R28.99 R173.94
`);
assert.equal(item.itemName, 'Fresh Milk Full Cream');
assert.equal(item.quantity, 12);
assert.equal(item.unit, 'L');
assert.equal(item.lineTotal, 173.94);
assert.equal(item.baseQuantity, 12000);
assert.equal(item.baseUnit, 'ml');

item = getOnlyItem('Milk Sachet 6 48.00');
assert.equal(item.itemName, 'Milk Sachet');
assert.equal(item.quantity, 6);
assert.equal(item.unit, 'each');
assert.equal(item.unitPrice, 8);
assert.equal(item.lineTotal, 48);

const rawNaturallyInvoice = parseInvoiceText(`
Description Quantity Excl Price Disc % VAT % Exclusive Total Inclusive Total
TOM - 001 - Tomatoes Kg 2.10 R29.90 0.00% 0.00% R62.79 R62.79
ONION - 002 - Onion Red Kg 1.50 R21.90 0.00% 0.00% R32.85 R32.85
STRAW - 001 - Strawberries Punnet 1.00 R49.00 0.00% 0.00% R49.00 R49.00
TENDER - 001 - Tender Stem Broccoli 250g 1.00 R45.00 0.00% 0.00% R45.00 R45.00
ORAN - 002 - Oranges bag 3.00 R29.00 0.00% 0.00% R87.00 R87.00
Total Exclusive: R276.64
Total VAT: R0.00
Total: R276.64
`, { vatRate: 0.15 });

assert.equal(rawNaturallyInvoice.items.length, 5);
assert.deepEqual(
  rawNaturallyInvoice.items.map((lineItem) => [lineItem.itemName, lineItem.quantity, lineItem.unit, lineItem.unitPrice, lineItem.lineTotal]),
  [
    ['Tomatoes', 2.1, 'kg', 29.9, 62.79],
    ['Onion Red', 1.5, 'kg', 21.9, 32.85],
    ['Strawberries', 1, 'punnet', 49, 49],
    ['Tender Stem Broccoli 250g', 1, 'each', 45, 45],
    ['Oranges', 3, 'bag', 29, 87],
  ]
);

const noisyOcr = parseInvoiceText('- o = . \u00ae 3 1 3', { vatRate: 0.15 });
assert.equal(noisyOcr.items.length, 0);

const accountNumberOcr = parseInvoiceText(`
Payment reference 8703533806.12
Bank account 10009063877.00
`, { vatRate: 0.15 });
assert.equal(accountNumberOcr.items.length, 0);

const impossibleInvoiceLine = parseInvoiceText('Chicken Breast 2 kg R350000.00 R700000.00', { vatRate: 0.15 });
assert.equal(impossibleInvoiceLine.items.length, 0);

const exclusive = parseInvoiceText(`
Prices excl VAT
Olive Oil 1 L R100.00 R100.00
`, { vatRate: 0.15 });
assert.equal(exclusive.vatMode, 'exclusive');
assert.equal(exclusive.items[0].priceExVAT, 100);
assert.equal(exclusive.items[0].vatAmount, 15);
assert.equal(exclusive.items[0].priceIncVAT, 115);
assert.equal(roundMoney(exclusive.totals.totalIncVAT), 115);

console.log('invoice parsing tests passed');
