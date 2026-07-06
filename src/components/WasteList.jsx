import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_WASTE_CLASSIFICATION,
  WASTE_CATEGORY_OPTIONS,
  WASTE_CLASSIFICATION_OPTIONS,
  getEntryFoodCostLost,
  getEntryGrossProfitLost,
  getEntryPotentialRevenueLost,
  getWasteClassificationMeta,
} from '../utils/wasteCalculations';
import {
  getActiveWasteEntries,
  getVoidedWasteEntries,
  getWasteEntrySyncStatus,
  isWasteEntryVoided,
  wasteEntryNeedsCostReview,
} from '../utils/wasteSync';
import { DEFAULT_PAGE_SIZE, getVisiblePage } from '../utils/listPerformance';

const getWeekStart = (date) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const day = value.getDay();
  value.setDate(value.getDate() - (day === 0 ? 6 : day - 1));
  return value;
};

function WasteList({ items, onDeleteEntry, onRestoreEntry, accessProfile, activeStaffMember }) {
  const [activeFilter, setActiveFilter] = useState('All');
  const [classificationFilter, setClassificationFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState('newest');
  const [syncFilter, setSyncFilter] = useState('All');
  const [costReviewFilter, setCostReviewFilter] = useState('All');
  const [entryStatusFilter, setEntryStatusFilter] = useState('active');
  const [visibleLimit, setVisibleLimit] = useState(DEFAULT_PAGE_SIZE);
  const [dateRangeFilter, setDateRangeFilter] = useState('today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [deletedEntry, setDeletedEntry] = useState(null);
  const safeItems = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const canViewFinancials = Boolean(accessProfile?.canViewFinancials);
  const formatMoney = (value) => (canViewFinancials ? `R${Number(value || 0).toFixed(2)}` : 'Restricted');
  const statusScopedItems = useMemo(() => {
    if (entryStatusFilter === 'voided' && accessProfile?.canDeleteEntries) {
      return getVoidedWasteEntries(safeItems);
    }

    if (entryStatusFilter === 'all' && accessProfile?.canDeleteEntries) {
      return safeItems;
    }

    return getActiveWasteEntries(safeItems);
  }, [accessProfile?.canDeleteEntries, entryStatusFilter, safeItems]);
  const visibleItems = useMemo(() => (canViewFinancials
    ? statusScopedItems
    : getActiveWasteEntries(statusScopedItems).filter((item) => (
      item?.staffId === activeStaffMember?.id
      || String(item?.staff || '').trim().toLowerCase() === String(activeStaffMember?.name || '').trim().toLowerCase()
    ))), [activeStaffMember?.id, activeStaffMember?.name, canViewFinancials, statusScopedItems]);

  const parseDate = (dateStr) => {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
    return new Date(dateStr);
  };

  const dateRangeBounds = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (dateRangeFilter === 'all') {
      return null;
    }

    if (dateRangeFilter === 'yesterday') {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { start: yesterday, end: today };
    }

    if (dateRangeFilter === 'week') {
      return { start: getWeekStart(today), end: tomorrow };
    }

    if (dateRangeFilter === 'month') {
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: tomorrow };
    }

    if (dateRangeFilter === 'custom') {
      const start = customStartDate ? new Date(`${customStartDate}T00:00:00`) : null;
      const end = customEndDate ? new Date(`${customEndDate}T23:59:59`) : null;
      return { start, end };
    }

    return { start: today, end: tomorrow };
  }, [customEndDate, customStartDate, dateRangeFilter]);

  const dateFilteredItems = useMemo(() => visibleItems.filter((item) => {
    const bounds = dateRangeBounds;

    if (!bounds) return true;

    const itemDate = parseDate(item?.date);

    if (bounds.start && itemDate < bounds.start) return false;
    if (bounds.end && itemDate > bounds.end) return false;
    return true;
  }), [dateRangeBounds, visibleItems]);

  const searchValue = searchTerm.trim().toLowerCase();
  const getItemWasteClassification = (item) => item?.wasteClassification || DEFAULT_WASTE_CLASSIFICATION;

  const itemMatchesCategory = (item, category) => {
    if (category === 'All') return true;
    if (item.isRecipe) return Array.isArray(item.ingredients) && item.ingredients.some((ing) => ing.category === category);
    return item.category === category;
  };

  const classificationFilteredItems = useMemo(() => dateFilteredItems.filter((item) => {
    if (classificationFilter === 'All') return true;
    return getItemWasteClassification(item) === classificationFilter;
  }), [classificationFilter, dateFilteredItems]);

  const filteredItems = useMemo(() => classificationFilteredItems.filter((item) => {
    if (activeFilter === 'All') return true;
    return itemMatchesCategory(item, activeFilter);
  }).filter((item) => {
    if (syncFilter === 'All') return true;
    return getWasteEntrySyncStatus(item) === syncFilter;
  }).filter((item) => {
    if (costReviewFilter === 'All') return true;
    return costReviewFilter === 'needsReview' ? wasteEntryNeedsCostReview(item) : !wasteEntryNeedsCostReview(item);
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
      ...(Array.isArray(item?.wastedComponents) ? item.wastedComponents.map((component) => component.name) : []),
      ...(Array.isArray(item?.componentsWasted) ? item.componentsWasted : []),
      ...(Array.isArray(item?.ingredients) ? item.ingredients.map((ingredient) => ingredient.name) : []),
    ];

    return searchableParts.some((part) => String(part || '').toLowerCase().includes(searchValue));
  }).sort((a, b) => {
    if (sortMode === 'highestCost') return getEntryFoodCostLost(b) - getEntryFoodCostLost(a);
    if (sortMode === 'name') return String(a?.name || '').localeCompare(String(b?.name || ''));
    return parseDate(b?.date).getTime() - parseDate(a?.date).getTime();
  }), [activeFilter, classificationFilteredItems, costReviewFilter, searchValue, sortMode, syncFilter]);
  const visiblePage = useMemo(() => getVisiblePage(filteredItems, { limit: visibleLimit }), [filteredItems, visibleLimit]);
  const visibleFilteredItems = visiblePage.records;

  useEffect(() => {
    setVisibleLimit(DEFAULT_PAGE_SIZE);
  }, [activeFilter, classificationFilter, costReviewFilter, dateRangeFilter, entryStatusFilter, searchValue, sortMode, syncFilter]);

  const totalCost = dateFilteredItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const totalCount = dateFilteredItems.length;
  const filteredCost = filteredItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const hasActiveFilters = activeFilter !== 'All' || classificationFilter !== 'All' || syncFilter !== 'All' || costReviewFilter !== 'All' || dateRangeFilter !== 'all' || Boolean(searchValue);
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
      'Partial Waste',
      'Wasted Components',
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
      item.partialWaste ? 'Yes' : 'No',
      Array.isArray(item.wastedComponents)
        ? item.wastedComponents.map((component) => component.name).join('; ')
        : Array.isArray(item.componentsWasted)
          ? item.componentsWasted.join('; ')
          : '',
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

  const handleDeleteClick = async (item) => {
    if (!accessProfile?.canDeleteEntries) {
      return;
    }

    const voidReason = window.prompt('Why is this waste entry being voided?', 'Manager correction');
    if (voidReason === null) {
      return;
    }

    const result = await onDeleteEntry(item.id, voidReason);
    setDeletedEntry(result?.entry || { ...item, status: 'voided', voidReason });
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
    setSyncFilter('All');
    setCostReviewFilter('All');
    setDateRangeFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSearchTerm('');
  };

  return (
    <section className="list-page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Waste log</p>
          <h2 className="title">Waste Log</h2>
          <p className="subtitle">Review today, old entries, and manager-only void history.</p>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search item, staff, reason, note, or ingredient"
          className="input"
        />
        <select value={dateRangeFilter} onChange={(e) => setDateRangeFilter(e.target.value)} className="select">
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="custom">Custom range</option>
          <option value="all">All time</option>
        </select>
        {dateRangeFilter === 'custom' && (
          <>
            <input
              type="date"
              value={customStartDate}
              onChange={(event) => setCustomStartDate(event.target.value)}
              className="input"
              aria-label="Waste log start date"
            />
            <input
              type="date"
              value={customEndDate}
              onChange={(event) => setCustomEndDate(event.target.value)}
              className="input"
              aria-label="Waste log end date"
            />
          </>
        )}
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
        <select value={syncFilter} onChange={(e) => setSyncFilter(e.target.value)} className="select">
          <option value="All">All sync</option>
          <option value="synced">Synced</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="local">Local</option>
        </select>
        <select value={costReviewFilter} onChange={(e) => setCostReviewFilter(e.target.value)} className="select">
          <option value="All">All costs</option>
          <option value="needsReview">Needs cost review</option>
          <option value="complete">Cost complete</option>
        </select>
        {accessProfile?.canDeleteEntries && (
          <select value={entryStatusFilter} onChange={(e) => setEntryStatusFilter(e.target.value)} className="select">
            <option value="active">Active entries</option>
            <option value="voided">Voided entries</option>
            <option value="all">Active + voided</option>
          </select>
        )}
        <button type="button" onClick={exportFilteredItems} className="ghost-button is-warning" disabled={filteredItems.length === 0 || !accessProfile?.canExportData}>
          {accessProfile?.canExportData ? 'Export CSV' : 'Manager only'}
        </button>
      </div>

      {searchValue && (
        <div className="search-status" role="status">
          <span>
            <strong>{filteredItems.length}</strong> result{filteredItems.length === 1 ? '' : 's'} for <strong>{searchTerm.trim()}</strong>
          </span>
          <button type="button" onClick={() => setSearchTerm('')} className="ghost-button compact-action">
            Clear search
          </button>
        </div>
      )}

      {deletedEntry && (
        <div className="undo-banner" role="status">
          <span>
            Voided <strong>{deletedEntry.name}</strong>
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
              <strong>{visiblePage.visibleCount}</strong> of <strong>{hasActiveFilters ? filteredItems.length : totalCount}</strong> item{(hasActiveFilters ? filteredItems.length : totalCount) !== 1 ? 's' : ''} shown
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
              ? entryStatusFilter === 'voided' ? 'No voided entries found under this scope.' : 'No items found under this scope.'
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
          {visibleFilteredItems.map((item) => {
            const itemCost = getEntryFoodCostLost(item);
            const revenueLost = getEntryPotentialRevenueLost(item);
            const grossProfitLost = getEntryGrossProfitLost(item);
            const classificationMeta = getWasteClassificationMeta(getItemWasteClassification(item));
            const wastedComponentNames = Array.isArray(item.wastedComponents)
              ? item.wastedComponents.map((component) => component.name).filter(Boolean)
              : Array.isArray(item.componentsWasted)
                ? item.componentsWasted.filter(Boolean)
                : [];

            return (
              <li key={item.id} className={`log-card ${item.isRecipe ? 'is-recipe' : 'is-single'}${isWasteEntryVoided(item) ? ' is-voided' : ''}`}>
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
                    {item.costStatus === 'needs_item_price' && (
                      <span className="badge is-red cost-status-badge">Needs price</span>
                    )}
                    <span className={getWasteEntrySyncStatus(item) === 'synced' ? 'badge is-green cost-status-badge' : 'badge cost-status-badge'}>
                      {getWasteEntrySyncStatus(item)}
                    </span>
                    {isWasteEntryVoided(item) && (
                      <span className="badge is-red cost-status-badge">
                        Voided{item.voidedAt ? ` ${new Date(item.voidedAt).toLocaleDateString()}` : ''}
                      </span>
                    )}
                    {item.partialWaste && (
                      <span className="badge is-green cost-status-badge">
                        Partial: {item.wastedComponentCount || wastedComponentNames.length}/{item.totalComponentCount || item.ingredients?.length || '?'}
                      </span>
                    )}
                    {item.notes && (
                      <p className="log-note">{item.notes}</p>
                    )}
                    {wastedComponentNames.length > 0 && (
                      <p className="log-note">
                        Components wasted: {wastedComponentNames.join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="manager-row">
                    <span className="price">{formatMoney(itemCost)}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(item)}
                      className="delete-button"
                      title={`Void ${item.name}`}
                      disabled={!accessProfile?.canDeleteEntries || isWasteEntryVoided(item)}
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
                    <h4 className="breakdown-title">{item.partialWaste ? 'Wasted components' : 'Ingredient breakdown'}</h4>
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

      {visiblePage.hasMore && (
        <div className="load-more-row">
          <button
            type="button"
            className="ghost-button is-warning"
            onClick={() => setVisibleLimit(visiblePage.nextLimit)}
          >
            Load more entries
          </button>
          <span className="small-text">
            Showing {visiblePage.visibleCount} of {visiblePage.totalCount}
          </span>
        </div>
      )}
    </section>
  );
}

export default WasteList;
