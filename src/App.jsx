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
  loadCachedRestaurantProfile,
  loadRestaurantProfile,
  resetRestaurantFirestoreData,
  saveRestaurantProfile,
} from './services/restaurantFirestore';
import { saveCurrentUserStaffProfile } from './services/firebaseAccess';
import { loadManagerAccounts, saveManagerAccount } from './services/managerAccounts';
import { establishManagerSession } from './services/managerSession';
import { saveStaffAccessAccount } from './services/staffSession';
import { useRestaurantAccess } from './hooks/useRestaurantAccess';
import { useRestaurantData } from './hooks/useRestaurantData';
import { useRestaurantPersistence } from './hooks/useRestaurantPersistence';
import { useInvoicePricing } from './hooks/useInvoicePricing';
import { useMenuRecipes } from './hooks/useMenuRecipes';
import { useStoreRoom } from './hooks/useStoreRoom';
import { useStaffAccess } from './hooks/useStaffAccess';
import { useWasteEntries } from './hooks/useWasteEntries';
import { useWasteHistoryPagination } from './hooks/useWasteHistoryPagination';
import {
  createEmptyRestaurantData,
  getRestaurantResetStorageKeys,
  validateRestaurantResetConfirmation,
} from './utils/restaurantReset';
import { getActiveWasteEntries } from './utils/wasteSync';
import { getClientDatabaseHeaders, getClientDatabaseId } from './utils/clientDatabaseId';
import {
  clearPersistedAuthSession,
  loadPersistedAuthSession,
  savePersistedAuthSession,
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
  markServerStaffFreshStartComplete,
  markStaffFreshStartComplete,
  mergeManagerAccountsIntoStaffList,
  mergeMenuItems,
  mergeStaffMembers,
  sanitizeMenuItems,
  sanitizePortionProfiles,
  sanitizeSettings,
  sanitizeStaffMembers,
  sanitizeStoreRoomItems,
  sanitizeStoreRoomMovements,
  staffFreshStartIsPending,
} from './utils/appData';
import {
  FIRESTORE_CONFIGURED,
  FIRESTORE_RUNTIME_INFO,
  SERVER_DATABASE_ENDPOINT,
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
  const [inventoryView, setInventoryView] = useState('invoices');
  const [menuPricingView, setMenuPricingView] = useState('recipes');
  const [serverSyncEnabled, setServerSyncEnabled] = useState(false);
  const [serverLoadComplete, setServerLoadComplete] = useState(false);
  const [managerAccountsLoaded, setManagerAccountsLoaded] = useState(!FIRESTORE_CONFIGURED);
  const [serverSync, setServerSync] = useState({
    status: FIRESTORE_CONFIGURED ? 'ready' : 'checking',
    message: FIRESTORE_CONFIGURED
      ? 'Firebase is the primary database. Local browser storage is only a fallback.'
      : 'Checking for Vercel backup database...',
    lastSavedAt: '',
  });
  const [firebaseSync, setFirebaseSync] = useState({
    status: FIRESTORE_CONFIGURED ? 'checking' : 'local',
    message: FIRESTORE_CONFIGURED
      ? `Connecting to Firebase${FIRESTORE_RUNTIME_INFO.projectId ? ` project ${FIRESTORE_RUNTIME_INFO.projectId}` : ''}...`
      : 'Firebase env vars are not configured. Live records stay in this browser.',
    lastSavedAt: '',
    menuItemCount: 0,
    projectId: FIRESTORE_RUNTIME_INFO.projectId,
  });
  const [restaurantProfile, setRestaurantProfile] = useState(loadCachedRestaurantProfile);
  const [restaurantProfileStatus, setRestaurantProfileStatus] = useState(FIRESTORE_CONFIGURED ? 'loading' : 'missing-config');
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ));
  const [syncAccessKey, setSyncAccessKey] = useState(() => {
    localStorage.removeItem('wasteShiftSyncAccessKey');
    return '';
  });
  const [authSession, setAuthSession] = useState(() => {
    try {
      if (staffFreshStartIsPending()) {
        clearPersistedAuthSession();
        return null;
      }

      return loadPersistedAuthSession(getClientDatabaseId());
    } catch {
      return null;
    }
  });
  const [isPreparingAuth, setIsPreparingAuth] = useState(false);

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
    setStoreRoomItems,
    setStoreRoomMovements,
    setWasteItems,
    settings,
    storeRoomItems,
    storeRoomMovements,
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
    sessionValidationStatus,
    staffDirectory,
  } = useRestaurantAccess({
    firebaseConfigured: FIRESTORE_CONFIGURED,
    restaurantReady: restaurantProfile.setupCompleted,
    authSession,
    onSessionRejected: handleSessionRejected,
  });

  useEffect(() => {
    if (!staffFreshStartIsPending()) {
      return;
    }

    localStorage.removeItem('customStaffList');
    localStorage.removeItem('staffList');
    localStorage.removeItem('activeStaffId');
    clearPersistedAuthSession();
    setCustomStaffList([]);
    setActiveStaffId('');
    setAuthSession(null);
    markStaffFreshStartComplete();
  }, [setActiveStaffId, setCustomStaffList]);

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
        setRestaurantProfile(loadCachedRestaurantProfile());
        setRestaurantProfileStatus('missing-config');
        return;
      }

      setRestaurantProfileStatus('loading');

      try {
        const result = await loadRestaurantProfile();

        if (!isCancelled) {
          if (result.didAdoptSingleShop) {
            // Restart the initial data loaders after a fresh device has joined the one shop.
            window.location.reload();
            return;
          }

          setRestaurantProfile(result.profile || createDefaultRestaurantProfile());
          setRestaurantProfileStatus('ready');
        }
      } catch (error) {
        console.warn('Restaurant profile unavailable.', error);

        if (!isCancelled) {
          const cachedProfile = loadCachedRestaurantProfile();
          setRestaurantProfile(cachedProfile);
          setRestaurantProfileStatus(cachedProfile.setupCompleted ? 'offline' : 'error');
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
          status: 'local',
          message: 'Firebase env vars are not configured. Live records stay in this browser.',
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
        console.warn('Firestore menu items unavailable. Using local menu data.', error);
        if (!isCancelled) {
          setFirebaseSync(prev => ({
            ...prev,
            status: 'error',
            message: `${error?.message || 'Firebase is unavailable.'} Local menu data is still available.`,
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
    storeRoomItems,
    storeRoomMovements,
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
  const managerRecoveryRequired = FIRESTORE_CONFIGURED
    && restaurantProfile?.setupCompleted === true
    && directoryLoaded
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

  const getSyncHeaders = useCallback((extraHeaders = {}) => {
    const trimmedAccessKey = syncAccessKey.trim();

    return getClientDatabaseHeaders({
      ...extraHeaders,
      ...(trimmedAccessKey ? { 'x-wasteshift-sync-secret': trimmedAccessKey } : {}),
    });
  }, [syncAccessKey]);

  const buildDatabaseData = useCallback(() => ({
    wasteItems,
    budget,
    recipes,
    staffList,
    customStaffList,
    customMenuItems,
    portionProfiles,
    itemPriceCatalog,
    storeRoomItems,
    storeRoomMovements,
    settings,
    authSettings,
    activeStaffId,
    inventoryMovements,
    auditLog,
  }), [wasteItems, budget, recipes, staffList, customStaffList, customMenuItems, portionProfiles, itemPriceCatalog, storeRoomItems, storeRoomMovements, settings, authSettings, activeStaffId, inventoryMovements, auditLog]);
  const latestDatabaseDataRef = useRef(null);

  useEffect(() => {
    latestDatabaseDataRef.current = buildDatabaseData();
  }, [buildDatabaseData]);

  const applyDatabaseData = useCallback((databaseData) => {
    setWasteItems(Array.isArray(databaseData.wasteItems) ? databaseData.wasteItems : []);
    setBudget(parseFloat(databaseData.budget) || 0);
    setRecipes(isRecipeMap(databaseData.recipes) ? cloneRecipeMap(databaseData.recipes) : {});
    setCustomStaffList(sanitizeStaffMembers(databaseData.customStaffList ?? databaseData.staffList));
    setCustomMenuItems(sanitizeMenuItems(databaseData.customMenuItems));
    setPortionProfiles(sanitizePortionProfiles(databaseData.portionProfiles));
    setItemPriceCatalog(sanitizeItemPriceCatalog(databaseData.itemPriceCatalog));
    setStoreRoomItems(sanitizeStoreRoomItems(databaseData.storeRoomItems));
    setStoreRoomMovements(sanitizeStoreRoomMovements(databaseData.storeRoomMovements));
    setSettings(sanitizeSettings(databaseData.settings));
    if (databaseData.authSettings !== undefined) {
      setAuthSettings(sanitizeAuthSettings(databaseData.authSettings));
    }
    setActiveStaffId(String(databaseData.activeStaffId || ''));
    setInventoryMovements(Array.isArray(databaseData.inventoryMovements) ? databaseData.inventoryMovements : []);
    setAuditLog(Array.isArray(databaseData.auditLog) ? databaseData.auditLog : []);
  }, [
    setActiveStaffId,
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
    setStoreRoomItems,
    setStoreRoomMovements,
    setWasteItems,
  ]);

  const saveDatabaseToServer = useCallback(async (mode = 'manual') => {
    const permission = requirePermission(accessProfile, 'canManageServerSync', 'sync the server database');

    if (!permission.ok) {
      setServerSync(prev => ({
        ...prev,
        status: 'locked',
        message: permission.message,
      }));
      return false;
    }

    setServerSync(prev => ({
      ...prev,
      status: 'saving',
      message: FIRESTORE_CONFIGURED
        ? 'Saving database to Firebase...'
        : mode === 'manual' ? 'Saving database to server...' : 'Auto-saving database to server...',
    }));

    try {
      if (FIRESTORE_CONFIGURED) {
        const payload = await saveFirestoreDatabaseSnapshot(buildDatabaseData());

        if (payload?.skipped) {
          throw new Error('Firebase is not configured for this build.');
        }

        setServerSyncEnabled(true);
        setServerSync({
          status: 'synced',
          message: 'Firebase database synced.',
          lastSavedAt: payload.updatedAt || new Date().toISOString(),
        });
        setFirebaseSync(prev => ({
          ...prev,
          status: 'synced',
          message: 'Firebase is the primary database and is up to date.',
          lastSavedAt: payload.updatedAt || new Date().toISOString(),
        }));

        return true;
      }

      const response = await fetch(SERVER_DATABASE_ENDPOINT, {
        method: 'POST',
        headers: getSyncHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ data: buildDatabaseData() }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || 'Server save failed.');
      }

      if (!FIRESTORE_CONFIGURED) {
        setServerSyncEnabled(true);
      }

      setServerSync({
        status: 'synced',
        message: 'Server database synced.',
        lastSavedAt: payload.updatedAt || new Date().toISOString(),
      });

      return true;
    } catch (error) {
      setServerSync({
        status: 'error',
        message: `${error?.message || (FIRESTORE_CONFIGURED ? 'Firebase save failed.' : 'Server save failed.')} Local browser copy is still saved.`,
        lastSavedAt: '',
      });

      return false;
    }
  }, [accessProfile, buildDatabaseData, getSyncHeaders]);

  useEffect(() => {
    if (authSession) {
      savePersistedAuthSession(authSession, getClientDatabaseId());
      return;
    }

    clearPersistedAuthSession();
  }, [authSession]);

  useEffect(() => {
    let isCancelled = false;

    const loadServerDatabase = async () => {
      if (FIRESTORE_CONFIGURED) {
        if (!authSession || sessionValidationStatus !== 'ready') {
          setManagerAccountsLoaded(true);
          setServerSyncEnabled(false);
          setServerLoadComplete(false);
          return;
        }

        setServerSync(prev => ({
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
          const firebaseWasteItems = firebaseWastePage.entries;
          const hasSnapshot = Boolean(firebaseSnapshot?.exists);
          const hasWasteEntries = firebaseWasteItems.length > 0;
          const hasManagerAccounts = firebaseManagers.length > 0;
          const localFallbackData = latestDatabaseDataRef.current || {};
          const mergedCustomStaffList = mergeManagerAccountsIntoStaffList(
            snapshotData.customStaffList ?? snapshotData.staffList ?? localFallbackData.customStaffList ?? localFallbackData.staffList ?? [],
            firebaseManagers,
          );
          const firebaseDatabaseData = {
            ...localFallbackData,
            ...snapshotData,
            customStaffList: mergedCustomStaffList,
            wasteItems: hasWasteEntries
              ? firebaseWasteItems
              : Array.isArray(snapshotData.wasteItems)
                ? snapshotData.wasteItems
                : localFallbackData.wasteItems,
          };

          setServerSyncEnabled(true);
          setServerLoadComplete(true);
          setManagerAccountsLoaded(true);
          if (hasSnapshot || hasWasteEntries || hasManagerAccounts) {
            applyDatabaseData(firebaseDatabaseData);
            setServerSync({
              status: 'synced',
              message: `Loaded primary database from Firebase${hasWasteEntries ? ` with ${firebaseWasteItems.length} waste entr${firebaseWasteItems.length === 1 ? 'y' : 'ies'}` : ''}.`,
              lastSavedAt: firebaseSnapshot?.updatedAt || '',
            });
            setFirebaseSync(prev => ({
              ...prev,
              status: 'ready',
              message: 'Firebase is connected and serving the app database.',
              lastSavedAt: firebaseSnapshot?.updatedAt || new Date().toISOString(),
            }));
            return;
          }

          setServerSync({
            status: 'ready',
            message: 'Firebase database is ready. No shared app data has been saved yet.',
            lastSavedAt: '',
          });
          setFirebaseSync(prev => ({
            ...prev,
            status: 'ready',
            message: 'Firebase is connected. Current local data will sync to Firebase on the next save.',
            lastSavedAt: '',
          }));
          return;
        } catch (error) {
          if (isCancelled) {
            return;
          }

          console.warn('Firebase primary database unavailable. Using local fallback.', error);
          setManagerAccountsLoaded(true);
          setServerSyncEnabled(false);
          setServerLoadComplete(false);
          setServerSync({
            status: 'error',
            message: `${error?.message || 'Firebase database is unavailable.'} Local browser data is still available.`,
            lastSavedAt: '',
          });
          setFirebaseSync(prev => ({
            ...prev,
            status: 'error',
            message: `${error?.message || 'Firebase database is unavailable.'} Local browser data is still available.`,
          }));
          return;
        }
      }

      try {
        const response = await fetch(SERVER_DATABASE_ENDPOINT, {
          cache: 'no-store',
          headers: getSyncHeaders(),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error(payload.message || 'Server sync is protected. Add the server sync access key in Settings.');
          }

          throw new Error(payload.message || 'Server database route is not available.');
        }

        if (payload?.ok === false) {
          throw new Error(payload.message || 'Server database is not configured.');
        }

        if (isCancelled) {
          return;
        }

        setServerSyncEnabled(true);
        setServerLoadComplete(true);

        if (payload?.snapshot?.data) {
          markServerStaffFreshStartComplete();
          applyDatabaseData(payload.snapshot.data);
          setServerSync({
            status: 'synced',
            message: 'Loaded database from server.',
            lastSavedAt: payload.snapshot.updatedAt || payload.snapshot.exportedAt || '',
          });
          return;
        }

        setServerSync({
          status: 'ready',
          message: 'Server database is ready. No server data has been saved yet.',
          lastSavedAt: '',
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setServerSyncEnabled(false);
        setServerLoadComplete(false);
        const message = error?.message || 'Using browser storage. Deploy to Vercel with Blob storage to enable server sync.';
        setServerSync({
          status: /protected|access key|unauthorized|forbidden/i.test(message) ? 'locked' : 'local',
          message,
          lastSavedAt: '',
        });
      }
    };

    loadServerDatabase();

    return () => {
      isCancelled = true;
    };
  }, [applyDatabaseData, authSession, getSyncHeaders, loadInitialWasteHistoryPage, restaurantProfile.setupCompleted, sessionValidationStatus]);

  useEffect(() => {
    if (
      !FIRESTORE_CONFIGURED
      || !authSession
      || sessionValidationStatus !== 'ready'
      || !serverLoadComplete
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
  }, [authSession, isOnline, mergeWasteHistoryEntries, serverLoadComplete, sessionValidationStatus]);

  useEffect(() => {
    if (!serverSyncEnabled || !serverLoadComplete) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      saveDatabaseToServer('auto');
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [wasteItems, budget, recipes, customStaffList, customMenuItems, portionProfiles, itemPriceCatalog, storeRoomItems, storeRoomMovements, settings, authSettings, activeStaffId, inventoryMovements, auditLog, serverSyncEnabled, serverLoadComplete, saveDatabaseToServer]);

  const {
    handleAddStaff,
    handleDeleteStaff,
    handleInitialManagerSetup,
    handleLogin,
    handleLogout,
    handlePrepareSetupManagerAccess,
    handleRecoverManagerAccess,
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
    setSyncAccessKey,
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

  const {
    handleDeleteStoreRoomItem,
    handleRecordStoreRoomMovement,
    handleSaveStoreRoomItem,
  } = useStoreRoom({
    accessProfile,
    activeStaffMember,
    itemPriceCatalog,
    setAuditLog,
    setStoreRoomItems,
    setStoreRoomMovements,
    storeRoomItems,
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

      getRestaurantResetStorageKeys().forEach((key) => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });

      const emptyData = createEmptyRestaurantData();
      setWasteItems(emptyData.wasteItems);
      setRecipes(emptyData.recipes);
      setCustomStaffList(emptyData.customStaffList);
      setCustomMenuItems(emptyData.customMenuItems);
      setPortionProfiles(emptyData.portionProfiles);
      setItemPriceCatalog(emptyData.itemPriceCatalog);
      setStoreRoomItems(emptyData.storeRoomItems);
      setStoreRoomMovements(emptyData.storeRoomMovements);
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
        status: FIRESTORE_CONFIGURED ? 'synced' : 'local',
        message: FIRESTORE_CONFIGURED
          ? 'Restaurant data reset. Complete setup again.'
          : 'Local restaurant data reset. Configure Firebase before setup can finish.',
        lastSavedAt: new Date().toISOString(),
        menuItemCount: 0,
      }));

      return { ok: true, message: 'Restaurant data reset. Setup will start again.' };
    } catch (error) {
      return { ok: false, message: error?.message || 'Could not reset restaurant data.' };
    }
  };

  const handleRestoreDatabase = (databaseData) => {
    const permission = requirePermission(accessProfile, 'canRestoreDatabase', 'restore a database backup');
    if (!permission.ok) {
      alert(permission.message);
      return;
    }

    applyDatabaseData(databaseData);
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
        managerRecoveryRequired={managerRecoveryRequired}
        onLogin={handleLogin}
        onInitialManagerSetup={handleInitialManagerSetup}
        onRecoverManagerAccess={handleRecoverManagerAccess}
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
          storeRoomItems,
          storeRoomMovements,
          wasteItems,
        }}
        inventoryActions={{
          onDeleteStoreRoomItem: handleDeleteStoreRoomItem,
          onIngredientDeleted: handleInvoiceIngredientDeleted,
          onInvoicePricesUpdated: handleInvoicePricesUpdated,
          onInvoiceSaved: refreshInvoiceDashboardStats,
          onRecordStoreRoomMovement: handleRecordStoreRoomMovement,
          onSaveStoreRoomItem: handleSaveStoreRoomItem,
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
          inventoryView,
          menuPricingView,
          onInventoryViewChange: setInventoryView,
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
          onSaveSyncAccessKey: setSyncAccessKey,
          onSaveToServer: () => saveDatabaseToServer('manual'),
        }}
        sync={{
          firebaseSync,
          serverSync,
          syncAccessKey,
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
