import { inferStaffSection } from './staffSections.js';
import { createRecordId } from './ids.js';
import {
  calculateRecipeIngredientCost,
  createItemPriceKey,
  normalizeRecipeIngredient,
} from './itemPriceCatalog.js';
import { sanitizePinRecord } from './pinAuth.js';
import { roundCurrency } from './wasteCalculations.js';

const DEFAULT_RECIPES = {};
export const DEFAULT_RECIPE_SEED_VERSION = 'fresh-restaurant-empty-v1';
const OLD_DEFAULT_COST_BASIS = 'Menu price from menuItems.csv split evenly across listed ingredients.';
const STAFF_FRESH_START_VERSION = 'empty-staff-roster-v1';

const ACCESS_ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Manager',
  chef: 'Chef',
  barista: 'Barista',
  waiter: 'Waiter',
};

export const DEFAULT_SETTINGS = {
  dailyWasteValueLimit: 0,
  dailyWasteEntryLimit: 0,
};

export const createSessionStaffFallback = (session) => {
  if (!session?.staffId) {
    return null;
  }

  const roleKey = String(session.roleKey || '').trim().toLowerCase();

  return {
    id: session.staffId,
    name: session.staffName || 'Current operator',
    role: ACCESS_ROLE_LABELS[roleKey] || 'Manager',
    roleKey,
    staffSection: roleKey === 'manager' || roleKey === 'owner' ? 'management' : '',
    isSessionFallback: true,
  };
};

export const staffFreshStartIsPending = () => (
  localStorage.getItem('wasteShiftStaffFreshStartVersion') !== STAFF_FRESH_START_VERSION
);

export const markStaffFreshStartComplete = () => {
  localStorage.setItem('wasteShiftStaffFreshStartVersion', STAFF_FRESH_START_VERSION);
};

export const markServerStaffFreshStartComplete = () => {
  localStorage.setItem('wasteShiftServerStaffFreshStartVersion', STAFF_FRESH_START_VERSION);
};

export const createAuditLogEntry = ({ action, user, relatedItem, beforeValue = null, afterValue = null }) => ({
  id: createRecordId('audit'),
  date: new Date().toISOString(),
  user: user || 'System',
  action,
  beforeValue,
  afterValue,
  relatedItem: relatedItem || '',
});

export const STAFF_SECTION_ROLE_LABELS = {
  kitchen: 'Kitchen Staff',
  waiters: 'Waiter',
  barista: 'Barista',
};

export const isRecipeMap = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const cloneRecipeMap = (recipeMap) => Object.fromEntries(
  Object.entries(recipeMap).map(([key, recipe]) => [
    key,
    {
      ...recipe,
      ingredients: Array.isArray(recipe.ingredients)
        ? recipe.ingredients.map(({ stock: _stock, ...ingredient }) => ({ ...ingredient }))
        : [],
    },
  ])
);

export const recalculateRecipesFromPriceCatalog = (recipeMap, itemPriceCatalog, updatedKeySet) => {
  const nextRecipes = {};
  const changedRecipes = [];

  Object.entries(isRecipeMap(recipeMap) ? recipeMap : {}).forEach(([key, recipe]) => {
    const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    let recipeChanged = false;

    const nextIngredients = ingredients.map((ingredient) => {
      const calculatedCost = calculateRecipeIngredientCost({ ingredient, itemPriceCatalog });
      const ingredientKey = createItemPriceKey(ingredient?.name);
      const linkedIngredientKey = String(ingredient?.ingredientId || ingredient?.priceCatalogKey || '').trim();
      const affectedByInvoice = calculatedCost.source === 'catalog'
        && (
          updatedKeySet.has(calculatedCost.priceCatalogKey)
          || updatedKeySet.has(calculatedCost.ingredientId)
          || updatedKeySet.has(linkedIngredientKey)
          || updatedKeySet.has(ingredientKey)
        );

      if (!affectedByInvoice) {
        return { ...ingredient };
      }

      const nextCost = roundCurrency(calculatedCost.baseCost);
      const existingCost = roundCurrency(Number(ingredient?.cost) || 0);
      const nextIngredient = {
        ...ingredient,
        cost: nextCost,
        costSource: 'catalog',
        ingredientId: calculatedCost.ingredientId || linkedIngredientKey,
        priceCatalogKey: calculatedCost.priceCatalogKey,
        pricePerUnit: calculatedCost.pricePerUnit,
        priceUnit: calculatedCost.priceUnit,
        costPerBaseUnit: calculatedCost.costPerBaseUnit,
        baseUnit: calculatedCost.baseUnit,
      };

      if (
        nextCost !== existingCost
        || ingredient.costSource !== nextIngredient.costSource
        || ingredient.priceCatalogKey !== nextIngredient.priceCatalogKey
        || ingredient.pricePerUnit !== nextIngredient.pricePerUnit
        || ingredient.priceUnit !== nextIngredient.priceUnit
        || ingredient.costPerBaseUnit !== nextIngredient.costPerBaseUnit
        || ingredient.baseUnit !== nextIngredient.baseUnit
      ) {
        recipeChanged = true;
      }

      return nextIngredient;
    });

    const totalCost = roundCurrency(
      nextIngredients.reduce((sum, ingredient) => sum + (Number(ingredient.cost) || 0), 0)
    );
    const currentTotalCost = roundCurrency(Number(recipe?.totalCost) || 0);
    const menuPrice = Number(recipe?.menuPrice);
    const nextRecipe = {
      ...recipe,
      ingredients: nextIngredients,
      totalCost,
      ...(Number.isFinite(menuPrice) && menuPrice > 0
        ? {
            margin: roundCurrency(menuPrice - totalCost),
            foodCostPercentage: roundCurrency((totalCost / menuPrice) * 100),
          }
        : {}),
    };

    if (recipeChanged || totalCost !== currentTotalCost) {
      changedRecipes.push([key, nextRecipe]);
    }

    nextRecipes[key] = nextRecipe;
  });

  return {
    nextRecipes,
    changedRecipes,
    repricedRecipes: changedRecipes.length,
  };
};

