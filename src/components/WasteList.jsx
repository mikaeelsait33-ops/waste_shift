import { useState } from 'react';

function WasteList({ items, onDeleteEntry, onClearAll }) {
  const [activeFilter, setActiveFilter] = useState('All');

  // Filter categorization handler (Includes components inside recipes matching specific toggles)
  const filteredItems = items.filter(item => {
    if (activeFilter === 'All') return true;
    if (item.isRecipe) {
      return item.ingredients.some(ing => ing.category === activeFilter);
    }
    return item.category === activeFilter;
  });

  const filterCategories = ['All', 'Produce', 'Dairy', 'Bakery', 'Meat/Poultry', 'Pantry', 'Other'];

  return (
    <div style={{ maxWidth: '450px', margin: '20px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Logged Items</h3>
        {items.length > 0 && (
          <button onClick={onClearAll} style={{ backgroundColor: '#ff4d4d', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}>
            Clear All
          </button>
        )}
      </div>

      {/* Pill Filter Row */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '10px', marginBottom: '15px' }}>
        {filterCategories.map(cat => (
          <button key={cat} onClick={() => setActiveFilter(cat)} style={{ padding: '4px 10px', borderRadius: '12px', border: '1px solid #333', backgroundColor: activeFilter === cat ? '#4CAF50' : '#222', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {cat}
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#666', fontSize: '0.9rem', marginTop: '20px' }}>No items found under this scope.</p>
      ) : (
        <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
          {filteredItems.map((item) => (
            <li key={item.id} style={{
              backgroundColor: '#1a1a1a',
              borderLeft: `4px solid ${item.isRecipe ? '#ff9800' : '#ff4d4d'}`,
              borderRadius: '4px',
              padding: '12px',
              marginBottom: '10px',
              border: '1px solid #333',
              position: 'relative'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h4 style={{ margin: '0 0 4px 0', textTransform: 'capitalize', fontSize: '1rem' }}>
                    {item.name} 
                    <span style={{ fontSize: '0.75rem', color: '#aaa', marginLeft: '6px' }}>
                      (x{item.quantity})
                    </span>
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#888' }}>
                    Reason: {item.reason} | {item.date}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ backgroundColor: '#2d2d2d', color: '#ff4d4d', padding: '3px 8px', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.85rem' }}>
                    R{item.cost.toFixed(2)}
                  </span>
                  <button onClick={() => onDeleteEntry(item.id)} style={{ backgroundColor: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '1rem' }}>🗑️</button>
                </div>
              </div>

              {/* NEW: Structured Ingredient Sub-Explosion Panel */}
              {item.isRecipe && item.ingredients && (
                <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed #333' }}>
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#ff9800', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>Recipe Cost Breakdown:</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {item.ingredients.map((ing, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', backgroundColor: '#222', padding: '4px 8px', borderRadius: '4px' }}>
                        <span style={{ color: '#ccc' }}>• {ing.name} <code style={{ color: '#888', fontSize: '0.7rem' }}>[{ing.category}]</code></span>
                        <span style={{ color: '#aaa' }}>R{ing.cost.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default WasteList;