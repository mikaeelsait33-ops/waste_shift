import { useMemo, useState } from 'react';

function MenuManager({ menuItems, customMenuItems, onSaveMenuItem, onRemoveCustomMenuItem }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState('');

  const safeMenuItems = Array.isArray(menuItems) ? menuItems : [];
  const customKeys = useMemo(() => new Set(
    Array.isArray(customMenuItems) ? customMenuItems.map((item) => item.key) : []
  ), [customMenuItems]);
  const searchValue = searchTerm.trim().toLowerCase();
  const pricedCount = safeMenuItems.filter((item) => item.menuPrice !== null).length;
  const filteredMenuItems = safeMenuItems.filter((item) => (
    !searchValue || item.name.toLowerCase().includes(searchValue)
  ));

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!name.trim()) {
      setMessage('Enter a menu item name first.');
      return;
    }

    onSaveMenuItem({ name, price });
    setName('');
    setPrice('');
    setMessage('Menu item saved in the app database.');
  };

  const handleEditItem = (item) => {
    setName(item.name);
    setPrice(item.menuPrice !== null ? item.menuPrice.toString() : '');
    setMessage('');
  };

  return (
    <section className="inventory-section">
      <form onSubmit={handleSubmit} className="panel">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Menu catalog</p>
              <h2 className="title">Menu Items & Pricing</h2>
              <p className="subtitle">Add menu items or update prices used when logging menu waste.</p>
            </div>
          </div>

          <div className="field-grid">
            <div className="field">
              <label htmlFor="menu-name">Menu item name</label>
              <input
                id="menu-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Steak Roll"
                className="input"
              />
            </div>

            <div className="field">
              <label htmlFor="menu-price">Price</label>
              <input
                id="menu-price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="R"
                className="input"
              />
            </div>
          </div>

          <button type="submit" className="primary-button">
            Save menu item
          </button>

          {message && (
            <div className="empty-state" style={{ marginTop: '14px', padding: '14px' }}>
              {message}
            </div>
          )}
        </div>
      </form>

      <div className="panel">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Current menu</p>
              <h2 className="title">Saved Menu Items</h2>
              <p className="subtitle">CSV rows plus app-added price updates.</p>
            </div>
          </div>

          <div className="metrics-grid">
            <div className="metric-card">
              <span className="metric-value">{safeMenuItems.length}</span>
              <span className="metric-label">Menu items</span>
            </div>
            <div className="metric-card">
              <span className="metric-value">{pricedCount}</span>
              <span className="metric-label">Items with prices</span>
            </div>
          </div>

          <div className="toolbar toolbar--single">
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search menu items"
              className="input"
            />
          </div>

          {filteredMenuItems.length === 0 ? (
            <div className="empty-state">No menu items match your search.</div>
          ) : (
            <div className="inventory-list">
              {filteredMenuItems.map((item) => {
                const hasLocalChange = customKeys.has(item.key);

                return (
                  <div key={item.key} className="inventory-card">
                    <div className="item-row">
                      <div>
                        <h3 className="inventory-title">{item.name}</h3>
                        <span className="small-text">
                          {item.ingredientCount > 0 ? `${item.ingredientCount} recipe ingredients` : 'No recipe breakdown linked'}
                        </span>
                      </div>

                      <div className="manager-row">
                        {hasLocalChange && <span className="badge is-green">App saved</span>}
                        <span className={item.menuPrice !== null ? 'price is-total' : 'badge'}>
                          {item.menuPrice !== null ? `R${item.menuPrice.toFixed(2)}` : 'No price'}
                        </span>
                        <button type="button" onClick={() => handleEditItem(item)} className="ghost-button is-warning">
                          Edit
                        </button>
                        {hasLocalChange && (
                          <button type="button" onClick={() => onRemoveCustomMenuItem(item.key)} className="delete-button" title={`Remove app-saved change for ${item.name}`}>
                            x
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default MenuManager;
