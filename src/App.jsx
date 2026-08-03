import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import AuthGate from './components/AuthGate';
import { inferStaffSection } from './utils/staffSections';
import { getAccessProfile, inferRoleKey, requirePermission } from './utils/accessControl';
import { sanitizeItemPriceCatalog } from './utils/itemPriceCatalog';
import {
  DEFAULT_AUTH_SETTINGS,
  authPinsAreConfigured,
  createPinRecord,
  sanitizeAuthSettings,
  sanitizePinRecord,
} from './utils/pinAuth';
import {
  loadFirestoreDatabaseSnapshot,
  loadFirestoreMenuItems,
  loadFirestoreWasteEntries,
  saveFirestoreDatabaseSnapshot,
} from './services/firestoreMenuItems';
import { loadInvoiceDashboardStats } from './services/invoiceFirestore';
import {
  createDefaultRestaurantProfile,
  loadDefaultRestaurantProfile,
  loadRestaurantProfile,
  resetRestaurantFirestoreData,
  saveRestaurantProfile,
} from './services/restaurantFirestore';
import { saveCurrentUserStaffProfile } from './services/firebaseAccess';
import { loadManagerAccounts, saveManagerAccount } from './services/managerAccounts';
import { establishManagerSession } from './services/managerSession';
import { saveStaffAccessAccount, validateRestaurantSession } from './services/staffSession';
import { useRestaurantAccess } from './hooks/useRestaurantAccess';
import { useRestaurantData } from './hooks/useRestaurantData';
import { useRestaurantPersistence } from './hooks/useRestaurantPersistence';
import { useInvoicePricing } from './hooks/useInvoicePricing';
import { useMenuRecipes } from './hooks/useMenuRecipes';
import { useStaffAccess } from './hooks/useStaffAccess';
import { useWasteEntries } from './hooks/useWasteEntries';
import { useWasteHistoryPagination } from './hooks/useWasteHistoryPagination';
import {
  createEmptyRestaurantData,
  validateRestaurantResetConfirmation,
} from './utils/restaurantReset';
import { getActiveWasteEntries } from './utils/wasteSync';
import { getClientDatabaseId } from './utils/clientDatabaseId';
import {
  clearPersistedAuthSession,
} from './utils/sessionPersistence';
import {
  DEFAULT_SETTINGS,
  cloneRecipeMap,
  createAuditLogEntry,
  createMenuItemKey,
  createRecipeMapFromFirestoreMenuItems,
  createSessionStaffFallback,
  createStaffMemberId,
  isRecipeMap,
  mergeManagerAccountsIntoStaffList,
  mergeMenuItems,
  mergeStaffMembers,
  sanitizeMenuItems,
  sanitizePortionProfiles,
  sanitizeSettings,
  sanitizeStaffMembers,
} from './utils/appData';
import {
  FIRESTORE_CONFIGURED,
  FIRESTORE_RUNTIME_INFO,
} from './config/appRuntime';

const AppWorkspace = lazy(() => import('./components/AppWorkspace'));
const SetupWizard = lazy(() => import('./components/SetupWizard'));

