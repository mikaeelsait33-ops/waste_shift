import { useEffect, useMemo, useState } from 'react';
import {
  loadInvoiceHistoryPage,
  loadInvoiceWorkspaceData,
  loadStockMovementPage,
} from '../services/invoiceFirestore';
import {
  createAccountingExport,
  createShiftSummaryReport,
  createShiftSummaryText,
  rowsToCsv,
} from '../utils/reports';

const getToday = () => new Date().toISOString().slice(0, 10);

const downloadTextFile = (filename, content, type = 'text/plain') => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

function Reports({ wasteItems, activeStaffMember, accessProfile }) {
  const today = getToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [includeLineItems, setIncludeLineItems] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);
  const [isLoadingReportData, setIsLoadingReportData] = useState(false);
  const [message, setMessage] = useState('');
  const canExport = Boolean(accessProfile?.canExportData || accessProfile?.canViewFinancials);

  useEffect(() => {
    let isMounted = true;

    if (!canExport) {
      return () => {};
    }

    setIsLoadingReportData(true);
    loadInvoiceWorkspaceData()
      .then(async (workspaceData) => {
        const allInvoices = [...(Array.isArray(workspaceData?.invoices) ? workspaceData.invoices : [])];
        const allStockMovements = [...(Array.isArray(workspaceData?.stockMovements) ? workspaceData.stockMovements : [])];
        let invoicePage = workspaceData?.pagination?.invoices || {};
        let stockPage = workspaceData?.pagination?.stockMovements || {};

        while (invoicePage.hasMore && allInvoices.length < 1000) {
          const nextPage = await loadInvoiceHistoryPage({ cursor: invoicePage.cursor, pageSize: 150 });
          allInvoices.push(...nextPage.records);
          invoicePage = nextPage;
        }
        while (stockPage.hasMore && allStockMovements.length < 1000) {
          const nextPage = await loadStockMovementPage({ cursor: stockPage.cursor, pageSize: 250 });
          allStockMovements.push(...nextPage.records);
          stockPage = nextPage;
        }

        if (isMounted) {
          setInvoices(allInvoices);
          setStockMovements(allStockMovements);
          if (invoicePage.hasMore || stockPage.hasMore) {
            setMessage('Report data reached the 1,000-record beta export limit. Narrow the date range for a complete export.');
          }
        }
      })
      .catch((error) => {
        if (isMounted) {
          setMessage(error?.message || 'Could not load invoice data for reports.');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingReportData(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [canExport]);

  const shiftSummary = useMemo(() => createShiftSummaryReport({
    wasteItems,
    invoices,
    stockMovements,
    startDate,
    endDate,
    preparedBy: activeStaffMember?.name || '',
    notes,
  }), [activeStaffMember?.name, endDate, invoices, notes, startDate, stockMovements, wasteItems]);

  const accountingExport = useMemo(() => createAccountingExport({
    invoices,
    startDate,
    endDate,
    includeLineItems,
  }), [endDate, includeLineItems, invoices, startDate]);
  const accountingTotals = useMemo(() => accountingExport.supplierTotals.reduce((totals, supplier) => ({
    invoiceCount: totals.invoiceCount + Number(supplier.invoiceCount || 0),
    totalExVAT: totals.totalExVAT + Number(supplier.totalExVAT || 0),
    vatAmount: totals.vatAmount + Number(supplier.vatAmount || 0),
    totalIncVAT: totals.totalIncVAT + Number(supplier.totalIncVAT || 0),
  }), {
    invoiceCount: 0,
    totalExVAT: 0,
    vatAmount: 0,
    totalIncVAT: 0,
  }), [accountingExport.supplierTotals]);

  const handleCopySummary = async () => {
    await navigator.clipboard.writeText(createShiftSummaryText(shiftSummary));
    setMessage('Owner summary copied.');
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadSummaryCsv = () => {
    const rows = [
      { metric: 'Waste entries', value: shiftSummary.totals.wasteEntries },
      { metric: 'Food cost lost', value: shiftSummary.totals.foodCostLost },
      { metric: 'Potential revenue lost', value: shiftSummary.totals.potentialRevenueLost },
      { metric: 'Gross profit lost', value: shiftSummary.totals.grossProfitLost },
      { metric: 'Invoices confirmed', value: shiftSummary.totals.invoiceCount },
      { metric: 'Stock movements', value: shiftSummary.totals.stockMovementCount },
    ];

    downloadTextFile(`wasteshift-shift-summary-${startDate}.csv`, rowsToCsv(rows), 'text/csv');
  };

  const handleDownloadAccountingCsv = () => {
    downloadTextFile(
      `wasteshift-accounting-export-${startDate}-to-${endDate}.csv`,
      rowsToCsv(accountingExport.rows),
      'text/csv'
    );
  };

  const handleDownloadJson = () => {
    downloadTextFile(
      `wasteshift-reports-${startDate}-to-${endDate}.json`,
      JSON.stringify({ shiftSummary, accountingExport }, null, 2),
      'application/json'
    );
  };

  if (!canExport) {
    return (
      <section className="panel">
        <div className="panel-body">
          <p className="eyebrow">Reports</p>
          <h2 className="title">Manager Reports</h2>
          <div className="notice-panel notice-panel--warning">
            Reports include financial totals and are available to manager or owner roles only.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="list-page reports-page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h2 className="title">Owner & Accounting Exports</h2>
          <p className="subtitle">Prepare end-of-shift summaries and invoice exports from one place.</p>
        </div>
        <span className="badge">{isLoadingReportData ? 'Loading Firebase records...' : `${accountingExport.rows.length} accounting rows`}</span>
      </div>

      <div className="toolbar">
        <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="input" />
        <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="input" />
        <label className="checkbox-row">
          <input type="checkbox" checked={includeLineItems} onChange={(event) => setIncludeLineItems(event.target.checked)} />
          Include invoice line items
        </label>
      </div>

      <div className="panel print-report">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Owner summary</p>
              <h2 className="title">End Of Shift</h2>
            </div>
            <span className="badge">Prepared by {activeStaffMember?.name || 'manager'}</span>
          </div>

          <div className="metrics-grid">
            <div className="metric-card"><span className="metric-value">{shiftSummary.totals.wasteEntries}</span><span className="metric-label">Waste entries</span></div>
            <div className="metric-card"><span className="metric-value is-danger">R{shiftSummary.totals.foodCostLost.toFixed(2)}</span><span className="metric-label">Food cost lost</span></div>
            <div className="metric-card"><span className="metric-value">R{shiftSummary.totals.potentialRevenueLost.toFixed(2)}</span><span className="metric-label">Revenue lost</span></div>
            <div className="metric-card"><span className="metric-value">R{shiftSummary.totals.grossProfitLost.toFixed(2)}</span><span className="metric-label">Gross profit lost</span></div>
            <div className="metric-card"><span className="metric-value">{shiftSummary.totals.invoiceCount}</span><span className="metric-label">Invoices</span></div>
            <div className="metric-card"><span className="metric-value">{shiftSummary.totals.stockMovementCount}</span><span className="metric-label">Stock movements</span></div>
          </div>

          <div className="breakdown-grid">
            <div>
              <h3 className="breakdown-title">Top wasted items</h3>
              {shiftSummary.topWastedItems.length === 0 ? <div className="empty-state">No waste in this range.</div> : shiftSummary.topWastedItems.map((item) => (
                <div key={item.label} className="breakdown-item"><span>{item.label}</span><strong>R{item.value.toFixed(2)}</strong></div>
              ))}
            </div>
            <div>
              <h3 className="breakdown-title">Top reasons</h3>
              {shiftSummary.topWasteReasons.length === 0 ? <div className="empty-state">No reasons yet.</div> : shiftSummary.topWasteReasons.map((item) => (
                <div key={item.label} className="breakdown-item"><span>{item.label}</span><strong>{item.count}</strong></div>
              ))}
            </div>
          </div>

          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Owner notes or shift handover comments" className="input note-textarea" />

          <div className="manager-row">
            <button type="button" className="ghost-button is-warning" onClick={handleDownloadSummaryCsv}>Download summary CSV</button>
            <button type="button" className="ghost-button" onClick={handleCopySummary}>Copy summary</button>
            <button type="button" className="ghost-button" onClick={handlePrint}>Print / Save PDF</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Accounting</p>
              <h2 className="title">Invoice Export</h2>
            </div>
            <span className="badge">{accountingExport.supplierTotals.length} suppliers</span>
          </div>

          <div className="manager-row">
            <button type="button" className="primary-button" onClick={handleDownloadAccountingCsv} disabled={accountingExport.rows.length === 0}>Download accounting CSV</button>
            <button type="button" className="ghost-button" onClick={handleDownloadJson}>Download JSON backup</button>
          </div>

          <div className="metrics-grid" style={{ marginTop: 16 }}>
            <div className="metric-card"><span className="metric-value">{accountingTotals.invoiceCount}</span><span className="metric-label">Invoices</span></div>
            <div className="metric-card"><span className="metric-value">R{accountingTotals.totalExVAT.toFixed(2)}</span><span className="metric-label">Spend excl VAT</span></div>
            <div className="metric-card"><span className="metric-value">R{accountingTotals.vatAmount.toFixed(2)}</span><span className="metric-label">VAT</span></div>
            <div className="metric-card"><span className="metric-value">R{accountingTotals.totalIncVAT.toFixed(2)}</span><span className="metric-label">Spend incl VAT</span></div>
          </div>

          {message && <div className="empty-state">{message}</div>}
        </div>
      </div>
    </section>
  );
}

export default Reports;
