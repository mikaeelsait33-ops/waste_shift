import { useEffect, useRef, useState } from 'react';
import { getEntryFoodCostLost } from '../utils/wasteCalculations';

const DATABASE_NAME = 'WasteShift Local Database';
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
  portionProfiles,
  activeStaffId,
  inventoryMovements,
  auditLog,
  syncAccessKey,
  accessProfile,
  serverSync,
  onSaveToServer,
  onSaveSyncAccessKey,
  lastSavedAt,
  onRestoreDatabase,
}) {
  const fileInputRef = useRef(null);
  const [message, setMessage] = useState('');
  const [draftSyncAccessKey, setDraftSyncAccessKey] = useState(syncAccessKey || '');
  const [lastExportAt, setLastExportAt] = useState(() => localStorage.getItem('wasteShiftLastExportAt') || '');
  const [importPreview, setImportPreview] = useState(null);

  const recipeCount = Object.keys(recipes).length;
  const menuItemCount = Array.isArray(menuItems) ? menuItems.length : 0;
  const customMenuItemCount = Array.isArray(customMenuItems) ? customMenuItems.length : 0;
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
      portionProfiles: data.portionProfiles && typeof data.portionProfiles === 'object' && !Array.isArray(data.portionProfiles)
        ? Object.keys(data.portionProfiles).length
        : 0,
      inventoryMovements: Array.isArray(data.inventoryMovements) ? data.inventoryMovements.length : 0,
      auditLog: Array.isArray(data.auditLog) ? data.auditLog.length : 0,
      budget: Number(data.budget) || 0,
    };
  };
  const serverNoticeClass = ['ready', 'synced'].includes(serverSync?.status)
    ? ' notice-panel--success'
    : ['checking', 'saving', 'local', 'locked'].includes(serverSync?.status)
      ? ' notice-panel--warning'
      : '';
  const canExportData = Boolean(accessProfile?.canExportData);
  const canManageServerSync = Boolean(accessProfile?.canManageServerSync);
  const canRestoreDatabase = Boolean(accessProfile?.canRestoreDatabase);

  useEffect(() => {
    setDraftSyncAccessKey(syncAccessKey || '');
  }, [syncAccessKey]);

  const createSnapshot = () => ({
    name: DATABASE_NAME,
    version: DATABASE_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      wasteItems,
      budget,
      settings,
      recipes,
      staffList,
      customStaffList,
      customMenuItems,
      portionProfiles,
      activeStaffId,
      inventoryMovements,
      auditLog,
    },
  });

  const exportDatabase = () => {
    if (!canExportData) {
      setMessage('Only an owner or manager can export a database backup.');
      return;
    }

    const snapshot = createSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wasteshift-database-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    localStorage.setItem('wasteShiftLastExportAt', snapshot.exportedAt);
    setLastExportAt(snapshot.exportedAt);
    setMessage(`Database backup exported with ${wasteItems.length} waste entries.`);
  };

  const validateSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return false;
    if (!snapshot.data || typeof snapshot.data !== 'object') return false;
    if (!Array.isArray(snapshot.data.wasteItems)) return false;
    if (!Array.isArray(snapshot.data.staffList)) return false;
    if (snapshot.data.customStaffList !== undefined && !Array.isArray(snapshot.data.customStaffList)) return false;
    if (typeof snapshot.data.recipes !== 'object' || snapshot.data.recipes === null || Array.isArray(snapshot.data.recipes)) return false;
    if (snapshot.data.settings !== undefined && (
      typeof snapshot.data.settings !== 'object'
      || snapshot.data.settings === null
      || Array.isArray(snapshot.data.settings)
    )) return false;
    if (snapshot.data.customMenuItems !== undefined && !Array.isArray(snapshot.data.customMenuItems)) return false;
    if (snapshot.data.portionProfiles !== undefined && (
      typeof snapshot.data.portionProfiles !== 'object'
      || snapshot.data.portionProfiles === null
      || Array.isArray(snapshot.data.portionProfiles)
    )) return false;
    if (snapshot.data.inventoryMovements !== undefined && !Array.isArray(snapshot.data.inventoryMovements)) return false;
    if (snapshot.data.auditLog !== undefined && !Array.isArray(snapshot.data.auditLog)) return false;
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
    reader.onload = () => {
      try {
        const snapshot = JSON.parse(reader.result);
        if (!validateSnapshot(snapshot)) {
          setMessage('That file does not look like a WasteShift database backup.');
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
          `${summary.wasteItems} waste entries, ${summary.recipes} recipes, ${summary.staff} staff members.`,
          `Budget: R${summary.budget.toFixed(2)}.`,
          'This will replace the current local database.',
        ].join('\n');

        if (!window.confirm(confirmationText)) {
          setMessage('Import cancelled. Current database was not changed.');
          return;
        }

        onRestoreDatabase(snapshot.data);
        setMessage(`Database backup imported: ${summary.wasteItems} waste entries restored.`);
      } catch {
        setMessage('Could not read that backup file.');
        setImportPreview(null);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const saveSyncAccessKey = () => {
    if (!canManageServerSync) {
      setMessage('Only an owner can manage the server sync access key.');
      return;
    }

    onSaveSyncAccessKey?.(draftSyncAccessKey.trim());
    setMessage(draftSyncAccessKey.trim() ? 'Server sync access key saved on this device.' : 'Server sync access key removed from this device.');
  };

  return (
    <section className="panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Database</p>
            <h2 className="title">Local Database</h2>
            <p className="subtitle">Your data is saved in this browser and will remain when the local server is closed.</p>
          </div>
        </div>

        <div className="notice-panel notice-panel--success">
          <div>
            <h3 className="breakdown-title">Persistence status</h3>
            <p className="small-text" style={{ margin: 0 }}>
              Auto-save is active. Use backups if you change browsers, clear site data, or run the app on another port.
            </p>
          </div>
          <span className="badge is-green">{lastSavedAt ? `Last saved: ${formatDateTime(lastSavedAt)}` : 'Ready to save'}</span>
        </div>

        <div className={`notice-panel${serverNoticeClass}`}>
          <div>
            <h3 className="breakdown-title">Server sync</h3>
            <p className="small-text" style={{ margin: 0 }}>
              {serverSync?.message || 'Server sync has not started.'}
            </p>
          </div>
          <div className="manager-row">
            {serverSync?.lastSavedAt && (
              <span className="badge is-green">
                {formatDateTime(serverSync.lastSavedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={onSaveToServer}
              className="ghost-button is-warning"
              disabled={serverSync?.status === 'saving' || !canManageServerSync}
            >
              {serverSync?.status === 'saving' ? 'Saving...' : canManageServerSync ? 'Save to server' : 'Owner only'}
            </button>
          </div>
        </div>

        <div className="database-card">
          <h3 className="breakdown-title">Server sync access key</h3>
          <p className="small-text">
            If the deployment has `WASTESHIFT_SYNC_SECRET` set, this device must send the matching key before it can load or save the server database.
          </p>
          <div className="field-grid">
            <input
              type="password"
              value={draftSyncAccessKey}
              onChange={(event) => setDraftSyncAccessKey(event.target.value)}
              placeholder="Access key"
              className="input"
              disabled={!canManageServerSync}
              aria-label="Server sync access key"
            />
            <button type="button" onClick={saveSyncAccessKey} className="ghost-button is-warning" disabled={!canManageServerSync}>
              Save key
            </button>
          </div>
          <span className={`badge${syncAccessKey ? ' is-green' : ''}`}>
            {syncAccessKey ? 'Key saved on this device' : 'No key saved'}
          </span>
        </div>

        <div className="notice-panel notice-panel--warning">
          <div>
            <h3 className="breakdown-title">Backup health</h3>
            <p className="small-text" style={{ margin: 0 }}>
              Last downloaded backup: {formatDateTime(lastExportAt)}
            </p>
          </div>
          <span className="badge">{wasteItems.length + recipeCount + customMenuItemCount + customStaffCount} saved records</span>
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
            <h3 className="breakdown-title">Backup database</h3>
            <p className="small-text">Downloads one JSON file containing waste logs, recipes, portion sizes, staff, menu prices, and budget settings.</p>
            <button type="button" onClick={exportDatabase} className="primary-button" disabled={!canExportData}>
              {canExportData ? 'Export backup' : 'Manager only'}
            </button>
          </div>

          <div className="database-card">
            <h3 className="breakdown-title">Restore database</h3>
            <p className="small-text">Import a WasteShift backup file to replace this browser's local database.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => importDatabase(e.target.files?.[0])}
              className="input"
              style={{ display: 'none' }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="primary-button" disabled={!canRestoreDatabase}>
              {canRestoreDatabase ? 'Choose backup file' : 'Owner only'}
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
              <span className="badge">{importPreview.wasteItems} waste entries</span>
              <span className="badge">{importPreview.recipes} recipes</span>
              <span className="badge">{importPreview.staff} staff</span>
              <span className="badge">{importPreview.customMenuItems} custom prices</span>
              <span className="badge">{importPreview.portionProfiles} portions</span>
              <span className="badge">{importPreview.inventoryMovements} movements</span>
              <span className="badge">{importPreview.auditLog} audit events</span>
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
            <span className="small-text">Remembered portion sizes</span>
            <span className="badge">{portionProfileCount}</span>
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
