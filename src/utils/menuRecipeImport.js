import { createRecordId } from './ids.js';
import {
  UNIT_CONVERSIONS,
  calculateRecipeIngredientCost,
  createItemPriceKey,
  formatIngredientQuantity,
  findItemPriceRecord,
  normalizeItemPriceUnit,
  normalizeRecipeIngredient,
  sanitizeItemPriceCatalog,
} from './itemPriceCatalog.js';
import { normalizeIngredientRecord } from './ingredientIntelligence.js';
import { createMenuItemKey } from './menuImport.js';

const toSafeString = (value) => String(value ?? '').trim();

const toSafeQuantity = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const getUnitFamily = (unit) => UNIT_CONVERSIONS[normalizeItemPriceUnit(unit)]?.family || '';

export const catalogUnitMismatch = (ingredientUnit, catalogRecord) => {
  if (!catalogRecord) {
    return false;
  }

  const ingredientFamily = getUnitFamily(ingredientUnit || 'each');
  const catalogFamily = getUnitFamily(catalogRecord.baseUnit || catalogRecord.unit || 'each');

  return Boolean(ingredientFamily && catalogFamily && ingredientFamily !== catalogFamily);
};

export const getMenuImportCatalogOptions = (itemPriceCatalog = {}) => (
  Object.values(sanitizeItemPriceCatalog(itemPriceCatalog))
    .map((record) => normalizeIngredientRecord(record) || record)
    .filter((record) => record?.key && record?.name)
    .sort((a, b) => a.name.localeCompare(b.name))
);

export const normalizeAiMenuDishes = (payload) => (
  (Array.isArray(payload?.dishes) ? payload.dishes : Array.isArray(payload) ? payload : [])
    .map((dish) => {
      const name = toSafeString(dish?.name);

      if (!name) {
        return null;
      }

      return {
        reviewId: dish?.reviewId || createRecordId('menu_dish'),
        key: dish?.key || createMenuItemKey(name),
        name,
        category: toSafeString(dish?.category) || 'Menu',
        sellingPrice: dish?.sellingPrice ?? null,
        instructions: toSafeString(dish?.instructions),
        confidence: Math.max(0, Math.min(1, Number(dish?.confidence) || 0.72)),
        warnings: Array.isArray(dish?.warnings) ? dish.warnings.map(toSafeString).filter(Boolean) : [],
        rejected: Boolean(dish?.rejected),
        ingredients: (Array.isArray(dish?.ingredients) ? dish.ingredients : Array.isArray(dish?.components) ? dish.components : [])
          .map((ingredient) => ({
            reviewId: ingredient?.reviewId || createRecordId('menu_ing'),
            name: toSafeString(ingredient?.name || ingredient?.ingredientName),
            quantity: toSafeQuantity(ingredient?.quantity) ?? 1,
            unit: normalizeItemPriceUnit(ingredient?.unit || 'each'),
            catalogKey: toSafeString(ingredient?.catalogKey || ingredient?.priceCatalogKey || ingredient?.ingredientId),
            createNewCatalogItem: Boolean(ingredient?.createNewCatalogItem),
          }))
          .filter((ingredient) => ingredient.name),
      };
    })
    .filter(Boolean)
);

export const createMenuRecipeReview = (dishes = [], itemPriceCatalog = {}) => {
  const catalog = sanitizeItemPriceCatalog(itemPriceCatalog);

  return normalizeAiMenuDishes({ dishes }).map((dish) => ({
    ...dish,
    ingredients: dish.ingredients.map((ingredient) => {
      const explicitRecord = ingredient.catalogKey ? findItemPriceRecord(catalog, ingredient.catalogKey) : null;
      const autoRecord = explicitRecord || findItemPriceRecord(catalog, ingredient.name);
      const unitMismatch = catalogUnitMismatch(ingredient.unit, autoRecord);
      const normalizedIngredient = normalizeRecipeIngredient({
        ingredientId: autoRecord?.ingredientId || autoRecord?.key || '',
        priceCatalogKey: autoRecord?.key || '',
        name: ingredient.name,
        quantity: formatIngredientQuantity(ingredient.quantity, ingredient.unit),
        quantityValue: ingredient.quantity,
        unit: ingredient.unit,
        category: autoRecord?.category || dish.category,
      }, autoRecord?.category || dish.category);
      const cost = calculateRecipeIngredientCost({ ingredient: normalizedIngredient, itemPriceCatalog: catalog });

      return {
        ...ingredient,
        catalogKey: autoRecord?.key || '',
        ingredientId: autoRecord?.ingredientId || autoRecord?.key || '',
        matchedName: autoRecord?.name || '',
        unitMismatch,
        warnings: [
          ...(!autoRecord ? ['No catalog match yet.'] : []),
          ...(unitMismatch ? [`Unit review needed: recipe uses ${ingredient.unit}, catalog is ${autoRecord.baseUnit || autoRecord.unit}.`] : []),
        ],
        cost: cost.cost,
        costSource: cost.source,
        costPerBaseUnit: cost.costPerBaseUnit ?? null,
        baseUnit: cost.baseUnit || autoRecord?.baseUnit || '',
      };
    }),
  }));
};

export const buildMenuImportSaveItems = (reviewDishes = [], itemPriceCatalog = {}) => {
  const catalog = sanitizeItemPriceCatalog(itemPriceCatalog);

  return normalizeAiMenuDishes({ dishes: reviewDishes })
    .filter((dish) => !dish.rejected && dish.name && dish.ingredients.length > 0)
    .map((dish) => ({
      key: dish.key || createMenuItemKey(dish.name),
      name: dish.name,
      category: dish.category,
      sellingPrice: dish.sellingPrice,
      menuPrice: dish.sellingPrice,
      instructions: dish.instructions,
      ingredients: dish.ingredients.map((ingredient) => {
        const record = ingredient.catalogKey ? findItemPriceRecord(catalog, ingredient.catalogKey) : findItemPriceRecord(catalog, ingredient.name);
        const normalizedIngredient = normalizeRecipeIngredient({
          ingredientId: record?.ingredientId || record?.key || ingredient.ingredientId || ingredient.catalogKey || createItemPriceKey(ingredient.name),
          priceCatalogKey: record?.key || ingredient.catalogKey || createItemPriceKey(ingredient.name),
          displayName: ingredient.name,
          name: ingredient.name,
          quantity: formatIngredientQuantity(ingredient.quantity, ingredient.unit),
          quantityValue: ingredient.quantity,
          unit: ingredient.unit,
          category: record?.category || dish.category,
        }, record?.category || dish.category);
        const cost = calculateRecipeIngredientCost({ ingredient: normalizedIngredient, itemPriceCatalog: catalog });

        return {
          ...normalizedIngredient,
          ingredientId: record?.ingredientId || record?.key || normalizedIngredient.ingredientId || '',
          priceCatalogKey: record?.key || normalizedIngredient.priceCatalogKey || '',
          cost: cost.cost,
          costPerBaseUnit: cost.costPerBaseUnit ?? null,
          baseUnit: cost.baseUnit || record?.baseUnit || '',
        };
      }),
    }));
};
