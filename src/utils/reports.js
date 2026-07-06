import {
  getEntryFoodCostLost,
  getEntryGrossProfitLost,
  getEntryPotentialRevenueLost,
} from './wasteCalculations.js';
import { getActiveWasteEntries } from './wasteSync.js';

const parseWasteDate = (value) => {
  if (!value) return new Date(0);
  const parts = String(value).split('/');

  if (parts.length === 3) {
    const [day, month, year] = parts;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(value);
};

const inDateRange = (date, startDate, endDate) => {
  const value = new Date(date);
  const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
  const end = endDate ? new Date(`${endDate}T23:59:59`) : null;

  if (start && value < start) return false;
  if (end && value > end) return false;
  return true;
};

const countBy = (items, getKey) => (
  [...items.reduce((acc, item) => {
    const key = String(getKey(item) || 'Unspecified').trim() || 'Unspecified';
    const current = acc.get(key) || { label: key, count: 0, value: 0 };

    current.count += 1;
    current.value += getEntryFoodCostLost(item);
    acc.set(key, current);
    return acc;
  }, new Map()).values()].sort((a, b) => b.value - a.value || b.count - a.count)
);

export const createShiftSummaryReport = ({
  wasteItems = [],
  invoices = [],
  stockMovements = [],
  startDate,
  endDate,
  preparedBy = '',
  notes = '',
} = {}) => {
  const activeWaste = getActiveWasteEntries(wasteItems).filter((entry) => (
    inDateRange(parseWasteDate(entry?.date), startDate, endDate)
  ));
  const invoiceRows = invoices.filter((invoice) => (
    inDateRange(invoice.invoiceDate || invoice.scannedAt || invoice.createdAt, startDate, endDate)
  ));
  const movementRows = stockMovements.filter((movement) => (
    inDateRange(movement.createdAt || movement.timestamp, startDate, endDate)
  ));
  const totalFoodCostLost = activeWaste.reduce((sum, entry) => sum + getEntryFoodCostLost(entry), 0);
  const totalPotentialRevenueLost = activeWaste.reduce((sum, entry) => sum + getEntryPotentialRevenueLost(entry), 0);
  const totalGrossProfitLost = activeWaste.reduce((sum, entry) => sum + getEntryGrossProfitLost(entry), 0);

  return {
    type: 'shift-summary',
    startDate,
    endDate,
    preparedBy,
    generatedAt: new Date().toISOString(),
    notes,
    totals: {
      wasteEntries: activeWaste.length,
      foodCostLost: Number(totalFoodCostLost.toFixed(2)),
      potentialRevenueLost: Number(totalPotentialRevenueLost.toFixed(2)),
      grossProfitLost: Number(totalGrossProfitLost.toFixed(2)),
      invoiceCount: invoiceRows.length,
      stockMovementCount: movementRows.length,
      costReviewWarnings: activeWaste.filter((entry) => String(entry?.costStatus || '').startsWith('needs_')).length,
    },
    topWastedItems: countBy(activeWaste, (entry) => entry.name).slice(0, 8),
    topWasteReasons: countBy(activeWaste, (entry) => entry.reason).slice(0, 8),
    sectionBreakdown: countBy(activeWaste, (entry) => entry.department || entry.category).slice(0, 8),
    classificationBreakdown: countBy(activeWaste, (entry) => entry.wasteClassificationLabel || entry.wasteClassification).slice(0, 8),
  };
};

export const createAccountingExport = ({ invoices = [], startDate, endDate, includeLineItems = false } = {}) => {
  const invoiceRows = invoices.filter((invoice) => (
    inDateRange(invoice.invoiceDate || invoice.scannedAt || invoice.createdAt, startDate, endDate)
    && !['deleted', 'voided', 'cancelled', 'canceled'].includes(String(invoice.status || '').toLowerCase())
  ));
  const rows = [];

  invoiceRows.forEach((invoice) => {
    const baseRow = {
      supplier: invoice.supplierName || invoice.supplier || 'Unknown supplier',
      invoiceNumber: invoice.invoiceNumber || invoice.id || '',
      invoiceDate: invoice.invoiceDate || invoice.scannedAt || '',
      totalExVAT: Number(invoice.totalExVAT ?? invoice.totalExVat ?? invoice.subtotal ?? 0),
      vatAmount: Number(invoice.vatAmount ?? invoice.totalVAT ?? invoice.totalVat ?? 0),
      totalIncVAT: Number(invoice.totalIncVAT ?? invoice.totalIncVat ?? invoice.totalAmount ?? invoice.total ?? 0),
      status: invoice.status || '',
    };

    if (!includeLineItems) {
      rows.push(baseRow);
      return;
    }

    const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];

    if (lineItems.length === 0) {
      rows.push(baseRow);
      return;
    }

    lineItems.forEach((lineItem) => {
      rows.push({
        ...baseRow,
        itemDescription: lineItem.description || lineItem.name || '',
        quantity: lineItem.quantity ?? '',
        unit: lineItem.purchaseUnit || lineItem.unit || '',
        lineTotal: lineItem.lineTotal ?? lineItem.total ?? '',
      });
    });
  });

  const supplierTotals = [...invoiceRows.reduce((acc, invoice) => {
    const supplier = invoice.supplierName || invoice.supplier || 'Unknown supplier';
    const current = acc.get(supplier) || { supplier, invoiceCount: 0, totalExVAT: 0, vatAmount: 0, totalIncVAT: 0 };

    current.invoiceCount += 1;
    current.totalExVAT += Number(invoice.totalExVAT ?? invoice.totalExVat ?? invoice.subtotal ?? 0);
    current.vatAmount += Number(invoice.vatAmount ?? invoice.totalVAT ?? invoice.totalVat ?? 0);
    current.totalIncVAT += Number(invoice.totalIncVAT ?? invoice.totalIncVat ?? invoice.totalAmount ?? invoice.total ?? 0);
    acc.set(supplier, current);
    return acc;
  }, new Map()).values()].map((supplier) => ({
    ...supplier,
    totalExVAT: Number(supplier.totalExVAT.toFixed(2)),
    vatAmount: Number(supplier.vatAmount.toFixed(2)),
    totalIncVAT: Number(supplier.totalIncVAT.toFixed(2)),
  }));

  return {
    type: 'accounting-export',
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    rows,
    supplierTotals,
  };
};

const escapeCsvValue = (value) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const rowsToCsv = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '';
  }

  const headers = [...rows.reduce((acc, row) => {
    Object.keys(row || {}).forEach((key) => acc.add(key));
    return acc;
  }, new Set())];

  return [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row?.[header])).join(',')),
  ].join('\n');
};

export const createShiftSummaryText = (report) => [
  `WasteShift shift summary: ${report.startDate || 'start'} to ${report.endDate || 'end'}`,
  `Prepared by: ${report.preparedBy || 'Unspecified'}`,
  `Waste entries: ${report.totals.wasteEntries}`,
  `Food cost lost: R${report.totals.foodCostLost.toFixed(2)}`,
  `Potential revenue lost: R${report.totals.potentialRevenueLost.toFixed(2)}`,
  `Gross profit lost: R${report.totals.grossProfitLost.toFixed(2)}`,
  `Top wasted items: ${report.topWastedItems.map((item) => `${item.label} (${item.count})`).join(', ') || 'None'}`,
  report.notes ? `Notes: ${report.notes}` : '',
].filter(Boolean).join('\n');
