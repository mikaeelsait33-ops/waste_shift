import { useState } from 'react';

const timeframes = ['all', 'day', 'week', 'month', 'year'];

const preventableReasons = new Set([
  'Kitchen Prep Mistake',
  'Passed Expiration Date',
  'Spoiled/Overripe',
]);

const getMetricRows = (metricsObj, totalValue) => (
  Object.entries(metricsObj)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      value,
      pct: totalValue > 0 ? Math.round((value / totalValue) * 100) : 0,
    }))
);

function Dashboard({ items, budget, settings }) {
  const [timeframe, setTimeframe] = useState('all');

  const safeItems = Array.isArray(items) ? items : [];

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
  const totalFinancialLoss = filteredItems.reduce((sum, item) => sum + (Number(item?.cost) || 0), 0);
  const averageLoss = totalItems > 0 ? totalFinancialLoss / totalItems : 0;
  const daysElapsed = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const currentMonthItems = safeItems.filter((item) => {
    const itemDate = parseDate(item?.date);
    return itemDate.getMonth() === today.getMonth() && itemDate.getFullYear() === today.getFullYear();
  });
  const currentMonthLoss = currentMonthItems.reduce((sum, item) => sum + (Number(item?.cost) || 0), 0);
  const remainingBudget = Math.max(0, budget - currentMonthLoss);
  const budgetUsagePercent = budget > 0 ? Math.min(100, (currentMonthLoss / budget) * 100) : 0;
  const todayItems = safeItems.filter((item) => {
    const itemDate = parseDate(item?.date);
    itemDate.setHours(0, 0, 0, 0);
    return itemDate.getTime() === today.getTime();
  });
  const todayLoss = todayItems.reduce((sum, item) => sum + (Number(item?.cost) || 0), 0);
  const dailyValueLimit = Number(settings?.dailyWasteValueLimit) || 0;
  const dailyEntryLimit = Number(settings?.dailyWasteEntryLimit) || 0;
  const dailyValueUsagePercent = dailyValueLimit > 0 ? Math.min(100, (todayLoss / dailyValueLimit) * 100) : 0;
  const dailyEntryUsagePercent = dailyEntryLimit > 0 ? Math.min(100, (todayItems.length / dailyEntryLimit) * 100) : 0;
  const projectedMonthLoss = daysElapsed > 0 ? (currentMonthLoss / daysElapsed) * daysInMonth : 0;
  const dailyBudgetPace = budget > 0 ? budget / daysInMonth : 0;
  const currentDailyAverage = daysElapsed > 0 ? currentMonthLoss / daysElapsed : 0;
  const projectedBudgetGap = budget > 0 ? projectedMonthLoss - budget : 0;
  const preventableLoss = filteredItems.reduce((sum, item) => (
    preventableReasons.has(item?.reason) ? sum + (Number(item?.cost) || 0) : sum
  ), 0);
  const preventablePercent = totalFinancialLoss > 0 ? Math.round((preventableLoss / totalFinancialLoss) * 100) : 0;

  const reasonMetrics = filteredItems.reduce((acc, item) => {
    const reason = item?.reason || 'Unknown';
    acc[reason] = (acc[reason] || 0) + (Number(item?.cost) || 0);
    return acc;
  }, {});

  const staffMetrics = filteredItems.reduce((acc, item) => {
    const name = item?.staff || 'Unassigned';
    acc[name] = (acc[name] || 0) + (Number(item?.cost) || 0);
    return acc;
  }, {});

  const itemMetrics = filteredItems.reduce((acc, item) => {
    const name = item?.name || 'Unknown';
    acc[name] = (acc[name] || 0) + (Number(item?.cost) || 0);
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
    acc[category] = (acc[category] || 0) + (Number(item?.cost) || 0);
    return acc;
  }, {});

  const getTopMetric = (metricsObj) => {
    const entries = Object.entries(metricsObj);
    if (entries.length === 0) return null;
    return entries.sort((a, b) => b[1] - a[1])[0];
  };

  const topItem = getTopMetric(itemMetrics);
  const topReason = getTopMetric(reasonMetrics);
  const topStaff = getTopMetric(staffMetrics);
  const topCategory = getTopMetric(categoryMetrics);
  const reasonRows = getMetricRows(reasonMetrics, totalFinancialLoss);
  const staffRows = getMetricRows(staffMetrics, totalFinancialLoss);
  const categoryRows = getMetricRows(categoryMetrics, totalFinancialLoss);
  const topReasonShare = totalFinancialLoss > 0 && topReason ? Math.round((topReason[1] / totalFinancialLoss) * 100) : 0;
  const topItemShare = totalFinancialLoss > 0 && topItem ? Math.round((topItem[1] / totalFinancialLoss) * 100) : 0;

  const timeframeLabel = timeframe === 'all' ? 'All Time' : timeframe === 'day' ? 'Today' : `This ${timeframe}`;
  const attentionItems = [
    budget > 0 && projectedBudgetGap > 0
      ? `Projected month-end loss is R${projectedBudgetGap.toFixed(2)} over the monthly limit.`
      : null,
    dailyValueLimit > 0 && todayLoss > dailyValueLimit
      ? `Today's waste value is R${(todayLoss - dailyValueLimit).toFixed(2)} over the daily value limit.`
      : null,
    dailyEntryLimit > 0 && todayItems.length > dailyEntryLimit
      ? `Today's entry count is ${todayItems.length - dailyEntryLimit} over the daily entry limit.`
      : null,
  ].filter(Boolean);
  const actionRecommendations = [
    topReason ? `${topReason[0]} is ${topReasonShare}% of loss in this view. Put it first in the next shift huddle.` : null,
    topItem ? `${topItem[0]} is ${topItemShare}% of loss here. Check prep quantity, holding time, or order volume.` : null,
    topCategory ? `${topCategory[0]} carries the highest category loss. Review par levels before the next order.` : null,
    budgetUsagePercent > 85 ? 'Monthly loss is near the limit. Add an end-of-shift review before closing.' : null,
    currentDailyAverage > dailyBudgetPace && dailyBudgetPace > 0 ? `Current daily loss average is R${(currentDailyAverage - dailyBudgetPace).toFixed(2)} above budget pace.` : null,
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

        {safeItems.length === 0 && (
          <div className="notice-panel notice-panel--warning">
            <div>
              <h3 className="breakdown-title">Ready for first entry</h3>
              <p className="small-text" style={{ margin: 0 }}>
                The dashboard will rank causes, staff, categories, and budget pace once waste is logged.
              </p>
            </div>
          </div>
        )}

        {attentionItems.length > 0 && (
          <div className="notice-panel">
            <div>
              <h3 className="breakdown-title">Needs attention</h3>
              <div className="action-list">
                {attentionItems.map((attentionItem) => (
                  <div key={attentionItem} className="action-card">{attentionItem}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-value">{totalItems}</span>
            <span className="metric-label">Items wasted</span>
          </div>
          <div className="metric-card">
            <span className="metric-value is-danger">R{totalFinancialLoss.toFixed(2)}</span>
            <span className="metric-label">Financial loss</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">R{averageLoss.toFixed(2)}</span>
            <span className="metric-label">Average loss per entry</span>
          </div>
          <div className="metric-card">
            <span className={`metric-value${budget > 0 && projectedMonthLoss > budget ? ' is-danger' : ''}`}>R{projectedMonthLoss.toFixed(2)}</span>
            <span className="metric-label">Projected month-end loss</span>
          </div>
          <div className="metric-card">
            <span className={`metric-value${currentDailyAverage > dailyBudgetPace && dailyBudgetPace > 0 ? ' is-danger' : ''}`}>R{currentDailyAverage.toFixed(2)}</span>
            <span className="metric-label">Current month daily average</span>
          </div>
          <div className="metric-card">
            <span className="metric-value">R{dailyBudgetPace.toFixed(2)}</span>
            <span className="metric-label">Daily budget pace</span>
          </div>
        </div>

        {totalItems > 0 && (
          <div className="insight-strip" aria-label={`Top trends for ${timeframeLabel}`}>
            <div className="insight-item">
              <span className="insight-label">Most wasted item</span>
              <span className="insight-value">{topItem ? topItem[0] : 'N/A'}</span>
            </div>
            <div className="insight-item">
              <span className="insight-label">Primary cause</span>
              <span className="insight-value">{topReason ? topReason[0] : 'N/A'}</span>
            </div>
            <div className="insight-item">
              <span className="insight-label">Highest cost by</span>
              <span className="insight-value">{topStaff ? topStaff[0] : 'N/A'}</span>
            </div>
          </div>
        )}

        <div className="budget-panel">
          <div className="budget-row">
            <span className="field-label">Monthly loss limit</span>
            <span className="badge">R{budget.toFixed(2)}</span>
          </div>

          <div className="progress-track">
            <div
              className={`progress-fill${budgetUsagePercent > 85 ? ' is-danger' : ''}`}
              style={{ width: `${budgetUsagePercent}%` }}
            />
          </div>
          <span className="small-text">R{remainingBudget.toFixed(2)} remaining before threshold breach</span>
        </div>

        {(dailyValueLimit > 0 || dailyEntryLimit > 0) && (
          <div className="budget-panel">
            <h3 className="breakdown-title">Today&apos;s limits</h3>
            {dailyValueLimit > 0 && (
              <div className="breakdown-item">
                <div className="breakdown-label">
                  <span>Waste value</span>
                  <span>R{todayLoss.toFixed(2)} / R{dailyValueLimit.toFixed(2)}</span>
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

        {totalItems > 0 && (
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
              <span className="metric-value is-danger">R{preventableLoss.toFixed(2)}</span>
              <span className="metric-label">Preventable loss in this view ({preventablePercent}%)</span>
            </div>
          </div>
        )}

        {totalItems > 0 && (
          <div className="breakdown-grid breakdown-grid--three">
            <div>
              <h3 className="breakdown-title">Loss by reason</h3>
              {reasonRows.map((row) => (
                  <div key={row.label} className="breakdown-item">
                    <div className="breakdown-label">
                      <span>{row.label}</span>
                      <span>R{row.value.toFixed(2)} ({row.pct}%)</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${row.pct}%` }} />
                    </div>
                  </div>
              ))}
            </div>

            <div>
              <h3 className="breakdown-title">Staff accountability</h3>
              {staffRows.map((row) => (
                  <div key={row.label} className="breakdown-item">
                    <div className="breakdown-label">
                      <span>{row.label}</span>
                      <span>R{row.value.toFixed(2)}</span>
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
                      <span>R{row.value.toFixed(2)} ({row.pct}%)</span>
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
