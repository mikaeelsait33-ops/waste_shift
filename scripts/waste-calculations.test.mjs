import assert from 'node:assert/strict';
import {
  buildRecipeIngredientBreakdown,
  calculateMenuWasteFinancials,
  createInventoryMovementsFromEntry,
  scaleQuantityLabel,
} from '../src/utils/wasteCalculations.js';
import { getAccessProfile, requirePermission } from '../src/utils/accessControl.js';
import { createPinRecord, validatePin, verifyPin } from '../src/utils/pinAuth.js';

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

const ownerAccess = getAccessProfile({ id: 'staff_owner', name: 'Rizwana', role: 'Owner' });
const managerAccess = getAccessProfile({ id: 'staff_manager', name: 'Nadia', role: 'Manager' });
const waiterAccess = getAccessProfile({ id: 'staff_waiter', name: 'Mikaeel', role: 'waiter' });
const unassignedAccess = getAccessProfile(null);

assert.equal(ownerAccess.canManageServerSync, true);
assert.equal(ownerAccess.canClearData, true);
assert.equal(managerAccess.canManageServerSync, true);
assert.equal(managerAccess.canClearData, true);
assert.equal(waiterAccess.canLogWaste, true);
assert.equal(waiterAccess.canViewFinancials, false);
assert.equal(waiterAccess.canExportData, false);
assert.equal(unassignedAccess.canLogWaste, false);
assert.deepEqual(requirePermission(ownerAccess, 'canClearData', 'clear data'), { ok: true, message: '' });
assert.equal(requirePermission(waiterAccess, 'canClearData', 'clear data').ok, false);

assert.equal(validatePin('123'), 'Use a 4 to 8 digit PIN.');
assert.equal(validatePin('1234'), '');
const pinRecord = await createPinRecord('4931');
assert.equal(await verifyPin('4931', pinRecord), true);
assert.equal(await verifyPin('1111', pinRecord), false);

console.log('waste calculation tests passed');