const removeOldSeededRecipes = (savedRecipeMap) => Object.fromEntries(
  Object.entries(cloneRecipeMap(savedRecipeMap)).filter(([, recipe]) => {
    const costBasis = String(recipe?.costBasis || '');
    return costBasis !== OLD_DEFAULT_COST_BASIS && !costBasis.includes('menuItems.csv');
  })
);

export const buildInitialRecipes = () => {
  const savedRecipes = localStorage.getItem('customRecipes');
  const savedSeedVersion = localStorage.getItem('defaultRecipeSeedVersion');
  const savedRecipeMap = savedRecipes ? JSON.parse(savedRecipes) : {};

  if (!isRecipeMap(savedRecipeMap) || !savedRecipes) {
    return cloneRecipeMap(DEFAULT_RECIPES);
  }

  if (savedSeedVersion !== DEFAULT_RECIPE_SEED_VERSION) {
    return removeOldSeededRecipes(savedRecipeMap);
  }

  return cloneRecipeMap(savedRecipeMap);
};

export const createMenuItemKey = (name) => String(name || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' ')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const parsePriceValue = (value) => {
  const cleanedValue = String(value ?? '').replace(/[^0-9.-]/g, '');
  const parsedValue = Number.parseFloat(cleanedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

export const createStaffMemberId = (name) => `staff_${createMenuItemKey(name)}`;

export const sanitizeMenuItems = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  const seenKeys = new Set();

  return items
    .map((item) => {
      const name = String(item?.name || '').trim();
      const key = item?.key || createMenuItemKey(name);

      if (!name || !key) {
        return null;
      }

      return {
        key,
        name,
        category: String(item?.category || '').trim(),
        menuPrice: parsePriceValue(item?.menuPrice ?? item?.price),
      };
    })
    .filter(Boolean)
    .filter((item) => {
      if (seenKeys.has(item.key)) return false;
      seenKeys.add(item.key);
      return true;
    });
};

export const sanitizePortionProfiles = (profiles) => {
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(profiles)
      .map(([profileKey, profile]) => {
        const name = String(profile?.name || '').trim();
        const amount = parseFloat(profile?.amount);
        const unit = String(profile?.unit || '').trim();
        const key = profile?.key || profileKey || createMenuItemKey(name);

        if (!key || !name || !Number.isFinite(amount) || amount <= 0 || !unit) {
          return null;
        }

        return [key, { key, name, amount, unit, updatedAt: profile?.updatedAt || '' }];
      })
      .filter(Boolean)
  );
};

export const sanitizeSettings = (settings) => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return DEFAULT_SETTINGS;
  }

  const dailyWasteValueLimit = parseFloat(settings.dailyWasteValueLimit);
  const dailyWasteEntryLimit = parseInt(settings.dailyWasteEntryLimit, 10);

  return {
    dailyWasteValueLimit: Number.isFinite(dailyWasteValueLimit) && dailyWasteValueLimit > 0 ? dailyWasteValueLimit : 0,
    dailyWasteEntryLimit: Number.isFinite(dailyWasteEntryLimit) && dailyWasteEntryLimit > 0 ? dailyWasteEntryLimit : 0,
  };
};

