import { useEffect, useMemo, useState } from 'react';
import { WASTE_CATEGORY_OPTIONS } from '../utils/wasteCalculations';
import { PRICE_UNIT_OPTIONS, sanitizeItemPriceCatalog } from '../utils/itemPriceCatalog';

const STORE_ROOM_CATEGORIES = [
  ...WASTE_CATEGORY_OPTIONS,
  { value: 'Packaging', label: 'Packaging' },
  { value: 'Cleaning', label: 'Cleaning Supplies' },
  { value: 'Dry Store', label: 'Dry Store' },
];

const STORE_ROOM_UNITS = [
  ...PRICE_UNIT_OPTIONS,
  { value: 'box', label: 'box' },
  { value: 'case', label: 'case' },
  { value: 'bag', label: 'bag' },
  { value: 'bottle', label: 'bottle' },
  { value: 'tray', label: 'tray' },
];

const MOVEMENT_REASONS = [
  'Delivery received',
  'Prep issued',
  'Kitchen issued',
  'Bar issued',
  'Count correction',
  'Supplier return',
  'Damaged stock',
  'Other',
];

const formatNumber = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '0';
  }

  return Number.isInteger(numericValue)
    ? String(numericValue)
    : numericValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

const formatQuantity = (item) => `${formatNumber(item?.quantity)} ${item?.unit || ''}`.trim();

const formatDateTime = (value) => {
  if (!value) {
    return 'Not recorded';
  }

  return new Date(value).toLocaleString();
};

