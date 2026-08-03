import { useMemo, useState } from 'react';
import AppWorkspace from '../components/AppWorkspace';
import { getAccessProfile } from '../utils/accessControl';
import { DEFAULT_SETTINGS } from '../utils/appData';

const manager = {
  id: 'staff_beta_manager',
  name: 'Nadia Manager',
  role: 'Manager',
  roleKey: 'manager',
  staffSection: 'management',
};

const kitchenStaff = {
  id: 'staff_beta_kitchen',
  name: 'Kitchen Test',
  role: 'Chef',
  roleKey: 'chef',
  staffSection: 'kitchen',
};

const recipes = {
  chicken_burger: {
    key: 'chicken_burger',
    name: 'Chicken Burger',
    category: 'Lunch',
    menuPrice: 95,
    ingredients: [
      {
        ingredientId: 'ingredient_chicken',
        priceCatalogKey: 'ingredient_chicken',
        name: 'Chicken breast',
        quantity: '150g',
        quantityValue: 150,
        unit: 'g',
        cost: 13.5,
      },
      {
        ingredientId: 'ingredient_bun',
        priceCatalogKey: 'ingredient_bun',
        name: 'Burger bun',
        quantity: '1 each',
        quantityValue: 1,
        unit: 'each',
        cost: 4,
      },
    ],
  },
};

const menuItems = [{
  key: 'chicken_burger',
  name: 'Chicken Burger',
  category: 'Lunch',
  menuPrice: 95,
}];

const itemPriceCatalog = {
  ingredient_chicken: {
    key: 'ingredient_chicken',
    ingredientId: 'ingredient_chicken',
    name: 'Chicken breast',
    category: 'Meat/Poultry',
    price: 90,
    unit: 'kg',
    baseUnit: 'g',
    costPerBaseUnit: 0.09,
  },
  ingredient_bun: {
    key: 'ingredient_bun',
    ingredientId: 'ingredient_bun',
    name: 'Burger bun',
    category: 'Bakery',
    price: 4,
    unit: 'each',
    baseUnit: 'each',
    costPerBaseUnit: 4,
  },
};

export default function WorkspaceHarness() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [menuPricingView, setMenuPricingView] = useState('recipes');
  const [activeStaffId, setActiveStaffId] = useState(manager.id);
  const [wasteItems, setWasteItems] = useState([]);
  const staffList = useMemo(() => [manager, kitchenStaff], []);
  const activeStaffMember = staffList.find((member) => member.id === activeStaffId) || manager;
  const accessProfile = getAccessProfile(activeStaffMember);

  const addWasteEntry = async (entry) => {
    setWasteItems((items) => [...items, { ...entry, syncStatus: 'synced' }]);
    return { ok: true, syncStatus: 'synced', stockResult: { ok: true } };
  };

  return (
    <AppWorkspace
      access={{
        accessProfile,
        activeStaffId,
        activeStaffMember,
        authSession: {
          mode: 'management',
          staffId: manager.id,
          staffName: manager.name,
          roleKey: 'manager',
        },
        onActiveStaffChange: setActiveStaffId,
        onLogout: () => setActiveTab('dashboard'),
      }}
      data={{
        activeWasteItems: wasteItems.filter((item) => item.status !== 'voided'),
        auditLog: [],
        authSettings: {},
        budget: 5000,
        customMenuItems: menuItems,
        customStaffList: staffList,
        effectiveRecipes: recipes,
        inventoryMovements: [],
        invoiceDashboardStats: {
          totalSpendThisMonth: 1250,
          topIngredients: [{ name: 'Chicken breast', spend: 540 }],
          priceIncreasesThisMonth: [],
          lowStockCount: 1,
          lastInvoice: { supplier: 'Beta Foods', invoiceDate: '2026-07-27' },
        },
        itemPriceCatalog,
        lastSavedAt: '2026-07-28T10:00:00.000Z',
        menuItems,
        portionProfiles: {},
        settings: DEFAULT_SETTINGS,
        staffList,
        wasteItems,
      }}
      inventoryActions={{
        onIngredientDeleted: () => {},
        onInvoicePricesUpdated: () => {},
        onInvoiceSaved: () => {},
      }}
      menuActions={{
        onAddRecipe: async () => ({ ok: true, message: 'Menu item saved.' }),
        onClearRecipes: async () => ({ ok: true }),
        onCreateCatalogItem: async () => ({ ok: true, message: 'Ingredient saved.' }),
        onCreateCatalogItems: async () => ({ ok: true, records: [] }),
        onDeleteItemPrice: async () => ({ ok: true }),
        onImportMenuItems: async ({ items }) => ({ ok: true, message: `${items.length} menu items saved.` }),
        onRemoveCustomMenuItem: async () => ({ ok: true }),
        onRestoreMenuItem: async () => ({ ok: true }),
        onSaveMenuItem: async () => ({ ok: true, message: 'Menu item saved.' }),
      }}
      navigation={{
        activeTab,
        menuPricingView,
        onMenuPricingViewChange: setMenuPricingView,
        onNavigate: setActiveTab,
      }}
      pagination={{
        hasOlderEntries: false,
        isLoadingOlderEntries: false,
        onLoadOlderEntries: async () => {},
      }}
      settingsActions={{
        onAddStaff: async () => ({ ok: true }),
        onDeleteStaff: async () => ({ ok: true }),
        onResetRestaurantData: async () => ({ ok: false, message: 'Disabled in browser tests.' }),
        onResetStaffCode: async () => ({ ok: true }),
        onRestoreDatabase: async () => ({ ok: true }),
        onSavePinSettings: async () => ({ ok: true }),
        onSaveSettings: () => {},
        onSaveToFirebase: async () => true,
      }}
      sync={{
        firebaseSync: {
          status: 'ready',
          message: 'Firebase is connected.',
          lastSavedAt: '2026-07-28T10:00:00.000Z',
          menuItemCount: 1,
          projectId: 'wasteshift-e2e',
        },
        isOnline: true,
      }}
      wasteActions={{
        onAddEntry: addWasteEntry,
        onClearAllWaste: async () => {},
        onDeleteEntry: async (id) => {
          setWasteItems((items) => items.map((item) => (
            item.id === id ? { ...item, status: 'voided' } : item
          )));
          return { ok: true };
        },
        onRestoreEntry: async (entry) => {
          setWasteItems((items) => items.map((item) => (
            item.id === entry.id ? { ...item, status: 'logged' } : item
          )));
          return { ok: true };
        },
        onRetryEntrySync: async () => ({ ok: true }),
        onSavePortionProfile: () => {},
      }}
    />
  );
}
