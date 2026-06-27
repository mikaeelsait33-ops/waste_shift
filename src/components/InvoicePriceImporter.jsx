import { useMemo, useState } from 'react';

const MAX_CLIENT_FILE_BYTES = 4 * 1024 * 1024;
const TEXT_FILE_TYPES = new Set([
  'text/plain',
  'text/csv',
  'application/json',
  'application/vnd.ms-excel',
]);

const normalizeName = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(the|and|with|fresh|frozen|case|pack|unit|each|kg|g|ml|l)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const createItemKey = (value) => normalizeName(value).replace(/\s+/g, '_');

const parsePriceValue = (value) => {
  const parsedValue = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const formatPrice = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `R${numericValue.toFixed(2)}` : 'No price';
};

const getTokens = (value) => normalizeName(value)
  .split(' ')
  .filter((token) => token.length > 1);

const getSimilarityScore = (sourceName, targetName) => {
  const source = normalizeName(sourceName);
  const target = normalizeName(targetName);

  if (!source || !target) {
    return 0;
  }

  if (source === target) {
    return 1;
  }

  if (source.includes(target) || target.includes(source)) {
    return 0.86;
  }

  const sourceTokens = new Set(getTokens(source));
  const targetTokens = new Set(getTokens(target));
  const sharedTokens = [...sourceTokens].filter((token) => targetTokens.has(token));

  if (sharedTokens.length === 0) {
    return 0;
  }

  return sharedTokens.length / Math.max(sourceTokens.size, targetTokens.size);
};

const readFileAsText = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not read that invoice file.'));
  reader.readAsText(file);
});

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not read that invoice file.'));
  reader.readAsDataURL(file);
});

