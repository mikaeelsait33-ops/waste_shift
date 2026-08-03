import { useCallback, useEffect, useRef } from 'react';
import { requirePermission } from '../utils/accessControl';
import { FIRESTORE_CONFIGURED } from '../config/appRuntime';
import { saveFirestoreWasteEntry } from '../services/firestoreMenuItems';
import { syncWasteStockForEntry } from '../services/wasteStock';
import { createAuditLogEntry, createMenuItemKey } from '../utils/appData';
import {
  createInventoryMovementsFromEntry,
  getEntryFoodCostLost,
} from '../utils/wasteCalculations';
import { getActiveWasteEntries } from '../utils/wasteSync';

export function useWasteEntries({
  accessProfile,
  activeStaffId,
  activeStaffMember,
  isOnline,
  setAuditLog,
  setFirebaseSync,
  setInventoryMovements,
  setPortionProfiles,
  setWasteItems,
  staffList,
  wasteItems,
}) {
  const bulkWasteClearInFlightRef = useRef(false);

  const updateWasteEntrySyncStatus = useCallback((entryId, syncStatus, syncError = '') => {
    setWasteItems(prevItems => prevItems.map((item) => (
      item.id === entryId
        ? {
          ...item,
          syncStatus,
          syncError,
          syncedAt: syncStatus === 'synced' ? new Date().toISOString() : item.syncedAt || '',
        }
        : item
    )));
  }, [setWasteItems]);

  const syncWasteEntryToFirestore = useCallback(async (entry) => {
    if (!FIRESTORE_CONFIGURED) {
      return { ok: false, syncStatus: 'failed', message: 'Firebase is not configured. Waste cannot be saved.' };
    }

    if (!isOnline) {
      return { ok: false, syncStatus: 'failed', message: 'This device is offline. Reconnect before saving waste.' };
    }

    try {
      const hasPhoto = /^data:image\/(?:jpe?g|png|webp);base64,/i.test(String(entry?.photoUrl || ''));
      const encodedPhoto = hasPhoto ? String(entry.photoUrl).split(',', 2)[1] || '' : '';
      const entryForFirestore = hasPhoto
        ? {
            ...entry,
            hasPhoto: true,
            photoMimeType: String(entry.photoUrl).slice(5, String(entry.photoUrl).indexOf(';')),
            photoSizeBytes: Number(entry.photoSizeBytes) || Math.ceil(encodedPhoto.length * 0.75),
            photoUploadedAt: entry.photoUploadedAt || new Date().toISOString(),
            photoUploadStatus: 'stored_in_firestore',
          }
        : entry;

      const result = await saveFirestoreWasteEntry(entryForFirestore);

      if (result?.skipped) {
        updateWasteEntrySyncStatus(entry.id, 'failed', 'Required fields were missing.');
        return { ok: false, syncStatus: 'failed', message: 'Firebase skipped this entry because required fields were missing.' };
      }

      let stockResult = { ok: true, skipped: true };
      let stockWarning = '';

      try {
        stockResult = await syncWasteStockForEntry(entry.id);
      } catch (stockError) {
        stockWarning = stockError?.message || 'Waste was saved, but stock could not be updated.';
      }

      updateWasteEntrySyncStatus(entry.id, 'synced');
      setFirebaseSync(prev => ({
        ...prev,
        status: 'synced',
        message: stockWarning
          ? `Waste entry saved to Firebase. ${stockWarning}`
          : 'Waste entry and stock saved to Firebase.',
        lastSavedAt: new Date().toISOString(),
      }));
      return {
        ok: true,
        syncStatus: 'synced',
        entry: entryForFirestore,
        stockResult,
        warning: stockWarning,
      };
    } catch (error) {
      console.warn('Could not save waste entry to Firestore.', error);
      const message = error?.message || 'Could not save waste entry to Firebase.';
      updateWasteEntrySyncStatus(entry.id, 'failed', message);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message,
      }));
      return { ok: false, syncStatus: 'failed', message };
    }
  }, [isOnline, setFirebaseSync, updateWasteEntrySyncStatus]);

  const handleAddEntry = async (newEntry) => {
    if (!FIRESTORE_CONFIGURED) {
      return {
        ok: false,
        message: 'Firebase is required before waste can be logged.',
      };
    }

    if (!isOnline) {
      return {
        ok: false,
        offline: true,
        message: 'This device is offline. Reconnect before logging waste so the entry cannot be lost.',
      };
    }

    const duplicateWindowMs = 90 * 1000;
    const nowMs = new Date(newEntry?.createdAt || newEntry?.timestamp || Date.now()).getTime();
    const duplicateEntry = wasteItems.find((item) => {
      const itemTime = new Date(item?.createdAt || item?.timestamp || 0).getTime();

      return Math.abs(nowMs - itemTime) <= duplicateWindowMs
        && String(item?.status || 'logged') !== 'voided'
        && String(item?.name || '').trim().toLowerCase() === String(newEntry?.name || '').trim().toLowerCase()
        && String(item?.reason || '').trim().toLowerCase() === String(newEntry?.reason || '').trim().toLowerCase()
        && String(item?.staffId || item?.staff || '').trim().toLowerCase() === String(newEntry?.staffId || newEntry?.staff || '').trim().toLowerCase()
        && Number(item?.quantity || 0) === Number(newEntry?.quantity || 0);
    });

    if (duplicateEntry) {
      return {
        ok: false,
        duplicate: true,
        message: `${newEntry?.name || 'This item'} was already logged moments ago. Check the Waste Log before saving it again.`,
      };
    }

    const entryWithSync = {
      ...newEntry,
      syncStatus: FIRESTORE_CONFIGURED ? 'pending' : 'local',
      syncError: '',
    };

    const result = await syncWasteEntryToFirestore(entryWithSync);

    if (!result?.ok) {
      return result;
    }

    const savedEntry = {
      ...entryWithSync,
      ...(result.entry || {}),
      syncStatus: 'synced',
      syncError: '',
      syncedAt: new Date().toISOString(),
    };
    setWasteItems(prevItems => (
      prevItems.some((item) => item.id === savedEntry.id)
        ? prevItems.map((item) => (item.id === savedEntry.id ? savedEntry : item))
        : [...prevItems, savedEntry]
    ));
    setInventoryMovements(prevMovements => [
      ...prevMovements,
      ...createInventoryMovementsFromEntry(savedEntry),
    ]);
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Waste entry created',
        user: savedEntry.createdBy || savedEntry.staff,
        relatedItem: savedEntry.name,
        afterValue: {
          id: savedEntry.id,
          foodCostLost: getEntryFoodCostLost(savedEntry),
          potentialRevenueLost: Number(savedEntry.potentialRevenueLost) || 0,
          reason: savedEntry.reason,
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return result;
  };

  const handleRetryWasteEntrySync = useCallback(async (entryId) => {
    const entry = wasteItems.find((item) => item.id === entryId);

    if (!entry) {
      return { ok: false, message: 'Entry not found.' };
    }

    return syncWasteEntryToFirestore({
      ...entry,
      syncStatus: 'pending',
      syncError: '',
    });
  }, [syncWasteEntryToFirestore, wasteItems]);

  useEffect(() => {
    if (!FIRESTORE_CONFIGURED || !isOnline) {
      return;
    }

    const retryableEntries = wasteItems.filter((item) => (
      item?.id && ['pending', 'failed'].includes(item.syncStatus)
    )).slice(0, 8);

    retryableEntries.forEach((entry) => {
      syncWasteEntryToFirestore(entry);
    });
  }, [isOnline, syncWasteEntryToFirestore, wasteItems]);

  const handleSavePortionProfile = (profile) => {
    const name = String(profile?.name || '').trim();
    const key = profile?.key || createMenuItemKey(name);
    const amount = parseFloat(profile?.amount);
    const unit = String(profile?.unit || '').trim();

    if (!key || !name || !Number.isFinite(amount) || amount <= 0 || !unit) {
      return;
    }

    setPortionProfiles(prevProfiles => ({
      ...prevProfiles,
      [key]: {
        key,
        name,
        amount,
        unit,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const handleDeleteEntry = async (idToDelete, voidReason = 'Manager correction') => {
    const permission = requirePermission(accessProfile, 'canDeleteEntries', 'delete waste entries');
    if (!permission.ok) {
      alert(permission.message);
      return { ok: false, message: permission.message };
    }

    const entryToDelete = wasteItems.find((item) => item.id === idToDelete);

    if (!entryToDelete) {
      return { ok: false, message: 'Waste entry not found.' };
    }

    const voidedAt = new Date().toISOString();
    const voidedBy = staffList.find((member) => member.id === activeStaffId)?.name || entryToDelete.lastEditedBy || 'System';
    const voidedEntry = {
      ...entryToDelete,
      status: 'voided',
      voidedAt,
      voidedBy,
      voidReason: String(voidReason || 'Manager correction').trim() || 'Manager correction',
      lastEditedBy: voidedBy,
      syncStatus: 'pending',
      syncError: '',
    };
    const result = await syncWasteEntryToFirestore(voidedEntry);
    if (!result?.ok) {
      return result;
    }
    const savedVoidedEntry = {
      ...voidedEntry,
      ...(result.entry || {}),
      syncStatus: 'synced',
      syncError: '',
    };
    const nextWasteItems = wasteItems.map((item) => (
      item.id === idToDelete ? savedVoidedEntry : item
    ));

    setWasteItems(nextWasteItems);
    setInventoryMovements(nextWasteItems.flatMap(createInventoryMovementsFromEntry));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Waste entry voided',
        user: voidedBy,
        relatedItem: entryToDelete.name,
        beforeValue: {
          id: entryToDelete.id,
          foodCostLost: getEntryFoodCostLost(entryToDelete),
          reason: entryToDelete.reason,
        },
        afterValue: {
          status: 'voided',
          voidedAt,
          voidReason: savedVoidedEntry.voidReason,
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return { ...result, entry: savedVoidedEntry };
  };

  const handleRestoreEntry = async (entryToRestore) => {
    const permission = requirePermission(accessProfile, 'canDeleteEntries', 'restore deleted waste entries');
    if (!permission.ok) {
      alert(permission.message);
      return { ok: false, message: permission.message };
    }

    if (!entryToRestore?.id) {
      return { ok: false, message: 'Waste entry not found.' };
    }

    const restoredBy = staffList.find((member) => member.id === activeStaffId)?.name || entryToRestore.lastEditedBy || 'System';
    const restoredEntry = {
      ...entryToRestore,
      status: 'logged',
      voidedAt: '',
      voidedBy: '',
      voidReason: '',
      lastEditedBy: restoredBy,
      syncStatus: 'pending',
      syncError: '',
    };
    const result = await syncWasteEntryToFirestore(restoredEntry);
    if (!result?.ok) {
      return result;
    }
    const savedRestoredEntry = {
      ...restoredEntry,
      ...(result.entry || {}),
      syncStatus: 'synced',
      syncError: '',
    };
    const nextWasteItems = wasteItems.some((item) => item.id === savedRestoredEntry.id)
      ? wasteItems.map((item) => (item.id === savedRestoredEntry.id ? savedRestoredEntry : item))
      : [...wasteItems, savedRestoredEntry];

    setWasteItems(nextWasteItems);
    setInventoryMovements(nextWasteItems.flatMap(createInventoryMovementsFromEntry));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Waste entry restored',
        user: restoredBy,
        relatedItem: savedRestoredEntry.name,
        afterValue: {
          id: savedRestoredEntry.id,
          foodCostLost: getEntryFoodCostLost(savedRestoredEntry),
          status: 'logged',
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return { ...result, entry: savedRestoredEntry };
  };

  const handleClearAll = async () => {
    if (bulkWasteClearInFlightRef.current) {
      return;
    }

    const permission = requirePermission(accessProfile, 'canClearData', 'clear all waste data');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const activeEntries = getActiveWasteEntries(wasteItems);

    if (activeEntries.length === 0) {
      alert('There are no active waste entries to clear.');
      return;
    }

    const typedConfirmation = window.prompt('Type CLEAR WASTE to void every active waste entry. The audit history will be kept.');

    if (typedConfirmation === 'CLEAR WASTE') {
      bulkWasteClearInFlightRef.current = true;
      const voidedAt = new Date().toISOString();
      const voidedBy = activeStaffMember?.name || 'System';
      const voidedEntries = activeEntries.map((entry) => ({
        ...entry,
        status: 'voided',
        voidedAt,
        voidedBy,
        voidReason: 'Bulk waste-log clear',
        lastEditedBy: voidedBy,
        syncStatus: 'pending',
        syncError: '',
      }));

      try {
        const results = [];
        for (let index = 0; index < voidedEntries.length; index += 5) {
          const batch = voidedEntries.slice(index, index + 5);
          results.push(...await Promise.all(batch.map(syncWasteEntryToFirestore)));
        }
        const failedCount = results.filter((result) => !result?.ok).length;
        const savedVoidedEntries = results
          .map((result, index) => (
            result?.ok
              ? {
                  ...voidedEntries[index],
                  ...(result.entry || {}),
                  syncStatus: 'synced',
                  syncError: '',
                }
              : null
          ))
          .filter(Boolean);
        const savedEntriesById = new Map(savedVoidedEntries.map((entry) => [entry.id, entry]));
        const nextWasteItems = wasteItems.map((entry) => savedEntriesById.get(entry.id) || entry);

        setWasteItems(nextWasteItems);
        setInventoryMovements(nextWasteItems.flatMap(createInventoryMovementsFromEntry));
        if (savedVoidedEntries.length > 0) {
          setAuditLog(prevLog => [
            createAuditLogEntry({
              action: 'Waste log bulk voided',
              user: voidedBy,
              relatedItem: 'Waste entries',
              beforeValue: {
                entries: savedVoidedEntries.length,
                foodCostLost: savedVoidedEntries.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0),
              },
              afterValue: { status: 'voided', voidedAt },
            }),
            ...prevLog,
          ].slice(0, 500));
        }
        setFirebaseSync(prev => ({
          ...prev,
          status: failedCount > 0 ? 'error' : 'synced',
          message: failedCount > 0
            ? `${activeEntries.length - failedCount} entries were voided in Firebase; ${failedCount} still need sync.`
            : `${activeEntries.length} waste entries were voided and remain available in manager audit history.`,
          lastSavedAt: failedCount > 0 ? prev.lastSavedAt : new Date().toISOString(),
        }));
      } finally {
        bulkWasteClearInFlightRef.current = false;
      }
    }
  };


  return {
    handleAddEntry,
    handleClearAll,
    handleDeleteEntry,
    handleRestoreEntry,
    handleRetryWasteEntrySync,
    handleSavePortionProfile,
  };
}
