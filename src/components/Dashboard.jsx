import { useMemo, useState } from 'react';
import { STAFF_SECTIONS, getStaffSectionMeta, inferStaffSection } from '../utils/staffSections';
import {
  DEFAULT_WASTE_CLASSIFICATION,
  PREVENTABLE_REASONS,
  WASTE_CLASSIFICATION_OPTIONS,
  getEntryFoodCostLost,
  getEntryGrossProfitLost,
  getEntryPotentialRevenueLost,
  getWasteClassificationMeta,
} from '../utils/wasteCalculations';
import {
  createTodayShiftSummary,
  getActiveWasteEntries,
  getWasteEntrySyncStatus,
  wasteEntryNeedsCostReview,
} from '../utils/wasteSync';
import { limitDashboardRows } from '../utils/listPerformance';

const timeframes = ['day', 'week', 'month', 'year', 'all'];

const getMetricRows = (metricsObj, totalValue) => (
  Object.entries(metricsObj)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      value,
      pct: totalValue > 0 ? Math.round((value / totalValue) * 100) : 0,
    }))
);

function Dashboard({ items, budget, settings, staffList, accessProfile, invoiceStats, onNavigate }) {
  const [timeframe, setTimeframe] = useState('week');
  const [dashboardView, setDashboardView] = useState('today');
  const [sectionDate, setSectionDate] = useState(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  });

  const safeItems = getActiveWasteEntries(items);
  const canViewFinancials = Boolean(accessProfile?.canViewFinancials);
  const formatMoney = (value) => (canViewFinancials ? `R${Number(value || 0).toFixed(2)}` : 'Restricted');
  const invoiceDashboard = invoiceStats || {};
  const getItemWasteClassification = (item) => item?.wasteClassification || DEFAULT_WASTE_CLASSIFICATION;
  const metricValueClass = (isDanger = false) => (
    `metric-value${canViewFinancials && isDanger ? ' is-danger' : ''}`
  );
  const safeStaffList = useMemo(() => (Array.isArray(staffList) ? staffList : []), [staffList]);
  const staffByName = useMemo(() => {
    const lookup = new Map();

    safeStaffList.forEach((member) => {
      lookup.set(String(member?.name || '').trim().toLowerCase(), member);
    });

    return lookup;
  }, [safeStaffList]);

  const parseDate = (dateStr) => {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
    return new Date(dateStr);
  };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const isSameDay = (firstDate, secondDate) => {
    const first = new Date(firstDate);
    const second = new Date(secondDate);

    first.setHours(0, 0, 0, 0);
    second.setHours(0, 0, 0, 0);
    return first.getTime() === second.getTime();
  };
  const formatSectionDate = (date) => {
    const activeDate = new Date(date);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (isSameDay(activeDate, today)) return 'Today';
    if (isSameDay(activeDate, yesterday)) return 'Yesterday';
    return activeDate.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const navigateSectionDate = (direction) => {
    const nextDate = new Date(sectionDate);
    nextDate.setDate(nextDate.getDate() + direction);
    nextDate.setHours(0, 0, 0, 0);

    if (nextDate <= today) {
      setSectionDate(nextDate);
    }
  };
  const canGoForwardSectionDate = !isSameDay(sectionDate, today);
  const getItemStaffSection = (item) => {
    const staffName = String(item?.staff || '').trim().toLowerCase();
    const staffMember = staffByName.get(staffName);

    return staffMember?.staffSection || inferStaffSection(staffMember?.role || item?.staff);
  };

  const filteredItems = safeItems.filter((item) => {
    if (timeframe === 'all') return true;
    const itemDate = parseDate(item?.date);

    if (timeframe === 'day') return itemDate.getTime() === today.getTime();

    if (timeframe === 'week') {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return itemDate >= weekAgo;
    }

    if (timeframe === 'month') {
      return itemDate.getMonth() === today.getMonth() && itemDate.getFullYear() === today.getFullYear();
    }

    if (timeframe === 'year') return itemDate.getFullYear() === today.getFullYear();

    return true;
  });

  const totalItems = filteredItems.length;
  const totalFinancialLoss = filteredItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const totalPotentialRevenueLost = filteredItems.reduce((sum, item) => sum + getEntryPotentialRevenueLost(item), 0);
  const totalGrossProfitLost = filteredItems.reduce((sum, item) => sum + getEntryGrossProfitLost(item), 0);
  const averageLoss = totalItems > 0 ? totalFinancialLoss / totalItems : 0;
  const daysElapsed = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const currentMonthItems = safeItems.filter((item) => {
    const itemDate = parseDate(item?.date);
    return itemDate.getMonth() === today.getMonth() && itemDate.getFullYear() === today.getFullYear();
  });
  const currentMonthLoss = currentMonthItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const remainingBudget = Math.max(0, budget - currentMonthLoss);
  const budgetUsagePercent = budget > 0 ? Math.min(100, (currentMonthLoss / budget) * 100) : 0;
  const todayItems = safeItems.filter((item) => {
    const itemDate = parseDate(item?.date);
    itemDate.setHours(0, 0, 0, 0);
    return itemDate.getTime() === today.getTime();
  });
  const todayShiftSummary = createTodayShiftSummary(safeItems, today);
  const todayLoss = todayItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 7);
  const weekItems = safeItems.filter((item) => parseDate(item?.date) >= weekStart);
  const weekLoss = weekItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const sectionDateItems = safeItems.filter((item) => isSameDay(parseDate(item?.date), sectionDate));
  const sectionDateLoss = sectionDateItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
  const sectionRings = STAFF_SECTIONS.map((section) => {
    const sectionItems = sectionDateItems.filter((item) => getItemStaffSection(item) === section.key);
    const sectionLoss = sectionItems.reduce((sum, item) => sum + getEntryFoodCostLost(item), 0);
    const percent = sectionDateLoss > 0 ? Math.round((sectionLoss / sectionDateLoss) * 100) : 0;

    return {
      ...section,
      entries: sectionItems.length,
      loss: sectionLoss,
      percent,
    };
  });
  const leadingSection = sectionRings.reduce((leader, section) => (
    section.loss > (leader?.loss || 0) ? section : leader
  ), null);
  const dailyValueLimit = Number(settings?.dailyWasteValueLimit) || 0;
  const dailyEntryLimit = Number(settings?.dailyWasteEntryLimit) || 0;
  const dailyValueUsagePercent = dailyValueLimit > 0 ? Math.min(100, (todayLoss / dailyValueLimit) * 100) : 0;
  const dailyEntryUsagePercent = dailyEntryLimit > 0 ? Math.min(100, (todayItems.length / dailyEntryLimit) * 100) : 0;
  const projectedMonthLoss = daysElapsed > 0 ? (currentMonthLoss / daysElapsed) * daysInMonth : 0;
  const dailyBudgetPace = budget > 0 ? budget / daysInMonth : 0;
  const currentDailyAverage = daysElapsed > 0 ? currentMonthLoss / daysElapsed : 0;
  const projectedBudgetGap = budget > 0 ? projectedMonthLoss - budget : 0;
  const preventableLoss = filteredItems.reduce((sum, item) => (
    PREVENTABLE_REASONS.has(item?.reason) ? sum + getEntryFoodCostLost(item) : sum
  ), 0);
  const preventablePercent = totalFinancialLoss > 0 ? Math.round((preventableLoss / totalFinancialLoss) * 100) : 0;

  const reasonMetrics = filteredItems.reduce((acc, item) => {
    const reason = item?.reason || 'Unknown';
    acc[reason] = (acc[reason] || 0) + getEntryFoodCostLost(item);
    return acc;
  }, {});

  const staffMetrics = filteredItems.reduce((acc, item) => {
    const name = item?.staff || 'Unassigned';
    acc[name] = (acc[name] || 0) + getEntryFoodCostLost(item);
    return acc;
  }, {});

  const itemMetrics = filteredItems.reduce((acc, item) => {
    const name = item?.name || 'Unknown';
    acc[name] = (acc[name] || 0) + getEntryFoodCostLost(item);
    return acc;
  }, {});

  const ingredientMetrics = filteredItems.reduce((acc, item) => {
    if (item?.isRecipe && Array.isArray(item.ingredients) && item.ingredients.length > 0) {
      item.ingredients.forEach((ingredient) => {
        const name = ingredient?.name || 'Unknown ingredient';
        acc[name] = (acc[name] || 0) + (Number(ingredient?.cost) || 0);
      });
      return acc;
    }

    const name = item?.name || 'Unknown ingredient';
    acc[name] = (acc[name] || 0) + getEntryFoodCostLost(item);
    return acc;
  }, {});

  const departmentMetrics = filteredItems.reduce((acc, item) => {
    const sectionKey = item?.department || getItemStaffSection(item);
    const section = getStaffSectionMeta(sectionKey);
    acc[section.label] = (acc[section.label] || 0) + getEntryFoodCostLost(item);
    return acc;
  }, {});

  const categoryMetrics = filteredItems.reduce((acc, item) => {
    if (item?.isRecipe && Array.isArray(item.ingredients)) {
      item.ingredients.forEach((ingredient) => {
        const category = ingredient?.category || 'Other';
        acc[category] = (acc[category] || 0) + (Number(ingredient?.cost) || 0);
      });
      return acc;
    }

    const category = item?.category || 'Other';
    acc[category] = (acc[category] || 0) + getEntryFoodCostLost(item);
    return acc;
  }, {});

  const classificationMetrics = filteredItems.reduce((acc, item) => {
    const classification = getWasteClassificationMeta(getItemWasteClassification(item)).label;
    acc[classification] = (acc[classification] || 0) + getEntryFoodCostLost(item);
    return acc;
  }, {});

  WASTE_CLASSIFICATION_OPTIONS.forEach((classificationOption) => {
    classificationMetrics[classificationOption.label] = classificationMetrics[classificationOption.label] || 0;
  });

  const getTopMetric = (metricsObj) => {
    const entries = Object.entries(metricsObj);
    if (entries.length === 0) return null;
    return entries.sort((a, b) => b[1] - a[1])[0];
  };

  const topItem = getTopMetric(itemMetrics);
  const topReason = getTopMetric(reasonMetrics);
  const topStaff = getTopMetric(staffMetrics);
  const topCategory = getTopMetric(categoryMetrics);
  const topIngredient = getTopMetric(ingredientMetrics);
  const topDepartment = getTopMetric(departmentMetrics);
  const reasonRows = limitDashboardRows(getMetricRows(reasonMetrics, totalFinancialLoss));
  const staffRows = limitDashboardRows(getMetricRows(staffMetrics, totalFinancialLoss));
  const categoryRows = limitDashboardRows(getMetricRows(categoryMetrics, totalFinancialLoss));
  const departmentRows = limitDashboardRows(getMetricRows(departmentMetrics, totalFinancialLoss));
  const classificationRows = getMetricRows(classificationMetrics, totalFinancialLoss);
  const actualFoodLoss = classificationMetrics[getWasteClassificationMeta(DEFAULT_WASTE_CLASSIFICATION).label] || 0;
  const operationalLoss = classificationMetrics[getWasteClassificationMeta('operational').label] || 0;
  const topReasonShare = totalFinancialLoss > 0 && topReason ? Math.round((topReason[1] / totalFinancialLoss) * 100) : 0;
  const topItemShare = totalFinancialLoss > 0 && topItem ? Math.round((topItem[1] / totalFinancialLoss) * 100) : 0;

  const timeframeLabel = timeframe === 'all' ? 'All Time' : timeframe === 'day' ? 'Today' : `This ${timeframe}`;
  const attentionItems = [
    budget > 0 && projectedBudgetGap > 0
      ? `Projected month-end loss is ${formatMoney(projectedBudgetGap)} over the monthly limit.`
      : null,
    dailyValueLimit > 0 && todayLoss > dailyValueLimit
      ? `Today's waste value is ${formatMoney(todayLoss - dailyValueLimit)} over the daily value limit.`
      : null,
    dailyEntryLimit > 0 && todayItems.length > dailyEntryLimit
      ? `Today's entry count is ${todayItems.length - dailyEntryLimit} over the daily entry limit.`
      : null,
  ].filter(Boolean);
  const actionRecommendations = [
    topReason ? `${topReason[0]} is ${topReasonShare}% of loss in this view. Put it first in the next shift huddle.` : null,
    topItem ? `${topItem[0]} is ${topItemShare}% of loss here. Check prep quantity, holding time, or order volume.` : null,
    topCategory ? `${topCategory[0]} carries the highest category loss. Review par levels before the next order.` : null,
    topDepartment ? `${topDepartment[0]} is the highest department contributor in this view. Check shift handover notes.` : null,
    budgetUsagePercent > 85 ? 'Monthly loss is near the limit. Add an end-of-shift review before closing.' : null,
    currentDailyAverage > dailyBudgetPace && dailyBudgetPace > 0 ? `Current daily loss average is ${formatMoney(currentDailyAverage - dailyBudgetPace)} above budget pace.` : null,
  ].filter(Boolean).slice(0, 4);

  return (
    <section className="panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Analytics</p>
            <h2 className="title">Impact Dashboard</h2>
            <p className="subtitle">Track waste value, causes, and staff accountability.</p>
          </div>

          <div className="segmented-control" aria-label="Dashboard timeframe">
            {timeframes.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`segment-button${timeframe === tf ? ' is-active' : ''}`}
              >
                {tf === 'all' ? 'All' : tf}
              </button>
            ))}
          </div>
        </div>

        <div className="segmented-control dashboard-view-tabs" aria-label="Dashboard views">
          {[
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'Week' },
            { key: 'problems', label: 'Problems' },
            { key: 'reports', label: 'Reports' },
          ].map((view) => (
            <button
              key={view.key}
              type="button"
              onClick={() => setDashboardView(view.key)}
              className={`segment-button${dashboardView === view.key ? ' is-active' : ''}`}
            >
              {view.label}
            </button>
          ))}
        </div>

        {dashboardView === 'today' && (
          <>
            {safeItems.length === 0 && (
              <div className="notice-panel notice-panel--warning">
                <div>
                  <h3 className="breakdown-title">Start by logging your first waste item.</h3>
                  <p className="small-text" style={{ margin: 0 }}>
                    WasteShift will rank causes, staff, categories, and budget pace once entries come in.
                  </p>
                </div>
              </div>
            )}

            {attentionItems.length > 0 && (
              <div className="notice-panel">
                <div>
                  <h3 className="breakdown-title">Needs attention now</h3>
                  <div className="action-list">
                    {attentionItems.map((attentionItem) => (
                      <div key={attentionItem} className="action-card">{attentionItem}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!canViewFinancials && (
              <div className="notice-panel notice-panel--warning">
                <div>
                  <h3 className="breakdown-title">Financial analytics restricted</h3>
                  <p className="small-text" style={{ margin: 0 }}>
                    Select an owner or manager in Settings &gt; Security to view waste cost, revenue loss, exports, and protected actions.
                  </p>
                </div>
              </div>
            )}

            <div className="metrics-grid dashboard-action-grid">
              <div className="metric-card">
                <span className={metricValueClass(dailyValueLimit > 0 && todayLoss > dailyValueLimit)}>{formatMoney(todayLoss)}</span>
                <span className="metric-label">Today&apos;s waste value</span>
              </div>
              <div className="metric-card">
                <span className={metricValueClass(true)}>{formatMoney(weekLoss)}</span>
                <span className="metric-label">This week</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{topItem ? topItem[0] : 'None'}</span>
                <span className="metric-label">Top wasted item</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{topReason ? topReason[0] : 'None'}</span>
                <span className="metric-label">Top reason</span>
              </div>
              <div className="metric-card">
                <span className={`metric-value${todayShiftSummary.costReviewCount > 0 ? ' is-danger' : ''}`}>{todayShiftSummary.costReviewCount}</span>
                <span className="metric-label">Needs price review</span>
              </div>
              <div className="metric-card">
                <span className={`metric-value${Number(invoiceDashboard.lowStockCount || 0) > 0 ? ' is-danger' : ''}`}>{Number(invoiceDashboard.lowStockCount || 0)}</span>
                <span className="metric-label">Low stock</span>
              </div>
              <button type="button" className="metric-card metric-card--button" onClick={() => onNavigate?.('wasteLog')}>
                <span className="metric-value">View</span>
                <span className="metric-label">Waste Log</span>
              </button>
            </div>

        <div className="shift-summary-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Live shift</p>
              <h2 className="title">Today At A Glance</h2>
            </div>
            <div className="manager-row">
              <span className="badge">{todayShiftSummary.entryCount} entries</span>
              <span className={todayShiftSummary.pendingSyncCount > 0 ? 'badge is-red' : 'badge is-green'}>
                {todayShiftSummary.pendingSyncCount} pending sync
              </span>
              <span className={todayShiftSummary.costReviewCount > 0 ? 'badge is-red' : 'badge is-green'}>
                {todayShiftSummary.costReviewCount} cost review
              </span>
            </div>
          </div>
          <div className="breakdown-grid">
            <div>
              <h3 className="breakdown-title">Latest entries</h3>
              {todayShiftSummary.latestEntries.length === 0 ? (
                <div className="empty-state">No waste logged today.</div>
              ) : todayShiftSummary.latestEntries.map((item) => (
                <div key={item.id} className="breakdown-item">
                  <div className="breakdown-label">
                    <span>{item.name}</span>
                    <span>{formatMoney(getEntryFoodCostLost(item))}</span>
                  </div>
                  <div className="import-summary-grid">
                    <span className="badge">{item.reason || 'No reason'}</span>
                    <span className={getWasteEntrySyncStatus(item) === 'synced' ? 'badge is-green' : 'badge'}>
                      {getWasteEntrySyncStatus(item)}
                    </span>
                    {wasteEntryNeedsCostReview(item) && <span className="badge is-red">cost review</span>}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <h3 className="breakdown-title">Top reasons today</h3>
              {todayShiftSummary.topReasons.length === 0 ? (
                <div className="empty-state">Reasons appear after entries are logged.</div>
              ) : todayShiftSummary.topReasons.map((item) => (
                <div key={item.reason} className="breakdown-item">
                  <div className="breakdown-label">
                    <span>{item.reason}</span>
                    <span>{item.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
          </>
        )}

        {dashboardView === 'week' && (
          <>
        <div className="metrics-grid">
          <div className="metric-card">
            <span className={metricValueClass(dailyValueLimit > 0 && todayLoss > dailyValueLimit)}>{formatMoney(todayLoss)}</span>
            <span className="metric-label">Today&apos;s food cost lost</span>
          </div>
          <div className="metric-card">
            <span className={metricValueClass(true)}>{formatMoney(weekLoss)}</span>
            <span className="metric-label">This week&apos;s food cost lost</span>
          </div>
          <div className="metric-card">
            <span className={metricValueClass(budget > 0 && currentMonthLoss > budget)}>{formatMoney(currentMonthLoss)}</span>
            <span className="metric-label">This month&apos;s food cost lost</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{totalItems}</span>
            <span className="metric-label">Incidents in {timeframeLabel.toLowerCase()}</span>
          </div>
          <div className="metric-card">
            <span className={metricValueClass(true)}>{formatMoney(actualFoodLoss)}</span>
            <span className="metric-label">Actual food wastage</span>
          </div>
          <div className="metric-card">
            <span className={metricValueClass(operationalLoss > 0)}>{formatMoney(operationalLoss)}</span>
            <span className="metric-label">Operational waste</span>
          </div>
          <div className="metric-card">
            <span className={metricValueClass(true)}>{formatMoney(totalPotentialRevenueLost)}</span>
            <span className="metric-label">Potential revenue lost</span>
          </div>
          <div className="metric-card">
            <span className={metricValueClass(totalGrossProfitLost > 0)}>{formatMoney(totalGrossProfitLost)}</span>
            <span className="metric-label">Gross profit lost</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">{formatMoney(averageLoss)}</span>
            <span className="metric-label">Average food cost per entry</span>
          </div>
          <div className="metric-card">
            <span className={metricValueClass(budget > 0 && projectedMonthLoss > budget)}>{formatMoney(projectedMonthLoss)}</span>
            <span className="metric-label">Projected month-end food cost</span>
          </div>
        </div>
          </>
        )}

        {dashboardView === 'problems' && (
          <>
            {attentionItems.length === 0 && Number(invoiceDashboard.lowStockCount || 0) === 0 && todayShiftSummary.costReviewCount === 0 && (
              <div className="notice-panel notice-panel--success">
                <div>
                  <h3 className="breakdown-title">No urgent problems right now.</h3>
                  <p className="small-text" style={{ margin: 0 }}>Missing costs, low stock, and daily limit issues will appear here.</p>
                </div>
              </div>
            )}

            {attentionItems.length > 0 && (
              <div className="notice-panel">
                <div>
                  <h3 className="breakdown-title">Urgent warnings</h3>
                  <div className="action-list">
                    {attentionItems.map((attentionItem) => (
                      <div key={attentionItem} className="action-card">{attentionItem}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}

        <div className="panel dashboard-invoice-panel">
          <div className="panel-body">
            <div className="section-header">
              <div>
                <p className="eyebrow">Purchasing</p>
                <h2 className="title">Invoice & Stock Signals</h2>
              </div>
              <span className={`badge${Number(invoiceDashboard.lowStockCount || 0) > 0 ? ' is-red' : ' is-green'}`}>
                {Number(invoiceDashboard.lowStockCount || 0)} low stock
              </span>
            </div>

            <div className="metrics-grid">
              <div className="metric-card">
                <span className={metricValueClass(true)}>{formatMoney(invoiceDashboard.totalSpendThisWeekExVAT)}</span>
                <span className="metric-label">Spend this week excl VAT</span>
              </div>
              <div className="metric-card">
                <span className={metricValueClass(true)}>{formatMoney(invoiceDashboard.totalSpendThisWeekIncVAT)}</span>
                <span className="metric-label">Spend this week incl VAT</span>
              </div>
              <div className="metric-card">
                <span className={metricValueClass(true)}>{formatMoney(invoiceDashboard.totalVatThisWeek)}</span>
                <span className="metric-label">VAT this week</span>
              </div>
              <div className="metric-card">
                <span className={metricValueClass(true)}>{formatMoney(invoiceDashboard.totalSpendThisMonthExVAT ?? invoiceDashboard.totalSpendThisMonth)}</span>
                <span className="metric-label">Spend this month excl VAT</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{invoiceDashboard.topSuppliersThisWeek?.[0]?.supplier || 'None'}</span>
                <span className="metric-label">Top supplier this week</span>
              </div>
              <div className="metric-card">
                <span className={`metric-value${Number(invoiceDashboard.priceIncreasesThisMonth?.length || 0) > 0 ? ' is-danger' : ''}`}>
                  {invoiceDashboard.priceIncreasesThisMonth?.length || 0}
                </span>
                <span className="metric-label">Price increases this month</span>
              </div>
              <div className="metric-card">
                <span className={`metric-value${Number(invoiceDashboard.missingCostCount || 0) > 0 ? ' is-danger' : ''}`}>
                  {invoiceDashboard.missingCostCount || 0}
                </span>
                <span className="metric-label">Ingredients missing cost</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{invoiceDashboard.lastInvoice?.supplier || 'None'}</span>
                <span className="metric-label">
                  Last invoice {invoiceDashboard.lastInvoice?.invoiceDate || ''}
                </span>
              </div>
            </div>

            <div className="breakdown-grid">
              <div>
                <h3 className="breakdown-title">Top 5 expensive ingredients</h3>
                {(invoiceDashboard.topIngredients || []).length === 0 ? (
                  <div className="empty-state">No invoice ingredient prices yet.</div>
                ) : invoiceDashboard.topIngredients.map((ingredient) => (
                  <div key={ingredient.id} className="breakdown-item">
                    <div className="breakdown-label">
                      <span>{ingredient.name}</span>
                      <span>{formatMoney(ingredient.priceExVAT)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="breakdown-title">Price increases</h3>
                {(invoiceDashboard.priceIncreasesThisMonth || []).length === 0 ? (
                  <div className="empty-state">No ingredient price increases this month.</div>
                ) : invoiceDashboard.priceIncreasesThisMonth.slice(0, 5).map((ingredient) => (
                  <div key={ingredient.id} className="breakdown-item">
                    <div className="breakdown-label">
                      <span>{ingredient.name}</span>
                      <span className="badge is-red">Up {ingredient.increasePercent.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
          </>
        )}

        {dashboardView === 'reports' && totalItems > 0 && (
          <div className="insight-strip" aria-label={`Top trends for ${timeframeLabel}`}>
            <div className="insight-item">
              <span className="insight-label">Most wasted item</span>
              <span className="insight-value">{topItem ? topItem[0] : 'N/A'}</span>
            </div>
            <div className="insight-item">
              <span className="insight-label">Biggest ingredient</span>
              <span className="insight-value">{topIngredient ? topIngredient[0] : 'N/A'}</span>
            </div>
            <div className="insight-item">
              <span className="insight-label">Primary cause</span>
              <span className="insight-value">{topReason ? topReason[0] : 'N/A'}</span>
            </div>
            <div className="insight-item">
              <span className="insight-label">Highest staff contributor</span>
              <span className="insight-value">{topStaff ? topStaff[0] : 'N/A'}</span>
            </div>
            <div className="insight-item">
              <span className="insight-label">Biggest department</span>
              <span className="insight-value">{topDepartment ? topDepartment[0] : 'N/A'}</span>
            </div>
          </div>
        )}

        {(dashboardView === 'week' || dashboardView === 'reports') && (
        <div className="section-rings-panel">
          <div className="section-rings-header">
            <div>
              <h3 className="breakdown-title">Daily restaurant section rings</h3>
              <p className="small-text" style={{ margin: 0 }}>
                {sectionDateItems.length} entr{sectionDateItems.length === 1 ? 'y' : 'ies'} worth {formatMoney(sectionDateLoss)} on {formatSectionDate(sectionDate).toLowerCase()}
              </p>
            </div>
            <div className="date-actions">
              <button type="button" onClick={() => navigateSectionDate(-1)} className="icon-button" title="Previous day">
                {'<'}
              </button>
              <span className="section-date-pill">{formatSectionDate(sectionDate)}</span>
              <button
                type="button"
                onClick={() => navigateSectionDate(1)}
                className="icon-button"
                title="Next day"
                disabled={!canGoForwardSectionDate}
              >
                {'>'}
              </button>
            </div>
          </div>

          <div className="section-ring-grid">
            {sectionRings.map((section) => {
              const isLeading = leadingSection?.key === section.key && section.loss > 0;

              return (
                <div key={section.key} className={`section-ring-card${isLeading ? ' is-leading' : ''}`}>
                  <div
                    className="section-ring-visual"
                    style={{
                      '--ring-color': section.color,
                      '--ring-fill': `${section.percent}%`,
                    }}
                    aria-label={`${section.label}: ${section.percent}% of selected day waste`}
                  >
                    <span>{section.percent}%</span>
                  </div>
                  <div>
                    <span className={`badge staff-section-badge staff-section-badge--${section.key}`}>
                      {section.label}
                    </span>
                    <div className="section-ring-value">{formatMoney(section.loss)}</div>
                    <div className="small-text">
                      {section.entries} entr{section.entries === 1 ? 'y' : 'ies'}
                      {isLeading ? ' - highest today' : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {dashboardView === 'week' && (
        <div className="budget-panel">
          <div className="budget-row">
            <span className="field-label">Monthly loss limit</span>
            <span className="badge">{formatMoney(budget)}</span>
          </div>

          <div className="progress-track">
            <div
              className={`progress-fill${budgetUsagePercent > 85 ? ' is-danger' : ''}`}
              style={{ width: `${budgetUsagePercent}%` }}
            />
          </div>
          <span className="small-text">{formatMoney(remainingBudget)} remaining before threshold breach</span>
        </div>
        )}

        {dashboardView === 'week' && (dailyValueLimit > 0 || dailyEntryLimit > 0) && (
          <div className="budget-panel">
            <h3 className="breakdown-title">Today&apos;s limits</h3>
            {dailyValueLimit > 0 && (
              <div className="breakdown-item">
                <div className="breakdown-label">
                  <span>Waste value</span>
                  <span>{formatMoney(todayLoss)} / {formatMoney(dailyValueLimit)}</span>
                </div>
                <div className="progress-track">
                  <div className={`progress-fill${todayLoss > dailyValueLimit ? ' is-danger' : ''}`} style={{ width: `${dailyValueUsagePercent}%` }} />
                </div>
              </div>
            )}

            {dailyEntryLimit > 0 && (
              <div className="breakdown-item">
                <div className="breakdown-label">
                  <span>Waste entries</span>
                  <span>{todayItems.length} / {dailyEntryLimit}</span>
                </div>
                <div className="progress-track">
                  <div className={`progress-fill${todayItems.length > dailyEntryLimit ? ' is-danger' : ''}`} style={{ width: `${dailyEntryUsagePercent}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {dashboardView === 'reports' && totalItems > 0 && (
          <div className="budget-panel">
            <h3 className="breakdown-title">Waste type split</h3>
            {classificationRows.map((row) => (
              <div key={row.label} className="breakdown-item">
                <div className="breakdown-label">
                  <span>{row.label}</span>
                  <span>{formatMoney(row.value)} ({row.pct}%)</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${row.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {dashboardView === 'problems' && totalItems > 0 && (
          <div className="action-panel">
            <div>
              <h3 className="breakdown-title">Recommended next actions</h3>
              <div className="action-list">
                {actionRecommendations.map((recommendation) => (
                  <div key={recommendation} className="action-card">{recommendation}</div>
                ))}
              </div>
            </div>
            <div className="metric-card">
              <span className={metricValueClass(true)}>{formatMoney(preventableLoss)}</span>
              <span className="metric-label">Preventable loss in this view ({preventablePercent}%)</span>
            </div>
          </div>
        )}

        {dashboardView === 'reports' && totalItems > 0 && (
          <div className="breakdown-grid breakdown-grid--four">
            <div>
              <h3 className="breakdown-title">Loss by reason</h3>
              {reasonRows.map((row) => (
                  <div key={row.label} className="breakdown-item">
                    <div className="breakdown-label">
                      <span>{row.label}</span>
                      <span>{formatMoney(row.value)} ({row.pct}%)</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${row.pct}%` }} />
                    </div>
                  </div>
              ))}
            </div>

            <div>
              <h3 className="breakdown-title">Staff accountability</h3>
              {staffRows.map((row) => {
                const staffMember = staffByName.get(String(row.label || '').trim().toLowerCase());
                const staffSection = getStaffSectionMeta(staffMember?.staffSection || inferStaffSection(staffMember?.role || row.label));

                return (
                  <div key={row.label} className="breakdown-item">
                    <div className="breakdown-label">
                      <span>
                        {row.label}
                        <span className={`badge staff-section-badge staff-section-badge--${staffSection.key}`}>
                          {staffSection.shortLabel}
                        </span>
                      </span>
                      <span>{formatMoney(row.value)}</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${row.pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <h3 className="breakdown-title">Department contribution</h3>
              {departmentRows.map((row) => (
                  <div key={row.label} className="breakdown-item">
                    <div className="breakdown-label">
                      <span>{row.label}</span>
                      <span>{formatMoney(row.value)} ({row.pct}%)</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${row.pct}%` }} />
                    </div>
                  </div>
              ))}
            </div>

            <div>
              <h3 className="breakdown-title">Cost by category</h3>
              {categoryRows.map((row) => (
                  <div key={row.label} className="breakdown-item">
                    <div className="breakdown-label">
                      <span>{row.label}</span>
                      <span>{formatMoney(row.value)} ({row.pct}%)</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${row.pct}%` }} />
                    </div>
                  </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default Dashboard;