const attachRecipeInfo = (menuItem, recipes) => {
  const recipe = recipes?.[menuItem.key];
  return {
    ...menuItem,
    ingredientCount: Array.isArray(recipe?.ingredients) ? recipe.ingredients.length : 0,
  };
};

const menuRecordIsArchived = (record) => Boolean(record?.archived || record?.recipe?.archived);

export const mergeMenuItems = (baseMenuItems, customMenuItems, recipes) => {
  const activeBaseItems = baseMenuItems.filter((item) => !menuRecordIsArchived(item) && !recipes?.[item.key]?.archived);
  const activeCustomItems = customMenuItems.filter((item) => !menuRecordIsArchived(item) && !recipes?.[item.key]?.archived);
  const customByKey = new Map(activeCustomItems.map((item) => [item.key, item]));
  const baseKeys = new Set(activeBaseItems.map((item) => item.key));
  const mergedBaseItems = activeBaseItems.map((baseItem) => {
    const customItem = customByKey.get(baseItem.key);
    if (!customItem) return attachRecipeInfo(baseItem, recipes);

    return attachRecipeInfo({
      ...baseItem,
      menuPrice: customItem.menuPrice,
      category: customItem.category || baseItem.category || '',
    }, recipes);
  });
  const customOnlyItems = activeCustomItems
    .filter((item) => !baseKeys.has(item.key))
    .map((item) => attachRecipeInfo(item, recipes))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...mergedBaseItems, ...customOnlyItems];
};

export const createRecipeMapFromFirestoreMenuItems = (firestoreMenuItems) => (
  (Array.isArray(firestoreMenuItems) ? firestoreMenuItems : []).reduce((acc, item) => {
    const name = String(item?.name || '').trim();
    const key = item?.key || createMenuItemKey(name);

    if (!name || !key) return acc;

    acc[key] = {
      name,
      category: String(item?.category || '').trim(),
      ...(item.menuPrice !== null && item.menuPrice !== undefined ? { menuPrice: item.menuPrice } : {}),
      totalCost: item.totalCost || 0,
      firestoreId: item.firestoreId || key,
      archived: Boolean(item.archived),
      archivedAt: item.archivedAt || '',
      archivedBy: item.archivedBy || '',
      ingredients: (Array.isArray(item.components) ? item.components : []).map((component, index) => {
        const normalizedIngredient = normalizeRecipeIngredient({
          ...component,
          ingredientId: component.ingredientId || component.priceCatalogKey || '',
          priceCatalogKey: component.priceCatalogKey || component.ingredientId || '',
          quantity: component.quantity || component.quantityLabel || '',
          unit: component.unit || component.quantityUnit || '',
          cost: roundCurrency(component.cost),
        }, component.category || 'Other');

        return {
          componentKey: component.key || createMenuItemKey(`${normalizedIngredient.name}-${index}`),
          ...normalizedIngredient,
          quantity: normalizedIngredient.quantity || '1 each',
          cost: roundCurrency(component.cost),
          costPerBaseUnit: component.costPerBaseUnit ?? null,
          baseUnit: component.baseUnit || '',
          priceCatalogKey: component.priceCatalogKey || component.ingredientId || '',
          ingredientId: component.ingredientId || component.priceCatalogKey || '',
          displayName: component.displayName || normalizedIngredient.displayName || normalizedIngredient.name,
        };
      }),
    };
    return acc;
  }, {})
);

export const sanitizeStaffMembers = (members) => {
  if (!Array.isArray(members)) return [];
  const seenIds = new Set();

  return members
    .map((member) => {
      const name = String(member?.name || '').trim();
      const role = String(member?.role || '').trim();
      const id = member?.id || createStaffMemberId(name);

      if (!name || !role || !id) return null;

      return {
        id,
        name,
        role,
        staffSection: inferStaffSection(member?.staffSection || member?.section || role),
        staffCode: sanitizePinRecord(member?.staffCode),
        managerPin: sanitizePinRecord(member?.managerPin),
        removed: Boolean(member?.removed),
        removedAt: String(member?.removedAt || ''),
        isCsvSeed: false,
      };
    })
    .filter(Boolean)
    .filter((member) => {
      if (seenIds.has(member.id)) return false;
      seenIds.add(member.id);
      return true;
    });
};

export const stripStaffCredentialsForStorage = (members) => (
  sanitizeStaffMembers(members).map(({ staffCode: _staffCode, managerPin: _managerPin, ...member }) => member)
);

