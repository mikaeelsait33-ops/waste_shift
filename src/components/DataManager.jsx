import { useRef, useState } from 'react';
import { getEntryFoodCostLost } from '../utils/wasteCalculations';
import { getAutomaticManagerApiHeaders } from '../utils/apiHeaders';

const DATABASE_NAME = 'WasteShift Configuration Backup';
const DATABASE_VERSION = 1;
const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024;

function DataManager({
  wasteItems,
  budget,
  settings,
  recipes,
  staffList,
  customStaffList,
  menuItems,
  customMenuItems,
  itemPriceCatalog,
  portionProfiles,
  authSettings,
  inventoryMovements,
  auditLog,
  accessProfile,
  firebaseSync,
  onSaveToFirebase,
  lastSavedAt,
  onRestoreDatabase,
}) {
  const fileInputRef = useRef(null);
  const [message, setMessage] = useState('');
  const [lastExportAt, setLastExportAt] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [duplicateCleanupSummary, setDuplicateCleanupSummary] = useState(null);
  const [isCheckingDuplicateScopes, setIsCheckingDuplicateScopes] = useState(false);

  const recipeCount = Object.keys(recipes).length;
  const menuItemCount = Array.isArray(menuItems) ? menuItems.length : 0;
  const customMenuItemCount = Array.isArray(customMenuItems) ? customMenuItems.length : 0;
  const itemPriceCount = itemPriceCatalog && typeof itemPriceCatalog === 'object' && !Array.isArray(itemPriceCatalog)
    ? Object.keys(itemPriceCatalog).length
    : 0;
  const customStaffCount = Array.isArray(customStaffList) ? customStaffList.length : 0;
  const portionProfileCount = portionProfiles && typeof portionProfiles === 'object'
    ? Object.keys(portionProfiles).length
    : 0;
  const inventoryMovementCount = Array.isArray(inventoryMovements) ? inventoryMovements.length : 0;
  const auditEventCount = Array.isArray(auditLog) ? auditLog.length : 0;
  const ingredientCount = Object.values(recipes).reduce((sum, recipe) => (
    sum + (Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0)
  ), 0);
  const totalWasteValue = wasteItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : 'Not yet');
  const formatFileSize = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const getSnapshotSummary = (snapshot) => {
    const data = snapshot?.data || {};

    return {
      exportedAt: snapshot?.exportedAt || '',
      wasteItems: Array.isArray(data.wasteItems) ? data.wasteItems.length : 0,
      recipes: data.recipes && typeof data.recipes === 'object' && !Array.isArray(data.recipes)
        ? Object.keys(data.recipes).length
        : 0,
      staff: Array.isArray(data.staffList) ? data.staffList.length : 0,
      customMenuItems: Array.isArray(data.customMenuItems) ? data.customMenuItems.length : 0,
      itemPrices: data.itemPriceCatalog && typeof data.itemPriceCatalog === 'object' && !Array.isArray(data.itemPriceCatalog)
        ? Object.keys(data.itemPriceCatalog).length
        : 0,
      portionProfiles: data.portionProfiles && typeof data.portionProfiles === 'object' && !Array.isArray(data.portionProfiles)
        ? Object.keys(data.portionProfiles).length
        : 0,
      authConfigured: Boolean(data.authSettings?.managementPin)
        || (Array.isArray(data.customStaffList) && data.customStaffList.some((member) => member?.managerPin)),
      inventoryMovements: Array.isArray(data.inventoryMovements) ? data.inventoryMovements.length : 0,
      auditLog: Array.isArray(data.auditLog) ? data.auditLog.length : 0,
      budget: Number(data.budget) || 0,
    };
  };
  const firebaseNoticeClass = ['ready', 'synced'].includes(firebaseSync?.status)
    ? ' notice-panel--success'
    : ['checking', 'local'].includes(firebaseSync?.status)
      ? ' notice-panel--warning'
      : '';
  const canExportData = Boolean(accessProfile?.canExportData);
  const canManageServerSync = Boolean(accessProfile?.canManageServerSync);
  const canRestoreDatabase = Boolean(accessProfile?.canRestoreDatabase);
  const canCleanDuplicateScopes = Boolean(accessProfile?.canClearData);

  const createSnapshot = () => ({
    name: DATABASE_NAME,
    version: DATABASE_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      budget,
      settings,
      recipes,
      customMenuItems,
      itemPriceCatalog,
      portionProfiles,
    },
  });

  const exportDatabase = () => {
    if (!canExportData) {
      setMessage('Only an owner or manager can export restaurant configuration.');
      return;
    }

    const snapshot = createSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wasteshift-configuration-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setLastExportAt(snapshot.exportedAt);
    setMessage(`Configuration exported with ${recipeCount} recipe${recipeCount === 1 ? '' : 's'}.`);
  };

  const validateSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (!snapshot.data || typeof snapshot.data !== 'object') return false;
    if (typeof snapshot.data.recipes !== 'object' || snapshot.data.recipes === null || Array.isArray(snapshot.data.recipes)) return false;
    if (snapshot.data.settings !== undefined && (
      typeof snapshot.data.settings !== 'object'
      || snapshot.data.settings === null
      || Array.isArray(snapshot.data.settings)
    )) return false;
    if (snapshot.data.customMenuItems !== undefined && !Array.isArray(snapshot.data.customMenuItems)) return false;
    if (snapshot.data.itemPriceCatalog !== undefined && (
      typeof snapshot.data.itemPriceCatalog !== 'object'
      || snapshot.data.itemPriceCatalog === null
      || Array.isArray(snapshot.data.itemPriceCatalog)
    )) return false;
    if (snapshot.data.portionProfiles !== undefined && (
      typeof snapshot.data.portionProfiles !== 'object'
      || snapshot.data.portionProfiles === null
      || Array.isArray(snapshot.data.portionProfiles)
    )) return false;
    return true;
  };

  const importDatabase = (file) => {
    if (!file) return;

    if (!canRestoreDatabase) {
      setMessage('Only an owner can restore a database backup.');
      return;
    }

    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setMessage(`That backup is too large. Maximum size is ${(MAX_BACKUP_FILE_BYTES / (1024 * 1024)).toFixed(0)} MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const snapshot = JSON.parse(reader.result);
        if (!validateSnapshot(snapshot)) {
          setMessage('That file does not look like a WasteShift configuration backup.');
          setImportPreview(null);
          return;
        }

        const summary = getSnapshotSummary(snapshot);
        setImportPreview({
          fileName: file.name,
          fileSize: formatFileSize(file.size),
          ...summary,
        });

        const confirmationText = [
          `Import ${file.name}?`,
          `${summary.recipes} recipes and ${summary.itemPrices} ingredient prices.`,
          `Budget: R${summary.budget.toFixed(2)}.`,
          'This replaces menu and operating settings only. Waste, invoices, stock, photos, and accounts stay unchanged.',
        ].join('\n');

        if (!window.confirm(confirmationText)) {
          setMessage('Import cancelled. Current database was not changed.');
          return;
        }

        const result = await onRestoreDatabase(snapshot.data);
        setMessage(result?.ok === false
          ? result.message || 'Could not restore this configuration.'
          : `Configuration restored: ${summary.recipes} recipe${summary.recipes === 1 ? '' : 's'}.`);
      } catch (error) {
        setMessage(error?.message || 'Could not read that configuration file.');
        setImportPreview(null);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const runDuplicateScopeCleanup = async ({ deleteDuplicates = false } = {}) => {
    if (!canCleanDuplicateScopes) {
      setMessage('Only an owner or manager can clean duplicate Firebase scopes.');
      return;
    }

    const confirmation = deleteDuplicates
      ? window.prompt('Type CLEAN DUPLICATES to delete old non-canonical Firebase restaurant/account scopes.')
      : '';

    if (deleteDuplicates && confirmation !== 'CLEAN DUPLICATES') {
      setMessage('Duplicate cleanup cancelled.');
      return;
    }

    setIsCheckingDuplicateScopes(true);
    setMessage(deleteDuplicates ? 'Cleaning duplicate Firebase scopes...' : 'Checking duplicate Firebase scopes...');

    try {
      const response = await fetch('/api/admin-cleanup-duplicates', {
        method: 'POST',
        headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ confirmation }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || 'Duplicate cleanup request failed.');
      }

      setDuplicateCleanupSummary(payload);
      setMessage(payload.message || 'Duplicate Firebase scope check complete.');
    } catch (error) {
      setMessage(error?.message || 'Could not check duplicate Firebase scopes.');
    } finally {
      setIsCheckingDuplicateScopes(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Database</p>
            <h2 className="title">Data Health</h2>
            <p className="subtitle">Vercel hosts the app and Firebase is the primary database for every signed-in manager device.</p>
          </div>
        </div>

        <div className="notice-panel notice-panel--success">
          <div>
            <h3 className="breakdown-title">Firebase-only live data</h3>
            <p className="small-text" style={{ margin: 0 }}>
              Live restaurant data is loaded from Firebase. Browser storage is not used as a restaurant database.
            </p>
          </div>
          <span className="badge is-green">{lastSavedAt ? `Current session: ${formatDateTime(lastSavedAt)}` : 'Ready'}</span>
        </div>

        <div className={`notice-panel${firebaseNoticeClass}`}>
          <div>
            <h3 className="breakdown-title">Firebase live data</h3>
            <p className="small-text" style={{ margin: 0 }}>
              {firebaseSync?.message || 'Firebase status has not started.'}
            </p>
          </div>
          <div className="manager-row">
            {firebaseSync?.projectId && (
              <span className="badge">{firebaseSync.projectId}</span>
            )}
            {Number.isFinite(Number(firebaseSync?.menuItemCount)) && (
              <span className="badge">{Number(firebaseSync.menuItemCount)} menu items</span>
            )}
            {firebaseSync?.lastSavedAt && (
              <span className="badge is-green">{formatDateTime(firebaseSync.lastSavedAt)}</span>
            )}
          </div>
        </div>

        <div className="manager-row">
          <button
            type="button"
            onClick={onSaveToFirebase}
            className="ghost-button is-warning"
            disabled={firebaseSync?.status === 'saving' || !canManageServerSync}
          >
            {firebaseSync?.status === 'saving' ? 'Saving...' : canManageServerSync ? 'Save to Firebase now' : 'Owner only'}
          </button>
        </div>

        <div className="database-card">
          <h3 className="breakdown-title">Duplicate Firebase scopes</h3>
          <p className="small-text">
            Checks for old restaurant/account scopes outside the canonical Firebase restaurant. Cleanup never touches the selected main restaurant scope.
          </p>
          <div className="manager-row">
            <button
              type="button"
              onClick={() => runDuplicateScopeCleanup()}
              className="ghost-button"
              disabled={isCheckingDuplicateScopes || !canCleanDuplicateScopes}
            >
              {isCheckingDuplicateScopes ? 'Checking...' : canCleanDuplicateScopes ? 'Check duplicates' : 'Manager only'}
            </button>
            <button
              type="button"
              onClick={() => runDuplicateScopeCleanup({ deleteDuplicates: true })}
              className="danger-button"
              disabled={isCheckingDuplicateScopes || !canCleanDuplicateScopes}
            >
              Clean duplicates
            </button>
          </div>
          {duplicateCleanupSummary?.summary && (
            <div className="import-summary-grid" style={{ marginTop: 12 }}>
              <span className={`badge${duplicateCleanupSummary.summary.totalDocuments === 0 ? ' is-green' : ' is-yellow'}`}>
                {duplicateCleanupSummary.summary.totalDocuments} duplicate docs
              </span>
              {Object.entries(duplicateCleanupSummary.summary.byDatabaseId || {}).slice(0, 6).map(([databaseId, count]) => (
                <span className="badge" key={databaseId}>{databaseId}: {count}</span>
              ))}
              {duplicateCleanupSummary.deletedCount !== undefined && (
                <span className="badge is-green">Deleted {duplicateCleanupSummary.deletedCount}</span>
              )}
            </div>
          )}
        </div>

        <div className="notice-panel notice-panel--warning">
          <div>
            <h3 className="breakdown-title">Backup health</h3>
            <p className="small-text" style={{ margin: 0 }}>
              Last downloaded backup: {formatDateTime(lastExportAt)}
            </p>
          </div>
            <span className="badge">{recipeCount + customMenuItemCount + itemPriceCount + portionProfileCount} configuration records</span>
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-value">{wasteItems.length}</span>
            <span className="metric-label">Waste entries</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{recipeCount}</span>
            <span className="metric-label">Recipes</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{staffList.length}</span>
            <span className="metric-label">Staff members</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{menuItemCount}</span>
            <span className="metric-label">Menu items</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{inventoryMovementCount}</span>
            <span className="metric-label">Inventory movements</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{auditEventCount}</span>
            <span className="metric-label">Audit events</span>
          </div>
        </div>

        <div className="database-grid">
          <div className="database-card">
            <h3 className="breakdown-title">Export configuration</h3>
            <p className="small-text">Downloads menu recipes, ingredient prices, portion profiles, limits, and budget settings. Live invoices, stock, waste, photos, and accounts remain in Firebase.</p>
            <button type="button" onClick={exportDatabase} className="primary-button" disabled={!canExportData}>
              {canExportData ? 'Export configuration' : 'Manager only'}
            </button>
          </div>

          <div className="database-card">
            <h3 className="breakdown-title">Restore configuration</h3>
            <p className="small-text">Import a WasteShift configuration file. Existing waste, invoices, stock, photos, and account access are not replaced.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => importDatabase(e.target.files?.[0])}
              className="input"
              style={{ display: 'none' }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="primary-button" disabled={!canRestoreDatabase}>
              {canRestoreDatabase ? 'Choose configuration file' : 'Owner only'}
            </button>
          </div>
        </div>

        {importPreview && (
          <div className="smart-panel">
            <div className="smart-panel__header">
              <span className="breakdown-title">Last file checked</span>
              <span className="badge">{importPreview.fileSize}</span>
            </div>
            <div className="import-summary-grid">
              <span className="small-text">{importPreview.fileName}</span>
              <span className="badge">{importPreview.recipes} recipes</span>
              <span className="badge">{importPreview.customMenuItems} custom prices</span>
              <span className="badge">{importPreview.itemPrices} ingredient prices</span>
              <span className="badge">{importPreview.portionProfiles} portions</span>
            </div>
          </div>
        )}

        <div className="budget-panel">
          <div className="budget-row">
            <span className="small-text">Waste value stored</span>
            <span className="badge is-red">R{totalWasteValue.toFixed(2)}</span>
          </div>
          <div className="budget-row" style={{ marginTop: '10px' }}>
            <span className="small-text">App-added menu prices/items</span>
            <span className="badge">{customMenuItemCount}</span>
          </div>
          <div className="budget-row" style={{ marginTop: '10px' }}>
            <span className="small-text">Raw ingredient prices</span>
            <span className="badge">{itemPriceCount}</span>
          </div>
          <div className="budget-row" style={{ marginTop: '10px' }}>
            <span className="small-text">Remembered portion sizes</span>
            <span className="badge">{portionProfileCount}</span>
          </div>
          <div className="budget-row" style={{ marginTop: '10px' }}>
            <span className="small-text">Access configured</span>
            <span className={`badge${customStaffList.some((member) => member?.managerPin) || authSettings?.managementPin ? ' is-green' : ' is-red'}`}>
              {customStaffList.some((member) => member?.managerPin) || authSettings?.managementPin ? 'Manager accounts + staff PINs' : 'No'}
            </span>
          </div>
          <div className="budget-row" style={{ marginTop: '10px' }}>
            <span className="small-text">Inventory movements</span>
            <span className="badge">{inventoryMovementCount}</span>
          </div>
          <div className="budget-row" style={{ marginTop: '10px' }}>
            <span className="small-text">Audit events</span>
            <span className="badge">{auditEventCount}</span>
          </div>
          <div className="budget-row" style={{ marginTop: '10px' }}>
            <span className="small-text">App-added staff members</span>
            <span className="badge">{customStaffCount}</span>
          </div>
          <div className="budget-row">
            <span className="small-text">Stored ingredient rows</span>
            <span className="badge">{ingredientCount}</span>
          </div>
          <div className="budget-row" style={{ marginTop: '10px' }}>
            <span className="small-text">Monthly loss limit</span>
            <span className="badge">R{Number(budget || 0).toFixed(2)}</span>
          </div>
          <div className="budget-row" style={{ marginTop: '10px' }}>
            <span className="small-text">Daily value limit</span>
            <span className="badge">R{Number(settings?.dailyWasteValueLimit || 0).toFixed(2)}</span>
          </div>
          <div className="budget-row" style={{ marginTop: '10px' }}>
            <span className="small-text">Daily entry limit</span>
            <span className="badge">{Number(settings?.dailyWasteEntryLimit || 0)}</span>
          </div>
        </div>

        {message && (
          <div className="empty-state" style={{ marginTop: '14px' }}>
            {message}
          </div>
        )}
      </div>
    </section>
  );
}

export default DataManager;
