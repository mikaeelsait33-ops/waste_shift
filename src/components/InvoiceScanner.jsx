import { useEffect, useMemo, useRef, useState } from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import {
  INVOICE_CATEGORIES,
  calculateRecipeCostImpact,
  calculateVatValues,
  createInvoiceKey,
  getIngredientMatch,
  parseInvoiceText,
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

const ACCEPTED_TYPES = 'image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf';
const DEFAULT_VAT_RATE = 0.15;
const UNIT_OPTIONS = ['kg', 'g', 'L', 'ml', 'each', 'case', 'doz', 'pkt'];

const formatMoney = (value) => `R${Number(value || 0).toFixed(2)}`;
const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not read that file.'));
  reader.readAsDataURL(file);
});

const renderPdfFirstPage = async (file) => {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/png');
};

const runBrowserOcr = async (imageSource, onProgress) => {
  const Tesseract = await import('tesseract.js');
  const result = await Tesseract.recognize(imageSource, 'eng', {
    logger: (message) => {
      if (message?.status === 'recognizing text') {
        onProgress?.(Math.round((message.progress || 0) * 100));
      }
    },
  });

  return result?.data?.text || '';
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
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [workspace, setWorkspace] = useState({
    ingredients: [],
    menuItems: [],
    stockLevels: [],
    invoices: [],
    suppliers: [],
    settings: { vatRate: DEFAULT_VAT_RATE },
  });
  const [activeView, setActiveView] = useState('scan');
  const [fileInfo, setFileInfo] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [debugOpen, setDebugOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [message, setMessage] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vatRate, setVatRate] = useState(DEFAULT_VAT_RATE);
  const [vatMode, setVatMode] = useState('inclusive');
  const [lineItems, setLineItems] = useState([]);
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
          setMessage('Firebase is not configured. Invoice scanning can run, but saving is disabled.');
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

        if (['lineTotal', 'unitPrice', 'vatMode'].includes(field)) {
          const vat = calculateVatValues({
            lineTotal: nextItem.lineTotal,
            unitPrice: nextItem.unitPrice,
            vatMode: nextItem.vatMode,
            vatRate,
          });

          return {
            ...nextItem,
            ...vat,
          };
        }

        return nextItem;
      })
    ));
  };

  const parseAndApplyText = (text) => {
    const parsed = parseInvoiceText(text, { vatRate });
    setSupplierName(parsed.supplierName);
    setInvoiceDate(parsed.invoiceDate);
    setVatMode(parsed.vatMode);
    setLineItems(parsed.items);
    setMessage(parsed.items.length > 0
      ? `Found ${parsed.items.length} invoice line${parsed.items.length === 1 ? '' : 's'}. Review before confirming.`
      : 'No invoice lines were found. Check the debug text or try a clearer photo.');
  };

  const handleFile = async (file) => {
    if (!file) return;

    setMessage('');
    setLineItems([]);
    setConfirmedInvoice(null);
    setStockUpdates([]);
    setProgress(0);
    setFileInfo({
      name: file.name,
      type: file.type || 'unknown',
      size: file.size,
    });

    try {
      const imageUrl = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
        ? await renderPdfFirstPage(file)
        : await readFileAsDataUrl(file);

      setPreviewUrl(imageUrl);
      setRawText('');
      setMessage(file.type === 'application/pdf' ? 'PDF first page is ready to scan.' : 'Image is ready to scan.');
    } catch (error) {
      setMessage(error?.message || 'Could not prepare that invoice.');
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    handleFile(event.dataTransfer.files?.[0]);
  };

  const scanInvoice = async () => {
    if (!previewUrl) {
      setMessage('Upload or capture an invoice first.');
      return;
    }

    setIsScanning(true);
    setProgress(1);
    setMessage('Running browser OCR...');

    try {
      const text = await runBrowserOcr(previewUrl, setProgress);
      setRawText(text);
      parseAndApplyText(text);
      setDebugOpen(true);
      setProgress(100);
    } catch (error) {
      setMessage(error?.message || 'OCR failed. Try a brighter photo or a cropped invoice image.');
    } finally {
      setIsScanning(false);
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
      setMessage('Scan and review at least one invoice line before confirming.');
      return;
    }

    const invoiceId = `invoice_${Date.now()}`;

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
        rawText,
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
          <h2 className="title">Invoice Scanning & Stock Control</h2>
          <p className="subtitle">Scan supplier invoices, review prices, update recipes, and put stock on hand.</p>
        </div>
        <div className="segmented-control" aria-label="Invoice views">
          <button type="button" className={`segment-button${activeView === 'scan' ? ' is-active' : ''}`} onClick={() => setActiveView('scan')}>
            Scan
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
            <p className="small-text" style={{ margin: 0 }}>OCR still works locally, but invoices, ingredients, suppliers, and stock updates need Firebase env vars.</p>
          </div>
        </div>
      )}

      {activeView === 'scan' && (
        <>
          <div className="invoice-scan-grid">
            <section
              className="panel invoice-upload-panel"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <div className="panel-body">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Upload</p>
                    <h2 className="title">Capture Invoice</h2>
                  </div>
                  {fileInfo && <span className="badge">{(fileInfo.size / 1024).toFixed(1)} KB</span>}
                </div>

                <div className="invoice-drop-target">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Invoice preview" className="invoice-preview-image" />
                  ) : (
                    <div>
                      <strong>Drop invoice here</strong>
                      <span className="small-text">JPG, PNG, or first page of a PDF</span>
                    </div>
                  )}
                </div>

                <div className="manager-row">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_TYPES}
                    onChange={(event) => handleFile(event.target.files?.[0])}
                    className="input-hidden"
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => handleFile(event.target.files?.[0])}
                    className="input-hidden"
                  />
                  <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()}>
                    Upload file
                  </button>
                  <button type="button" className="ghost-button is-warning" onClick={() => cameraInputRef.current?.click()}>
                    Camera capture
                  </button>
                </div>

                {fileInfo && <p className="small-text">{fileInfo.name}</p>}

                <button type="button" className="primary-button invoice-primary-action" onClick={scanInvoice} disabled={isScanning || !previewUrl}>
                  {isScanning ? 'Scanning...' : 'Run OCR scan'}
                </button>

                {(isScanning || progress > 0) && (
                  <div className="invoice-progress">
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="small-text">{progress}%</span>
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-body">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Invoice details</p>
                    <h2 className="title">Confirm Header</h2>
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
                      onChange={(event) => setVatRate(Number(event.target.value) || 0)}
                      className="input"
                    />
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">Detected VAT mode</span>
                  <div className="segmented-control" aria-label="VAT mode">
                    {['inclusive', 'exclusive'].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setVatMode(mode);
                          setLineItems((currentItems) => currentItems.map((item) => ({
                            ...item,
                            vatMode: mode,
                            ...calculateVatValues({
                              lineTotal: item.lineTotal,
                              unitPrice: item.unitPrice,
                              vatMode: mode,
                              vatRate,
                            }),
                          })));
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
          </div>

          {message && <div className="inline-message" role="status">{message}</div>}

          {rawText && (
            <details className="panel invoice-debug-panel" open={debugOpen} onToggle={(event) => setDebugOpen(event.currentTarget.open)}>
              <summary className="breakdown-title">Raw OCR text</summary>
              <pre className="invoice-debug-text">{rawText}</pre>
            </details>
          )}

          <section className="panel">
            <div className="panel-body">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Line items</p>
                  <h2 className="title">Review Parsed Items</h2>
                  <p className="subtitle">Every field is editable before save. New ingredients are flagged for setup.</p>
                </div>
                <div className="manager-row">
                  <span className="badge is-green">{matchedCount} matched</span>
                  <span className={`badge${newLineItems.length > 0 ? ' is-yellow' : ''}`}>{newLineItems.length} new</span>
                </div>
              </div>

              {lineItems.length === 0 ? (
                <div className="empty-state">Upload an invoice, run OCR, then review parsed lines here.</div>
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
                        <input value={lineItem.itemName} onChange={(event) => updateLineItem(lineItem.id, 'itemName', event.target.value)} className="input" />
                        <input type="number" min="0" step="0.001" value={lineItem.quantity} onChange={(event) => updateLineItem(lineItem.id, 'quantity', event.target.value)} className="input" />
                        <select value={lineItem.unit} onChange={(event) => updateLineItem(lineItem.id, 'unit', event.target.value)} className="select">
                          {UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                        </select>
                        <input type="number" min="0" step="0.01" value={lineItem.unitPrice} onChange={(event) => updateLineItem(lineItem.id, 'unitPrice', event.target.value)} className="input" />
                        <input type="number" min="0" step="0.01" value={lineItem.lineTotal} onChange={(event) => updateLineItem(lineItem.id, 'lineTotal', event.target.value)} className="input" />
                        <span className="small-text">
                          {formatMoney(lineItem.priceExVAT)} ex<br />
                          {formatMoney(lineItem.vatAmount)} VAT
                        </span>
                        <div className="invoice-match-cell">
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
                <h3 className="breakdown-title">From scan</h3>
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
