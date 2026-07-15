import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Navbar from './components/Navbar';
import WasteForm from './components/WasteForm';
import AuthGate from './components/AuthGate';
import ErrorBoundary from './components/ErrorBoundary';
import { inferStaffSection } from './utils/staffSections';
import { getAccessProfile, inferRoleKey, requirePermission } from './utils/accessControl';
import { createRecordId } from './utils/ids';
import {
  calculateItemPriceCost,
  calculateRecipeIngredientCost,
  createItemPriceCatalogFromInvoice,
  createItemPriceKey,
  normalizeRecipeIngredient,
  sanitizeItemPriceCatalog,
  sanitizeItemPriceRecord,
} from './utils/itemPriceCatalog';
import {
  DEFAULT_AUTH_SETTINGS,
  authPinsAreConfigured,
  createPinRecord,
  sanitizeAuthSettings,
  sanitizePinRecord,
  verifyPin,
} from './utils/pinAuth';
import {
  buildRecipeIngredientBreakdown,
  createInventoryMovementsFromEntry,
  getEntryFoodCostLost,
  roundCurrency,
} from './utils/wasteCalculations';
import {
  archiveFirestoreMenuItem,
  firestoreIsConfigured,
  getFirestoreRuntimeInfo,
  deleteFirestoreMenuItems,
  loadFirestoreDatabaseSnapshot,
  loadFirestoreMenuItems,
  restoreFirestoreMenuItem,
  saveFirestoreDatabaseSnapshot,
  saveFirestoreMenuItem,
  saveFirestoreRecipe,
  saveFirestoreWasteEntry,
} from './services/firestoreMenuItems';
import { deleteIngredient, loadInvoiceDashboardStats, saveIngredientPriceRecord } from './services/invoiceFirestore';
import {
  createDefaultRestaurantProfile,
  loadCachedRestaurantProfile,
  loadRestaurantProfile,
  resetRestaurantFirestoreData,
  saveMenuImportHistory,
  saveRestaurantProfile,
} from './services/restaurantFirestore';
import { saveCurrentUserStaffProfile } from './services/firebaseAccess';
import { loadManagerAccounts, saveManagerAccount } from './services/managerAccounts';
import { establishManagerSession, recoverManagerSession, revokeManagerSession } from './services/managerSession';
import {
  establishStaffSession,
  revokeStaffSession,
  saveStaffAccessAccount,
} from './services/staffSession';
import { useRestaurantAccess } from './hooks/useRestaurantAccess';
import { useWasteHistoryPagination } from './hooks/useWasteHistoryPagination';
import {
  createEmptyRestaurantData,
  getRestaurantResetStorageKeys,
  validateRestaurantResetConfirmation,
} from './utils/restaurantReset';
import { getActiveWasteEntries } from './utils/wasteSync';
import { getClientDatabaseHeaders, getClientDatabaseId } from './utils/clientDatabaseId';
import {
  clearPersistedAuthSession,
  loadPersistedAuthSession,
  savePersistedAuthSession,
} from './utils/sessionPersistence';

const DEFAULT_RECIPES = {};
const DEFAULT_RECIPE_SEED_VERSION = 'fresh-restaurant-empty-v1';
const SERVER_DATABASE_ENDPOINT = '/api/database';
const FIRESTORE_RUNTIME_INFO = getFirestoreRuntimeInfo();
const E2E_TEST_MODE = import.meta.env.VITE_WASTESHIFT_E2E === 'true';
const FIRESTORE_CONFIGURED = !E2E_TEST_MODE && firestoreIsConfigured();
const OLD_DEFAULT_COST_BASIS = 'Menu price from menuItems.csv split evenly across listed ingredients.';
const STAFF_FRESH_START_VERSION = 'empty-staff-roster-v1';
const ACCESS_ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Manager',
  chef: 'Chef',
  barista: 'Barista',
  waiter: 'Waiter',
};
const DEFAULT_SETTINGS = {
  dailyWasteValueLimit: 0,
  dailyWasteEntryLimit: 0,
};

const createSessionStaffFallback = (session) => {
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

const Dashboard = lazy(() => import('./components/Dashboard'));
const InvoiceScanner = lazy(() => import('./components/InvoiceScanner'));
const ItemPriceManager = lazy(() => import('./components/ItemPriceManager'));
const RecipeManager = lazy(() => import('./components/RecipeManager'));
const Reports = lazy(() => import('./components/Reports'));
const Settings = lazy(() => import('./components/Settings'));
const SetupWizard = lazy(() => import('./components/SetupWizard'));
const StoreRoom = lazy(() => import('./components/StoreRoom'));
const WasteList = lazy(() => import('./components/WasteList'));

const PageFallback = ({ label = 'Loading screen' }) => (
  <div className="panel">
    <div className="panel-body">
      <div className="muted-box" style={{ marginBottom: 0 }}>{label}...</div>
    </div>
  </div>
);

const staffFreshStartIsPending = () => (
  localStorage.getItem('wasteShiftStaffFreshStartVersion') !== STAFF_FRESH_START_VERSION
);

const markStaffFreshStartComplete = () => {
  localStorage.setItem('wasteShiftStaffFreshStartVersion', STAFF_FRESH_START_VERSION);
};

const markServerStaffFreshStartComplete = () => {
  localStorage.setItem('wasteShiftServerStaffFreshStartVersion', STAFF_FRESH_START_VERSION);
};

const createAuditLogEntry = ({ action, user, relatedItem, beforeValue = null, afterValue = null }) => ({
  id: createRecordId('audit'),
  date: new Date().toISOString(),
  user: user || 'System',
  action,
  beforeValue,
  afterValue,
  relatedItem: relatedItem || '',
});

const STAFF_SECTION_ROLE_LABELS = {
  kitchen: 'Kitchen Staff',
  waiters: 'Waiter',
  barista: 'Barista',
};

const isRecipeMap = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const cloneRecipeMap = (recipeMap) => Object.fromEntries(
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

const recalculateRecipesFromPriceCatalog = (recipeMap, itemPriceCatalog, updatedKeySet) => {
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

const buildInitialRecipes = () => {
  const savedRecipes = localStorage.getItem('customRecipes');
  const savedSeedVersion = localStorage.getItem('defaultRecipeSeedVersion');
  const savedRecipeMap = savedRecipes ? JSON.parse(savedRecipes) : {};

  if (!isRecipeMap(savedRecipeMap)) {
    return cloneRecipeMap(DEFAULT_RECIPES);
  }

  if (!savedRecipes) {
    return cloneRecipeMap(DEFAULT_RECIPES);
  }

  if (savedSeedVersion !== DEFAULT_RECIPE_SEED_VERSION) {
    return removeOldSeededRecipes(savedRecipeMap);
  }

  return cloneRecipeMap(savedRecipeMap);
};

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

const createStaffMemberId = (name) => `staff_${createMenuItemKey(name)}`;

const sanitizeMenuItems = (items) => {
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
      if (seenKeys.has(item.key)) {
        return false;
      }

      seenKeys.add(item.key);
      return true;
    });
};

const sanitizePortionProfiles = (profiles) => {
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

        return [key, {
          key,
          name,
          amount,
          unit,
          updatedAt: profile?.updatedAt || '',
        }];
      })
      .filter(Boolean)
  );
};

