import { useMemo, useRef, useState } from 'react';
import {
  getAutomaticManagerApiHeaders,
  getManagerApiErrorMessage,
} from '../utils/apiHeaders';
import {
  buildMenuImportSaveItems,
  catalogUnitMismatch,
  createMenuRecipeReview,
  getMenuImportCatalogOptions,
  getSmartMenuImportPlan,
} from '../utils/menuRecipeImport';
import { createImportHistoryRecord } from '../utils/menuImport';
import {
  calculateRecipeIngredientCost,
  formatIngredientQuantity,
  findItemPriceRecord,
  normalizeItemPriceUnit,
  sanitizeItemPriceCatalog,
} from '../utils/itemPriceCatalog';

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not prepare this menu file.'));
  reader.readAsDataURL(file);
});

const createFilePayload = async (file) => {
  const dataUrl = await readFileAsDataUrl(file);
  const [, base64 = ''] = dataUrl.split(',');

  return {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    data: base64,
  };
};

const shouldTryGeminiVisionFallback = (response) => (
  response?.status === 422 || Number(response?.status) >= 500
);

const normalizeDishesFromPayload = (payload) => {
  if (Array.isArray(payload?.dishes)) {
    return payload.dishes;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items.map((item) => ({
      ...item,
      ingredients: item.ingredients || item.components || [],
      instructions: item.instructions || item.description || '',
    }));
  }

  if (Array.isArray(payload?.extracted?.menuItems)) {
    return payload.extracted.menuItems.map((item) => ({
      name: item.name,
      category: item.category || 'Menu',
      sellingPrice: item.sellingPrice,
      instructions: item.description || '',
      confidence: item.confidence,
      warnings: item.needsReview ? ['Review OCR menu item before saving.'] : [],
      ingredients: (item.possibleIngredients || []).map((ingredient) => ({
        name: ingredient.ingredientName,
        quantity: ingredient.quantity || 1,
        unit: ingredient.unit || 'each',
      })),
    }));
  }

  return [];
};

