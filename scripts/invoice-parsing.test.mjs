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

const noisyOcr = parseInvoiceText('- o = . ® 3 1 3', { vatRate: 0.15 });
assert.equal(noisyOcr.items.length, 0);

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
