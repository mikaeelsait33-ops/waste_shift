import { useEffect, useMemo, useRef, useState } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import {
  INVOICE_CATEGORIES,
  calculateRecipeCostImpact,
  calculateVatValues,
  createInvoiceKey,
  getBaseUnitInfo,
  getIngredientMatch,
  normalizeInvoiceUnit,
  roundMoney,
  summarizeInvoiceItems,
} from '../utils/invoiceParsing';
import {
  invoiceFirestoreIsConfigured,
  loadInvoiceWorkspaceData,
  saveConfirmedInvoice,
  saveIngredient,
  saveInvoiceSettings,
  updateStockFromInvoice,
} from '../services/invoiceFirestore';

const DEFAULT_VAT_RATE = 0.15;
const UNIT_OPTIONS = ['kg', 'g', 'L', 'ml', 'each', 'case', 'doz', 'pkt', 'bag', 'box', 'bottle', 'tray', 'tin', 'punnet', 'bunch', 'head', 'pillow'];
const SCAN_IMAGE_MAX_EDGE = 1800;
const SCAN_IMAGE_QUALITY = 0.84;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const SUPPORTED_SCAN_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

const formatMoney = (value) => `R${Number(value || 0).toFixed(2)}`;
const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;
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

const createIngredientRows = ({ lineItems, matches, newIngredientDrafts, supplierName }) => (
  lineItems.map((lineItem) => {
    const match = matches.get(lineItem.id);
    const draft = newIngredientDrafts[lineItem.id];
    const ingredient = match?.ingredient || null;
    const ingredientName = ingredient?.name || draft?.name || lineItem.itemName;
    const ingredientId = ingredient?.id || draft?.id || createInvoiceKey(ingredientName);
    const previousPrice = Number(ingredient?.lastPriceExVAT || 0);
    const changePercent = previousPrice > 0
      ? roundMoney(((lineItem.priceExVAT - previousPrice) / previousPrice) * 100)
      : 0;

    return {
      lineItemId: lineItem.id,
      ingredientId,
      ingredientName,
      category: ingredient?.category || draft?.category || 'Other',
      unit: lineItem.baseUnit || lineItem.unit || ingredient?.unit || 'each',
      parLevel: Number(draft?.parLevel ?? ingredient?.parLevel ?? 0) || 0,
      reorderPoint: Number(draft?.reorderPoint ?? ingredient?.reorderPoint ?? 0) || 0,
      preferredSupplier: draft?.preferredSupplier || ingredient?.preferredSupplier || supplierName,
      priceExVAT: lineItem.priceExVAT,
      priceIncVAT: lineItem.priceIncVAT,
      priceChangePercent: changePercent,
      priceDirection: previousPrice <= 0 ? 'new' : changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat',
    };
  })
);

