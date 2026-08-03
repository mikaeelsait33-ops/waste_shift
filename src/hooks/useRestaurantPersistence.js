import { useEffect } from 'react';

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
  setLastSavedAt,
  settings,
  wasteItems,
}) {
  useEffect(() => {
    setLastSavedAt(new Date().toISOString());
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
    wasteItems,
  ]);
}
