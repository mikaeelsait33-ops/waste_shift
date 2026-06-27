const navItems = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'logWaste', label: 'Log' },
  { key: 'wasteLog', label: 'History' },
  { key: 'settings', label: 'Settings' },
];

function Navbar({ activePage, onNavigate, wasteCount = 0, activeStaffMember, accessProfile, onLogout }) {
  const visibleNavItems = navItems.filter((item) => (
    accessProfile?.canViewFinancials || item.key === 'logWaste' || item.key === 'wasteLog'
  ));

  return (
    <nav className="navbar">
      <div className="brand">
        <span className="brand-mark">WS</span>
        <div>
          <h1 className="brand-name">WasteShift</h1>
          <p className="brand-subtitle">Kitchen intelligence</p>
        </div>
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
              className={`nav-button${isActive ? ' is-active' : ''}`}
              onClick={() => onNavigate(item.key)}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.label}
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
          Lock
        </button>
      </div>
    </nav>
  );
}

export default Navbar;
