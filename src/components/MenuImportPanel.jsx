import { useMemo, useRef, useState } from 'react';
import {
  MENU_IMPORT_HIGH_CONFIDENCE,
  createImportHistoryRecord,
  normalizeImportedMenuItems,
  parseMenuCsvText,
  parseMenuPlainText,
  parseMenuPrice,
} from '../utils/menuImport';
import { getAutomaticManagerApiHeaders, getManagerApiErrorMessage } from '../utils/apiHeaders';

const readFileAsText = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not read this menu file.'));
  reader.readAsText(file);
});

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
    base64,
  };
};

const shouldTryGeminiVisionFallback = (response) => (
  response?.status === 422 || Number(response?.status) >= 500
);

function MenuImportPanel({
  existingMenuItems = [],
  accessProfile,
  activeStaffMember,
  onSaveApprovedItems,
  compact = false,
}) {
  const fileInputRef = useRef(null);
  const [sourceText, setSourceText] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [importType, setImportType] = useState('text');
  const [reviewItems, setReviewItems] = useState([]);
  const [message, setMessage] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const hasAccessProfile = Boolean(accessProfile);
  const canUseAiImports = !hasAccessProfile || Boolean(accessProfile?.canUseAiImports);
  const canSaveImportedItems = !hasAccessProfile || Boolean(accessProfile?.canManageMenu);
  const operatorLabel = accessProfile?.operatorName || activeStaffMember?.name || 'Current operator';

  const approvedItems = useMemo(() => (
    reviewItems.filter((item) => item.approved && !item.rejected && item.name.trim() && item.warnings.length === 0)
  ), [reviewItems]);

  const loadReviewItems = (items, nextImportType, nextSourceName) => {
    const normalizedItems = normalizeImportedMenuItems(items, existingMenuItems);

    setReviewItems(normalizedItems);
    setImportType(nextImportType);
    setSourceName(nextSourceName);
    setMessage(normalizedItems.length > 0
      ? `${normalizedItems.length} menu item${normalizedItems.length === 1 ? '' : 's'} ready for review.`
      : 'No usable menu items were found.');
  };

  const extractFromText = () => {
    const text = sourceText.trim();

    if (!text) {
      setMessage('Paste menu text or upload a file first.');
      return;
    }

    const looksLikeCsv = text.includes(',') && /\b(name|item|price|category)\b/i.test(text.split(/\r?\n/)[0] || '');
    const parsedItems = looksLikeCsv ? parseMenuCsvText(text) : parseMenuPlainText(text);
    loadReviewItems(parsedItems, looksLikeCsv ? 'csv' : 'text', sourceName || 'Pasted menu');
  };

  const extractWithGemini = async (file = null) => {
    if (!canUseAiImports) {
      setMessage(`${operatorLabel} is not allowed to use Gemini menu import. Use a manager login, or paste text/CSV for review.`);
      return;
    }

    if (!file && !sourceText.trim()) {
      setMessage('Paste menu text or upload a menu PDF/image before using Gemini.');
      return;
    }

    setIsExtracting(true);
    setMessage(file ? 'Running OCR.space and cleaning menu text with Gemini...' : 'Extracting menu items with Gemini...');

    try {
      const filePayload = file ? await createFilePayload(file) : null;
      let response = await fetch(file ? '/api/scan-document' : '/api/gemini-menu', {
        method: 'POST',
        headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(file
          ? {
              documentType: 'menu',
              preferredEngine: 2,
              file: {
                name: filePayload.name,
                mimeType: filePayload.mimeType,
                data: filePayload.base64,
              },
            }
          : {
              text: sourceText,
              file: null,
            }),
      });
      let payload = await response.json().catch(() => ({}));
      let usedGeminiVisionFallback = false;

      if (!response.ok || payload.ok === false || payload.success === false) {
        if (file && shouldTryGeminiVisionFallback(response)) {
          setMessage('OCR could not read this file. Asking Gemini to inspect the original file...');
          response = await fetch('/api/gemini-menu', {
            method: 'POST',
            headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
            body: JSON.stringify({
              text: '',
              file: {
                name: filePayload.name,
                mimeType: filePayload.mimeType,
                base64: filePayload.base64,
              },
            }),
          });
          payload = await response.json().catch(() => ({}));
          usedGeminiVisionFallback = true;
        }

        if (!response.ok || payload.ok === false || payload.success === false) {
          if (file && payload?.ocr?.rawText) {
            setSourceText(payload.ocr.rawText);
          }
          const protectedApiMessage = getManagerApiErrorMessage(payload, 'Menu import failed.');
          throw new Error(protectedApiMessage);
        }

        if (file && payload?.ocr?.rawText) {
          setSourceText(payload.ocr.rawText);
        }
      }

      const extractedMenuItems = file
        ? (usedGeminiVisionFallback ? (payload.items || []) : (payload.extracted?.menuItems || []).map((item) => ({
            name: item.name,
            category: item.category || '',
            sellingPrice: item.sellingPrice,
            description: [
              item.description || '',
              (item.possibleIngredients || []).length > 0
                ? `Suggested ingredients for review: ${(item.possibleIngredients || []).map((ingredient) => ingredient.ingredientName).join(', ')}`
                : '',
            ].filter(Boolean).join(' '),
            components: [],
            confidence: item.confidence,
            warnings: [],
            source: 'ocr-gemini',
          })))
        : (payload.items || []);

      loadReviewItems(
        extractedMenuItems,
        file ? (usedGeminiVisionFallback ? 'gemini-file' : 'ocr-gemini-menu') : 'gemini-text',
        file?.name || sourceName || 'Menu import'
      );
    } catch (error) {
      setMessage(`${error?.message || 'Scanner is unavailable.'} You can still use manual text or CSV import.`);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setSourceName(file.name);

    try {
      if (file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')) {
        const text = await readFileAsText(file);
        setSourceText(text);
        loadReviewItems(parseMenuCsvText(text), 'csv', file.name);
        return;
      }

      if (file.type.startsWith('text/')) {
        const text = await readFileAsText(file);
        setSourceText(text);
        loadReviewItems(parseMenuPlainText(text), 'text', file.name);
        return;
      }

      await extractWithGemini(file);
    } catch (error) {
      setMessage(error?.message || 'Could not import this menu file.');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const updateReviewItem = (reviewId, updates) => {
    setReviewItems((items) => normalizeImportedMenuItems(
      items.map((item) => (
        item.reviewId === reviewId
          ? {
            ...item,
            ...updates,
            sellingPrice: updates.sellingPrice !== undefined
              ? parseMenuPrice(updates.sellingPrice)
              : item.sellingPrice,
          }
          : item
      )),
      existingMenuItems
    ));
  };

  const approveHighConfidence = () => {
    setReviewItems((items) => items.map((item) => ({
      ...item,
      approved: item.confidence >= MENU_IMPORT_HIGH_CONFIDENCE && item.warnings.length === 0,
      rejected: item.confidence >= MENU_IMPORT_HIGH_CONFIDENCE && item.warnings.length === 0 ? false : item.rejected,
    })));
  };

  const saveApprovedItems = async () => {
    if (!canSaveImportedItems) {
      setMessage(`${operatorLabel} is not allowed to save menu imports. Use a manager account.`);
      return;
    }

    if (approvedItems.length === 0) {
      setMessage('Approve at least one valid menu item before saving.');
      return;
    }

    setIsSaving(true);
    setMessage('Saving approved menu items...');

    try {
      const historyRecord = createImportHistoryRecord({
        importType,
        sourceName,
        importedBy: activeStaffMember?.name || 'Setup manager',
        reviewedItems: reviewItems,
        warnings: reviewItems.flatMap((item) => item.warnings),
      });
      const result = await onSaveApprovedItems?.({
        items: approvedItems,
        historyRecord,
      });

      if (!result?.ok) {
        throw new Error(result?.message || 'Could not save approved menu items.');
      }

      setMessage(result.message || `${approvedItems.length} approved menu item${approvedItems.length === 1 ? '' : 's'} saved.`);
      setReviewItems([]);
      setSourceText('');
      setSourceName('');
    } catch (error) {
      setMessage(error?.message || 'Could not save approved menu items.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={compact ? 'smart-panel' : 'panel'}>
      <div className={compact ? '' : 'panel-body'}>
        <div className="section-header">
          <div>
            <p className="eyebrow">Menu import</p>
            <h2 className="title">Import With Review</h2>
            <p className="subtitle">Paste text, upload CSV, or use Gemini for PDF/image menus. Nothing saves until you approve it.</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="menu-import-text">Menu text</label>
          <textarea
            id="menu-import-text"
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="Paste menu rows, for example: Breakfast: Salmon Benedict R85"
            className="input"
            rows={compact ? 4 : 6}
          />
        </div>

        <div className="manager-row" style={{ marginBottom: 14 }}>
          <button type="button" className="primary-button" onClick={extractFromText} disabled={isExtracting || isSaving}>
            Review text/CSV
          </button>
          <button type="button" className="ghost-button" onClick={() => extractWithGemini()} disabled={isExtracting || isSaving}>
            {isExtracting ? 'Extracting...' : 'Use Gemini'}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              if (!canUseAiImports) {
                setMessage(`${operatorLabel} is not allowed to upload menu files for Gemini/OCR. Use a manager login.`);
                return;
              }
              fileInputRef.current?.click();
            }}
            disabled={isExtracting || isSaving || !canUseAiImports}
          >
            Upload file
          </button>
          <input
            ref={fileInputRef}
            id="menu-import-file"
            type="file"
            accept=".csv,text/csv,text/plain,application/pdf,image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            disabled={!canUseAiImports}
            style={{ display: 'none' }}
          />
        </div>

        {!canUseAiImports && (
          <div className="notice-panel notice-panel--warning">
            <p className="small-text" style={{ margin: 0 }}>
              Manager access is required for Gemini/OCR menu imports. Text review is still available.
            </p>
          </div>
        )}

        {reviewItems.length > 0 && (
          <div className="smart-panel">
            <div className="smart-panel__header">
              <span className="breakdown-title">Review extracted items</span>
              <span className="badge">{approvedItems.length} approved</span>
            </div>
            <div className="manager-row" style={{ marginBottom: 12 }}>
              <button type="button" className="ghost-button" onClick={approveHighConfidence}>
                Approve high confidence
              </button>
              <button type="button" className="primary-button" onClick={saveApprovedItems} disabled={isSaving || approvedItems.length === 0 || !canSaveImportedItems}>
                {isSaving ? 'Saving...' : canSaveImportedItems ? 'Save approved' : 'Manager only'}
              </button>
            </div>

            <div className="ingredient-list">
              {reviewItems.map((item) => (
                <div key={item.reviewId} className={`ingredient-card${item.rejected ? ' is-muted' : ''}`}>
                  <div className="recipe-ingredient-grid">
                    <input
                      className="input"
                      value={item.name}
                      onChange={(event) => updateReviewItem(item.reviewId, { name: event.target.value })}
                      aria-label="Imported menu item name"
                    />
                    <input
                      className="input"
                      value={item.category}
                      onChange={(event) => updateReviewItem(item.reviewId, { category: event.target.value })}
                      placeholder="Category"
                      aria-label="Imported category"
                    />
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.sellingPrice ?? ''}
                      onChange={(event) => updateReviewItem(item.reviewId, { sellingPrice: event.target.value })}
                      placeholder="Price"
                      aria-label="Imported price"
                    />
                    <button
                      type="button"
                      className={item.approved ? 'primary-button' : 'ghost-button'}
                      onClick={() => updateReviewItem(item.reviewId, { approved: !item.approved, rejected: false })}
                      disabled={item.warnings.length > 0}
                    >
                      {item.approved ? 'Approved' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="delete-button"
                      onClick={() => updateReviewItem(item.reviewId, { rejected: !item.rejected, approved: false })}
                      title="Reject item"
                    >
                      x
                    </button>
                  </div>
                  <div className="import-summary-grid" style={{ marginTop: 10 }}>
                    <span className={item.confidence >= MENU_IMPORT_HIGH_CONFIDENCE ? 'badge is-green' : 'badge'}>
                      {Math.round(item.confidence * 100)}% confidence
                    </span>
                    {item.description && <span className="badge">{item.description}</span>}
                    {item.portion && <span className="badge">{item.portion}</span>}
                    {item.components.length > 0 && <span className="badge">{item.components.length} components</span>}
                    {item.warnings.map((warning) => (
                      <span key={warning} className="badge is-red">{warning}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {message && (
          <div className="empty-state" style={{ marginTop: 14, padding: 14 }} role="status">
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

export default MenuImportPanel;