function InvoiceScanner({ accessProfile, recipes, menuItems, onInvoiceSaved }) {
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
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vatRate, setVatRate] = useState(DEFAULT_VAT_RATE);
  const [vatMode, setVatMode] = useState('inclusive');
  const [lineItems, setLineItems] = useState([]);
  const [manualLineDraft, setManualLineDraft] = useState(EMPTY_MANUAL_LINE);
  const [scanFile, setScanFile] = useState(null);
  const [isScanningInvoice, setIsScanningInvoice] = useState(false);
  const [scanSummary, setScanSummary] = useState(null);
  const scanFileInputRef = useRef(null);
  const [newDrawerLineId, setNewDrawerLineId] = useState('');
  const [newIngredientDrafts, setNewIngredientDrafts] = useState({});
  const [confirmedInvoice, setConfirmedInvoice] = useState(null);
  const [stockUpdates, setStockUpdates] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');

  const canManageInvoices = Boolean(accessProfile?.canManageStoreRoom || accessProfile?.canManageMenu);
  const firebaseReady = invoiceFirestoreIsConfigured();
  const localMenuItems = useMemo(() => createLocalMenuItems(recipes, menuItems), [recipes, menuItems]);
  const allMenuItems = useMemo(() => (
    mergeMenuItems(workspace.menuItems, localMenuItems)
  ), [localMenuItems, workspace.menuItems]);
  const matches = useMemo(() => {
    const lookup = new Map();

    lineItems.forEach((lineItem) => {
      lookup.set(lineItem.id, getIngredientMatch(lineItem.itemName, workspace.ingredients));
    });

    return lookup;
  }, [lineItems, workspace.ingredients]);
  const matchedCount = [...matches.values()].filter((match) => match.ingredient).length;
  const newLineItems = lineItems.filter((lineItem) => !matches.get(lineItem.id)?.ingredient);
  const totals = useMemo(() => summarizeInvoiceItems(lineItems), [lineItems]);
  const ingredientRows = useMemo(() => createIngredientRows({
    lineItems,
    matches,
    newIngredientDrafts,
    supplierName,
  }), [lineItems, matches, newIngredientDrafts, supplierName]);
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
      const invoiceDateValue = new Date(invoice.invoiceDate || invoice.scannedAt || 0);
      const matchesSearch = !search || String(invoice.supplier || '').toLowerCase().includes(search);

      if (!matchesSearch) return false;
      if (start && invoiceDateValue < start) return false;
      if (end && invoiceDateValue > end) return false;
      return true;
    });
  }, [historyEndDate, historySearch, historyStartDate, workspace.invoices]);
  const historySummary = useMemo(() => ({
    totalExVAT: roundMoney(filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.totalExVAT || 0), 0)),
    totalVAT: roundMoney(filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.totalVAT || 0), 0)),
    totalIncVAT: roundMoney(filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.totalIncVAT || 0), 0)),
  }), [filteredInvoices]);

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
      costPerBaseUnitExVAT: base.quantity > 0 ? roundMoney(vat.priceExVAT / base.quantity) : 0,
    };
  };

  const createManualLineItem = (draft) => {
    const quantity = Number(draft.quantity) > 0 ? Number(draft.quantity) : 1;
    const unitPrice = Number(draft.unitPrice) || 0;
    const lineTotal = Number(draft.lineTotal) || roundMoney(quantity * unitPrice);
    const itemName = String(draft.itemName || '').trim();

    return applyLineCalculations({
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
    setConfirmedInvoice(null);
    setStockUpdates([]);
  };

  const clearParsedLines = () => {
    setLineItems([]);
    setNewDrawerLineId('');
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

  const handleScanFileChange = (event) => {
    const file = event.target.files?.[0] || null;

    setScanSummary(null);
    setScanFile(file);

    if (!file) {
      return;
    }

    if (!SUPPORTED_SCAN_TYPES.has(file.type)) {
      setMessage('Upload a JPG, PNG, WEBP, or PDF invoice.');
      setScanFile(null);
      event.target.value = '';
      return;
    }

    setMessage(`${file.name} selected for Gemini scanning.`);
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

      const scanPayload = await createScanPayload(scanFile);
      const response = await fetch('/api/gemini-invoice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
      const createdAt = Date.now();
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
            id: `gemini-${createdAt}-${index}-${createInvoiceKey(itemName) || Math.random().toString(36).slice(2)}`,
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

      if (invoice.supplierName) {
        setSupplierName(invoice.supplierName);
      }

      if (/^\d{4}-\d{2}-\d{2}$/.test(invoice.invoiceDate || '')) {
        setInvoiceDate(invoice.invoiceDate);
      }

      setVatMode(nextVatMode);
      setVatRate(nextVatRate);
      setLineItems((currentItems) => [...currentItems, ...scannedLines]);
      setConfirmedInvoice(null);
      setStockUpdates([]);
      setScanSummary({
        fileName: scanFile.name,
        lineCount: scannedLines.length,
        supplierName: invoice.supplierName || '',
        model: body.model || 'Gemini',
      });
      setMessage(`Gemini added ${scannedLines.length} invoice line${scannedLines.length === 1 ? '' : 's'} for review.`);
    } catch (error) {
      setMessage(error?.message || 'Could not scan this invoice with Gemini.');
    } finally {
      setIsScanningInvoice(false);
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
        unit: existingDraft?.unit || lineItem.baseUnit || lineItem.unit || 'each',
        parLevel: existingDraft?.parLevel || '',
        reorderPoint: existingDraft?.reorderPoint || '',
        preferredSupplier: existingDraft?.preferredSupplier || supplierName,
        linkedMenuItemIds: existingDraft?.linkedMenuItemIds || [],
        lastPriceExVAT: lineItem.priceExVAT,
        lastPriceIncVAT: lineItem.priceIncVAT,
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
      await saveIngredient(draft);
      await refreshWorkspace();
      setNewDrawerLineId('');
      setMessage(`${draft.name} saved to ingredients.`);
    } catch (error) {
      setMessage(error?.message || 'Could not save this ingredient.');
    }
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

  const confirmInvoice = async () => {
    if (!canManageInvoices) {
      setMessage('Only an owner, manager, chef, or barista can confirm invoices.');
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

    const invoiceId = `invoice_${Date.now()}`;
    const manualSourceText = lineItems
      .map((item) => `${item.itemName} | ${item.quantity} ${item.unit} | ${formatMoney(item.unitPrice)} | ${formatMoney(item.lineTotal)}`)
      .join('\n');

    try {
      const result = await saveConfirmedInvoice({
        invoiceId,
        supplierName,
        invoiceDate,
        lineItems,
        ingredientRows,
        totals,
        vatRate,
        vatMode,
        rawText: manualSourceText,
      });

      if (!result?.ok) {
        throw new Error('Invoice save was skipped.');
      }

      setConfirmedInvoice({
        invoiceId: result.invoiceId,
        lineItems,
        ingredientRows,
      });
      setMessage('Invoice confirmed and saved. You can update stock now.');
      await refreshWorkspace();
    } catch (error) {
      setMessage(error?.message || 'Could not confirm this invoice.');
    }
  };

  const handleUpdateStock = async () => {
    if (!confirmedInvoice?.invoiceId) {
      setMessage('Confirm the invoice before updating stock.');
      return;
    }

    try {
      const result = await updateStockFromInvoice({
        invoiceId: confirmedInvoice.invoiceId,
        lineItems: confirmedInvoice.lineItems,
        ingredientRows: confirmedInvoice.ingredientRows,
      });

      setStockUpdates(result.updates || []);
      setMessage(`Stock updated for ${result.updates?.length || 0} ingredient${result.updates?.length === 1 ? '' : 's'}.`);
      await refreshWorkspace();
    } catch (error) {
      setMessage(error?.message || 'Could not update stock from this invoice.');
    }
  };

  const renderPriceBadge = (lineItem) => {
    const match = matches.get(lineItem.id);
    const previousPrice = Number(match?.ingredient?.lastPriceExVAT || 0);

    if (!match?.ingredient || previousPrice <= 0) {
      return <span className="badge is-blue">New</span>;
    }

    const change = ((lineItem.priceExVAT - previousPrice) / previousPrice) * 100;

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
          <button type="button" className={`segment-button${activeView === 'history' ? ' is-active' : ''}`} onClick={() => setActiveView('history')}>
            History
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
                    <label htmlFor="invoice-date">Invoice date</label>
                    <input id="invoice-date" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="input" />
                  </div>
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
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={handleScanFileChange}
                      className="invoice-file-input"
                    />
                    <span className="invoice-upload-label">{scanFile ? scanFile.name : 'Choose invoice file'}</span>
                    <span className="small-text">JPG, PNG, WEBP, or PDF</span>
                  </label>
                  <div className="invoice-manual-actions">
                    <button type="button" className="primary-button" onClick={scanInvoiceWithGemini} disabled={!scanFile || isScanningInvoice}>
                      {isScanningInvoice ? 'Scanning...' : 'Scan invoice'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setScanFile(null);
                        setScanSummary(null);
                        if (scanFileInputRef.current) {
                          scanFileInputRef.current.value = '';
                        }
                      }}
                      disabled={isScanningInvoice || !scanFile}
                    >
                      Clear file
                    </button>
                  </div>
                  {scanSummary && (
                    <div className="invoice-scan-status">
                      <span className="badge is-green">{scanSummary.lineCount} lines</span>
                      {scanSummary.supplierName && <span className="badge">{scanSummary.supplierName}</span>}
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
                    <select
                      value={manualLineDraft.unit}
                      onChange={(event) => setManualLineDraft((draft) => ({ ...draft, unit: event.target.value }))}
                      className="select"
                    >
                      {UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
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
                  {lineItems.length > 0 && (
                    <button type="button" className="ghost-button compact-action" onClick={clearParsedLines}>
                      Clear lines
                    </button>
                  )}
                </div>
              </div>

              {lineItems.length === 0 ? (
                <div className="empty-state">Add invoice lines manually, then review them here.</div>
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
                  {lineItems.map((lineItem) => {
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
                          <select value={lineItem.unit} onChange={(event) => updateLineItem(lineItem.id, 'unit', event.target.value)} className="select">
                            {UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                          </select>
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
                          {match?.ingredient ? (
                            <>
                              <span className="badge is-green">{match.ingredient.name}</span>
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
                <button type="button" className="primary-button" onClick={confirmInvoice} disabled={!canManageInvoices || lineItems.length === 0}>
                  {canManageInvoices ? 'Confirm invoice' : 'Manager only'}
                </button>
                <button type="button" className="ghost-button is-warning" onClick={handleUpdateStock} disabled={!confirmedInvoice}>
                  Update Stock
                </button>
              </div>

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
              ) : filteredInvoices.map((invoice) => (
                <details key={invoice.id} className="invoice-history-row">
                  <summary>
                    <strong>{invoice.supplier || 'Unknown supplier'}</strong>
                    <span>{invoice.invoiceDate || 'No date'}</span>
                    <span>{formatMoney(invoice.totalExVAT)} ex VAT</span>
                    <span className="badge">{invoice.status || 'confirmed'}</span>
                  </summary>
                  <div className="invoice-history-lines">
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
                <select id="new-ingredient-unit" className="select" value={activeNewDraft.unit} onChange={(event) => updateNewIngredientDraft(newDrawerLineId, { unit: event.target.value })}>
                  {UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
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
