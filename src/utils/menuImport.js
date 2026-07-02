import { createRecordId } from './ids.js';
import { normalizeRecipeIngredient } from './itemPriceCatalog.js';

export const MENU_IMPORT_HIGH_CONFIDENCE = 0.8;
const GENERATED_WARNING_PATTERNS = [
  /^Missing item name\.$/,
  /^Item name cannot create a valid database key\.$/,
  /^Missing or invalid selling price\.$/,
  /^Duplicate of an existing menu item\.$/,
  /^Duplicate inside this import\.$/,
];

export const createMenuItemKey = (name) => String(name || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' ')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const parseMenuPrice = (value) => {
  const cleanedValue = String(value ?? '').replace(/[^0-9.-]/g, '');
  const parsedValue = Number.parseFloat(cleanedValue);

  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null;
};

const splitCsvLine = (line) => {
  const cells = [];
  let field = '';
  let isInsideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && isInsideQuotes && nextChar === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      isInsideQuotes = !isInsideQuotes;
    } else if (char === ',' && !isInsideQuotes) {
      cells.push(field.trim());
      field = '';
    } else {
      field += char;
    }
  }

  cells.push(field.trim());
  return cells;
};

export const parseMenuCsvText = (csvText) => {
  const rows = String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(splitCsvLine);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/\s+/g, '_'));
  const hasHeader = headers.some((header) => ['name', 'item', 'menu_item', 'price', 'selling_price', 'category'].includes(header));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const nameIndex = hasHeader
    ? headers.findIndex((header) => ['name', 'item', 'menu_item', 'menu_item_name'].includes(header))
    : 0;
  const priceIndex = hasHeader
    ? headers.findIndex((header) => ['price', 'selling_price', 'menu_price'].includes(header))
    : 1;
  const categoryIndex = hasHeader
    ? headers.findIndex((header) => ['category', 'section'].includes(header))
    : 2;
  const descriptionIndex = hasHeader
    ? headers.findIndex((header) => ['description', 'details'].includes(header))
    : 3;

  return dataRows
    .map((row) => ({
      name: row[nameIndex] || '',
      sellingPrice: priceIndex >= 0 ? parseMenuPrice(row[priceIndex]) : null,
      category: categoryIndex >= 0 ? row[categoryIndex] || '' : '',
      description: descriptionIndex >= 0 ? row[descriptionIndex] || '' : '',
      components: [],
      confidence: 0.86,
      warnings: [],
      source: 'csv',
    }))
    .filter((item) => item.name.trim());
};

export const parseMenuPlainText = (text) => (
  String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const priceMatch = line.match(/(?:R|ZAR)?\s*(\d+(?:[.,]\d{1,2})?)\s*$/i);
      const sellingPrice = priceMatch ? parseMenuPrice(priceMatch[1].replace(',', '.')) : null;
      const withoutPrice = priceMatch ? line.slice(0, priceMatch.index).trim() : line;
      const [categoryPart, itemPart] = withoutPrice.includes(':')
        ? withoutPrice.split(/:(.+)/).map((part) => part.trim())
        : ['', withoutPrice];

      return {
        name: itemPart || withoutPrice,
        sellingPrice,
        category: categoryPart || '',
        description: '',
        components: [],
        confidence: sellingPrice !== null ? 0.72 : 0.58,
        warnings: sellingPrice === null ? ['No selling price found.'] : [],
        source: 'text',
      };
    })
    .filter((item) => item.name.trim())
);

export const normalizeImportedMenuItem = (item, index = 0) => {
  const name = String(item?.name || item?.itemName || '').trim();
  const key = createMenuItemKey(name);
  const sellingPrice = parseMenuPrice(item?.sellingPrice ?? item?.menuPrice ?? item?.price);
  const components = (Array.isArray(item?.components) ? item.components : Array.isArray(item?.ingredients) ? item.ingredients : [])
    .map((component) => normalizeRecipeIngredient(component, item?.category || 'Other'))
    .filter((component) => component.name);
  const confidence = Math.max(0, Math.min(1, Number(item?.confidence) || 0));
  const warnings = Array.isArray(item?.warnings)
    ? item.warnings
      .map((warning) => String(warning || '').trim())
      .filter(Boolean)
      .filter((warning) => !GENERATED_WARNING_PATTERNS.some((pattern) => pattern.test(warning)))
    : [];

  if (!name) {
    warnings.push('Missing item name.');
  }

  if (!key) {
    warnings.push('Item name cannot create a valid database key.');
  }

  if (sellingPrice === null) {
    warnings.push('Missing or invalid selling price.');
  }

  return {
    reviewId: item?.reviewId || createRecordId('menu_review'),
    key,
    name,
    category: String(item?.category || '').trim(),
    sellingPrice,
    description: String(item?.description || '').trim(),
    portion: String(item?.portion || item?.size || '').trim(),
    components,
    confidence,
    warnings,
    approved: Boolean(item?.approved),
    rejected: Boolean(item?.rejected),
    source: String(item?.source || 'import'),
    rowNumber: Number(item?.rowNumber) || index + 1,
  };
};

export const normalizeImportedMenuItems = (items, existingItems = []) => {
  const existingKeys = new Set(
    (Array.isArray(existingItems) ? existingItems : [])
      .map((item) => createMenuItemKey(item?.name || item?.key))
      .filter(Boolean)
  );
  const seenKeys = new Set();

  return (Array.isArray(items) ? items : [])
    .map(normalizeImportedMenuItem)
    .map((item) => {
      const warnings = [...item.warnings];

      if (item.key && existingKeys.has(item.key)) {
        warnings.push('Duplicate of an existing menu item.');
      }

      if (item.key && seenKeys.has(item.key)) {
        warnings.push('Duplicate inside this import.');
      }

      if (item.key) {
        seenKeys.add(item.key);
      }

      return {
        ...item,
        warnings: [...new Set(warnings)],
        approved: item.approved && warnings.length === 0,
      };
    });
};

export const createImportHistoryRecord = ({
  importType,
  sourceName,
  importedBy,
  reviewedItems,
  warnings = [],
  errors = [],
}) => {
  const safeItems = Array.isArray(reviewedItems) ? reviewedItems : [];

  return {
    id: createRecordId('menu_import'),
    importType: String(importType || 'manual'),
    sourceName: String(sourceName || ''),
    createdAt: new Date().toISOString(),
    importedBy: String(importedBy || ''),
    extractedCount: safeItems.length,
    approvedCount: safeItems.filter((item) => item.approved && !item.rejected).length,
    rejectedCount: safeItems.filter((item) => item.rejected).length,
    warnings: warnings.map(String).filter(Boolean),
    errors: errors.map(String).filter(Boolean),
  };
};