const sanitizeSettings = (settings) => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return DEFAULT_SETTINGS;
  }

  const dailyWasteValueLimit = parseFloat(settings.dailyWasteValueLimit);
  const dailyWasteEntryLimit = parseInt(settings.dailyWasteEntryLimit, 10);

  return {
    dailyWasteValueLimit: Number.isFinite(dailyWasteValueLimit) && dailyWasteValueLimit > 0
      ? dailyWasteValueLimit
      : 0,
    dailyWasteEntryLimit: Number.isFinite(dailyWasteEntryLimit) && dailyWasteEntryLimit > 0
      ? dailyWasteEntryLimit
      : 0,
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

const mergeMenuItems = (baseMenuItems, customMenuItems, recipes) => {
  const activeBaseItems = baseMenuItems.filter((item) => !menuRecordIsArchived(item) && !recipes?.[item.key]?.archived);
  const activeCustomItems = customMenuItems.filter((item) => !menuRecordIsArchived(item) && !recipes?.[item.key]?.archived);
  const customByKey = new Map(activeCustomItems.map((item) => [item.key, item]));
  const baseKeys = new Set(activeBaseItems.map((item) => item.key));
  const mergedBaseItems = activeBaseItems.map((baseItem) => {
    const customItem = customByKey.get(baseItem.key);

    if (!customItem) {
      return attachRecipeInfo(baseItem, recipes);
    }

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

const createRecipeMapFromFirestoreMenuItems = (firestoreMenuItems) => (
  (Array.isArray(firestoreMenuItems) ? firestoreMenuItems : []).reduce((acc, item) => {
    const name = String(item?.name || '').trim();
    const key = item?.key || createMenuItemKey(name);

    if (!name || !key) {
      return acc;
    }

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

const sanitizeStaffMembers = (members) => {
  if (!Array.isArray(members)) {
    return [];
  }

  const seenIds = new Set();

  return members
    .map((member) => {
      const name = String(member?.name || '').trim();
      const role = String(member?.role || '').trim();
      const id = member?.id || createStaffMemberId(name);

      if (!name || !role || !id) {
        return null;
      }

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
      if (seenIds.has(member.id)) {
        return false;
      }

      seenIds.add(member.id);
      return true;
    });
};

const stripStaffCredentialsForStorage = (members) => (
  sanitizeStaffMembers(members).map(({
    staffCode: _staffCode,
    managerPin: _managerPin,
    ...member
  }) => member)
);

const createStoreRoomItemId = (name) => `store_${createMenuItemKey(name)}`;

const sanitizeStoreRoomItems = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  const seenIds = new Set();

  return items
    .map((item) => {
      const name = String(item?.name || '').trim();
      const id = item?.id || createStoreRoomItemId(name);
      const quantity = Number.parseFloat(item?.quantity);
      const parLevel = Number.parseFloat(item?.parLevel);
      const reorderPoint = Number.parseFloat(item?.reorderPoint);

      if (!name || !id) {
        return null;
      }

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
      if (seenIds.has(item.id)) {
        return false;
      }

      seenIds.add(item.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

const sanitizeStoreRoomMovements = (movements) => {
  if (!Array.isArray(movements)) {
    return [];
  }

  return movements
    .map((movement) => {
      const quantity = Number.parseFloat(movement?.quantity);
      const previousQuantity = Number.parseFloat(movement?.previousQuantity);
      const nextQuantity = Number.parseFloat(movement?.nextQuantity);
      const type = ['stock_in', 'stock_out', 'adjustment', 'opening'].includes(movement?.type)
        ? movement.type
        : 'adjustment';

      if (!movement?.itemId || !movement?.itemName || !Number.isFinite(quantity)) {
        return null;
      }

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
    })
    .filter(Boolean);
};

const mergeStaffMembers = (baseStaffMembers, customStaffMembers) => {
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

const mergeManagerAccountsIntoStaffList = (staffMembers, managerAccounts) => {
  const mergedById = new Map();

  sanitizeStaffMembers(staffMembers).forEach((member) => {
    mergedById.set(member.id, member);
  });

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

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [inventoryView, setInventoryView] = useState('invoices');
  const [menuPricingView, setMenuPricingView] = useState('recipes');
  const [serverSyncEnabled, setServerSyncEnabled] = useState(false);
  const [serverLoadComplete, setServerLoadComplete] = useState(false);
  const [managerAccountsLoaded, setManagerAccountsLoaded] = useState(!FIRESTORE_CONFIGURED);
  const [serverSync, setServerSync] = useState({
    status: FIRESTORE_CONFIGURED ? 'ready' : 'checking',
    message: FIRESTORE_CONFIGURED
      ? 'Firebase is the primary database. Local browser storage is only a fallback.'
      : 'Checking for Vercel backup database...',
    lastSavedAt: '',
  });
  const [firebaseSync, setFirebaseSync] = useState({
    status: FIRESTORE_CONFIGURED ? 'checking' : 'local',
    message: FIRESTORE_CONFIGURED
      ? `Connecting to Firebase${FIRESTORE_RUNTIME_INFO.projectId ? ` project ${FIRESTORE_RUNTIME_INFO.projectId}` : ''}...`
      : 'Firebase env vars are not configured. Live records stay in this browser.',
    lastSavedAt: '',
    menuItemCount: 0,
    projectId: FIRESTORE_RUNTIME_INFO.projectId,
  });
  const [restaurantProfile, setRestaurantProfile] = useState(loadCachedRestaurantProfile);
  const [restaurantProfileStatus, setRestaurantProfileStatus] = useState(FIRESTORE_CONFIGURED ? 'loading' : 'missing-config');
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ));
  const [syncAccessKey, setSyncAccessKey] = useState(() => {
    localStorage.removeItem('wasteShiftSyncAccessKey');
    return '';
  });
  const [authSession, setAuthSession] = useState(() => {
    try {
      if (staffFreshStartIsPending()) {
        clearPersistedAuthSession();
        return null;
      }

      return loadPersistedAuthSession(getClientDatabaseId());
    } catch {
      return null;
    }
  });
  const [isPreparingAuth, setIsPreparingAuth] = useState(false);

  const [wasteItems, setWasteItems] = useState(() => {
    try {
      const savedItems = localStorage.getItem('wasteItems');
      const parsed = savedItems ? JSON.parse(savedItems) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Corrupted waste items in storage, resetting.", e);
      return [];
    }
  });

  const [budget, setBudget] = useState(() => {
    const savedBudget = localStorage.getItem('wasteBudget');
    return savedBudget ? parseFloat(savedBudget) : 500; 
  });

  const [settings, setSettings] = useState(() => {
    try {
      const savedSettings = localStorage.getItem('wasteShiftSettings');
      const parsed = savedSettings ? JSON.parse(savedSettings) : DEFAULT_SETTINGS;
      return sanitizeSettings(parsed);
    } catch (e) {
      console.error("Corrupted settings in storage, resetting.", e);
      return DEFAULT_SETTINGS;
    }
  });

  const [authSettings, setAuthSettings] = useState(() => {
    try {
      const savedAuthSettings = localStorage.getItem('wasteShiftAuthSettings');
      const parsed = savedAuthSettings ? JSON.parse(savedAuthSettings) : DEFAULT_AUTH_SETTINGS;
      return sanitizeAuthSettings(parsed);
    } catch (e) {
      console.error("Corrupted auth settings in storage, resetting.", e);
      return DEFAULT_AUTH_SETTINGS;
    }
  });

  const [activeStaffId, setActiveStaffId] = useState(() => (
    staffFreshStartIsPending() ? '' : localStorage.getItem('activeStaffId') || ''
  ));

  const [inventoryMovements, setInventoryMovements] = useState(() => {
    try {
      const savedMovements = localStorage.getItem('inventoryMovements');
      const parsed = savedMovements ? JSON.parse(savedMovements) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Corrupted inventory movement history in storage, resetting.", e);
      return [];
    }
  });

  const [auditLog, setAuditLog] = useState(() => {
    try {
      const savedAuditLog = localStorage.getItem('auditLog');
      const parsed = savedAuditLog ? JSON.parse(savedAuditLog) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Corrupted audit log in storage, resetting.", e);
      return [];
    }
  });

  const [lastSavedAt, setLastSavedAt] = useState(() => localStorage.getItem('wasteShiftLastSavedAt') || '');
  const [invoiceDashboardStats, setInvoiceDashboardStats] = useState({
    totalSpendThisMonth: 0,
    topIngredients: [],
    priceIncreasesThisMonth: [],
    lowStockCount: 0,
    lastInvoice: null,
  });

  // Custom dynamic recipe database state loop
  const [recipes, setRecipes] = useState(() => {
    try {
      return buildInitialRecipes();
    } catch (e) {
      console.error("Corrupted recipes in storage, resetting.", e);
      return cloneRecipeMap(DEFAULT_RECIPES);
    }
  });

  const [customStaffList, setCustomStaffList] = useState(() => {
    try {
      if (staffFreshStartIsPending()) {
        localStorage.removeItem('customStaffList');
        localStorage.removeItem('staffList');
        localStorage.removeItem('activeStaffId');
        clearPersistedAuthSession();
        markStaffFreshStartComplete();
        return [];
      }

      const savedCustomStaff = localStorage.getItem('customStaffList');
      const savedLegacyStaff = localStorage.getItem('staffList');
      const parsed = savedCustomStaff
        ? JSON.parse(savedCustomStaff)
        : savedLegacyStaff
          ? JSON.parse(savedLegacyStaff)
          : [];

      return sanitizeStaffMembers(parsed);
    } catch (e) {
      console.error("Corrupted staff list in storage, resetting.", e);
      return [];
    }
  });

  const [customMenuItems, setCustomMenuItems] = useState(() => {
    try {
      const savedMenuItems = localStorage.getItem('customMenuItems');
      const parsed = savedMenuItems ? JSON.parse(savedMenuItems) : [];
      return sanitizeMenuItems(parsed);
    } catch (e) {
      console.error("Corrupted menu items in storage, resetting.", e);
      return [];
    }
  });

  const [firestoreMenuItems, setFirestoreMenuItems] = useState([]);

  const [portionProfiles, setPortionProfiles] = useState(() => {
    try {
      const savedProfiles = localStorage.getItem('portionProfiles');
      const parsed = savedProfiles ? JSON.parse(savedProfiles) : {};
      return sanitizePortionProfiles(parsed);
    } catch (e) {
      console.error("Corrupted portion profiles in storage, resetting.", e);
      return {};
    }
  });

  const [itemPriceCatalog, setItemPriceCatalog] = useState(() => {
    try {
      const savedCatalog = localStorage.getItem('itemPriceCatalog');
      const parsed = savedCatalog ? JSON.parse(savedCatalog) : {};
      return sanitizeItemPriceCatalog(parsed);
    } catch (e) {
      console.error("Corrupted item price catalog in storage, resetting.", e);
      return {};
    }
  });

  const [storeRoomItems, setStoreRoomItems] = useState(() => {
    try {
      const savedItems = localStorage.getItem('storeRoomItems');
      const parsed = savedItems ? JSON.parse(savedItems) : [];
      return sanitizeStoreRoomItems(parsed);
    } catch (e) {
      console.error("Corrupted store room items in storage, resetting.", e);
      return [];
    }
  });

  const [storeRoomMovements, setStoreRoomMovements] = useState(() => {
    try {
      const savedMovements = localStorage.getItem('storeRoomMovements');
      const parsed = savedMovements ? JSON.parse(savedMovements) : [];
      return sanitizeStoreRoomMovements(parsed);
    } catch (e) {
      console.error("Corrupted store room movements in storage, resetting.", e);
      return [];
    }
  });

  const handleSessionRejected = useCallback(() => {
    clearPersistedAuthSession();
    setAuthSession(null);
    setActiveStaffId('');
  }, []);
  const appendWasteHistoryEntries = useCallback((entries) => {
    setWasteItems((currentItems) => {
      const knownIds = new Set(currentItems.map((item) => item.id));
      return [...entries.filter((entry) => !knownIds.has(entry.id)), ...currentItems];
    });
  }, []);
  const {
    hasMore: hasOlderWasteEntries,
    isLoading: isLoadingOlderWasteEntries,
    loadInitialPage: loadInitialWasteHistoryPage,
    loadOlderPage: handleLoadOlderWasteEntries,
  } = useWasteHistoryPagination({
    enabled: FIRESTORE_CONFIGURED,
    onAppendEntries: appendWasteHistoryEntries,
  });
  const {
    directoryLoaded,
    sessionValidationStatus,
    staffDirectory,
  } = useRestaurantAccess({
    firebaseConfigured: FIRESTORE_CONFIGURED,
    restaurantReady: restaurantProfile.setupCompleted,
    authSession,
    onSessionRejected: handleSessionRejected,
  });

  useEffect(() => {
    if (!staffFreshStartIsPending()) {
      return;
    }

    localStorage.removeItem('customStaffList');
    localStorage.removeItem('staffList');
    localStorage.removeItem('activeStaffId');
    clearPersistedAuthSession();
    setCustomStaffList([]);
    setActiveStaffId('');
    setAuthSession(null);
    markStaffFreshStartComplete();
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadProfile = async () => {
      if (!FIRESTORE_CONFIGURED) {
        setRestaurantProfile(loadCachedRestaurantProfile());
        setRestaurantProfileStatus('missing-config');
        return;
      }

      setRestaurantProfileStatus('loading');

      try {
        const result = await loadRestaurantProfile();

        if (!isCancelled) {
          if (result.didAdoptSingleShop) {
            // Restart the initial data loaders after a fresh device has joined the one shop.
            window.location.reload();
            return;
          }

          setRestaurantProfile(result.profile || createDefaultRestaurantProfile());
          setRestaurantProfileStatus('ready');
        }
      } catch (error) {
        console.warn('Restaurant profile unavailable.', error);

        if (!isCancelled) {
          const cachedProfile = loadCachedRestaurantProfile();
          setRestaurantProfile(cachedProfile);
          setRestaurantProfileStatus(cachedProfile.setupCompleted ? 'offline' : 'error');
          setFirebaseSync(prev => ({
            ...prev,
            status: 'error',
            message: `${error?.message || 'Restaurant profile could not load.'} Setup cannot finish until Firebase is available.`,
          }));
        }
      }
    };

    loadProfile();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!directoryLoaded) return;

    if (staffDirectory.length > 0) {
      setCustomStaffList((currentStaff) => {
        const staffById = new Map(currentStaff.map((member) => [member.id, member]));
        staffDirectory.forEach((member) => {
          staffById.set(member.id, {
            ...staffById.get(member.id),
            ...member,
            staffCode: staffById.get(member.id)?.staffCode || null,
            managerPin: null,
          });
        });
        return sanitizeStaffMembers([...staffById.values()]);
      });
    }
    setManagerAccountsLoaded(true);
  }, [directoryLoaded, staffDirectory]);

  useEffect(() => {
    let isCancelled = false;

    const loadMenuItems = async () => {
      if (!FIRESTORE_CONFIGURED) {
        setFirebaseSync(prev => ({
          ...prev,
          status: 'local',
          message: 'Firebase env vars are not configured. Live records stay in this browser.',
        }));
        return;
      }

      if (!authSession || sessionValidationStatus !== 'ready') {
        return;
      }

      setFirebaseSync(prev => ({
        ...prev,
        status: 'checking',
        message: `Connecting to Firebase${prev.projectId ? ` project ${prev.projectId}` : ''}...`,
      }));

      try {
        const loadedMenuItems = await loadFirestoreMenuItems();

        if (!isCancelled) {
          setFirestoreMenuItems(loadedMenuItems);
          setFirebaseSync(prev => ({
            ...prev,
            status: 'ready',
            message: loadedMenuItems.length > 0
              ? `Firebase connected. Loaded ${loadedMenuItems.length} menu item${loadedMenuItems.length === 1 ? '' : 's'}.`
              : 'Firebase connected. No Firestore menu items have been added yet.',
            lastSavedAt: new Date().toISOString(),
            menuItemCount: loadedMenuItems.length,
          }));
        }
      } catch (error) {
        console.warn('Firestore menu items unavailable. Using local menu data.', error);
        if (!isCancelled) {
          setFirebaseSync(prev => ({
            ...prev,
            status: 'error',
            message: `${error?.message || 'Firebase is unavailable.'} Local menu data is still available.`,
          }));
        }
      }
    };

    loadMenuItems();

    return () => {
      isCancelled = true;
    };
  }, [authSession, sessionValidationStatus]);

  const firestoreRecipeMap = useMemo(() => (
    createRecipeMapFromFirestoreMenuItems(firestoreMenuItems)
  ), [firestoreMenuItems]);
  const effectiveRecipes = useMemo(() => ({
    ...recipes,
    ...firestoreRecipeMap,
  }), [recipes, firestoreRecipeMap]);
  const firestoreMenuItemCatalogRows = useMemo(() => (
    firestoreMenuItems.map((item) => {
      const key = item.key || createMenuItemKey(item.name);
      const recipe = effectiveRecipes[key];

      return {
        key,
        name: item.name,
        category: item.category || recipe?.category || '',
        menuPrice: item.menuPrice,
        totalCost: item.totalCost,
        ingredientCount: Array.isArray(recipe?.ingredients) ? recipe.ingredients.length : 0,
        firestoreId: item.firestoreId,
        archived: Boolean(item.archived || recipe?.archived),
        archivedAt: item.archivedAt || recipe?.archivedAt || '',
        archivedBy: item.archivedBy || recipe?.archivedBy || '',
      };
    })
  ), [effectiveRecipes, firestoreMenuItems]);
  const baseMenuItems = useMemo(() => {
    const mergedByKey = new Map();

    firestoreMenuItemCatalogRows.forEach((item) => {
      if (item.key) {
        mergedByKey.set(item.key, item);
      }
    });

    return [...mergedByKey.values()];
  }, [firestoreMenuItemCatalogRows]);
  const menuItems = useMemo(() => (
    mergeMenuItems(baseMenuItems, customMenuItems, effectiveRecipes)
  ), [baseMenuItems, customMenuItems, effectiveRecipes]);
  const refreshInvoiceDashboardStats = useCallback(async () => {
    if (!FIRESTORE_CONFIGURED) {
      setInvoiceDashboardStats(null);
      return;
    }

    try {
      setInvoiceDashboardStats(await loadInvoiceDashboardStats());
    } catch (error) {
      console.warn('Invoice dashboard stats unavailable.', error);
    }
  }, []);
  const baseStaffList = useMemo(() => [], []);
  const staffList = useMemo(() => (
    mergeStaffMembers(baseStaffList, customStaffList)
  ), [baseStaffList, customStaffList]);
  const activeStaffMember = useMemo(() => (
    staffList.find((member) => member.id === activeStaffId)
    || createSessionStaffFallback(authSession)
  ), [activeStaffId, authSession, staffList]);
  const accessProfile = useMemo(() => getAccessProfile(activeStaffMember), [activeStaffMember]);
  const activeWasteItems = useMemo(() => getActiveWasteEntries(wasteItems), [wasteItems]);
  const activeManagerAccounts = useMemo(() => staffList.filter((member) => (
    !member.removed
    && (member.staffSection === 'management' || inferRoleKey(member.role) === 'manager' || inferRoleKey(member.role) === 'owner')
  )), [staffList]);
  const managerRecoveryRequired = FIRESTORE_CONFIGURED
    && restaurantProfile?.setupCompleted === true
    && directoryLoaded
    && !staffDirectory.some((member) => ['owner', 'manager'].includes(inferRoleKey(member.roleKey || member.role)));
  const managerAuthIsConfigured = useMemo(() => (
    restaurantProfile?.setupCompleted === true
    || activeManagerAccounts.some((member) => sanitizePinRecord(member.managerPin))
    || authPinsAreConfigured(authSettings)
  ), [activeManagerAccounts, authSettings, restaurantProfile?.setupCompleted]);

  useEffect(() => {
    if (authSession && accessProfile.canViewFinancials && sessionValidationStatus === 'ready') {
      refreshInvoiceDashboardStats();
    }
  }, [accessProfile.canViewFinancials, authSession, refreshInvoiceDashboardStats, sessionValidationStatus]);

  const getSyncHeaders = useCallback((extraHeaders = {}) => {
    const trimmedAccessKey = syncAccessKey.trim();

    return getClientDatabaseHeaders({
      ...extraHeaders,
      ...(trimmedAccessKey ? { 'x-wasteshift-sync-secret': trimmedAccessKey } : {}),
    });
  }, [syncAccessKey]);

  const buildDatabaseData = useCallback(() => ({
    wasteItems,
    budget,
    recipes,
    staffList,
    customStaffList,
    customMenuItems,
    portionProfiles,
    itemPriceCatalog,
    storeRoomItems,
    storeRoomMovements,
    settings,
    authSettings,
    activeStaffId,
    inventoryMovements,
    auditLog,
  }), [wasteItems, budget, recipes, staffList, customStaffList, customMenuItems, portionProfiles, itemPriceCatalog, storeRoomItems, storeRoomMovements, settings, authSettings, activeStaffId, inventoryMovements, auditLog]);
  const latestDatabaseDataRef = useRef(null);
  const bulkWasteClearInFlightRef = useRef(false);

  useEffect(() => {
    latestDatabaseDataRef.current = buildDatabaseData();
  }, [buildDatabaseData]);

  const applyDatabaseData = useCallback((databaseData) => {
    setWasteItems(Array.isArray(databaseData.wasteItems) ? databaseData.wasteItems : []);
    setBudget(parseFloat(databaseData.budget) || 0);
    setRecipes(isRecipeMap(databaseData.recipes) ? cloneRecipeMap(databaseData.recipes) : {});
    setCustomStaffList(sanitizeStaffMembers(databaseData.customStaffList ?? databaseData.staffList));
    setCustomMenuItems(sanitizeMenuItems(databaseData.customMenuItems));
    setPortionProfiles(sanitizePortionProfiles(databaseData.portionProfiles));
    setItemPriceCatalog(sanitizeItemPriceCatalog(databaseData.itemPriceCatalog));
    setStoreRoomItems(sanitizeStoreRoomItems(databaseData.storeRoomItems));
    setStoreRoomMovements(sanitizeStoreRoomMovements(databaseData.storeRoomMovements));
    setSettings(sanitizeSettings(databaseData.settings));
    if (databaseData.authSettings !== undefined) {
      setAuthSettings(sanitizeAuthSettings(databaseData.authSettings));
    }
    setActiveStaffId(String(databaseData.activeStaffId || ''));
    setInventoryMovements(Array.isArray(databaseData.inventoryMovements) ? databaseData.inventoryMovements : []);
    setAuditLog(Array.isArray(databaseData.auditLog) ? databaseData.auditLog : []);
  }, []);

  const saveDatabaseToServer = useCallback(async (mode = 'manual') => {
    const permission = requirePermission(accessProfile, 'canManageServerSync', 'sync the server database');

    if (!permission.ok) {
      setServerSync(prev => ({
        ...prev,
        status: 'locked',
        message: permission.message,
      }));
      return false;
    }

    setServerSync(prev => ({
      ...prev,
      status: 'saving',
      message: FIRESTORE_CONFIGURED
        ? 'Saving database to Firebase...'
        : mode === 'manual' ? 'Saving database to server...' : 'Auto-saving database to server...',
    }));

    try {
      if (FIRESTORE_CONFIGURED) {
        const payload = await saveFirestoreDatabaseSnapshot(buildDatabaseData());

        if (payload?.skipped) {
          throw new Error('Firebase is not configured for this build.');
        }

        setServerSyncEnabled(true);
        setServerSync({
          status: 'synced',
          message: 'Firebase database synced.',
          lastSavedAt: payload.updatedAt || new Date().toISOString(),
        });
        setFirebaseSync(prev => ({
          ...prev,
          status: 'synced',
          message: 'Firebase is the primary database and is up to date.',
          lastSavedAt: payload.updatedAt || new Date().toISOString(),
        }));

        return true;
      }

      const response = await fetch(SERVER_DATABASE_ENDPOINT, {
        method: 'POST',
        headers: getSyncHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ data: buildDatabaseData() }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || 'Server save failed.');
      }

      if (!FIRESTORE_CONFIGURED) {
        setServerSyncEnabled(true);
      }

      setServerSync({
        status: 'synced',
        message: 'Server database synced.',
        lastSavedAt: payload.updatedAt || new Date().toISOString(),
      });

      return true;
    } catch (error) {
      setServerSync({
        status: 'error',
        message: `${error?.message || (FIRESTORE_CONFIGURED ? 'Firebase save failed.' : 'Server save failed.')} Local browser copy is still saved.`,
        lastSavedAt: '',
      });

      return false;
    }
  }, [accessProfile, buildDatabaseData, getSyncHeaders]);

  useEffect(() => {
    try {
      localStorage.setItem('wasteItems', JSON.stringify(wasteItems));
      return;
    } catch (error) {
      console.warn('Could not save waste entries with photos locally.', error);
    }

    let removedPhotoCount = 0;
    const lightweightWasteItems = wasteItems.map((item) => {
      const photoUrl = String(item?.photoUrl || '');

      if (!photoUrl.startsWith('data:image/')) {
        return item;
      }

      removedPhotoCount += 1;

      return {
        ...item,
        photoUrl: '',
        photoCapturedAt: '',
        photoStorageWarning: 'Photo preview was removed because local storage was full.',
      };
    });

    if (removedPhotoCount === 0) {
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: 'Waste entry is visible now, but this browser could not save it locally. Try removing older entries.',
      }));
      return;
    }

    try {
      localStorage.setItem('wasteItems', JSON.stringify(lightweightWasteItems));
      setWasteItems(lightweightWasteItems);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: 'Waste entry saved, but photo previews were removed because this browser ran out of storage.',
      }));
    } catch (fallbackError) {
      console.warn('Could not save lightweight waste entries locally.', fallbackError);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: 'Waste entry is visible now, but this browser could not save it locally. Try removing older photo entries or using a smaller photo.',
      }));
    }
  }, [wasteItems]);

  useEffect(() => {
    localStorage.setItem('wasteBudget', budget.toString());
  }, [budget]);

  useEffect(() => {
    localStorage.setItem('wasteShiftSettings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const {
      managementPin: _managementPin,
      staffPin: _staffPin,
      ...safeAuthSettings
    } = authSettings;
    localStorage.setItem('wasteShiftAuthSettings', JSON.stringify(safeAuthSettings));
  }, [authSettings]);

  useEffect(() => {
    if (authSession) {
      savePersistedAuthSession(authSession, getClientDatabaseId());
      return;
    }

    clearPersistedAuthSession();
  }, [authSession]);

  useEffect(() => {
    if (activeStaffId) {
      localStorage.setItem('activeStaffId', activeStaffId);
      return;
    }

    localStorage.removeItem('activeStaffId');
  }, [activeStaffId]);

  useEffect(() => {
    localStorage.setItem('customRecipes', JSON.stringify(recipes));
    localStorage.setItem('defaultRecipeSeedVersion', DEFAULT_RECIPE_SEED_VERSION);
  }, [recipes]);

  useEffect(() => {
    localStorage.setItem('customStaffList', JSON.stringify(stripStaffCredentialsForStorage(customStaffList)));
    localStorage.setItem('staffList', JSON.stringify(stripStaffCredentialsForStorage(staffList)));
  }, [customStaffList, staffList]);

  useEffect(() => {
    localStorage.setItem('customMenuItems', JSON.stringify(customMenuItems));
  }, [customMenuItems]);

  useEffect(() => {
    localStorage.setItem('portionProfiles', JSON.stringify(portionProfiles));
  }, [portionProfiles]);

  useEffect(() => {
    localStorage.setItem('itemPriceCatalog', JSON.stringify(itemPriceCatalog));
  }, [itemPriceCatalog]);

  useEffect(() => {
    localStorage.setItem('storeRoomItems', JSON.stringify(storeRoomItems));
  }, [storeRoomItems]);

  useEffect(() => {
    localStorage.setItem('storeRoomMovements', JSON.stringify(storeRoomMovements));
  }, [storeRoomMovements]);

  useEffect(() => {
    localStorage.setItem('inventoryMovements', JSON.stringify(inventoryMovements));
  }, [inventoryMovements]);

  useEffect(() => {
    localStorage.setItem('auditLog', JSON.stringify(auditLog));
  }, [auditLog]);

  useEffect(() => {
    const timestamp = new Date().toISOString();
    localStorage.setItem('wasteShiftLastSavedAt', timestamp);
    setLastSavedAt(timestamp);
  }, [wasteItems, budget, recipes, customStaffList, customMenuItems, portionProfiles, itemPriceCatalog, storeRoomItems, storeRoomMovements, settings, authSettings, activeStaffId, inventoryMovements, auditLog]);

  useEffect(() => {
    let isCancelled = false;

    const loadServerDatabase = async () => {
      if (FIRESTORE_CONFIGURED) {
        if (!authSession || sessionValidationStatus !== 'ready') {
          setManagerAccountsLoaded(true);
          setServerSyncEnabled(false);
          setServerLoadComplete(false);
          return;
        }

        setServerSync(prev => ({
          ...prev,
          status: 'checking',
          message: 'Loading primary database from Firebase...',
        }));

        try {
          const isManagementSession = ['owner', 'manager'].includes(String(authSession?.roleKey || '').toLowerCase());
          const [firebaseSnapshot, firebaseWastePage, firebaseManagers] = await Promise.all([
            isManagementSession
              ? loadFirestoreDatabaseSnapshot()
              : Promise.resolve({ ok: true, exists: false, data: null, updatedAt: '' }),
            loadInitialWasteHistoryPage(),
            isManagementSession ? loadManagerAccounts().catch(() => []) : Promise.resolve([]),
          ]);

          if (isCancelled) {
            return;
          }

          const snapshotData = firebaseSnapshot?.data || {};
          const firebaseWasteItems = firebaseWastePage.entries;
          const hasSnapshot = Boolean(firebaseSnapshot?.exists);
          const hasWasteEntries = firebaseWasteItems.length > 0;
          const hasManagerAccounts = firebaseManagers.length > 0;
          const localFallbackData = latestDatabaseDataRef.current || {};
          const mergedCustomStaffList = mergeManagerAccountsIntoStaffList(
            snapshotData.customStaffList ?? snapshotData.staffList ?? localFallbackData.customStaffList ?? localFallbackData.staffList ?? [],
            firebaseManagers,
          );
          const firebaseDatabaseData = {
            ...localFallbackData,
            ...snapshotData,
            customStaffList: mergedCustomStaffList,
            wasteItems: hasWasteEntries
              ? firebaseWasteItems
              : Array.isArray(snapshotData.wasteItems)
                ? snapshotData.wasteItems
                : localFallbackData.wasteItems,
          };

          setServerSyncEnabled(true);
          setServerLoadComplete(true);
          setManagerAccountsLoaded(true);
          if (hasSnapshot || hasWasteEntries || hasManagerAccounts) {
            applyDatabaseData(firebaseDatabaseData);
            setServerSync({
              status: 'synced',
              message: `Loaded primary database from Firebase${hasWasteEntries ? ` with ${firebaseWasteItems.length} waste entr${firebaseWasteItems.length === 1 ? 'y' : 'ies'}` : ''}.`,
              lastSavedAt: firebaseSnapshot?.updatedAt || '',
            });
            setFirebaseSync(prev => ({
              ...prev,
              status: 'ready',
              message: 'Firebase is connected and serving the app database.',
              lastSavedAt: firebaseSnapshot?.updatedAt || new Date().toISOString(),
            }));
            return;
          }

          setServerSync({
            status: 'ready',
            message: 'Firebase database is ready. No shared app data has been saved yet.',
            lastSavedAt: '',
          });
          setFirebaseSync(prev => ({
            ...prev,
            status: 'ready',
            message: 'Firebase is connected. Current local data will sync to Firebase on the next save.',
            lastSavedAt: '',
          }));
          return;
        } catch (error) {
          if (isCancelled) {
            return;
          }

          console.warn('Firebase primary database unavailable. Using local fallback.', error);
          setManagerAccountsLoaded(true);
          setServerSyncEnabled(false);
          setServerLoadComplete(false);
          setServerSync({
            status: 'error',
            message: `${error?.message || 'Firebase database is unavailable.'} Local browser data is still available.`,
            lastSavedAt: '',
          });
          setFirebaseSync(prev => ({
            ...prev,
            status: 'error',
            message: `${error?.message || 'Firebase database is unavailable.'} Local browser data is still available.`,
          }));
          return;
        }
      }

      try {
        const response = await fetch(SERVER_DATABASE_ENDPOINT, {
          cache: 'no-store',
          headers: getSyncHeaders(),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error(payload.message || 'Server sync is protected. Add the server sync access key in Settings.');
          }

          throw new Error(payload.message || 'Server database route is not available.');
        }

        if (payload?.ok === false) {
          throw new Error(payload.message || 'Server database is not configured.');
        }

        if (isCancelled) {
          return;
        }

        setServerSyncEnabled(true);
        setServerLoadComplete(true);

        if (payload?.snapshot?.data) {
          markServerStaffFreshStartComplete();
          applyDatabaseData(payload.snapshot.data);
          setServerSync({
            status: 'synced',
            message: 'Loaded database from server.',
            lastSavedAt: payload.snapshot.updatedAt || payload.snapshot.exportedAt || '',
          });
          return;
        }

        setServerSync({
          status: 'ready',
          message: 'Server database is ready. No server data has been saved yet.',
          lastSavedAt: '',
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setServerSyncEnabled(false);
        setServerLoadComplete(false);
        const message = error?.message || 'Using browser storage. Deploy to Vercel with Blob storage to enable server sync.';
        setServerSync({
          status: /protected|access key|unauthorized|forbidden/i.test(message) ? 'locked' : 'local',
          message,
          lastSavedAt: '',
        });
      }
    };

    loadServerDatabase();

    return () => {
      isCancelled = true;
    };
  }, [applyDatabaseData, authSession, getSyncHeaders, loadInitialWasteHistoryPage, restaurantProfile.setupCompleted, sessionValidationStatus]);

  useEffect(() => {
    if (!serverSyncEnabled || !serverLoadComplete) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      saveDatabaseToServer('auto');
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [wasteItems, budget, recipes, customStaffList, customMenuItems, portionProfiles, itemPriceCatalog, storeRoomItems, storeRoomMovements, settings, authSettings, activeStaffId, inventoryMovements, auditLog, serverSyncEnabled, serverLoadComplete, saveDatabaseToServer]);

  const handleSavePinSettings = useCallback(async ({ staffPin, managementPin, pinPresetVersion = 'custom' }) => {
    const nextAuthSettings = { ...authSettings };
    const trimmedStaffPin = String(staffPin || '').trim();
    const trimmedManagementPin = String(managementPin || '').trim();

    try {
      if (trimmedStaffPin) {
        nextAuthSettings.staffPin = await createPinRecord(trimmedStaffPin);
      }

      let updatedManager = null;

      if (trimmedManagementPin) {
        const activeManager = staffList.find((member) => (
          member.id === activeStaffId
          && (member.staffSection === 'management' || inferRoleKey(member.role) === 'manager' || inferRoleKey(member.role) === 'owner')
        ));

        if (!activeManager) {
          return { ok: false, message: 'Log in as a manager before changing a manager PIN.' };
        }

        updatedManager = {
          ...activeManager,
          managerPin: await createPinRecord(trimmedManagementPin),
          staffSection: 'management',
          role: activeManager.role || 'Manager',
          isCsvSeed: false,
        };

        setCustomStaffList(prevStaffList => {
          const existingIndex = prevStaffList.findIndex((member) => member.id === updatedManager.id);

          if (existingIndex === -1) {
            return [...prevStaffList, updatedManager];
          }

          return prevStaffList.map((member, index) => (
            index === existingIndex ? { ...member, ...updatedManager } : member
          ));
        });

        saveManagerAccount(updatedManager).catch((error) => {
          console.warn('Could not save manager account to Firestore.', error);
        });
      }

      nextAuthSettings.managementPin = null;
      nextAuthSettings.updatedAt = new Date().toISOString();
      nextAuthSettings.pinPresetVersion = pinPresetVersion;
      setAuthSettings(sanitizeAuthSettings(nextAuthSettings));
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'PIN settings changed',
          user: activeStaffMember?.name || 'System',
          relatedItem: 'Access settings',
          afterValue: {
            staffPinsEnabled: true,
            managerAccountUpdated: Boolean(updatedManager),
          },
        }),
        ...prevLog,
      ].slice(0, 500));

      return { ok: true, message: 'PIN settings saved.' };
    } catch (error) {
      return { ok: false, message: error?.message || 'Could not save PIN settings.' };
    }
  }, [activeStaffId, activeStaffMember?.name, authSettings, staffList]);

  useEffect(() => {
    setIsPreparingAuth(false);
  }, []);

  const upsertLoginAccount = useCallback(({ mode, name, staffSection, staffCode, managerPin }) => {
    const trimmedName = String(name || '').trim();
    const accountId = createStaffMemberId(trimmedName);
    const existingMember = staffList.find((member) => member.id === accountId);
    const nextMember = mode === 'management'
      ? {
        id: accountId,
        name: trimmedName,
        role: 'Manager',
        staffSection: 'management',
        managerPin: managerPin || existingMember?.managerPin || null,
        removed: false,
        removedAt: '',
        isCsvSeed: false,
      }
      : {
        id: accountId,
        name: trimmedName,
        role: STAFF_SECTION_ROLE_LABELS[staffSection] || 'Team',
        staffSection: staffSection || 'kitchen',
        staffCode: staffCode || existingMember?.staffCode || null,
        removed: false,
        removedAt: '',
        isCsvSeed: false,
      };

    setCustomStaffList(prevStaffList => {
      const existingIndex = prevStaffList.findIndex((member) => member.id === accountId);

      if (existingIndex === -1) {
        return [...prevStaffList, nextMember];
      }

      return prevStaffList.map((member, index) => (
        index === existingIndex
          ? {
            ...member,
            ...nextMember,
            staffCode: nextMember.staffCode || member.staffCode || existingMember?.staffCode || null,
            managerPin: nextMember.managerPin || member.managerPin || existingMember?.managerPin || null,
          }
          : member
      ));
    });

    return { ...existingMember, ...nextMember };
  }, [staffList]);

  const handleInitialManagerSetup = useCallback(async ({ name, managementPin }) => {
    const trimmedName = String(name || '').trim();
    const trimmedManagementPin = String(managementPin || '').trim();

    if (!trimmedName) {
      return { ok: false, message: 'Enter the first manager name.' };
    }

    let managerPinRecord;

    try {
      managerPinRecord = await createPinRecord(trimmedManagementPin);
    } catch (error) {
      return { ok: false, message: error?.message || 'Could not create manager PIN.' };
    }

    const managerMember = upsertLoginAccount({
      mode: 'management',
      name: trimmedName,
      managerPin: managerPinRecord,
    });
    await saveManagerAccount(managerMember).catch((error) => {
      console.warn('Could not save manager account to Firestore.', error);
    });
    await saveCurrentUserStaffProfile({
      displayName: managerMember.name,
      role: managerMember.role,
      roleKey: 'manager',
      staffId: managerMember.id,
    }).catch((error) => {
      console.warn('Could not save manager Firebase access profile.', error);
    });
    const managerSessionResult = await establishManagerSession({
      managerId: managerMember.id,
      pin: trimmedManagementPin,
    });

    if (!managerSessionResult.ok) {
      return { ok: false, message: managerSessionResult.message };
    }
    const nextSession = {
      mode: 'management',
      staffId: managerMember.id,
      staffName: managerMember.name,
      roleKey: inferRoleKey(managerMember.role),
      startedAt: new Date().toISOString(),
      databaseId: getClientDatabaseId(),
    };

    setAuthSession(nextSession);
    setActiveStaffId(managerMember.id);
    setActiveTab('settings');
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'First manager setup',
        user: managerMember.name,
        relatedItem: 'Access settings',
        afterValue: { staffId: managerMember.id, managerAccountCreated: true },
      }),
      ...prevLog,
    ].slice(0, 500));

    return {
      ok: true,
      message: managerSessionResult.ok
        ? 'Manager access created.'
        : `Manager access created. ${managerSessionResult.message}`,
    };
  }, [upsertLoginAccount]);

  const handleLogin = useCallback(async ({ mode, name, staffSection, pin }) => {
    const trimmedName = String(name || '').trim();
    let authenticatedStaffMember = null;
    let accessSessionResult = null;

    if (!trimmedName) {
      return { ok: false, message: mode === 'management' ? 'Enter your management name.' : 'Choose your staff profile.' };
    }

    if (mode === 'staff') {
      const accountId = createStaffMemberId(trimmedName);
      const existingMember = staffList.find((member) => member.id === accountId);

      if (!existingMember) {
        return { ok: false, message: 'Ask a manager to add you in Settings > Staff before logging in.' };
      }

      if (!/^\d{5}$/.test(String(pin || '').trim())) {
        return { ok: false, message: 'Enter your 5 digit staff PIN.' };
      }

      accessSessionResult = await establishStaffSession({ staffId: accountId, pin });
      if (!accessSessionResult.ok) {
        return { ok: false, message: accessSessionResult.message };
      }

      authenticatedStaffMember = existingMember;
    } else {
      const accountId = createStaffMemberId(trimmedName);
      const existingManager = staffList.find((member) => (
        member.id === accountId
        && !member.removed
        && (member.staffSection === 'management' || inferRoleKey(member.role) === 'manager' || inferRoleKey(member.role) === 'owner')
      ));
      accessSessionResult = await establishManagerSession({ managerId: accountId, pin });

      if (!accessSessionResult.ok) {
        return { ok: false, message: accessSessionResult.message };
      }

      authenticatedStaffMember = existingManager || upsertLoginAccount({
        mode,
        name: trimmedName,
        managerPin: null,
      });
    }

    const staffMember = authenticatedStaffMember || upsertLoginAccount({
      mode,
      name: trimmedName,
      staffSection,
    });
    const roleKey = inferRoleKey(staffMember.role);
    await saveCurrentUserStaffProfile({
      displayName: staffMember.name,
      role: staffMember.role,
      roleKey,
      staffId: staffMember.id,
    }).catch((error) => {
      console.warn('Could not save Firebase access profile.', error);
    });
    const nextSession = {
      mode,
      staffId: staffMember.id,
      staffName: staffMember.name,
      roleKey,
      startedAt: new Date().toISOString(),
      databaseId: getClientDatabaseId(),
    };

    setAuthSession(nextSession);
    setActiveStaffId(staffMember.id);
    setActiveTab(mode === 'management' ? 'dashboard' : 'logWaste');
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: `${mode === 'management' ? 'Management' : 'Staff'} login`,
        user: staffMember.name,
        relatedItem: 'PIN login',
        afterValue: { role: staffMember.role },
      }),
      ...prevLog,
    ].slice(0, 500));

    return {
      ok: true,
      message: 'Login successful.',
    };
  }, [staffList, upsertLoginAccount]);

  const handleRecoverManagerAccess = useCallback(async ({ name, pin, recoveryKey }) => {
    const managerName = String(name || '').trim();
    const managerId = createStaffMemberId(managerName);
    const result = await recoverManagerSession({ managerId, name: managerName, pin, recoveryKey });

    if (!result?.ok) {
      return { ok: false, message: result?.message || 'Could not recover manager access.' };
    }

    const managerMember = upsertLoginAccount({
      mode: 'management',
      name: managerName,
      managerPin: null,
    });
    await saveCurrentUserStaffProfile({
      displayName: managerMember.name,
      role: 'Manager',
      roleKey: 'manager',
      staffId: managerMember.id,
    }).catch((error) => {
      console.warn('Could not save recovered Firebase access profile.', error);
    });
    const nextSession = {
      mode: 'management',
      staffId: managerMember.id,
      staffName: managerMember.name,
      roleKey: 'manager',
      startedAt: new Date().toISOString(),
      databaseId: getClientDatabaseId(),
    };

    setAuthSession(nextSession);
    setActiveStaffId(managerMember.id);
    setActiveTab('dashboard');
    setAuditLog((currentLog) => [
      createAuditLogEntry({
        action: 'Legacy manager access recovered',
        user: managerMember.name,
        relatedItem: restaurantProfile.restaurantName || 'Restaurant',
      }),
      ...currentLog,
    ].slice(0, 500));

    return { ok: true, message: 'Manager access restored.' };
  }, [restaurantProfile.restaurantName, upsertLoginAccount]);

  const handlePrepareSetupManagerAccess = useCallback(async ({ name, managerPin }) => {
    const managerName = String(name || '').trim();
    const safeManagerPin = String(managerPin || '').trim();

    if (!managerName || !safeManagerPin) {
      return { ok: false, message: 'Enter the manager name and PIN first.' };
    }

    try {
      const managerMember = {
        id: createStaffMemberId(managerName),
        name: managerName,
        role: 'Manager',
        staffSection: 'management',
        managerPin: await createPinRecord(safeManagerPin),
        removed: false,
        removedAt: '',
        isCsvSeed: false,
      };

      await saveManagerAccount(managerMember);
      await saveCurrentUserStaffProfile({
        displayName: managerMember.name,
        role: managerMember.role,
        roleKey: 'manager',
        staffId: managerMember.id,
      });
      const managerSessionResult = await establishManagerSession({
        managerId: managerMember.id,
        pin: safeManagerPin,
      });

      return {
        ok: managerSessionResult.ok,
        message: managerSessionResult.ok ? '' : managerSessionResult.message,
      };
    } catch (error) {
      const message = String(error?.message || '');
      const isPermissionError = error?.code === 'permission-denied'
        || message.toLowerCase().includes('missing or insufficient permissions');

      return {
        ok: false,
        message: isPermissionError
          ? 'Firestore rules are blocking manager setup. Deploy firestore.rules, then try again.'
          : message || 'Could not prepare manager access.',
      };
    }
  }, []);

  const handleLogout = useCallback(async () => {
    const previousSession = authSession;

    clearPersistedAuthSession();
    setAuthSession(null);
    setActiveStaffId('');
    setSyncAccessKey('');
    setActiveTab('dashboard');

    if (previousSession?.staffName) {
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'Logout',
          user: previousSession.staffName,
          relatedItem: 'PIN session',
        }),
        ...prevLog,
      ].slice(0, 500));
    }

    const result = previousSession?.mode === 'management'
      ? await revokeManagerSession()
      : await revokeStaffSession();
    if (!result.ok) {
      console.warn(result.message);
    }
  }, [authSession]);

  const handleAddStaff = async (newStaffMember) => {
    const permission = requirePermission(accessProfile, 'canManageStaff', 'manage staff');
    if (!permission.ok) {
      alert(permission.message);
      return { ok: false, message: permission.message };
    }

    const nextStaffSection = inferStaffSection(newStaffMember.staffSection || newStaffMember.role);
    const isManagerAccount = nextStaffSection === 'management' || inferRoleKey(newStaffMember.role) === 'manager' || inferRoleKey(newStaffMember.role) === 'owner';
    const chosenStaffPin = String(newStaffMember.staffPin || '').trim();

    if (!isManagerAccount && !/^\d{5}$/.test(chosenStaffPin)) {
      return { ok: false, message: 'Enter a 5 digit staff PIN.' };
    }

    if (!isManagerAccount) {
      for (const member of staffList.filter((staffMember) => !staffMember.removed && staffMember.id !== createStaffMemberId(newStaffMember.name))) {
        const existingStaffCode = sanitizePinRecord(member.staffCode);

        if (existingStaffCode && await verifyPin(chosenStaffPin, existingStaffCode)) {
          return { ok: false, message: 'That staff PIN is already in use. Choose another 5 digit PIN.' };
        }
      }
    }

    const generatedStaffCode = isManagerAccount ? '' : chosenStaffPin;
    const staffCodeRecord = generatedStaffCode ? await createPinRecord(generatedStaffCode) : null;
    const managerPinRecord = isManagerAccount ? await createPinRecord(newStaffMember.managerPin) : null;
    const nextStaffMember = {
      ...newStaffMember,
      id: createStaffMemberId(newStaffMember.name),
      staffSection: nextStaffSection,
      staffCode: staffCodeRecord,
      managerPin: managerPinRecord,
      removed: false,
      removedAt: '',
      isCsvSeed: false,
    };

    if (!isManagerAccount) {
      const accountResult = await saveStaffAccessAccount({
        ...nextStaffMember,
        roleKey: inferRoleKey(nextStaffMember.role),
      });
      if (!accountResult.ok) {
        return { ok: false, message: accountResult.message };
      }
    } else {
      try {
        await saveManagerAccount(nextStaffMember);
      } catch (error) {
        return { ok: false, message: error?.message || 'Could not save the manager account.' };
      }
    }

    setCustomStaffList(prev => {
      const existingIndex = prev.findIndex((member) => member.id === nextStaffMember.id);

      if (existingIndex === -1) {
        return [...prev, nextStaffMember];
      }

      return prev.map((member, index) => (
        index === existingIndex ? nextStaffMember : member
      ));
    });

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Staff added',
        user: activeStaffMember?.name || 'System',
        relatedItem: nextStaffMember.name,
        afterValue: {
          staffId: nextStaffMember.id,
          role: nextStaffMember.role,
          customStaffPinSet: Boolean(staffCodeRecord),
          managerAccountCreated: Boolean(managerPinRecord),
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return {
      ok: true,
      staffName: nextStaffMember.name,
      generatedStaffCode,
      message: isManagerAccount
        ? `Manager account added for ${nextStaffMember.name}.`
        : `Staff member added. PIN set for ${nextStaffMember.name}.`,
    };
  };

  const handleDeleteStaff = async (staffId) => {
    const permission = requirePermission(accessProfile, 'canManageStaff', 'remove staff');
    if (!permission.ok) {
      alert(permission.message);
      return { ok: false, message: permission.message };
    }

    const staffMember = staffList.find((member) => member.id === staffId);
    const baseStaffMember = baseStaffList.find((member) => member.id === staffId);

    if (!staffMember) {
      return;
    }

    const isManagerAccount = staffMember.staffSection === 'management'
      || inferRoleKey(staffMember.role) === 'manager'
      || inferRoleKey(staffMember.role) === 'owner';
    const removedStaffMember = {
      ...staffMember,
      removed: true,
      active: false,
      removedAt: new Date().toISOString(),
    };

    if (!isManagerAccount) {
      const accountResult = await saveStaffAccessAccount(removedStaffMember);
      if (!accountResult.ok) {
        return { ok: false, message: accountResult.message };
      }
    } else {
      try {
        await saveManagerAccount(removedStaffMember);
      } catch (error) {
        return { ok: false, message: error?.message || 'Could not archive the manager account.' };
      }
    }

    if (baseStaffMember) {
      setCustomStaffList(prevStaffList => {
        const removedStaffMember = {
          ...staffMember,
          removed: true,
          removedAt: new Date().toISOString(),
          isCsvSeed: false,
        };
        const existingIndex = prevStaffList.findIndex((member) => member.id === staffId);

        if (existingIndex === -1) {
          return [...prevStaffList, removedStaffMember];
        }

        return prevStaffList.map((member, index) => (
          index === existingIndex ? { ...member, ...removedStaffMember } : member
        ));
      });
    } else {
      setCustomStaffList(prevStaffList => prevStaffList.filter((member) => member.id !== staffId));
    }

    if (activeStaffId === staffId) {
      setActiveStaffId('');
    }

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Staff removed',
        user: activeStaffMember?.name || 'System',
        relatedItem: staffMember.name,
        beforeValue: {
          staffId,
          role: staffMember.role,
          staffSection: staffMember.staffSection,
          wasCsvSeed: Boolean(baseStaffMember),
        },
      }),
      ...prevLog,
    ].slice(0, 500));
  };

  const handleResetStaffCode = async (staffId) => {
    const permission = requirePermission(accessProfile, 'canManageStaff', 'reset staff PINs');
    if (!permission.ok) {
      return { ok: false, message: permission.message };
    }

    const staffMember = staffList.find((member) => member.id === staffId);

    if (!staffMember) {
      return { ok: false, message: 'Staff member not found.' };
    }

    const chosenStaffPin = String(window.prompt(`Enter a new 5 digit PIN for ${staffMember.name}.`, '') || '').trim();

    if (!chosenStaffPin) {
      return { ok: false, message: 'PIN reset cancelled.' };
    }

    if (!/^\d{5}$/.test(chosenStaffPin)) {
      return { ok: false, message: 'Enter a 5 digit staff PIN.' };
    }

    for (const member of staffList.filter((existingMember) => !existingMember.removed && existingMember.id !== staffId)) {
      const existingStaffCode = sanitizePinRecord(member.staffCode);

      if (existingStaffCode && await verifyPin(chosenStaffPin, existingStaffCode)) {
        return { ok: false, message: 'That staff PIN is already in use. Choose another 5 digit PIN.' };
      }
    }

    const generatedStaffCode = chosenStaffPin;
    const staffCodeRecord = await createPinRecord(chosenStaffPin);
    const accountResult = await saveStaffAccessAccount({
      ...staffMember,
      staffCode: staffCodeRecord,
      roleKey: inferRoleKey(staffMember.role),
    });
    if (!accountResult.ok) {
      return { ok: false, message: accountResult.message };
    }

    setCustomStaffList(prevStaffList => {
      const existingIndex = prevStaffList.findIndex((member) => member.id === staffId);
      const nextMember = {
        ...staffMember,
        staffCode: staffCodeRecord,
        isCsvSeed: false,
      };

      if (existingIndex === -1) {
        return [...prevStaffList, nextMember];
      }

      return prevStaffList.map((member, index) => (
        index === existingIndex ? { ...member, ...nextMember } : member
      ));
    });

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Staff PIN reset',
        user: activeStaffMember?.name || 'System',
        relatedItem: staffMember.name,
        afterValue: { staffId, customStaffPinSet: true },
      }),
      ...prevLog,
    ].slice(0, 500));

    return {
      ok: true,
      staffName: staffMember.name,
      generatedStaffCode,
      message: `New staff PIN set for ${staffMember.name}.`,
    };
  };

  const updateWasteEntrySyncStatus = useCallback((entryId, syncStatus, syncError = '') => {
    setWasteItems(prevItems => prevItems.map((item) => (
      item.id === entryId
        ? {
          ...item,
          syncStatus,
          syncError,
          syncedAt: syncStatus === 'synced' ? new Date().toISOString() : item.syncedAt || '',
        }
        : item
    )));
  }, []);

  const syncWasteEntryToFirestore = useCallback(async (entry) => {
    if (!FIRESTORE_CONFIGURED) {
      return { ok: true, syncStatus: 'local', message: 'Firebase is not configured.' };
    }

    if (!isOnline) {
      updateWasteEntrySyncStatus(entry.id, 'pending');
      return { ok: true, syncStatus: 'pending', message: 'Entry queued until this device is online.' };
    }

    try {
      const result = await saveFirestoreWasteEntry(entry);

      if (result?.skipped) {
        updateWasteEntrySyncStatus(entry.id, 'failed', 'Required fields were missing.');
        return { ok: false, syncStatus: 'failed', message: 'Firebase skipped this entry because required fields were missing.' };
      }

      updateWasteEntrySyncStatus(entry.id, 'synced');
      setFirebaseSync(prev => ({
        ...prev,
        status: 'synced',
        message: 'Waste entry saved to Firebase.',
        lastSavedAt: new Date().toISOString(),
      }));
      return { ok: true, syncStatus: 'synced' };
    } catch (error) {
      console.warn('Could not save waste entry to Firestore.', error);
      const message = error?.message || 'Could not save waste entry to Firebase.';
      updateWasteEntrySyncStatus(entry.id, 'failed', message);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: `${message} Local copy is still saved.`,
      }));
      return { ok: false, syncStatus: 'failed', message };
    }
  }, [isOnline, updateWasteEntrySyncStatus]);

  const handleAddEntry = async (newEntry) => {
    const duplicateWindowMs = 90 * 1000;
    const nowMs = new Date(newEntry?.createdAt || newEntry?.timestamp || Date.now()).getTime();
    const duplicateEntry = wasteItems.find((item) => {
      const itemTime = new Date(item?.createdAt || item?.timestamp || 0).getTime();

      return Math.abs(nowMs - itemTime) <= duplicateWindowMs
        && String(item?.status || 'logged') !== 'voided'
        && String(item?.name || '').trim().toLowerCase() === String(newEntry?.name || '').trim().toLowerCase()
        && String(item?.reason || '').trim().toLowerCase() === String(newEntry?.reason || '').trim().toLowerCase()
        && String(item?.staffId || item?.staff || '').trim().toLowerCase() === String(newEntry?.staffId || newEntry?.staff || '').trim().toLowerCase()
        && Number(item?.quantity || 0) === Number(newEntry?.quantity || 0);
    });

    if (duplicateEntry) {
      return {
        ok: false,
        duplicate: true,
        message: `${newEntry?.name || 'This item'} was already logged moments ago. Check the Waste Log before saving it again.`,
      };
    }

    const entryWithSync = {
      ...newEntry,
      syncStatus: FIRESTORE_CONFIGURED ? 'pending' : 'local',
      syncError: '',
    };

    setWasteItems(prevItems => [...prevItems, entryWithSync]);
    setInventoryMovements(prevMovements => [
      ...prevMovements,
      ...createInventoryMovementsFromEntry(entryWithSync),
    ]);

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Waste entry created',
        user: entryWithSync.createdBy || entryWithSync.staff,
        relatedItem: entryWithSync.name,
        afterValue: {
          id: entryWithSync.id,
          foodCostLost: getEntryFoodCostLost(entryWithSync),
          potentialRevenueLost: Number(entryWithSync.potentialRevenueLost) || 0,
          reason: entryWithSync.reason,
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return syncWasteEntryToFirestore(entryWithSync);
  };

  const handleRetryWasteEntrySync = useCallback(async (entryId) => {
    const entry = wasteItems.find((item) => item.id === entryId);

    if (!entry) {
      return { ok: false, message: 'Entry not found.' };
    }

    return syncWasteEntryToFirestore({
      ...entry,
      syncStatus: 'pending',
      syncError: '',
    });
  }, [syncWasteEntryToFirestore, wasteItems]);

  useEffect(() => {
    if (!FIRESTORE_CONFIGURED || !isOnline) {
      return;
    }

    const retryableEntries = wasteItems.filter((item) => (
      item?.id && ['pending', 'failed'].includes(item.syncStatus)
    )).slice(0, 8);

    retryableEntries.forEach((entry) => {
      syncWasteEntryToFirestore(entry);
    });
  }, [isOnline, syncWasteEntryToFirestore, wasteItems]);

  const handleSavePortionProfile = (profile) => {
    const name = String(profile?.name || '').trim();
    const key = profile?.key || createMenuItemKey(name);
    const amount = parseFloat(profile?.amount);
    const unit = String(profile?.unit || '').trim();

    if (!key || !name || !Number.isFinite(amount) || amount <= 0 || !unit) {
      return;
    }

    setPortionProfiles(prevProfiles => ({
      ...prevProfiles,
      [key]: {
        key,
        name,
        amount,
        unit,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const handleSaveItemPrice = (priceRecord) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'manage raw ingredient prices');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const cleanedRecord = sanitizeItemPriceRecord({
      ...priceRecord,
      updatedAt: new Date().toISOString(),
    });

    if (!cleanedRecord) {
      alert('Enter an ingredient name, price, and unit.');
      return { ok: false, message: 'Enter an ingredient name, price, and unit.' };
    }

    const nextCatalog = {
      ...itemPriceCatalog,
      [cleanedRecord.key]: cleanedRecord,
    };
    let repricedEntries = 0;
    const nextWasteItems = wasteItems.map((item) => {
      if (item?.isRecipe || createItemPriceKey(item?.name) !== cleanedRecord.key) {
        return item;
      }

      if (item.costStatus === 'manual' && item.priceCatalogKey !== cleanedRecord.key) {
        return item;
      }

      const calculatedCost = calculateItemPriceCost({
        priceRecord: cleanedRecord,
        quantity: item.quantity,
        unit: item.unit,
        measuredQuantity: item.measuredQuantity,
        measuredUnit: item.measuredUnit,
      });

      if (!calculatedCost.canCalculate) {
        return item;
      }

      repricedEntries += 1;

      return {
        ...item,
        cost: calculatedCost.cost,
        foodCostLost: calculatedCost.cost,
        costStatus: 'catalog',
        priceCatalogKey: cleanedRecord.key,
        pricePerUnit: cleanedRecord.price,
        priceUnit: cleanedRecord.unit,
        lastEditedBy: activeStaffMember?.name || item.lastEditedBy || 'System',
      };
    });

    setItemPriceCatalog(nextCatalog);

    if (FIRESTORE_CONFIGURED) {
      saveIngredientPriceRecord(cleanedRecord)
        .catch((error) => {
          console.warn('Could not sync manual ingredient price to Firebase:', error);
        });
    }

    if (repricedEntries > 0) {
      setWasteItems(nextWasteItems);
      setInventoryMovements(nextWasteItems.flatMap(createInventoryMovementsFromEntry));
    }

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Ingredient price saved',
        user: activeStaffMember?.name || 'System',
        relatedItem: cleanedRecord.name,
        afterValue: {
          price: cleanedRecord.price,
          unit: cleanedRecord.unit,
          repricedEntries,
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return { ok: true, record: cleanedRecord, message: `${cleanedRecord.name} saved to the ingredient catalog.` };
  };

  const handleCreateCatalogItems = useCallback(async (priceRecords = []) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'manage raw ingredient prices');
    if (!permission.ok) {
      return { ok: false, message: permission.message };
    }

    const existingCatalog = sanitizeItemPriceCatalog(itemPriceCatalog);
    const candidates = new Map();

    (Array.isArray(priceRecords) ? priceRecords : []).forEach((priceRecord) => {
      const cleanedRecord = sanitizeItemPriceRecord({
        ...priceRecord,
        price: 0,
        updatedAt: new Date().toISOString(),
        source: priceRecord?.source || 'menu-import-smart',
      });

      if (cleanedRecord?.key && !candidates.has(cleanedRecord.key)) {
        candidates.set(cleanedRecord.key, cleanedRecord);
      }
    });

    const records = [...candidates.values()].map((record) => existingCatalog[record.key] || record);
    const newRecords = records.filter((record) => !existingCatalog[record.key]);

    if (newRecords.length > 0) {
      setItemPriceCatalog((currentCatalog) => ({
        ...currentCatalog,
        ...Object.fromEntries(newRecords.map((record) => [record.key, record])),
      }));

      if (FIRESTORE_CONFIGURED) {
        await Promise.all(newRecords.map((record) => saveIngredientPriceRecord(record)));
      }

      setAuditLog((prevLog) => [
        createAuditLogEntry({
          action: 'Ingredients created from menu import',
          user: activeStaffMember?.name || 'System',
          relatedItem: `${newRecords.length} ingredient${newRecords.length === 1 ? '' : 's'}`,
          afterValue: newRecords.map((record) => ({ name: record.name, unit: record.unit })),
        }),
        ...prevLog,
      ].slice(0, 500));
    }

    return {
      ok: true,
      records,
      message: newRecords.length > 0
        ? `${newRecords.length} ingredient${newRecords.length === 1 ? '' : 's'} added to the catalog.`
        : 'Ingredients already exist in the catalog.',
    };
  }, [accessProfile, activeStaffMember?.name, itemPriceCatalog]);

  const handleDeleteItemPrice = (itemPriceKey) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'remove raw ingredient prices');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const deletedRecord = itemPriceCatalog[itemPriceKey];

    setItemPriceCatalog(prevCatalog => {
      const nextCatalog = { ...prevCatalog };
      delete nextCatalog[itemPriceKey];
      return nextCatalog;
    });

    if (FIRESTORE_CONFIGURED && itemPriceKey) {
      deleteIngredient(itemPriceKey)
        .catch((error) => {
          console.warn('Could not delete raw ingredient price from Firebase:', error);
        });
    }

    if (deletedRecord) {
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'Ingredient price removed',
          user: activeStaffMember?.name || 'System',
          relatedItem: deletedRecord.name,
          beforeValue: deletedRecord,
        }),
        ...prevLog,
      ].slice(0, 500));
    }
  };

  const handleInvoicePricesUpdated = useCallback((invoiceUpdate) => {
    const invoiceCatalog = createItemPriceCatalogFromInvoice(invoiceUpdate || {});
    const updatedKeys = Object.keys(invoiceCatalog);

    if (updatedKeys.length === 0) {
      return;
    }

    const nextCatalog = sanitizeItemPriceCatalog({
      ...itemPriceCatalog,
      ...invoiceCatalog,
    });
    const updatedKeySet = new Set(updatedKeys);
    const {
      nextRecipes,
      changedRecipes,
      repricedRecipes,
    } = recalculateRecipesFromPriceCatalog(recipes, nextCatalog, updatedKeySet);
    let repricedEntries = 0;
    const nextWasteItems = wasteItems.map((item) => {
      const itemKey = createItemPriceKey(item?.name);

      if (item?.isRecipe || !updatedKeySet.has(itemKey)) {
        return item;
      }

      if (item.costStatus === 'manual' && item.priceCatalogKey !== itemKey) {
        return item;
      }

      const calculatedCost = calculateItemPriceCost({
        priceRecord: nextCatalog[itemKey],
        quantity: item.quantity,
        unit: item.unit,
        measuredQuantity: item.measuredQuantity,
        measuredUnit: item.measuredUnit,
      });

      if (!calculatedCost.canCalculate) {
        return item;
      }

      repricedEntries += 1;

      return {
        ...item,
        cost: calculatedCost.cost,
        foodCostLost: calculatedCost.cost,
        costStatus: 'catalog',
        priceCatalogKey: itemKey,
        pricePerUnit: nextCatalog[itemKey].price,
        priceUnit: nextCatalog[itemKey].unit,
        lastEditedBy: activeStaffMember?.name || item.lastEditedBy || 'System',
      };
    });

    setItemPriceCatalog(nextCatalog);

    if (repricedRecipes > 0) {
      setRecipes(nextRecipes);

      changedRecipes.forEach(([key, recipe]) => {
        const components = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map((ingredient, index) => ({
          key: ingredient.componentKey || createMenuItemKey(`${ingredient.name || 'ingredient'}-${index + 1}`),
          ingredientId: ingredient.ingredientId || ingredient.priceCatalogKey || '',
          name: ingredient.name,
          displayName: ingredient.displayName || ingredient.name,
          quantity: ingredient.quantity || '',
          quantityValue: ingredient.quantityValue ?? null,
          unit: ingredient.unit || '',
          cost: Number(ingredient.cost) || 0,
          costPerBaseUnit: ingredient.costPerBaseUnit ?? null,
          baseUnit: ingredient.baseUnit || '',
        }));
        const totalCost = roundCurrency(components.reduce((sum, component) => sum + component.cost, 0));
        const nextMenuItem = {
          key,
          firestoreId: key,
          name: recipe?.name || key,
          category: recipe?.category || '',
          menuPrice: recipe?.menuPrice ?? null,
          totalCost,
          components,
        };

        setFirestoreMenuItems(prevItems => {
          const existingIndex = prevItems.findIndex((item) => item.key === key);

          if (existingIndex === -1) {
            return [...prevItems, nextMenuItem].sort((a, b) => a.name.localeCompare(b.name));
          }

          return prevItems.map((item, index) => (
            index === existingIndex ? { ...item, ...nextMenuItem } : item
          ));
        });

        saveFirestoreMenuItem(nextMenuItem)
          .catch((error) => {
            console.warn('Could not sync repriced recipe to Firebase:', error);
          });
      });
    }

    if (repricedEntries > 0) {
      setWasteItems(nextWasteItems);
      setInventoryMovements(nextWasteItems.flatMap(createInventoryMovementsFromEntry));
    }

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Invoice prices synced',
        user: activeStaffMember?.name || 'System',
        relatedItem: invoiceUpdate?.supplierName || 'Invoice',
        afterValue: {
          invoiceId: invoiceUpdate?.invoiceId || '',
          updatedPrices: updatedKeys.length,
          repricedEntries,
          repricedRecipes,
        },
      }),
      ...prevLog,
    ].slice(0, 500));
    refreshInvoiceDashboardStats();
  }, [activeStaffMember?.name, itemPriceCatalog, recipes, refreshInvoiceDashboardStats, wasteItems]);

  const handleInvoiceIngredientDeleted = useCallback((ingredient) => {
    const key = createItemPriceKey(ingredient?.name);

    if (!key) {
      return;
    }

    setItemPriceCatalog(prevCatalog => {
      const nextCatalog = { ...prevCatalog };
      delete nextCatalog[key];
      return nextCatalog;
    });
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Raw ingredient deleted',
        user: activeStaffMember?.name || 'System',
        relatedItem: ingredient?.name || key,
        beforeValue: ingredient,
      }),
      ...prevLog,
    ].slice(0, 500));
  }, [activeStaffMember?.name]);

  const createStoreRoomMovement = ({ item, type, quantity, previousQuantity, nextQuantity, reason, notes }) => ({
    id: createRecordId('store_movement'),
    itemId: item.id,
    itemName: item.name,
    type,
    quantity: Math.abs(Math.round(quantity * 1000) / 1000),
    unit: item.unit,
    previousQuantity: Math.round(previousQuantity * 1000) / 1000,
    nextQuantity: Math.round(nextQuantity * 1000) / 1000,
    reason: String(reason || '').trim(),
    notes: String(notes || '').trim(),
    staffId: activeStaffMember?.id || '',
    staffName: activeStaffMember?.name || 'System',
    createdAt: new Date().toISOString(),
  });

  const handleSaveStoreRoomItem = (itemDraft) => {
    const permission = requirePermission(accessProfile, 'canManageStoreRoom', 'manage store room stock');
    if (!permission.ok) {
      return { ok: false, message: permission.message };
    }

    const name = String(itemDraft?.name || '').trim();
    const id = itemDraft?.id || createStoreRoomItemId(name);
    const parLevel = Number.parseFloat(itemDraft?.parLevel);
    const reorderPoint = Number.parseFloat(itemDraft?.reorderPoint);
    const normalizedKey = createItemPriceKey(name);
    const priceCatalogRecord = itemDraft?.priceCatalogKey
      ? itemPriceCatalog[itemDraft.priceCatalogKey]
      : itemPriceCatalog[normalizedKey];

    if (!name || !id) {
      return { ok: false, message: 'Enter a stock item name.' };
    }

    const existingItem = storeRoomItems.find((item) => item.id === id);
    const duplicateItem = storeRoomItems.find((item) => (
      item.id !== id
      && (item.normalizedKey === normalizedKey || createItemPriceKey(item.name) === normalizedKey)
    ));

    if (duplicateItem) {
      return { ok: false, message: `${duplicateItem.name} is already in the store room.` };
    }

    const now = new Date().toISOString();
    const nextItem = {
      id,
      name,
      category: String(itemDraft?.category || priceCatalogRecord?.category || 'Other').trim() || 'Other',
      unit: String(itemDraft?.unit || existingItem?.unit || priceCatalogRecord?.baseUnit || priceCatalogRecord?.unit || 'each').trim() || 'each',
      location: String(itemDraft?.location || '').trim(),
      quantity: existingItem?.quantity || 0,
      parLevel: Number.isFinite(parLevel) && parLevel > 0 ? Math.round(parLevel * 1000) / 1000 : 0,
      reorderPoint: Number.isFinite(reorderPoint) && reorderPoint > 0 ? Math.round(reorderPoint * 1000) / 1000 : 0,
      normalizedKey,
      priceCatalogKey: itemDraft?.priceCatalogKey || priceCatalogRecord?.key || normalizedKey,
      supplier: String(itemDraft?.supplier || priceCatalogRecord?.supplier || '').trim(),
      lastPrice: Number.isFinite(Number(priceCatalogRecord?.price)) ? Number(priceCatalogRecord.price) : existingItem?.lastPrice ?? null,
      notes: String(itemDraft?.notes || '').trim(),
      createdAt: existingItem?.createdAt || now,
      updatedAt: now,
      lastMovementAt: existingItem?.lastMovementAt || '',
    };

    setStoreRoomItems(prevItems => {
      const existingIndex = prevItems.findIndex((item) => item.id === id);

      if (existingIndex === -1) {
        return sanitizeStoreRoomItems([...prevItems, nextItem]);
      }

      return sanitizeStoreRoomItems(prevItems.map((item, index) => (
        index === existingIndex ? nextItem : item
      )));
    });

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: existingItem ? 'Store room item updated' : 'Store room item created',
        user: activeStaffMember?.name || 'System',
        relatedItem: nextItem.name,
        beforeValue: existingItem || null,
        afterValue: nextItem,
      }),
      ...prevLog,
    ].slice(0, 500));

    return { ok: true, message: `${nextItem.name} saved.` };
  };

  const handleRecordStoreRoomMovement = (movementDraft) => {
    const permission = requirePermission(accessProfile, 'canManageStoreRoom', 'move store room stock');
    if (!permission.ok) {
      return { ok: false, message: permission.message };
    }

    const item = storeRoomItems.find((stockItem) => stockItem.id === movementDraft?.itemId);
    const quantity = Number.parseFloat(movementDraft?.quantity);
    const stockInTypes = new Set(['stock_in', 'received', 'count_correction_in']);
    const stockOutTypes = new Set(['stock_out', 'issued_kitchen', 'issued_bar', 'waste', 'supplier_return', 'damaged', 'count_correction_out']);
    const requestedType = String(movementDraft?.type || '').trim();
    const type = stockInTypes.has(requestedType)
      ? requestedType
      : stockOutTypes.has(requestedType)
        ? requestedType
        : 'received';
    const isStockIn = stockInTypes.has(type);

    if (!item) {
      return { ok: false, message: 'Choose a store room item.' };
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, message: 'Enter a quantity greater than zero.' };
    }

    const previousQuantity = Number(item.quantity) || 0;
    const nextQuantity = isStockIn
      ? previousQuantity + quantity
      : previousQuantity - quantity;

    if (nextQuantity < 0) {
      return { ok: false, message: `Only ${previousQuantity} ${item.unit} available.` };
    }

    const movement = createStoreRoomMovement({
      item,
      type,
      quantity,
      previousQuantity,
      nextQuantity,
      reason: movementDraft?.reason || (isStockIn ? 'Stock received' : 'Stock removed'),
      notes: movementDraft?.notes,
    });

    setStoreRoomItems(prevItems => sanitizeStoreRoomItems(prevItems.map((stockItem) => (
      stockItem.id === item.id
        ? {
          ...stockItem,
          quantity: Math.round(nextQuantity * 1000) / 1000,
          updatedAt: movement.createdAt,
          lastMovementAt: movement.createdAt,
        }
        : stockItem
    ))));
    setStoreRoomMovements(prevMovements => [movement, ...prevMovements].slice(0, 1000));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: isStockIn ? 'Store room stock added' : 'Store room stock removed',
        user: activeStaffMember?.name || 'System',
        relatedItem: item.name,
        afterValue: movement,
      }),
      ...prevLog,
    ].slice(0, 500));

    return { ok: true, message: `${item.name} ${isStockIn ? 'added' : 'removed'}.` };
  };

  const handleDeleteStoreRoomItem = (itemId) => {
    const permission = requirePermission(accessProfile, 'canManageStoreRoom', 'remove store room stock items');
    if (!permission.ok) {
      return { ok: false, message: permission.message };
    }

    const item = storeRoomItems.find((stockItem) => stockItem.id === itemId);

    if (!item) {
      return { ok: false, message: 'Store room item not found.' };
    }

    setStoreRoomItems(prevItems => prevItems.filter((stockItem) => stockItem.id !== itemId));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Store room item removed',
        user: activeStaffMember?.name || 'System',
        relatedItem: item.name,
        beforeValue: item,
      }),
      ...prevLog,
    ].slice(0, 500));

    return { ok: true, message: `${item.name} removed from the store room.` };
  };

  const handleSaveSettings = ({ budget: nextBudget, dailyWasteValueLimit, dailyWasteEntryLimit }) => {
    const permission = requirePermission(accessProfile, 'canManageLimits', 'change waste limits');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const previousSettings = { budget, ...settings };

    setBudget(parseFloat(nextBudget) || 0);
    setSettings(sanitizeSettings({
      dailyWasteValueLimit,
      dailyWasteEntryLimit,
    }));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Settings changed',
        user: activeStaffId ? staffList.find((member) => member.id === activeStaffId)?.name : 'System',
        relatedItem: 'Waste guardrails',
        beforeValue: previousSettings,
        afterValue: {
          budget: parseFloat(nextBudget) || 0,
          dailyWasteValueLimit,
          dailyWasteEntryLimit,
        },
      }),
      ...prevLog,
    ].slice(0, 500));
  };

  const saveApprovedMenuItems = useCallback(async ({ items, historyRecord, skipPermission = false }) => {
    const permission = skipPermission
      ? { ok: true }
      : requirePermission(accessProfile, 'canManageMenu', 'import menu items');

    if (!permission.ok) {
      return { ok: false, message: permission.message };
    }

    const safeItems = (Array.isArray(items) ? items : [])
      .map((item) => {
        const name = String(item?.name || '').trim();
        const key = item?.key || createMenuItemKey(name);
        const rawMenuPrice = item?.sellingPrice ?? item?.menuPrice ?? item?.price;
        const menuPrice = rawMenuPrice === null || rawMenuPrice === undefined || rawMenuPrice === ''
          ? null
          : parsePriceValue(rawMenuPrice);
        const ingredients = (Array.isArray(item?.components) ? item.components : Array.isArray(item?.ingredients) ? item.ingredients : [])
          .map((component) => normalizeRecipeIngredient(component, item?.category || 'Other'))
          .filter((component) => component.name);

        if (!name || !key) {
          return null;
        }

        return {
          key,
          name,
          menuPrice,
          category: String(item?.category || '').trim(),
          description: String(item?.description || '').trim(),
          instructions: String(item?.instructions || '').trim(),
          portion: String(item?.portion || '').trim(),
          ingredients,
        };
      })
      .filter(Boolean);

    if (safeItems.length === 0) {
      return { ok: false, message: 'No valid approved menu items to save.' };
    }

    setRecipes(prevRecipes => {
      const nextRecipes = { ...prevRecipes };

      safeItems.forEach((item) => {
        nextRecipes[item.key] = {
          ...(nextRecipes[item.key] || {}),
          name: item.name,
          menuPrice: item.menuPrice,
          category: item.category,
          description: item.description,
          instructions: item.instructions,
          portion: item.portion,
          ingredients: item.ingredients,
        };
      });

      return nextRecipes;
    });

    setCustomMenuItems(prevItems => {
      const nextItems = new Map(prevItems.map((item) => [item.key, item]));

      safeItems.forEach((item) => {
        nextItems.set(item.key, {
          key: item.key,
          name: item.name,
          category: item.category,
          menuPrice: item.menuPrice,
        });
      });

      return [...nextItems.values()];
    });

    await Promise.all(safeItems.map(async (item) => {
      const components = item.ingredients.map((ingredient, index) => ({
        key: createMenuItemKey(`${ingredient.name}-${index}`),
        ingredientId: ingredient.ingredientId || ingredient.priceCatalogKey || '',
        name: ingredient.name,
        displayName: ingredient.displayName || ingredient.name,
        quantity: ingredient.quantity || '',
        quantityValue: ingredient.quantityValue ?? null,
        unit: ingredient.unit || '',
        cost: Number(ingredient.cost) || 0,
        costPerBaseUnit: ingredient.costPerBaseUnit ?? null,
        baseUnit: ingredient.baseUnit || '',
        priceCatalogKey: ingredient.priceCatalogKey || ingredient.ingredientId || '',
      }));
      const totalCost = roundCurrency(components.reduce((sum, component) => sum + component.cost, 0));

        await saveFirestoreMenuItem({
          key: item.key,
          name: item.name,
          category: item.category,
          menuPrice: item.menuPrice,
          totalCost,
          components,
        });
        await saveFirestoreRecipe({
          key: item.key,
          name: item.name,
          category: item.category,
          menuPrice: item.menuPrice,
          ingredients: components,
          instructions: item.instructions,
        });

      setFirestoreMenuItems(prevItems => {
        const nextItem = {
          key: item.key,
          firestoreId: item.key,
          name: item.name,
          category: item.category,
          menuPrice: item.menuPrice,
          totalCost,
          components,
        };
        const existingIndex = prevItems.findIndex((menuItem) => menuItem.key === item.key);

        if (existingIndex === -1) {
          return [...prevItems, nextItem].sort((a, b) => a.name.localeCompare(b.name));
        }

        return prevItems.map((menuItem, index) => (
          index === existingIndex ? { ...menuItem, ...nextItem } : menuItem
        ));
      });
    }));

    if (historyRecord) {
      await saveMenuImportHistory(historyRecord);
    }

    setFirebaseSync(prev => ({
      ...prev,
      status: 'synced',
      message: `${safeItems.length} menu item${safeItems.length === 1 ? '' : 's'} saved to Firebase.`,
      lastSavedAt: new Date().toISOString(),
      menuItemCount: Math.max(prev.menuItemCount, firestoreMenuItems.length + safeItems.length),
    }));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Menu import saved',
        user: activeStaffMember?.name || 'Setup manager',
        relatedItem: historyRecord?.sourceName || 'Menu import',
        afterValue: {
          importedItems: safeItems.length,
          importId: historyRecord?.id || '',
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return { ok: true, message: `${safeItems.length} menu item${safeItems.length === 1 ? '' : 's'} saved.` };
  }, [accessProfile, activeStaffMember?.name, firestoreMenuItems.length]);

  const handleFinishSetup = useCallback(async (setupProgress) => {
    const restaurantName = String(setupProgress?.restaurantName || '').trim();
    const managerName = String(setupProgress?.managerName || '').trim();
    const managerPin = String(setupProgress?.managerPin || '').trim();

    if (!restaurantName) {
      return { ok: false, message: 'Enter the restaurant name.' };
    }

    if (!managerName || !managerPin) {
      return { ok: false, message: 'Manager setup is required.' };
    }

    try {
    const managerPinRecord = await createPinRecord(managerPin);

    const managerMember = {
      id: createStaffMemberId(managerName),
      name: managerName,
      role: 'Manager',
      staffSection: 'management',
      managerPin: managerPinRecord,
      removed: false,
      removedAt: '',
      isCsvSeed: false,
    };
    await saveManagerAccount(managerMember).catch((error) => {
      console.warn('Could not save setup manager account to Firestore.', error);
    });
    await saveCurrentUserStaffProfile({
      displayName: managerMember.name,
      role: managerMember.role,
      roleKey: 'manager',
      staffId: managerMember.id,
    }).catch((error) => {
      console.warn('Could not save setup manager Firebase access profile.', error);
    });
    const managerSessionResult = await establishManagerSession({
      managerId: managerMember.id,
      pin: managerPin,
    });

    if (!managerSessionResult.ok) {
      return { ok: false, message: managerSessionResult.message };
    }
    const setupStaffMembers = await Promise.all(
      (Array.isArray(setupProgress?.staffMembers) ? setupProgress.staffMembers : [])
        .filter((member) => String(member?.name || '').trim())
        .map(async (member) => ({
            id: createStaffMemberId(member.name),
            name: String(member.name || '').trim(),
            role: String(member.role || 'Team').trim(),
            staffSection: member.staffSection === 'management'
              ? 'kitchen'
              : member.staffSection || inferStaffSection(member.role),
            staffCode: await createPinRecord(member.code),
            removed: member.active === false,
            removedAt: member.active === false ? new Date().toISOString() : '',
            isCsvSeed: false,
        }))
    );
    const setupStaffSaveResults = await Promise.all(setupStaffMembers.map((member) => (
      saveStaffAccessAccount({ ...member, roleKey: inferRoleKey(member.role) })
    )));
    const failedStaffSave = setupStaffSaveResults.find((result) => !result.ok);
    if (failedStaffSave) {
      return { ok: false, message: failedStaffSave.message };
    }

    setCustomStaffList([managerMember, ...setupStaffMembers]);
    setBudget(parseFloat(setupProgress?.budget) || 0);
    setSettings(sanitizeSettings({
      dailyWasteValueLimit: setupProgress?.dailyWasteValueLimit,
      dailyWasteEntryLimit: setupProgress?.dailyWasteEntryLimit,
    }));

    if (Array.isArray(setupProgress?.menuItems) && setupProgress.menuItems.length > 0) {
      await saveApprovedMenuItems({
        skipPermission: true,
        items: setupProgress.menuItems.map((item) => ({
          ...item,
          sellingPrice: item.sellingPrice ?? item.menuPrice,
        })),
      });
    }

    const profileResult = await saveRestaurantProfile({
      restaurantName,
      branchName: setupProgress?.branchName,
      currency: 'ZAR',
      timezone: 'Africa/Johannesburg',
    }, { completeSetup: true });

    if (!profileResult?.ok) {
      return { ok: false, message: 'Could not save restaurant profile to Firebase.' };
    }

    const nextSession = {
      mode: 'management',
      staffId: managerMember.id,
      staffName: managerMember.name,
      roleKey: inferRoleKey(managerMember.role),
      startedAt: new Date().toISOString(),
      databaseId: getClientDatabaseId(),
    };

    setRestaurantProfile(profileResult.profile);
    setRestaurantProfileStatus('ready');
    setAuthSession(nextSession);
    setActiveStaffId(managerMember.id);
    setActiveTab('dashboard');
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Setup completed',
        user: managerMember.name,
        relatedItem: restaurantName,
        afterValue: {
          staffCreated: setupStaffMembers.length,
          menuItemsCreated: setupProgress?.menuItems?.length || 0,
          setupCompleted: true,
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return { ok: true, message: 'Setup complete.' };
    } catch (error) {
      const message = String(error?.message || '');
      const isPermissionError = error?.code === 'permission-denied'
        || message.toLowerCase().includes('missing or insufficient permissions');

      return {
        ok: false,
        message: isPermissionError
          ? 'Firestore rules are blocking setup. Deploy the updated firestore.rules file, then try Finish setup again.'
          : message || 'Could not finish setup.',
      };
    }
  }, [saveApprovedMenuItems]);

  const handleAddNewRecipe = (key, recipeObject) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'manage menu items and recipes');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    setRecipes(prev => ({
      ...prev,
      [key]: recipeObject
    }));

    const components = buildRecipeIngredientBreakdown(recipeObject, 1, itemPriceCatalog)
      .map((ingredient) => ({
        key: ingredient.componentKey,
        ingredientId: ingredient.ingredientId || ingredient.priceCatalogKey || '',
        name: ingredient.name,
        displayName: ingredient.displayName || ingredient.name,
        quantity: ingredient.quantity || '',
        quantityValue: ingredient.quantityValue ?? null,
        unit: ingredient.unit || '',
        cost: Number(ingredient.cost) || 0,
        costPerBaseUnit: ingredient.costPerBaseUnit ?? null,
        baseUnit: ingredient.baseUnit || '',
        priceCatalogKey: ingredient.priceCatalogKey || ingredient.ingredientId || '',
      }));
    const totalCost = components.reduce((sum, component) => sum + component.cost, 0);

    saveFirestoreMenuItem({
      key,
      name: recipeObject?.name || key,
      category: recipeObject?.category || '',
      menuPrice: recipeObject?.menuPrice,
      totalCost,
      components,
    })
      .then((result) => {
        if (result?.skipped) {
          return;
        }

        const nextItem = {
          key,
          firestoreId: key,
          name: recipeObject?.name || key,
          category: recipeObject?.category || '',
          menuPrice: recipeObject?.menuPrice ?? null,
          totalCost: roundCurrency(totalCost),
          components,
        };
        const nextMenuItemCount = firestoreMenuItems.some((item) => item.key === key)
          ? firestoreMenuItems.length
          : firestoreMenuItems.length + 1;

        setFirestoreMenuItems(prevItems => {
          const existingIndex = prevItems.findIndex((item) => item.key === key);

          if (existingIndex === -1) {
            return [...prevItems, nextItem].sort((a, b) => a.name.localeCompare(b.name));
          }

          return prevItems.map((item, index) => (
            index === existingIndex ? { ...item, ...nextItem } : item
          ));
        });
        setFirebaseSync(prev => ({
          ...prev,
          status: 'synced',
          message: `${nextItem.name} saved to Firebase menu items.`,
          lastSavedAt: new Date().toISOString(),
          menuItemCount: nextMenuItemCount,
        }));
      })
      .catch((error) => {
        console.warn('Could not save menu item to Firestore.', error);
        setFirebaseSync(prev => ({
          ...prev,
          status: 'error',
          message: `${error?.message || 'Could not save menu item to Firebase.'} Local recipe is still saved.`,
        }));
      });
  };

  const handleUpsertMenuItem = ({ key: requestedKey, name, price, category = '' }) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'manage menu items and recipes');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const trimmedName = name.trim();
    const key = requestedKey || createMenuItemKey(trimmedName);

    if (!trimmedName || !key) {
      alert('Please enter a menu item name.');
      return;
    }

    const menuPrice = parsePriceValue(price);
    const normalizedCategory = String(category || '').trim();
    const existingFirestoreItem = firestoreMenuItems.find((item) => item.key === key || item.firestoreId === key);
    const existingRecipe = effectiveRecipes?.[key];
    const existingComponents = existingFirestoreItem?.components || existingRecipe?.ingredients || [];
    const totalCost = Number.isFinite(Number(existingFirestoreItem?.totalCost))
      ? Number(existingFirestoreItem.totalCost)
      : Number.isFinite(Number(existingRecipe?.totalCost))
        ? Number(existingRecipe.totalCost)
        : 0;
    const nextItem = {
      key,
      name: trimmedName,
      category: normalizedCategory,
      menuPrice,
    };

    setCustomMenuItems(prevItems => {
      const existingItemIndex = prevItems.findIndex((item) => item.key === key);

      if (existingItemIndex === -1) {
        return [...prevItems, nextItem];
      }

      return prevItems.map((item, index) => (
        index === existingItemIndex ? nextItem : item
      ));
    });

    setFirestoreMenuItems(prevItems => {
      const existingItemIndex = prevItems.findIndex((item) => item.key === key || item.firestoreId === key);
      const nextFirestoreItem = {
        ...(existingItemIndex >= 0 ? prevItems[existingItemIndex] : {}),
        ...nextItem,
        firestoreId: existingItemIndex >= 0 ? prevItems[existingItemIndex].firestoreId : key,
        totalCost,
        components: existingComponents,
      };

      if (existingItemIndex === -1) {
        return [...prevItems, nextFirestoreItem].sort((a, b) => a.name.localeCompare(b.name));
      }

      return prevItems.map((item, index) => (
        index === existingItemIndex ? nextFirestoreItem : item
      ));
    });

    saveFirestoreMenuItem({
      key,
      name: trimmedName,
      category: normalizedCategory,
      menuPrice,
      totalCost,
      components: existingComponents,
    })
      .then((result) => {
        if (result?.skipped) {
          return;
        }

        setFirebaseSync(prev => ({
          ...prev,
          status: 'synced',
          message: `${trimmedName} saved to Firebase menu items.`,
          lastSavedAt: new Date().toISOString(),
          menuItemCount: firestoreMenuItems.some((item) => item.key === key || item.firestoreId === key)
            ? prev.menuItemCount
            : Math.max(prev.menuItemCount, firestoreMenuItems.length + 1),
        }));
      })
      .catch((error) => {
        console.warn('Could not save menu item to Firestore.', error);
        setFirebaseSync(prev => ({
          ...prev,
          status: 'error',
          message: `${error?.message || 'Could not save menu item to Firebase.'} Local menu item is still saved.`,
        }));
      });
  };

  const handleDeleteCustomMenuItem = async (menuItemKey) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'archive menu items');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const menuItem = menuItems.find((item) => item.key === menuItemKey)
      || customMenuItems.find((item) => item.key === menuItemKey)
      || firestoreMenuItems.find((item) => item.key === menuItemKey || item.firestoreId === menuItemKey)
      || { key: menuItemKey, name: menuItemKey };

    if (!window.confirm(`Archive ${menuItem.name}? It will disappear from active waste logging, but old waste history will stay intact.`)) {
      return;
    }

    const archivedAt = new Date().toISOString();
    const archivedBy = activeStaffMember?.name || 'System';
    const archivedRecord = {
      key: menuItemKey,
      name: menuItem.name || menuItemKey,
      category: menuItem.category || recipes?.[menuItemKey]?.category || '',
      menuPrice: menuItem.menuPrice ?? recipes?.[menuItemKey]?.menuPrice ?? null,
      totalCost: menuItem.totalCost ?? recipes?.[menuItemKey]?.totalCost ?? 0,
      components: menuItem.components || recipes?.[menuItemKey]?.ingredients || [],
      archived: true,
      archivedAt,
      archivedBy,
    };

    setCustomMenuItems(prevItems => {
      const existingIndex = prevItems.findIndex((item) => item.key === menuItemKey);

      if (existingIndex === -1) {
        return [...prevItems, archivedRecord];
      }

      return prevItems.map((item, index) => (
        index === existingIndex ? { ...item, ...archivedRecord } : item
      ));
    });
    setRecipes(prevRecipes => {
      const recipe = prevRecipes?.[menuItemKey];

      if (!recipe) {
        return prevRecipes;
      }

      return {
        ...prevRecipes,
        [menuItemKey]: {
          ...recipe,
          archived: true,
          archivedAt,
          archivedBy,
        },
      };
    });
    setFirestoreMenuItems(prevItems => prevItems.map((item) => (
      item.key === menuItemKey || item.firestoreId === menuItemKey
        ? { ...item, archived: true, archivedAt, archivedBy }
        : item
    )));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Menu item archived',
        user: archivedBy,
        relatedItem: menuItem.name || menuItemKey,
        beforeValue: menuItem,
        afterValue: { key: menuItemKey, archived: true, archivedAt },
      }),
      ...prevLog,
    ].slice(0, 500));

    if (FIRESTORE_CONFIGURED) {
      try {
        await archiveFirestoreMenuItem(menuItemKey, archivedBy);
      } catch (error) {
        console.warn('Could not archive Firebase menu item.', error);
        setFirebaseSync(prev => ({
          ...prev,
          status: 'error',
          message: `${menuItem.name} was archived locally, but Firebase did not update yet.`,
        }));
      }
    }
  };

  const handleRestoreMenuItem = async (menuItemKey) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'restore menu items');

    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const restoredBy = activeStaffMember?.name || 'System';
    setCustomMenuItems(prevItems => prevItems.map((item) => (
      item.key === menuItemKey
        ? { ...item, archived: false, archivedAt: '', archivedBy: '' }
        : item
    )));
    setRecipes(prevRecipes => {
      const recipe = prevRecipes?.[menuItemKey];

      if (!recipe) {
        return prevRecipes;
      }

      return {
        ...prevRecipes,
        [menuItemKey]: {
          ...recipe,
          archived: false,
          archivedAt: '',
          archivedBy: '',
        },
      };
    });
    setFirestoreMenuItems(prevItems => prevItems.map((item) => (
      item.key === menuItemKey || item.firestoreId === menuItemKey
        ? { ...item, archived: false, archivedAt: '', archivedBy: '' }
        : item
    )));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Menu item restored',
        user: restoredBy,
        relatedItem: menuItemKey,
        afterValue: { key: menuItemKey, archived: false },
      }),
      ...prevLog,
    ].slice(0, 500));

    if (FIRESTORE_CONFIGURED) {
      try {
        await restoreFirestoreMenuItem(menuItemKey);
      } catch (error) {
        console.warn('Could not restore Firebase menu item.', error);
        setFirebaseSync(prev => ({
          ...prev,
          status: 'error',
          message: 'Menu item restored locally, but Firebase did not update yet.',
        }));
      }
    }
  };

  const handleDeleteEntry = async (idToDelete, voidReason = 'Manager correction') => {
    const permission = requirePermission(accessProfile, 'canDeleteEntries', 'delete waste entries');
    if (!permission.ok) {
      alert(permission.message);
      return { ok: false, message: permission.message };
    }

    const entryToDelete = wasteItems.find((item) => item.id === idToDelete);

    if (!entryToDelete) {
      return { ok: false, message: 'Waste entry not found.' };
    }

    const voidedAt = new Date().toISOString();
    const voidedBy = staffList.find((member) => member.id === activeStaffId)?.name || entryToDelete.lastEditedBy || 'System';
    const voidedEntry = {
      ...entryToDelete,
      status: 'voided',
      voidedAt,
      voidedBy,
      voidReason: String(voidReason || 'Manager correction').trim() || 'Manager correction',
      lastEditedBy: voidedBy,
      syncStatus: 'pending',
      syncError: '',
    };
    const nextWasteItems = wasteItems.map((item) => (
      item.id === idToDelete ? voidedEntry : item
    ));

    setWasteItems(nextWasteItems);
    setInventoryMovements(nextWasteItems.flatMap(createInventoryMovementsFromEntry));

    if (entryToDelete) {
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'Waste entry voided',
          user: voidedBy,
          relatedItem: entryToDelete.name,
          beforeValue: {
            id: entryToDelete.id,
            foodCostLost: getEntryFoodCostLost(entryToDelete),
            reason: entryToDelete.reason,
          },
          afterValue: {
            status: 'voided',
            voidedAt,
            voidReason: voidedEntry.voidReason,
          },
        }),
        ...prevLog,
      ].slice(0, 500));
    }

    return syncWasteEntryToFirestore(voidedEntry)
      .then((result) => ({ ...result, entry: voidedEntry }))
      .catch((error) => ({ ok: false, entry: voidedEntry, message: error?.message || 'Void saved locally but did not sync yet.' }));
  };

  const handleRestoreEntry = async (entryToRestore) => {
    const permission = requirePermission(accessProfile, 'canDeleteEntries', 'restore deleted waste entries');
    if (!permission.ok) {
      alert(permission.message);
      return { ok: false, message: permission.message };
    }

    if (!entryToRestore?.id) {
      return { ok: false, message: 'Waste entry not found.' };
    }

    const restoredBy = staffList.find((member) => member.id === activeStaffId)?.name || entryToRestore.lastEditedBy || 'System';
    const restoredEntry = {
      ...entryToRestore,
      status: 'logged',
      voidedAt: '',
      voidedBy: '',
      voidReason: '',
      lastEditedBy: restoredBy,
      syncStatus: 'pending',
      syncError: '',
    };
    const nextWasteItems = wasteItems.some((item) => item.id === restoredEntry.id)
      ? wasteItems.map((item) => (item.id === restoredEntry.id ? restoredEntry : item))
      : [...wasteItems, restoredEntry];

    setWasteItems(nextWasteItems);
    setInventoryMovements(nextWasteItems.flatMap(createInventoryMovementsFromEntry));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Waste entry restored',
        user: restoredBy,
        relatedItem: restoredEntry.name,
        afterValue: {
          id: restoredEntry.id,
          foodCostLost: getEntryFoodCostLost(restoredEntry),
          status: 'logged',
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return syncWasteEntryToFirestore(restoredEntry)
      .then((result) => ({ ...result, entry: restoredEntry }))
      .catch((error) => ({ ok: false, entry: restoredEntry, message: error?.message || 'Restore saved locally but did not sync yet.' }));
  };

  const handleClearAll = async () => {
    if (bulkWasteClearInFlightRef.current) {
      return;
    }

    const permission = requirePermission(accessProfile, 'canClearData', 'clear all waste data');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const activeEntries = getActiveWasteEntries(wasteItems);

    if (activeEntries.length === 0) {
      alert('There are no active waste entries to clear.');
      return;
    }

    const typedConfirmation = window.prompt('Type CLEAR WASTE to void every active waste entry. The audit history will be kept.');

    if (typedConfirmation === 'CLEAR WASTE') {
      bulkWasteClearInFlightRef.current = true;
      const voidedAt = new Date().toISOString();
      const voidedBy = activeStaffMember?.name || 'System';
      const activeIds = new Set(activeEntries.map((entry) => entry.id));
      const voidedEntries = activeEntries.map((entry) => ({
        ...entry,
        status: 'voided',
        voidedAt,
        voidedBy,
        voidReason: 'Bulk waste-log clear',
        lastEditedBy: voidedBy,
        syncStatus: 'pending',
        syncError: '',
      }));
      const voidedEntriesById = new Map(voidedEntries.map((entry) => [entry.id, entry]));
      const nextWasteItems = wasteItems.map((entry) => (
        activeIds.has(entry.id) ? voidedEntriesById.get(entry.id) : entry
      ));

      setWasteItems(nextWasteItems);
      setInventoryMovements(nextWasteItems.flatMap(createInventoryMovementsFromEntry));
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'Waste log bulk voided',
          user: voidedBy,
          relatedItem: 'All waste entries',
          beforeValue: {
            entries: activeEntries.length,
            foodCostLost: activeEntries.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0),
          },
          afterValue: { status: 'voided', voidedAt },
        }),
        ...prevLog,
      ].slice(0, 500));

      try {
        const results = await Promise.all(voidedEntries.map(syncWasteEntryToFirestore));
        const failedCount = results.filter((result) => !result?.ok).length;
        setFirebaseSync(prev => ({
          ...prev,
          status: failedCount > 0 ? 'error' : 'synced',
          message: failedCount > 0
            ? `${activeEntries.length - failedCount} entries were voided in Firebase; ${failedCount} still need sync.`
            : `${activeEntries.length} waste entries were voided and remain available in manager audit history.`,
          lastSavedAt: failedCount > 0 ? prev.lastSavedAt : new Date().toISOString(),
        }));
      } finally {
        bulkWasteClearInFlightRef.current = false;
      }
    }
  };

  const handleClearRecipes = async () => {
    const permission = requirePermission(accessProfile, 'canClearData', 'wipe the menu');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const menuCount = menuItems.length;
    const recipeCount = Object.keys(recipes || {}).length;
    const appSavedCount = Array.isArray(customMenuItems) ? customMenuItems.length : 0;
    const firestoreKeys = [...new Set([
      ...firestoreMenuItems.flatMap((item) => [item.firestoreId, item.key]),
      ...Object.keys(recipes || {}),
      ...(Array.isArray(customMenuItems) ? customMenuItems.map((item) => item.key) : []),
    ].map((key) => String(key || '').trim()).filter(Boolean))];

    if (menuCount === 0 && recipeCount === 0 && appSavedCount === 0 && firestoreKeys.length === 0) {
      alert('There is no menu data to wipe.');
      return;
    }

    const typedConfirmation = window.prompt(`Type WIPE MENU to delete ${menuCount} menu item${menuCount === 1 ? '' : 's'} and ${recipeCount} recipe breakdown${recipeCount === 1 ? '' : 's'}.`);

    if (typedConfirmation !== 'WIPE MENU') {
      return;
    }

    setRecipes({});
    setCustomMenuItems([]);
    setFirestoreMenuItems([]);
    localStorage.setItem('customRecipes', JSON.stringify({}));
    localStorage.setItem('customMenuItems', JSON.stringify([]));
    localStorage.setItem('defaultRecipeSeedVersion', DEFAULT_RECIPE_SEED_VERSION);
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Menu wiped',
        user: activeStaffMember?.name || 'System',
        relatedItem: 'Menu & recipes',
        beforeValue: {
          menuItems: menuCount,
          recipes: recipeCount,
          appSavedMenuItems: appSavedCount,
          firestoreMenuItems: firestoreKeys.length,
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    if (!FIRESTORE_CONFIGURED) {
      setFirebaseSync(prev => ({
        ...prev,
        status: 'local',
        message: 'Menu wiped locally. Firebase is not configured.',
        menuItemCount: 0,
      }));
      return;
    }

    try {
      const result = await deleteFirestoreMenuItems(firestoreKeys);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'synced',
        message: `Menu wiped. Removed ${result.deletedCount || firestoreKeys.length} Firebase menu item${(result.deletedCount || firestoreKeys.length) === 1 ? '' : 's'}.`,
        lastSavedAt: new Date().toISOString(),
        menuItemCount: 0,
      }));
    } catch (error) {
      console.warn('Could not wipe Firebase menu items.', error);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: `${error?.message || 'Could not wipe Firebase menu items.'} Local menu was wiped; refresh may reload Firebase items until this is fixed.`,
      }));
    }
  };

  const handleResetRestaurantData = async (confirmationPhrase) => {
    const permission = requirePermission(accessProfile, 'canClearData', 'reset restaurant data');

    if (!permission.ok) {
      return { ok: false, message: permission.message };
    }

    if (!validateRestaurantResetConfirmation(confirmationPhrase)) {
      return { ok: false, message: 'Type RESET to confirm.' };
    }

    try {
      if (FIRESTORE_CONFIGURED) {
        await resetRestaurantFirestoreData();
      }

      getRestaurantResetStorageKeys().forEach((key) => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });

      const emptyData = createEmptyRestaurantData();
      setWasteItems(emptyData.wasteItems);
      setRecipes(emptyData.recipes);
      setCustomStaffList(emptyData.customStaffList);
      setCustomMenuItems(emptyData.customMenuItems);
      setPortionProfiles(emptyData.portionProfiles);
      setItemPriceCatalog(emptyData.itemPriceCatalog);
      setStoreRoomItems(emptyData.storeRoomItems);
      setStoreRoomMovements(emptyData.storeRoomMovements);
      setInventoryMovements(emptyData.inventoryMovements);
      setAuditLog(emptyData.auditLog);
      setFirestoreMenuItems([]);
      setAuthSettings(DEFAULT_AUTH_SETTINGS);
      setAuthSession(null);
      setActiveStaffId('');
      setBudget(0);
      setSettings(DEFAULT_SETTINGS);
      setRestaurantProfile(createDefaultRestaurantProfile());
      setRestaurantProfileStatus(FIRESTORE_CONFIGURED ? 'ready' : 'missing-config');
      setActiveTab('dashboard');
      setFirebaseSync(prev => ({
        ...prev,
        status: FIRESTORE_CONFIGURED ? 'synced' : 'local',
        message: FIRESTORE_CONFIGURED
          ? 'Restaurant data reset. Complete setup again.'
          : 'Local restaurant data reset. Configure Firebase before setup can finish.',
        lastSavedAt: new Date().toISOString(),
        menuItemCount: 0,
      }));

      return { ok: true, message: 'Restaurant data reset. Setup will start again.' };
    } catch (error) {
      return { ok: false, message: error?.message || 'Could not reset restaurant data.' };
    }
  };

  const handleRestoreDatabase = (databaseData) => {
    const permission = requirePermission(accessProfile, 'canRestoreDatabase', 'restore a database backup');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    applyDatabaseData(databaseData);
  };

  const authDataIsLoading = FIRESTORE_CONFIGURED
    && restaurantProfile.setupCompleted
    && (sessionValidationStatus === 'checking' || !managerAccountsLoaded);
  const appIsLocked = !authSession || !managerAuthIsConfigured;

  if (restaurantProfileStatus === 'loading') {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <div className="brand auth-brand">
            <span className="brand-mark">WS</span>
            <div>
              <h1 className="brand-name">WasteShift</h1>
              <p className="brand-subtitle">Loading restaurant profile</p>
            </div>
          </div>
          <div className="muted-box" style={{ marginBottom: 0 }}>Checking setup status.</div>
        </section>
      </main>
    );
  }

  if (!restaurantProfile.setupCompleted) {
    return (
      <Suspense fallback={(
        <main className="auth-screen">
          <section className="auth-panel">
            <div className="muted-box" style={{ marginBottom: 0 }}>Loading setup...</div>
          </section>
        </main>
      )}>
        <SetupWizard
          firestoreConfigured={FIRESTORE_CONFIGURED}
          firebaseSync={firebaseSync}
          onPrepareManagerAccess={handlePrepareSetupManagerAccess}
          onFinishSetup={handleFinishSetup}
        />
      </Suspense>
    );
  }

  if (authDataIsLoading) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <div className="brand auth-brand">
            <span className="brand-mark">WS</span>
            <div>
              <h1 className="brand-name">WasteShift</h1>
              <p className="brand-subtitle">Loading access</p>
            </div>
          </div>
          <div className="muted-box" style={{ marginBottom: 0 }}>Loading manager and staff access from Firebase.</div>
        </section>
      </main>
    );
  }

  if (appIsLocked) {
    return (
      <AuthGate
        isPreparingAuth={isPreparingAuth}
        authIsConfigured={managerAuthIsConfigured}
        staffList={staffList}
        managerRecoveryRequired={managerRecoveryRequired}
        onLogin={handleLogin}
        onInitialManagerSetup={handleInitialManagerSetup}
        onRecoverManagerAccess={handleRecoverManagerAccess}
      />
    );
  }

  return (
    <div className="app-shell">
      <Navbar
        activePage={activeTab}
        onNavigate={setActiveTab}
        wasteCount={activeWasteItems.length}
        activeStaffMember={activeStaffMember}
        accessProfile={accessProfile}
        onLogout={handleLogout}
      />

      <main className={`app-page${['dashboard', 'inventory', 'storeRoom', 'invoices', 'menuPricing', 'wasteLog', 'reports', 'settings'].includes(activeTab) ? ' app-page--wide' : ''}`}>
        <div key={activeTab} className="page-transition">
          <ErrorBoundary key={activeTab}>
            <Suspense fallback={<PageFallback label="Loading screen" />}>
              {activeTab === 'dashboard' && (
                <Dashboard
                  items={activeWasteItems}
                  budget={budget}
                  settings={settings}
                  staffList={staffList}
                  accessProfile={accessProfile}
                  invoiceStats={invoiceDashboardStats}
                  menuItems={menuItems}
                  recipes={effectiveRecipes}
                  onNavigate={setActiveTab}
                />
              )}

            {activeTab === 'logWaste' && (
              <WasteForm
                onAddEntry={handleAddEntry}
                wasteItems={activeWasteItems}
                recipes={effectiveRecipes}
                menuItems={menuItems}
                staffList={staffList}
                portionProfiles={portionProfiles}
                itemPriceCatalog={itemPriceCatalog}
                accessProfile={accessProfile}
                onSavePortionProfile={handleSavePortionProfile}
                activeStaffId={activeStaffId}
                onActiveStaffChange={setActiveStaffId}
                onRetryEntrySync={handleRetryWasteEntrySync}
              />
            )}

            {activeTab === 'wasteLog' && (
              <WasteList
                items={wasteItems}
                onDeleteEntry={handleDeleteEntry}
                onRestoreEntry={handleRestoreEntry}
                onLoadOlderEntries={handleLoadOlderWasteEntries}
                hasOlderEntries={hasOlderWasteEntries}
                isLoadingOlderEntries={isLoadingOlderWasteEntries}
                accessProfile={accessProfile}
              />
            )}

            {activeTab === 'inventory' && (
              <>
                <div className="settings-controls grouped-page-controls">
                  <div className="section-header settings-page-header">
                    <div>
                      <p className="eyebrow">Inventory</p>
                      <h2 className="title">Invoices & Stock</h2>
                      <p className="subtitle">Scan supplier invoices, update ingredient prices, and manage store room stock from one place.</p>
                    </div>
                  </div>
                  <div className="segmented-control settings-tabs" aria-label="Inventory sections">
                    <button
                      type="button"
                      onClick={() => setInventoryView('invoices')}
                      className={`segment-button${inventoryView === 'invoices' ? ' is-active' : ''}`}
                    >
                      Invoices
                    </button>
                    <button
                      type="button"
                      onClick={() => setInventoryView('stock')}
                      className={`segment-button${inventoryView === 'stock' ? ' is-active' : ''}`}
                    >
                      Stock
                    </button>
                  </div>
                </div>

                {inventoryView === 'invoices' ? (
                  <InvoiceScanner
                    accessProfile={accessProfile}
                    recipes={effectiveRecipes}
                    menuItems={menuItems}
                    itemPriceCatalog={itemPriceCatalog}
                    inventoryMovements={inventoryMovements}
                    onInvoiceSaved={refreshInvoiceDashboardStats}
                    onInvoicePricesUpdated={handleInvoicePricesUpdated}
                    onIngredientDeleted={handleInvoiceIngredientDeleted}
                  />
                ) : (
                  <StoreRoom
                    storeRoomItems={storeRoomItems}
                    storeRoomMovements={storeRoomMovements}
                    itemPriceCatalog={itemPriceCatalog}
                    accessProfile={accessProfile}
                    onSaveStoreRoomItem={handleSaveStoreRoomItem}
                    onRecordStoreRoomMovement={handleRecordStoreRoomMovement}
                    onDeleteStoreRoomItem={handleDeleteStoreRoomItem}
                  />
                )}
              </>
            )}

            {activeTab === 'menuPricing' && (
              <>
                <div className="settings-controls grouped-page-controls">
                  <div className="section-header settings-page-header">
                    <div>
                      <p className="eyebrow">Menu & Pricing</p>
                      <h2 className="title">Recipes & Ingredients</h2>
                      <p className="subtitle">Keep sellable dishes separate from raw ingredient prices and invoice-updated costs.</p>
                    </div>
                  </div>
                  <div className="segmented-control settings-tabs" aria-label="Menu and pricing sections">
                    <button
                      type="button"
                      onClick={() => setMenuPricingView('recipes')}
                      className={`segment-button${menuPricingView === 'recipes' ? ' is-active' : ''}`}
                    >
                      Recipes
                    </button>
                    <button
                      type="button"
                      onClick={() => setMenuPricingView('ingredients')}
                      className={`segment-button${menuPricingView === 'ingredients' ? ' is-active' : ''}`}
                    >
                      Ingredients
                    </button>
                  </div>
                </div>

                {menuPricingView === 'recipes' ? (
                  <RecipeManager
                    recipes={effectiveRecipes}
                    menuItems={menuItems}
                    customMenuItems={customMenuItems}
                    itemPriceCatalog={itemPriceCatalog}
                    accessProfile={accessProfile}
                    onAddRecipe={handleAddNewRecipe}
                    onClearRecipes={handleClearRecipes}
                    onSaveMenuItem={handleUpsertMenuItem}
                    onRemoveCustomMenuItem={handleDeleteCustomMenuItem}
                    onRestoreMenuItem={handleRestoreMenuItem}
                    onImportMenuItems={saveApprovedMenuItems}
                    onCreateCatalogItem={handleSaveItemPrice}
                    onCreateCatalogItems={handleCreateCatalogItems}
                    activeStaffMember={activeStaffMember}
                  />
                ) : (
                  <ItemPriceManager
                    itemPriceCatalog={itemPriceCatalog}
                    accessProfile={accessProfile}
                    onSaveItemPrice={handleSaveItemPrice}
                    onDeleteItemPrice={handleDeleteItemPrice}
                  />
                )}
              </>
            )}

            {activeTab === 'storeRoom' && (
              <StoreRoom
                storeRoomItems={storeRoomItems}
                storeRoomMovements={storeRoomMovements}
                itemPriceCatalog={itemPriceCatalog}
                accessProfile={accessProfile}
                onSaveStoreRoomItem={handleSaveStoreRoomItem}
                onRecordStoreRoomMovement={handleRecordStoreRoomMovement}
                onDeleteStoreRoomItem={handleDeleteStoreRoomItem}
              />
            )}

            {activeTab === 'invoices' && (
              <InvoiceScanner
                accessProfile={accessProfile}
                recipes={effectiveRecipes}
                menuItems={menuItems}
                itemPriceCatalog={itemPriceCatalog}
                inventoryMovements={inventoryMovements}
                onInvoiceSaved={refreshInvoiceDashboardStats}
                onInvoicePricesUpdated={handleInvoicePricesUpdated}
                onIngredientDeleted={handleInvoiceIngredientDeleted}
              />
            )}

            {activeTab === 'reports' && (
              <Reports
                wasteItems={wasteItems}
                storeRoomMovements={storeRoomMovements}
                activeStaffMember={activeStaffMember}
                accessProfile={accessProfile}
              />
            )}

            {activeTab === 'settings' && (
              <Settings
                budget={budget}
                settings={settings}
                wasteItems={wasteItems}
                recipes={effectiveRecipes}
                staffList={staffList}
                customStaffList={customStaffList}
                menuItems={menuItems}
                customMenuItems={customMenuItems}
                itemPriceCatalog={itemPriceCatalog}
                storeRoomItems={storeRoomItems}
                storeRoomMovements={storeRoomMovements}
                portionProfiles={portionProfiles}
                activeStaffId={activeStaffId}
                activeStaffMember={activeStaffMember}
                accessProfile={accessProfile}
                inventoryMovements={inventoryMovements}
                auditLog={auditLog}
                syncAccessKey={syncAccessKey}
                authSettings={authSettings}
                authSession={authSession}
                firebaseSync={firebaseSync}
                serverSync={serverSync}
                lastSavedAt={lastSavedAt}
                onSaveSettings={handleSaveSettings}
                onClearAllWaste={handleClearAll}
                onAddStaff={handleAddStaff}
                onDeleteStaff={handleDeleteStaff}
                onResetStaffCode={handleResetStaffCode}
                onAddRecipe={handleAddNewRecipe}
                onClearRecipes={handleClearRecipes}
                onSaveMenuItem={handleUpsertMenuItem}
                onRemoveCustomMenuItem={handleDeleteCustomMenuItem}
                onRestoreMenuItem={handleRestoreMenuItem}
                onImportMenuItems={saveApprovedMenuItems}
                onSaveItemPrice={handleSaveItemPrice}
                onDeleteItemPrice={handleDeleteItemPrice}
                onSaveToServer={() => saveDatabaseToServer('manual')}
                onSaveSyncAccessKey={setSyncAccessKey}
                onSavePinSettings={handleSavePinSettings}
                onLogout={handleLogout}
                onRestoreDatabase={handleRestoreDatabase}
                onResetRestaurantData={handleResetRestaurantData}
              />
            )}
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

export default App;
