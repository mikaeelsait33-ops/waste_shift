import { useState } from 'react';
import DateNavigator from './DateNavigator';
import {
  DEFAULT_WASTE_CLASSIFICATION,
  WASTE_CATEGORY_OPTIONS,
  WASTE_CLASSIFICATION_OPTIONS,
  getEntryFoodCostLost,
  getEntryGrossProfitLost,
  getEntryPotentialRevenueLost,
  getWasteClassificationMeta,
} from '../utils/wasteCalculations';

function WasteList({ items, onDeleteEntry, onRestoreEntry, accessProfile, activeStaffMember }) {
  const [activeFilter, setActiveFilter] = useState('All');
  const [classificationFilter, setClassificationFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState('newest');
  const [viewMode, setViewMode] = useState('day');
  const [deletedEntry, setDeletedEntry] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const safeItems = Array.isArray(items) ? items : [];
  const canViewFinancials = Boolean(accessProfile?.canViewFinancials);
  const formatMoney = (value) => (canViewFinancials ? `R${Number(value || 0).toFixed(2)}` : 'Restricted');
  const visibleItems = canViewFinancials
    ? safeItems
    : safeItems.filter((item) => (
      item?.staffId === activeStaffMember?.id
      || String(item?.staff || '').trim().toLowerCase() === String(activeStaffMember?.name || '').trim().toLowerCase()
    ));

  const parseDate = (dateStr) => {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
    return new Date(dateStr);
  };

  const dateFilteredItems = visibleItems.filter((item) => {
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

  const searchValue = searchTerm.trim().toLowerCase();
  const getItemWasteClassification = (item) => item?.wasteClassification || DEFAULT_WASTE_CLASSIFICATION;

  const itemMatchesCategory = (item, category) => {
    if (category === 'All') return true;
    if (item.isRecipe) return item.ingredients.some((ing) => ing.category === category);
    return item.category === category;
  };

  const classificationFilteredItems = dateFilteredItems.filter((item) => {
    if (classificationFilter === 'All') return true;
    return getItemWasteClassification(item) === classificationFilter;
  });

  const filteredItems = classificationFilteredItems.filter((item) => {
    if (activeFilter === 'All') return true;
    return itemMatchesCategory(item, activeFilter);
  }).filter((item) => {
    if (!searchValue) return true;

    const searchableParts = [
      item?.name,
      item?.reason,
      item?.staff,
      item?.category,
      item?.unit,
      item?.notes,
      getWasteClassificationMeta(getItemWasteClassification(item)).label,
      getWasteClassificationMeta(getItemWasteClassification(item)).shortLabel,
      ...(Array.isArray(item?.ingredients) ? item.ingredients.map((ingredient) => ingredient.name) : []),
    ];

    return searchableParts.some((part) => String(part || '').toLowerCase().includes(searchValue));
  }).sort((a, b) => {
    if (sortMode === 'highestCost') return getEntryFoodCostLost(b) - getEntryFoodCostLost(a);
    if (sortMode === 'name') return String(a?.name || '').localeCompare(String(b?.name || ''));
    return parseDate(b?.date).getTime() - parseDate(a?.date).getTime();
  });

  const totalCost = dateFilteredItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const totalCount = dateFilteredItems.length;
  const filteredCost = filteredItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const hasActiveFilters = activeFilter !== 'All' || classificationFilter !== 'All' || Boolean(searchValue);
  const categoryFilters = [
    { value: 'All', label: 'All' },
    ...WASTE_CATEGORY_OPTIONS,
  ];
  const categoryCounts = categoryFilters.reduce((acc, categoryOption) => {
    acc[categoryOption.value] = classificationFilteredItems.filter((item) => itemMatchesCategory(item, categoryOption.value)).length;
    return acc;
  }, {});
  const classificationFilters = [
    { value: 'All', label: 'All waste' },
    ...WASTE_CLASSIFICATION_OPTIONS.map((classificationOption) => ({
      value: classificationOption.value,
      label: classificationOption.shortLabel,
    })),
  ];
  const unitLabels = {
    each: 'item',
    g: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'L',
    portion: 'portion',
  };

  const formatQuantity = (item) => {
    const itemQuantity = item?.quantity || '1';
    const itemUnit = item?.unit;
    const measuredQuantity = Number(item?.measuredQuantity);
    const measuredUnit = item?.measuredUnit;

    if (!itemUnit) {
      return `x${itemQuantity}`;
    }

    if (itemUnit === 'each') {
      return `${itemQuantity} item${Number(itemQuantity) === 1 ? '' : 's'}`;
    }

    if (itemUnit === 'portion') {
      if (item?.isRecipe) {
        return `${itemQuantity} menu item${Number(itemQuantity) === 1 ? '' : 's'}`;
      }

      const suffix = Number(itemQuantity) === 1 ? 'portion' : 'portions';
      const measuredLabel = Number.isFinite(measuredQuantity) && measuredQuantity > 0 && measuredUnit
        ? ` = ${measuredQuantity.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} ${unitLabels[measuredUnit] || measuredUnit}`
        : '';

      return `${itemQuantity} ${suffix}${measuredLabel}`;
    }

    return `${itemQuantity} ${unitLabels[itemUnit] || itemUnit}`;
  };

  const escapeCsv = (value) => {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  };

  const exportFilteredItems = () => {
    if (!accessProfile?.canExportData) {
      return;
    }

    const headers = [
      'Date',
      'Time',
      'Item',
      'Quantity',
      'Unit',
      'Measured Quantity',
      'Measured Unit',
      'Type',
      'Category',
      'Waste Classification',
      'Department',
      'Reason',
      'Notes',
      'Staff',
      'Food Cost Lost',
      'Selling Price',
      'Potential Revenue Lost',
      'Gross Profit Lost',
      'Food Cost Percentage',
      'Status',
      'Photo Attached',
      'Ingredients',
    ];
    const rows = filteredItems.map((item) => [
      item.date,
      item.time || '',
      item.name,
      item.quantity,
      item.unit || '',
      item.measuredQuantity || '',
      item.measuredUnit || '',
      item.isRecipe ? 'Recipe' : 'Ingredient',
      item.category,
      getWasteClassificationMeta(getItemWasteClassification(item)).label,
      item.department || '',
      item.reason,
      item.notes || '',
      item.staff || '',
      getEntryFoodCostLost(item).toFixed(2),
      item.sellingPrice || '',
      getEntryPotentialRevenueLost(item).toFixed(2),
      getEntryGrossProfitLost(item).toFixed(2),
      item.foodCostPercentage ?? '',
      item.status || '',
      item.photoUrl ? 'Yes' : 'No',
      Array.isArray(item.ingredients)
        ? item.ingredients.map((ingredient) => `${ingredient.name}${ingredient.quantity ? ` ${ingredient.quantity}` : ''} (${ingredient.category})`).join('; ')
        : '',
    ]);

    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wasteshift-log-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleDeleteClick = (item) => {
    if (!accessProfile?.canDeleteEntries) {
      return;
    }

    onDeleteEntry(item.id);
    setDeletedEntry(item);
  };

  const handleUndoDelete = () => {
    if (!deletedEntry) return;
    if (!accessProfile?.canDeleteEntries) return;

    onRestoreEntry?.(deletedEntry);
    setDeletedEntry(null);
  };

  const clearFilters = () => {
    setActiveFilter('All');
    setClassificationFilter('All');
    setSearchTerm('');
  };

  return (
    <section className="list-page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Waste log</p>
          <h2 className="title">Logged Items</h2>
          <p className="subtitle">Review entries by date range and category.</p>
        </div>
      </div>

      <DateNavigator
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      <div className="toolbar">
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search item, staff, reason, note, or ingredient"
          className="input"
        />
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} className="select">
          <option value="newest">Newest first</option>
          <option value="highestCost">Highest cost</option>
          <option value="name">Item name</option>
        </select>
        <select value={classificationFilter} onChange={(e) => setClassificationFilter(e.target.value)} className="select">
          {classificationFilters.map((classificationOption) => (
            <option key={classificationOption.value} value={classificationOption.value}>
              {classificationOption.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={exportFilteredItems} className="ghost-button is-warning" disabled={filteredItems.length === 0 || !accessProfile?.canExportData}>
          {accessProfile?.canExportData ? 'Export CSV' : 'Manager only'}
        </button>
      </div>

      {deletedEntry && (
        <div className="undo-banner" role="status">
          <span>
            Removed <strong>{deletedEntry.name}</strong>
          </span>
          <div className="manager-row">
            <button type="button" onClick={handleUndoDelete} className="ghost-button is-warning">
              {accessProfile?.canDeleteEntries ? 'Undo' : 'Manager only'}
            </button>
            <button type="button" onClick={() => setDeletedEntry(null)} className="ghost-button">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {viewMode !== 'all' && (
        <div className="budget-panel" style={{ marginBottom: '14px' }}>
          <div className="budget-row">
            <span className="small-text">
              <strong>{hasActiveFilters ? filteredItems.length : totalCount}</strong> item{(hasActiveFilters ? filteredItems.length : totalCount) !== 1 ? 's' : ''} shown
            </span>
            <span className="price">{formatMoney(hasActiveFilters ? filteredCost : totalCost)}</span>
          </div>
          {hasActiveFilters && (
            <div className="small-text">
              Scope total: {totalCount} item{totalCount !== 1 ? 's' : ''} worth {formatMoney(totalCost)}
            </div>
          )}
        </div>
      )}

      <div className="filter-row" aria-label="Waste category filter">
        {categoryFilters.map((categoryOption) => (
          <button
            key={categoryOption.value}
            type="button"
            onClick={() => setActiveFilter(categoryOption.value)}
            className={`pill-button${activeFilter === categoryOption.value ? ' is-active' : ''}`}
          >
            {categoryOption.label}
            <span className="pill-count">{categoryCounts[categoryOption.value] || 0}</span>
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div className="empty-state">
          <p style={{ margin: 0 }}>
            {searchValue
              ? 'No items match your search.'
              : viewMode === 'all'
              ? 'No items found under this scope.'
              : viewMode === 'day'
                ? 'No waste was logged on this day.'
                : 'No waste was logged this month.'}
          </p>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className="ghost-button compact-action">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <ul className="log-list">
          {filteredItems.map((item) => {
            const itemCost = getEntryFoodCostLost(item);
            const revenueLost = getEntryPotentialRevenueLost(item);
            const grossProfitLost = getEntryGrossProfitLost(item);
            const classificationMeta = getWasteClassificationMeta(getItemWasteClassification(item));

            return (
              <li key={item.id} className={`log-card ${item.isRecipe ? 'is-recipe' : 'is-single'}`}>
                <div className="item-row">
                  <div>
                    <h3 className="log-title">
                      {item.name}
                      <span className="small-text"> {formatQuantity(item)}</span>
                    </h3>
                    <span className="log-meta">
                      {item.reason} - {item.date}{item.time ? ` ${item.time}` : ''}{item.staff ? ` - ${item.staff}` : ''}
                    </span>
                    <span className={`badge waste-type-badge waste-type-badge--${classificationMeta.value}`}>
                      {classificationMeta.shortLabel}
                    </span>
                    {item.notes && (
                      <p className="log-note">{item.notes}</p>
                    )}
                  </div>

                  <div className="manager-row">
                    <span className="price">{formatMoney(itemCost)}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(item)}
                      className="delete-button"
                      title={`Delete ${item.name}`}
                      disabled={!accessProfile?.canDeleteEntries}
                    >
                      x
                    </button>
                  </div>
                </div>

                {item.isRecipe && (
                  <div className="import-summary-grid log-financials">
                    <span className="badge">Food cost {formatMoney(itemCost)}</span>
                    <span className="badge">Revenue {formatMoney(revenueLost)}</span>
                    <span className={canViewFinancials && grossProfitLost > 0 ? 'badge is-red' : 'badge'}>Gross {formatMoney(grossProfitLost)}</span>
                    {item.foodCostPercentage !== null && item.foodCostPercentage !== undefined && (
                      <span className="badge">{Number(item.foodCostPercentage).toFixed(1)}% food cost</span>
                    )}
                    {item.costStatus === 'needs_ingredient_costs' && <span className="badge is-red">Needs ingredient costs</span>}
                  </div>
                )}

                {item.photoUrl && (
                  <a
                    href={item.photoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="log-photo-link"
                    aria-label={`View full waste photo for ${item.name}`}
                  >
                    <img src={item.photoUrl} alt={`Waste photo for ${item.name}`} className="log-photo" />
                    <span className="small-text">{item.photoName || 'Waste photo'}</span>
                  </a>
                )}

                {item.isRecipe && item.ingredients && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-soft)' }}>
                    <h4 className="breakdown-title">Ingredient breakdown</h4>
                    <div className="ingredient-list">
                      {item.ingredients.map((ing, idx) => (
                        <div key={`${ing.name}-${idx}`} className="ingredient-card item-row">
                          <span className="small-text">
                            {ing.name}
                            {ing.quantity && <span className="badge">{ing.quantity}</span>}
                            <span className="badge">{ing.category}</span>
                          </span>
                          <span className="price">{formatMoney(Number(ing.cost) || 0)}</span>
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
