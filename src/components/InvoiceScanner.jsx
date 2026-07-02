import { useEffect, useMemo, useRef, useState } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import {
  INVOICE_CATEGORIES,
  calculateRecipeCostImpact,
  calculateVatValues,
  createInvoiceKey,
  getBaseUnitInfo,
  getIngredientMatch,
  getLinkedMenuItemsForIngredient,
  normalizeInvoiceUnit,
  roundMoney,
  summarizeInvoiceItems,
} from '../utils/invoiceParsing';
import { createItemPriceKey, roundUnitPrice } from '../utils/itemPriceCatalog';
import {
  deleteIngredient,
  invoiceFirestoreIsConfigured,
  loadInvoiceWorkspaceData,
  saveConfirmedInvoice,
  saveIngredient,
  saveInvoiceSettings,
  softDeleteInvoice,
  updateStockFromInvoice,
} from '../services/invoiceFirestore';
import { createLowStockAlerts } from '../utils/stockAlerts';
import { createRecordId } from '../utils/ids';
import {
  buildCostReviewQueue,
  getLatestPriceChange,
  normalizeIngredientRecord,
} from '../utils/ingredientIntelligence';
import { DEFAULT_PAGE_SIZE, getVisiblePage } from '../utils/listPerformance';
import { getManagerApiHeaders } from '../utils/apiHeaders';

const DEFAULT_VAT_RATE = 0.15;
const UNIT_OPTIONS = ['kg', 'g', 'L', 'ml', 'each', '5L', 'case of 12', 'case', 'doz', 'pkt', 'bag', 'box', 'bottle', 'tray', 'tin', 'punnet', 'bunch', 'head', 'pillow'];
const SCAN_IMAGE_MAX_EDGE = 1800;
const SCAN_IMAGE_QUALITY = 0.84;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const SUPPORTED_SCAN_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const INVOICE_REVIEW_PAGE_SIZE = 20;
const INGREDIENT_LIBRARY_PAGE_SIZE = 30;

const formatMoney = (value) => `R${Number(value || 0).toFixed(2)}`;
const formatUnitMoney = (value) => `R${Number(value || 0).toFixed(4)}`;
const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;
const escapeCsvValue = (value) => {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};
const downloadCsv = (filename, headers, rows) => {
  const csv = [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => row.map(escapeCsvValue).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
const EMPTY_MANUAL_LINE = {
  itemName: '',
  quantity: '1',
  unit: 'kg',
  unitPrice: '',
  lineTotal: '',
};

const createLocalMenuItems = (recipes, menuItems) => (
  (Array.isArray(menuItems) ? menuItems : []).map((menuItem) => {
    const recipe = recipes?.[menuItem.key] || {};
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

    return {
      id: menuItem.key,
      key: menuItem.key,
      name: menuItem.name,
      totalCost: Number(recipe.totalCost) || ingredients.reduce((sum, ingredient) => sum + Number(ingredient.cost || 0), 0),
      recipe: ingredients.map((ingredient) => ({
        ingredientName: ingredient.name,
        quantity: Number.parseFloat(String(ingredient.quantity || '1')) || 1,
        unit: String(ingredient.quantity || '').match(/\b(kg|g|l|ml|each|case|doz|pkt)\b/i)?.[1] || 'each',
        cost: Number(ingredient.cost) || 0,
      })),
    };
  })
);

const mergeMenuItems = (firestoreMenuItems, localMenuItems) => {
  const byId = new Map();

  localMenuItems.forEach((item) => byId.set(item.id || item.key, item));
  firestoreMenuItems.forEach((item) => byId.set(item.id || item.key, {
    ...byId.get(item.id || item.key),
    ...item,
  }));

  return [...byId.values()].filter((item) => item?.name);
};

const readBlobAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();

  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not read this invoice file.'));
  reader.readAsDataURL(blob);
});

const getBase64FromDataUrl = (dataUrl) => String(dataUrl || '').split(',').pop() || '';

const getApproxBase64Bytes = (data) => Math.ceil(String(data || '').length * 0.75);

const assertScanPayloadSize = (data) => {
  if (getApproxBase64Bytes(data) > MAX_SCAN_BYTES) {
    throw new Error('This invoice file is too large. Try a cropped photo or a smaller PDF.');
  }
};

const createImageScanPayload = (file) => new Promise((resolve, reject) => {
  const imageUrl = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => {
    const scale = Math.min(1, SCAN_IMAGE_MAX_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(imageUrl);

    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('Could not prepare this invoice photo.'));
        return;
      }

      try {
        const dataUrl = await readBlobAsDataUrl(blob);
        const data = getBase64FromDataUrl(dataUrl);

        assertScanPayloadSize(data);
        resolve({
          name: file.name,
          mimeType: 'image/jpeg',
          data,
        });
      } catch (error) {
        reject(error);
      }
    }, 'image/jpeg', SCAN_IMAGE_QUALITY);
  };

  image.onerror = () => {
    URL.revokeObjectURL(imageUrl);
    reject(new Error('Could not load this invoice photo.'));
  };
  image.src = imageUrl;
});

const createScanPayload = async (file) => {
  if (!file || !SUPPORTED_SCAN_TYPES.has(file.type)) {
    throw new Error('Upload a JPG, PNG, WEBP, or PDF invoice.');
  }

  if (file.type.startsWith('image/')) {
    return createImageScanPayload(file);
  }

  const dataUrl = await readBlobAsDataUrl(file);
  const data = getBase64FromDataUrl(dataUrl);

  assertScanPayloadSize(data);
  return {
    name: file.name,
    mimeType: file.type,
    data,
  };
};

const getScannedLineTotal = (item, nextVatMode) => {
  const lineTotal = Number(item?.lineTotal);
  const modeTotal = nextVatMode === 'exclusive'
    ? Number(item?.exclusiveTotal)
    : Number(item?.inclusiveTotal);
  const fallbackTotal = nextVatMode === 'exclusive'
    ? Number(item?.inclusiveTotal)
    : Number(item?.exclusiveTotal);

  if (Number.isFinite(lineTotal) && lineTotal > 0) return lineTotal;
  if (Number.isFinite(modeTotal) && modeTotal > 0) return modeTotal;
  if (Number.isFinite(fallbackTotal) && fallbackTotal > 0) return fallbackTotal;
  return 0;
};

const createIngredientRows = ({ lineItems, matches, newIngredientDrafts, supplierName, menuItems }) => (
  lineItems.map((lineItem) => {
    const match = matches.get(lineItem.id);
    const draft = newIngredientDrafts[lineItem.id];
    const ingredient = match?.ingredient || null;
    const ingredientName = ingredient?.name || draft?.name || lineItem.itemName;
    const ingredientId = ingredient?.id || draft?.id || createInvoiceKey(ingredientName);
    const previousPrice = Number(ingredient?.lastPriceExVAT || 0);
    const nextUnitPriceExVAT = Number(lineItem.unitPriceExVAT || lineItem.unitPrice || 0);
    const inferredLinks = getLinkedMenuItemsForIngredient(ingredientName, menuItems);
    const linkedMenuItemIds = [
      ...(Array.isArray(ingredient?.linkedMenuItemIds) ? ingredient.linkedMenuItemIds : []),
      ...(Array.isArray(draft?.linkedMenuItemIds) ? draft.linkedMenuItemIds : []),
      ...inferredLinks.map(({ menuItem }) => menuItem.id || menuItem.key).filter(Boolean),
    ].filter((value, index, values) => value && values.indexOf(value) === index);
    const changePercent = previousPrice > 0
      ? roundMoney(((nextUnitPriceExVAT - previousPrice) / previousPrice) * 100)
      : 0;

    return {
      lineItemId: lineItem.id,
      ingredientId,
      ingredientName,
      category: ingredient?.category || draft?.category || 'Other',
      unit: lineItem.baseUnit || lineItem.unit || ingredient?.unit || 'each',
      priceUnit: lineItem.unit || ingredient?.unit || 'each',
      invoiceQuantity: lineItem.quantity,
      invoiceUnit: lineItem.unit || 'each',
      baseQuantity: lineItem.baseQuantity,
      baseUnit: lineItem.baseUnit,
      parLevel: Number(draft?.parLevel ?? ingredient?.parLevel ?? 0) || 0,
      reorderPoint: Number(draft?.reorderPoint ?? ingredient?.reorderPoint ?? 0) || 0,
      preferredSupplier: draft?.preferredSupplier || ingredient?.preferredSupplier || supplierName,
      linkedMenuItemIds,
      linkedRecipeNames: inferredLinks.map(({ menuItem }) => menuItem.name).filter(Boolean),
      matchScore: Number(match?.score || 0),
      priceExVAT: lineItem.priceExVAT,
      priceIncVAT: lineItem.priceIncVAT,
      unitPriceExVAT: lineItem.unitPriceExVAT,
      unitPriceIncVAT: lineItem.unitPriceIncVAT,
      costPerBaseUnitExVAT: lineItem.costPerBaseUnitExVAT,
      previousPriceExVAT: previousPrice,
      priceChangePercent: changePercent,
      priceDirection: previousPrice <= 0 ? 'new' : changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat',
    };
  })
);

