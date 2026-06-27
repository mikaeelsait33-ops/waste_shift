import fs from 'node:fs/promises';

import rawRecipeCatalog from '../src/data/rawRecipeCatalog.js';

const DEFAULT_ENDPOINT = 'https://wasteshift.vercel.app/api/database';
const endpoint = process.env.WASTESHIFT_DATABASE_URL || DEFAULT_ENDPOINT;
const shouldForce = process.argv.includes('--force');

const createMenuItemKey = (name) => String(name || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' ')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const parsePriceValue = (value) => {
  const cleanedValue = String(value ?? '').replace(/[^0-9.-]/g, '');
  const parsedValue = Number.parseFloat(cleanedValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const parseCsvRows = (csvText) => {
  const rows = [];
  let row = [];
  let field = '';
  let isInsideQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"' && isInsideQuotes && nextChar === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      isInsideQuotes = !isInsideQuotes;
    } else if (char === ',' && !isInsideQuotes) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !isInsideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i += 1;
      }

      row.push(field);
      if (row.some((cell) => cell.trim())) {
        rows.push(row);
      }

      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim())) {
    rows.push(row);
  }

  return rows;
};

const createMenuPriceMap = (csvText) => {
  const rows = parseCsvRows(csvText);
  const [headers = [], ...dataRows] = rows;
  const nameColumnIndex = headers.findIndex((header) => header.trim().toLowerCase() === 'name');
  const priceColumnIndex = headers.findIndex((header) => {
    const normalizedHeader = header.trim().toLowerCase().replace(/\s+/g, '_');
    return normalizedHeader === 'price' || normalizedHeader === 'menu_price';
  });

  if (nameColumnIndex === -1 || priceColumnIndex === -1) {
    return {};
  }

  return Object.fromEntries(
    dataRows
      .map((row) => {
        const key = createMenuItemKey(row[nameColumnIndex]);
        const price = parsePriceValue(row[priceColumnIndex]);

        return [key, price];
      })
      .filter(([key, price]) => key && price !== null)
  );
};

const splitMenuPriceAcrossIngredients = (menuPrice, ingredients) => {
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return [];
  }

  const totalCents = Math.round(menuPrice * 100);
  const baseCents = Math.floor(totalCents / ingredients.length);
  const remainderCents = totalCents - (baseCents * ingredients.length);

  return ingredients.map((ingredient, index) => ({
    ...ingredient,
    cost: (baseCents + (index < remainderCents ? 1 : 0)) / 100,
  }));
};

const createDefaultRecipes = async () => {
  const menuItemsCsv = await fs.readFile(new URL('../src/data/menuItems.csv', import.meta.url), 'utf8');
  const menuPrices = createMenuPriceMap(menuItemsCsv);

  return Object.fromEntries(
    Object.entries(rawRecipeCatalog).map(([key, recipe]) => {
      const menuPrice = menuPrices[key];

      if (!menuPrice) {
        return [key, recipe];
      }

      return [
        key,
        {
          ...recipe,
          menuPrice,
          costBasis: 'Menu price from menuItems.csv split evenly across listed ingredients.',
          ingredients: splitMenuPriceAcrossIngredients(menuPrice, recipe.ingredients),
        },
      ];
    })
  );
};

const createStaffMembers = async () => {
  const staffMembersCsv = await fs.readFile(new URL('../src/data/staffMembers.csv', import.meta.url), 'utf8');
  const rows = parseCsvRows(staffMembersCsv);
  const [headers = [], ...dataRows] = rows;
  const nameColumnIndex = headers.findIndex((header) => header.trim().toLowerCase() === 'name');
  const roleColumnIndex = headers.findIndex((header) => header.trim().toLowerCase() === 'role');
  const seenIds = new Set();

  if (nameColumnIndex === -1) {
    return [];
  }

  return dataRows
    .map((row) => {
      const name = row[nameColumnIndex]?.trim();

      if (!name) {
        return null;
      }

      const id = `staff_${createMenuItemKey(name)}`;

      return {
        id,
        name,
        role: roleColumnIndex === -1 ? 'Team' : row[roleColumnIndex]?.trim() || 'Team',
        isCsvSeed: true,
      };
    })
    .filter(Boolean)
    .filter((member) => {
      if (seenIds.has(member.id)) {
        return false;
      }

      seenIds.add(member.id);
      return true;
    });
};

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `Request failed with status ${response.status}.`);
  }

  return payload;
};

const existingDatabase = await requestJson(endpoint, { cache: 'no-store' });

if (existingDatabase.exists && !shouldForce) {
  console.log(JSON.stringify({
    seeded: false,
    reason: 'Server database already exists. Use --force to overwrite it with seed data.',
    recipeCount: Object.keys(existingDatabase.snapshot?.data?.recipes || {}).length,
    staffCount: existingDatabase.snapshot?.data?.staffList?.length || 0,
    updatedAt: existingDatabase.snapshot?.updatedAt || '',
  }, null, 2));
  process.exit(0);
}

const data = {
  wasteItems: [],
  budget: 500,
  settings: {
    dailyWasteValueLimit: 0,
    dailyWasteEntryLimit: 0,
  },
  recipes: await createDefaultRecipes(),
  staffList: await createStaffMembers(),
  customStaffList: [],
  customMenuItems: [],
  portionProfiles: {},
};

await requestJson(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ data }),
});

const savedDatabase = await requestJson(endpoint, { cache: 'no-store' });

console.log(JSON.stringify({
  seeded: true,
  recipeCount: Object.keys(savedDatabase.snapshot?.data?.recipes || {}).length,
  staffCount: savedDatabase.snapshot?.data?.staffList?.length || 0,
  updatedAt: savedDatabase.snapshot?.updatedAt || '',
}, null, 2));
