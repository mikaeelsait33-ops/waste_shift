import { useState, useCallback, useEffect, useMemo } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import WasteForm from './components/WasteForm';
import WasteList from './components/WasteList';
import RecipeManager from './components/RecipeManager';
import DataManager from './components/DataManager';
import MenuManager from './components/MenuManager';
import defaultRecipes from './data/defaultRecipes';
import menuItemsCsv from './data/menuItems.csv?raw';
import staffMembersCsv from './data/staffMembers.csv?raw';

// Seed recipes from the bundled menu catalog.
const DEFAULT_RECIPES = defaultRecipes;
const DEFAULT_RECIPE_SEED_VERSION = 'makeline-guide-recipes-v4';
const SERVER_DATABASE_ENDPOINT = '/api/database';

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
  const updatedRecipes = {
    ...savedRecipes,
    ...cloneRecipeMap(DEFAULT_RECIPES),
  };

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

  const baseMenuItems = useMemo(() => createMenuItemsFromCsv(menuItemsCsv, recipes), [recipes]);
  const menuItems = useMemo(() => (
    mergeMenuItems(baseMenuItems, customMenuItems, recipes)
  ), [baseMenuItems, customMenuItems, recipes]);
  const baseStaffList = useMemo(() => createStaffMembersFromCsv(staffMembersCsv), []);
  const staffList = useMemo(() => (
    mergeStaffMembers(baseStaffList, customStaffList)
  ), [baseStaffList, customStaffList]);

  const buildDatabaseData = useCallback(() => ({
    wasteItems,
    budget,
    recipes,
    staffList,
    customStaffList,
    customMenuItems,
  }), [wasteItems, budget, recipes, staffList, customStaffList, customMenuItems]);

  const applyDatabaseData = useCallback((databaseData) => {
    setWasteItems(Array.isArray(databaseData.wasteItems) ? databaseData.wasteItems : []);
    setBudget(parseFloat(databaseData.budget) || 0);
    setRecipes(isRecipeMap(databaseData.recipes) ? cloneRecipeMap(databaseData.recipes) : {});
    setCustomStaffList(sanitizeStaffMembers(databaseData.customStaffList ?? databaseData.staffList));
    setCustomMenuItems(sanitizeMenuItems(databaseData.customMenuItems));
  }, []);

  const saveDatabaseToServer = useCallback(async (mode = 'manual') => {
    setServerSync(prev => ({
      ...prev,
      status: 'saving',
      message: mode === 'manual' ? 'Saving database to server...' : 'Auto-saving database to server...',
    }));

    try {
      const response = await fetch(SERVER_DATABASE_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
  }, [buildDatabaseData]);

  useEffect(() => {
    localStorage.setItem('wasteItems', JSON.stringify(wasteItems));
  }, [wasteItems]);

  useEffect(() => {
    localStorage.setItem('wasteBudget', budget.toString());
  }, [budget]);

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
    const timestamp = new Date().toISOString();
    localStorage.setItem('wasteShiftLastSavedAt', timestamp);
    setLastSavedAt(timestamp);
  }, [wasteItems, budget, recipes, customStaffList, customMenuItems]);

  useEffect(() => {
    let isCancelled = false;

    const loadServerDatabase = async () => {
      try {
        const response = await fetch(SERVER_DATABASE_ENDPOINT, { cache: 'no-store' });

        if (!response.ok) {
          throw new Error('Server database route is not available.');
        }

        const payload = await response.json();

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
      } catch {
        if (isCancelled) {
          return;
        }

        setServerSyncEnabled(false);
        setServerLoadComplete(false);
        setServerSync({
          status: 'local',
          message: 'Using browser storage. Deploy to Vercel with Blob storage to enable server sync.',
          lastSavedAt: '',
        });
      }
    };

    loadServerDatabase();

    return () => {
      isCancelled = true;
    };
  }, [applyDatabaseData]);

  useEffect(() => {
    if (!serverSyncEnabled || !serverLoadComplete) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      saveDatabaseToServer('auto');
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [wasteItems, budget, recipes, customStaffList, customMenuItems, serverSyncEnabled, serverLoadComplete, saveDatabaseToServer]);

  const handleAddStaff = (newStaffMember) => {
    setCustomStaffList(prev => {
      const nextStaffMember = {
        ...newStaffMember,
        id: createStaffMemberId(newStaffMember.name),
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
    setCustomStaffList(prev => prev.filter(s => s.id !== staffId));
  };

  const handleAddEntry = (newEntry) => {
    setWasteItems([...wasteItems, newEntry]);
  };

  const handleAddNewRecipe = (key, recipeObject) => {
    setRecipes(prev => ({
      ...prev,
      [key]: recipeObject
    }));
  };

  const handleUpsertMenuItem = ({ name, price }) => {
    const trimmedName = name.trim();
    const key = createMenuItemKey(trimmedName);

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
    setCustomMenuItems(prevItems => prevItems.filter((item) => item.key !== menuItemKey));
  };

  const handleDeleteEntry = (idToDelete) => {
    setWasteItems(wasteItems.filter(item => item.id !== idToDelete));
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear your entire log?')) {
      setWasteItems([]);
    }
  };

  // Completely wipes out browser storage cache memory for custom recipes
  const handleClearRecipes = () => {
    if (window.confirm('Are you sure you want to completely clear out your entire recipe database? This cannot be undone.')) {
      setRecipes({});
      localStorage.setItem('customRecipes', JSON.stringify({}));
      localStorage.setItem('defaultRecipeSeedVersion', DEFAULT_RECIPE_SEED_VERSION);
    }
  };

  const handleRestoreDatabase = (databaseData) => {
    applyDatabaseData(databaseData);
  };

  return (
    <div className="app-shell">
      <Navbar activePage={activeTab} onNavigate={setActiveTab} wasteCount={wasteItems.length} />

      <main className={`app-page${activeTab === 'wasteLog' || activeTab === 'menu' ? ' app-page--wide' : ''}`}>
        {activeTab === 'dashboard' && (
          <Dashboard items={wasteItems} budget={budget} setBudget={setBudget} />
        )}

        {activeTab === 'logWaste' && (
          <WasteForm
            onAddEntry={handleAddEntry}
            recipes={recipes}
            menuItems={menuItems}
            staffList={staffList}
            onAddStaff={handleAddStaff}
            onDeleteStaff={handleDeleteStaff}
          />
        )}

        {activeTab === 'wasteLog' && (
          <WasteList items={wasteItems} onDeleteEntry={handleDeleteEntry} onClearAll={handleClearAll} />
        )}

        {activeTab === 'recipes' && (
          <RecipeManager 
            recipes={recipes} 
            onAddRecipe={handleAddNewRecipe} 
            onClearRecipes={handleClearRecipes} 
          />
        )}

        {activeTab === 'menu' && (
          <MenuManager
            menuItems={menuItems}
            customMenuItems={customMenuItems}
            onSaveMenuItem={handleUpsertMenuItem}
            onRemoveCustomMenuItem={handleDeleteCustomMenuItem}
          />
        )}

        {activeTab === 'database' && (
          <DataManager
            wasteItems={wasteItems}
            budget={budget}
            recipes={recipes}
            staffList={staffList}
            customStaffList={customStaffList}
            menuItems={menuItems}
            customMenuItems={customMenuItems}
            serverSync={serverSync}
            onSaveToServer={() => saveDatabaseToServer('manual')}
            lastSavedAt={lastSavedAt}
            onRestoreDatabase={handleRestoreDatabase}
          />
        )}
      </main>
    </div>
  );
}

export default App;
