import menuItemsCsv from './menuItems.csv?raw';
import rawDefaultRecipes from './rawRecipeCatalog.js';

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

const menuPrices = createMenuPriceMap(menuItemsCsv);

const defaultRecipes = Object.fromEntries(
  Object.entries(rawDefaultRecipes).map(([key, recipe]) => {
    const menuPrice = menuPrices[key];

    if (!menuPrice) {
      return [key, recipe];
    }

    return [
      key,
      {
        ...recipe,
        menuPrice,
        costBasis: 'Menu price from menuItems.csv. Ingredient costs stay editable and are not inferred from revenue.',
      },
    ];
  })
);

export default defaultRecipes;
