const navItems = [
  { key: 'dashboard', label: 'Dashboard', shortLabel: 'Dash', marker: 'D' },
  { key: 'logWaste', label: 'Log Waste', shortLabel: 'Log', marker: '+' },
  { key: 'invoices', label: 'Invoices', shortLabel: 'Invoices', marker: 'I' },
  { key: 'storeRoom', label: 'Stock', shortLabel: 'Stock', marker: 'S' },
  { key: 'wasteLog', label: 'History', shortLabel: 'More', marker: 'H' },
  { key: 'settings', label: 'Settings', shortLabel: 'More', marker: 'M' },
];

function Navbar({ activePage, onNavigate, wasteCount = 0, activeStaffMember, accessProfile, onLogout }) {
  const visibleNavItems = navItems.filter((item) => {
    if (item.key === 'storeRoom' || item.key === 'invoices') {
      return accessProfile?.canViewStoreRoom;
    }

    return accessProfile?.canViewFinancials || item.key === 'logWaste' || item.key === 'wasteLog';
  });
  const mobileNavItems = [
    navItems.find((item) => item.key === 'dashboard'),
    navItems.find((item) => item.key === 'logWaste'),
    navItems.find((item) => item.key === 'invoices'),
    navItems.find((item) => item.key === 'storeRoom'),
    navItems.find((item) => item.key === 'settings'),
  ].filter(Boolean).filter((item) => visibleNavItems.some((visibleItem) => visibleItem.key === item.key));
  const canShowHistory = visibleNavItems.some((item) => item.key === 'wasteLog');

  if (canShowHistory && !mobileNavItems.some((item) => item.key === 'settings')) {
    mobileNavItems.push(navItems.find((item) => item.key === 'wasteLog'));
  }

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

          <button
            type="button"
            className="quick-log-button"
            onClick={() => onNavigate('logWaste')}
          >
            + Log Waste
          </button>
        </div>

        <div className={`operator-chip${accessProfile?.hasOperator ? '' : ' is-muted'}`}>
          <span className="operator-chip__label">Operator</span>
          <strong>{activeStaffMember?.name || 'Not selected'}</strong>
          <span className="badge">{accessProfile?.roleLabel || 'Unassigned'}</span>
        </div>

        <div className="nav-links" aria-label="Primary navigation">
          {visibleNavItems.map((item) => {
            const isActive = activePage === item.key;

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
          const isActive = activePage === item.key;

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
