import { useState } from 'react';
import {
  DEFAULT_AUTH_SETTINGS,
  sanitizeAuthSettings,
} from '../utils/pinAuth';
import { sanitizeItemPriceCatalog } from '../utils/itemPriceCatalog';
import { clearPersistedAuthSession } from '../utils/sessionPersistence';
import {
  DEFAULT_SETTINGS,
  buildInitialRecipes,
  markStaffFreshStartComplete,
  sanitizeMenuItems,
  sanitizePortionProfiles,
  sanitizeSettings,
  sanitizeStaffMembers,
  sanitizeStoreRoomItems,
  sanitizeStoreRoomMovements,
  staffFreshStartIsPending,
} from '../utils/appData';

const readJson = (storageKey, fallback, sanitizer, errorMessage) => {
  try {
    const savedValue = localStorage.getItem(storageKey);
    const parsedValue = savedValue ? JSON.parse(savedValue) : fallback;
    return sanitizer(parsedValue);
  } catch (error) {
    console.error(errorMessage, error);
    return sanitizer(fallback);
  }
};

export function useRestaurantData() {
  const [wasteItems, setWasteItems] = useState(() => readJson(
    'wasteItems',
    [],
    (value) => (Array.isArray(value) ? value : []),
    'Corrupted waste items in storage, resetting.',
  ));
  const [budget, setBudget] = useState(() => {
    const savedBudget = localStorage.getItem('wasteBudget');
    return savedBudget ? parseFloat(savedBudget) : 500;
  });
  const [settings, setSettings] = useState(() => readJson(
    'wasteShiftSettings',
    DEFAULT_SETTINGS,
    sanitizeSettings,
    'Corrupted settings in storage, resetting.',
  ));
  const [authSettings, setAuthSettings] = useState(() => readJson(
    'wasteShiftAuthSettings',
    DEFAULT_AUTH_SETTINGS,
    sanitizeAuthSettings,
    'Corrupted auth settings in storage, resetting.',
  ));
  const [activeStaffId, setActiveStaffId] = useState(() => (
    staffFreshStartIsPending() ? '' : localStorage.getItem('activeStaffId') || ''
  ));
  const [inventoryMovements, setInventoryMovements] = useState(() => readJson(
    'inventoryMovements',
    [],
    (value) => (Array.isArray(value) ? value : []),
    'Corrupted inventory movement history in storage, resetting.',
  ));
  const [auditLog, setAuditLog] = useState(() => readJson(
    'auditLog',
    [],
    (value) => (Array.isArray(value) ? value : []),
    'Corrupted audit log in storage, resetting.',
  ));
  const [lastSavedAt, setLastSavedAt] = useState(() => (
    localStorage.getItem('wasteShiftLastSavedAt') || ''
  ));
  const [invoiceDashboardStats, setInvoiceDashboardStats] = useState({
    totalSpendThisMonth: 0,
    topIngredients: [],
    priceIncreasesThisMonth: [],
    lowStockCount: 0,
    lastInvoice: null,
  });
  const [recipes, setRecipes] = useState(() => {
    try {
      return buildInitialRecipes();
    } catch (error) {
      console.error('Corrupted recipes in storage, resetting.', error);
      return {};
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
      const parsedStaff = savedCustomStaff
        ? JSON.parse(savedCustomStaff)
        : savedLegacyStaff
          ? JSON.parse(savedLegacyStaff)
          : [];

      return sanitizeStaffMembers(parsedStaff);
    } catch (error) {
      console.error('Corrupted staff list in storage, resetting.', error);
      return [];
    }
  });
  const [customMenuItems, setCustomMenuItems] = useState(() => readJson(
    'customMenuItems',
    [],
    sanitizeMenuItems,
    'Corrupted menu items in storage, resetting.',
  ));
  const [firestoreMenuItems, setFirestoreMenuItems] = useState([]);
  const [portionProfiles, setPortionProfiles] = useState(() => readJson(
    'portionProfiles',
    {},
    sanitizePortionProfiles,
    'Corrupted portion profiles in storage, resetting.',
  ));
  const [itemPriceCatalog, setItemPriceCatalog] = useState(() => readJson(
    'itemPriceCatalog',
    {},
    sanitizeItemPriceCatalog,
    'Corrupted item price catalog in storage, resetting.',
  ));
  const [storeRoomItems, setStoreRoomItems] = useState(() => readJson(
    'storeRoomItems',
    [],
    sanitizeStoreRoomItems,
    'Corrupted store room items in storage, resetting.',
  ));
  const [storeRoomMovements, setStoreRoomMovements] = useState(() => readJson(
    'storeRoomMovements',
    [],
    sanitizeStoreRoomMovements,
    'Corrupted store room movements in storage, resetting.',
  ));

  return {
    activeStaffId,
    auditLog,
    authSettings,
    budget,
    customMenuItems,
    customStaffList,
    firestoreMenuItems,
    inventoryMovements,
    invoiceDashboardStats,
    itemPriceCatalog,
    lastSavedAt,
    portionProfiles,
    recipes,
    setActiveStaffId,
    setAuditLog,
    setAuthSettings,
    setBudget,
    setCustomMenuItems,
    setCustomStaffList,
    setFirestoreMenuItems,
    setInventoryMovements,
    setInvoiceDashboardStats,
    setItemPriceCatalog,
    setLastSavedAt,
    setPortionProfiles,
    setRecipes,
    setSettings,
    setStoreRoomItems,
    setStoreRoomMovements,
    setWasteItems,
    settings,
    storeRoomItems,
    storeRoomMovements,
    wasteItems,
  };
}