export const createStoreRoomItemId = (name) => `store_${createMenuItemKey(name)}`;

export const sanitizeStoreRoomItems = (items) => {
  if (!Array.isArray(items)) return [];
  const seenIds = new Set();

  return items
    .map((item) => {
      const name = String(item?.name || '').trim();
      const id = item?.id || createStoreRoomItemId(name);
      const quantity = Number.parseFloat(item?.quantity);
      const parLevel = Number.parseFloat(item?.parLevel);
      const reorderPoint = Number.parseFloat(item?.reorderPoint);

      if (!name || !id) return null;

      return {
        id,
        name,
        category: String(item?.category || 'Other').trim() || 'Other',
        unit: String(item?.unit || 'each').trim() || 'each',
        location: String(item?.location || '').trim(),
        quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity * 1000) / 1000 : 0,
        parLevel: Number.isFinite(parLevel) && parLevel > 0 ? Math.round(parLevel * 1000) / 1000 : 0,
        reorderPoint: Number.isFinite(reorderPoint) && reorderPoint > 0 ? Math.round(reorderPoint * 1000) / 1000 : 0,
        normalizedKey: item?.normalizedKey || createItemPriceKey(name),
        priceCatalogKey: String(item?.priceCatalogKey || createItemPriceKey(name)).trim(),
        supplier: String(item?.supplier || '').trim(),
        lastPrice: Number.isFinite(Number(item?.lastPrice)) ? Number(item.lastPrice) : null,
        notes: String(item?.notes || '').trim(),
        createdAt: String(item?.createdAt || ''),
        updatedAt: String(item?.updatedAt || ''),
        lastMovementAt: String(item?.lastMovementAt || ''),
      };
    })
    .filter(Boolean)
    .filter((item) => {
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const sanitizeStoreRoomMovements = (movements) => {
  if (!Array.isArray(movements)) return [];

  return movements.map((movement) => {
    const quantity = Number.parseFloat(movement?.quantity);
    const previousQuantity = Number.parseFloat(movement?.previousQuantity);
    const nextQuantity = Number.parseFloat(movement?.nextQuantity);
    const type = ['stock_in', 'stock_out', 'adjustment', 'opening'].includes(movement?.type)
      ? movement.type
      : 'adjustment';

    if (!movement?.itemId || !movement?.itemName || !Number.isFinite(quantity)) return null;

    return {
      id: String(movement?.id || createRecordId('store_movement')),
      itemId: String(movement.itemId),
      itemName: String(movement.itemName),
      type,
      quantity: Math.abs(Math.round(quantity * 1000) / 1000),
      unit: String(movement?.unit || '').trim(),
      previousQuantity: Number.isFinite(previousQuantity) ? Math.round(previousQuantity * 1000) / 1000 : 0,
      nextQuantity: Number.isFinite(nextQuantity) ? Math.round(nextQuantity * 1000) / 1000 : 0,
      reason: String(movement?.reason || '').trim(),
      notes: String(movement?.notes || '').trim(),
      staffId: String(movement?.staffId || ''),
      staffName: String(movement?.staffName || 'System'),
      createdAt: String(movement?.createdAt || new Date().toISOString()),
    };
  }).filter(Boolean);
};

export const mergeStaffMembers = (baseStaffMembers, customStaffMembers) => {
  const customById = new Map(customStaffMembers.map((member) => [member.id, member]));
  const baseIds = new Set(baseStaffMembers.map((member) => member.id));
  const mergedBaseMembers = baseStaffMembers
    .map((baseMember) => customById.get(baseMember.id) || baseMember)
    .filter((member) => !member.removed);
  const customOnlyMembers = customStaffMembers
    .filter((member) => !member.removed && !baseIds.has(member.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...mergedBaseMembers, ...customOnlyMembers];
};

export const mergeManagerAccountsIntoStaffList = (staffMembers, managerAccounts) => {
  const mergedById = new Map();

  sanitizeStaffMembers(staffMembers).forEach((member) => mergedById.set(member.id, member));
  sanitizeStaffMembers(managerAccounts).forEach((manager) => {
    const existingMember = mergedById.get(manager.id);
    mergedById.set(manager.id, {
      ...existingMember,
      ...manager,
      managerPin: manager.managerPin || existingMember?.managerPin || null,
      staffCode: existingMember?.staffCode || null,
      staffSection: 'management',
      role: 'Manager',
    });
  });

  return [...mergedById.values()].sort((a, b) => a.name.localeCompare(b.name));
};
