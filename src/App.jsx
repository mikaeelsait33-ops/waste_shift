import { useState, useCallback, useEffect, useMemo } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import WasteForm from './components/WasteForm';
import WasteList from './components/WasteList';
import Settings from './components/Settings';
import AuthGate from './components/AuthGate';
import defaultRecipes from './data/defaultRecipes';
import menuItemsCsv from './data/menuItems.csv?raw';
import staffMembersCsv from './data/staffMembers.csv?raw';
import { inferStaffSection } from './utils/staffSections';
import { getAccessProfile, inferRoleKey, requirePermission } from './utils/accessControl';
import {
  calculateItemPriceCost,
  createItemPriceKey,
  sanitizeItemPriceCatalog,
  sanitizeItemPriceRecord,
} from './utils/itemPriceCatalog';
import {
  DEFAULT_AUTH_SETTINGS,
  authPinsAreConfigured,
  createPinRecord,
  sanitizeAuthSettings,
  verifyPin,
} from './utils/pinAuth';
import { createInventoryMovementsFromEntry, getEntryFoodCostLost } from './utils/wasteCalculations';

// Seed recipes from the bundled menu catalog.
const DEFAULT_RECIPES = defaultRecipes;
const DEFAULT_RECIPE_SEED_VERSION = 'makeline-guide-recipes-v5';
const SERVER_DATABASE_ENDPOINT = '/api/database';
const OLD_DEFAULT_COST_BASIS = 'Menu price from menuItems.csv split evenly across listed ingredients.';
const DEFAULT_STAFF_PIN = '1904';
const DEFAULT_MANAGEMENT_PIN = '1905';
const DEFAULT_PIN_PRESET_VERSION = 'shared-default-1904-1905-v1';
const DEFAULT_SETTINGS = {
  dailyWasteValueLimit: 0,
  dailyWasteEntryLimit: 0,
};

const sanitizeAuthSession = (session) => {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return null;
  }

  const mode = session.mode === 'management' ? 'management' : 'staff';
  const staffId = String(session.staffId || '');

  if (!staffId) {
    return null;
  }

  return {
    mode,
    staffId,
    staffName: String(session.staffName || ''),
    roleKey: String(session.roleKey || ''),
    startedAt: String(session.startedAt || ''),
  };
};

const createAuditLogEntry = ({ action, user, relatedItem, beforeValue = null, afterValue = null }) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const mergeDefaultRecipeUpdates = (savedRecipeMap) => {
  const savedRecipes = cloneRecipeMap(savedRecipeMap);
  const updatedRecipes = { ...savedRecipes };
  const defaultRecipesToMerge = cloneRecipeMap(DEFAULT_RECIPES);

  Object.entries(defaultRecipesToMerge).forEach(([key, defaultRecipe]) => {
    const savedRecipe = updatedRecipes[key];

    if (!savedRecipe || savedRecipe.costBasis === OLD_DEFAULT_COST_BASIS) {
      updatedRecipes[key] = defaultRecipe;
    }
  });

  return updatedRecipes;
};

