export const RESTAURANT_RESET_CONFIRMATION = 'RESET';

export const createEmptyRestaurantData = () => ({
  wasteItems: [],
  recipes: {},
  customStaffList: [],
  customMenuItems: [],
  portionProfiles: {},
  itemPriceCatalog: {},
  storeRoomItems: [],
  storeRoomMovements: [],
  inventoryMovements: [],
  auditLog: [],
});

export const validateRestaurantResetConfirmation = (value) => (
  String(value || '').trim().toUpperCase() === RESTAURANT_RESET_CONFIRMATION
);

export const getRestaurantResetStorageKeys = () => [
  'wasteItems',
  'customRecipes',
  'defaultRecipeSeedVersion',
  'customStaffList',
  'staffList',
  'customMenuItems',
  'portionProfiles',
  'itemPriceCatalog',
  'storeRoomItems',
  'storeRoomMovements',
  'inventoryMovements',
  'auditLog',
  'activeStaffId',
  'wasteShiftAuthSettings',
  'wasteShiftAuthSession',
  'wasteShiftRestaurantProfiles',
  'wasteBudget',
  'wasteShiftSettings',
  'wasteShiftLastSavedAt',
  'wasteShiftSetupProgress',
];
