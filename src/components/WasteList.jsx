import { useState } from 'react';
import DateNavigator from './DateNavigator';

function WasteList({ items, onDeleteEntry, onClearAll }) {
  const [activeFilter, setActiveFilter] = useState('All');
  const [viewMode, setViewMode] = useState('day');
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const parseDate = (dateStr) => {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
    return new Date(dateStr);
  };

  const dateFilteredItems = items.filter((item) => {
    if (viewMode === 'all') return true;

    const itemDate = parseDate(item?.date);
    itemDate.setHours(0, 0, 0, 0);

    if (viewMode === 'day') {
      const sel = new Date(selectedDate);
      sel.setHours(0, 0, 0, 0);
      return itemDate.getTime() === sel.getTime();
    }

    if (viewMode === 'month') {
      return itemDate.getMonth() === selectedDate.getMonth() && itemDate.getFullYear() === selectedDate.getFullYear();
    }

    return true;
  });

  const filteredItems = dateFilteredItems.filter((item) => {
    if (activeFilter === 'All') return true;
    if (item.isRecipe) return item.ingredients.some((ing) => ing.category === activeFilter);
    return item.category === activeFilter;
  });

  const totalCost = dateFilteredItems.reduce((sum, item) => sum + (Number(item?.cost) || 0), 0);
  const totalCount = dateFilteredItems.length;
  const filterCategories = ['All', 'Produce', 'Dairy', 'Bakery', 'Meat/Poultry', 'Pantry', 'Other'];

  return (
    <section className="list-page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Waste log</p>
          <h2 className="title">Logged Items</h2>
          <p className="subtitle">Review entries by date range and category.</p>
        </div>
        {items.length > 0 && (
          <button type="button" onClick={onClearAll} className="danger-button">
            Clear all
          </button>
        )}
      </div>

      <DateNavigator
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {viewMode !== 'all' && (
        <div className="budget-panel" style={{ marginBottom: '14px' }}>
          <div className="budget-row">
            <span className="small-text">
              <strong>{totalCount}</strong> item{totalCount !== 1 ? 's' : ''} logged
            </span>
            <span className="price">R{totalCost.toFixed(2)}</span>
          </div>
        </div>
      )}

      <div className="filter-row" aria-label="Waste category filter">
        {filterCategories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveFilter(cat)}
            className={`pill-button${activeFilter === cat ? ' is-active' : ''}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div className="empty-state">
          {viewMode === 'all'
            ? 'No items found under this scope.'
            : viewMode === 'day'
              ? 'No waste was logged on this day.'
              : 'No waste was logged this month.'}
        </div>
      ) : (
        <ul className="log-list">
          {filteredItems.map((item) => {
            const itemCost = Number(item?.cost) || 0;

            return (
              <li key={item.id} className={`log-card ${item.isRecipe ? 'is-recipe' : 'is-single'}`}>
                <div className="item-row">
                  <div>
                    <h3 className="log-title">
                      {item.name}
                      <span className="small-text"> x{item.quantity}</span>
                    </h3>
                    <span className="log-meta">
                      {item.reason} - {item.date}{item.staff ? ` - ${item.staff}` : ''}
                    </span>
                  </div>

                  <div className="manager-row">
                    <span className="price">R{itemCost.toFixed(2)}</span>
                    <button type="button" onClick={() => onDeleteEntry(item.id)} className="delete-button" title={`Delete ${item.name}`}>
                      x
                    </button>
                  </div>
                </div>

                {item.isRecipe && item.ingredients && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-soft)' }}>
                    <h4 className="breakdown-title">Ingredient breakdown</h4>
                    <div className="ingredient-list">
                      {item.ingredients.map((ing, idx) => (
                        <div key={`${ing.name}-${idx}`} className="ingredient-card item-row">
                          <span className="small-text">
                            {ing.name} <span className="badge">{ing.category}</span>
                          </span>
                          <span className="price">R{(Number(ing.cost) || 0).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default WasteList;