function MenuImport({
  existingMenuItems = [],
  itemPriceCatalog = {},
  accessProfile,
  activeStaffMember,
  onSaveApprovedItems,
  onCreateCatalogItem,
  onCreateCatalogItems,
  compact = false,
}) {
  const fileInputRef = useRef(null);
  const [inputMode, setInputMode] = useState('text');
  const [rawText, setRawText] = useState('');
  const [sourceName, setSourceName] = useState('Pasted menu');
  const [reviewDishes, setReviewDishes] = useState([]);
  const [message, setMessage] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const safeCatalog = useMemo(() => sanitizeItemPriceCatalog(itemPriceCatalog), [itemPriceCatalog]);
  const catalogOptions = useMemo(() => getMenuImportCatalogOptions(safeCatalog), [safeCatalog]);
  const smartImportPlan = useMemo(() => getSmartMenuImportPlan(reviewDishes), [reviewDishes]);
  const canUseAiImports = !accessProfile || Boolean(accessProfile?.canUseAiImports);
  const canManageMenu = !accessProfile || Boolean(accessProfile?.canManageMenu);
  const operatorName = accessProfile?.operatorName || activeStaffMember?.name || 'Current operator';

  const refreshReview = (dishes) => {
    const existingNames = new Set(existingMenuItems.map((item) => String(item?.name || '').trim().toLowerCase()));
    const reviewed = createMenuRecipeReview(dishes, safeCatalog).map((dish) => ({
      ...dish,
      warnings: [
        ...dish.warnings,
        ...(existingNames.has(dish.name.toLowerCase()) ? ['Already exists in the menu catalog. Saving will update it.'] : []),
      ],
    }));

    setReviewDishes(reviewed);
    setMessage(reviewed.length > 0
      ? `${reviewed.length} dish${reviewed.length === 1 ? '' : 'es'} ready for review.`
      : 'No dishes were found. Try clearer text or a better menu photo.');
  };

  const requestGeminiMenuParse = async (text, nextSourceName, file = null) => {
    const response = await fetch('/api/gemini-menu', {
      method: 'POST',
      headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ text, file }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
      throw new Error(getManagerApiErrorMessage(payload, 'Gemini could not parse this menu.'));
    }

    setSourceName(nextSourceName);
    refreshReview(normalizeDishesFromPayload(payload));
  };

  const extractFromText = async () => {
    const text = rawText.trim();

    if (!canUseAiImports) {
      setMessage(`${operatorName} cannot use Gemini imports. Use a manager account.`);
      return;
    }

    if (!text) {
      setMessage('Paste the menu text first.');
      return;
    }

    setIsExtracting(true);
    setMessage('Asking Gemini to extract dishes and ingredients...');

    try {
      await requestGeminiMenuParse(text, sourceName || 'Pasted menu');
    } catch (error) {
      setMessage(error?.message || 'Menu text import failed.');
    } finally {
      setIsExtracting(false);
    }
  };

  const extractFromFile = async (file) => {
    if (!canUseAiImports) {
      setMessage(`${operatorName} cannot upload menu files for Gemini/OCR. Use a manager account.`);
      return;
    }

    setIsExtracting(true);
    setMessage('Reading menu file with OCR, then structuring recipes with Gemini...');

    try {
      const filePayload = await createFilePayload(file);
      const ocrResponse = await fetch('/api/scan-document', {
        method: 'POST',
        headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          documentType: 'menu',
          preferredEngine: 2,
          file: filePayload,
        }),
      });
      const ocrPayload = await ocrResponse.json().catch(() => ({}));

      if (!ocrResponse.ok || ocrPayload.ok === false || ocrPayload.success === false) {
        if (!shouldTryGeminiVisionFallback(ocrResponse)) {
          throw new Error(getManagerApiErrorMessage(ocrPayload, 'OCR could not read this menu file.'));
        }

        setMessage('OCR could not read this file. Asking Gemini to inspect the original file...');
        await requestGeminiMenuParse('', file.name, {
          name: filePayload.name,
          mimeType: filePayload.mimeType,
          base64: filePayload.data,
        });
        setMessage('Gemini read the original menu file. Review the dishes and ingredients before saving.');
        return;
      }

      const ocrText = String(ocrPayload?.ocr?.rawText || '').trim();

      if (ocrText) {
        setRawText(ocrText);
        await requestGeminiMenuParse(ocrText, file.name);
      } else {
        setSourceName(file.name);
        refreshReview(normalizeDishesFromPayload(ocrPayload));
      }
    } catch (error) {
      setMessage(`${error?.message || 'Menu OCR failed.'} Try pasting the menu text instead.`);
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const updateDish = (dishId, updates) => {
    setReviewDishes((dishes) => dishes.map((dish) => (
      dish.reviewId === dishId ? { ...dish, ...updates } : dish
    )));
  };

  const updateIngredient = (dishId, ingredientId, updates) => {
    setReviewDishes((dishes) => dishes.map((dish) => {
      if (dish.reviewId !== dishId) {
        return dish;
      }

      return {
        ...dish,
        ingredients: dish.ingredients.map((ingredient) => {
          if (ingredient.reviewId !== ingredientId) {
            return ingredient;
          }

          const nextIngredient = {
            ...ingredient,
            ...updates,
            unit: updates.unit ? normalizeItemPriceUnit(updates.unit) : ingredient.unit,
          };
          const record = nextIngredient.catalogKey
            ? findItemPriceRecord(safeCatalog, nextIngredient.catalogKey)
            : findItemPriceRecord(safeCatalog, nextIngredient.name);
          const costIngredient = {
            ingredientId: record?.ingredientId || record?.key || '',
            priceCatalogKey: record?.key || '',
            name: nextIngredient.name,
            quantity: formatIngredientQuantity(nextIngredient.quantity, nextIngredient.unit),
            quantityValue: Number(nextIngredient.quantity) || null,
            unit: nextIngredient.unit,
            category: record?.category || dish.category,
          };
          const cost = calculateRecipeIngredientCost({ ingredient: costIngredient, itemPriceCatalog: safeCatalog });
          const unitMismatch = catalogUnitMismatch(nextIngredient.unit, record);

          return {
            ...nextIngredient,
            ingredientId: record?.ingredientId || record?.key || '',
            matchedName: record?.name || '',
            unitMismatch,
            cost: cost.cost,
            costSource: cost.source,
            costPerBaseUnit: cost.costPerBaseUnit ?? null,
            baseUnit: cost.baseUnit || record?.baseUnit || '',
            warnings: [
              ...(!record && !nextIngredient.createNewCatalogItem ? ['No catalog match yet.'] : []),
              ...(unitMismatch ? [`Unit review needed: recipe uses ${nextIngredient.unit}, catalog is ${record.baseUnit || record.unit}.`] : []),
            ],
          };
        }),
      };
    }));
  };

  const createCatalogItemForIngredient = async (dish, ingredient) => {
    const result = await onCreateCatalogItem?.({
      name: ingredient.name,
      category: dish.category || 'Other',
      price: 0,
      unit: ingredient.unit || 'each',
      baseUnit: ingredient.unit || 'each',
      source: 'menu-import-review',
    });

    if (!result?.ok) {
      setMessage(result?.message || `Could not create catalog item for ${ingredient.name}.`);
      return;
    }

    setReviewDishes((dishes) => dishes.map((currentDish) => (
      currentDish.reviewId !== dish.reviewId
        ? currentDish
        : {
          ...currentDish,
          ingredients: currentDish.ingredients.map((currentIngredient) => (
            currentIngredient.reviewId !== ingredient.reviewId
              ? currentIngredient
              : {
                ...currentIngredient,
                catalogKey: result.record.key,
                ingredientId: result.record.ingredientId || result.record.key,
                matchedName: result.record.name,
                createNewCatalogItem: false,
                unitMismatch: catalogUnitMismatch(currentIngredient.unit, result.record),
                warnings: [],
                cost: 0,
                costSource: 'catalog',
                costPerBaseUnit: result.record.costPerBaseUnit ?? null,
                baseUnit: result.record.baseUnit || '',
              }
          )),
        }
    )));
    setMessage(`${ingredient.name} added to the ingredient catalog. Add its real price later.`);
  };

  const confirmImport = async () => {
    if (!canManageMenu) {
      setMessage(`${operatorName} cannot save menu recipes. Use a manager account.`);
      return;
    }

    const unresolvedIngredients = reviewDishes.flatMap((dish) => (
      dish.rejected
        ? []
        : dish.ingredients.filter((ingredient) => !ingredient.catalogKey && !ingredient.createNewCatalogItem)
    ));

    if (unresolvedIngredients.length > 0) {
      setMessage('Link each ingredient to a catalog item, or use Create catalog item before confirming.');
      return;
    }

    setIsSaving(true);
    setMessage('Saving reviewed recipes...');

    try {
      const items = buildMenuImportSaveItems(reviewDishes, safeCatalog);
      const historyRecord = createImportHistoryRecord({
        importType: inputMode === 'file' ? 'menu-recipe-ocr-gemini' : 'menu-recipe-gemini',
        sourceName,
        importedBy: activeStaffMember?.name || 'Manager',
        reviewedItems: reviewDishes.map((dish) => ({
          ...dish,
          approved: !dish.rejected,
          warnings: dish.warnings || [],
        })),
        warnings: reviewDishes.flatMap((dish) => [
          ...(dish.warnings || []),
          ...dish.ingredients.flatMap((ingredient) => ingredient.warnings || []),
        ]),
      });
      const result = await onSaveApprovedItems?.({ items, historyRecord });

      if (!result?.ok) {
        throw new Error(result?.message || 'Could not save reviewed recipes.');
      }

      setReviewDishes([]);
      setRawText('');
      setMessage(result.message || `${items.length} recipe${items.length === 1 ? '' : 's'} saved.`);
    } catch (error) {
      setMessage(error?.message || 'Could not save reviewed recipes.');
    } finally {
      setIsSaving(false);
    }
  };

  const addSmartRecipes = async () => {
    if (!canManageMenu) {
      setMessage(`${operatorName} cannot save menu recipes. Use a manager account.`);
      return;
    }

    if (smartImportPlan.readyDishes.length === 0) {
      setMessage('There are no confidently matched recipes to add yet. Review the remaining dishes below.');
      return;
    }

    if (smartImportPlan.unmatchedIngredients.length > 0 && !onCreateCatalogItems) {
      setMessage('Smart ingredient creation is not available yet. Review the unmatched ingredients before saving.');
      return;
    }

    setIsSaving(true);
    setMessage('Adding ready recipes and linking ingredients...');

    try {
      let nextCatalog = safeCatalog;

      if (smartImportPlan.unmatchedIngredients.length > 0) {
        const catalogResult = await onCreateCatalogItems(smartImportPlan.unmatchedIngredients);
        if (!catalogResult?.ok) {
          throw new Error(catalogResult?.message || 'Could not add the new ingredients to the catalog.');
        }

        nextCatalog = sanitizeItemPriceCatalog({
          ...safeCatalog,
          ...(catalogResult.records || {}).reduce((records, record) => ({
            ...records,
            [record.key]: record,
          }), {}),
        });
      }

      const linkedDishes = smartImportPlan.readyDishes.map((dish) => ({
        ...dish,
        ingredients: dish.ingredients.map((ingredient) => {
          const record = findItemPriceRecord(nextCatalog, ingredient.catalogKey || ingredient.name);
          if (!record) {
            throw new Error(`Could not link ${ingredient.name} to the ingredient catalog.`);
          }

          const costIngredient = {
            ingredientId: record.ingredientId || record.key,
            priceCatalogKey: record.key,
            name: ingredient.name,
            quantity: formatIngredientQuantity(ingredient.quantity, ingredient.unit),
            quantityValue: Number(ingredient.quantity) || 1,
            unit: ingredient.unit,
            category: record.category || dish.category,
          };
          const cost = calculateRecipeIngredientCost({ ingredient: costIngredient, itemPriceCatalog: nextCatalog });

          return {
            ...ingredient,
            catalogKey: record.key,
            ingredientId: record.ingredientId || record.key,
            matchedName: record.name,
            createNewCatalogItem: false,
            unitMismatch: false,
            warnings: [],
            cost: cost.cost,
            costSource: cost.source,
            costPerBaseUnit: cost.costPerBaseUnit ?? null,
            baseUnit: cost.baseUnit || record.baseUnit || '',
          };
        }),
      }));
      const items = buildMenuImportSaveItems(linkedDishes, nextCatalog);
      const historyRecord = createImportHistoryRecord({
        importType: inputMode === 'file' ? 'menu-recipe-ocr-gemini' : 'menu-recipe-gemini',
        sourceName,
        importedBy: activeStaffMember?.name || 'Manager',
        reviewedItems: linkedDishes.map((dish) => ({ ...dish, approved: true })),
        warnings: [],
      });
      const result = await onSaveApprovedItems?.({ items, historyRecord });

      if (!result?.ok) {
        throw new Error(result?.message || 'Could not add the ready recipes.');
      }

      setReviewDishes(smartImportPlan.reviewOnlyDishes);
      if (smartImportPlan.reviewOnlyDishes.length === 0) {
        setRawText('');
      }

      const ingredientMessage = smartImportPlan.unmatchedIngredients.length > 0
        ? ` ${smartImportPlan.unmatchedIngredients.length} new ingredient${smartImportPlan.unmatchedIngredients.length === 1 ? '' : 's'} added without a price.`
        : '';
      const reviewMessage = smartImportPlan.reviewOnlyDishes.length > 0
        ? ` ${smartImportPlan.reviewOnlyDishes.length} dish${smartImportPlan.reviewOnlyDishes.length === 1 ? '' : 'es'} still need review.`
        : '';
      setMessage(`${items.length} recipe${items.length === 1 ? '' : 's'} added.${ingredientMessage}${reviewMessage}`);
    } catch (error) {
      setMessage(error?.message || 'Could not add the ready recipes.');
    } finally {
      setIsSaving(false);
    }
  };

  const saveableCount = reviewDishes.filter((dish) => !dish.rejected && dish.name && dish.ingredients.length > 0).length;

  return (
    <section className={compact ? 'smart-panel menu-import-panel' : 'panel menu-import-panel'}>
      <div className={compact ? '' : 'panel-body'}>
        <div className="section-header">
          <div>
            <p className="eyebrow">Menu import</p>
            <h2 className="title">Import Recipes With Gemini</h2>
            <p className="subtitle">WasteShift links safe matches automatically and holds only uncertain dishes for review.</p>
          </div>
          <span className="badge">{saveableCount} ready</span>
        </div>

        <div className="segmented-control" aria-label="Menu import input mode">
          <button type="button" className={`segment-button${inputMode === 'text' ? ' is-active' : ''}`} onClick={() => setInputMode('text')}>
            Paste text
          </button>
          <button type="button" className={`segment-button${inputMode === 'file' ? ' is-active' : ''}`} onClick={() => setInputMode('file')}>
            Upload photo/PDF
          </button>
        </div>

        {inputMode === 'text' ? (
          <div className="field">
            <label htmlFor="menu-import-recipe-text">Menu text</label>
            <textarea
              id="menu-import-recipe-text"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="Paste menu text with dish names and ingredient descriptions."
              className="input note-textarea"
              rows={compact ? 4 : 7}
            />
            <button type="button" className="primary-button" onClick={extractFromText} disabled={isExtracting || isSaving || !canUseAiImports}>
              {isExtracting ? 'Extracting...' : 'Extract recipes'}
            </button>
          </div>
        ) : (
          <div className="notice-panel">
            <div>
              <h3 className="breakdown-title">Upload menu scan</h3>
              <p className="small-text">PDF, JPG, PNG, or WebP. OCR reads the file first, then Gemini structures dishes and ingredients.</p>
            </div>
            <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()} disabled={isExtracting || isSaving || !canUseAiImports}>
              {isExtracting ? 'Reading...' : 'Choose file'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  setInputMode('file');
                  extractFromFile(file);
                }
              }}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {!canUseAiImports && (
          <div className="notice-panel notice-panel--warning">
            This account does not have manager access for Gemini/OCR menu import.
          </div>
        )}

        {reviewDishes.length > 0 && (
          <div className="notice-panel">
            <div className="section-header">
              <div>
                <h3 className="breakdown-title">Smart import</h3>
                <p className="small-text">
                  {smartImportPlan.readyDishes.length} ready to add. {smartImportPlan.unmatchedIngredients.length} new ingredient{smartImportPlan.unmatchedIngredients.length === 1 ? '' : 's'} will be added without a price until an invoice updates it.
                </p>
              </div>
              {smartImportPlan.reviewOnlyDishes.length > 0 && <span className="badge">{smartImportPlan.reviewOnlyDishes.length} to review</span>}
            </div>
            <button type="button" className="primary-button" onClick={addSmartRecipes} disabled={isSaving || !canManageMenu || smartImportPlan.readyDishes.length === 0}>
              {isSaving ? 'Adding recipes...' : `Add ${smartImportPlan.readyDishes.length} ready recipe${smartImportPlan.readyDishes.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

        {reviewDishes.length > 0 && (
          <details className="notice-panel" open={smartImportPlan.reviewOnlyDishes.length > 0}>
            <summary className="breakdown-title">Review and edit imported dishes</summary>
            <div className="ingredient-list" style={{ marginTop: 14 }}>
            {reviewDishes.map((dish) => (
              <div key={dish.reviewId} className={`inventory-card${dish.rejected ? ' is-muted' : ''}`}>
                <div className="field-grid">
                  <input className="input" value={dish.name} onChange={(event) => updateDish(dish.reviewId, { name: event.target.value })} aria-label="Dish name" />
                  <input className="input" value={dish.category} onChange={(event) => updateDish(dish.reviewId, { category: event.target.value })} aria-label="Dish category" />
                  <input className="input" type="number" min="0" step="0.01" value={dish.sellingPrice ?? ''} onChange={(event) => updateDish(dish.reviewId, { sellingPrice: event.target.value })} placeholder="Selling price optional" aria-label="Selling price" />
                </div>
                <textarea className="input note-textarea" value={dish.instructions} onChange={(event) => updateDish(dish.reviewId, { instructions: event.target.value })} placeholder="Optional instructions" />

                <div className="ingredient-list">
                  {dish.ingredients.map((ingredient) => (
                    <div key={ingredient.reviewId} className="ingredient-card">
                      <div className="recipe-ingredient-grid">
                        <input className="input" value={ingredient.name} onChange={(event) => updateIngredient(dish.reviewId, ingredient.reviewId, { name: event.target.value, catalogKey: '' })} aria-label="Ingredient name" />
                        <input className="input" type="number" min="0" step="0.001" value={ingredient.quantity} onChange={(event) => updateIngredient(dish.reviewId, ingredient.reviewId, { quantity: Number(event.target.value) || 1 })} aria-label="Ingredient quantity" />
                        <input className="input" value={ingredient.unit} onChange={(event) => updateIngredient(dish.reviewId, ingredient.reviewId, { unit: event.target.value })} aria-label="Ingredient unit" />
                        <select className="select" value={ingredient.catalogKey || ''} onChange={(event) => updateIngredient(dish.reviewId, ingredient.reviewId, { catalogKey: event.target.value, createNewCatalogItem: false })} aria-label="Linked catalog item">
                          <option value="">No match</option>
                          {catalogOptions.map((record) => (
                            <option key={record.key} value={record.key}>{record.name} ({record.baseUnit || record.unit})</option>
                          ))}
                        </select>
                      </div>
                      <div className="manager-row" style={{ marginTop: 8 }}>
                        {ingredient.catalogKey ? <span className="badge is-green">Linked: {ingredient.matchedName || ingredient.catalogKey}</span> : <span className="badge is-red">Unmatched</span>}
                        <span className="badge">Cost R{Number(ingredient.cost || 0).toFixed(2)}</span>
                        {ingredient.unitMismatch && <span className="badge is-red">Unit review</span>}
                        {!ingredient.catalogKey && (
                          <button type="button" className="ghost-button compact-action" onClick={() => createCatalogItemForIngredient(dish, ingredient)} disabled={!canManageMenu}>
                            Create catalog item
                          </button>
                        )}
                      </div>
                      {ingredient.warnings?.length > 0 && (
                        <div className="notice-list">
                          {ingredient.warnings.map((warning) => <span key={warning} className="badge is-red">{warning}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="manager-row">
                  <span className={dish.confidence >= 0.8 ? 'badge is-green' : 'badge'}>{Math.round(dish.confidence * 100)}% confidence</span>
                  {dish.warnings.map((warning) => <span key={warning} className="badge">{warning}</span>)}
                  <button type="button" className={dish.rejected ? 'ghost-button' : 'danger-button compact-action'} onClick={() => updateDish(dish.reviewId, { rejected: !dish.rejected })}>
                    {dish.rejected ? 'Restore dish' : 'Skip dish'}
                  </button>
                </div>
              </div>
            ))}
            </div>
          </details>
        )}

        {reviewDishes.length > 0 && (
          <button type="button" className="ghost-button" onClick={confirmImport} disabled={isSaving || !canManageMenu || saveableCount === 0}>
            {isSaving ? 'Saving recipes...' : 'Confirm reviewed recipes'}
          </button>
        )}

        {message && (
          <div className="empty-state" style={{ marginTop: 14, padding: 14 }} role="status">
            {message}
          </div>
        )}
      </div>
    </section>
  );
}

export default MenuImport;
