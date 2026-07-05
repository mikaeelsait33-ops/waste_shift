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
import MenuImportPanel from './MenuImportPanel';

const createBlankIngredient = () => ({
  name: '',
  quantity: '',
  cost: '',
  category: 'Produce',
});

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
  onImportMenuItems,
  activeStaffMember,
}) {
  const [recipeName, setRecipeName] = useState('');
  const [recipePrice, setRecipePrice] = useState('');
  const [recipeSearch, setRecipeSearch] = useState('');
  const [editingKey, setEditingKey] = useState('');
  const [message, setMessage] = useState('');
  const [ingredients, setIngredients] = useState([createBlankIngredient()]);
  const safeItemPriceCatalog = useMemo(() => sanitizeItemPriceCatalog(itemPriceCatalog), [itemPriceCatalog]);
  const draftIngredientTotal = getIngredientTotal(ingredients, safeItemPriceCatalog);
  const draftMenuPrice = parsePriceValue(recipePrice);
  const draftMargin = draftMenuPrice !== null ? draftMenuPrice - draftIngredientTotal : null;
  const touchedIngredientCount = ingredients.filter((ingredient) => (
    ingredient.name.trim()
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
        recipe: safeRecipes[item.key],
        isMenuItem: true,
      });
    });

    Object.entries(safeRecipes).forEach(([key, recipe]) => {
      const existingEntry = entriesByKey.get(key);

      if (existingEntry) {
        entriesByKey.set(key, { ...existingEntry, recipe });
        return;
      }

      entriesByKey.set(key, {
        key,
        name: recipe?.name || key,
        menuPrice: recipe?.menuPrice ?? null,
        recipe,
        isMenuItem: false,
      });
    });

    return [...entriesByKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [safeMenuItems, safeRecipes]);

  const recipeSearchValue = recipeSearch.trim().toLowerCase();
  const filteredCatalogEntries = catalogEntries.filter((entry) => {
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

  const resetRecipeForm = () => {
    setEditingKey('');
    setRecipeName('');
    setRecipePrice('');
    setIngredients([createBlankIngredient()]);
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
        ingredient.name.trim()
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
        name: ingredient?.name || '',
        quantity: ingredient?.quantity || '',
        cost: formatInputPrice(ingredient?.cost),
        category: ingredient?.category || 'Produce',
      }))
      : [createBlankIngredient()];

    setEditingKey(item.key);
    setRecipeName(item.name || item.recipe?.name || '');
    setRecipePrice(formatInputPrice(currentMenuPrice));
    setIngredients(editableIngredients);
    setMessage(`Editing ${item.name || 'menu item'}.`);
  };

  const handleSubmitRecipe = (e) => {
    e.preventDefault();

    const trimmedRecipeName = recipeName.trim();
    if (!trimmedRecipeName) {
      setMessage('Enter the menu item name.');
      return;
    }

    const touchedIngredients = ingredients.filter((ingredient) => (
      ingredient.name.trim()
      || ingredient.quantity.trim()
      || String(ingredient.cost ?? '').trim()
    ));

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
      const ingredientName = ingredient.name.trim().toLowerCase();

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
      cost: parsePriceValue(ingredient.cost) || 0,
    }, ingredient.category || 'Produce'));

    if (formattedIngredients.length > 0 || safeRecipes[recipeKey]) {
      onAddRecipe(recipeKey, {
        name: trimmedRecipeName,
        ...(menuPrice !== null ? { menuPrice } : {}),
        ingredients: formattedIngredients,
      });
    }

    onSaveMenuItem?.({
      key: recipeKey,
      name: trimmedRecipeName,
      price: recipePrice,
    });

    setMessage(editingKey ? 'Menu item updated.' : 'Menu item saved.');
    setEditingKey('');
    setRecipeName('');
    setRecipePrice('');
    setIngredients([createBlankIngredient()]);
  };

  return (
    <section className="inventory-section">
      <MenuImportPanel
        existingMenuItems={safeMenuItems}
        accessProfile={accessProfile}
        activeStaffMember={activeStaffMember}
        onSaveApprovedItems={onImportMenuItems}
      />

      <form onSubmit={handleSubmitRecipe} className="panel">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Menu setup</p>
              <h2 className="title">{editingKey ? 'Edit Menu Item' : 'Menu Item Creator'}</h2>
              <p className="subtitle">Set menu pricing and optional ingredient breakdowns in one place.</p>
            </div>
            {editingKey && (
              <button type="button" onClick={resetRecipeForm} className="ghost-button">
                Cancel
              </button>
            )}
          </div>

          <div className="field-grid">
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
          </div>

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

          <h3 className="breakdown-title">Ingredient breakdown</h3>
          <div className="ingredient-list">
            {ingredients.length === 0 ? (
              <div className="muted-box">
                <p className="small-text" style={{ margin: 0 }}>No ingredients added. This item will be saved as price-only.</p>
              </div>
            ) : (
              ingredients.map((ingredient, index) => {
                const catalogPrice = findItemPriceRecord(safeItemPriceCatalog, ingredient.name);
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
                      <input
                        type="text"
                        placeholder="Quantity"
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
            Add ingredient
          </button>

          <button type="submit" className="primary-button">
            {editingKey ? 'Save changes' : 'Save menu item'}
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
              {catalogEntries.length > 0 && (
                <button type="button" onClick={onClearRecipes} className="danger-button">
                  Wipe menu
                </button>
              )}
            </div>
          </div>

          {catalogEntries.length > 0 && (
            <div className="toolbar toolbar--single">
              <input
                type="search"
                value={recipeSearch}
                onChange={(e) => setRecipeSearch(e.target.value)}
                placeholder="Search menu items or ingredients"
                className="input"
              />
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
                      {hasLocalChange && (
                        <button type="button" onClick={() => onRemoveCustomMenuItem?.(item.key)} className="delete-button" title={`Remove app-saved price for ${item.name}`}>
                          x
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
