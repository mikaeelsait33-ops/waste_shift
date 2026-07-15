import { useMemo, useState } from 'react';
import {
  WASTE_CATEGORY_OPTIONS,
  buildRecipeIngredientBreakdown,
  getRecipeIngredientTotal,
} from '../utils/wasteCalculations';
import {
  calculateRecipeIngredientCost,
  findItemPriceRecord,
  normalizeRecipeIngredient,
  sanitizeItemPriceCatalog,
} from '../utils/itemPriceCatalog';
import MenuImport from './MenuImport';

const createBlankIngredient = () => ({
  ingredientId: '',
  name: '',
  quantity: '',
  cost: '',
  category: 'Produce',
});

const MENU_CATEGORY_OPTIONS = [
  'Breakfast',
  'Lunch',
  'Dinner',
  'Drinks',
  'Bakery',
  'Dessert',
  'Specials',
  'Other',
];

const createRecipeKey = (name) => String(name || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' ')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const parsePriceValue = (value) => {
  const cleanedValue = String(value ?? '').replace(/[^0-9.-]/g, '');
  const parsedValue = Number.parseFloat(cleanedValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const formatInputPrice = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? String(parsedValue) : '';
};

const normalizeMenuCategory = (category) => {
  const trimmedCategory = String(category || '').trim();
  return trimmedCategory || 'Other';
};

const parseBulkMenuLine = (line) => {
  const trimmedLine = String(line || '').trim();

  if (!trimmedLine) {
    return null;
  }

  const parts = (trimmedLine.includes(',') ? trimmedLine.split(',') : trimmedLine.split(/\s+-\s+/))
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return {
      name: parts[0],
      price: parsePriceValue(parts[1]),
      category: normalizeMenuCategory(parts.slice(2).join(' - ')),
    };
  }

  const priceMatch = trimmedLine.match(/^(.+?)\s+R?([0-9]+(?:\.[0-9]{1,2})?)\s*$/i);

  if (!priceMatch) {
    return { name: trimmedLine, price: null, category: 'Other' };
  }

  return {
    name: priceMatch[1].trim(),
    price: parsePriceValue(priceMatch[2]),
    category: 'Other',
  };
};

const getIngredientTotal = (ingredients, itemPriceCatalog) => (
  getRecipeIngredientTotal(ingredients, itemPriceCatalog)
);

