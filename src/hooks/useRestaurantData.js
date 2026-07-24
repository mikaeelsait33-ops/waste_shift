import { useState } from 'react';
import {
  DEFAULT_AUTH_SETTINGS,
} from '../utils/pinAuth';
import {
  DEFAULT_SETTINGS,
  buildInitialRecipes,
} from '../utils/appData';

export function useRestaurantData() {
  const [wasteItems, setWasteItems] = useState([]);
  const [budget, setBudget] = useState(0);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [authSettings, setAuthSettings] = useState(DEFAULT_AUTH_SETTINGS);
  const [activeStaffId, setActiveStaffId] = useState('');
  const [inventoryMovements, setInventoryMovements] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [invoiceDashboardStats, setInvoiceDashboardStats] = useState({
    totalSpendThisMonth: 0,
    topIngredients: [],
    priceIncreasesThisMonth: [],
    lowStockCount: 0,
    lastInvoice: null,
  });
  const [recipes, setRecipes] = useState(() => buildInitialRecipes());
  const [customStaffList, setCustomStaffList] = useState([]);
  const [customMenuItems, setCustomMenuItems] = useState([]);
  const [firestoreMenuItems, setFirestoreMenuItems] = useState([]);
  const [portionProfiles, setPortionProfiles] = useState({});
  const [itemPriceCatalog, setItemPriceCatalog] = useState({});
  const [storeRoomItems, setStoreRoomItems] = useState([]);
  const [storeRoomMovements, setStoreRoomMovements] = useState([]);

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