function StoreRoom({
  storeRoomItems,
  storeRoomMovements,
  itemPriceCatalog,
  accessProfile,
  onSaveStoreRoomItem,
  onRecordStoreRoomMovement,
  onDeleteStoreRoomItem,
}) {
  const [search, setSearch] = useState('');
  const [editingItemId, setEditingItemId] = useState('');
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('Dry Store');
  const [unit, setUnit] = useState('each');
  const [location, setLocation] = useState('');
  const [quantity, setQuantity] = useState('0');
  const [parLevel, setParLevel] = useState('');
  const [itemNotes, setItemNotes] = useState('');
  const [movementItemId, setMovementItemId] = useState('');
  const [movementType, setMovementType] = useState('stock_in');
  const [movementQuantity, setMovementQuantity] = useState('');
  const [movementReason, setMovementReason] = useState('Delivery received');
  const [movementNotes, setMovementNotes] = useState('');
  const [message, setMessage] = useState('');

  const safeItems = useMemo(() => (
    Array.isArray(storeRoomItems) ? storeRoomItems : []
  ), [storeRoomItems]);
  const safeMovements = useMemo(() => (
    Array.isArray(storeRoomMovements) ? storeRoomMovements : []
  ), [storeRoomMovements]);
  const safeItemPriceCatalog = useMemo(() => sanitizeItemPriceCatalog(itemPriceCatalog), [itemPriceCatalog]);
  const itemNameOptions = useMemo(() => (
    Array.from(new Set([
      ...Object.values(safeItemPriceCatalog).map((record) => record.name),
      ...safeItems.map((item) => item.name),
    ])).sort((a, b) => a.localeCompare(b))
  ), [safeItemPriceCatalog, safeItems]);
  const searchValue = search.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    if (!searchValue) {
      return safeItems;
    }

    return safeItems.filter((item) => [
      item.name,
      item.category,
      item.location,
      item.unit,
      item.notes,
    ].some((part) => String(part || '').toLowerCase().includes(searchValue)));
  }, [safeItems, searchValue]);
  const lowStockItems = safeItems.filter((item) => Number(item.parLevel) > 0 && Number(item.quantity) <= Number(item.parLevel));
  const recentMovements = safeMovements.slice(0, 80);
  const selectedMovementItem = safeItems.find((item) => item.id === movementItemId);
  const canManageStoreRoom = Boolean(accessProfile?.canManageStoreRoom);

  useEffect(() => {
    if (!movementItemId && safeItems[0]) {
      setMovementItemId(safeItems[0].id);
    }
  }, [movementItemId, safeItems]);

  const resetItemForm = () => {
    setEditingItemId('');
    setItemName('');
    setCategory('Dry Store');
    setUnit('each');
    setLocation('');
    setQuantity('0');
    setParLevel('');
    setItemNotes('');
  };

  const handleEditItem = (item) => {
    setEditingItemId(item.id);
    setItemName(item.name);
    setCategory(item.category || 'Dry Store');
    setUnit(item.unit || 'each');
    setLocation(item.location || '');
    setQuantity(String(item.quantity ?? 0));
    setParLevel(item.parLevel ? String(item.parLevel) : '');
    setItemNotes(item.notes || '');
    setMessage(`Editing ${item.name}.`);
  };

  const handleQuickMovement = (item, type) => {
    setMovementItemId(item.id);
    setMovementType(type);
    setMovementQuantity('');
    setMovementReason(type === 'stock_in' ? 'Delivery received' : 'Kitchen issued');
    setMessage(`${type === 'stock_in' ? 'Putting stock into' : 'Removing stock from'} ${item.name}.`);
  };

  const handleItemSubmit = (event) => {
    event.preventDefault();

    const result = onSaveStoreRoomItem?.({
      id: editingItemId,
      name: itemName,
      category,
      unit,
      location,
      quantity,
      parLevel,
      notes: itemNotes,
    });

    if (!result?.ok) {
      setMessage(result?.message || 'Could not save this stock item.');
      return;
    }

    setMessage(result.message);
    resetItemForm();
  };

  const handleMovementSubmit = (event) => {
    event.preventDefault();

    const result = onRecordStoreRoomMovement?.({
      itemId: movementItemId,
      type: movementType,
      quantity: movementQuantity,
      reason: movementReason,
      notes: movementNotes,
    });

    if (!result?.ok) {
      setMessage(result?.message || 'Could not record this stock movement.');
      return;
    }

    setMovementQuantity('');
    setMovementNotes('');
    setMessage(result.message);
  };

  const handleDeleteItem = (item) => {
    if (!window.confirm(`Remove ${item.name} from the store room? Movement history will stay saved.`)) {
      return;
    }

    const result = onDeleteStoreRoomItem?.(item.id);

    if (!result?.ok) {
      setMessage(result?.message || 'Could not remove this stock item.');
      return;
    }

    if (movementItemId === item.id) {
      setMovementItemId('');
    }

    if (editingItemId === item.id) {
      resetItemForm();
    }

    setMessage(result.message);
  };

  return (
    <section className="store-room-page inventory-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Store room</p>
          <h2 className="title">Stock Control</h2>
          <p className="subtitle">Track what is in storage and every stock movement in or out.</p>
        </div>
        <span className={`badge${lowStockItems.length > 0 ? ' is-red' : ' is-green'}`}>
          {lowStockItems.length > 0 ? `${lowStockItems.length} low` : 'Stock steady'}
        </span>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-value">{safeItems.length}</span>
          <span className="metric-label">Tracked items</span>
        </div>
        <div className="metric-card">
          <span className={`metric-value${lowStockItems.length > 0 ? ' is-danger' : ''}`}>{lowStockItems.length}</span>
          <span className="metric-label">At or below par</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{safeMovements.length}</span>
          <span className="metric-label">Stock movements</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{recentMovements[0]?.staffName || 'None'}</span>
          <span className="metric-label">Last stock handler</span>
        </div>
      </div>

      <div className="store-room-actions">
        <form onSubmit={handleItemSubmit} className="panel">
          <div className="panel-body">
            <div className="section-header">
              <div>
                <p className="eyebrow">Stock item</p>
                <h2 className="title">{editingItemId ? 'Edit Item' : 'Add Item'}</h2>
              </div>
              {editingItemId && (
                <button type="button" onClick={resetItemForm} className="ghost-button">
                  Cancel
                </button>
              )}
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="store-item-name">Item name</label>
                <input
                  id="store-item-name"
                  value={itemName}
                  onChange={(event) => setItemName(event.target.value)}
                  list="store-room-item-options"
                  className="input"
                  disabled={!canManageStoreRoom}
                />
                {itemNameOptions.length > 0 && (
                  <datalist id="store-room-item-options">
                    {itemNameOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                )}
              </div>

              <div className="field">
                <label htmlFor="store-item-category">Category</label>
                <select
                  id="store-item-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="select"
                  disabled={!canManageStoreRoom}
                >
                  {STORE_ROOM_CATEGORIES.map((categoryOption) => (
                    <option key={categoryOption.value} value={categoryOption.value}>
                      {categoryOption.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field-grid field-grid--three">
              <div className="field">
                <label htmlFor="store-item-quantity">Current quantity</label>
                <input
                  id="store-item-quantity"
                  type="number"
                  min="0"
                  step="0.001"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="input"
                  disabled={!canManageStoreRoom}
                />
              </div>

              <div className="field">
                <label htmlFor="store-item-unit">Unit</label>
                <select
                  id="store-item-unit"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  className="select"
                  disabled={!canManageStoreRoom}
                >
                  {STORE_ROOM_UNITS.map((unitOption) => (
                    <option key={unitOption.value} value={unitOption.value}>
                      {unitOption.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="store-item-par">Par level</label>
                <input
                  id="store-item-par"
                  type="number"
                  min="0"
                  step="0.001"
                  value={parLevel}
                  onChange={(event) => setParLevel(event.target.value)}
                  placeholder="Optional"
                  className="input"
                  disabled={!canManageStoreRoom}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="store-item-location">Location</label>
              <input
                id="store-item-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="e.g. Dry shelf A, cold room"
                className="input"
                disabled={!canManageStoreRoom}
              />
            </div>

            <div className="field">
              <label htmlFor="store-item-notes">Notes</label>
              <textarea
                id="store-item-notes"
                value={itemNotes}
                onChange={(event) => setItemNotes(event.target.value)}
                maxLength={180}
                className="input note-textarea"
                disabled={!canManageStoreRoom}
              />
            </div>

            <button type="submit" className="primary-button" disabled={!canManageStoreRoom}>
              {canManageStoreRoom ? (editingItemId ? 'Update item' : 'Save item') : 'Manager only'}
            </button>
          </div>
        </form>

        <form onSubmit={handleMovementSubmit} className="panel">
          <div className="panel-body">
            <div className="section-header">
              <div>
                <p className="eyebrow">Movement</p>
                <h2 className="title">Put In / Remove</h2>
              </div>
              {selectedMovementItem && <span className="badge">{formatQuantity(selectedMovementItem)}</span>}
            </div>

            <div className="field">
              <label htmlFor="store-movement-item">Stock item</label>
              <select
                id="store-movement-item"
                value={movementItemId}
                onChange={(event) => setMovementItemId(event.target.value)}
                className="select"
                disabled={!canManageStoreRoom || safeItems.length === 0}
              >
                <option value="">Choose item</option>
                {safeItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} - {formatQuantity(item)}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <span className="field-label">Movement type</span>
              <div className="segmented-control" aria-label="Store room movement type">
                <button
                  type="button"
                  onClick={() => {
                    setMovementType('stock_in');
                    setMovementReason('Delivery received');
                  }}
                  className={`segment-button${movementType === 'stock_in' ? ' is-active' : ''}`}
                  disabled={!canManageStoreRoom}
                >
                  Put in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMovementType('stock_out');
                    setMovementReason('Kitchen issued');
                  }}
                  className={`segment-button${movementType === 'stock_out' ? ' is-active' : ''}`}
                  disabled={!canManageStoreRoom}
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="store-movement-quantity">Quantity</label>
                <input
                  id="store-movement-quantity"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={movementQuantity}
                  onChange={(event) => setMovementQuantity(event.target.value)}
                  className="input"
                  disabled={!canManageStoreRoom || safeItems.length === 0}
                />
              </div>

              <div className="field">
                <label htmlFor="store-movement-reason">Reason</label>
                <select
                  id="store-movement-reason"
                  value={movementReason}
                  onChange={(event) => setMovementReason(event.target.value)}
                  className="select"
                  disabled={!canManageStoreRoom || safeItems.length === 0}
                >
                  {MOVEMENT_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="store-movement-notes">Notes</label>
              <textarea
                id="store-movement-notes"
                value={movementNotes}
                onChange={(event) => setMovementNotes(event.target.value)}
                maxLength={160}
                className="input note-textarea"
                disabled={!canManageStoreRoom || safeItems.length === 0}
              />
            </div>

            <button type="submit" className="primary-button" disabled={!canManageStoreRoom || safeItems.length === 0}>
              {movementType === 'stock_in' ? 'Put stock in' : 'Remove stock'}
            </button>
          </div>
        </form>
      </div>

      {message && (
        <div className="inline-message" role="status">
          {message}
        </div>
      )}

      <div className="panel">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">On hand</p>
              <h2 className="title">Current Stock</h2>
            </div>
            <span className="badge">{filteredItems.length} shown</span>
          </div>

          <div className="toolbar toolbar--single">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search item, category, location, or notes"
              className="input"
            />
          </div>

          {safeItems.length === 0 ? (
            <div className="empty-state">No store room stock items yet.</div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state">No stock items match the current search.</div>
          ) : (
            <div className="stock-grid">
              {filteredItems.map((item) => {
                const isLow = Number(item.parLevel) > 0 && Number(item.quantity) <= Number(item.parLevel);

                return (
                  <div key={item.id} className={`inventory-card stock-card${isLow ? ' is-low-stock' : ''}`}>
                    <div className="inventory-heading">
                      <div>
                        <h3 className="inventory-title">{item.name}</h3>
                        <span className="small-text">{item.category}{item.location ? ` - ${item.location}` : ''}</span>
                      </div>
                      <span className={`price${isLow ? ' is-total' : ''}`}>{formatQuantity(item)}</span>
                    </div>

                    <div className="notice-list">
                      <span className={`badge${isLow ? ' is-red' : ' is-green'}`}>
                        {item.parLevel > 0 ? `Par ${formatNumber(item.parLevel)} ${item.unit}` : 'No par'}
                      </span>
                      {item.lastMovementAt && <span className="badge">Moved {formatDateTime(item.lastMovementAt)}</span>}
                    </div>

                    {item.notes && <p className="small-text stock-card-note">{item.notes}</p>}

                    <div className="manager-row stock-card-actions">
                      <button type="button" onClick={() => handleQuickMovement(item, 'stock_in')} className="ghost-button compact-action" disabled={!canManageStoreRoom}>
                        Put in
                      </button>
                      <button type="button" onClick={() => handleQuickMovement(item, 'stock_out')} className="ghost-button compact-action" disabled={!canManageStoreRoom}>
                        Remove
                      </button>
                      <button type="button" onClick={() => handleEditItem(item)} className="ghost-button compact-action" disabled={!canManageStoreRoom}>
                        Edit
                      </button>
                      <button type="button" onClick={() => handleDeleteItem(item)} className="delete-button" title={`Remove ${item.name}`} disabled={!canManageStoreRoom}>
                        x
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Ledger</p>
              <h2 className="title">Movement History</h2>
            </div>
            <span className="badge">{safeMovements.length} total</span>
          </div>

          {recentMovements.length === 0 ? (
            <div className="empty-state">No store room movements recorded yet.</div>
          ) : (
            <div className="stock-movement-list">
              {recentMovements.map((movement) => (
                <div key={movement.id} className="stock-movement-row">
                  <div>
                    <strong>{movement.itemName}</strong>
                    <span className="small-text">
                      {formatDateTime(movement.createdAt)} - {movement.staffName}
                    </span>
                  </div>
                  <span className={`badge${movement.type === 'stock_out' ? ' is-red' : ' is-green'}`}>
                    {movement.type === 'stock_out' ? '-' : '+'}{formatNumber(movement.quantity)} {movement.unit}
                  </span>
                  <span className="small-text">{movement.reason || 'Movement'}</span>
                  <span className="small-text">
                    {formatNumber(movement.previousQuantity)} to {formatNumber(movement.nextQuantity)} {movement.unit}
                  </span>
                  {movement.notes && <span className="small-text">{movement.notes}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default StoreRoom;
