import { useEffect, useMemo, useRef, useState } from 'react';
import DataManager from './DataManager';
import ItemPriceManager from './ItemPriceManager';
import RecipeManager from './RecipeManager';
import { STAFF_SECTIONS, getStaffSectionMeta, inferStaffSection } from '../utils/staffSections';
import { getEntryFoodCostLost } from '../utils/wasteCalculations';

const settingsSections = [
  { key: 'security', label: 'Security' },
  { key: 'limits', label: 'Limits' },
  { key: 'staff', label: 'Staff' },
  { key: 'items', label: 'Menu & Recipes' },
  { key: 'audit', label: 'Audit' },
  { key: 'database', label: 'Database' },
  { key: 'danger', label: 'Danger' },
];

const parseDate = (dateStr) => {
  if (!dateStr) return new Date(0);
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  return new Date(dateStr);
};

const getTodayItems = (items) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemDate = parseDate(item?.date);
    itemDate.setHours(0, 0, 0, 0);
    return itemDate.getTime() === today.getTime();
  });
};

function StaffSettings({ staffList, onAddStaff, onDeleteStaff, onResetStaffCode, accessProfile }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [staffSection, setStaffSection] = useState('kitchen');
  const [message, setMessage] = useState('');
  const [staffSearch, setStaffSearch] = useState('');
  const safeStaffList = useMemo(() => (Array.isArray(staffList) ? staffList : []), [staffList]);
  const filteredStaffList = useMemo(() => {
    const searchValue = staffSearch.trim().toLowerCase();

    if (!searchValue) {
      return safeStaffList;
    }

    return safeStaffList.filter((member) => (
      [
        member.name,
        member.role,
        getStaffSectionMeta(member.staffSection || inferStaffSection(member.role)).label,
      ].some((part) => String(part || '').toLowerCase().includes(searchValue))
    ));
  }, [safeStaffList, staffSearch]);
  const customStaffCount = safeStaffList.filter((member) => !member.isCsvSeed).length;
  const sectionCounts = STAFF_SECTIONS.map((section) => ({
    ...section,
    count: safeStaffList.filter((member) => (
      (member.staffSection || inferStaffSection(member.role)) === section.key
    )).length,
  }));

  const handleDeleteClick = (member) => {
    if (window.confirm(`Remove ${member.name} from staff options?`)) {
      onDeleteStaff(member.id);
      setMessage(`${member.name} removed.`);
    }
  };

  const handleResetCodeClick = async (member) => {
    const result = await onResetStaffCode?.(member.id);

    if (!result?.ok) {
      setMessage(result?.message || 'Could not reset this staff code.');
      return;
    }

    setMessage(`New code for ${result.staffName}: ${result.generatedStaffCode}. Share it once with that staff member.`);
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedRole = role.trim();

    if (!trimmedName || !trimmedRole) {
      setMessage('Enter a staff name and role.');
      return;
    }

    if (safeStaffList.some((member) => member.name.toLowerCase() === trimmedName.toLowerCase())) {
      setMessage('That staff member already exists.');
      return;
    }

    onAddStaff({ name: trimmedName, role: trimmedRole, staffSection });
    setName('');
    setRole('');
    setStaffSection('kitchen');
    setMessage('Staff member saved.');
  };

  return (
    <div className="panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Staff setup</p>
            <h2 className="title">Staff Members</h2>
            <p className="subtitle">Manage the names available when logging responsibility.</p>
          </div>
          <span className="badge">{safeStaffList.length} total</span>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="staff-form-grid">
            <div className="field">
              <label htmlFor="staff-name">Name</label>
              <input
                id="staff-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="input"
              />
            </div>

            <div className="field">
              <label htmlFor="staff-role">Role</label>
              <input
                id="staff-role"
                type="text"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                list="staff-role-options"
                className="input"
              />
              <datalist id="staff-role-options">
                <option value="Kitchen" />
                <option value="Prep" />
                <option value="Manager" />
                <option value="Front of house" />
                <option value="Bar" />
                <option value="Barista" />
                <option value="Waiter" />
              </datalist>
            </div>

            <div className="field">
              <label htmlFor="staff-section">Section</label>
              <select
                id="staff-section"
                value={staffSection}
                onChange={(event) => setStaffSection(event.target.value)}
                className="select"
              >
                {STAFF_SECTIONS.map((section) => (
                  <option key={section.key} value={section.key}>
                    {section.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button type="submit" className="primary-button" disabled={!accessProfile?.canManageStaff}>
            {accessProfile?.canManageStaff ? 'Save staff member' : 'Manager only'}
          </button>
        </form>

        {message && (
          <div className="empty-state" style={{ marginTop: '14px', padding: '14px' }}>
            {message}
          </div>
        )}

        <div className="toolbar toolbar--single">
          <input
            type="search"
            value={staffSearch}
            onChange={(event) => setStaffSearch(event.target.value)}
            placeholder="Search staff or role"
            className="input"
          />
        </div>

        <div className="notice-list" style={{ marginBottom: '12px' }}>
          <span className="badge">{customStaffCount} app-added</span>
          <span className="badge">{safeStaffList.length - customStaffCount} CSV</span>
          {sectionCounts.map((section) => (
            <span
              key={section.key}
              className={`badge staff-section-badge staff-section-badge--${section.key}`}
            >
              {section.shortLabel}: {section.count}
            </span>
          ))}
        </div>

        <div className="staff-list" style={{ marginTop: '16px' }}>
          {filteredStaffList.length === 0 ? (
            <div className="empty-state">No staff members match the current search.</div>
          ) : filteredStaffList.map((member) => {
            const section = getStaffSectionMeta(member.staffSection || inferStaffSection(member.role));

            return (
            <div key={member.id} className="staff-card item-row">
              <div>
                <strong>{member.name}</strong>
                <span className="badge">{member.role}</span>
                <span className={`badge staff-section-badge staff-section-badge--${section.key}`}>
                  {section.label}
                </span>
                {member.isCsvSeed && <span className="badge">CSV</span>}
              </div>
              <div className="manager-row">
                {section.key !== 'management' && (
                  <button
                    type="button"
                    onClick={() => handleResetCodeClick(member)}
                    className="ghost-button compact-action"
                    disabled={!accessProfile?.canManageStaff}
                  >
                    Reset code
                  </button>
                )}
                {!member.isCsvSeed && (
                  <button
                    type="button"
                    onClick={() => handleDeleteClick(member)}
                    className="delete-button"
                    title={`Remove ${member.name}`}
                    disabled={!accessProfile?.canManageStaff}
                  >
                    x
                  </button>
                )}
              </div>
            </div>
          );
          })}
        </div>
      </div>
    </div>
  );
}

function SecurityPanel({
  activeStaffMember,
  accessProfile,
  authSettings,
  authSession,
  onSavePinSettings,
  onLogout,
}) {
  const [managementPin, setManagementPin] = useState('');
  const [confirmManagementPin, setConfirmManagementPin] = useState('');
  const [pinMessage, setPinMessage] = useState('');
  const [isSavingPins, setIsSavingPins] = useState(false);
  const permissionRows = [
    ['Log waste', accessProfile?.canLogWaste],
    ['View financial analytics', accessProfile?.canViewFinancials],
    ['Delete or restore entries', accessProfile?.canDeleteEntries],
    ['Export reports/backups', accessProfile?.canExportData],
    ['Manage staff', accessProfile?.canManageStaff],
    ['Manage menu and recipes', accessProfile?.canManageMenu],
    ['Manage server sync', accessProfile?.canManageServerSync],
    ['Restore or clear database', accessProfile?.canRestoreDatabase && accessProfile?.canClearData],
  ];
  const handlePinSubmit = async (event) => {
    event.preventDefault();

    if (!accessProfile?.canManagePins) {
      setPinMessage('Management access is required to change PINs.');
      return;
    }

    if (!managementPin) {
      setPinMessage('Enter a new management PIN.');
      return;
    }

    if (managementPin && managementPin !== confirmManagementPin) {
      setPinMessage('Management PINs do not match.');
      return;
    }

    setIsSavingPins(true);
    setPinMessage('');

    try {
      const result = await onSavePinSettings?.({ managementPin });

      if (!result?.ok) {
        setPinMessage(result?.message || 'Could not save PINs.');
        return;
      }

      setManagementPin('');
      setConfirmManagementPin('');
      setPinMessage('Management PIN updated.');
    } finally {
      setIsSavingPins(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Access control</p>
            <h2 className="title">Security & Safety</h2>
            <p className="subtitle">Review the active session, staff codes, and management PIN.</p>
          </div>
          <span className={`badge${accessProfile?.canManageServerSync ? ' is-green' : ''}`}>
            {accessProfile?.roleLabel || 'Unassigned'}
          </span>
        </div>

        <div className="notice-panel notice-panel--warning">
          <div>
            <h3 className="breakdown-title">Local role safety</h3>
            <p className="small-text" style={{ margin: 0 }}>
              Staff use personal generated codes. Management PIN unlocks reports, settings, exports, backup restore, and protected actions.
            </p>
          </div>
        </div>

        <div className="field-grid">
          <div className="metric-card">
            <span className="metric-value">{activeStaffMember?.name || 'None'}</span>
            <span className="metric-label">Active operator</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{authSession?.mode === 'management' ? 'Management' : 'Staff'}</span>
            <span className="metric-label">Current access level</span>
          </div>
        </div>

        <div className="smart-panel">
          <div className="smart-panel__header">
            <span className="breakdown-title">PIN status</span>
            <button type="button" onClick={onLogout} className="ghost-button is-warning">
              Lock app
            </button>
          </div>
          <div className="import-summary-grid">
            <span className="badge is-green">Staff codes per account</span>
            <span className={`badge${authSettings?.managementPin ? ' is-green' : ' is-red'}`}>Management PIN {authSettings?.managementPin ? 'set' : 'missing'}</span>
            {authSettings?.updatedAt && <span className="badge">Updated {new Date(authSettings.updatedAt).toLocaleString()}</span>}
          </div>
        </div>

        <form onSubmit={handlePinSubmit} className="budget-panel">
          <h3 className="breakdown-title">Change management PIN</h3>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="change-management-pin">New management PIN</label>
              <input
                id="change-management-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={managementPin}
                onChange={(event) => setManagementPin(event.target.value)}
                placeholder="Leave blank to keep current"
                className="input"
                disabled={!accessProfile?.canManagePins}
              />
            </div>

            <div className="field">
              <label htmlFor="confirm-management-pin">Confirm management PIN</label>
              <input
                id="confirm-management-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={confirmManagementPin}
                onChange={(event) => setConfirmManagementPin(event.target.value)}
                placeholder="Required when changing management PIN"
                className="input"
                disabled={!accessProfile?.canManagePins}
              />
            </div>
          </div>
          <button type="submit" className="primary-button" disabled={!accessProfile?.canManagePins || isSavingPins}>
            {isSavingPins ? 'Saving...' : accessProfile?.canManagePins ? 'Save management PIN' : 'Management only'}
          </button>
          {pinMessage && (
            <div className="inline-message" role="status">
              {pinMessage}
            </div>
          )}
        </form>

        <div className="permission-grid">
          {permissionRows.map(([label, allowed]) => (
            <div key={label} className="permission-card">
              <span>{label}</span>
              <span className={`badge${allowed ? ' is-green' : ' is-red'}`}>
                {allowed ? 'Allowed' : 'Restricted'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AuditLogPanel({ auditLog, inventoryMovements }) {
  const safeAuditLog = Array.isArray(auditLog) ? auditLog : [];
  const safeInventoryMovements = Array.isArray(inventoryMovements) ? inventoryMovements : [];
  const recentAuditLog = safeAuditLog.slice(0, 80);
  const recentMovements = safeInventoryMovements.slice(-8).reverse();
  const totalMovementValue = safeInventoryMovements.reduce((sum, movement) => (
    sum + (Number(movement?.costImpact) || 0)
  ), 0);
  const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : 'Not recorded');
  const formatAuditValue = (value) => {
    if (value === null || value === undefined || value === '') {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    return JSON.stringify(value);
  };

  return (
    <section className="panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Commercial trust</p>
            <h2 className="title">Audit Log</h2>
            <p className="subtitle">Track operational changes and the waste-driven inventory movement history.</p>
          </div>
          <span className="badge">{safeAuditLog.length} events</span>
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-value">{safeAuditLog.length}</span>
            <span className="metric-label">Audit events</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{safeInventoryMovements.length}</span>
            <span className="metric-label">Inventory movements</span>
          </div>
          <div className="metric-card">
            <span className="metric-value is-danger">R{totalMovementValue.toFixed(2)}</span>
            <span className="metric-label">Waste movement value</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{recentAuditLog[0]?.user || 'None'}</span>
            <span className="metric-label">Last actor</span>
          </div>
        </div>

        <div className="breakdown-grid breakdown-grid--two">
          <div>
            <h3 className="breakdown-title">Recent audit events</h3>
            {recentAuditLog.length === 0 ? (
              <div className="empty-state">No audit events recorded yet.</div>
            ) : (
              <div className="staff-list">
                {recentAuditLog.map((event) => (
                  <div key={event.id} className="staff-card">
                    <div className="budget-row">
                      <strong>{event.action}</strong>
                      <span className="badge">{event.user || 'System'}</span>
                    </div>
                    <div className="small-text">{formatDateTime(event.date)}{event.relatedItem ? ` - ${event.relatedItem}` : ''}</div>
                    {(event.beforeValue || event.afterValue) && (
                      <div className="small-text">
                        {event.beforeValue && `Before: ${formatAuditValue(event.beforeValue)}`}
                        {event.beforeValue && event.afterValue ? ' | ' : ''}
                        {event.afterValue && `After: ${formatAuditValue(event.afterValue)}`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="breakdown-title">Latest inventory movements</h3>
            {recentMovements.length === 0 ? (
              <div className="empty-state">No inventory movements recorded yet.</div>
            ) : (
              <div className="staff-list">
                {recentMovements.map((movement) => (
                  <div key={movement.id} className="staff-card">
                    <div className="budget-row">
                      <strong>{movement.ingredientName}</strong>
                      <span className="price">R{(Number(movement.costImpact) || 0).toFixed(2)}</span>
                    </div>
                    <div className="small-text">
                      {movement.changeLabel || 'Waste deduction'} - {movement.staff || 'Unassigned'} - {movement.date || 'No date'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Settings({
  budget,
  settings,
  wasteItems,
  recipes,
  staffList,
  customStaffList,
  menuItems,
  customMenuItems,
  itemPriceCatalog,
  portionProfiles,
  activeStaffId,
  activeStaffMember,
  accessProfile,
  authSettings,
  authSession,
  inventoryMovements,
  auditLog,
  syncAccessKey,
  serverSync,
  lastSavedAt,
  onSaveSettings,
  onClearAllWaste,
  onAddStaff,
  onDeleteStaff,
  onResetStaffCode,
  onAddRecipe,
  onClearRecipes,
  onSaveMenuItem,
  onRemoveCustomMenuItem,
  onSaveItemPrice,
  onDeleteItemPrice,
  onSaveToServer,
  onSaveSyncAccessKey,
  onSavePinSettings,
  onLogout,
  onRestoreDatabase,
}) {
  const [activeSection, setActiveSection] = useState('security');
  const [draftBudget, setDraftBudget] = useState(String(budget || 0));
  const [dailyWasteValueLimit, setDailyWasteValueLimit] = useState(String(settings?.dailyWasteValueLimit || ''));
  const [dailyWasteEntryLimit, setDailyWasteEntryLimit] = useState(String(settings?.dailyWasteEntryLimit || ''));
  const [message, setMessage] = useState('');
  const [settingsChromeHidden, setSettingsChromeHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const tickingRef = useRef(false);
  const scrollFrameRef = useRef(0);

  useEffect(() => {
    setDraftBudget(String(budget || 0));
  }, [budget]);

  useEffect(() => {
    setDailyWasteValueLimit(String(settings?.dailyWasteValueLimit || ''));
    setDailyWasteEntryLimit(String(settings?.dailyWasteEntryLimit || ''));
  }, [settings]);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY || 0;

    const handleScroll = () => {
      if (tickingRef.current) {
        return;
      }

      tickingRef.current = true;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY || 0;
        const scrollDelta = currentScrollY - lastScrollYRef.current;

        if (currentScrollY < 140 || scrollDelta < -8) {
          setSettingsChromeHidden(false);
        } else if (scrollDelta > 10) {
          setSettingsChromeHidden(true);
        }

        lastScrollYRef.current = currentScrollY;
        tickingRef.current = false;
        scrollFrameRef.current = 0;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollFrameRef.current) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = 0;
      }
    };
  }, []);

  useEffect(() => {
    setSettingsChromeHidden(false);
  }, [activeSection]);

  const todayItems = getTodayItems(wasteItems);
  const todayLoss = todayItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const currentMonthItems = (Array.isArray(wasteItems) ? wasteItems : []).filter((item) => {
    const itemDate = parseDate(item?.date);
    return itemDate.getMonth() === today.getMonth() && itemDate.getFullYear() === today.getFullYear();
  });
  const currentMonthLoss = currentMonthItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const activeWasteDays = new Set(currentMonthItems.map((item) => item?.date).filter(Boolean)).size;
  const draftBudgetValue = Number(draftBudget) || 0;
  const recommendedDailyValueLimit = draftBudgetValue > 0 ? draftBudgetValue / daysInMonth : 0;
  const recommendedDailyEntryLimit = currentMonthItems.length > 0
    ? Math.max(1, Math.ceil(currentMonthItems.length / Math.max(1, activeWasteDays) * 1.25))
    : 5;
  const dailyValueLimit = Number(settings?.dailyWasteValueLimit) || 0;
  const dailyEntryLimit = Number(settings?.dailyWasteEntryLimit) || 0;
  const dailyValueUsagePercent = dailyValueLimit > 0 ? Math.min(100, (todayLoss / dailyValueLimit) * 100) : 0;
  const dailyEntryUsagePercent = dailyEntryLimit > 0 ? Math.min(100, (todayItems.length / dailyEntryLimit) * 100) : 0;

  const handleSaveLimits = (event) => {
    event.preventDefault();

    onSaveSettings({
      budget: draftBudget,
      dailyWasteValueLimit,
      dailyWasteEntryLimit,
    });
    setMessage('Limits saved.');
  };

  return (
    <section className="settings-page">
      <div className={`settings-sticky-controls${settingsChromeHidden ? ' is-hidden' : ''}`}>
        <div className="section-header settings-page-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2 className="title">Setup & Controls</h2>
            <p className="subtitle">Manage limits, staff, menu items, database sync, and high-impact actions.</p>
          </div>
        </div>

        <div className="segmented-control settings-tabs" aria-label="Settings sections">
          {settingsSections.map((section) => (
            <button
              key={section.key}
              type="button"
              onClick={() => setActiveSection(section.key)}
              className={`segment-button${activeSection === section.key ? ' is-active' : ''}`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {activeSection === 'limits' && (
        <form onSubmit={handleSaveLimits} className="panel">
          <div className="panel-body">
            <div className="section-header">
              <div>
                <p className="eyebrow">Daily limits</p>
                <h2 className="title">Waste Guardrails</h2>
                <p className="subtitle">Set daily controls used on the dashboard.</p>
              </div>
            </div>

            <div className="metrics-grid">
              <div className="metric-card">
                <span className={`metric-value${dailyValueLimit > 0 && todayLoss > dailyValueLimit ? ' is-danger' : ''}`}>
                  R{todayLoss.toFixed(2)}
                </span>
                <span className="metric-label">Today&apos;s waste value</span>
              </div>
              <div className="metric-card">
                <span className={`metric-value${dailyEntryLimit > 0 && todayItems.length > dailyEntryLimit ? ' is-danger' : ''}`}>
                  {todayItems.length}
                </span>
                <span className="metric-label">Today&apos;s entries</span>
              </div>
              <div className="metric-card">
                <span className={`metric-value${draftBudgetValue > 0 && currentMonthLoss > draftBudgetValue ? ' is-danger' : ''}`}>
                  R{currentMonthLoss.toFixed(2)}
                </span>
                <span className="metric-label">This month&apos;s waste value</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">R{recommendedDailyValueLimit.toFixed(2)}</span>
                <span className="metric-label">Suggested daily value pace</span>
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="monthly-loss-limit">Monthly loss limit</label>
                <input
                  id="monthly-loss-limit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={draftBudget}
                  onChange={(event) => setDraftBudget(event.target.value)}
                  className="input"
                />
              </div>

              <div className="field">
                <label htmlFor="daily-value-limit">Daily value limit</label>
                <input
                  id="daily-value-limit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={dailyWasteValueLimit}
                  onChange={(event) => setDailyWasteValueLimit(event.target.value)}
                  placeholder="R"
                  className="input"
                />
              </div>

              <div className="field">
                <label htmlFor="daily-entry-limit">Daily entry limit</label>
                <input
                  id="daily-entry-limit"
                  type="number"
                  min="0"
                  step="1"
                  value={dailyWasteEntryLimit}
                  onChange={(event) => setDailyWasteEntryLimit(event.target.value)}
                  placeholder="Entries"
                  className="input"
                />
              </div>
            </div>

            <div className="smart-panel">
              <div className="smart-panel__header">
                <span className="breakdown-title">Smart suggestions</span>
                <span className="badge">Based on this month</span>
              </div>
              <div className="suggestion-row">
                <button
                  type="button"
                  onClick={() => setDailyWasteValueLimit(recommendedDailyValueLimit.toFixed(2))}
                  className="suggestion-button"
                  disabled={recommendedDailyValueLimit <= 0}
                >
                  <span>Daily value limit</span>
                  <strong>R{recommendedDailyValueLimit.toFixed(2)}</strong>
                </button>
                <button
                  type="button"
                  onClick={() => setDailyWasteEntryLimit(String(recommendedDailyEntryLimit))}
                  className="suggestion-button"
                >
                  <span>Daily entry limit</span>
                  <strong>{recommendedDailyEntryLimit}</strong>
                </button>
              </div>
            </div>

            {(dailyValueLimit > 0 || dailyEntryLimit > 0) && (
              <div className="breakdown-grid">
                {dailyValueLimit > 0 && (
                  <div className="breakdown-item">
                    <div className="breakdown-label">
                      <span>Daily value usage</span>
                      <span>R{todayLoss.toFixed(2)} / R{dailyValueLimit.toFixed(2)}</span>
                    </div>
                    <div className="progress-track">
                      <div className={`progress-fill${todayLoss > dailyValueLimit ? ' is-danger' : ''}`} style={{ width: `${dailyValueUsagePercent}%` }} />
                    </div>
                  </div>
                )}

                {dailyEntryLimit > 0 && (
                  <div className="breakdown-item">
                    <div className="breakdown-label">
                      <span>Daily entry usage</span>
                      <span>{todayItems.length} / {dailyEntryLimit}</span>
                    </div>
                    <div className="progress-track">
                      <div className={`progress-fill${todayItems.length > dailyEntryLimit ? ' is-danger' : ''}`} style={{ width: `${dailyEntryUsagePercent}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <button type="submit" className="primary-button" disabled={!accessProfile?.canManageLimits}>
              {accessProfile?.canManageLimits ? 'Save limits' : 'Manager only'}
            </button>

            {message && (
              <div className="empty-state" style={{ marginTop: '14px', padding: '14px' }}>
                {message}
              </div>
            )}
          </div>
        </form>
      )}

      {activeSection === 'security' && (
        <SecurityPanel
          activeStaffMember={activeStaffMember}
          accessProfile={accessProfile}
          authSettings={authSettings}
          authSession={authSession}
          onSavePinSettings={onSavePinSettings}
          onLogout={onLogout}
        />
      )}

      {activeSection === 'staff' && (
        <StaffSettings
          staffList={staffList}
          onAddStaff={onAddStaff}
          onDeleteStaff={onDeleteStaff}
          onResetStaffCode={onResetStaffCode}
          accessProfile={accessProfile}
        />
      )}

      {activeSection === 'items' && (
        <>
          <ItemPriceManager
            itemPriceCatalog={itemPriceCatalog}
            accessProfile={accessProfile}
            onSaveItemPrice={onSaveItemPrice}
            onDeleteItemPrice={onDeleteItemPrice}
          />
          <RecipeManager
            recipes={recipes}
            menuItems={menuItems}
            customMenuItems={customMenuItems}
            itemPriceCatalog={itemPriceCatalog}
            onAddRecipe={onAddRecipe}
            onClearRecipes={onClearRecipes}
            onSaveMenuItem={onSaveMenuItem}
            onRemoveCustomMenuItem={onRemoveCustomMenuItem}
          />
        </>
      )}

      {activeSection === 'database' && (
        <DataManager
          wasteItems={wasteItems}
          budget={budget}
          settings={settings}
          recipes={recipes}
          staffList={staffList}
          customStaffList={customStaffList}
          menuItems={menuItems}
          customMenuItems={customMenuItems}
          itemPriceCatalog={itemPriceCatalog}
          portionProfiles={portionProfiles}
          activeStaffId={activeStaffId}
          authSettings={authSettings}
          inventoryMovements={inventoryMovements}
          auditLog={auditLog}
          syncAccessKey={syncAccessKey}
          accessProfile={accessProfile}
          serverSync={serverSync}
          onSaveToServer={onSaveToServer}
          onSaveSyncAccessKey={onSaveSyncAccessKey}
          lastSavedAt={lastSavedAt}
          onRestoreDatabase={onRestoreDatabase}
        />
      )}

      {activeSection === 'audit' && (
        <AuditLogPanel
          auditLog={auditLog}
          inventoryMovements={inventoryMovements}
        />
      )}

      {activeSection === 'danger' && (
        <div className="panel">
          <div className="panel-body">
            <div className="section-header">
              <div>
                <p className="eyebrow">Danger zone</p>
                <h2 className="title">Protected Actions</h2>
                <p className="subtitle">Clear large sets of operational data from one deliberate place.</p>
              </div>
            </div>

            <div className="notice-panel">
              <div>
                <h3 className="breakdown-title">Clear waste log</h3>
                <p className="small-text" style={{ margin: 0 }}>
                  Removes all logged waste entries. Recipes, staff, prices, limits, and portion sizes stay saved.
                </p>
              </div>
              <div className="manager-row">
                <span className="badge is-red">{wasteItems.length} entries</span>
                <button type="button" onClick={onClearAllWaste} className="danger-button" disabled={wasteItems.length === 0 || !accessProfile?.canClearData}>
                  {accessProfile?.canClearData ? 'Clear all waste' : 'Owner only'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default Settings;