const buildInitialRecipes = () => {
  const savedRecipes = localStorage.getItem('customRecipes');
  const savedSeedVersion = localStorage.getItem('defaultRecipeSeedVersion');
  const savedRecipeMap = savedRecipes ? JSON.parse(savedRecipes) : {};

  if (!isRecipeMap(savedRecipeMap)) {
    return cloneRecipeMap(DEFAULT_RECIPES);
  }

  if (!savedRecipes || savedSeedVersion !== DEFAULT_RECIPE_SEED_VERSION) {
    return mergeDefaultRecipeUpdates(savedRecipeMap);
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

const createMenuItemsFromCsv = (csvText, recipes) => {
  const rows = parseCsvRows(csvText);
  const [headers = [], ...dataRows] = rows;
  const nameColumnIndex = headers.findIndex((header) => header.trim().toLowerCase() === 'name');
  const priceColumnIndex = headers.findIndex((header) => {
    const normalizedHeader = header.trim().toLowerCase().replace(/\s+/g, '_');
    return normalizedHeader === 'price' || normalizedHeader === 'menu_price';
  });

  if (nameColumnIndex === -1) {
    return [];
  }

  const seenKeys = new Set();

  return dataRows
    .map((row) => {
      const name = row[nameColumnIndex]?.trim();

      if (!name) {
        return null;
      }

      const key = createMenuItemKey(name);
      const recipe = recipes?.[key];
      const menuPrice = priceColumnIndex === -1 ? null : parsePriceValue(row?.[priceColumnIndex]);

      return {
        key,
        name,
        menuPrice,
        ingredientCount: Array.isArray(recipe?.ingredients) ? recipe.ingredients.length : 0,
      };
    })
    .filter(Boolean)
    .filter((menuItem) => {
      if (!menuItem.key || seenKeys.has(menuItem.key)) {
        return false;
      }

      seenKeys.add(menuItem.key);
      return true;
    });
};

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

const mergeMenuItems = (baseMenuItems, customMenuItems, recipes) => {
  const customByKey = new Map(customMenuItems.map((item) => [item.key, item]));
  const baseKeys = new Set(baseMenuItems.map((item) => item.key));
  const mergedBaseItems = baseMenuItems.map((baseItem) => {
    const customItem = customByKey.get(baseItem.key);

    if (!customItem) {
      return attachRecipeInfo(baseItem, recipes);
    }

    return attachRecipeInfo({
      ...baseItem,
      menuPrice: customItem.menuPrice,
    }, recipes);
  });
  const customOnlyItems = customMenuItems
    .filter((item) => !baseKeys.has(item.key))
    .map((item) => attachRecipeInfo(item, recipes))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...mergedBaseItems, ...customOnlyItems];
};

const createStaffMembersFromCsv = (csvText) => {
  const rows = parseCsvRows(csvText);
  const [headers = [], ...dataRows] = rows;
  const nameColumnIndex = headers.findIndex((header) => header.trim().toLowerCase() === 'name');
  const roleColumnIndex = headers.findIndex((header) => header.trim().toLowerCase() === 'role');

  if (nameColumnIndex === -1) {
    return [];
  }

  const seenIds = new Set();

  return dataRows
    .map((row) => {
      const name = row[nameColumnIndex]?.trim();

      if (!name) {
        return null;
      }

      const id = createStaffMemberId(name);

      return {
        id,
        name,
        role: roleColumnIndex === -1 ? 'Team' : row[roleColumnIndex]?.trim() || 'Team',
        staffSection: inferStaffSection(roleColumnIndex === -1 ? 'Team' : row[roleColumnIndex]?.trim() || 'Team'),
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

const mergeStaffMembers = (baseStaffMembers, customStaffMembers) => {
  const customById = new Map(customStaffMembers.map((member) => [member.id, member]));
  const baseIds = new Set(baseStaffMembers.map((member) => member.id));
  const mergedBaseMembers = baseStaffMembers.map((baseMember) => customById.get(baseMember.id) || baseMember);
  const customOnlyMembers = customStaffMembers
    .filter((member) => !baseIds.has(member.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...mergedBaseMembers, ...customOnlyMembers];
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [serverSyncEnabled, setServerSyncEnabled] = useState(false);
  const [serverLoadComplete, setServerLoadComplete] = useState(false);
  const [serverSync, setServerSync] = useState({
    status: 'checking',
    message: 'Checking for server database...',
    lastSavedAt: '',
  });
  const [syncAccessKey, setSyncAccessKey] = useState(() => localStorage.getItem('wasteShiftSyncAccessKey') || '');
  const [authSession, setAuthSession] = useState(() => {
    try {
      const savedSession = sessionStorage.getItem('wasteShiftAuthSession');
      return savedSession ? sanitizeAuthSession(JSON.parse(savedSession)) : null;
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

  const [activeStaffId, setActiveStaffId] = useState(() => localStorage.getItem('activeStaffId') || '');

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

  const baseMenuItems = useMemo(() => createMenuItemsFromCsv(menuItemsCsv, recipes), [recipes]);
  const menuItems = useMemo(() => (
    mergeMenuItems(baseMenuItems, customMenuItems, recipes)
  ), [baseMenuItems, customMenuItems, recipes]);
  const baseStaffList = useMemo(() => createStaffMembersFromCsv(staffMembersCsv), []);
  const staffList = useMemo(() => (
    mergeStaffMembers(baseStaffList, customStaffList)
  ), [baseStaffList, customStaffList]);
  const activeStaffMember = useMemo(() => (
    staffList.find((member) => member.id === activeStaffId) || null
  ), [activeStaffId, staffList]);
  const accessProfile = useMemo(() => getAccessProfile(activeStaffMember), [activeStaffMember]);
  const getSyncHeaders = useCallback((extraHeaders = {}) => {
    const trimmedAccessKey = syncAccessKey.trim();

    return {
      ...extraHeaders,
      ...(trimmedAccessKey ? { 'x-wasteshift-sync-secret': trimmedAccessKey } : {}),
    };
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
    settings,
    authSettings,
    activeStaffId,
    inventoryMovements,
    auditLog,
  }), [wasteItems, budget, recipes, staffList, customStaffList, customMenuItems, portionProfiles, itemPriceCatalog, settings, authSettings, activeStaffId, inventoryMovements, auditLog]);

  const applyDatabaseData = useCallback((databaseData) => {
    setWasteItems(Array.isArray(databaseData.wasteItems) ? databaseData.wasteItems : []);
    setBudget(parseFloat(databaseData.budget) || 0);
    setRecipes(isRecipeMap(databaseData.recipes) ? cloneRecipeMap(databaseData.recipes) : {});
    setCustomStaffList(sanitizeStaffMembers(databaseData.customStaffList ?? databaseData.staffList));
    setCustomMenuItems(sanitizeMenuItems(databaseData.customMenuItems));
    setPortionProfiles(sanitizePortionProfiles(databaseData.portionProfiles));
    setItemPriceCatalog(sanitizeItemPriceCatalog(databaseData.itemPriceCatalog));
    setSettings(sanitizeSettings(databaseData.settings));
    if (databaseData.authSettings !== undefined) {
      setAuthSettings(sanitizeAuthSettings(databaseData.authSettings));
    }
    setActiveStaffId(String(databaseData.activeStaffId || ''));
    setInventoryMovements(Array.isArray(databaseData.inventoryMovements) ? databaseData.inventoryMovements : []);
    setAuditLog(Array.isArray(databaseData.auditLog) ? databaseData.auditLog : []);
  }, []);

  const saveDatabaseToServer = useCallback(async (mode = 'manual') => {
    const permission = mode === 'manual'
      ? requirePermission(accessProfile, 'canManageServerSync', 'sync the server database')
      : requirePermission(accessProfile, 'canLogWaste', 'sync the server database');

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
      message: mode === 'manual' ? 'Saving database to server...' : 'Auto-saving database to server...',
    }));

    try {
      const response = await fetch(SERVER_DATABASE_ENDPOINT, {
        method: 'POST',
        headers: getSyncHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ data: buildDatabaseData() }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || 'Server save failed.');
      }

      setServerSyncEnabled(true);
      setServerSync({
        status: 'synced',
        message: 'Server database synced.',
        lastSavedAt: payload.updatedAt || new Date().toISOString(),
      });

      return true;
    } catch (error) {
      setServerSync({
        status: 'error',
        message: `${error?.message || 'Server save failed.'} Local browser copy is still saved.`,
        lastSavedAt: '',
      });

      return false;
    }
  }, [accessProfile, buildDatabaseData, getSyncHeaders]);

  useEffect(() => {
    localStorage.setItem('wasteItems', JSON.stringify(wasteItems));
  }, [wasteItems]);

  useEffect(() => {
    localStorage.setItem('wasteBudget', budget.toString());
  }, [budget]);

  useEffect(() => {
    localStorage.setItem('wasteShiftSettings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem('wasteShiftAuthSettings', JSON.stringify(authSettings));
  }, [authSettings]);

  useEffect(() => {
    if (authSession) {
      sessionStorage.setItem('wasteShiftAuthSession', JSON.stringify(authSession));
      return;
    }

    sessionStorage.removeItem('wasteShiftAuthSession');
  }, [authSession]);

  useEffect(() => {
    const trimmedAccessKey = syncAccessKey.trim();

    if (trimmedAccessKey) {
      localStorage.setItem('wasteShiftSyncAccessKey', trimmedAccessKey);
      return;
    }

    localStorage.removeItem('wasteShiftSyncAccessKey');
  }, [syncAccessKey]);

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
    localStorage.setItem('customStaffList', JSON.stringify(customStaffList));
    localStorage.setItem('staffList', JSON.stringify(staffList));
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
    localStorage.setItem('inventoryMovements', JSON.stringify(inventoryMovements));
  }, [inventoryMovements]);

  useEffect(() => {
    localStorage.setItem('auditLog', JSON.stringify(auditLog));
  }, [auditLog]);

  useEffect(() => {
    const timestamp = new Date().toISOString();
    localStorage.setItem('wasteShiftLastSavedAt', timestamp);
    setLastSavedAt(timestamp);
  }, [wasteItems, budget, recipes, customStaffList, customMenuItems, portionProfiles, itemPriceCatalog, settings, authSettings, activeStaffId, inventoryMovements, auditLog]);

  useEffect(() => {
    let isCancelled = false;

    const loadServerDatabase = async () => {
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
  }, [applyDatabaseData, getSyncHeaders]);

  useEffect(() => {
    if (!serverSyncEnabled || !serverLoadComplete) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      saveDatabaseToServer('auto');
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [wasteItems, budget, recipes, customStaffList, customMenuItems, portionProfiles, itemPriceCatalog, settings, authSettings, activeStaffId, inventoryMovements, auditLog, serverSyncEnabled, serverLoadComplete, saveDatabaseToServer]);

  const handleSavePinSettings = useCallback(async ({ staffPin, managementPin, pinPresetVersion = 'custom' }) => {
    const nextAuthSettings = { ...authSettings };
    const trimmedStaffPin = String(staffPin || '').trim();
    const trimmedManagementPin = String(managementPin || '').trim();

    try {
      if (trimmedStaffPin) {
        nextAuthSettings.staffPin = await createPinRecord(trimmedStaffPin);
      }

      if (trimmedManagementPin) {
        nextAuthSettings.managementPin = await createPinRecord(trimmedManagementPin);
      }

      if (!nextAuthSettings.staffPin || !nextAuthSettings.managementPin) {
        return { ok: false, message: 'Create both a staff PIN and a management PIN.' };
      }

      nextAuthSettings.updatedAt = new Date().toISOString();
      nextAuthSettings.pinPresetVersion = pinPresetVersion;
      setAuthSettings(sanitizeAuthSettings(nextAuthSettings));
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'PIN settings changed',
          user: activeStaffMember?.name || 'System',
          relatedItem: 'Access PINs',
          afterValue: {
            staffPinConfigured: Boolean(nextAuthSettings.staffPin),
            managementPinConfigured: Boolean(nextAuthSettings.managementPin),
          },
        }),
        ...prevLog,
      ].slice(0, 500));

      return { ok: true, message: 'PIN settings saved.' };
    } catch (error) {
      return { ok: false, message: error?.message || 'Could not save PIN settings.' };
    }
  }, [activeStaffMember?.name, authSettings]);

  useEffect(() => {
    let isCancelled = false;

    const ensureDefaultPins = async () => {
      if (authPinsAreConfigured(authSettings) && authSettings.pinPresetVersion) {
        setIsPreparingAuth(false);
        return;
      }

      setIsPreparingAuth(true);
      const result = await handleSavePinSettings({
        staffPin: DEFAULT_STAFF_PIN,
        managementPin: DEFAULT_MANAGEMENT_PIN,
        pinPresetVersion: DEFAULT_PIN_PRESET_VERSION,
      });

      if (!isCancelled && !result?.ok) {
        console.error(result?.message || 'Could not prepare default PINs.');
      }

      if (!isCancelled) {
        setIsPreparingAuth(false);
      }
    };

    ensureDefaultPins();

    return () => {
      isCancelled = true;
    };
  }, [authSettings, handleSavePinSettings]);

  const upsertLoginAccount = useCallback(({ mode, name, staffSection }) => {
    const trimmedName = String(name || '').trim();
    const accountId = createStaffMemberId(trimmedName);
    const existingMember = staffList.find((member) => member.id === accountId);
    const nextMember = mode === 'management'
      ? {
        id: accountId,
        name: trimmedName,
        role: 'Manager',
        staffSection: 'management',
        isCsvSeed: false,
      }
      : {
        id: accountId,
        name: trimmedName,
        role: STAFF_SECTION_ROLE_LABELS[staffSection] || 'Team',
        staffSection: staffSection || 'kitchen',
        isCsvSeed: false,
      };

    setCustomStaffList(prevStaffList => {
      const existingIndex = prevStaffList.findIndex((member) => member.id === accountId);

      if (existingIndex === -1) {
        return [...prevStaffList, nextMember];
      }

      return prevStaffList.map((member, index) => (
        index === existingIndex ? { ...member, ...nextMember } : member
      ));
    });

    return { ...existingMember, ...nextMember };
  }, [staffList]);

  const handleLogin = useCallback(async ({ mode, name, staffSection, pin }) => {
    const trimmedName = String(name || '').trim();

    if (!trimmedName) {
      return { ok: false, message: mode === 'management' ? 'Enter your management name.' : 'Enter your staff name.' };
    }

    const pinRecord = mode === 'management' ? authSettings.managementPin : authSettings.staffPin;
    const pinMatches = await verifyPin(pin, pinRecord);

    if (!pinMatches) {
      return { ok: false, message: 'Incorrect PIN.' };
    }

    const staffMember = upsertLoginAccount({
      mode,
      name: trimmedName,
      staffSection,
    });
    const roleKey = inferRoleKey(staffMember.role);
    const nextSession = {
      mode,
      staffId: staffMember.id,
      staffName: staffMember.name,
      roleKey,
      startedAt: new Date().toISOString(),
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

    return { ok: true, message: 'Login successful.' };
  }, [authSettings.managementPin, authSettings.staffPin, upsertLoginAccount]);

  const handleLogout = useCallback(() => {
    const previousSession = authSession;

    setAuthSession(null);
    setActiveStaffId('');
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
  }, [authSession]);

  const handleAddStaff = (newStaffMember) => {
    const permission = requirePermission(accessProfile, 'canManageStaff', 'manage staff');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    setCustomStaffList(prev => {
      const nextStaffMember = {
        ...newStaffMember,
        id: createStaffMemberId(newStaffMember.name),
        staffSection: inferStaffSection(newStaffMember.staffSection || newStaffMember.role),
        isCsvSeed: false,
      };
      const existingIndex = prev.findIndex((member) => member.id === nextStaffMember.id);

      if (existingIndex === -1) {
        return [...prev, nextStaffMember];
      }

      return prev.map((member, index) => (
        index === existingIndex ? nextStaffMember : member
      ));
    });
  };

  const handleDeleteStaff = (staffId) => {
    const permission = requirePermission(accessProfile, 'canManageStaff', 'remove staff');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    setCustomStaffList(prev => prev.filter(s => s.id !== staffId));
  };

  const handleAddEntry = (newEntry) => {
    setWasteItems(prevItems => [...prevItems, newEntry]);
    setInventoryMovements(prevMovements => [
      ...prevMovements,
      ...createInventoryMovementsFromEntry(newEntry),
    ]);
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Waste entry created',
        user: newEntry.createdBy || newEntry.staff,
        relatedItem: newEntry.name,
        afterValue: {
          id: newEntry.id,
          foodCostLost: getEntryFoodCostLost(newEntry),
          potentialRevenueLost: Number(newEntry.potentialRevenueLost) || 0,
          reason: newEntry.reason,
        },
      }),
      ...prevLog,
    ].slice(0, 500));
  };

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
    const permission = requirePermission(accessProfile, 'canManageMenu', 'manage item prices');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const cleanedRecord = sanitizeItemPriceRecord({
      ...priceRecord,
      updatedAt: new Date().toISOString(),
    });

    if (!cleanedRecord) {
      alert('Enter an item name, price, and unit.');
      return;
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

    if (repricedEntries > 0) {
      setWasteItems(nextWasteItems);
      setInventoryMovements(nextWasteItems.flatMap(createInventoryMovementsFromEntry));
    }

    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Item price saved',
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
  };

  const handleDeleteItemPrice = (itemPriceKey) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'remove item prices');
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

    if (deletedRecord) {
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'Item price removed',
          user: activeStaffMember?.name || 'System',
          relatedItem: deletedRecord.name,
          beforeValue: deletedRecord,
        }),
        ...prevLog,
      ].slice(0, 500));
    }
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
  };

  const handleUpsertMenuItem = ({ key: requestedKey, name, price }) => {
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

    setCustomMenuItems(prevItems => {
      const existingItemIndex = prevItems.findIndex((item) => item.key === key);
      const nextItem = { key, name: trimmedName, menuPrice };

      if (existingItemIndex === -1) {
        return [...prevItems, nextItem];
      }

      return prevItems.map((item, index) => (
        index === existingItemIndex ? nextItem : item
      ));
    });
  };

  const handleDeleteCustomMenuItem = (menuItemKey) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'remove menu items');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    setCustomMenuItems(prevItems => prevItems.filter((item) => item.key !== menuItemKey));
  };

  const handleDeleteEntry = (idToDelete) => {
    const permission = requirePermission(accessProfile, 'canDeleteEntries', 'delete waste entries');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const entryToDelete = wasteItems.find((item) => item.id === idToDelete);

    setWasteItems(prevItems => prevItems.filter(item => item.id !== idToDelete));
    setInventoryMovements(prevMovements => prevMovements.filter((movement) => movement.wasteEntryId !== idToDelete));

    if (entryToDelete) {
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'Waste entry deleted',
          user: staffList.find((member) => member.id === activeStaffId)?.name || entryToDelete.lastEditedBy || 'System',
          relatedItem: entryToDelete.name,
          beforeValue: {
            id: entryToDelete.id,
            foodCostLost: getEntryFoodCostLost(entryToDelete),
            reason: entryToDelete.reason,
          },
        }),
        ...prevLog,
      ].slice(0, 500));
    }
  };

  const handleRestoreEntry = (entryToRestore) => {
    const permission = requirePermission(accessProfile, 'canDeleteEntries', 'restore deleted waste entries');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    if (!entryToRestore?.id) {
      return;
    }

    setWasteItems(prevItems => (
      prevItems.some((item) => item.id === entryToRestore.id)
        ? prevItems
        : [...prevItems, entryToRestore]
    ));
    setInventoryMovements(prevMovements => [
      ...prevMovements.filter((movement) => movement.wasteEntryId !== entryToRestore.id),
      ...createInventoryMovementsFromEntry(entryToRestore),
    ]);
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Waste entry restored',
        user: staffList.find((member) => member.id === activeStaffId)?.name || entryToRestore.lastEditedBy || 'System',
        relatedItem: entryToRestore.name,
        afterValue: {
          id: entryToRestore.id,
          foodCostLost: getEntryFoodCostLost(entryToRestore),
        },
      }),
      ...prevLog,
    ].slice(0, 500));
  };

  const handleClearAll = () => {
    const permission = requirePermission(accessProfile, 'canClearData', 'clear all waste data');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const typedConfirmation = window.prompt('Type CLEAR WASTE to permanently clear the entire waste log.');

    if (typedConfirmation === 'CLEAR WASTE') {
      setWasteItems([]);
      setInventoryMovements([]);
      setAuditLog(prevLog => [
        createAuditLogEntry({
          action: 'Waste log cleared',
          user: staffList.find((member) => member.id === activeStaffId)?.name || 'System',
          relatedItem: 'All waste entries',
          beforeValue: {
            entries: wasteItems.length,
            foodCostLost: wasteItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0),
          },
        }),
        ...prevLog,
      ].slice(0, 500));
    }
  };

  // Completely wipes out browser storage cache memory for custom recipes
  const handleClearRecipes = () => {
    const permission = requirePermission(accessProfile, 'canClearData', 'clear the recipe database');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    if (window.confirm('Are you sure you want to completely clear out your entire recipe database? This cannot be undone.')) {
      setRecipes({});
      localStorage.setItem('customRecipes', JSON.stringify({}));
      localStorage.setItem('defaultRecipeSeedVersion', DEFAULT_RECIPE_SEED_VERSION);
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

  const appIsLocked = !authSession || !authPinsAreConfigured(authSettings);

  if (appIsLocked) {
    return (
      <AuthGate
        isPreparingAuth={isPreparingAuth}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <div className="app-shell">
      <Navbar
        activePage={activeTab}
        onNavigate={setActiveTab}
        wasteCount={wasteItems.length}
        activeStaffMember={activeStaffMember}
        accessProfile={accessProfile}
        onLogout={handleLogout}
      />

      <main className={`app-page${activeTab === 'dashboard' || activeTab === 'wasteLog' || activeTab === 'settings' ? ' app-page--wide' : ''}`}>
        {activeTab === 'dashboard' && (
          <Dashboard items={wasteItems} budget={budget} settings={settings} staffList={staffList} accessProfile={accessProfile} />
        )}

        {activeTab === 'logWaste' && (
          <WasteForm
            onAddEntry={handleAddEntry}
            wasteItems={wasteItems}
            recipes={recipes}
            menuItems={menuItems}
            staffList={staffList}
            portionProfiles={portionProfiles}
            itemPriceCatalog={itemPriceCatalog}
            accessProfile={accessProfile}
            onSavePortionProfile={handleSavePortionProfile}
            activeStaffId={activeStaffId}
            onActiveStaffChange={setActiveStaffId}
          />
        )}

        {activeTab === 'wasteLog' && (
          <WasteList
            items={wasteItems}
            onDeleteEntry={handleDeleteEntry}
            onRestoreEntry={handleRestoreEntry}
            accessProfile={accessProfile}
            activeStaffMember={activeStaffMember}
          />
        )}

        {activeTab === 'settings' && (
          <Settings
            budget={budget}
            settings={settings}
            wasteItems={wasteItems}
            recipes={recipes}
            staffList={staffList}
            customStaffList={customStaffList}
            menuItems={menuItems}
            customMenuItems={customMenuItems}
            itemPriceCatalog={itemPriceCatalog}
            portionProfiles={portionProfiles}
            activeStaffId={activeStaffId}
            activeStaffMember={activeStaffMember}
            accessProfile={accessProfile}
            inventoryMovements={inventoryMovements}
            auditLog={auditLog}
            syncAccessKey={syncAccessKey}
            authSettings={authSettings}
            authSession={authSession}
            serverSync={serverSync}
            lastSavedAt={lastSavedAt}
            onSaveSettings={handleSaveSettings}
            onClearAllWaste={handleClearAll}
            onAddStaff={handleAddStaff}
            onDeleteStaff={handleDeleteStaff}
            onAddRecipe={handleAddNewRecipe}
            onClearRecipes={handleClearRecipes}
            onSaveMenuItem={handleUpsertMenuItem}
            onRemoveCustomMenuItem={handleDeleteCustomMenuItem}
            onSaveItemPrice={handleSaveItemPrice}
            onDeleteItemPrice={handleDeleteItemPrice}
            onSaveToServer={() => saveDatabaseToServer('manual')}
            onSaveSyncAccessKey={setSyncAccessKey}
            onSavePinSettings={handleSavePinSettings}
            onLogout={handleLogout}
            onRestoreDatabase={handleRestoreDatabase}
          />
        )}
      </main>
    </div>
  );
}

export default App;