function RecipeManager({
  recipes,
  menuItems,
  customMenuItems,
  itemPriceCatalog,
  accessProfile,
  onAddRecipe,
  onClearRecipes,
  onSaveMenuItem,
  onRemoveCustomMenuItem,
  onRestoreMenuItem,
  onImportMenuItems,
  onCreateCatalogItem,
  onCreateCatalogItems,
  activeStaffMember,
}) {
  const [recipeName, setRecipeName] = useState('');
  const [recipePrice, setRecipePrice] = useState('');
  const [recipeCategory, setRecipeCategory] = useState('Other');
  const [recipeSearch, setRecipeSearch] = useState('');
  const [archiveFilter, setArchiveFilter] = useState('active');
  const [editingKey, setEditingKey] = useState('');
  const [message, setMessage] = useState('');
  const [ingredients, setIngredients] = useState([createBlankIngredient()]);
  const [ingredientsOpen, setIngredientsOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkMenuText, setBulkMenuText] = useState('');
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);
  const safeItemPriceCatalog = useMemo(() => sanitizeItemPriceCatalog(itemPriceCatalog), [itemPriceCatalog]);
  const ingredientPriceOptions = useMemo(() => (
    Object.values(safeItemPriceCatalog)
      .filter((record) => record?.key && record?.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  ), [safeItemPriceCatalog]);
  const draftIngredientTotal = getIngredientTotal(ingredients, safeItemPriceCatalog);
  const draftMenuPrice = parsePriceValue(recipePrice);
  const draftMargin = draftMenuPrice !== null ? draftMenuPrice - draftIngredientTotal : null;
  const touchedIngredientCount = ingredients.filter((ingredient) => (
    ingredient.ingredientId
    || ingredient.name.trim()
    || ingredient.quantity.trim()
    || String(ingredient.cost ?? '').trim()
  )).length;
  const incompleteIngredientCount = ingredients.filter((ingredient) => (
    (ingredient.quantity.trim() || String(ingredient.cost ?? '').trim()) && !ingredient.name.trim()
  )).length;

  const safeRecipes = useMemo(() => (
    recipes && typeof recipes === 'object' ? recipes : {}
  ), [recipes]);
  const safeMenuItems = useMemo(() => (
    Array.isArray(menuItems) ? menuItems : []
  ), [menuItems]);
  const customKeys = useMemo(() => new Set(
    Array.isArray(customMenuItems) ? customMenuItems.map((item) => item.key) : []
  ), [customMenuItems]);
  const catalogEntries = useMemo(() => {
    const entriesByKey = new Map();

    safeMenuItems.forEach((item) => {
      entriesByKey.set(item.key, {
        key: item.key,
        name: item.name,
        menuPrice: item.menuPrice,
        category: item.category || safeRecipes[item.key]?.category || 'Other',
        recipe: safeRecipes[item.key],
        isMenuItem: true,
        archived: Boolean(item.archived || safeRecipes[item.key]?.archived),
        archivedAt: item.archivedAt || safeRecipes[item.key]?.archivedAt || '',
        archivedBy: item.archivedBy || safeRecipes[item.key]?.archivedBy || '',
      });
    });

    Object.entries(safeRecipes).forEach(([key, recipe]) => {
      const existingEntry = entriesByKey.get(key);

      if (existingEntry) {
        entriesByKey.set(key, {
          ...existingEntry,
          recipe,
          archived: Boolean(existingEntry.archived || recipe?.archived),
          archivedAt: existingEntry.archivedAt || recipe?.archivedAt || '',
          archivedBy: existingEntry.archivedBy || recipe?.archivedBy || '',
        });
        return;
      }

      entriesByKey.set(key, {
        key,
        name: recipe?.name || key,
        menuPrice: recipe?.menuPrice ?? null,
        category: recipe?.category || 'Other',
        recipe,
        isMenuItem: false,
        archived: Boolean(recipe?.archived),
        archivedAt: recipe?.archivedAt || '',
        archivedBy: recipe?.archivedBy || '',
      });
    });

    return [...entriesByKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [safeMenuItems, safeRecipes]);

  const recipeSearchValue = recipeSearch.trim().toLowerCase();
  const filteredCatalogEntries = catalogEntries.filter((entry) => {
    if (archiveFilter === 'active' && entry.archived) return false;
    if (archiveFilter === 'archived' && !entry.archived) return false;
    if (!recipeSearchValue) return true;

    const safeIngredients = Array.isArray(entry.recipe?.ingredients) ? entry.recipe.ingredients : [];

    return [
      entry.name,
      entry.key,
      ...safeIngredients.map((ingredient) => ingredient.name),
      ...safeIngredients.map((ingredient) => ingredient.quantity),
      ...safeIngredients.map((ingredient) => ingredient.category),
    ].some((part) => String(part || '').toLowerCase().includes(recipeSearchValue));
  });
  const archivedCount = catalogEntries.filter((entry) => entry.archived).length;

  const resetRecipeForm = () => {
    setEditingKey('');
    setRecipeName('');
    setRecipePrice('');
    setRecipeCategory('Other');
    setIngredients([createBlankIngredient()]);
    setIngredientsOpen(false);
    setMessage('');
  };

  const handleIngredientChange = (index, field, value) => {
    setIngredients((currentIngredients) => (
      currentIngredients.map((ingredient, ingredientIndex) => (
        ingredientIndex === index ? { ...ingredient, [field]: value } : ingredient
      ))
    ));
  };

  const addIngredientRow = () => {
    setIngredients((currentIngredients) => [...currentIngredients, createBlankIngredient()]);
  };

  const removeIngredientRow = (index) => {
    setIngredients((currentIngredients) => (
      currentIngredients.filter((_, ingredientIndex) => ingredientIndex !== index)
    ));
  };

  const compactIngredientRows = () => {
    setIngredients((currentIngredients) => {
      const compactedIngredients = currentIngredients.filter((ingredient) => (
        ingredient.ingredientId
        || ingredient.name.trim()
        || ingredient.quantity.trim()
        || String(ingredient.cost ?? '').trim()
      ));

      return compactedIngredients.length > 0 ? compactedIngredients : [createBlankIngredient()];
    });
  };

  const handleEditItem = (item) => {
    const currentMenuPrice = item.menuPrice ?? item.recipe?.menuPrice;
    const editableIngredients = Array.isArray(item.recipe?.ingredients) && item.recipe.ingredients.length > 0
      ? item.recipe.ingredients.map((ingredient) => ({
        ingredientId: ingredient?.ingredientId || ingredient?.priceCatalogKey || '',
        name: ingredient?.name || '',
        quantity: ingredient?.quantity || '',
        cost: formatInputPrice(ingredient?.cost),
        category: ingredient?.category || 'Produce',
      }))
      : [createBlankIngredient()];

    setEditingKey(item.key);
    setRecipeName(item.name || item.recipe?.name || '');
    setRecipePrice(formatInputPrice(currentMenuPrice));
    setRecipeCategory(normalizeMenuCategory(item.category || item.recipe?.category));
    setIngredients(editableIngredients);
    setIngredientsOpen(true);
    setMessage(`Editing ${item.name || 'menu item'}.`);
  };

  const handleDuplicateItem = (item) => {
    const currentMenuPrice = item.menuPrice ?? item.recipe?.menuPrice;
    const copiedIngredients = Array.isArray(item.recipe?.ingredients) && item.recipe.ingredients.length > 0
      ? item.recipe.ingredients.map((ingredient) => ({
        ingredientId: ingredient?.ingredientId || ingredient?.priceCatalogKey || '',
        name: ingredient?.name || '',
        quantity: ingredient?.quantity || '',
        cost: formatInputPrice(ingredient?.cost),
        category: ingredient?.category || 'Produce',
      }))
      : [createBlankIngredient()];

    setEditingKey('');
    setRecipeName(`${item.name || item.recipe?.name || 'Menu item'} Copy`);
    setRecipePrice(formatInputPrice(currentMenuPrice));
    setRecipeCategory(normalizeMenuCategory(item.category || item.recipe?.category));
    setIngredients(copiedIngredients);
    setIngredientsOpen(copiedIngredients.some((ingredient) => ingredient.name || ingredient.ingredientId));
    setMessage(`Duplicating ${item.name || 'menu item'}.`);
  };

  const handleBulkAdd = () => {
    if (!accessProfile?.canManageMenu) {
      setMessage('Manager authorization is required to add menu items.');
      return;
    }

    const parsedRows = bulkMenuText
      .split(/\r?\n/)
      .map(parseBulkMenuLine)
      .filter(Boolean);

    if (parsedRows.length === 0) {
      setMessage('Paste at least one menu item line.');
      return;
    }

    const existingKeys = new Set(catalogEntries.map((item) => item.key));
    const nextKeys = new Set();
    const invalidRows = [];
    const duplicateRows = [];
    const saveableRows = [];

    parsedRows.forEach((row) => {
      const key = createRecipeKey(row.name);

      if (!row.name || !key || row.price === null) {
        invalidRows.push(row.name || 'Untitled row');
        return;
      }

      if (existingKeys.has(key) || nextKeys.has(key)) {
        duplicateRows.push(row.name);
        return;
      }

      nextKeys.add(key);
      saveableRows.push({
        key,
        name: row.name,
        price: row.price,
        category: row.category,
      });
    });

    saveableRows.forEach((row) => {
      onSaveMenuItem?.(row);
    });

    const statusParts = [];

    if (saveableRows.length > 0) {
      statusParts.push(`${saveableRows.length} menu item${saveableRows.length === 1 ? '' : 's'} added.`);
    }

    if (invalidRows.length > 0) {
      statusParts.push(`${invalidRows.length} line${invalidRows.length === 1 ? '' : 's'} need a name and price.`);
    }

    if (duplicateRows.length > 0) {
      statusParts.push(`${duplicateRows.length} duplicate${duplicateRows.length === 1 ? '' : 's'} skipped.`);
    }

    if (saveableRows.length > 0) {
      setBulkMenuText('');
      setBulkAddOpen(false);
    }

    setMessage(statusParts.join(' '));
  };

  const handleSubmitRecipe = async (e) => {
    e.preventDefault();

    if (isSavingRecipe) {
      return;
    }

    const trimmedRecipeName = recipeName.trim();
    if (!trimmedRecipeName) {
      setMessage('Enter the menu item name.');
      return;
    }

    const touchedIngredients = ingredients.filter((ingredient) => (
      ingredient.ingredientId
      || ingredient.name.trim()
      || ingredient.quantity.trim()
      || String(ingredient.cost ?? '').trim()
    )).map((ingredient) => {
      const linkedRecord = ingredient.ingredientId ? safeItemPriceCatalog[ingredient.ingredientId] : null;

      return {
        ...ingredient,
        name: ingredient.name.trim() || linkedRecord?.name || '',
      };
    });

    if (touchedIngredients.some((ingredient) => !ingredient.name.trim())) {
      setMessage('Enter a name for each ingredient row you want to keep.');
      return;
    }

    const recipeKey = editingKey || createRecipeKey(trimmedRecipeName);

    if (!recipeKey) {
      setMessage('Enter a valid menu item name.');
      return;
    }

    const duplicateIngredientNames = new Set();
    const hasDuplicateIngredients = touchedIngredients.some((ingredient) => {
      const ingredientName = String(ingredient.ingredientId || ingredient.name).trim().toLowerCase();

      if (duplicateIngredientNames.has(ingredientName)) {
        return true;
      }

      duplicateIngredientNames.add(ingredientName);
      return false;
    });

    if (hasDuplicateIngredients) {
      setMessage('Merge duplicate ingredient rows before saving.');
      return;
    }

    const menuPrice = parsePriceValue(recipePrice);
    const formattedIngredients = touchedIngredients.map((ingredient) => normalizeRecipeIngredient({
      ...ingredient,
      ingredientId: ingredient.ingredientId,
      priceCatalogKey: ingredient.ingredientId || ingredient.priceCatalogKey,
      cost: parsePriceValue(ingredient.cost) || 0,
    }, ingredient.category || 'Produce'));

    setIsSavingRecipe(true);
    setMessage('Saving menu item and make-line guide...');

    try {
      let saveResult;

      if (formattedIngredients.length > 0 || safeRecipes[recipeKey]) {
        saveResult = await onAddRecipe?.(recipeKey, {
          name: trimmedRecipeName,
          category: normalizeMenuCategory(recipeCategory),
          ...(menuPrice !== null ? { menuPrice } : {}),
          ingredients: formattedIngredients,
        });
      } else {
        saveResult = await onSaveMenuItem?.({
          key: recipeKey,
          name: trimmedRecipeName,
          price: recipePrice,
          category: normalizeMenuCategory(recipeCategory),
        });
      }

      if (saveResult?.ok === false) {
        setMessage(saveResult.message || 'Could not save this menu item.');
        return;
      }

      setMessage(saveResult?.message || (editingKey ? 'Menu item updated.' : 'Menu item saved.'));
      setEditingKey('');
      setRecipeName('');
      setRecipePrice('');
      setRecipeCategory('Other');
      setIngredients([createBlankIngredient()]);
      setIngredientsOpen(false);
    } catch (error) {
      setMessage(error?.message || 'Could not save this menu item. Try again.');
    } finally {
      setIsSavingRecipe(false);
    }
  };

  return (
    <section className="inventory-section">
      <MenuImport
        existingMenuItems={safeMenuItems}
        itemPriceCatalog={safeItemPriceCatalog}
        accessProfile={accessProfile}
        activeStaffMember={activeStaffMember}
        onSaveApprovedItems={onImportMenuItems}
        onCreateCatalogItem={onCreateCatalogItem}
        onCreateCatalogItems={onCreateCatalogItems}
      />

      <form onSubmit={handleSubmitRecipe} className="panel">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Menu setup</p>
              <h2 className="title">{editingKey ? 'Edit Menu Item' : 'Menu Item Creator'}</h2>
              <p className="subtitle">Save the dish and make-line guide together for accurate costing and raw waste logging.</p>
            </div>
            {editingKey && (
              <button type="button" onClick={resetRecipeForm} className="ghost-button">
                Cancel
              </button>
            )}
          </div>

          <div className="field-grid field-grid--three">
            <div className="field">
              <label htmlFor="recipe-name">Menu item name</label>
              <input
                id="recipe-name"
                type="text"
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                placeholder="e.g. Chicken schnitzel strips"
                className="input"
              />
            </div>

            <div className="field">
              <label htmlFor="recipe-price">Menu price</label>
              <input
                id="recipe-price"
                type="number"
                min="0"
                step="0.01"
                value={recipePrice}
                onChange={(e) => setRecipePrice(e.target.value)}
                placeholder="R"
                className="input"
              />
            </div>

            <div className="field">
              <label htmlFor="recipe-category">Category</label>
              <select
                id="recipe-category"
                value={recipeCategory}
                onChange={(event) => setRecipeCategory(event.target.value)}
                className="select"
              >
                {MENU_CATEGORY_OPTIONS.map((categoryOption) => (
                  <option key={categoryOption} value={categoryOption}>
                    {categoryOption}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="suggestion-row" style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setIngredientsOpen((currentValue) => !currentValue)}
              className="suggestion-button"
            >
              <span>{ingredientsOpen ? 'Hide make-line guide' : 'Add make-line guide'}</span>
              <strong>{touchedIngredientCount}</strong>
            </button>
            <button
              type="button"
              onClick={() => setBulkAddOpen((currentValue) => !currentValue)}
              className="suggestion-button"
            >
              <span>{bulkAddOpen ? 'Close bulk add' : 'Bulk add'}</span>
              <strong>+</strong>
            </button>
          </div>

          {bulkAddOpen && (
            <div className="smart-panel">
              <div className="smart-panel__header">
                <span className="breakdown-title">Bulk add menu items</span>
                <span className="badge">Name, price, category</span>
              </div>
              <textarea
                value={bulkMenuText}
                onChange={(event) => setBulkMenuText(event.target.value)}
                className="input bulk-menu-textarea"
                rows={4}
                placeholder="Burger, 95, Lunch"
              />
              <button type="button" onClick={handleBulkAdd} className="primary-button" style={{ marginTop: 10 }}>
                Add pasted items
              </button>
            </div>
          )}

          {ingredientsOpen && (
            <>
              <div className="smart-panel">
                <div className="smart-panel__header">
                  <span className="breakdown-title">Menu item preview</span>
                  <span className="badge">{touchedIngredientCount} ingredient row{touchedIngredientCount !== 1 ? 's' : ''}</span>
                </div>
                <div className="import-summary-grid">
                  <span className="badge">Ingredients R{draftIngredientTotal.toFixed(2)}</span>
                  <span className={draftMenuPrice !== null ? 'badge is-green' : 'badge'}>{draftMenuPrice !== null ? `Price R${draftMenuPrice.toFixed(2)}` : 'No price'}</span>
                  <span className={draftMargin !== null && draftMargin < 0 ? 'badge is-red' : 'badge'}>
                    {draftMargin !== null ? `Gap R${draftMargin.toFixed(2)}` : 'Gap pending'}
                  </span>
                  {incompleteIngredientCount > 0 && <span className="badge is-red">{incompleteIngredientCount} incomplete</span>}
                </div>
                <div className="suggestion-row">
                  <button
                    type="button"
                    onClick={() => setRecipePrice(draftIngredientTotal.toFixed(2))}
                    className="suggestion-button"
                    disabled={draftIngredientTotal <= 0}
                  >
                    <span>Use ingredient total</span>
                    <strong>R{draftIngredientTotal.toFixed(2)}</strong>
                  </button>
                  <button type="button" onClick={compactIngredientRows} className="suggestion-button">
                    <span>Clean rows</span>
                    <strong>{Math.max(0, ingredients.length - touchedIngredientCount)}</strong>
                  </button>
                </div>
              </div>

              <h3 className="breakdown-title">Make-line ingredients</h3>
              <div className="ingredient-list">
                {ingredients.length === 0 ? (
                  <div className="muted-box">
                    <p className="small-text" style={{ margin: 0 }}>No ingredients added. This item will be saved as price-only.</p>
                  </div>
                ) : (
                  ingredients.map((ingredient, index) => {
                    const catalogPrice = findItemPriceRecord(safeItemPriceCatalog, ingredient.ingredientId) || findItemPriceRecord(safeItemPriceCatalog, ingredient.name);
                    const resolvedCost = calculateRecipeIngredientCost({ ingredient, itemPriceCatalog: safeItemPriceCatalog });

                    return (
                      <div key={`${index}-${ingredient.name}`} className="ingredient-card">
                        <div className="recipe-ingredient-grid">
                          <input
                            type="text"
                            placeholder="Ingredient name"
                            value={ingredient.name}
                            onChange={(e) => handleIngredientChange(index, 'name', e.target.value)}
                            className="input"
                            aria-label="Ingredient name"
                          />
                          <select
                            value={ingredient.ingredientId || ''}
                            onChange={(e) => {
                              const nextIngredientId = e.target.value;
                              const selectedRecord = safeItemPriceCatalog[nextIngredientId];

                              handleIngredientChange(index, 'ingredientId', nextIngredientId);
                              if (selectedRecord && !ingredient.name.trim()) {
                                handleIngredientChange(index, 'name', selectedRecord.name);
                              }
                            }}
                            className="select"
                            aria-label="Linked raw ingredient"
                          >
                            <option value="">Link ingredient</option>
                            {ingredientPriceOptions.map((record) => (
                              <option key={record.key} value={record.key}>
                                {record.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            placeholder="e.g. 10g, 50ml, 1 each"
                            value={ingredient.quantity}
                            onChange={(e) => handleIngredientChange(index, 'quantity', e.target.value)}
                            className="input"
                            aria-label="Ingredient quantity"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Fallback cost (R)"
                            value={ingredient.cost}
                            onChange={(e) => handleIngredientChange(index, 'cost', e.target.value)}
                            className="input"
                            aria-label="Ingredient cost"
                          />
                          <select
                            value={ingredient.category}
                            onChange={(e) => handleIngredientChange(index, 'category', e.target.value)}
                            className="select"
                            aria-label="Ingredient category"
                          >
                            {WASTE_CATEGORY_OPTIONS.map((categoryOption) => (
                              <option key={categoryOption.value} value={categoryOption.value}>
                                {categoryOption.label}
                              </option>
                            ))}
                          </select>
                          <button type="button" onClick={() => removeIngredientRow(index)} className="delete-button" title="Remove ingredient">
                            x
                          </button>
                        </div>
                        {(catalogPrice || resolvedCost.cost > 0) && (
                          <div className="small-text ingredient-cost-note">
                            {resolvedCost.source === 'catalog'
                              ? `Auto cost R${resolvedCost.cost.toFixed(2)} from R${Number(catalogPrice.costPerBaseUnit || catalogPrice.price).toFixed(4)} / ${catalogPrice.baseUnit || catalogPrice.unit}.`
                              : `Using fallback ingredient cost R${resolvedCost.cost.toFixed(2)}.`}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <button type="button" onClick={addIngredientRow} className="ghost-button" style={{ width: '100%', margin: '14px 0' }}>
                Add make-line ingredient
              </button>
            </>
          )}

          <button type="submit" className="primary-button" disabled={isSavingRecipe} aria-busy={isSavingRecipe}>
            {isSavingRecipe ? 'Saving...' : editingKey ? 'Save changes' : 'Save menu item'}
          </button>

          {message && (
            <div className="empty-state" style={{ marginTop: '14px', padding: '14px' }}>
              {message}
            </div>
          )}
        </div>
      </form>

      <div className="panel">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Menu catalog</p>
              <h2 className="title">Menu Items & Recipes</h2>
              <p className="subtitle">Menu pricing and ingredient breakdowns used when logging waste.</p>
            </div>
            <div className="manager-row">
              <span className="badge">{filteredCatalogEntries.length} shown</span>
              {archivedCount > 0 && <span className="badge">{archivedCount} archived</span>}
              {catalogEntries.length > 0 && (
                <button type="button" onClick={onClearRecipes} className="danger-button">
                  Wipe menu
                </button>
              )}
            </div>
          </div>

          {catalogEntries.length > 0 && (
            <div className="toolbar">
              <input
                type="search"
                value={recipeSearch}
                onChange={(e) => setRecipeSearch(e.target.value)}
                placeholder="Search menu items or ingredients"
                className="input"
              />
              <select value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value)} className="select">
                <option value="active">Active menu</option>
                <option value="archived">Archived menu</option>
                <option value="all">Active + archived</option>
              </select>
            </div>
          )}

          {recipeSearchValue && (
            <div className="search-status" role="status">
              <span>
                <strong>{filteredCatalogEntries.length}</strong> menu item{filteredCatalogEntries.length === 1 ? '' : 's'} for <strong>{recipeSearch.trim()}</strong>
              </span>
              <button type="button" onClick={() => setRecipeSearch('')} className="ghost-button compact-action">
                Clear search
              </button>
            </div>
          )}

          {catalogEntries.length === 0 ? (
            <div className="empty-state">Your menu catalog is empty. Create a custom item above.</div>
          ) : filteredCatalogEntries.length === 0 ? (
            <div className="empty-state">No menu items match "{recipeSearch.trim()}".</div>
          ) : (
            filteredCatalogEntries.map((item) => {
              const safeIngredients = Array.isArray(item.recipe?.ingredients) ? item.recipe.ingredients : [];
              const explicitPrice = item.menuPrice ?? item.recipe?.menuPrice;
              const hasExplicitPrice = explicitPrice !== null && explicitPrice !== undefined;
              const pricedIngredients = buildRecipeIngredientBreakdown({ ingredients: safeIngredients }, 1, safeItemPriceCatalog);
              const ingredientTotal = getIngredientTotal(safeIngredients, safeItemPriceCatalog);
              const recipeTotal = hasExplicitPrice ? Number(explicitPrice) : ingredientTotal;
              const hasDisplayPrice = hasExplicitPrice || ingredientTotal > 0;
              const hasLocalChange = customKeys.has(item.key);
              const priceGap = hasExplicitPrice ? Number(explicitPrice) - ingredientTotal : null;

              return (
                <div key={item.key} className="inventory-card">
                  <div className="inventory-heading">
                    <div>
                      <h3 className="inventory-title">{item.name}</h3>
                      <span className="small-text">
                        {safeIngredients.length > 0
                          ? `${safeIngredients.length} ingredient${safeIngredients.length !== 1 ? 's' : ''} - R${ingredientTotal.toFixed(2)} ingredient cost`
                          : 'No ingredient breakdown linked'}
                      </span>
                    </div>
                    <div className="manager-row">
                      {item.archived && <span className="badge is-red">Archived</span>}
                      {hasLocalChange && <span className="badge is-green">App saved</span>}
                      {priceGap !== null && safeIngredients.length > 0 && (
                        <span className={priceGap < 0 ? 'badge is-red' : 'badge'}>
                          Gap R{priceGap.toFixed(2)}
                        </span>
                      )}
                      <span className={hasDisplayPrice ? 'price is-total' : 'badge'}>
                        {hasDisplayPrice ? `R${recipeTotal.toFixed(2)}` : 'No price'}
                      </span>
                      <button type="button" onClick={() => handleEditItem(item)} className="ghost-button is-warning">
                        Edit
                      </button>
                      <button type="button" onClick={() => handleDuplicateItem(item)} className="ghost-button compact-action">
                        Duplicate
                      </button>
                      {item.archived ? (
                        <button type="button" onClick={() => onRestoreMenuItem?.(item.key)} className="ghost-button compact-action">
                          Restore
                        </button>
                      ) : (
                        <button type="button" onClick={() => onRemoveCustomMenuItem?.(item.key)} className="danger-button compact-action">
                          Archive
                        </button>
                      )}
                    </div>
                  </div>

                  {safeIngredients.length > 0 && (
                    <div className="ingredient-list">
                      {pricedIngredients.map((ingredient, index) => (
                        <div key={`${ingredient.name}-${index}`} className="ingredient-card item-row">
                          <span className="small-text">
                            {ingredient.name}
                            {ingredient.quantity && <span className="badge">{ingredient.quantity}</span>}
                            <span className="badge">{ingredient.category}</span>
                            {ingredient.costSource === 'catalog' && (
                              <span className="badge is-green">
                                R{Number(ingredient.costPerBaseUnit || ingredient.pricePerUnit || 0).toFixed(4)} / {ingredient.baseUnit || ingredient.priceUnit}
                              </span>
                            )}
                          </span>
                          <span className="price">R{(Number(ingredient.cost) || 0).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

export default RecipeManager;
