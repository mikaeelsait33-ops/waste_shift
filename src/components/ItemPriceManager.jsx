import { useMemo, useState } from 'react';
import { WASTE_CATEGORY_OPTIONS } from '../utils/wasteCalculations';
import {
  PRICE_UNIT_OPTIONS,
  createItemPriceKey,
  sanitizeItemPriceCatalog,
} from '../utils/itemPriceCatalog';

function ItemPriceManager({
  itemPriceCatalog,
  accessProfile,
  onSaveItemPrice,
  onDeleteItemPrice,
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Produce');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('each');
  const [editingKey, setEditingKey] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const canManagePrices = Boolean(accessProfile?.canManageMenu);
  const safeCatalog = useMemo(() => sanitizeItemPriceCatalog(itemPriceCatalog), [itemPriceCatalog]);
  const priceRows = useMemo(() => {
    const searchValue = search.trim().toLowerCase();

    return Object.values(safeCatalog)
      .filter((record) => (
        !searchValue
        || [record.name, record.category, record.unit].some((part) => String(part || '').toLowerCase().includes(searchValue))
      ))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [safeCatalog, search]);

  const resetForm = () => {
    setName('');
    setCategory('Produce');
    setPrice('');
    setUnit('each');
    setEditingKey('');
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const trimmedName = name.trim();
    const parsedPrice = Number.parseFloat(price);

    if (!trimmedName) {
      setMessage('Enter an item name.');
      return;
    }

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setMessage('Enter a valid price.');
      return;
    }

    onSaveItemPrice?.({
      key: editingKey || createItemPriceKey(trimmedName),
      name: trimmedName,
      category,
      price: parsedPrice,
      unit,
    });
    setMessage(`${trimmedName} price saved.`);
    resetForm();
  };

  const handleEdit = (record) => {
    setName(record.name);
    setCategory(record.category || 'Produce');
    setPrice(String(record.price ?? ''));
    setUnit(record.unit || 'each');
    setEditingKey(record.key);
    setMessage(`Editing ${record.name}.`);
  };

  const handleDelete = (record) => {
    if (window.confirm(`Remove the saved price for ${record.name}?`)) {
      onDeleteItemPrice?.(record.key);
      if (editingKey === record.key) {
        resetForm();
      }
      setMessage(`${record.name} price removed.`);
    }
  };

  return (
    <section className="panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Item pricing</p>
            <h2 className="title">Waste Item Prices</h2>
            <p className="subtitle">Set ingredient and drink prices so staff entries calculate waste cost automatically.</p>
          </div>
          <span className="badge">{priceRows.length} priced</span>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="item-price-form-grid">
            <div className="field">
              <label htmlFor="item-price-name">Item</label>
              <input
                id="item-price-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Tomato"
                className="input"
              />
            </div>

            <div className="field">
              <label htmlFor="item-price-category">Category</label>
              <select id="item-price-category" value={category} onChange={(event) => setCategory(event.target.value)} className="select">
                {WASTE_CATEGORY_OPTIONS.map((categoryOption) => (
                  <option key={categoryOption.value} value={categoryOption.value}>
                    {categoryOption.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="item-price-value">Price</label>
              <input
                id="item-price-value"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="R"
                className="input"
              />
            </div>

            <div className="field">
              <label htmlFor="item-price-unit">Per</label>
              <select id="item-price-unit" value={unit} onChange={(event) => setUnit(event.target.value)} className="select">
                {PRICE_UNIT_OPTIONS.map((unitOption) => (
                  <option key={unitOption.value} value={unitOption.value}>
                    {unitOption.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="manager-row">
            <button type="submit" className="primary-button item-price-primary-action" disabled={!canManagePrices}>
              {canManagePrices ? (editingKey ? 'Update price' : 'Save price') : 'Manager only'}
            </button>
            {editingKey && (
              <button type="button" onClick={resetForm} className="ghost-button">
                Cancel edit
              </button>
            )}
          </div>
        </form>

        {message && (
          <div className="empty-state" style={{ marginTop: '14px', padding: '14px' }}>
            {message}
          </div>
        )}

        <div className="toolbar toolbar--single">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search item prices"
            className="input"
          />
        </div>

        {priceRows.length === 0 ? (
          <div className="empty-state">
            {search ? 'No item prices match your search.' : 'No item prices saved yet.'}
          </div>
        ) : (
          <div className="item-price-list">
            {priceRows.map((record) => (
              <div key={record.key} className="item-price-row item-row">
                <div>
                  <strong>{record.name}</strong>
                  <span className="badge">{record.category}</span>
                  <span className="badge">R{Number(record.price || 0).toFixed(2)} / {record.unit}</span>
                </div>
                <div className="manager-row">
                  <button type="button" onClick={() => handleEdit(record)} className="ghost-button compact-action" disabled={!canManagePrices}>
                    Edit
                  </button>
                  <button type="button" onClick={() => handleDelete(record)} className="delete-button" title={`Remove ${record.name}`} disabled={!canManagePrices}>
                    x
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default ItemPriceManager;
