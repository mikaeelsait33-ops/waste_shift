import { useState } from 'react';

const timeframes = ['all', 'day', 'week', 'month', 'year'];

function Dashboard({ items, budget, setBudget }) {
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [tempBudget, setTempBudget] = useState(budget);
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
  const remainingBudget = Math.max(0, budget - totalFinancialLoss);
  const budgetUsagePercent = budget > 0 ? Math.min(100, (totalFinancialLoss / budget) * 100) : 0;

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

  const getTopMetric = (metricsObj) => {
    const entries = Object.entries(metricsObj);
    if (entries.length === 0) return null;
    return entries.sort((a, b) => b[1] - a[1])[0];
  };

  const topItem = getTopMetric(itemMetrics);
  const topReason = getTopMetric(reasonMetrics);
  const topStaff = getTopMetric(staffMetrics);

  const saveBudget = () => {
    setBudget(parseFloat(tempBudget) || 0);
    setIsEditingBudget(false);
  };

  const timeframeLabel = timeframe === 'all' ? 'All Time' : timeframe === 'day' ? 'Today' : `This ${timeframe}`;

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

        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-value">{totalItems}</span>
            <span className="metric-label">Items wasted</span>
          </div>
          <div className="metric-card">
            <span className="metric-value is-danger">R{totalFinancialLoss.toFixed(2)}</span>
            <span className="metric-label">Financial loss</span>
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
            {isEditingBudget ? (
              <div className="manager-row">
                <input
                  type="number"
                  value={tempBudget}
                  onChange={(e) => setTempBudget(e.target.value)}
                  className="input"
                  style={{ width: '110px' }}
                />
                <button type="button" onClick={saveBudget} className="ghost-button is-warning">
                  Save
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setIsEditingBudget(true)} className="ghost-button is-warning">
                R{budget.toFixed(2)}
              </button>
            )}
          </div>

          <div className="progress-track">
            <div
              className={`progress-fill${budgetUsagePercent > 85 ? ' is-danger' : ''}`}
              style={{ width: `${budgetUsagePercent}%` }}
            />
          </div>
          <span className="small-text">R{remainingBudget.toFixed(2)} remaining before threshold breach</span>
        </div>

        {totalItems > 0 && (
          <div className="breakdown-grid">
            <div>
              <h3 className="breakdown-title">Loss by reason</h3>
              {Object.keys(reasonMetrics).map((reasonKey) => {
                const cost = reasonMetrics[reasonKey] || 0;
                const pct = totalFinancialLoss > 0 ? ((cost / totalFinancialLoss) * 100).toFixed(0) : 0;

                return (
                  <div key={reasonKey} className="breakdown-item">
                    <div className="breakdown-label">
                      <span>{reasonKey}</span>
                      <span>R{cost.toFixed(2)} ({pct}%)</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <h3 className="breakdown-title">Staff accountability</h3>
              {Object.keys(staffMetrics).map((staffName) => {
                const cost = staffMetrics[staffName] || 0;
                const pct = totalFinancialLoss > 0 ? ((cost / totalFinancialLoss) * 100).toFixed(0) : 0;

                return (
                  <div key={staffName} className="breakdown-item">
                    <div className="breakdown-label">
                      <span>{staffName}</span>
                      <span>R{cost.toFixed(2)}</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default Dashboard;