const PageFallback = ({ label = 'Loading screen' }) => (
  <div className="panel">
    <div className="panel-body">
      <div className="muted-box" style={{ marginBottom: 0 }}>{label}...</div>
    </div>
  </div>
);

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [menuPricingView, setMenuPricingView] = useState('recipes');
  const [firebaseAutoSaveEnabled, setFirebaseAutoSaveEnabled] = useState(false);
  const [firebaseLoadComplete, setFirebaseLoadComplete] = useState(false);
  const [managerAccountsLoaded, setManagerAccountsLoaded] = useState(!FIRESTORE_CONFIGURED);
  const [firebaseSync, setFirebaseSync] = useState({
    status: FIRESTORE_CONFIGURED ? 'checking' : 'error',
    message: FIRESTORE_CONFIGURED
      ? `Connecting to Firebase${FIRESTORE_RUNTIME_INFO.projectId ? ` project ${FIRESTORE_RUNTIME_INFO.projectId}` : ''}...`
      : 'Firebase is not configured. Restaurant setup and live records are unavailable.',
    lastSavedAt: '',
    menuItemCount: 0,
    projectId: FIRESTORE_RUNTIME_INFO.projectId,
  });
  const [restaurantProfile, setRestaurantProfile] = useState(loadDefaultRestaurantProfile);
  const [restaurantProfileStatus, setRestaurantProfileStatus] = useState(FIRESTORE_CONFIGURED ? 'loading' : 'missing-config');
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ));
  const [authSession, setAuthSession] = useState(null);
  const [isPreparingAuth, setIsPreparingAuth] = useState(false);
  const latestSharedSnapshotUpdatedAtRef = useRef('');

  const {
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
    setWasteItems,
    settings,
    wasteItems,
  } = useRestaurantData();

  const handleSessionRejected = useCallback(() => {
    clearPersistedAuthSession();
    setAuthSession(null);
    setActiveStaffId('');
  }, [setActiveStaffId]);
  const mergeWasteHistoryEntries = useCallback((entries) => {
    const incomingEntries = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.id);

    if (incomingEntries.length === 0) {
      return;
    }

    setWasteItems((currentItems) => {
      const byId = new Map(currentItems.map((item) => [item.id, item]));

      incomingEntries.forEach((entry) => {
        const existing = byId.get(entry.id);
        const existingHasLocalPhoto = String(existing?.photoUrl || '').startsWith('data:image/');
        const existingIsPending = ['pending', 'failed'].includes(String(existing?.syncStatus || ''));

        if (existingIsPending && existingHasLocalPhoto && !entry.photoUrl) {
          byId.set(entry.id, {
            ...entry,
            photoUrl: existing.photoUrl,
            photoName: existing.photoName || entry.photoName || '',
            photoCapturedAt: existing.photoCapturedAt || entry.photoCapturedAt || '',
            syncStatus: existing.syncStatus,
            syncError: existing.syncError || '',
          });
          return;
        }

        byId.set(entry.id, {
          ...(existing || {}),
          ...entry,
          syncStatus: entry.syncStatus || 'synced',
          syncError: entry.syncError || '',
        });
      });

      return [...byId.values()].sort((a, b) => (
        new Date(a.createdAt || a.timestamp || 0).getTime()
        - new Date(b.createdAt || b.timestamp || 0).getTime()
      ));
    });
  }, [setWasteItems]);
  const {
    hasMore: hasOlderWasteEntries,
    isLoading: isLoadingOlderWasteEntries,
    loadInitialPage: loadInitialWasteHistoryPage,
    loadOlderPage: handleLoadOlderWasteEntries,
  } = useWasteHistoryPagination({
    enabled: FIRESTORE_CONFIGURED,
    onAppendEntries: mergeWasteHistoryEntries,
  });
  const {
    directoryLoaded,
    directoryStatus,
    sessionValidationStatus,
    staffDirectory,
  } = useRestaurantAccess({
    firebaseConfigured: FIRESTORE_CONFIGURED,
    restaurantReady: restaurantProfile.setupCompleted,
    authSession,
    onSessionRejected: handleSessionRejected,
  });

  useEffect(() => {
    if (
      !FIRESTORE_CONFIGURED
      || !restaurantProfile.setupCompleted
      || restaurantProfileStatus !== 'ready'
      || authSession
    ) {
      return undefined;
    }

    let isCancelled = false;
    setIsPreparingAuth(true);

    validateRestaurantSession()
      .then((result) => {
        if (isCancelled || !result?.ok || !result.session?.staffId) {
          return;
        }

        const serverSession = result.session;
        const roleKey = String(serverSession.roleKey || '').trim().toLowerCase();
        const nextSession = {
          mode: ['owner', 'manager'].includes(roleKey) ? 'management' : 'staff',
          staffId: String(serverSession.staffId || '').trim(),
          staffName: String(serverSession.staffName || '').trim(),
          roleKey,
          startedAt: String(serverSession.issuedAt || serverSession.updatedAt || new Date().toISOString()),
          databaseId: String(serverSession.databaseId || getClientDatabaseId()).trim(),
        };

        setAuthSession(nextSession);
        setActiveStaffId(nextSession.staffId);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsPreparingAuth(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [authSession, restaurantProfile.setupCompleted, restaurantProfileStatus, setActiveStaffId]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const loadProfile = async () => {
      if (!FIRESTORE_CONFIGURED) {
        setRestaurantProfile(loadDefaultRestaurantProfile());
        setRestaurantProfileStatus('missing-config');
        return;
      }

      setRestaurantProfileStatus('loading');

      try {
        const result = await loadRestaurantProfile();

        if (!isCancelled) {
          if (result.didAdoptSingleShop) {
            setFirebaseSync(prev => ({
              ...prev,
              status: 'ready',
              message: 'Joined the canonical Firebase restaurant.',
            }));
            setRestaurantProfile(result.profile || createDefaultRestaurantProfile());
            setRestaurantProfileStatus('ready');
            return;
          }

          setRestaurantProfile(result.profile || createDefaultRestaurantProfile());
          setRestaurantProfileStatus('ready');
        }
      } catch (error) {
        console.warn('Restaurant profile unavailable.', error);

        if (!isCancelled) {
          setRestaurantProfile(loadDefaultRestaurantProfile());
          setRestaurantProfileStatus('error');
          setFirebaseSync(prev => ({
            ...prev,
            status: 'error',
            message: `${error?.message || 'Restaurant profile could not load.'} Setup cannot finish until Firebase is available.`,
          }));
        }
      }
    };

    loadProfile();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!directoryLoaded) return;

    if (staffDirectory.length > 0) {
      setCustomStaffList((currentStaff) => {
        const staffById = new Map(currentStaff.map((member) => [member.id, member]));
        staffDirectory.forEach((member) => {
          staffById.set(member.id, {
            ...staffById.get(member.id),
            ...member,
            staffCode: staffById.get(member.id)?.staffCode || null,
            managerPin: null,
          });
        });
        return sanitizeStaffMembers([...staffById.values()]);
      });
    }
    setManagerAccountsLoaded(true);
  }, [directoryLoaded, setCustomStaffList, staffDirectory]);

  useEffect(() => {
    let isCancelled = false;

    const loadMenuItems = async () => {
      if (!FIRESTORE_CONFIGURED) {
        setFirebaseSync(prev => ({
          ...prev,
          status: 'error',
          message: 'Firebase is not configured. Menu data is unavailable.',
        }));
        return;
      }

      if (!authSession || sessionValidationStatus !== 'ready') {
        return;
      }

      setFirebaseSync(prev => ({
        ...prev,
        status: 'checking',
        message: `Connecting to Firebase${prev.projectId ? ` project ${prev.projectId}` : ''}...`,
      }));

      try {
        const loadedMenuItems = await loadFirestoreMenuItems();

        if (!isCancelled) {
          setFirestoreMenuItems(loadedMenuItems);
          setFirebaseSync(prev => ({
            ...prev,
            status: 'ready',
            message: loadedMenuItems.length > 0
              ? `Firebase connected. Loaded ${loadedMenuItems.length} menu item${loadedMenuItems.length === 1 ? '' : 's'}.`
              : 'Firebase connected. No Firestore menu items have been added yet.',
            lastSavedAt: new Date().toISOString(),
            menuItemCount: loadedMenuItems.length,
          }));
        }
      } catch (error) {
        console.warn('Firestore menu items unavailable.', error);
        if (!isCancelled) {
          setFirebaseSync(prev => ({
            ...prev,
            status: 'error',
            message: error?.message || 'Firebase menu data is unavailable.',
          }));
        }
      }
    };

    loadMenuItems();

    return () => {
      isCancelled = true;
    };
  }, [authSession, sessionValidationStatus, setFirestoreMenuItems]);

  const firestoreRecipeMap = useMemo(() => (
    createRecipeMapFromFirestoreMenuItems(firestoreMenuItems)
  ), [firestoreMenuItems]);
  const effectiveRecipes = useMemo(() => ({
    ...recipes,
    ...firestoreRecipeMap,
  }), [recipes, firestoreRecipeMap]);
  const firestoreMenuItemCatalogRows = useMemo(() => (
    firestoreMenuItems.map((item) => {
      const key = item.key || createMenuItemKey(item.name);
      const recipe = effectiveRecipes[key];

      return {
        key,
        name: item.name,
        category: item.category || recipe?.category || '',
        menuPrice: item.menuPrice,
        totalCost: item.totalCost,
        ingredientCount: Array.isArray(recipe?.ingredients) ? recipe.ingredients.length : 0,
        firestoreId: item.firestoreId,
        archived: Boolean(item.archived || recipe?.archived),
        archivedAt: item.archivedAt || recipe?.archivedAt || '',
        archivedBy: item.archivedBy || recipe?.archivedBy || '',
      };
    })
  ), [effectiveRecipes, firestoreMenuItems]);
  const baseMenuItems = useMemo(() => {
    const mergedByKey = new Map();

    firestoreMenuItemCatalogRows.forEach((item) => {
      if (item.key) {
        mergedByKey.set(item.key, item);
      }
    });

    return [...mergedByKey.values()];
  }, [firestoreMenuItemCatalogRows]);
  const menuItems = useMemo(() => (
    mergeMenuItems(baseMenuItems, customMenuItems, effectiveRecipes)
  ), [baseMenuItems, customMenuItems, effectiveRecipes]);
  const refreshInvoiceDashboardStats = useCallback(async () => {
    if (!FIRESTORE_CONFIGURED) {
      setInvoiceDashboardStats(null);
      return;
    }

    try {
      setInvoiceDashboardStats(await loadInvoiceDashboardStats());
    } catch (error) {
      console.warn('Invoice dashboard stats unavailable.', error);
    }
  }, [setInvoiceDashboardStats]);
  const baseStaffList = useMemo(() => [], []);
  const staffList = useMemo(() => (
    mergeStaffMembers(baseStaffList, customStaffList)
  ), [baseStaffList, customStaffList]);
  useRestaurantPersistence({
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
    wasteItems,
  });
  const activeStaffMember = useMemo(() => (
    staffList.find((member) => member.id === activeStaffId)
    || createSessionStaffFallback(authSession)
  ), [activeStaffId, authSession, staffList]);
  const accessProfile = useMemo(() => getAccessProfile(activeStaffMember), [activeStaffMember]);
  const activeWasteItems = useMemo(() => getActiveWasteEntries(wasteItems), [wasteItems]);
  const activeManagerAccounts = useMemo(() => staffList.filter((member) => (
    !member.removed
    && (member.staffSection === 'management' || inferRoleKey(member.role) === 'manager' || inferRoleKey(member.role) === 'owner')
  )), [staffList]);
  const managerSetupRequired = FIRESTORE_CONFIGURED
    && restaurantProfile?.setupCompleted === true
    && directoryStatus === 'ready'
    && !staffDirectory.some((member) => ['owner', 'manager'].includes(inferRoleKey(member.roleKey || member.role)));
  const managerAuthIsConfigured = useMemo(() => (
    restaurantProfile?.setupCompleted === true
    || activeManagerAccounts.some((member) => sanitizePinRecord(member.managerPin))
    || authPinsAreConfigured(authSettings)
  ), [activeManagerAccounts, authSettings, restaurantProfile?.setupCompleted]);

  useEffect(() => {
    if (authSession && accessProfile.canViewFinancials && sessionValidationStatus === 'ready') {
      refreshInvoiceDashboardStats();
    }
  }, [accessProfile.canViewFinancials, authSession, refreshInvoiceDashboardStats, sessionValidationStatus]);

  const buildDatabaseData = useCallback(() => ({
    wasteItems,
    budget,
    recipes,
    staffList,
    customStaffList,
    customMenuItems,
    portionProfiles,
    itemPriceCatalog,
    settings,
    authSettings,
    inventoryMovements,
    auditLog,
  }), [wasteItems, budget, recipes, staffList, customStaffList, customMenuItems, portionProfiles, itemPriceCatalog, settings, authSettings, inventoryMovements, auditLog]);
  const latestDatabaseDataRef = useRef(null);

  useEffect(() => {
    latestDatabaseDataRef.current = buildDatabaseData();
  }, [buildDatabaseData]);

  const applyDatabaseData = useCallback((databaseData) => {
    if (databaseData.wasteItems !== undefined) {
      setWasteItems(Array.isArray(databaseData.wasteItems) ? databaseData.wasteItems : []);
    }
    if (databaseData.budget !== undefined) {
      setBudget(parseFloat(databaseData.budget) || 0);
    }
    if (databaseData.recipes !== undefined) {
      setRecipes(isRecipeMap(databaseData.recipes) ? cloneRecipeMap(databaseData.recipes) : {});
    }
    if (databaseData.customStaffList !== undefined || databaseData.staffList !== undefined) {
      setCustomStaffList(sanitizeStaffMembers(databaseData.customStaffList ?? databaseData.staffList));
    }
    if (databaseData.customMenuItems !== undefined) {
      setCustomMenuItems(sanitizeMenuItems(databaseData.customMenuItems));
    }
    if (databaseData.portionProfiles !== undefined) {
      setPortionProfiles(sanitizePortionProfiles(databaseData.portionProfiles));
    }
    if (databaseData.itemPriceCatalog !== undefined) {
      setItemPriceCatalog(sanitizeItemPriceCatalog(databaseData.itemPriceCatalog));
    }
    if (databaseData.settings !== undefined) {
      setSettings(sanitizeSettings(databaseData.settings));
    }
    if (databaseData.authSettings !== undefined) {
      setAuthSettings(sanitizeAuthSettings(databaseData.authSettings));
    }
    if (databaseData.inventoryMovements !== undefined) {
      setInventoryMovements(Array.isArray(databaseData.inventoryMovements) ? databaseData.inventoryMovements : []);
    }
    if (databaseData.auditLog !== undefined) {
      setAuditLog(Array.isArray(databaseData.auditLog) ? databaseData.auditLog : []);
    }
  }, [
    setAuditLog,
    setAuthSettings,
    setBudget,
    setCustomMenuItems,
    setCustomStaffList,
    setInventoryMovements,
    setItemPriceCatalog,
    setPortionProfiles,
    setRecipes,
    setSettings,
    setWasteItems,
  ]);

  const saveDatabaseToFirebase = useCallback(async () => {
    const permission = requirePermission(accessProfile, 'canManageServerSync', 'sync Firebase');

    if (!permission.ok) {
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: permission.message,
      }));
      return false;
    }

    if (!FIRESTORE_CONFIGURED) {
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: 'Firebase is not configured. Add the Firebase environment variables before using WasteShift.',
      }));
      return false;
    }

    setFirebaseSync(prev => ({
      ...prev,
      status: 'saving',
      message: 'Saving restaurant data to Firebase...',
    }));

    try {
      const payload = await saveFirestoreDatabaseSnapshot(buildDatabaseData());

      if (payload?.skipped) {
        throw new Error('Firebase is not configured for this build.');
      }

      setFirebaseAutoSaveEnabled(true);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'synced',
        message: payload?.unchanged
          ? 'Firebase is connected and all restaurant data is up to date.'
          : 'Restaurant data saved to Firebase.',
        lastSavedAt: payload.updatedAt || new Date().toISOString(),
      }));

      return true;
    } catch (error) {
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: error?.message || 'Firebase save failed.',
      }));

      return false;
    }
  }, [accessProfile, buildDatabaseData]);

  useEffect(() => {
    if (authSession) {
      setActiveStaffId(authSession.staffId || '');
      return;
    }

    clearPersistedAuthSession();
    setActiveStaffId('');
  }, [authSession, setActiveStaffId]);

  useEffect(() => {
    let isCancelled = false;

    const loadServerDatabase = async () => {
      if (FIRESTORE_CONFIGURED) {
        if (!authSession || sessionValidationStatus !== 'ready') {
          setManagerAccountsLoaded(true);
          setFirebaseAutoSaveEnabled(false);
          setFirebaseLoadComplete(false);
          return;
        }

        setFirebaseSync(prev => ({
          ...prev,
          status: 'checking',
          message: 'Loading primary database from Firebase...',
        }));

        try {
          const isManagementSession = ['owner', 'manager'].includes(String(authSession?.roleKey || '').toLowerCase());
          const [firebaseSnapshot, firebaseWastePage, firebaseManagers] = await Promise.all([
            isManagementSession
              ? loadFirestoreDatabaseSnapshot()
              : Promise.resolve({ ok: true, exists: false, data: null, updatedAt: '' }),
            loadInitialWasteHistoryPage(),
            isManagementSession ? loadManagerAccounts().catch(() => []) : Promise.resolve([]),
          ]);

          if (isCancelled) {
            return;
          }

          const snapshotData = firebaseSnapshot?.data || {};
          latestSharedSnapshotUpdatedAtRef.current = firebaseSnapshot?.updatedAt || '';
          const firebaseWasteItems = firebaseWastePage.entries;
          const hasSnapshot = Boolean(firebaseSnapshot?.exists);
          const hasWasteEntries = firebaseWasteItems.length > 0;
          const hasManagerAccounts = firebaseManagers.length > 0;
          const defaultDatabaseData = latestDatabaseDataRef.current || {};
          const mergedCustomStaffList = mergeManagerAccountsIntoStaffList(
            snapshotData.customStaffList ?? snapshotData.staffList ?? defaultDatabaseData.customStaffList ?? defaultDatabaseData.staffList ?? [],
            firebaseManagers,
          );
          const firebaseDatabaseData = {
            ...defaultDatabaseData,
            ...snapshotData,
            customStaffList: mergedCustomStaffList,
            wasteItems: hasWasteEntries
              ? firebaseWasteItems
              : Array.isArray(snapshotData.wasteItems)
                ? snapshotData.wasteItems
                : defaultDatabaseData.wasteItems,
          };

          setFirebaseAutoSaveEnabled(true);
          setFirebaseLoadComplete(true);
          setManagerAccountsLoaded(true);
          if (hasSnapshot || hasWasteEntries || hasManagerAccounts) {
            applyDatabaseData(firebaseDatabaseData);
            setFirebaseSync(prev => ({
              ...prev,
              status: 'ready',
              message: `Firebase is connected${hasWasteEntries ? ` with ${firebaseWasteItems.length} shared waste entr${firebaseWasteItems.length === 1 ? 'y' : 'ies'}` : ''}.`,
              lastSavedAt: firebaseSnapshot?.updatedAt || new Date().toISOString(),
            }));
            return;
          }

          setFirebaseSync(prev => ({
            ...prev,
            status: 'ready',
            message: 'Firebase is connected. New changes will save to Firebase.',
            lastSavedAt: '',
          }));
          return;
        } catch (error) {
          if (isCancelled) {
            return;
          }

          console.warn('Firebase primary database unavailable.', error);
          setManagerAccountsLoaded(true);
          setFirebaseAutoSaveEnabled(false);
          setFirebaseLoadComplete(false);
          setFirebaseSync(prev => ({
            ...prev,
            status: 'error',
            message: error?.message || 'Firebase database is unavailable.',
          }));
          return;
        }
      }

      setManagerAccountsLoaded(true);
      setFirebaseAutoSaveEnabled(false);
      setFirebaseLoadComplete(false);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: 'Firebase is not configured. WasteShift requires Firebase for restaurant data.',
      }));
    };

    loadServerDatabase();

    return () => {
      isCancelled = true;
    };
  }, [applyDatabaseData, authSession, loadInitialWasteHistoryPage, restaurantProfile.setupCompleted, sessionValidationStatus]);

  useEffect(() => {
    if (
      !FIRESTORE_CONFIGURED
      || !authSession
      || sessionValidationStatus !== 'ready'
      || !firebaseLoadComplete
      || !isOnline
      || typeof window === 'undefined'
    ) {
      return undefined;
    }

    let isCancelled = false;
    let refreshInFlight = false;
    const refreshRecentWasteEntries = async () => {
      if (refreshInFlight) {
        return;
      }

      refreshInFlight = true;
      try {
        const entries = await loadFirestoreWasteEntries({ pageSize: 250 });

        if (!isCancelled) {
          mergeWasteHistoryEntries(entries);
        }
      } catch (error) {
        console.warn('Could not refresh shared waste entries.', error);
      } finally {
        refreshInFlight = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshRecentWasteEntries();
      }
    };
    const intervalId = window.setInterval(refreshRecentWasteEntries, 45 * 1000);

    window.addEventListener('focus', refreshRecentWasteEntries);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshRecentWasteEntries);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [authSession, firebaseLoadComplete, isOnline, mergeWasteHistoryEntries, sessionValidationStatus]);

  useEffect(() => {
    if (
      !FIRESTORE_CONFIGURED
      || !authSession
      || sessionValidationStatus !== 'ready'
      || !firebaseLoadComplete
      || !isOnline
      || typeof window === 'undefined'
    ) {
      return undefined;
    }

    let isCancelled = false;
    let refreshInFlight = false;
    const refreshSharedWorkspace = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;

      try {
        const isManagementSession = ['owner', 'manager'].includes(String(authSession.roleKey || '').toLowerCase());
        const [snapshot, sharedMenuItems] = await Promise.all([
          isManagementSession
            ? loadFirestoreDatabaseSnapshot()
            : Promise.resolve({ ok: true, exists: false, data: null, updatedAt: '' }),
          loadFirestoreMenuItems(),
        ]);

        if (isCancelled) return;
        setFirestoreMenuItems(sharedMenuItems);

        if (
          snapshot?.exists
          && snapshot.updatedAt
          && snapshot.updatedAt !== latestSharedSnapshotUpdatedAtRef.current
        ) {
          const currentData = latestDatabaseDataRef.current || {};
          applyDatabaseData({
            ...currentData,
            ...snapshot.data,
            wasteItems: currentData.wasteItems,
          });
          latestSharedSnapshotUpdatedAtRef.current = snapshot.updatedAt;
          setFirebaseSync((current) => ({
            ...current,
            status: 'ready',
            message: 'Shared restaurant changes refreshed from Firebase.',
            lastSavedAt: snapshot.updatedAt,
          }));
        }
      } catch (error) {
        console.warn('Could not refresh shared restaurant data.', error);
      } finally {
        refreshInFlight = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshSharedWorkspace();
      }
    };
    const intervalId = window.setInterval(refreshSharedWorkspace, 45 * 1000);

    window.addEventListener('focus', refreshSharedWorkspace);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshSharedWorkspace);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [
    applyDatabaseData,
    authSession,
    isOnline,
    firebaseLoadComplete,
    sessionValidationStatus,
    setFirebaseSync,
    setFirestoreMenuItems,
  ]);

  useEffect(() => {
    if (!firebaseAutoSaveEnabled || !firebaseLoadComplete) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      saveDatabaseToFirebase();
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [wasteItems, budget, recipes, customStaffList, customMenuItems, portionProfiles, itemPriceCatalog, settings, authSettings, inventoryMovements, auditLog, firebaseAutoSaveEnabled, firebaseLoadComplete, saveDatabaseToFirebase]);

  const {
    handleAddStaff,
    handleDeleteStaff,
    handleInitialManagerSetup,
    handleLogin,
    handleLogout,
    handlePrepareSetupManagerAccess,
    handleBootstrapManagerAccess,
    handleResetStaffCode,
    handleSavePinSettings,
  } = useStaffAccess({
    accessProfile,
    activeStaffId,
    activeStaffMember,
    authSession,
    authSettings,
    baseStaffList,
    restaurantName: restaurantProfile.restaurantName,
    setActiveStaffId,
    setActiveTab,
    setAuditLog,
    setAuthSession,
    setAuthSettings,
    setCustomStaffList,
    setIsPreparingAuth,
    staffList,
  });

  const {
    handleAddEntry,
    handleClearAll,
    handleDeleteEntry,
    handleRestoreEntry,
    handleRetryWasteEntrySync,
    handleSavePortionProfile,
  } = useWasteEntries({
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
  });

  const {
    handleCreateCatalogItems,
    handleDeleteItemPrice,
    handleInvoiceIngredientDeleted,
    handleInvoicePricesUpdated,
    handleSaveItemPrice,
  } = useInvoicePricing({
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
  });

  const handleSaveSettings = ({ budget: nextBudget, dailyWasteValueLimit, dailyWasteEntryLimit }) => {
    const permission = requirePermission(accessProfile, 'canManageLimits', 'change waste limits');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    const previousSettings = { budget, ...settings };

    setBudget(parseFloat(nextBudget) || 0);
    setSettings(sanitizeSettings({
      dailyWasteValueLimit,
      dailyWasteEntryLimit,
    }));
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Settings changed',
        user: activeStaffId ? staffList.find((member) => member.id === activeStaffId)?.name : 'System',
        relatedItem: 'Waste guardrails',
        beforeValue: previousSettings,
        afterValue: {
          budget: parseFloat(nextBudget) || 0,
          dailyWasteValueLimit,
          dailyWasteEntryLimit,
        },
      }),
      ...prevLog,
    ].slice(0, 500));
  };

  const {
    handleAddNewRecipe,
    handleClearRecipes,
    handleDeleteCustomMenuItem,
    handleRestoreMenuItem,
    handleUpsertMenuItem,
    saveApprovedMenuItems,
  } = useMenuRecipes({
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
  });

  const handleFinishSetup = useCallback(async (setupProgress) => {
    const restaurantName = String(setupProgress?.restaurantName || '').trim();
    const managerName = String(setupProgress?.managerName || '').trim();
    const managerPin = String(setupProgress?.managerPin || '').trim();

    if (!restaurantName) {
      return { ok: false, message: 'Enter the restaurant name.' };
    }

    if (!managerName || !managerPin) {
      return { ok: false, message: 'Manager setup is required.' };
    }

    try {
    const managerPinRecord = await createPinRecord(managerPin);

    const managerMember = {
      id: createStaffMemberId(managerName),
      name: managerName,
      role: 'Manager',
      staffSection: 'management',
      managerPin: managerPinRecord,
      removed: false,
      removedAt: '',
      isCsvSeed: false,
    };
    await saveManagerAccount(managerMember).catch((error) => {
      console.warn('Could not save setup manager account to Firestore.', error);
    });
    await saveCurrentUserStaffProfile({
      displayName: managerMember.name,
      role: managerMember.role,
      roleKey: 'manager',
      staffId: managerMember.id,
    }).catch((error) => {
      console.warn('Could not save setup manager Firebase access profile.', error);
    });
    const managerSessionResult = await establishManagerSession({
      managerId: managerMember.id,
      pin: managerPin,
    });

    if (!managerSessionResult.ok) {
      return { ok: false, message: managerSessionResult.message };
    }
    const setupStaffMembers = await Promise.all(
      (Array.isArray(setupProgress?.staffMembers) ? setupProgress.staffMembers : [])
        .filter((member) => String(member?.name || '').trim())
        .map(async (member) => ({
            id: createStaffMemberId(member.name),
            name: String(member.name || '').trim(),
            role: String(member.role || 'Team').trim(),
            staffSection: member.staffSection === 'management'
              ? 'kitchen'
              : member.staffSection || inferStaffSection(member.role),
            staffCode: await createPinRecord(member.code),
            removed: member.active === false,
            removedAt: member.active === false ? new Date().toISOString() : '',
            isCsvSeed: false,
        }))
    );
    const setupStaffSaveResults = await Promise.all(setupStaffMembers.map((member) => (
      saveStaffAccessAccount({ ...member, roleKey: inferRoleKey(member.role) })
    )));
    const failedStaffSave = setupStaffSaveResults.find((result) => !result.ok);
    if (failedStaffSave) {
      return { ok: false, message: failedStaffSave.message };
    }

    setCustomStaffList([managerMember, ...setupStaffMembers]);
    setBudget(parseFloat(setupProgress?.budget) || 0);
    setSettings(sanitizeSettings({
      dailyWasteValueLimit: setupProgress?.dailyWasteValueLimit,
      dailyWasteEntryLimit: setupProgress?.dailyWasteEntryLimit,
    }));

    if (Array.isArray(setupProgress?.menuItems) && setupProgress.menuItems.length > 0) {
      await saveApprovedMenuItems({
        skipPermission: true,
        items: setupProgress.menuItems.map((item) => ({
          ...item,
          sellingPrice: item.sellingPrice ?? item.menuPrice,
        })),
      });
    }

    const profileResult = await saveRestaurantProfile({
      restaurantName,
      branchName: setupProgress?.branchName,
      currency: 'ZAR',
      timezone: 'Africa/Johannesburg',
    }, { completeSetup: true });

    if (!profileResult?.ok) {
      return { ok: false, message: 'Could not save restaurant profile to Firebase.' };
    }

    const nextSession = {
      mode: 'management',
      staffId: managerMember.id,
      staffName: managerMember.name,
      roleKey: inferRoleKey(managerMember.role),
      startedAt: new Date().toISOString(),
      databaseId: getClientDatabaseId(),
    };

    setRestaurantProfile(profileResult.profile);
    setRestaurantProfileStatus('ready');
    setAuthSession(nextSession);
    setActiveStaffId(managerMember.id);
    setActiveTab('dashboard');
    setAuditLog(prevLog => [
      createAuditLogEntry({
        action: 'Setup completed',
        user: managerMember.name,
        relatedItem: restaurantName,
        afterValue: {
          staffCreated: setupStaffMembers.length,
          menuItemsCreated: setupProgress?.menuItems?.length || 0,
          setupCompleted: true,
        },
      }),
      ...prevLog,
    ].slice(0, 500));

    return { ok: true, message: 'Setup complete.' };
    } catch (error) {
      const message = String(error?.message || '');
      const isPermissionError = error?.code === 'permission-denied'
        || message.toLowerCase().includes('missing or insufficient permissions');

      return {
        ok: false,
        message: isPermissionError
          ? 'Firestore rules are blocking setup. Deploy the updated firestore.rules file, then try Finish setup again.'
          : message || 'Could not finish setup.',
      };
    }
  }, [
    saveApprovedMenuItems,
    setActiveStaffId,
    setAuditLog,
    setBudget,
    setCustomStaffList,
    setSettings,
  ]);


  const handleResetRestaurantData = async (confirmationPhrase) => {
    const permission = requirePermission(accessProfile, 'canClearData', 'reset restaurant data');

    if (!permission.ok) {
      return { ok: false, message: permission.message };
    }

    if (!validateRestaurantResetConfirmation(confirmationPhrase)) {
      return { ok: false, message: 'Type RESET to confirm.' };
    }

    try {
      if (FIRESTORE_CONFIGURED) {
        await resetRestaurantFirestoreData();
      }

      const emptyData = createEmptyRestaurantData();
      setWasteItems(emptyData.wasteItems);
      setRecipes(emptyData.recipes);
      setCustomStaffList(emptyData.customStaffList);
      setCustomMenuItems(emptyData.customMenuItems);
      setPortionProfiles(emptyData.portionProfiles);
      setItemPriceCatalog(emptyData.itemPriceCatalog);
      setInventoryMovements(emptyData.inventoryMovements);
      setAuditLog(emptyData.auditLog);
      setFirestoreMenuItems([]);
      setAuthSettings(DEFAULT_AUTH_SETTINGS);
      setAuthSession(null);
      setActiveStaffId('');
      setBudget(0);
      setSettings(DEFAULT_SETTINGS);
      setRestaurantProfile(createDefaultRestaurantProfile());
      setRestaurantProfileStatus(FIRESTORE_CONFIGURED ? 'ready' : 'missing-config');
      setActiveTab('dashboard');
      setFirebaseSync(prev => ({
        ...prev,
        status: FIRESTORE_CONFIGURED ? 'synced' : 'error',
        message: FIRESTORE_CONFIGURED
          ? 'Restaurant data reset. Complete setup again.'
          : 'Restaurant reset could not complete because Firebase is not configured.',
        lastSavedAt: new Date().toISOString(),
        menuItemCount: 0,
      }));

      return { ok: true, message: 'Restaurant data reset. Setup will start again.' };
    } catch (error) {
      return { ok: false, message: error?.message || 'Could not reset restaurant data.' };
    }
  };

  const handleRestoreDatabase = async (databaseData) => {
    const permission = requirePermission(accessProfile, 'canRestoreDatabase', 'restore a database backup');
    if (!permission.ok) {
      alert(permission.message);
      return { ok: false, message: permission.message };
    }

    if (!FIRESTORE_CONFIGURED) {
      return { ok: false, message: 'Firebase is required before configuration can be restored.' };
    }

    try {
      const restorableFields = [
        'budget',
        'settings',
        'recipes',
        'customMenuItems',
        'itemPriceCatalog',
        'portionProfiles',
      ];
      const restorableData = Object.fromEntries(restorableFields
        .filter((field) => databaseData?.[field] !== undefined)
        .map((field) => [field, databaseData[field]]));
      const mergedData = {
        ...buildDatabaseData(),
        ...restorableData,
      };
      const result = await saveFirestoreDatabaseSnapshot(mergedData);
      if (result?.skipped || result?.ok === false) {
        return { ok: false, message: 'Firebase did not restore this configuration.' };
      }

      applyDatabaseData(restorableData);
      setFirebaseSync(prev => ({
        ...prev,
        status: 'synced',
        message: 'Restaurant configuration restored to Firebase.',
        lastSavedAt: result.updatedAt || new Date().toISOString(),
      }));
      return { ok: true, message: 'Restaurant configuration restored.' };
    } catch (error) {
      setFirebaseSync(prev => ({
        ...prev,
        status: 'error',
        message: error?.message || 'Could not restore restaurant configuration.',
      }));
      return { ok: false, message: error?.message || 'Could not restore restaurant configuration.' };
    }
  };

  const authDataIsLoading = FIRESTORE_CONFIGURED
    && restaurantProfile.setupCompleted
    && (sessionValidationStatus === 'checking' || !managerAccountsLoaded);
  const appIsLocked = !authSession || !managerAuthIsConfigured;

  if (restaurantProfileStatus === 'loading') {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <div className="brand auth-brand">
            <span className="brand-mark">WS</span>
            <div>
              <h1 className="brand-name">WasteShift</h1>
              <p className="brand-subtitle">Loading restaurant profile</p>
            </div>
          </div>
          <div className="muted-box" style={{ marginBottom: 0 }}>Checking setup status.</div>
        </section>
      </main>
    );
  }

  if (!restaurantProfile.setupCompleted) {
    return (
      <Suspense fallback={(
        <main className="auth-screen">
          <section className="auth-panel">
            <div className="muted-box" style={{ marginBottom: 0 }}>Loading setup...</div>
          </section>
        </main>
      )}>
        <SetupWizard
          firestoreConfigured={FIRESTORE_CONFIGURED}
          firebaseSync={firebaseSync}
          onPrepareManagerAccess={handlePrepareSetupManagerAccess}
          onFinishSetup={handleFinishSetup}
        />
      </Suspense>
    );
  }

  if (authDataIsLoading) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <div className="brand auth-brand">
            <span className="brand-mark">WS</span>
            <div>
              <h1 className="brand-name">WasteShift</h1>
              <p className="brand-subtitle">Loading access</p>
            </div>
          </div>
          <div className="muted-box" style={{ marginBottom: 0 }}>Loading manager and staff access from Firebase.</div>
        </section>
      </main>
    );
  }

  if (appIsLocked) {
    return (
      <AuthGate
        isPreparingAuth={isPreparingAuth}
        authIsConfigured={managerAuthIsConfigured}
        staffList={staffList}
        managerSetupRequired={managerSetupRequired}
        onLogin={handleLogin}
        onInitialManagerSetup={handleInitialManagerSetup}
        onBootstrapManagerAccess={handleBootstrapManagerAccess}
      />
    );
  }

  return (
    <Suspense fallback={<PageFallback label="Loading workspace" />}>
      <AppWorkspace
        access={{
          accessProfile,
          activeStaffId,
          activeStaffMember,
          authSession,
          onActiveStaffChange: setActiveStaffId,
          onLogout: handleLogout,
        }}
        data={{
          activeWasteItems,
          auditLog,
          authSettings,
          budget,
          customMenuItems,
          customStaffList,
          effectiveRecipes,
          inventoryMovements,
          invoiceDashboardStats,
          itemPriceCatalog,
          lastSavedAt,
          menuItems,
          portionProfiles,
          settings,
          staffList,
          wasteItems,
        }}
        inventoryActions={{
          onIngredientDeleted: handleInvoiceIngredientDeleted,
          onInvoicePricesUpdated: handleInvoicePricesUpdated,
          onInvoiceSaved: refreshInvoiceDashboardStats,
        }}
        menuActions={{
          onAddRecipe: handleAddNewRecipe,
          onClearRecipes: handleClearRecipes,
          onCreateCatalogItem: handleSaveItemPrice,
          onCreateCatalogItems: handleCreateCatalogItems,
          onDeleteItemPrice: handleDeleteItemPrice,
          onImportMenuItems: saveApprovedMenuItems,
          onRemoveCustomMenuItem: handleDeleteCustomMenuItem,
          onRestoreMenuItem: handleRestoreMenuItem,
          onSaveMenuItem: handleUpsertMenuItem,
        }}
        navigation={{
          activeTab,
          menuPricingView,
          onMenuPricingViewChange: setMenuPricingView,
          onNavigate: setActiveTab,
        }}
        pagination={{
          hasOlderEntries: hasOlderWasteEntries,
          isLoadingOlderEntries: isLoadingOlderWasteEntries,
          onLoadOlderEntries: handleLoadOlderWasteEntries,
        }}
        settingsActions={{
          onAddStaff: handleAddStaff,
          onDeleteStaff: handleDeleteStaff,
          onResetRestaurantData: handleResetRestaurantData,
          onResetStaffCode: handleResetStaffCode,
          onRestoreDatabase: handleRestoreDatabase,
          onSavePinSettings: handleSavePinSettings,
          onSaveSettings: handleSaveSettings,
          onSaveToFirebase: saveDatabaseToFirebase,
        }}
        sync={{
          firebaseSync,
          isOnline,
        }}
        wasteActions={{
          onAddEntry: handleAddEntry,
          onClearAllWaste: handleClearAll,
          onDeleteEntry: handleDeleteEntry,
          onRestoreEntry: handleRestoreEntry,
          onRetryEntrySync: handleRetryWasteEntrySync,
          onSavePortionProfile: handleSavePortionProfile,
        }}
      />
    </Suspense>
  );
}

export default App;