function InvoiceScanner({
  accessProfile,
  recipes,
  menuItems,
  itemPriceCatalog,
  inventoryMovements = [],
  onInvoiceSaved,
  onInvoicePricesUpdated,
  onIngredientDeleted,
}) {
  const [workspace, setWorkspace] = useState({
    ingredients: [],
    menuItems: [],
    stockLevels: [],
    invoices: [],
    suppliers: [],
    settings: { vatRate: DEFAULT_VAT_RATE },
  });
  const [activeView, setActiveView] = useState('entry');
  const [message, setMessage] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vatRate, setVatRate] = useState(DEFAULT_VAT_RATE);
  const [vatMode, setVatMode] = useState('inclusive');
  const [lineItems, setLineItems] = useState([]);
  const [extractedTotals, setExtractedTotals] = useState(null);
  const [manualLineDraft, setManualLineDraft] = useState(EMPTY_MANUAL_LINE);
  const [manualIngredientLinks, setManualIngredientLinks] = useState({});
  const [scanFile, setScanFile] = useState(null);
  const [scanFiles, setScanFiles] = useState([]);
  const [batchDrafts, setBatchDrafts] = useState([]);
  const [activeBatchDraftId, setActiveBatchDraftId] = useState('');
  const [isScanningInvoice, setIsScanningInvoice] = useState(false);
  const [isBatchScanning, setIsBatchScanning] = useState(false);
  const [scanSummary, setScanSummary] = useState(null);
  const scanFileInputRef = useRef(null);
  const [newDrawerLineId, setNewDrawerLineId] = useState('');
  const [newIngredientDrafts, setNewIngredientDrafts] = useState({});
  const [confirmedInvoice, setConfirmedInvoice] = useState(null);
  const [stockUpdates, setStockUpdates] = useState([]);
  const [isConfirmingInvoice, setIsConfirmingInvoice] = useState(false);
  const [isUpdatingStock, setIsUpdatingStock] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [priceHistorySupplierFilter, setPriceHistorySupplierFilter] = useState('');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [visibleLineLimit, setVisibleLineLimit] = useState(INVOICE_REVIEW_PAGE_SIZE);
  const [visibleIngredientLimit, setVisibleIngredientLimit] = useState(INGREDIENT_LIBRARY_PAGE_SIZE);
  const [visibleInvoiceLimit, setVisibleInvoiceLimit] = useState(DEFAULT_PAGE_SIZE);
  const [deletingIngredientId, setDeletingIngredientId] = useState('');
  const [deletingInvoiceId, setDeletingInvoiceId] = useState('');

  const canManageInvoices = Boolean(accessProfile?.canUseAiImports);
  const canExportInvoiceReports = Boolean(accessProfile?.canExportData);
  const firebaseReady = invoiceFirestoreIsConfigured();
  const localMenuItems = useMemo(() => createLocalMenuItems(recipes, menuItems), [recipes, menuItems]);
  const allMenuItems = useMemo(() => (
    mergeMenuItems(workspace.menuItems, localMenuItems)
  ), [localMenuItems, workspace.menuItems]);
  const autoMatches = useMemo(() => {
    const lookup = new Map();

    lineItems.forEach((lineItem) => {
      lookup.set(lineItem.id, getIngredientMatch(lineItem.itemName, workspace.ingredients));
    });

    return lookup;
  }, [lineItems, workspace.ingredients]);
  const matches = useMemo(() => {
    const lookup = new Map();

    lineItems.forEach((lineItem) => {
      const manualLink = manualIngredientLinks[lineItem.id];

      if (manualLink === '__new__') {
        lookup.set(lineItem.id, { ingredient: null, score: 0, source: 'manual-new' });
        return;
      }

      if (manualLink) {
        const ingredient = workspace.ingredients.find((item) => item.id === manualLink);

        lookup.set(lineItem.id, ingredient
          ? { ingredient, score: 1, source: 'manual' }
          : autoMatches.get(lineItem.id) || { ingredient: null, score: 0 });
        return;
      }

      lookup.set(lineItem.id, autoMatches.get(lineItem.id) || { ingredient: null, score: 0 });
    });

    return lookup;
  }, [autoMatches, lineItems, manualIngredientLinks, workspace.ingredients]);
  const matchedCount = [...matches.values()].filter((match) => match.ingredient).length;
  const newLineItems = lineItems.filter((lineItem) => !matches.get(lineItem.id)?.ingredient);
  const visibleLinePage = useMemo(() => getVisiblePage(lineItems, {
    limit: visibleLineLimit,
    fallbackLimit: INVOICE_REVIEW_PAGE_SIZE,
  }), [lineItems, visibleLineLimit]);
  const totals = useMemo(() => summarizeInvoiceItems(lineItems), [lineItems]);
  const hasExtractedTotals = extractedTotals
    && Number(extractedTotals.totalIncVAT || extractedTotals.totalExVAT || extractedTotals.totalVAT) > 0;
  const duplicateInvoices = useMemo(() => {
    const supplierKey = createInvoiceKey(supplierName);
    const reviewedTotal = roundMoney(totals.totalIncVAT);
    const printedInvoiceNumber = String(invoiceNumber || '').trim().toLowerCase();

    if (!supplierKey || !invoiceDate || reviewedTotal <= 0) {
      return [];
    }

    return workspace.invoices.filter((invoice) => {
      if (String(invoice.status || '').toLowerCase() === 'deleted') {
        return false;
      }

      const existingSupplierKey = createInvoiceKey(invoice.supplier || invoice.supplierName || '');
      const existingDate = String(invoice.invoiceDate || invoice.date || '').slice(0, 10);
      const existingTotal = roundMoney(invoice.totalIncVAT ?? invoice.total);
      const existingInvoiceNumber = String(invoice.invoiceNumber || '').trim().toLowerCase();
      const sameInvoiceNumber = printedInvoiceNumber && existingInvoiceNumber && printedInvoiceNumber === existingInvoiceNumber;
      const sameSupplierDateTotal = existingSupplierKey === supplierKey
        && existingDate === invoiceDate
        && Math.abs(existingTotal - reviewedTotal) <= 0.02;

      return sameInvoiceNumber || sameSupplierDateTotal;
    });
  }, [invoiceDate, invoiceNumber, supplierName, totals.totalIncVAT, workspace.invoices]);
  const ingredientRows = useMemo(() => createIngredientRows({
    lineItems,
    matches,
    newIngredientDrafts,
    supplierName,
    menuItems: allMenuItems,
  }), [allMenuItems, lineItems, matches, newIngredientDrafts, supplierName]);
  const recipeImpact = useMemo(() => calculateRecipeCostImpact({
    lineItems,
    menuItems: allMenuItems,
    ingredients: workspace.ingredients,
  }), [allMenuItems, lineItems, workspace.ingredients]);
  const filteredInvoices = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    const start = historyStartDate ? new Date(historyStartDate) : null;
    const end = historyEndDate ? new Date(historyEndDate) : null;

    return workspace.invoices.filter((invoice) => {
      if (String(invoice.status || '').toLowerCase() === 'deleted') return false;

      const invoiceDateValue = new Date(invoice.invoiceDate || invoice.scannedAt || 0);
      const matchesSearch = !search || String(invoice.supplier || '').toLowerCase().includes(search);

      if (!matchesSearch) return false;
      if (start && invoiceDateValue < start) return false;
      if (end && invoiceDateValue > end) return false;
      return true;
    });
  }, [historyEndDate, historySearch, historyStartDate, workspace.invoices]);
  const visibleInvoicePage = useMemo(() => getVisiblePage(filteredInvoices, {
    limit: visibleInvoiceLimit,
    fallbackLimit: DEFAULT_PAGE_SIZE,
  }), [filteredInvoices, visibleInvoiceLimit]);
  const historySummary = useMemo(() => ({
    totalExVAT: roundMoney(filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.totalExVAT || 0), 0)),
    totalVAT: roundMoney(filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.totalVAT || 0), 0)),
    totalIncVAT: roundMoney(filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.totalIncVAT || 0), 0)),
  }), [filteredInvoices]);
  const reportData = useMemo(() => {
    const start = reportStartDate ? new Date(reportStartDate) : null;
    const end = reportEndDate ? new Date(reportEndDate) : null;
    const activeInvoices = workspace.invoices
      .filter((invoice) => String(invoice.status || '').toLowerCase() !== 'deleted')
      .filter((invoice) => {
        const invoiceDateValue = new Date(invoice.invoiceDate || invoice.scannedAt || 0);

        if (start && invoiceDateValue < start) return false;
        if (end && invoiceDateValue > end) return false;
        return true;
      });
    const supplierSpend = new Map();
    const ingredientSpend = new Map();
    const invoiceLineRows = [];

    activeInvoices.forEach((invoice) => {
      const supplier = invoice.supplier || invoice.supplierName || 'Unknown supplier';
      const invoiceSpend = Number(invoice.totalExVAT || 0);
      const currentSupplier = supplierSpend.get(supplier) || {
        supplier,
        invoices: 0,
        spendExVAT: 0,
        spendIncVAT: 0,
      };

      supplierSpend.set(supplier, {
        ...currentSupplier,
        invoices: currentSupplier.invoices + 1,
        spendExVAT: roundMoney(currentSupplier.spendExVAT + invoiceSpend),
        spendIncVAT: roundMoney(currentSupplier.spendIncVAT + Number(invoice.totalIncVAT || 0)),
      });

      (Array.isArray(invoice.lineItems) ? invoice.lineItems : []).forEach((lineItem) => {
        const itemName = lineItem.itemName || lineItem.name || 'Unknown item';
        const lineSpend = Number(lineItem.priceExVAT ?? lineItem.lineTotal ?? 0);
        const currentIngredient = ingredientSpend.get(itemName) || {
          name: itemName,
          quantity: 0,
          spendExVAT: 0,
          unit: lineItem.unit || '',
          suppliers: new Set(),
        };

        currentIngredient.quantity += Number(lineItem.quantity || 0);
        currentIngredient.spendExVAT = roundMoney(currentIngredient.spendExVAT + lineSpend);
        currentIngredient.suppliers.add(supplier);
        ingredientSpend.set(itemName, currentIngredient);
        invoiceLineRows.push({
          invoiceDate: invoice.invoiceDate || '',
          supplier,
          invoiceNumber: invoice.invoiceNumber || '',
          itemName,
          quantity: lineItem.quantity || '',
          unit: lineItem.unit || '',
          unitPriceExVAT: Number(lineItem.unitPriceExVAT ?? lineItem.unitPrice ?? 0),
          lineExVAT: lineSpend,
          lineIncVAT: Number(lineItem.priceIncVAT ?? lineItem.inclusiveTotal ?? 0),
        });
      });
    });

    const priceHistoryRows = workspace.ingredients.flatMap((ingredient) => (
      (Array.isArray(ingredient.priceHistory) ? ingredient.priceHistory : [])
        .filter((history) => {
          const historyDate = new Date(history.date || history.createdAt || 0);

          if (start && historyDate < start) return false;
          if (end && historyDate > end) return false;
          return true;
        })
        .map((history) => ({
          ingredient: ingredient.name,
          date: history.date || history.createdAt || '',
          supplier: history.supplier || history.supplierName || ingredient.preferredSupplier || '',
          unit: history.unit || history.priceUnit || ingredient.lastUnit || ingredient.unit || '',
          priceExVAT: Number(history.priceExVAT ?? history.price ?? 0),
          priceIncVAT: Number(history.priceIncVAT ?? 0),
          invoiceId: history.invoiceId || '',
        }))
    ));
    const priceChanges = workspace.ingredients
      .map((ingredient) => {
        const history = (Array.isArray(ingredient.priceHistory) ? ingredient.priceHistory : [])
          .filter((entry) => {
            const entryDate = new Date(entry.date || entry.createdAt || 0);

            if (start && entryDate < start) return false;
            if (end && entryDate > end) return false;
            return true;
          })
          .sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0));
        const latest = history[history.length - 1];
        const previous = history[history.length - 2];
        const latestPrice = Number(latest?.priceExVAT ?? latest?.price ?? 0);
        const previousPrice = Number(previous?.priceExVAT ?? previous?.price ?? 0);

        if (!latest || !previous || previousPrice <= 0 || latestPrice <= 0) return null;

        return {
          id: ingredient.id,
          name: ingredient.name,
          supplier: latest.supplier || latest.supplierName || ingredient.preferredSupplier || '',
          unit: latest.unit || latest.priceUnit || ingredient.lastUnit || ingredient.unit || '',
          previousPrice,
          latestPrice,
          changePercent: roundMoney(((latestPrice - previousPrice) / previousPrice) * 100),
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
      .slice(0, 8);

    return {
      summary: {
        invoiceCount: activeInvoices.length,
        supplierCount: supplierSpend.size,
        ingredientCount: ingredientSpend.size,
        totalExVAT: roundMoney(activeInvoices.reduce((sum, invoice) => sum + Number(invoice.totalExVAT || 0), 0)),
        totalVAT: roundMoney(activeInvoices.reduce((sum, invoice) => sum + Number(invoice.totalVAT || 0), 0)),
        totalIncVAT: roundMoney(activeInvoices.reduce((sum, invoice) => sum + Number(invoice.totalIncVAT || 0), 0)),
      },
      supplierSpend: [...supplierSpend.values()].sort((a, b) => b.spendExVAT - a.spendExVAT).slice(0, 8),
      ingredientSpend: [...ingredientSpend.values()]
        .map((ingredient) => ({
          ...ingredient,
          suppliers: [...ingredient.suppliers].join('; '),
        }))
        .sort((a, b) => b.spendExVAT - a.spendExVAT)
        .slice(0, 8),
      invoiceLineRows,
      priceHistoryRows,
      priceChanges,
    };
  }, [reportEndDate, reportStartDate, workspace.ingredients, workspace.invoices]);
  const ingredientSearchValue = ingredientSearch.trim().toLowerCase();
  const filteredIngredients = useMemo(() => (
    [...workspace.ingredients]
      .filter((ingredient) => {
        if (!ingredientSearchValue) return true;

        return [
          ingredient.name,
          ingredient.category,
          ingredient.preferredSupplier,
          ingredient.unit,
        ].some((part) => String(part || '').toLowerCase().includes(ingredientSearchValue));
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  ), [ingredientSearchValue, workspace.ingredients]);
  const visibleIngredientPage = useMemo(() => getVisiblePage(filteredIngredients, {
    limit: visibleIngredientLimit,
    fallbackLimit: INGREDIENT_LIBRARY_PAGE_SIZE,
  }), [filteredIngredients, visibleIngredientLimit]);
  const ingredientSummary = useMemo(() => ({
    total: workspace.ingredients.length,
    priced: workspace.ingredients.filter((ingredient) => Number(ingredient.lastPriceExVAT || ingredient.latestCost || 0) > 0).length,
    missingCost: workspace.ingredients.filter((ingredient) => Number(ingredient.lastPriceExVAT || ingredient.latestCost || 0) <= 0).length,
    newThisMonth: workspace.ingredients.filter((ingredient) => {
      const date = ingredient.lastInvoiceDate ? new Date(ingredient.lastInvoiceDate) : null;
      const now = new Date();

      return date
        && date.getMonth() === now.getMonth()
        && date.getFullYear() === now.getFullYear();
    }).length,
  }), [workspace.ingredients]);
  const costReviewQueue = useMemo(() => buildCostReviewQueue({
    ingredients: workspace.ingredients,
    invoiceLines: lineItems,
    recipes,
    itemPriceCatalog,
  }), [itemPriceCatalog, lineItems, recipes, workspace.ingredients]);
  const visibleCostReviewQueue = useMemo(() => costReviewQueue.slice(0, 6), [costReviewQueue]);
  const priceHistorySuppliers = useMemo(() => (
    [...new Set(
      workspace.ingredients.flatMap((ingredient) => (
        (Array.isArray(ingredient.priceHistory) ? ingredient.priceHistory : [])
          .map((history) => history.supplier || history.supplierName || '')
          .filter(Boolean)
      ))
    )].sort((a, b) => a.localeCompare(b))
  ), [workspace.ingredients]);
  const priceJumpCount = useMemo(() => (
    lineItems.filter((lineItem) => {
      const match = matches.get(lineItem.id);
      const previousPrice = Number(match?.ingredient?.lastPriceExVAT || 0);
      const nextPrice = Number(lineItem.unitPriceExVAT || lineItem.unitPrice || 0);

      return match?.ingredient && previousPrice > 0 && ((nextPrice - previousPrice) / previousPrice) * 100 > 10;
    }).length
  ), [lineItems, matches]);
  const lowStockAlerts = useMemo(() => (
    createLowStockAlerts({
      ingredients: workspace.ingredients,
      stockLevels: workspace.stockLevels,
      inventoryMovements,
    })
  ), [inventoryMovements, workspace.ingredients, workspace.stockLevels]);

  useEffect(() => {
    setVisibleLineLimit(INVOICE_REVIEW_PAGE_SIZE);
  }, [lineItems.length]);

  useEffect(() => {
    setVisibleIngredientLimit(INGREDIENT_LIBRARY_PAGE_SIZE);
  }, [ingredientSearchValue, priceHistorySupplierFilter]);

  useEffect(() => {
    setVisibleInvoiceLimit(DEFAULT_PAGE_SIZE);
  }, [historyEndDate, historySearch, historyStartDate]);

  useEffect(() => {
    let isCancelled = false;

    const loadWorkspace = async () => {
      try {
        const data = await loadInvoiceWorkspaceData();

        if (isCancelled) return;
        setWorkspace(data);
        setVatRate(Number(data.settings?.vatRate || DEFAULT_VAT_RATE));
        if (!firebaseReady) {
          setMessage('Firebase is not configured. Manual invoice entry works locally, but saving is disabled.');
        }
      } catch (error) {
        setMessage(error?.message || 'Could not load invoice workspace data.');
      }
    };

    loadWorkspace();

    return () => {
      isCancelled = true;
    };
  }, [firebaseReady]);

  const refreshWorkspace = async () => {
    const data = await loadInvoiceWorkspaceData();
    setWorkspace(data);
    onInvoiceSaved?.();
  };

  const applyLineCalculations = (item, options = {}) => {
    const safeQuantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const safeLineTotal = Number.isFinite(Number(item.lineTotal)) ? Number(item.lineTotal) : 0;
    const safeUnitPrice = Number.isFinite(Number(item.unitPrice))
      ? Number(item.unitPrice)
      : safeQuantity > 0
        ? safeLineTotal / safeQuantity
        : safeLineTotal;
    const nextVatMode = options.vatMode || item.vatMode || vatMode;
    const nextVatRate = Number.isFinite(Number(options.vatRate)) ? Number(options.vatRate) : vatRate;
    const vat = calculateVatValues({
      lineTotal: safeLineTotal,
      unitPrice: safeUnitPrice,
      vatMode: nextVatMode,
      vatRate: nextVatRate,
    });
    const base = getBaseUnitInfo(safeQuantity, item.unit || 'each');

    return {
      ...item,
      quantity: safeQuantity,
      unit: item.unit || 'each',
      unitPrice: roundMoney(safeUnitPrice),
      lineTotal: roundMoney(safeLineTotal),
      vatMode: nextVatMode,
      vatRate: nextVatRate,
      ...vat,
      baseQuantity: base.quantity,
      baseUnit: base.unit,
      costPerBaseUnitExVAT: base.quantity > 0 ? roundUnitPrice(vat.priceExVAT / base.quantity) : 0,
    };
  };

  const createManualLineItem = (draft) => {
    const quantity = Number(draft.quantity) > 0 ? Number(draft.quantity) : 1;
    const unitPrice = Number(draft.unitPrice) || 0;
    const lineTotal = Number(draft.lineTotal) || roundMoney(quantity * unitPrice);
    const itemName = String(draft.itemName || '').trim();

    return applyLineCalculations({
    id: createRecordId('invoice_line'),
      itemName,
      quantity,
      unit: draft.unit || 'each',
      unitPrice,
      lineTotal,
      vatMode,
      vatRate,
      rawLine: `Manual entry: ${itemName}`,
      confidence: 1,
    });
  };

  const updateLineItem = (lineId, field, value) => {
    setLineItems((currentItems) => (
      currentItems.map((item) => {
        if (item.id !== lineId) return item;

        const nextItem = {
          ...item,
          [field]: ['quantity', 'unitPrice', 'lineTotal', 'priceExVAT', 'priceIncVAT'].includes(field)
            ? Number(value)
            : value,
        };

        if (['quantity', 'unit', 'lineTotal', 'unitPrice', 'vatMode'].includes(field)) {
          return applyLineCalculations(nextItem);
        }

        return nextItem;
      })
    ));
  };

  const removeLineItem = (lineId) => {
    setLineItems((currentItems) => currentItems.filter((item) => item.id !== lineId));
    setManualIngredientLinks((currentLinks) => {
      const nextLinks = { ...currentLinks };
      delete nextLinks[lineId];
      return nextLinks;
    });
    setNewIngredientDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[lineId];
      return nextDrafts;
    });
    setConfirmedInvoice(null);
    setStockUpdates([]);
  };

  const clearParsedLines = () => {
    setLineItems([]);
    setExtractedTotals(null);
    setManualIngredientLinks({});
    setNewDrawerLineId('');
    setNewIngredientDrafts({});
    setConfirmedInvoice(null);
    setStockUpdates([]);
    setMessage('Invoice lines cleared. Add the lines again when ready.');
  };

  const addManualLineItem = () => {
    const nextLine = createManualLineItem(manualLineDraft);

    if (!nextLine.itemName || nextLine.lineTotal <= 0) {
      setMessage('Enter an item name and price before adding a manual invoice line.');
      return;
    }

    setLineItems((currentItems) => [...currentItems, nextLine]);
    setConfirmedInvoice(null);
    setStockUpdates([]);
    setManualLineDraft(EMPTY_MANUAL_LINE);
    setMessage(`${nextLine.itemName} added as a manual invoice line.`);
  };

  const scanFileWithGemini = async (file) => {
    const scanPayload = await createScanPayload(file);
    const response = await fetch('/api/gemini-invoice', {
        method: 'POST',
        headers: getManagerApiHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          file: scanPayload,
          vatMode,
          vatRate,
        }),
      });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body?.ok) {
      throw new Error(body?.message || 'Gemini could not read this invoice.');
    }

    const invoice = body.invoice || {};
    const nextVatMode = invoice.vatMode === 'exclusive' || invoice.vatMode === 'inclusive'
      ? invoice.vatMode
      : vatMode;
    const nextVatRate = Number.isFinite(Number(invoice.vatRate))
      ? Number(invoice.vatRate)
      : vatRate;
    const scanId = createRecordId('scan');
    const scannedLines = (Array.isArray(invoice.items) ? invoice.items : [])
      .map((item, index) => {
        const itemName = String(item?.itemName || '').trim();
        const quantity = Number(item?.quantity) > 0 ? Number(item.quantity) : 1;
        const lineTotal = getScannedLineTotal(item, nextVatMode);
        const unitPrice = Number(item?.unitPrice) > 0
          ? Number(item.unitPrice)
          : quantity > 0
            ? lineTotal / quantity
            : lineTotal;

        if (!itemName || lineTotal <= 0) {
          return null;
        }

        return applyLineCalculations({
          id: `${scanId}_${index}_${createInvoiceKey(itemName) || 'line'}`,
          itemName,
          quantity,
          unit: normalizeInvoiceUnit(item?.unit || 'each'),
          unitPrice: roundMoney(unitPrice),
          lineTotal: roundMoney(lineTotal),
          vatMode: nextVatMode,
          vatRate: nextVatRate,
          rawLine: item?.rawLine || `Gemini scan: ${itemName}`,
          confidence: Number(item?.confidence) || 0.82,
        }, { vatMode: nextVatMode, vatRate: nextVatRate });
      })
      .filter(Boolean);

    if (scannedLines.length === 0) {
      throw new Error('Gemini did not find usable invoice line items. Try a clearer, flatter photo.');
    }

    return {
      file,
      fileName: file.name,
      supplierName: invoice.supplierName || '',
      invoiceNumber: invoice.invoiceNumber || '',
      invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(invoice.invoiceDate || '') ? invoice.invoiceDate : '',
      vatMode: nextVatMode,
      vatRate: nextVatRate,
      extractedTotals: invoice.totals || null,
      lineItems: scannedLines,
      summary: {
        fileName: file.name,
        lineCount: scannedLines.length,
        supplierName: invoice.supplierName || '',
        invoiceNumber: invoice.invoiceNumber || '',
        totals: invoice.totals || null,
        model: body.model || 'Gemini',
      },
    };
  };

  const loadBatchDraftForReview = (draft) => {
    if (!draft || !['ready', 'saved'].includes(draft.status)) {
      return;
    }

    if (draft.supplierName) setSupplierName(draft.supplierName);
    if (draft.invoiceNumber) setInvoiceNumber(draft.invoiceNumber);
    if (draft.invoiceDate) setInvoiceDate(draft.invoiceDate);
    setVatMode(draft.vatMode || vatMode);
    setVatRate(Number(draft.vatRate) || vatRate);
    setExtractedTotals(draft.extractedTotals || null);
    setLineItems(draft.lineItems || []);
    setManualIngredientLinks({});
    setNewIngredientDrafts({});
    setNewDrawerLineId('');
    setConfirmedInvoice(null);
    setStockUpdates([]);
    setScanFile(draft.file || null);
    setScanSummary(draft.summary || null);
    setActiveBatchDraftId(draft.id);
    setMessage(`${draft.fileName} loaded for review.`);
  };

  const handleScanFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    const invalidFile = files.find((file) => !SUPPORTED_SCAN_TYPES.has(file.type));

    setScanSummary(null);
    setActiveBatchDraftId('');

    if (invalidFile) {
      setMessage('Upload JPG, PNG, WEBP, or PDF invoices only.');
      setScanFile(null);
      setScanFiles([]);
      setBatchDrafts([]);
      event.target.value = '';
      return;
    }

    setScanFiles(files);
    setScanFile(files[0] || null);
    setBatchDrafts(files.map((file) => ({
      id: createRecordId('invoice_batch'),
      file,
      fileName: file.name,
      status: 'queued',
      lineCount: 0,
    })));

    if (files.length === 0) {
      setMessage('');
      return;
    }

    setMessage(files.length === 1
      ? `${files[0].name} selected for Gemini scanning.`
      : `${files.length} invoices selected. Scan all or review them one at a time.`);
  };

  const scanInvoiceWithGemini = async () => {
    if (!scanFile) {
      setMessage('Choose an invoice file before scanning.');
      return;
    }

    try {
      setIsScanningInvoice(true);
      setScanSummary(null);
      setMessage('Scanning invoice with Gemini...');

      const scannedDraft = await scanFileWithGemini(scanFile);

      if (scannedDraft.supplierName) setSupplierName(scannedDraft.supplierName);
      if (scannedDraft.invoiceNumber) setInvoiceNumber(scannedDraft.invoiceNumber);
      if (scannedDraft.invoiceDate) setInvoiceDate(scannedDraft.invoiceDate);
      setVatMode(scannedDraft.vatMode);
      setVatRate(scannedDraft.vatRate);
      setExtractedTotals(scannedDraft.extractedTotals);
      setLineItems((currentItems) => [...currentItems, ...scannedDraft.lineItems]);
      setConfirmedInvoice(null);
      setStockUpdates([]);
      setScanSummary(scannedDraft.summary);
      setBatchDrafts((currentDrafts) => currentDrafts.map((draft) => (
        draft.file === scanFile
          ? {
              ...draft,
              ...scannedDraft,
              status: 'ready',
              lineCount: scannedDraft.lineItems.length,
              error: '',
            }
          : draft
      )));
      setMessage(`Gemini added ${scannedDraft.lineItems.length} invoice line${scannedDraft.lineItems.length === 1 ? '' : 's'} for review.`);
    } catch (error) {
      setMessage(error?.message || 'Could not scan this invoice with Gemini.');
    } finally {
      setIsScanningInvoice(false);
    }
  };

  const scanBatchInvoices = async () => {
    if (batchDrafts.length === 0) {
      setMessage('Choose invoice files before batch scanning.');
      return;
    }

    try {
      setIsBatchScanning(true);
      setMessage(`Scanning ${batchDrafts.length} invoice${batchDrafts.length === 1 ? '' : 's'} with Gemini...`);

      const readyDrafts = [];

      for (const draft of batchDrafts) {
        setBatchDrafts((currentDrafts) => currentDrafts.map((currentDraft) => (
          currentDraft.id === draft.id ? { ...currentDraft, status: 'scanning', error: '' } : currentDraft
        )));

        try {
          const scannedDraft = await scanFileWithGemini(draft.file);
          const readyDraft = {
            ...draft,
            ...scannedDraft,
            status: 'ready',
            lineCount: scannedDraft.lineItems.length,
            error: '',
          };

          readyDrafts.push(readyDraft);
          setBatchDrafts((currentDrafts) => currentDrafts.map((currentDraft) => (
            currentDraft.id === draft.id ? readyDraft : currentDraft
          )));
        } catch (error) {
          setBatchDrafts((currentDrafts) => currentDrafts.map((currentDraft) => (
            currentDraft.id === draft.id
              ? { ...currentDraft, status: 'error', error: error?.message || 'Could not scan this invoice.' }
              : currentDraft
          )));
        }
      }

      if (readyDrafts.length > 0) {
        loadBatchDraftForReview(readyDrafts[0]);
      }

      setMessage(`Batch scan complete: ${readyDrafts.length} of ${batchDrafts.length} invoice${batchDrafts.length === 1 ? '' : 's'} ready for review.`);
    } finally {
      setIsBatchScanning(false);
    }
  };

  const openNewIngredientDrawer = (lineItem) => {
    const existingDraft = newIngredientDrafts[lineItem.id];

    setNewIngredientDrafts((currentDrafts) => ({
      ...currentDrafts,
      [lineItem.id]: {
        id: existingDraft?.id || createInvoiceKey(lineItem.itemName),
        name: existingDraft?.name || lineItem.itemName,
        category: existingDraft?.category || 'Other',
        unit: existingDraft?.unit || lineItem.unit || lineItem.baseUnit || 'each',
        parLevel: existingDraft?.parLevel || '',
        reorderPoint: existingDraft?.reorderPoint || '',
        preferredSupplier: existingDraft?.preferredSupplier || supplierName,
        linkedMenuItemIds: existingDraft?.linkedMenuItemIds || [],
        lastPriceExVAT: lineItem.unitPriceExVAT || lineItem.priceExVAT,
        lastPriceIncVAT: lineItem.unitPriceIncVAT || lineItem.priceIncVAT,
      },
    }));
    setNewDrawerLineId(lineItem.id);
  };

  const updateNewIngredientDraft = (lineId, updates) => {
    setNewIngredientDrafts((currentDrafts) => ({
      ...currentDrafts,
      [lineId]: {
        ...currentDrafts[lineId],
        ...updates,
      },
    }));
  };

  const saveNewIngredientDraft = async () => {
    const draft = newIngredientDrafts[newDrawerLineId];

    if (!draft?.name) {
      setMessage('Enter a name for the new ingredient.');
      return;
    }

    try {
      const result = await saveIngredient(draft);
      if (result?.duplicate) {
        setMessage(result.message || `${draft.name} already exists in the raw ingredient library.`);
        return;
      }
      await refreshWorkspace();
      setNewDrawerLineId('');
      setMessage(`${draft.name} saved to ingredients.`);
    } catch (error) {
      setMessage(error?.message || 'Could not save this ingredient.');
    }
  };

  const handleDeleteIngredient = async (ingredient) => {
    if (!canManageInvoices) {
      setMessage('Only an owner or manager can delete raw ingredients.');
      return;
    }

    if (!firebaseReady) {
      setMessage('Firebase is not configured, so raw ingredients cannot be deleted yet.');
      return;
    }

    if (!ingredient?.id || !window.confirm(`Delete ${ingredient.name} from the raw ingredient library?`)) {
      return;
    }

    try {
      setDeletingIngredientId(ingredient.id);
      await deleteIngredient(ingredient.id);
      onIngredientDeleted?.(ingredient);
      await refreshWorkspace();
      setMessage(`${ingredient.name} deleted from the raw ingredient library.`);
    } catch (error) {
      setMessage(error?.message || 'Could not delete this raw ingredient.');
    } finally {
      setDeletingIngredientId('');
    }
  };

  const handleDeleteInvoice = async (invoice) => {
    if (!canManageInvoices) {
      setMessage('Only an owner or manager can delete invoices.');
      return;
    }

    if (!firebaseReady) {
      setMessage('Firebase is not configured, so invoices cannot be deleted yet.');
      return;
    }

    if (!invoice?.id) {
      setMessage('This invoice is missing an ID and cannot be deleted.');
      return;
    }

    const label = invoice.invoiceNumber
      ? `${invoice.supplier || 'Unknown supplier'} invoice #${invoice.invoiceNumber}`
      : `${invoice.supplier || 'Unknown supplier'} invoice from ${invoice.invoiceDate || 'unknown date'}`;

    if (!window.confirm(`Delete ${label}? This will soft-delete the invoice and remove its price history from ingredient costs.`)) {
      return;
    }

    try {
      setDeletingInvoiceId(invoice.id);
      const result = await softDeleteInvoice(invoice.id, { deletedBy: 'WasteShift user' });

      await refreshWorkspace();
      setConfirmedInvoice((currentInvoice) => (
        currentInvoice?.invoiceId === invoice.id ? null : currentInvoice
      ));
      setStockUpdates([]);
      setMessage(`Invoice deleted. Removed ${result.removedHistoryCount || 0} price histor${result.removedHistoryCount === 1 ? 'y entry' : 'y entries'} and refreshed ${result.affectedIngredientCount || 0} ingredient${result.affectedIngredientCount === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error?.message || 'Could not delete this invoice.');
    } finally {
      setDeletingInvoiceId('');
    }
  };

  const handleExportInvoiceLines = () => {
    if (!canExportInvoiceReports) {
      setMessage('Only an owner or manager can export invoice reports.');
      return;
    }

    if (reportData.invoiceLineRows.length === 0) {
      setMessage('No invoice lines match this report range.');
      return;
    }

    downloadCsv(
      `wasteshift-invoice-lines-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Date', 'Supplier', 'Invoice Number', 'Item', 'Quantity', 'Unit', 'Unit Price ex VAT', 'Line ex VAT', 'Line inc VAT'],
      reportData.invoiceLineRows.map((row) => [
        row.invoiceDate,
        row.supplier,
        row.invoiceNumber,
        row.itemName,
        row.quantity,
        row.unit,
        row.unitPriceExVAT,
        row.lineExVAT,
        row.lineIncVAT,
      ])
    );
    setMessage(`Exported ${reportData.invoiceLineRows.length} invoice line${reportData.invoiceLineRows.length === 1 ? '' : 's'}.`);
  };

  const handleExportPriceHistory = () => {
    if (!canExportInvoiceReports) {
      setMessage('Only an owner or manager can export invoice reports.');
      return;
    }

    if (reportData.priceHistoryRows.length === 0) {
      setMessage('No ingredient price history matches this report range.');
      return;
    }

    downloadCsv(
      `wasteshift-price-history-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Ingredient', 'Date', 'Supplier', 'Unit', 'Price ex VAT', 'Price inc VAT', 'Invoice ID'],
      reportData.priceHistoryRows.map((row) => [
        row.ingredient,
        row.date,
        row.supplier,
        row.unit,
        row.priceExVAT,
        row.priceIncVAT,
        row.invoiceId,
      ])
    );
    setMessage(`Exported ${reportData.priceHistoryRows.length} ingredient price histor${reportData.priceHistoryRows.length === 1 ? 'y row' : 'y rows'}.`);
  };

  const handleVatRateSave = async () => {
    try {
      await saveInvoiceSettings({ vatRate });
      setWorkspace((currentWorkspace) => ({
        ...currentWorkspace,
        settings: { ...currentWorkspace.settings, vatRate },
      }));
      setMessage(`VAT rate saved at ${formatPercent(vatRate * 100)}.`);
    } catch (error) {
      setMessage(error?.message || 'Could not save VAT settings.');
    }
  };

  const confirmInvoice = async (stockMode = 'prices_only') => {
    if (!canManageInvoices) {
      setMessage('Only an owner or manager can confirm invoices.');
      return;
    }

    if (!firebaseReady) {
      setMessage('Firebase is not configured, so this invoice cannot be saved yet.');
      return;
    }

    if (lineItems.length === 0) {
      setMessage('Add at least one invoice line before confirming.');
      return;
    }

    if (duplicateInvoices.length > 0 && !window.confirm(`Possible duplicate invoice found (${duplicateInvoices.length}). Save this invoice anyway?`)) {
      setMessage('Invoice save cancelled so you can review the possible duplicate first.');
      return;
    }

    if (isConfirmingInvoice) {
      return;
    }

    const invoiceId = createRecordId('invoice');
    const shouldPostStock = stockMode === 'post_now' || stockMode === 'historical';
    const stockPostingStatus = stockMode === 'prices_only'
      ? 'prices_only'
      : 'not_posted';
    const manualSourceText = lineItems
      .map((item) => `${item.itemName} | ${item.quantity} ${item.unit} | ${formatMoney(item.unitPrice)} | ${formatMoney(item.lineTotal)}`)
      .join('\n');

    try {
      setIsConfirmingInvoice(true);
      const result = await saveConfirmedInvoice({
        invoiceId,
        invoiceNumber,
        supplierName,
        invoiceDate,
        receivedDate: invoiceDate,
        lineItems,
        ingredientRows,
        totals,
        extractedTotals,
        vatRate,
        vatMode,
        confirmedBy: accessProfile?.operatorName || 'WasteShift user',
        stockPostingStatus,
        rawText: [
          `Supplier: ${supplierName || 'Unknown supplier'}`,
          `Invoice number: ${invoiceNumber || invoiceId}`,
          `Invoice date: ${invoiceDate}`,
          manualSourceText,
        ].join('\n'),
      });

      if (!result?.ok) {
        throw new Error('Invoice save was skipped.');
      }

      setConfirmedInvoice({
        invoiceId: result.invoiceId,
        invoiceNumber,
        lineItems,
        ingredientRows,
        stockPostingStatus,
      });
      setBatchDrafts((currentDrafts) => currentDrafts.map((draft) => (
        draft.id === activeBatchDraftId
          ? { ...draft, status: 'saved', savedInvoiceId: result.invoiceId }
          : draft
      )));
      onInvoicePricesUpdated?.({
        invoiceId: result.invoiceId,
        supplierName,
        invoiceDate,
        lineItems,
        ingredientRows,
      });
      if (shouldPostStock) {
        const stockResult = await updateStockFromInvoice({
          invoiceId: result.invoiceId,
          lineItems,
          ingredientRows,
          postingMode: stockMode === 'historical' ? 'historical_posted' : 'posted',
          postedBy: accessProfile?.operatorName || 'WasteShift user',
        });

        setStockUpdates(stockResult.updates || []);
        setConfirmedInvoice((currentInvoice) => ({
          ...(currentInvoice || {}),
          invoiceId: result.invoiceId,
          invoiceNumber,
          lineItems,
          ingredientRows,
          stockPostingStatus: stockMode === 'historical' ? 'historical_posted' : 'posted',
          stockMovementIds: stockResult.stockMovementIds || [],
        }));
        setMessage(stockResult.alreadyPosted
          ? 'Invoice confirmed. Stock was already updated earlier.'
          : `Invoice confirmed and stock ${stockMode === 'historical' ? 'historically ' : ''}updated for ${stockResult.updates?.length || 0} ingredient${stockResult.updates?.length === 1 ? '' : 's'}.`);
      } else {
        setStockUpdates([]);
        setMessage('Invoice confirmed without changing stock. Prices and ingredient history were updated.');
      }
      await refreshWorkspace();
    } catch (error) {
      setMessage(error?.message || 'Could not confirm this invoice.');
    } finally {
      setIsConfirmingInvoice(false);
    }
  };

  const handleUpdateStock = async () => {
    if (!confirmedInvoice?.invoiceId) {
      setMessage('Confirm the invoice before updating stock.');
      return;
    }

    if (isUpdatingStock) {
      return;
    }

    try {
      setIsUpdatingStock(true);
      const result = await updateStockFromInvoice({
        invoiceId: confirmedInvoice.invoiceId,
        lineItems: confirmedInvoice.lineItems,
        ingredientRows: confirmedInvoice.ingredientRows,
        postingMode: 'posted',
        postedBy: accessProfile?.operatorName || 'WasteShift user',
      });

      setStockUpdates(result.updates || []);
      setConfirmedInvoice((currentInvoice) => currentInvoice
        ? {
            ...currentInvoice,
            stockPostingStatus: result.alreadyPosted ? currentInvoice.stockPostingStatus || 'posted' : 'posted',
            stockMovementIds: result.stockMovementIds || currentInvoice.stockMovementIds || [],
          }
        : currentInvoice);
      setMessage(result.alreadyPosted
        ? 'Stock already updated for this invoice.'
        : `Stock updated for ${result.updates?.length || 0} ingredient${result.updates?.length === 1 ? '' : 's'}.`);
      await refreshWorkspace();
    } catch (error) {
      setMessage(error?.message || 'Could not update stock from this invoice.');
    } finally {
      setIsUpdatingStock(false);
    }
  };

  const renderPriceBadge = (lineItem) => {
    const match = matches.get(lineItem.id);
    const previousPrice = Number(match?.ingredient?.lastPriceExVAT || 0);
    const nextPrice = Number(lineItem.unitPriceExVAT || lineItem.unitPrice || 0);

    if (!match?.ingredient || previousPrice <= 0) {
      return <span className="badge is-blue">New</span>;
    }

    const change = ((nextPrice - previousPrice) / previousPrice) * 100;

    if (change > 10) {
      return <span className="badge is-red">Review +{formatPercent(change)}</span>;
    }

    if (change > 0.5) {
      return <span className="badge is-red">Up {formatPercent(change)}</span>;
    }

    if (change < -0.5) {
      return <span className="badge is-green">Down {formatPercent(Math.abs(change))}</span>;
    }

    return <span className="badge">Flat</span>;
  };

  const activeNewLineItem = lineItems.find((lineItem) => lineItem.id === newDrawerLineId);
  const activeNewDraft = newIngredientDrafts[newDrawerLineId] || null;

  return (
    <section className="invoice-scanner-page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Invoices</p>
          <h2 className="title">Invoice Entry & Stock Control</h2>
          <p className="subtitle">Enter supplier invoice lines, review prices, update recipes, and put stock on hand.</p>
        </div>
        <div className="segmented-control" aria-label="Invoice views">
          <button type="button" className={`segment-button${activeView === 'entry' ? ' is-active' : ''}`} onClick={() => setActiveView('entry')}>
            Entry
          </button>
          <button type="button" className={`segment-button${activeView === 'ingredients' ? ' is-active' : ''}`} onClick={() => setActiveView('ingredients')}>
            Raw Library
          </button>
          <button type="button" className={`segment-button${activeView === 'history' ? ' is-active' : ''}`} onClick={() => setActiveView('history')}>
            History
          </button>
          <button type="button" className={`segment-button${activeView === 'reports' ? ' is-active' : ''}`} onClick={() => setActiveView('reports')}>
            Reports
          </button>
        </div>
      </div>

      {!firebaseReady && (
        <div className="notice-panel notice-panel--warning">
          <div>
            <h3 className="breakdown-title">Firebase required for saving</h3>
            <p className="small-text" style={{ margin: 0 }}>Manual entry works locally, but invoices, ingredients, suppliers, and stock updates need Firebase env vars.</p>
          </div>
        </div>
      )}

      <datalist id="invoice-unit-options">
        {UNIT_OPTIONS.map((unit) => <option key={unit} value={unit} />)}
      </datalist>

      {activeView === 'entry' && (
        <>
          <div className="invoice-entry-grid">
            <section className="panel">
              <div className="panel-body">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Invoice details</p>
                    <h2 className="title">Header</h2>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="invoice-supplier">Supplier</label>
                  <input
                    id="invoice-supplier"
                    value={supplierName}
                    onChange={(event) => setSupplierName(event.target.value)}
                    className="input"
                    list="invoice-supplier-options"
                  />
                  <datalist id="invoice-supplier-options">
                    {workspace.suppliers.map((supplier) => (
                      <option key={supplier.id || supplier.name} value={supplier.name} />
                    ))}
                  </datalist>
                </div>

                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="invoice-number">Invoice number</label>
                    <input
                      id="invoice-number"
                      value={invoiceNumber}
                      onChange={(event) => setInvoiceNumber(event.target.value)}
                      className="input"
                      placeholder="From supplier invoice"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="invoice-date">Invoice date</label>
                    <input id="invoice-date" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="input" />
                  </div>
                </div>

                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="invoice-vat-rate">VAT rate</label>
                    <input
                      id="invoice-vat-rate"
                      type="number"
                      min="0"
                      step="0.01"
                      value={vatRate}
                      onChange={(event) => {
                        const nextRate = Number(event.target.value) || 0;
                        setVatRate(nextRate);
                        setLineItems((currentItems) => currentItems.map((item) => applyLineCalculations(item, { vatRate: nextRate })));
                      }}
                      className="input"
                    />
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">VAT mode</span>
                  <div className="segmented-control" aria-label="VAT mode">
                    {['inclusive', 'exclusive'].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setVatMode(mode);
                          setLineItems((currentItems) => currentItems.map((item) => applyLineCalculations({
                            ...item,
                            vatMode: mode,
                          }, { vatMode: mode })));
                        }}
                        className={`segment-button${vatMode === mode ? ' is-active' : ''}`}
                      >
                        {mode === 'inclusive' ? 'Incl VAT' : 'Excl VAT'}
                      </button>
                    ))}
                  </div>
                </div>

                <button type="button" onClick={handleVatRateSave} className="ghost-button is-warning">
                  Save VAT setting
                </button>

                <div className="metrics-grid invoice-summary-grid">
                  <div className="metric-card">
                    <span className="metric-value">{formatMoney(totals.totalExVAT)}</span>
                    <span className="metric-label">Total excl VAT</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-value">{formatMoney(totals.totalVAT)}</span>
                    <span className="metric-label">VAT amount</span>
                  </div>
                  <div className="metric-card">
                    <span className="metric-value">{formatMoney(totals.totalIncVAT)}</span>
                    <span className="metric-label">Total incl VAT</span>
                  </div>
                </div>

                {hasExtractedTotals && (
                  <div className="notice-panel notice-panel--info">
                    <div>
                      <h3 className="breakdown-title">Gemini extracted totals</h3>
                      <p className="small-text" style={{ margin: 0 }}>
                        Ex {formatMoney(extractedTotals.totalExVAT)} | VAT {formatMoney(extractedTotals.totalVAT)} | Incl {formatMoney(extractedTotals.totalIncVAT)}
                      </p>
                    </div>
                    <span className="badge">Compare before confirm</span>
                  </div>
                )}
              </div>
            </section>

            <section className="panel invoice-manual-panel">
              <div className="panel-body">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Capture</p>
                    <h2 className="title">Scan or Add Lines</h2>
                    <p className="subtitle">Use Gemini for invoice photos or add rows manually.</p>
                  </div>
                  <span className="badge">{lineItems.length} lines</span>
                </div>

                <div className="invoice-scan-card">
                  <label className="invoice-upload-card">
                    <input
                      ref={scanFileInputRef}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={handleScanFileChange}
                      className="invoice-file-input"
                    />
                    <span className="invoice-upload-label">
                      {scanFiles.length > 1 ? `${scanFiles.length} invoices selected` : scanFile ? scanFile.name : 'Choose invoice files'}
                    </span>
                    <span className="small-text">JPG, PNG, WEBP, or PDF. Select several invoices for batch review.</span>
                  </label>
                  <div className="invoice-manual-actions">
                    <button type="button" className="primary-button" onClick={scanInvoiceWithGemini} disabled={!scanFile || isScanningInvoice || isBatchScanning}>
                      {isScanningInvoice ? 'Scanning...' : 'Scan selected'}
                    </button>
                    <button type="button" className="ghost-button" onClick={scanBatchInvoices} disabled={batchDrafts.length === 0 || isScanningInvoice || isBatchScanning}>
                      {isBatchScanning ? 'Scanning batch...' : 'Scan all'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setScanFile(null);
                        setScanFiles([]);
                        setBatchDrafts([]);
                        setActiveBatchDraftId('');
                        setScanSummary(null);
                        if (scanFileInputRef.current) {
                          scanFileInputRef.current.value = '';
                        }
                      }}
                      disabled={isScanningInvoice || isBatchScanning || scanFiles.length === 0}
                    >
                      {scanFiles.length > 1 ? 'Clear files' : 'Clear file'}
                    </button>
                  </div>
                  {batchDrafts.length > 0 && (
                    <div className="invoice-batch-list">
                      {batchDrafts.map((draft, index) => (
                        <div key={draft.id} className={`invoice-batch-card${draft.id === activeBatchDraftId ? ' is-active' : ''}`}>
                          <div>
                            <strong>{index + 1}. {draft.fileName}</strong>
                            <span className="small-text">
                              {draft.status === 'ready' && `${draft.lineCount} lines ready`}
                              {draft.status === 'queued' && 'Waiting to scan'}
                              {draft.status === 'scanning' && 'Scanning with Gemini...'}
                              {draft.status === 'saved' && `Saved${draft.savedInvoiceId ? ` as ${draft.savedInvoiceId}` : ''}`}
                              {draft.status === 'error' && (draft.error || 'Could not scan')}
                            </span>
                          </div>
                          <div className="manager-row">
                            <span className={`badge${draft.status === 'ready' ? ' is-green' : draft.status === 'error' ? ' is-red' : draft.status === 'saved' ? ' is-blue' : ''}`}>
                              {draft.status}
                            </span>
                            <button
                              type="button"
                              className="ghost-button compact-action"
                              onClick={() => {
                                setScanFile(draft.file);
                                if (['ready', 'saved'].includes(draft.status)) {
                                  loadBatchDraftForReview(draft);
                                } else {
                                  setActiveBatchDraftId(draft.id);
                                  setMessage(`${draft.fileName} selected.`);
                                }
                              }}
                              disabled={draft.status === 'scanning' || isBatchScanning}
                            >
                              {draft.status === 'ready' || draft.status === 'saved' ? 'Review' : 'Select'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {scanSummary && (
                    <div className="invoice-scan-status">
                      <span className="badge is-green">{scanSummary.lineCount} lines</span>
                      {scanSummary.supplierName && <span className="badge">{scanSummary.supplierName}</span>}
                      {scanSummary.invoiceNumber && <span className="badge">#{scanSummary.invoiceNumber}</span>}
                      {scanSummary.totals?.totalIncVAT > 0 && <span className="badge">{formatMoney(scanSummary.totals.totalIncVAT)} incl</span>}
                      <span className="small-text">{scanSummary.model}</span>
                    </div>
                  )}
                </div>

                <div className="invoice-manual-grid">
                  <label className="field">
                    <span className="field-label">Item</span>
                    <input
                      value={manualLineDraft.itemName}
                      onChange={(event) => setManualLineDraft((draft) => ({ ...draft, itemName: event.target.value }))}
                      className="input"
                      placeholder="Tomatoes"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Qty</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={manualLineDraft.quantity}
                      onChange={(event) => setManualLineDraft((draft) => ({ ...draft, quantity: event.target.value }))}
                      className="input"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Unit</span>
                    <input
                      value={manualLineDraft.unit}
                      onChange={(event) => setManualLineDraft((draft) => ({ ...draft, unit: event.target.value }))}
                      className="input"
                      list="invoice-unit-options"
                      placeholder="kg, 5L, case of 12"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Unit price</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={manualLineDraft.unitPrice}
                      onChange={(event) => setManualLineDraft((draft) => ({ ...draft, unitPrice: event.target.value }))}
                      className="input"
                      placeholder="29.90"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Total</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={manualLineDraft.lineTotal}
                      onChange={(event) => setManualLineDraft((draft) => ({ ...draft, lineTotal: event.target.value }))}
                      className="input"
                      placeholder="Auto"
                    />
                  </label>
                </div>

                <div className="invoice-manual-actions">
                  <button type="button" className="primary-button" onClick={addManualLineItem}>
                    Add line
                  </button>
                  <button type="button" className="ghost-button" onClick={() => setManualLineDraft(EMPTY_MANUAL_LINE)}>
                    Reset
                  </button>
                </div>
              </div>
            </section>
          </div>

          {message && <div className="inline-message" role="status">{message}</div>}

          {duplicateInvoices.length > 0 && (
            <div className="notice-panel notice-panel--warning">
              <div>
                <h3 className="breakdown-title">Possible duplicate invoice</h3>
                <p className="small-text" style={{ margin: 0 }}>
                  WasteShift found {duplicateInvoices.length} saved invoice{duplicateInvoices.length === 1 ? '' : 's'} with the same invoice number or matching supplier, date, and total.
                </p>
              </div>
              <span className="badge is-yellow">Review before save</span>
            </div>
          )}

          <section className="panel">
            <div className="panel-body">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Line items</p>
                  <h2 className="title">Review Invoice Lines</h2>
                  <p className="subtitle">Every field is editable before save. New ingredients are flagged for setup.</p>
                </div>
                <div className="manager-row">
                  <span className="badge is-green">{matchedCount} matched</span>
                  <span className={`badge${newLineItems.length > 0 ? ' is-yellow' : ''}`}>{newLineItems.length} new</span>
                  {priceJumpCount > 0 && <span className="badge is-red">{priceJumpCount} price jump{priceJumpCount === 1 ? '' : 's'}</span>}
                  {lineItems.length > 0 && (
                    <button type="button" className="ghost-button compact-action" onClick={clearParsedLines}>
                      Clear lines
                    </button>
                  )}
                </div>
              </div>

              {lineItems.length === 0 ? (
                <div className="empty-state">Scan an invoice or add lines manually, then review them here.</div>
              ) : (
                <div className="invoice-edit-table">
                  <div className="invoice-edit-head">
                    <span>Item</span>
                    <span>Qty</span>
                    <span>Unit</span>
                    <span>Unit price</span>
                    <span>Total</span>
                    <span>VAT</span>
                    <span>Status</span>
                    <span>Action</span>
                  </div>
                  {visibleLinePage.records.map((lineItem) => {
                    const match = matches.get(lineItem.id);
                    const priceHistory = match?.ingredient?.priceHistory || [];
                    const sparklineData = [
                      ...priceHistory.map((history) => ({ price: Number(history.priceExVAT || 0) })),
                      { price: Number(lineItem.priceExVAT || 0) },
                    ];

                    return (
                      <div key={lineItem.id} className="invoice-edit-row">
                        <label className="invoice-field-control">
                          <span className="invoice-field-label">Item</span>
                          <input value={lineItem.itemName} onChange={(event) => updateLineItem(lineItem.id, 'itemName', event.target.value)} className="input" />
                        </label>
                        <label className="invoice-field-control">
                          <span className="invoice-field-label">Qty</span>
                          <input type="number" min="0" step="0.001" value={lineItem.quantity} onChange={(event) => updateLineItem(lineItem.id, 'quantity', event.target.value)} className="input" />
                        </label>
                        <label className="invoice-field-control">
                          <span className="invoice-field-label">Unit</span>
                          <input
                            value={lineItem.unit}
                            onChange={(event) => updateLineItem(lineItem.id, 'unit', event.target.value)}
                            className="input"
                            list="invoice-unit-options"
                            placeholder="kg, 5L, case of 12"
                          />
                        </label>
                        <label className="invoice-field-control">
                          <span className="invoice-field-label">Unit price</span>
                          <input type="number" min="0" step="0.01" value={lineItem.unitPrice} onChange={(event) => updateLineItem(lineItem.id, 'unitPrice', event.target.value)} className="input" />
                        </label>
                        <label className="invoice-field-control">
                          <span className="invoice-field-label">Total</span>
                          <input type="number" min="0" step="0.01" value={lineItem.lineTotal} onChange={(event) => updateLineItem(lineItem.id, 'lineTotal', event.target.value)} className="input" />
                        </label>
                        <div className="invoice-field-control invoice-vat-cell">
                          <span className="invoice-field-label">VAT</span>
                          <span className="small-text">
                            {formatMoney(lineItem.priceExVAT)} ex<br />
                            {formatMoney(lineItem.vatAmount)} VAT
                          </span>
                        </div>
                        <div className="invoice-match-cell">
                          <span className="invoice-field-label">Status</span>
                          <select
                            value={manualIngredientLinks[lineItem.id] || 'auto'}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setManualIngredientLinks((currentLinks) => {
                                const nextLinks = { ...currentLinks };

                                if (nextValue === 'auto') {
                                  delete nextLinks[lineItem.id];
                                } else {
                                  nextLinks[lineItem.id] = nextValue;
                                }

                                return nextLinks;
                              });
                              setConfirmedInvoice(null);
                              setStockUpdates([]);
                            }}
                            className="select"
                            aria-label={`Ingredient link for ${lineItem.itemName}`}
                          >
                            <option value="auto">Auto match</option>
                            <option value="__new__">Create new ingredient</option>
                            {workspace.ingredients.map((ingredient) => (
                              <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>
                            ))}
                          </select>
                          {match?.ingredient ? (
                            <>
                              <span className="badge is-green">{match.ingredient.name}</span>
                              {match.source === 'manual' && <span className="badge is-blue">Manual link</span>}
                              {renderPriceBadge(lineItem)}
                              {sparklineData.length > 1 && (
                                <div className="invoice-sparkline">
                                  <ResponsiveContainer width="100%" height={34}>
                                    <LineChart data={sparklineData}>
                                      <Line type="monotone" dataKey="price" stroke="currentColor" dot={false} strokeWidth={2} />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="badge is-yellow">New Item</span>
                              <span className="small-text">Auto-added on confirm</span>
                              <button type="button" className="ghost-button compact-action" onClick={() => openNewIngredientDrawer(lineItem)}>
                                Set up
                              </button>
                            </>
                          )}
                        </div>
                        <div className="invoice-line-actions">
                          <span className="invoice-field-label">Action</span>
                          <button type="button" className="ghost-button compact-action" onClick={() => removeLineItem(lineItem.id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {visibleLinePage.hasMore && (
                    <div className="load-more-row invoice-load-more-row">
                      <button
                        type="button"
                        className="ghost-button is-warning"
                        onClick={() => setVisibleLineLimit(visibleLinePage.nextLimit)}
                      >
                        Load more invoice lines
                      </button>
                      <span className="small-text">
                        Showing {visibleLinePage.visibleCount} of {visibleLinePage.totalCount}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {recipeImpact.length > 0 && (
            <section className="panel">
              <div className="panel-body">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Recipe costing</p>
                    <h2 className="title">Recipe Cost Impact</h2>
                  </div>
                  <span className="badge">{recipeImpact.length} affected</span>
                </div>
                <div className="invoice-impact-list">
                  {recipeImpact.map((impact) => (
                    <div key={impact.menuItemId} className="invoice-impact-row">
                      <div>
                        <strong>{impact.menuItemName}</strong>
                        <span className="small-text">{impact.affectedIngredients.map((ingredient) => ingredient.ingredientName).join(', ')}</span>
                      </div>
                      <span className="badge">Old {formatMoney(impact.oldCostPerPortion)}</span>
                      <span className={`badge${impact.percentChange > 0 ? ' is-red' : ' is-green'}`}>
                        New {formatMoney(impact.newCostPerPortion)} ({formatPercent(impact.percentChange)})
                      </span>
                      <span className="badge is-blue">Sell at {formatMoney(impact.suggestedSellingPrice)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-body">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Confirm</p>
                  <h2 className="title">Save Invoice</h2>
                </div>
                <span className="badge">{lineItems.length} lines</span>
              </div>
              <div className="manager-row">
                <button type="button" className="primary-button" onClick={() => confirmInvoice('post_now')} disabled={!canManageInvoices || lineItems.length === 0 || isConfirmingInvoice}>
                  {isConfirmingInvoice ? 'Confirming...' : canManageInvoices ? 'Confirm & Update Stock' : 'Manager only'}
                </button>
                <button type="button" className="ghost-button is-warning" onClick={() => confirmInvoice('prices_only')} disabled={!canManageInvoices || lineItems.length === 0 || isConfirmingInvoice}>
                  Confirm Without Updating Stock
                </button>
                <button type="button" className="ghost-button" onClick={() => confirmInvoice('historical')} disabled={!canManageInvoices || lineItems.length === 0 || isConfirmingInvoice}>
                  Confirm as Historical Stock
                </button>
                <button
                  type="button"
                  className="ghost-button is-warning"
                  onClick={handleUpdateStock}
                  disabled={!confirmedInvoice || isUpdatingStock || ['posted', 'historical_posted'].includes(confirmedInvoice?.stockPostingStatus)}
                >
                  {['posted', 'historical_posted'].includes(confirmedInvoice?.stockPostingStatus)
                    ? 'Stock already updated'
                    : isUpdatingStock ? 'Updating...' : 'Update Stock'}
                </button>
                <span className={`badge${lowStockAlerts.length > 0 ? ' is-red' : ' is-green'}`}>
                  {lowStockAlerts.length} low-stock alert{lowStockAlerts.length === 1 ? '' : 's'}
                </span>
              </div>
              <p className="small-text" style={{ marginTop: '10px' }}>
                Use prices-only for older invoices that should update ingredient costs without increasing current stock.
              </p>

              {lowStockAlerts.length > 0 && (
                <div className="low-stock-alert-list">
                  {lowStockAlerts.slice(0, 5).map((alert) => (
                    <div key={alert.ingredientId || alert.ingredientName} className="low-stock-alert-row">
                      <div>
                        <strong>{alert.ingredientName}</strong>
                        <span className="small-text">
                          {alert.currentQty} {alert.unit} on hand
                          {alert.projectedDaysLeft !== null ? ` · about ${alert.projectedDaysLeft} days left` : ''}
                        </span>
                      </div>
                      <span className={`badge${alert.severity === 'critical' ? ' is-red' : ' is-yellow'}`}>
                        {alert.severity === 'critical' ? 'Reorder' : 'Watch'}
                      </span>
                      <span className="small-text">{alert.reason}</span>
                    </div>
                  ))}
                </div>
              )}

              {stockUpdates.length > 0 && (
                <div className="stock-update-list">
                  {stockUpdates.map((update) => (
                    <div key={update.ingredientId} className="stock-movement-row">
                      <strong>{update.ingredientName}</strong>
                      <span className="small-text">{update.previousQty} to {update.currentQty} {update.unit}</span>
                      <span className={`badge${update.status === 'low' ? ' is-red' : update.status === 'overstocked' ? ' is-orange' : ' is-green'}`}>
                        {update.status}
                      </span>
                      {update.status === 'low' && (
                        <button type="button" className="ghost-button compact-action">Add to Order List</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {activeView === 'ingredients' && (
        <section className="panel">
          <div className="panel-body">
            <div className="section-header">
              <div>
                <p className="eyebrow">Raw ingredients</p>
                <h2 className="title">Ingredient Library</h2>
                <p className="subtitle">Confirmed invoices update this library and sync prices into recipe and waste costing.</p>
              </div>
              <span className="badge">{ingredientSummary.total} raw items</span>
            </div>

            <div className="metrics-grid">
              <div className="metric-card">
                <span className="metric-value">{ingredientSummary.total}</span>
                <span className="metric-label">Raw ingredients</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{ingredientSummary.priced}</span>
                <span className="metric-label">With invoice price</span>
              </div>
              <div className="metric-card">
                <span className={`metric-value${ingredientSummary.missingCost > 0 ? ' is-danger' : ''}`}>{ingredientSummary.missingCost}</span>
                <span className="metric-label">Missing cost</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{ingredientSummary.newThisMonth}</span>
                <span className="metric-label">Updated this month</span>
              </div>
              <div className="metric-card">
                <span className={`metric-value${lowStockAlerts.length > 0 ? ' is-danger' : ''}`}>{lowStockAlerts.length}</span>
                <span className="metric-label">Low-stock alerts</span>
              </div>
            </div>

            {costReviewQueue.length > 0 && (
              <div className="notice-panel notice-panel--warning">
                <div>
                  <h3 className="breakdown-title">Cost review queue</h3>
                  <div className="import-summary-grid">
                    {visibleCostReviewQueue.map((item) => (
                      <span key={item.id} className={item.severity === 'high' ? 'badge is-red' : 'badge is-yellow'}>
                        {item.label}: {item.detail}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="badge">{costReviewQueue.length} open</span>
              </div>
            )}

            <div className="field-grid">
              <input
                type="search"
                value={ingredientSearch}
                onChange={(event) => setIngredientSearch(event.target.value)}
                className="input"
                placeholder="Search raw ingredients, category, supplier, or unit"
              />
              <select
                value={priceHistorySupplierFilter}
                onChange={(event) => setPriceHistorySupplierFilter(event.target.value)}
                className="input"
                aria-label="Filter price history by supplier"
              >
                <option value="">All price history suppliers</option>
                {priceHistorySuppliers.map((supplier) => (
                  <option key={supplier} value={supplier}>{supplier}</option>
                ))}
              </select>
            </div>

            <div className="raw-ingredient-list">
              {filteredIngredients.length === 0 ? (
                <div className="empty-state">No raw ingredients match this search.</div>
              ) : visibleIngredientPage.records.map((ingredient) => {
                const normalizedIngredient = normalizeIngredientRecord(ingredient);
                const priceChange = getLatestPriceChange(ingredient);
                const catalogRecord = itemPriceCatalog?.[createItemPriceKey(ingredient.name)];
                const priceHistory = Array.isArray(ingredient.priceHistory) ? ingredient.priceHistory : [];
                const filteredPriceHistory = priceHistory
                  .filter((history) => (
                    !priceHistorySupplierFilter
                    || String(history.supplier || history.supplierName || '') === priceHistorySupplierFilter
                  ))
                  .sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0));
                const historyCount = filteredPriceHistory.length;
                const historyChartData = filteredPriceHistory
                  .map((history) => ({
                    date: history.date || history.createdAt || '',
                    price: Number(history.priceExVAT ?? history.price ?? 0),
                  }))
                  .filter((history) => Number.isFinite(history.price) && history.price > 0);

                return (
                  <div key={ingredient.id} className="raw-ingredient-card">
                    <div>
                      <strong>{ingredient.name}</strong>
                      <span className="small-text">
                        {ingredient.category || 'Other'} · {ingredient.preferredSupplier || 'No supplier'} · {ingredient.lastInvoiceDate || 'No invoice date'}
                      </span>
                    </div>
                    <div className="raw-ingredient-prices">
                      <span className="badge is-blue">
                        {formatMoney(ingredient.lastPriceExVAT)} / {ingredient.lastUnit || ingredient.unit || 'each'} ex
                      </span>
                      {Number(ingredient.costPerBaseUnitExVAT || 0) > 0 && (
                        <span className="badge">
                          {formatUnitMoney(ingredient.costPerBaseUnitExVAT)} / {ingredient.baseUnit}
                        </span>
                      )}
                      {catalogRecord && (
                        <span className="badge is-green">
                          App cost {formatMoney(catalogRecord.price)} / {catalogRecord.unit}
                        </span>
                      )}
                      <span className="badge">{historyCount} price{historyCount === 1 ? '' : 's'}</span>
                      {Number(normalizedIngredient?.latestCost || 0) <= 0 && <span className="badge is-red">Missing cost</span>}
                      {priceChange.significant && (
                        <span className={priceChange.direction === 'up' ? 'badge is-red' : 'badge is-green'}>
                          {priceChange.direction === 'up' ? '+' : ''}{formatPercent(priceChange.changePercent)}
                        </span>
                      )}
                    </div>
                    {historyCount > 0 && (
                      <details className="ingredient-history-panel">
                        <summary>Price history</summary>
                        {historyChartData.length > 1 && (
                          <div className="ingredient-history-chart">
                            <ResponsiveContainer width="100%" height={86}>
                              <LineChart data={historyChartData}>
                                <Line type="monotone" dataKey="price" stroke="currentColor" dot={false} strokeWidth={2} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                        <div className="ingredient-history-list">
                          {filteredPriceHistory.slice().reverse().map((history) => (
                            <div key={history.id || `${history.invoiceId}-${history.date}-${history.priceExVAT}`} className="ingredient-history-row">
                              <span>{history.date || 'No date'}</span>
                              <strong>{formatMoney(history.priceExVAT ?? history.price)}</strong>
                              <span>{history.supplier || history.supplierName || 'Unknown supplier'}</span>
                              <span>{history.unit || history.priceUnit || ingredient.lastUnit || ingredient.unit || 'each'}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    <button
                      type="button"
                      className="ghost-button compact-action"
                      onClick={() => handleDeleteIngredient(ingredient)}
                      disabled={!canManageInvoices || deletingIngredientId === ingredient.id}
                    >
                      {deletingIngredientId === ingredient.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                );
              })}
            </div>
            {visibleIngredientPage.hasMore && (
              <div className="load-more-row">
                <button
                  type="button"
                  className="ghost-button is-warning"
                  onClick={() => setVisibleIngredientLimit(visibleIngredientPage.nextLimit)}
                >
                  Load more ingredients
                </button>
                <span className="small-text">
                  Showing {visibleIngredientPage.visibleCount} of {visibleIngredientPage.totalCount}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {activeView === 'history' && (
        <section className="panel">
          <div className="panel-body">
            <div className="section-header">
              <div>
                <p className="eyebrow">History</p>
                <h2 className="title">Invoice History</h2>
              </div>
              <span className="badge">{filteredInvoices.length} invoices</span>
            </div>

            <div className="metrics-grid">
              <div className="metric-card">
                <span className="metric-value">{formatMoney(historySummary.totalExVAT)}</span>
                <span className="metric-label">Spend excl VAT</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{formatMoney(historySummary.totalVAT)}</span>
                <span className="metric-label">VAT</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{formatMoney(historySummary.totalIncVAT)}</span>
                <span className="metric-label">Spend incl VAT</span>
              </div>
            </div>

            <div className="field-grid">
              <input type="search" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} className="input" placeholder="Search supplier" />
              <input type="date" value={historyStartDate} onChange={(event) => setHistoryStartDate(event.target.value)} className="input" />
              <input type="date" value={historyEndDate} onChange={(event) => setHistoryEndDate(event.target.value)} className="input" />
            </div>

            <div className="invoice-history-list">
              {filteredInvoices.length === 0 ? (
                <div className="empty-state">No confirmed invoices match this filter.</div>
              ) : visibleInvoicePage.records.map((invoice) => (
                <details key={invoice.id} className="invoice-history-row">
                  <summary>
                    <strong>{invoice.supplier || 'Unknown supplier'}</strong>
                    <span>{invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : 'No invoice no.'}</span>
                    <span>{invoice.invoiceDate || 'No date'}</span>
                    <span>{formatMoney(invoice.totalExVAT)} ex VAT</span>
                    <span className="badge">{invoice.status || 'confirmed'}</span>
                  </summary>
                  <div className="invoice-history-lines">
                    <div className="stock-movement-row">
                      <span className="small-text">
                        {invoice.invoiceNumber ? `Invoice #${invoice.invoiceNumber}` : 'No invoice number'} | {invoice.lineItems?.length || 0} line{invoice.lineItems?.length === 1 ? '' : 's'}
                      </span>
                      <button
                        type="button"
                        className="ghost-button compact-action is-danger"
                        onClick={() => handleDeleteInvoice(invoice)}
                        disabled={!canManageInvoices || deletingInvoiceId === invoice.id}
                      >
                        {deletingInvoiceId === invoice.id ? 'Deleting...' : 'Delete invoice'}
                      </button>
                    </div>
                    {(Array.isArray(invoice.lineItems) ? invoice.lineItems : []).map((item) => (
                      <div key={item.id || item.itemName} className="stock-movement-row">
                        <strong>{item.itemName}</strong>
                        <span className="small-text">{item.quantity} {item.unit}</span>
                        <span>{formatMoney(item.priceExVAT)} ex</span>
                        <span>{formatMoney(item.priceIncVAT)} incl</span>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            {visibleInvoicePage.hasMore && (
              <div className="load-more-row">
                <button
                  type="button"
                  className="ghost-button is-warning"
                  onClick={() => setVisibleInvoiceLimit(visibleInvoicePage.nextLimit)}
                >
                  Load more invoices
                </button>
                <span className="small-text">
                  Showing {visibleInvoicePage.visibleCount} of {visibleInvoicePage.totalCount}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {activeView === 'reports' && (
        <section className="panel">
          <div className="panel-body">
            <div className="section-header">
              <div>
                <p className="eyebrow">Reports</p>
                <h2 className="title">Invoice Spend & Price Movement</h2>
              </div>
              <div className="manager-row">
                <button type="button" className="ghost-button compact-action" onClick={handleExportInvoiceLines} disabled={!canExportInvoiceReports || reportData.invoiceLineRows.length === 0}>
                  Export lines
                </button>
                <button type="button" className="ghost-button compact-action" onClick={handleExportPriceHistory} disabled={!canExportInvoiceReports || reportData.priceHistoryRows.length === 0}>
                  Export prices
                </button>
              </div>
            </div>

            <div className="field-grid">
              <input type="date" value={reportStartDate} onChange={(event) => setReportStartDate(event.target.value)} className="input" aria-label="Report start date" />
              <input type="date" value={reportEndDate} onChange={(event) => setReportEndDate(event.target.value)} className="input" aria-label="Report end date" />
              <button type="button" className="ghost-button compact-action" onClick={() => { setReportStartDate(''); setReportEndDate(''); }}>
                Clear dates
              </button>
            </div>

            {!canExportInvoiceReports && (
              <div className="notice-panel notice-panel--warning">
                <p className="small-text" style={{ margin: 0 }}>Exports are owner or manager only.</p>
              </div>
            )}

            <div className="metrics-grid">
              <div className="metric-card">
                <span className="metric-value">{formatMoney(reportData.summary.totalExVAT)}</span>
                <span className="metric-label">Spend excl VAT</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{formatMoney(reportData.summary.totalVAT)}</span>
                <span className="metric-label">VAT tracked</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{reportData.summary.invoiceCount}</span>
                <span className="metric-label">Invoices</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{reportData.summary.ingredientCount}</span>
                <span className="metric-label">Ingredients bought</span>
              </div>
            </div>

            <div className="invoice-report-grid">
              <div className="invoice-report-panel">
                <h3 className="breakdown-title">Supplier Spend</h3>
                {reportData.supplierSpend.length === 0 ? (
                  <div className="empty-state">No supplier spend in this range.</div>
                ) : reportData.supplierSpend.map((supplier) => (
                  <div key={supplier.supplier} className="invoice-report-row">
                    <div>
                      <strong>{supplier.supplier}</strong>
                      <span className="small-text">{supplier.invoices} invoice{supplier.invoices === 1 ? '' : 's'}</span>
                    </div>
                    <span>{formatMoney(supplier.spendExVAT)} ex</span>
                    <span className="badge">{formatMoney(supplier.spendIncVAT)} incl</span>
                  </div>
                ))}
              </div>

              <div className="invoice-report-panel">
                <h3 className="breakdown-title">Top Ingredients By Spend</h3>
                {reportData.ingredientSpend.length === 0 ? (
                  <div className="empty-state">No ingredient spend in this range.</div>
                ) : reportData.ingredientSpend.map((ingredient) => (
                  <div key={ingredient.name} className="invoice-report-row">
                    <div>
                      <strong>{ingredient.name}</strong>
                      <span className="small-text">{Number(ingredient.quantity || 0).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} {ingredient.unit || 'units'} · {ingredient.suppliers || 'No supplier'}</span>
                    </div>
                    <span>{formatMoney(ingredient.spendExVAT)} ex</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="invoice-report-panel">
              <h3 className="breakdown-title">Largest Price Changes</h3>
              {reportData.priceChanges.length === 0 ? (
                <div className="empty-state">No repeated ingredient prices in this range yet.</div>
              ) : reportData.priceChanges.map((change) => (
                <div key={change.id || change.name} className="invoice-report-row">
                  <div>
                    <strong>{change.name}</strong>
                    <span className="small-text">{change.supplier || 'Unknown supplier'} · {change.unit || 'unit'}</span>
                  </div>
                  <span>{formatMoney(change.previousPrice)} to {formatMoney(change.latestPrice)}</span>
                  <span className={change.changePercent > 0 ? 'badge is-red' : 'badge is-green'}>
                    {change.changePercent > 0 ? '+' : ''}{formatPercent(change.changePercent)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {activeNewDraft && activeNewLineItem && (
        <div className="drawer-backdrop" role="presentation">
          <aside className="invoice-drawer" aria-label="New ingredient setup">
            <div className="section-header">
              <div>
                <p className="eyebrow">New item</p>
                <h2 className="title">Ingredient Setup</h2>
              </div>
              <button type="button" className="delete-button" onClick={() => setNewDrawerLineId('')}>x</button>
            </div>

            <div className="field">
              <label htmlFor="new-ingredient-name">Name</label>
              <input id="new-ingredient-name" className="input" value={activeNewDraft.name} onChange={(event) => updateNewIngredientDraft(newDrawerLineId, { name: event.target.value, id: createInvoiceKey(event.target.value) })} />
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="new-ingredient-category">Category</label>
                <select id="new-ingredient-category" className="select" value={activeNewDraft.category} onChange={(event) => updateNewIngredientDraft(newDrawerLineId, { category: event.target.value })}>
                  {INVOICE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="new-ingredient-unit">Unit</label>
                <input
                  id="new-ingredient-unit"
                  className="input"
                  value={activeNewDraft.unit}
                  onChange={(event) => updateNewIngredientDraft(newDrawerLineId, { unit: event.target.value })}
                  list="invoice-unit-options"
                  placeholder="kg, 5L, case of 12"
                />
              </div>
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="new-ingredient-par">Par level</label>
                <input id="new-ingredient-par" type="number" min="0" step="0.001" className="input" value={activeNewDraft.parLevel} onChange={(event) => updateNewIngredientDraft(newDrawerLineId, { parLevel: event.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="new-ingredient-reorder">Reorder point</label>
                <input id="new-ingredient-reorder" type="number" min="0" step="0.001" className="input" value={activeNewDraft.reorderPoint} onChange={(event) => updateNewIngredientDraft(newDrawerLineId, { reorderPoint: event.target.value })} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="new-ingredient-supplier">Preferred supplier</label>
              <input id="new-ingredient-supplier" className="input" value={activeNewDraft.preferredSupplier} onChange={(event) => updateNewIngredientDraft(newDrawerLineId, { preferredSupplier: event.target.value })} />
            </div>

            <div className="field">
              <span className="field-label">Link to menu recipes</span>
              <div className="invoice-link-list">
                {allMenuItems.map((menuItem) => {
                  const checked = activeNewDraft.linkedMenuItemIds.includes(menuItem.id || menuItem.key);

                  return (
                    <label key={menuItem.id || menuItem.key} className="invoice-link-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const menuItemId = menuItem.id || menuItem.key;
                          updateNewIngredientDraft(newDrawerLineId, {
                            linkedMenuItemIds: event.target.checked
                              ? [...activeNewDraft.linkedMenuItemIds, menuItemId]
                              : activeNewDraft.linkedMenuItemIds.filter((id) => id !== menuItemId),
                          });
                        }}
                      />
                      <span>{menuItem.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="notice-panel notice-panel--warning">
              <div>
                <h3 className="breakdown-title">From invoice line</h3>
                <p className="small-text" style={{ margin: 0 }}>
                  {formatMoney(activeNewLineItem.priceExVAT)} ex VAT, {formatMoney(activeNewLineItem.priceIncVAT)} incl VAT
                </p>
              </div>
            </div>

            <button type="button" className="primary-button" onClick={saveNewIngredientDraft}>
              Save ingredient
            </button>
          </aside>
        </div>
      )}
    </section>
  );
}

export default InvoiceScanner;
