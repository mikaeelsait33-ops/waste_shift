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
  const searchValue = search.trim().toLowerCase();
  const priceRows = useMemo(() => {
    return Object.values(safeCatalog)
      .filter((record) => (
        !searchValue
        || [record.name, record.category, record.unit].some((part) => String(part || '').toLowerCase().includes(searchValue))
      ))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [safeCatalog, searchValue]);
  const pricedCount = priceRows.filter((record) => record.pricingStatus !== 'needs_price').length;
  const needsPriceCount = priceRows.length - pricedCount;

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
      setMessage('Enter an ingredient name.');
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
    setMessage(`${trimmedName} ingredient price saved.`);
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
    if (window.confirm(`Remove the saved raw ingredient price for ${record.name}?`)) {
      onDeleteItemPrice?.(record.key);
      if (editingKey === record.key) {
        resetForm();
      }
      setMessage(`${record.name} ingredient price removed.`);
    }
  };

  return (
    <section className="panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Ingredients</p>
            <h2 className="title">Raw Ingredient Library</h2>
            <p className="subtitle">Set raw ingredient and drink prices from invoices or manual entries. These records do not create menu recipes.</p>
          </div>
          <div className="manager-row">
            <span className="badge">{pricedCount} priced</span>
            {needsPriceCount > 0 && <span className="badge is-yellow">{needsPriceCount} need price</span>}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="item-price-form-grid">
            <div className="field">
              <label htmlFor="item-price-name">Ingredient</label>
              <input
                id="item-price-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Rocket"
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
              {canManagePrices ? (editingKey ? 'Update ingredient price' : 'Save ingredient price') : 'Manager only'}
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
            placeholder="Search raw ingredients"
            className="input"
          />
        </div>

        {searchValue && (
          <div className="search-status" role="status">
            <span>
              <strong>{priceRows.length}</strong> ingredient price{priceRows.length === 1 ? '' : 's'} for <strong>{search.trim()}</strong>
            </span>
            <button type="button" onClick={() => setSearch('')} className="ghost-button compact-action">
              Clear search
            </button>
          </div>
        )}

        {priceRows.length === 0 ? (
          <div className="empty-state">
            {searchValue ? `No raw ingredient prices match "${search.trim()}".` : 'No raw ingredient prices saved yet.'}
          </div>
        ) : (
          <div className="item-price-list">
            {priceRows.map((record) => (
              <div key={record.key} className="item-price-row item-row">
                <div>
                  <strong>{record.name}</strong>
                  <span className="badge">{record.category}</span>
                  {record.pricingStatus === 'needs_price' ? (
                    <span className="badge is-yellow">Needs price</span>
                  ) : (
                    <span className="badge">R{Number(record.price || 0).toFixed(2)} / {record.unit}</span>
                  )}
                  {record.pricingStatus !== 'needs_price' && record.baseUnit && record.baseUnit !== record.unit && (
                    <span className="badge is-green">
                      R{Number(record.costPerBaseUnit || 0).toFixed(4)} / {record.baseUnit}
                    </span>
                  )}
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
