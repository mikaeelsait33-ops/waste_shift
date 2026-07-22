import { useCallback } from 'react';
import { requirePermission } from '../utils/accessControl';
import {
  linkRecipeIngredientsToCatalog,
  normalizeRecipeIngredient,
} from '../utils/itemPriceCatalog';
import { buildRecipeIngredientBreakdown, roundCurrency } from '../utils/wasteCalculations';
import {
  DEFAULT_RECIPE_SEED_VERSION,
  createAuditLogEntry,
  createMenuItemKey,
  parsePriceValue,
} from '../utils/appData';
import { FIRESTORE_CONFIGURED } from '../config/appRuntime';
import {
  archiveFirestoreMenuItem,
  deleteFirestoreMenuItems,
  restoreFirestoreMenuItem,
  saveFirestoreMenuItem,
  saveFirestoreRecipe,
} from '../services/firestoreMenuItems';
import { saveIngredientPriceRecord } from '../services/invoiceFirestore';
import { saveMenuImportHistory } from '../services/restaurantFirestore';

export function useMenuRecipes({
  accessProfile,
  activeStaffMember,
  customMenuItems,
  effectiveRecipes,
  firestoreMenuItems,
  itemPriceCatalog,
  menuItems,
  recipes,
  setAuditLog,
  setCustomMenuItems,
  setFirebaseSync,
  setFirestoreMenuItems,
  setItemPriceCatalog,
  setRecipes,
}) {
  const saveApprovedMenuItems = useCallback(async ({ items, historyRecord, skipPermission = false }) => {
    const permission = skipPermission
      ? { ok: true }
      : requirePermission(accessProfile, 'canManageMenu', 'import menu items');

    if (!permission.ok) {
      return { ok: false, message: permission.message };
    }

    const safeItems = (Array.isArray(items) ? items : [])
      .map((item) => {
        const name = String(item?.name || '').trim();
        const key = item?.key || createMenuItemKey(name);
        const rawMenuPrice = item?.sellingPrice ?? item?.menuPrice ?? item?.price;
        const menuPrice = rawMenuPrice === null || rawMenuPrice === undefined || rawMenuPrice === ''
          ? null
          : parsePriceValue(rawMenuPrice);
        const ingredients = (Array.isArray(item?.components) ? item.components : Array.isArray(item?.ingredients) ? item.ingredients : [])
          .map((component) => normalizeRecipeIngredient(component, item?.category || 'Other'))
          .filter((component) => component.name);

        if (!name || !key) {
          return null;
        }

        return {
          key,
          name,
          menuPrice,
          category: String(item?.category || '').trim(),
          description: String(item?.description || '').trim(),
          instructions: String(item?.instructions || '').trim(),
          portion: String(item?.portion || '').trim(),
          ingredients,
        };
      })
      .filter(Boolean);

    if (safeItems.length === 0) {
      return { ok: false, message: 'No valid approved menu items to save.' };
    }

    setRecipes(prevRecipes => {
      const nextRecipes = { ...prevRecipes };

      safeItems.forEach((item) => {
        nextRecipes[item.key] = {
          ...(nextRecipes[item.key] || {}),
          name: item.name,
          menuPrice: item.menuPrice,
          category: item.category,
          description: item.description,
          instructions: item.instructions,
          portion: item.portion,
          ingredients: item.ingredients,
        };
      });

      return nextRecipes;
    });

    setCustomMenuItems(prevItems => {
      const nextItems = new Map(prevItems.map((item) => [item.key, item]));

      safeItems.forEach((item) => {
        nextItems.set(item.key, {
          key: item.key,
          name: item.name,
          category: item.category,
          menuPrice: item.menuPrice,
        });
      });

      return [...nextItems.values()];
    });

    await Promise.all(safeItems.map(async (item) => {
      const components = item.ingredients.map((ingredient, index) => ({
        key: createMenuItemKey(`${ingredient.name}-${index}`),
        ingredientId: ingredient.ingredientId || ingredient.priceCatalogKey || '',
        name: ingredient.name,
        displayName: ingredient.displayName || ingredient.name,
        quantity: ingredient.quantity || '',
        quantityValue: ingredient.quantityValue ?? null,
        unit: ingredient.unit || '',
        cost: Number(ingredient.cost) || 0,
        costPerBaseUnit: ingredient.costPerBaseUnit ?? null,
        baseUnit: ingredient.baseUnit || '',
        priceCatalogKey: ingredient.priceCatalogKey || ingredient.ingredientId || '',
      }));
      const totalCost = roundCurrency(components.reduce((sum, component) => sum + component.cost, 0));

        await saveFirestoreMenuItem({
          key: item.key,
          name: item.name,
          category: item.category,
          menuPrice: item.menuPrice,
          totalCost,
          components,
        });
        await saveFirestoreRecipe({
          key: item.key,
          name: item.name,
          category: item.category,
          menuPrice: item.menuPrice,
          ingredients: components,
          instructions: item.instructions,
        });

      setFirestoreMenuItems(prevItems => {
        const nextItem = {
          key: item.key,
          firestoreId: item.key,
          name: item.name,
          category: item.category,
          menuPrice: item.menuPrice,
          totalCost,
          components,
        };
        const existingIndex = prevItems.findIndex((menuItem) => menuItem.key === item.key);

        if (existingIndex === -1) {
          return [...prevItems, nextItem].sort((a, b) => a.name.localeCompare(b.name));
        }

        return prevItems.map((menuItem, index) => (
          index === existingIndex ? { ...menuItem, ...nextItem } : menuItem
        ));
      });
    }));

    if (historyRecord) {
      await saveMenuImportHistory(historyRecord);
    }

    setFirebaseSync(prev => ({
      ...prev,
      status: 'synced',
      message: `${safeItems.length} menu item${safeItems.length === 1 ? '' : 's'} saved to Firebase.`,
      lastSavedAt: new Date().toISOString(),
      menuItemCount: Math.max(prev.menuItemCount, firestoreMenuItems.length + safeItems.length),
    }));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Menu import saved',
        user: activeStaffMember?.name || 'Setup manager',
        relatedItem: historyRecord?.sourceName || 'Menu import',
        afterValue: {
          importedItems: safeItems.length,
          importId: historyRecord?.id || '',
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return { ok: true, message: `${safeItems.length} menu item${safeItems.length === 1 ? '' : 's'} saved.` };
  }, [
    accessProfile,
    activeStaffMember?.name,
    firestoreMenuItems.length,
    setAuditLog,
    setCustomMenuItems,
    setFirebaseSync,
    setFirestoreMenuItems,
    setRecipes,
  ]);
  const handleAddNewRecipe = async (key, recipeObject) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'manage menu items and recipes');
    if (!permission.ok) {
      alert(permission.message);
      return { ok: false, message: permission.message };
    }

    const recipeName = String(recipeObject?.name || key).trim();
    const catalogLinks = linkRecipeIngredientsToCatalog({
      ingredients: recipeObject?.ingredients,
      itemPriceCatalog,
      recipeKey: key,
      recipeName,
    });
    const linkedRecipe = {
      ...recipeObject,
      name: recipeName,
      ingredients: catalogLinks.ingredients,
    };

    setItemPriceCatalog(catalogLinks.itemPriceCatalog);
    setRecipes(prev => ({
      ...prev,
      [key]: linkedRecipe,
    }));

    const components = buildRecipeIngredientBreakdown(linkedRecipe, 1, catalogLinks.itemPriceCatalog)
      .map((ingredient) => ({
        key: ingredient.componentKey,
        ingredientId: ingredient.ingredientId || ingredient.priceCatalogKey || '',
        name: ingredient.name,
        displayName: ingredient.displayName || ingredient.name,
        quantity: ingredient.quantity || '',
        quantityValue: ingredient.quantityValue ?? null,
        unit: ingredient.unit || '',
        cost: Number(ingredient.cost) || 0,
        costPerBaseUnit: ingredient.costPerBaseUnit ?? null,
        baseUnit: ingredient.baseUnit || '',
        priceCatalogKey: ingredient.priceCatalogKey || ingredient.ingredientId || '',
      }));
    const totalCost = components.reduce((sum, component) => sum + component.cost, 0);
    const nextItem = {
      key,
      firestoreId: key,
      name: recipeName,
      category: linkedRecipe.category || '',
      menuPrice: linkedRecipe.menuPrice ?? null,
      totalCost: roundCurrency(totalCost),
      components,
    };

    setCustomMenuItems((prevItems) => {
      const basicItem = {
        key,
        name: recipeName,
        category: linkedRecipe.category || '',
        menuPrice: linkedRecipe.menuPrice ?? null,
      };
      const existingIndex = prevItems.findIndex((item) => item.key === key);

      if (existingIndex === -1) {
        return [...prevItems, basicItem];
      }

      return prevItems.map((item, index) => (index === existingIndex ? { ...item, ...basicItem } : item));
    });
    setFirestoreMenuItems((prevItems) => {
      const existingIndex = prevItems.findIndex((item) => item.key === key);

      if (existingIndex === -1) {
        return [...prevItems, nextItem].sort((a, b) => a.name.localeCompare(b.name));
      }

      return prevItems.map((item, index) => (index === existingIndex ? { ...item, ...nextItem } : item));
    });

    const saveResults = await Promise.allSettled([
      ...catalogLinks.createdRecords.map((record) => saveIngredientPriceRecord(record)),
      saveFirestoreMenuItem({
        key,
        name: recipeName,
        category: linkedRecipe.category || '',
        menuPrice: linkedRecipe.menuPrice,
        totalCost,
        components,
      }),
      saveFirestoreRecipe({
        key,
        name: recipeName,
        category: linkedRecipe.category || '',
        menuPrice: linkedRecipe.menuPrice,
        ingredients: components,
        instructions: linkedRecipe.instructions || '',
      }),
    ]);
    const failedSaves = saveResults.filter((result) => result.status === 'rejected');
    const ingredientCount = catalogLinks.createdRecords.length;
    const ingredientMessage = ingredientCount > 0
      ? ` ${ingredientCount} new raw ingredient${ingredientCount === 1 ? '' : 's'} added.`
      : '';

    setAuditLog((prevLog) => [
      createAuditLogEntry({
        action: 'Make-line guide saved',
        user: activeStaffMember?.name || 'System',
        relatedItem: recipeName,
        afterValue: {
          ingredientCount: components.length,
          rawIngredientsCreated: ingredientCount,
          totalCost: roundCurrency(totalCost),
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    if (failedSaves.length > 0) {
      const firstError = failedSaves[0].reason;
      console.warn('Could not fully sync recipe to Firestore.', firstError);
      setFirebaseSync((prev) => ({
        ...prev,
        status: 'error',
        message: `${firstError?.message || 'Could not fully sync this recipe.'} Local recipe is still saved.`,
      }));
      return {
        ok: true,
        syncWarning: true,
        createdIngredientCount: ingredientCount,
        message: `Menu item saved on this device.${ingredientMessage} Firebase sync needs retry.`,
      };
    }

    setFirebaseSync((prev) => ({
      ...prev,
      status: 'synced',
      message: `${recipeName} and its make-line guide saved to Firebase.`,
      lastSavedAt: new Date().toISOString(),
      menuItemCount: firestoreMenuItems.some((item) => item.key === key)
        ? firestoreMenuItems.length
        : firestoreMenuItems.length + 1,
    }));

    return {
      ok: true,
      createdIngredientCount: ingredientCount,
      message: `Menu item and make-line guide saved.${ingredientMessage}`,
    };
  };

  const handleUpsertMenuItem = ({ key: requestedKey, name, price, category = '' }) => {
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
    const normalizedCategory = String(category || '').trim();
    const existingFirestoreItem = firestoreMenuItems.find((item) => item.key === key || item.firestoreId === key);
    const existingRecipe = effectiveRecipes?.[key];
    const existingComponents = existingFirestoreItem?.components || existingRecipe?.ingredients || [];
    const totalCost = Number.isFinite(Number(existingFirestoreItem?.totalCost))
      ? Number(existingFirestoreItem.totalCost)
      : Number.isFinite(Number(existingRecipe?.totalCost))
        ? Number(existingRecipe.totalCost)
        : 0;
    const nextItem = {
      key,
      name: trimmedName,
      category: normalizedCategory,
      menuPrice,
    };

    setCustomMenuItems(prevItems => {
      const existingItemIndex = prevItems.findIndex((item) => item.key === key);

      if (existingItemIndex === -1) {
        return [...prevItems, nextItem];
      }

      return prevItems.map((item, index) => (
        index === existingItemIndex ? nextItem : item
      ));
    });

    setFirestoreMenuItems(prevItems => {
      const existingItemIndex = prevItems.findIndex((item) => item.key === key || item.firestoreId === key);
      const nextFirestoreItem = {
        ...(existingItemIndex >= 0 ? prevItems[existingItemIndex] : {}),
        ...nextItem,
        firestoreId: existingItemIndex >= 0 ? prevItems[existingItemIndex].firestoreId : key,
        totalCost,
        components: existingComponents,
      };

      if (existingItemIndex === -1) {
        return [...prevItems, nextFirestoreItem].sort((a, b) => a.name.localeCompare(b.name));
      }

      return prevItems.map((item, index) => (
        index === existingItemIndex ? nextFirestoreItem : item
      ));
    });

    saveFirestoreMenuItem({
      key,
      name: trimmedName,
      category: normalizedCategory,
      menuPrice,
      totalCost,
      components: existingComponents,
    })
      .then((result) => {
        if (result?.skipped) {
          return;
        }

        setFirebaseSync(prev => ({
          ...prev,
          status: 'synced',
          message: `${trimmedName} saved to Firebase menu items.`,
          lastSavedAt: new Date().toISOString(),
          menuItemCount: firestoreMenuItems.some((item) => item.key === key || item.firestoreId === key)
            ? prev.menuItemCount
            : Math.max(prev.menuItemCount, firestoreMenuItems.length + 1),
        }));
      })
      .catch((error) => {
        console.warn('Could not save menu item to Firestore.', error);
        setFirebaseSync(prev => ({
          ...prev,
          status: 'error',
          message: `${error?.message || 'Could not save menu item to Firebase.'} Local menu item is still saved.`,
        }));
      });
  };

  const handleDeleteCustomMenuItem = async (menuItemKey) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'archive menu items');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const menuItem = menuItems.find((item) => item.key === menuItemKey)
      || customMenuItems.find((item) => item.key === menuItemKey)
      || firestoreMenuItems.find((item) => item.key === menuItemKey || item.firestoreId === menuItemKey)
      || { key: menuItemKey, name: menuItemKey };

    if (!window.confirm(`Archive ${menuItem.name}? It will disappear from active waste logging, but old waste history will stay intact.`)) {
      return;
    }

    const archivedAt = new Date().toISOString();
    const archivedBy = activeStaffMember?.name || 'System';
    const archivedRecord = {
      key: menuItemKey,
      name: menuItem.name || menuItemKey,
      category: menuItem.category || recipes?.[menuItemKey]?.category || '',
      menuPrice: menuItem.menuPrice ?? recipes?.[menuItemKey]?.menuPrice ?? null,
      totalCost: menuItem.totalCost ?? recipes?.[menuItemKey]?.totalCost ?? 0,
      components: menuItem.components || recipes?.[menuItemKey]?.ingredients || [],
      archived: true,
      archivedAt,
      archivedBy,
    };

    setCustomMenuItems(prevItems => {
      const existingIndex = prevItems.findIndex((item) => item.key === menuItemKey);

      if (existingIndex === -1) {
        return [...prevItems, archivedRecord];
      }

      return prevItems.map((item, index) => (
        index === existingIndex ? { ...item, ...archivedRecord } : item
      ));
    });
    setRecipes(prevRecipes => {
      const recipe = prevRecipes?.[menuItemKey];

      if (!recipe) {
        return prevRecipes;
      }

      return {
        ...prevRecipes,
        [menuItemKey]: {
          ...recipe,
          archived: true,
          archivedAt,
          archivedBy,
        },
      };
    });
    setFirestoreMenuItems(prevItems => prevItems.map((item) => (
      item.key === menuItemKey || item.firestoreId === menuItemKey
        ? { ...item, archived: true, archivedAt, archivedBy }
        : item
    )));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Menu item archived',
        user: archivedBy,
        relatedItem: menuItem.name || menuItemKey,
        beforeValue: menuItem,
        afterValue: { key: menuItemKey, archived: true, archivedAt },
      }),
      ...prevLog,
    ].slice(0, 500));

    if (FIRESTORE_CONFIGURED) {
      try {
        await archiveFirestoreMenuItem(menuItemKey, archivedBy);
      } catch (error) {
        console.warn('Could not archive Firebase menu item.', error);
        setFirebaseSync(prev => ({
          ...prev,
          status: 'error',
          message: `${menuItem.name} was archived locally, but Firebase did not update yet.`,
        }));
      }
    }
  };

  const handleRestoreMenuItem = async (menuItemKey) => {
    const permission = requirePermission(accessProfile, 'canManageMenu', 'restore menu items');

    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const restoredBy = activeStaffMember?.name || 'System';
    setCustomMenuItems(prevItems => prevItems.map((item) => (
      item.key === menuItemKey
        ? { ...item, archived: false, archivedAt: '', archivedBy: '' }
        : item
    )));
    setRecipes(prevRecipes => {
      const recipe = prevRecipes?.[menuItemKey];

      if (!recipe) {
        return prevRecipes;
      }

      return {
        ...prevRecipes,
        [menuItemKey]: {
          ...recipe,
          archived: false,
          archivedAt: '',
          archivedBy: '',
        },
      };
    });
    setFirestoreMenuItems(prevItems => prevItems.map((item) => (
      item.key === menuItemKey || item.firestoreId === menuItemKey
        ? { ...item, archived: false, archivedAt: '', archivedBy: '' }
        : item
    )));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Menu item restored',
        user: restoredBy,
        relatedItem: menuItemKey,
        afterValue: { key: menuItemKey, archived: false },
      }),
      ...prevLog,
    ].slice(0, 500));

    if (FIRESTORE_CONFIGURED) {
      try {
        await restoreFirestoreMenuItem(menuItemKey);
      } catch (error) {
        console.warn('Could not restore Firebase menu item.', error);
        setFirebaseSync(prev => ({
          ...prev,
          status: 'error',
          message: 'Menu item restored locally, but Firebase did not update yet.',
        }));
      }
    }
  };


  const handleClearRecipes = async () => {
    const permission = requirePermission(accessProfile, 'canClearData', 'wipe the menu');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const menuCount = menuItems.length;
    const recipeCount = Object.keys(recipes || {}).length;
    const appSavedCount = Array.isArray(customMenuItems) ? customMenuItems.length : 0;
    const firestoreKeys = [...new Set([
      ...firestoreMenuItems.flatMap((item) => [item.firestoreId, item.key]),
      ...Object.keys(recipes || {}),
      ...(Array.isArray(customMenuItems) ? customMenuItems.map((item) => item.key) : []),
    ].map((key) => String(key || '').trim()).filter(Boolean))];

    if (menuCount === 0 && recipeCount === 0 && appSavedCount === 0 && firestoreKeys.length === 0) {
      alert('There is no menu data to wipe.');
      return;
    }

    const typedConfirmation = window.prompt(`Type WIPE MENU to delete ${menuCount} menu item${menuCount === 1 ? '' : 's'} and ${recipeCount} recipe breakdown${recipeCount === 1 ? '' : 's'}.`);

    if (typedConfirmation !== 'WIPE MENU') {
      return;
    }

    setRecipes({});
    setCustomMenuItems([]);
    setFirestoreMenuItems([]);
    localStorage.setItem('customRecipes', JSON.stringify({}));
    localStorage.setItem('customMenuItems', JSON.stringify([]));
    localStorage.setItem('defaultRecipeSeedVersion', DEFAULT_RECIPE_SEED_VERSION);
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Menu wiped',
        user: activeStaffMember?.name || 'System',
        relatedItem: 'Menu & recipes',
        beforeValue: {
          menuItems: menuCount,
          recipes: recipeCount,
          appSavedMenuItems: appSavedCount,
          firestoreMenuItems: firestoreKeys.length,
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    if (!FIRESTORE_CONFIGURED) {
      setFirebaseSync(prev => ({
        ...prev,
        status: 'local',
        message: 'Menu wiped locally. Firebase is not configured.',
        menuItemCount: 0,
      }));
      return;
    }

    try {
      const result = await deleteFirestoreMenuItems(firestoreKeys);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'synced',
        message: `Menu wiped. Removed ${result.deletedCount || firestoreKeys.length} Firebase menu item${(result.deletedCount || firestoreKeys.length) === 1 ? '' : 's'}.`,
        lastSavedAt: new Date().toISOString(),
        menuItemCount: 0,
      }));
    } catch (error) {
      console.warn('Could not wipe Firebase menu items.', error);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: `${error?.message || 'Could not wipe Firebase menu items.'} Local menu was wiped; refresh may reload Firebase items until this is fixed.`,
      }));
    }
  };

  return {
    handleAddNewRecipe,
    handleClearRecipes,
    handleDeleteCustomMenuItem,
    handleRestoreMenuItem,
    handleUpsertMenuItem,
    saveApprovedMenuItems,
  };
}
