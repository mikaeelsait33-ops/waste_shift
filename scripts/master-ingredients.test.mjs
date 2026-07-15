import assert from 'node:assert/strict';

import {
  buildInvoiceIngredientPricing,
  convertQuantityToBaseUnit,
  matchMasterIngredient,
  mergeMasterIngredientSources,
  normalizeMasterIngredientName,
  normalizeMasterIngredientRecord,
} from '../src/utils/masterIngredients.js';
import {
  calculateRecipeIngredientCost,
  createItemPriceCatalogFromInvoice,
  sanitizeItemPriceCatalog,
} from '../src/utils/itemPriceCatalog.js';

assert.equal(normalizeMasterIngredientName('Macon 1kg Pack'), 'macon');
assert.equal(normalizeMasterIngredientName('Jimmy Sauce (50ml)'), 'jimmy sauce');

const macon = normalizeMasterIngredientRecord({
  id: 'macon',
  canonicalName: 'Macon',
  baseUnit: 'g',
  aliases: ['Macon', 'Macon Bits', 'Beef Macon', 'Macon Sliced'],
  latestCostPerBaseUnit: 0.16,
});

let match = matchMasterIngredient('Macon 1kg Pack', [macon]);
assert.equal(match.ingredient.id, 'macon');
assert.equal(match.matchType, 'exact_alias');
assert.equal(match.needsReview, false);

match = matchMasterIngredient('Macon Strip', [macon]);
assert.equal(match.ingredient.id, 'macon');
assert.equal(match.needsReview, false);

match = matchMasterIngredient('Breakfast garnish', [macon]);
assert.equal(match.ingredient, null);
assert.equal(match.needsReview, true);

const mergedRocketIngredients = mergeMasterIngredientSources(
  [{
    id: 'rocket',
    name: 'Rocket',
    category: 'Produce',
    baseUnit: 'g',
    latestCostPerBaseUnit: 0,
  }],
  [{
    id: 'rocket',
    name: 'Rocket',
    category: 'Produce',
    baseUnit: 'g',
    aliases: ['RCKT P/P 1KG'],
    latestCostPerBaseUnit: 0.1179,
  }]
);
assert.equal(mergedRocketIngredients.length, 1);
assert.equal(mergedRocketIngredients[0].latestCostPerBaseUnit, 0.1179);
assert.equal(matchMasterIngredient('RCKT P/P 1KG', mergedRocketIngredients).ingredient.id, 'rocket');
assert.equal(matchMasterIngredient('RCKT P/P 1KG', mergedRocketIngredients).matchType, 'exact_alias');

assert.deepEqual(
  convertQuantityToBaseUnit({ quantity: 2, unit: 'kg' }),
  { canConvert: true, quantity: 2000, unit: 'g' }
);
assert.deepEqual(
  convertQuantityToBaseUnit({ quantity: 5, unit: 'l' }),
  { canConvert: true, quantity: 5000, unit: 'ml' }
);
assert.deepEqual(
  convertQuantityToBaseUnit({ quantity: 2.5, unit: 'doz' }),
  { canConvert: true, quantity: 30, unit: 'each' }
);

const packageConversion = convertQuantityToBaseUnit({ quantity: 1, unit: 'box', packageUnitCount: 12 });
assert.equal(packageConversion.canConvert, true);
assert.equal(packageConversion.quantity, 12);
assert.equal(packageConversion.unit, 'each');

const invoicePricing = buildInvoiceIngredientPricing({
  itemName: 'Macon 1kg Pack',
  quantity: 1,
  unit: 'kg',
  priceExVAT: 160,
});
assert.equal(invoicePricing.convertedQuantity, 1000);
assert.equal(invoicePricing.baseUnit, 'g');
assert.equal(invoicePricing.costPerBaseUnit, 0.16);

const linkedCatalog = sanitizeItemPriceCatalog(createItemPriceCatalogFromInvoice({
  invoiceId: 'invoice-master',
  lineItems: [
    {
      id: 'line-macon',
      itemName: 'Macon 1kg Pack',
      quantity: 1,
      unit: 'kg',
      unitPriceExVAT: 160,
      priceExVAT: 160,
      baseQuantity: 1000,
      baseUnit: 'g',
      costPerBaseUnitExVAT: 0.16,
    },
  ],
  ingredientRows: [
    {
      lineItemId: 'line-macon',
      ingredientId: 'macon',
      ingredientName: 'Macon',
      canonicalName: 'Macon',
      aliases: ['macon bits'],
      priceUnit: 'kg',
      invoiceQuantity: 1,
      invoiceUnit: 'kg',
      baseUnit: 'g',
      costPerBaseUnit: 0.16,
      costPerBaseUnitExVAT: 0.16,
    },
  ],
}));

assert.equal(calculateRecipeIngredientCost({
  ingredient: {
    ingredientId: 'macon',
    displayName: 'Macon Bits',
    name: 'Macon Bits',
    quantity: '40g',
    cost: 0,
  },
  itemPriceCatalog: linkedCatalog,
}).cost, 6.4);

console.log('Master ingredient matching tests passed');
