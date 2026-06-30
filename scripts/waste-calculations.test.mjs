import assert from 'node:assert/strict';
import {
  buildRecipeIngredientBreakdown,
  calculateMenuWasteFinancials,
  createInventoryMovementsFromEntry,
  scaleQuantityLabel,
} from '../src/utils/wasteCalculations.js';
import {
  calculateItemPriceCost,
  createItemPriceCatalogFromInvoice,
  findItemPriceRecord,
  parseIngredientQuantity,
  sanitizeItemPriceCatalog,
} from '../src/utils/itemPriceCatalog.js';
import { getAccessProfile, requirePermission } from '../src/utils/accessControl.js';
import { createPinRecord, createRandomPin, validatePin, verifyPin } from '../src/utils/pinAuth.js';

const recipe = {
  name: 'Chicken Burger',
  ingredients: [
    { name: 'Burger bun', quantity: '1', cost: 5, category: 'Bakery' },
    { name: 'Chicken patty', quantity: '1', cost: 24, category: 'Meat/Poultry' },
    { name: 'Lettuce', quantity: '20g', cost: 2, category: 'Produce' },
    { name: 'Sauce', quantity: '20ml', cost: 4, category: 'Pantry' },
  ],
};

assert.equal(scaleQuantityLabel('20g', 2), '40g');
assert.equal(scaleQuantityLabel('1/2', 2), '1');
assert.equal(scaleQuantityLabel('garnish', 2), 'garnish x 2');

const breakdown = buildRecipeIngredientBreakdown(recipe, 2);
assert.deepEqual(
  breakdown.map((ingredient) => [ingredient.name, ingredient.quantity, ingredient.cost]),
  [
    ['Burger bun', '2', 10],
    ['Chicken patty', '2', 48],
    ['Lettuce', '40g', 4],
    ['Sauce', '40ml', 8],
  ]
);

const financials = calculateMenuWasteFinancials({
  recipe,
  menuItem: { name: 'Chicken Burger', menuPrice: 120 },
  quantity: 2,
});

assert.equal(financials.foodCostLost, 70);
assert.equal(financials.potentialRevenueLost, 240);
assert.equal(financials.grossProfitLost, 170);
assert.equal(financials.foodCostPercentage, 29.17);
assert.equal(financials.costStatus, 'calculated');

const partialFinancials = calculateMenuWasteFinancials({
  recipe,
  menuItem: { name: 'Chicken Burger', menuPrice: 120 },
  quantity: 2,
  selectedComponentKeys: [
    breakdown[1].componentKey,
    breakdown[3].componentKey,
  ],
});

assert.equal(partialFinancials.foodCostLost, 56);
assert.equal(partialFinancials.fullFoodCostLost, 70);
assert.equal(partialFinancials.potentialRevenueLost, 192);
assert.equal(partialFinancials.partialWaste, true);
assert.equal(partialFinancials.allComponentsSelected, false);
assert.deepEqual(
  partialFinancials.selectedComponents.map((component) => component.name),
  ['Chicken patty', 'Sauce']
);

const unknownCostFinancials = calculateMenuWasteFinancials({
  recipe: { name: 'Toast', ingredients: [{ name: 'Bread', quantity: '2', cost: 0 }] },
  menuItem: { name: 'Toast', menuPrice: 80 },
  quantity: 1,
});

assert.equal(unknownCostFinancials.foodCostLost, 0);
assert.equal(unknownCostFinancials.potentialRevenueLost, 80);
assert.equal(unknownCostFinancials.grossProfitLost, 0);
assert.equal(unknownCostFinancials.costStatus, 'needs_ingredient_costs');

const movements = createInventoryMovementsFromEntry({
  id: 'entry-1',
  date: '27/06/2026',
  time: '14:30',
  staff: 'Chef Mike',
  createdAt: '2026-06-27T12:30:00.000Z',
  isRecipe: true,
  ingredients: breakdown,
});

assert.equal(movements.length, 4);
assert.equal(movements[2].ingredientName, 'Lettuce');
assert.equal(movements[2].changeLabel, '40g');
assert.equal(movements[2].costImpact, 4);

const itemPriceCatalog = sanitizeItemPriceCatalog({
  tomato: { name: 'Tomato', price: 3.5, unit: 'each', category: 'Produce' },
  milk: { name: 'Milk', price: 28, unit: 'l', category: 'Dairy' },
  coffee_beans: { name: 'Coffee Beans', price: 180, unit: 'kg', category: 'Coffee/Tea' },
});
assert.equal(findItemPriceRecord(itemPriceCatalog, 'tomato').price, 3.5);
assert.deepEqual(
  calculateItemPriceCost({
    priceRecord: findItemPriceRecord(itemPriceCatalog, 'Tomato'),
    quantity: 2,
    unit: 'each',
  }),
  { canCalculate: true, cost: 7, quantityInPriceUnit: 2 }
);
assert.equal(
  calculateItemPriceCost({
    priceRecord: findItemPriceRecord(itemPriceCatalog, 'Milk'),
    quantity: 250,
    unit: 'ml',
  }).cost,
  7
);
assert.equal(
  calculateItemPriceCost({
    priceRecord: findItemPriceRecord(itemPriceCatalog, 'Coffee Beans'),
    quantity: 125,
    unit: 'g',
  }).cost,
  22.5
);
assert.equal(
  calculateItemPriceCost({
    priceRecord: findItemPriceRecord(itemPriceCatalog, 'Tomato'),
    quantity: 250,
    unit: 'g',
  }).canCalculate,
  false
);
assert.deepEqual(parseIngredientQuantity('10g'), { quantity: 10, unit: 'g' });
assert.deepEqual(parseIngredientQuantity('1/2 kg'), { quantity: 0.5, unit: 'kg' });
assert.deepEqual(parseIngredientQuantity('1 punnet'), { quantity: 1, unit: 'punnet' });

