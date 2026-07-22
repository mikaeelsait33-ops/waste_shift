import { requirePermission } from '../utils/accessControl';
import { createRecordId } from '../utils/ids';
import { createItemPriceKey } from '../utils/itemPriceCatalog';
import {
  createAuditLogEntry,
  createStoreRoomItemId,
  sanitizeStoreRoomItems,
} from '../utils/appData';

export function useStoreRoom({
  accessProfile,
  activeStaffMember,
  itemPriceCatalog,
  setAuditLog,
  setStoreRoomItems,
  setStoreRoomMovements,
  storeRoomItems,
}) {
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

    setStoreRoomItems((currentItems) => {
      const existingIndex = currentItems.findIndex((item) => item.id === id);

      if (existingIndex === -1) {
        return sanitizeStoreRoomItems([...currentItems, nextItem]);
      }

      return sanitizeStoreRoomItems(currentItems.map((item, index) => (
        index === existingIndex ? nextItem : item
      )));
    });
    setAuditLog((currentLog) => [
      createAuditLogEntry({
        action: existingItem ? 'Store room item updated' : 'Store room item created',
        user: activeStaffMember?.name || 'System',
        relatedItem: nextItem.name,
        beforeValue: existingItem || null,
        afterValue: nextItem,
      }),
      ...currentLog,
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
    const nextQuantity = isStockIn ? previousQuantity + quantity : previousQuantity - quantity;

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

    setStoreRoomItems((currentItems) => sanitizeStoreRoomItems(currentItems.map((stockItem) => (
      stockItem.id === item.id
        ? {
          ...stockItem,
          quantity: Math.round(nextQuantity * 1000) / 1000,
          updatedAt: movement.createdAt,
          lastMovementAt: movement.createdAt,
        }
        : stockItem
    ))));
    setStoreRoomMovements((currentMovements) => [movement, ...currentMovements].slice(0, 1000));
    setAuditLog((currentLog) => [
      createAuditLogEntry({
        action: isStockIn ? 'Store room stock added' : 'Store room stock removed',
        user: activeStaffMember?.name || 'System',
        relatedItem: item.name,
        afterValue: movement,
      }),
      ...currentLog,
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

    setStoreRoomItems((currentItems) => currentItems.filter((stockItem) => stockItem.id !== itemId));
    setAuditLog((currentLog) => [
      createAuditLogEntry({
        action: 'Store room item removed',
        user: activeStaffMember?.name || 'System',
        relatedItem: item.name,
        beforeValue: item,
      }),
      ...currentLog,
    ].slice(0, 500));

    return { ok: true, message: `${item.name} removed from the store room.` };
  };

  return {
    handleDeleteStoreRoomItem,
    handleRecordStoreRoomMovement,
    handleSaveStoreRoomItem,
  };
}
