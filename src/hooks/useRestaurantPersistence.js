import { useEffect } from 'react';
import { DEFAULT_RECIPE_SEED_VERSION, stripStaffCredentialsForStorage } from '../utils/appData';

export function useRestaurantPersistence({
  activeStaffId,
  auditLog,
  authSettings,
  budget,
  customMenuItems,
  customStaffList,
  inventoryMovements,
  itemPriceCatalog,
  portionProfiles,
  recipes,
  setFirebaseSync,
  setLastSavedAt,
  setWasteItems,
  settings,
  staffList,
  storeRoomItems,
  storeRoomMovements,
  wasteItems,
}) {
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
      setFirebaseSync((current) => ({
        ...current,
        status: 'error',
        message: 'Waste entry is visible now, but this browser could not save it locally. Try removing older entries.',
      }));
      return;
    }

    try {
      localStorage.setItem('wasteItems', JSON.stringify(lightweightWasteItems));
      setWasteItems(lightweightWasteItems);
      setFirebaseSync((current) => ({
        ...current,
        status: 'error',
        message: 'Waste entry saved, but photo previews were removed because this browser ran out of storage.',
      }));
    } catch (fallbackError) {
      console.warn('Could not save lightweight waste entries locally.', fallbackError);
      setFirebaseSync((current) => ({
        ...current,
        status: 'error',
        message: 'Waste entry is visible now, but this browser could not save it locally. Try removing older photo entries or using a smaller photo.',
      }));
    }
  }, [setFirebaseSync, setWasteItems, wasteItems]);

  useEffect(() => {
    localStorage.setItem('wasteBudget', budget.toString());
  }, [budget]);

  useEffect(() => {
    localStorage.setItem('wasteShiftSettings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const { managementPin: _managementPin, staffPin: _staffPin, ...safeAuthSettings } = authSettings;
    localStorage.setItem('wasteShiftAuthSettings', JSON.stringify(safeAuthSettings));
  }, [authSettings]);

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
  }, [
    activeStaffId,
    auditLog,
    authSettings,
    budget,
    customMenuItems,
    customStaffList,
    inventoryMovements,
    itemPriceCatalog,
    portionProfiles,
    recipes,
    setLastSavedAt,
    settings,
    storeRoomItems,
    storeRoomMovements,
    wasteItems,
  ]);
}
