import { useCallback } from 'react';
import { requirePermission } from '../utils/accessControl';
import {
  calculateItemPriceCost,
  createItemPriceCatalogFromInvoice,
  createItemPriceKey,
  findItemPriceRecord,
  sanitizeItemPriceCatalog,
  sanitizeItemPriceRecord,
} from '../utils/itemPriceCatalog';
import { createInventoryMovementsFromEntry, roundCurrency } from '../utils/wasteCalculations';
import {
  createAuditLogEntry,
  createMenuItemKey,
  recalculateRecipesFromPriceCatalog,
} from '../utils/appData';
import { FIRESTORE_CONFIGURED } from '../config/appRuntime';
import { saveFirestoreMenuItem } from '../services/firestoreMenuItems';
import { deleteIngredient, saveIngredientPriceRecord } from '../services/invoiceFirestore';

export function useInvoicePricing({
  accessProfile,
  activeStaffMember,
  itemPriceCatalog,
  recipes,
  refreshInvoiceDashboardStats,
  setAuditLog,
  setFirestoreMenuItems,
  setInventoryMovements,
  setItemPriceCatalog,
  setRecipes,
  setWasteItems,
  wasteItems,
}) {
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

    const records = [...candidates.values()].map((record) => (
      findItemPriceRecord(existingCatalog, record.ingredientId)
      || findItemPriceRecord(existingCatalog, record.name)
      || record
    ));
    const newRecords = records.filter((record) => !findItemPriceRecord(existingCatalog, record.ingredientId || record.name));

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
  }, [accessProfile, activeStaffMember?.name, itemPriceCatalog, setAuditLog, setItemPriceCatalog]);

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
  }, [
    activeStaffMember?.name,
    itemPriceCatalog,
    recipes,
    refreshInvoiceDashboardStats,
    setAuditLog,
    setFirestoreMenuItems,
    setInventoryMovements,
    setItemPriceCatalog,
    setRecipes,
    setWasteItems,
    wasteItems,
  ]);

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
  }, [activeStaffMember?.name, setAuditLog, setItemPriceCatalog]);


  return {
    handleCreateCatalogItems,
    handleDeleteItemPrice,
    handleInvoiceIngredientDeleted,
    handleInvoicePricesUpdated,
    handleSaveItemPrice,
  };
}
