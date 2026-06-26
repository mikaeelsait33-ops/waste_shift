import { useState } from 'react';

function Dashboard({ items, budget, setBudget }) {
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [tempBudget, setTempBudget] = useState(budget);

  const totalItems = items.length;
  const totalFinancialLoss = items.reduce((sum, item) => sum + item.cost, 0);
  const remainingBudget = Math.max(0, budget - totalFinancialLoss);
  const budgetUsagePercent = Math.min(100, (totalFinancialLoss / budget) * 100);

  // 📈 1. Calculate Breakdown Analytics by Reason
  const reasonMetrics = items.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] || 0) + item.cost;
    return acc;
  }, {});

  // 🧑‍🍳 2. Calculate Loss Tracking per Staff Member
  const staffMetrics = items.reduce((acc, item) => {
    const name = item.staff || "Unassigned";
    acc[name] = (acc[name] || 0) + item.cost;
    return acc;
  }, {});

  const saveBudget = () => {
    setBudget(parseFloat(tempBudget) || 0);
    setIsEditingBudget(false);
  };

  return (
    <div style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '12px', border: '1px solid #2d2d2d', marginBottom: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
      <h2 style={{ margin: '0 0 15px 0', textAlign: 'center', fontSize: '1.2rem', color: '#aaa', letterSpacing: '1px' }}>IMPACT ANALYTICS DASHBOARD</h2>
      
      {/* Top Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
        <div style={{ backgroundColor: '#141414', padding: '15px', borderRadius: '8px', textAlign: 'center', border: '1px solid #222' }}>
          <span style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#4CAF50', display: 'block' }}>{totalItems}</span>
          <span style={{ fontSize: '0.8rem', color: '#777' }}>Items Wasted</span>
        </div>
        
        <div style={{ backgroundColor: '#141414', padding: '15px', borderRadius: '8px', textAlign: 'center', border: '1px solid #222' }}>
          <span style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#ff4d4d', display: 'block' }}>R{totalFinancialLoss.toFixed(2)}</span>
          <span style={{ fontSize: '0.8rem', color: '#777' }}>Financial Loss</span>
        </div>
      </div>

      {/* Budget Monitor Progress Bar */}
      <div style={{ backgroundColor: '#141414', padding: '15px', borderRadius: '8px', border: '1px solid #222', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.85rem', color: '#aaa' }}>Monthly Loss Limit:</span>
          {isEditingBudget ? (
            <div style={{ display: 'flex', gap: '4px' }}>
              <input type="number" value={tempBudget} onChange={(e) => setTempBudget(e.target.value)} style={{ width: '70px', backgroundColor: '#222', border: '1px solid #444', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontSize: '0.85rem' }} />
              <button onClick={saveBudget} style={{ backgroundColor: '#4CAF50', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 6px' }}>✓</button>
            </div>
          ) : (
            <span onClick={() => setIsEditingBudget(true)} style={{ color: '#ff9800', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}>
              R{budget.toFixed(2)} 📝
            </span>
          )}
        </div>

        <div style={{ width: '100%', height: '8px', backgroundColor: '#333', borderRadius: '4px', overflow: 'hidden', marginBottom: '6px' }}>
          <div style={{ width: `${budgetUsagePercent}%`, height: '100%', backgroundColor: budgetUsagePercent > 85 ? '#ff4d4d' : '#ff9800', transition: 'width 0.4s' }}></div>
        </div>
        <span style={{ fontSize: '0.75rem', color: '#666' }}>R{remainingBudget.toFixed(2)} remaining allowance before threshold breach</span>
      </div>

      {/* 📊 Brand New Section: Reason & Staff Breakdown Leaderboards */}
      {totalItems > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px', borderTop: '1px solid #2d2d2d', paddingTop: '15px' }}>
          
          {/* Reason Breakdown Panel */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#ff9800' }}>📉 LOSS BREAKDOWN BY REASON</h4>
            {Object.keys(reasonMetrics).map((reasonKey) => {
              const cost = reasonMetrics[reasonKey];
              const pct = ((cost / totalFinancialLoss) * 100).toFixed(0);
              return (
                <div key={reasonKey} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#ccc', marginBottom: '2px' }}>
                    <span>{reasonKey}</span>
                    <span>R{cost.toFixed(2)} ({pct}%)</span>
                  </div>
                  <div style={{ width: '100%', height: '5px', backgroundColor: '#222', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#ff9800' }}></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Staff Tracker Panel */}
          <div style={{ marginTop: '5px' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#4CAF50' }}>🧑‍🍳 STAFF WASTE ACCOUNTABILITY</h4>
            {Object.keys(staffMetrics).map((staffName) => {
              const cost = staffMetrics[staffName];
              const pct = ((cost / totalFinancialLoss) * 100).toFixed(0);
              return (
                <div key={staffName} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#ccc', marginBottom: '2px' }}>
                    <span>{staffName}</span>
                    <span>R{cost.toFixed(2)}</span>
                  </div>
                  <div style={{ width: '100%', height: '5px', backgroundColor: '#222', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#4CAF50' }}></div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}

export default Dashboard;