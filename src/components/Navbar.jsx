const navItems = [
  { key: 'dashboard', label: 'Dashboard', shortLabel: 'Home', marker: 'D' },
  { key: 'logWaste', label: 'Log Waste', shortLabel: 'Log', marker: '+' },
  { key: 'wasteLog', label: 'Waste Log', shortLabel: 'Waste', marker: 'W' },
  { key: 'inventory', label: 'Inventory', shortLabel: 'Stock', marker: 'I' },
  { key: 'menuPricing', label: 'Menu & Pricing', shortLabel: 'Menu', marker: 'M' },
  { key: 'settings', label: 'Settings', shortLabel: 'More', marker: 'S' },
];

function Navbar({ activePage, onNavigate, wasteCount = 0, activeStaffMember, accessProfile, onLogout }) {
  const visibleNavItems = navItems.filter((item) => {
    if (item.key === 'inventory') {
      return accessProfile?.canViewFinancials;
    }

    if (item.key === 'menuPricing') {
      return accessProfile?.canManageMenu || accessProfile?.canViewFinancials;
    }

    return accessProfile?.canViewFinancials || item.key === 'logWaste' || item.key === 'wasteLog';
  });
  const mobileNavItems = [
    navItems.find((item) => item.key === 'logWaste'),
    navItems.find((item) => item.key === 'wasteLog'),
    navItems.find((item) => item.key === 'dashboard'),
    navItems.find((item) => item.key === 'inventory'),
    navItems.find((item) => item.key === 'menuPricing'),
    navItems.find((item) => item.key === 'settings'),
  ].filter(Boolean).filter((item) => visibleNavItems.some((visibleItem) => visibleItem.key === item.key));
  const activeGroups = {
    inventory: ['inventory', 'invoices', 'storeRoom'],
    menuPricing: ['menuPricing', 'ingredients', 'items'],
  };
  const itemIsActive = (item) => (activeGroups[item.key] || [item.key]).includes(activePage);

  return (
    <>
      <nav className="navbar" aria-label="WasteShift navigation">
        <div className="navbar__top">
          <div className="brand">
            <span className="brand-mark">WS</span>
            <div>
              <h1 className="brand-name">WasteShift</h1>
              <p className="brand-subtitle">Kitchen intelligence</p>
            </div>
          </div>

          <div className="quick-nav-actions">
            <button
              type="button"
              className="quick-log-button"
              onClick={() => onNavigate('logWaste')}
            >
              + Log Waste
            </button>
          </div>
        </div>

        <div className={`operator-chip${accessProfile?.hasOperator ? '' : ' is-muted'}`}>
          <span className="operator-chip__label">Operator</span>
          <strong>{activeStaffMember?.name || 'Not selected'}</strong>
          <span className="badge">{accessProfile?.roleLabel || 'Unassigned'}</span>
        </div>

        <div className="nav-links" aria-label="Primary navigation">
          {visibleNavItems.map((item) => {
            const isActive = itemIsActive(item);

            return (
              <button
                key={item.key}
                type="button"
                className={`nav-button${isActive ? ' is-active' : ''}${item.key === 'logWaste' ? ' is-primary' : ''}`}
                onClick={() => onNavigate(item.key)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="nav-marker">{item.marker}</span>
                <span>{item.label}</span>
                {item.key === 'wasteLog' && wasteCount > 0 && (
                  <span className="nav-count">{wasteCount}</span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            className="nav-button"
            onClick={onLogout}
          >
            <span className="nav-marker">L</span>
            <span>Lock</span>
          </button>
        </div>
      </nav>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {mobileNavItems.map((item) => {
          const isActive = itemIsActive(item);

          return (
            <button
              key={item.key}
              type="button"
              className={`bottom-nav-button${isActive ? ' is-active' : ''}${item.key === 'logWaste' ? ' is-primary' : ''}`}
              onClick={() => onNavigate(item.key)}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="bottom-nav-marker">{item.marker}</span>
              <span>{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

export default Navbar;