function InvoicePriceImporter({
  recipes,
  catalogEntries,
  onAddRecipe,
  onSaveMenuItem,
}) {
  const [invoiceText, setInvoiceText] = useState('');
  const [fileInfo, setFileInfo] = useState(null);
  const [fileDataUrl, setFileDataUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');

  const safeRecipes = useMemo(() => (
    recipes && typeof recipes === 'object' ? recipes : {}
  ), [recipes]);
  const safeCatalogEntries = useMemo(() => (
    Array.isArray(catalogEntries) ? catalogEntries : []
  ), [catalogEntries]);
  const menuTargets = useMemo(() => (
    safeCatalogEntries.map((entry) => ({
      type: 'menu',
      key: entry.key,
      value: `menu:${entry.key}`,
      name: entry.name,
      label: `${entry.name} - menu price`,
    }))
  ), [safeCatalogEntries]);
  const ingredientTargets = useMemo(() => {
    const targetsByKey = new Map();

    Object.entries(safeRecipes).forEach(([recipeKey, recipe]) => {
      const recipeName = recipe?.name || recipeKey;

      (Array.isArray(recipe?.ingredients) ? recipe.ingredients : []).forEach((ingredient) => {
        const ingredientName = String(ingredient?.name || '').trim();
        const ingredientKey = createItemKey(ingredientName);

        if (!ingredientName || !ingredientKey) {
          return;
        }

        const currentTarget = targetsByKey.get(ingredientKey);

        if (currentTarget) {
          currentTarget.recipeNames.add(recipeName);
          return;
        }

        targetsByKey.set(ingredientKey, {
          type: 'ingredient',
          key: ingredientKey,
          value: `ingredient:${ingredientKey}`,
          name: ingredientName,
          recipeNames: new Set([recipeName]),
        });
      });
    });

    return [...targetsByKey.values()]
      .map((target) => ({
        ...target,
        label: `${target.name} - ${target.recipeNames.size} recipe${target.recipeNames.size !== 1 ? 's' : ''}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [safeRecipes]);
  const targetLookup = useMemo(() => {
    const lookup = new Map();

    [...menuTargets, ...ingredientTargets].forEach((target) => {
      lookup.set(target.value, target);
    });

    return lookup;
  }, [menuTargets, ingredientTargets]);

  const getSuggestedTarget = (item) => {
    const candidates = [...ingredientTargets, ...menuTargets]
      .map((target) => ({
        target,
        score: getSimilarityScore(item.description, target.name),
      }))
      .sort((a, b) => b.score - a.score);
    const bestCandidate = candidates[0];

    return bestCandidate?.score >= 0.38 ? bestCandidate.target.value : 'skip';
  };

  const createImportRows = (items) => (
    (Array.isArray(items) ? items : []).map((item, index) => {
      const priceToApply = item.unitPrice ?? item.lineTotal;
      const target = getSuggestedTarget(item);

      return {
        id: `${item.description}-${index}`,
        description: item.description || '',
        quantity: item.quantity ?? '',
        unit: item.unit || '',
        unitPrice: item.unitPrice ?? null,
        lineTotal: item.lineTotal ?? null,
        confidence: Number(item.confidence) || 0,
        rawLine: item.rawLine || '',
        priceToApply: priceToApply !== null && priceToApply !== undefined ? String(priceToApply) : '',
        target,
        selected: target !== 'skip',
      };
    })
  );

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (file.size > MAX_CLIENT_FILE_BYTES) {
      setMessage('That invoice is too large. Use a smaller photo or paste the invoice text.');
      return;
    }

    setFileInfo({
      name: file.name,
      type: file.type || 'unknown',
      size: file.size,
    });
    setRows([]);
    setMessage('');

    try {
      if (TEXT_FILE_TYPES.has(file.type) || /\.(csv|txt|json)$/i.test(file.name)) {
        const text = await readFileAsText(file);
        setInvoiceText(text);
        setFileDataUrl('');
        setMessage('Invoice text loaded. Review it, then scan prices.');
        return;
      }

      const dataUrl = await readFileAsDataUrl(file);
      setFileDataUrl(dataUrl);
      setMessage('Invoice image loaded. Scan prices when ready.');
    } catch (error) {
      setMessage(error?.message || 'Could not read that invoice file.');
    }
  };

  const scanInvoice = async () => {
    if (!invoiceText.trim() && !fileDataUrl) {
      setMessage('Upload an invoice image or paste invoice text first.');
      return;
    }

    setIsScanning(true);
    setMessage('Scanning invoice prices...');

    try {
      const response = await fetch('/api/invoice-prices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceText,
          fileDataUrl,
          fileName: fileInfo?.name || '',
          fileType: fileInfo?.type || '',
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || 'Could not scan that invoice.');
      }

      const nextRows = createImportRows(payload.items);
      setRows(nextRows);
      setMessage(nextRows.length > 0
        ? `Found ${nextRows.length} price line${nextRows.length !== 1 ? 's' : ''} from ${payload.source === 'ai' ? 'invoice scan' : 'invoice text'}.`
        : payload.message || 'No prices were found.');
    } catch (error) {
      setMessage(error?.message || 'Could not scan that invoice.');
    } finally {
      setIsScanning(false);
    }
  };

  const updateRow = (rowId, updates) => {
    setRows((currentRows) => (
      currentRows.map((row) => (row.id === rowId ? { ...row, ...updates } : row))
    ));
  };

  const selectAllMatchedRows = () => {
    setRows((currentRows) => (
      currentRows.map((row) => ({
        ...row,
        selected: row.target !== 'skip',
      }))
    ));
  };

  const clearRows = () => {
    setRows([]);
    setMessage('');
  };

  const applySelectedPrices = () => {
    const selectedRows = rows.filter((row) => (
      row.selected
      && row.target !== 'skip'
      && parsePriceValue(row.priceToApply) !== null
    ));

    if (selectedRows.length === 0) {
      setMessage('Select at least one matched price before applying.');
      return;
    }

    const ingredientPricesByKey = new Map();
    let menuUpdates = 0;

    selectedRows.forEach((row) => {
      const target = targetLookup.get(row.target);
      const price = parsePriceValue(row.priceToApply);

      if (!target || price === null) {
        return;
      }

      if (target.type === 'menu') {
        onSaveMenuItem?.({
          key: target.key,
          name: target.name,
          price: String(price),
        });
        menuUpdates += 1;
        return;
      }

      ingredientPricesByKey.set(target.key, price);
    });

    let recipeUpdates = 0;

    if (ingredientPricesByKey.size > 0) {
      Object.entries(safeRecipes).forEach(([recipeKey, recipe]) => {
        const safeIngredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
        let recipeChanged = false;
        const updatedIngredients = safeIngredients.map((ingredient) => {
          const ingredientKey = createItemKey(ingredient?.name);

          if (!ingredientPricesByKey.has(ingredientKey)) {
            return ingredient;
          }

          recipeChanged = true;
          return {
            ...ingredient,
            cost: ingredientPricesByKey.get(ingredientKey),
          };
        });

        if (recipeChanged) {
          onAddRecipe?.(recipeKey, {
            ...recipe,
            ingredients: updatedIngredients,
          });
          recipeUpdates += 1;
        }
      });
    }

    setMessage(`Applied ${selectedRows.length} price${selectedRows.length !== 1 ? 's' : ''}: ${menuUpdates} menu update${menuUpdates !== 1 ? 's' : ''}, ${recipeUpdates} recipe update${recipeUpdates !== 1 ? 's' : ''}.`);
  };

  const matchedCount = rows.filter((row) => row.target !== 'skip').length;
  const selectedCount = rows.filter((row) => row.selected && row.target !== 'skip').length;

  return (
    <section className="panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Invoice pricing</p>
            <h2 className="title">Invoice Price Importer</h2>
            <p className="subtitle">Scan supplier invoices, review matched prices, then apply only the lines you trust.</p>
          </div>
          {rows.length > 0 && <span className="badge is-green">{matchedCount} matched</span>}
        </div>

        <div className="invoice-importer">
          <div className="invoice-dropzone">
            <label htmlFor="invoice-file" className="field-label">Invoice file</label>
            <input
              id="invoice-file"
              type="file"
              accept="image/*,.txt,.csv,.json,application/pdf"
              onChange={handleFileChange}
              className="input"
            />
            {fileInfo && (
              <div className="small-text">
                {fileInfo.name} - {(fileInfo.size / 1024).toFixed(1)} KB
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="invoice-text">Paste invoice text</label>
            <textarea
              id="invoice-text"
              value={invoiceText}
              onChange={(event) => {
                setInvoiceText(event.target.value);
                setRows([]);
              }}
              placeholder="Paste copied invoice lines here if you have a PDF/text invoice."
              className="input invoice-textarea"
            />
          </div>
        </div>

        <div className="manager-row" style={{ marginTop: '14px' }}>
          <button type="button" onClick={scanInvoice} className="primary-button invoice-primary-action" disabled={isScanning}>
            {isScanning ? 'Scanning...' : 'Scan prices'}
          </button>
          {rows.length > 0 && (
            <button type="button" onClick={clearRows} className="ghost-button">
              Clear results
            </button>
          )}
        </div>

        {message && (
          <div className="inline-message" role="status">
            {message}
          </div>
        )}

        {rows.length > 0 && (
          <div className="invoice-results">
            <div className="smart-panel__header">
              <span className="breakdown-title">Review extracted prices</span>
              <div className="manager-row">
                <span className="badge">{selectedCount} selected</span>
                <button type="button" onClick={selectAllMatchedRows} className="ghost-button is-warning">
                  Select matched
                </button>
              </div>
            </div>

            <div className="invoice-result-list">
              {rows.map((row) => (
                <div key={row.id} className="invoice-result-row">
                  <label className="invoice-check">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={(event) => updateRow(row.id, { selected: event.target.checked })}
                      disabled={row.target === 'skip'}
                    />
                    <span>
                      <strong>{row.description}</strong>
                      <span className="small-text">
                        {row.quantity ? `Qty ${row.quantity}${row.unit ? ` ${row.unit}` : ''} - ` : ''}
                        Unit {formatPrice(row.unitPrice)} - Total {formatPrice(row.lineTotal)}
                      </span>
                    </span>
                  </label>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.priceToApply}
                    onChange={(event) => updateRow(row.id, { priceToApply: event.target.value })}
                    className="input"
                    aria-label={`Price to apply for ${row.description}`}
                  />

                  <select
                    value={row.target}
                    onChange={(event) => updateRow(row.id, {
                      target: event.target.value,
                      selected: event.target.value !== 'skip',
                    })}
                    className="select"
                    aria-label={`Match target for ${row.description}`}
                  >
                    <option value="skip">Skip this line</option>
                    <optgroup label="Recipe ingredients">
                      {ingredientTargets.map((target) => (
                        <option key={target.value} value={target.value}>
                          {target.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Menu prices">
                      {menuTargets.map((target) => (
                        <option key={target.value} value={target.value}>
                          {target.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>

                  <span className={row.confidence >= 0.75 ? 'badge is-green' : 'badge'}>
                    {Math.round(row.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>

            <button type="button" onClick={applySelectedPrices} className="primary-button" style={{ marginTop: '14px' }}>
              Apply selected prices
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export default InvoicePriceImporter;
