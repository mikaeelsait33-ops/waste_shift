import { createRecordId } from '../src/utils/ids.js';

const pad = (value) => String(value).padStart(2, '0');

const formatDate = (index) => {
  const day = (index % 28) + 1;
  const month = ((Math.floor(index / 28) % 12) + 1);
  return `${pad(day)}/${pad(month)}/2026`;
};

export const createWasteEntries = (count = 1000) => (
  Array.from({ length: count }, (_, index) => ({
    id: createRecordId('waste'),
    name: `Waste item ${index + 1}`,
    date: formatDate(index),
    time: `${pad(index % 24)}:${pad((index * 7) % 60)}`,
    reason: index % 3 === 0 ? 'Overproduction' : index % 3 === 1 ? 'Spoiled' : 'Prep mistake',
    category: index % 2 === 0 ? 'Produce' : 'Pantry',
    quantity: String((index % 5) + 1),
    unit: 'each',
    staff: `Staff ${index % 100}`,
    foodCostLost: (index % 40) + 1,
    syncStatus: index % 17 === 0 ? 'pending' : 'synced',
    costStatus: index % 29 === 0 ? 'needs_item_price' : 'calculated',
    createdAt: new Date(Date.UTC(2026, index % 12, (index % 28) + 1, index % 24, index % 60)).toISOString(),
  }))
);

export const createMenuItems = (count = 500) => (
  Array.from({ length: count }, (_, index) => ({
    key: `menu_item_${index + 1}`,
    name: `Menu Item ${index + 1}`,
    menuPrice: 45 + (index % 150),
    components: [
      { name: `Ingredient ${index % 500}`, cost: 8 + (index % 20) },
      { name: `Sauce ${index % 40}`, cost: 2 + (index % 10) },
    ],
  }))
);

export const createIngredients = (count = 500) => (
  Array.from({ length: count }, (_, index) => ({
    id: `ingredient_${index + 1}`,
    name: `Ingredient ${index + 1}`,
    category: index % 2 === 0 ? 'Produce' : 'Pantry',
    latestCost: index % 11 === 0 ? 0 : 10 + (index % 90),
    unit: index % 3 === 0 ? 'kg' : 'each',
    preferredSupplier: `Supplier ${index % 25}`,
    lastInvoiceDate: `2026-07-${pad((index % 28) + 1)}`,
  }))
);

export const createStaff = (count = 100) => (
  Array.from({ length: count }, (_, index) => ({
    id: `staff_${index + 1}`,
    name: `Staff ${index + 1}`,
    role: index % 10 === 0 ? 'Manager' : 'Team',
    staffSection: index % 2 === 0 ? 'kitchen' : 'waiters',
  }))
);

export const createInventoryMovements = (count = 500) => (
  Array.from({ length: count }, (_, index) => ({
    id: createRecordId('movement'),
    wasteEntryId: `waste_${index + 1}`,
    ingredientName: `Ingredient ${index % 500}`,
    quantity: (index % 5) + 1,
    unit: 'each',
    costImpact: (index % 35) + 1,
    createdAt: new Date(Date.UTC(2026, index % 12, (index % 28) + 1)).toISOString(),
  }))
);

export const createInvoices = (count = 100) => (
  Array.from({ length: count }, (_, index) => ({
    id: `invoice_${index + 1}`,
    supplier: `Supplier ${index % 25}`,
    invoiceNumber: `INV-${1000 + index}`,
    invoiceDate: `2026-07-${pad((index % 28) + 1)}`,
    totalExVAT: 500 + (index * 13),
    totalVAT: 75 + (index % 100),
    totalIncVAT: 575 + (index * 13),
    status: 'confirmed',
    lineItems: [
      {
        id: `invoice_${index + 1}_line_1`,
        itemName: `Ingredient ${index % 500}`,
        quantity: 2,
        unit: 'kg',
        priceExVAT: 100 + (index % 50),
        priceIncVAT: 115 + (index % 50),
      },
    ],
  }))
);

export const createLargeDataset = () => ({
  wasteItems1000: createWasteEntries(1000),
  wasteItems5000: createWasteEntries(5000),
  menuItems: createMenuItems(500),
  ingredients: createIngredients(500),
  staff: createStaff(100),
  inventoryMovements: createInventoryMovements(500),
  invoices: createInvoices(100),
});