const tomatoToastFinancials = calculateMenuWasteFinancials({
  recipe: {
    name: 'Tomato Toast',
    ingredients: [
      { name: 'Tomato', quantity: '10g', cost: 0, category: 'Produce' },
      { name: 'Bread slice', quantity: '1', cost: 2, category: 'Bakery' },
    ],
  },
  menuItem: { name: 'Tomato Toast', menuPrice: 35 },
  quantity: 1,
  itemPriceCatalog: sanitizeItemPriceCatalog({
    tomato: { name: 'Tomato', price: 30, unit: 'kg', category: 'Produce' },
  }),
});

assert.equal(tomatoToastFinancials.ingredientCostPerItem, 2.3);
assert.equal(tomatoToastFinancials.ingredients[0].cost, 0.3);
assert.equal(tomatoToastFinancials.ingredients[0].costSource, 'catalog');
assert.equal(tomatoToastFinancials.ingredients[1].cost, 2);
assert.equal(tomatoToastFinancials.ingredients[1].costSource, 'manual');

const invoicePriceCatalog = createItemPriceCatalogFromInvoice({
  invoiceId: 'invoice-1',
  supplierName: 'Raw Produce',
  invoiceDate: '2026-06-30',
  lineItems: [
    {
      id: 'line-tomatoes',
      itemName: 'Tomatoes',
      quantity: 2.1,
      unit: 'kg',
      unitPriceExVAT: 29.9,
      priceExVAT: 62.79,
    },
    {
      id: 'line-strawberries',
      itemName: 'Strawberries',
      quantity: 1,
      unit: 'punnet',
      unitPriceExVAT: 49,
      priceExVAT: 49,
    },
  ],
  ingredientRows: [
    {
      lineItemId: 'line-tomatoes',
      ingredientName: 'Tomatoes',
      category: 'Produce',
      unitPriceExVAT: 29.9,
      priceUnit: 'kg',
    },
    {
      lineItemId: 'line-strawberries',
      ingredientName: 'Strawberries',
      category: 'Produce',
      unitPriceExVAT: 49,
      priceUnit: 'punnet',
    },
  ],
});

assert.equal(invoicePriceCatalog.tomatoes.price, 29.9);
assert.equal(invoicePriceCatalog.tomatoes.unit, 'kg');
assert.equal(invoicePriceCatalog.tomatoes.source, 'invoice');
assert.equal(invoicePriceCatalog.strawberries.unit, 'punnet');
assert.equal(
  calculateMenuWasteFinancials({
    recipe: {
      name: 'Berry Bowl',
      ingredients: [
        { name: 'Strawberries', quantity: '1 punnet', cost: 0, category: 'Produce' },
      ],
    },
    menuItem: { name: 'Berry Bowl', menuPrice: 120 },
    quantity: 1,
    itemPriceCatalog: invoicePriceCatalog,
  }).foodCostLost,
  49
);

const ownerAccess = getAccessProfile({ id: 'staff_owner', name: 'Rizwana', role: 'Owner' });
const managerAccess = getAccessProfile({ id: 'staff_manager', name: 'Nadia', role: 'Manager' });
const waiterAccess = getAccessProfile({ id: 'staff_waiter', name: 'Mikaeel', role: 'waiter' });
const unassignedAccess = getAccessProfile(null);

assert.equal(ownerAccess.canManageServerSync, true);
assert.equal(ownerAccess.canClearData, true);
assert.equal(ownerAccess.canManageStoreRoom, true);
assert.equal(managerAccess.canManageServerSync, true);
assert.equal(managerAccess.canClearData, true);
assert.equal(managerAccess.canManageStoreRoom, true);
assert.equal(waiterAccess.canLogWaste, true);
assert.equal(waiterAccess.canViewStoreRoom, true);
assert.equal(waiterAccess.canManageStoreRoom, false);
assert.equal(waiterAccess.canViewFinancials, false);
assert.equal(waiterAccess.canExportData, false);
assert.equal(unassignedAccess.canLogWaste, false);
assert.deepEqual(requirePermission(ownerAccess, 'canClearData', 'clear data'), { ok: true, message: '' });
assert.equal(requirePermission(waiterAccess, 'canClearData', 'clear data').ok, false);

assert.equal(validatePin('123'), 'Use a 4 to 8 digit PIN.');
assert.equal(validatePin('1234'), '');
assert.match(createRandomPin(6), /^\d{6}$/);
const pinRecord = await createPinRecord('4931');
assert.equal(await verifyPin('4931', pinRecord), true);
assert.equal(await verifyPin('1111', pinRecord), false);

console.log('waste calculation tests passed');
