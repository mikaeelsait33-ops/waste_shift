const navItems = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'logWaste', label: 'Log Waste' },
  { key: 'wasteLog', label: 'Waste Log' },
  { key: 'recipes', label: 'Recipes' },
  { key: 'menu', label: 'Menu' },
  { key: 'database', label: 'Database' },
];

function Navbar({ activePage, onNavigate, wasteCount = 0 }) {
  return (
    <nav className="navbar">
      <div className="brand">
        <span className="brand-mark">WS</span>
        <div>
          <h1 className="brand-name">WasteShift</h1>
          <p className="brand-subtitle">Waste control</p>
        </div>
      </div>

      <div className="nav-links" aria-label="Primary navigation">
        {navItems.map((item) => {
          const isActive = activePage === item.key;

          return (
            <button
              key={item.key}
              type="button"
              className={`nav-button${isActive ? ' is-active' : ''}`}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
              {item.key === 'wasteLog' && wasteCount > 0 ? ` (${wasteCount})` : ''}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default Navbar;
