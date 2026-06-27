import { useEffect, useMemo, useState } from 'react';

const splitCostAcrossIngredients = (totalCost, ingredients) => {
  const safeIngredients = Array.isArray(ingredients) ? ingredients : [];

  if (safeIngredients.length === 0 || totalCost <= 0) {
    return safeIngredients.map((ingredient) => ({
      ...ingredient,
      cost: 0,
    }));
  }

  const totalCents = Math.round(totalCost * 100);
  const baseCents = Math.floor(totalCents / safeIngredients.length);
  const remainderCents = totalCents - (baseCents * safeIngredients.length);

  return safeIngredients.map((ingredient, index) => ({
    ...ingredient,
    cost: (baseCents + (index < remainderCents ? 1 : 0)) / 100,
  }));
};

const WASTE_UNITS = [
  { value: 'g', label: 'grams (g)' },
  { value: 'kg', label: 'kilograms (kg)' },
  { value: 'ml', label: 'millilitres (ml)' },
  { value: 'l', label: 'litres (L)' },
  { value: 'portion', label: 'portions' },
];

const PORTION_SIZE_UNITS = WASTE_UNITS.filter((unitOption) => unitOption.value !== 'portion');

const CATEGORY_OPTIONS = [
  { value: 'Produce', label: 'Produce' },
  { value: 'Dairy', label: 'Dairy & Eggs' },
  { value: 'Bakery', label: 'Bakery & Grains' },
  { value: 'Meat/Poultry', label: 'Meat & Poultry' },
  { value: 'Pantry', label: 'Pantry Goods' },
];

const REASON_OPTIONS = [
  'Passed Expiration Date',
  'Spoiled/Overripe',
  'Kitchen Prep Mistake',
  'Other',
];

const COMMON_REASON_BY_CATEGORY = {
  Produce: 'Spoiled/Overripe',
  Dairy: 'Passed Expiration Date',
  Bakery: 'Passed Expiration Date',
  'Meat/Poultry': 'Passed Expiration Date',
  Pantry: 'Passed Expiration Date',
};

const createWasteItemKey = (itemName) => String(itemName || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' ')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const formatNumber = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '';
  }

  return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

function WasteForm({
  onAddEntry,
  wasteItems,
  recipes,
  menuItems,
  staffList,
  portionProfiles,
  onSavePortionProfile,
}) {
  const [formType, setFormType] = useState('single');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('g');
  const [portionAmount, setPortionAmount] = useState('');
  const [portionUnit, setPortionUnit] = useState('g');
  const [category, setCategory] = useState('Produce');
  const [reason, setReason] = useState('Passed Expiration Date');
  const [customReason, setCustomReason] = useState('');
  const [staff, setStaff] = useState('');
  const [cost, setCost] = useState('');
  const [formMessage, setFormMessage] = useState('');

  const getTodayYMD = () => new Date().toISOString().split('T')[0];
  const [wasteDate, setWasteDate] = useState(getTodayYMD());

  const safeStaffList = Array.isArray(staffList) ? staffList : [];
  const safeWasteItems = useMemo(() => (Array.isArray(wasteItems) ? wasteItems : []), [wasteItems]);
  const safeMenuItems = useMemo(() => (Array.isArray(menuItems) ? menuItems : []), [menuItems]);
  const safePortionProfiles = portionProfiles && typeof portionProfiles === 'object' ? portionProfiles : {};
  const [selectedRecipeKey, setSelectedRecipeKey] = useState(safeMenuItems[0]?.key || '');
  const selectedMenuItem = safeMenuItems.find((item) => item.key === selectedRecipeKey);
  const selectedRecipe = recipes[selectedRecipeKey];
  const selectedRecipeTotal = Array.isArray(selectedRecipe?.ingredients)
    ? selectedRecipe.ingredients.reduce((sum, ing) => sum + (Number(ing.cost) || 0), 0)
    : 0;
  const selectedMenuItemCost = Number(selectedMenuItem?.menuPrice ?? selectedRecipeTotal) || 0;
  const activeWasteItem = formType === 'recipe'
    ? {
      key: selectedRecipeKey,
      name: selectedMenuItem?.name || recipes[selectedRecipeKey]?.name || '',
    }
    : {
      key: createWasteItemKey(name),
      name: name.trim(),
    };
  const activePortionProfile = formType === 'single' && activeWasteItem.key ? safePortionProfiles[activeWasteItem.key] : null;
  const quantityValue = parseFloat(quantity);
  const portionAmountValue = parseFloat(portionAmount);
  const measuredAmount = formType === 'single'
    && unit === 'portion'
    && Number.isFinite(quantityValue)
    && Number.isFinite(portionAmountValue)
    && quantityValue > 0
    && portionAmountValue > 0
      ? quantityValue * portionAmountValue
      : null;
  const recentSingleItemProfiles = useMemo(() => {
    const seenNames = new Set();

    return [...safeWasteItems]
      .reverse()
      .filter((item) => !item?.isRecipe && item?.name)
      .filter((item) => {
        const key = String(item.name).trim().toLowerCase();

        if (!key || seenNames.has(key)) {
          return false;
        }

        seenNames.add(key);
        return true;
      })
      .slice(0, 18);
  }, [safeWasteItems]);
  const itemNameOptions = recentSingleItemProfiles.map((item) => item.name);
  const normalizedName = name.trim().toLowerCase();
  const matchingProfiles = normalizedName
    ? recentSingleItemProfiles
      .filter((item) => String(item.name || '').toLowerCase().includes(normalizedName))
      .slice(0, 3)
    : recentSingleItemProfiles.slice(0, 3);
  const exactProfile = normalizedName
    ? recentSingleItemProfiles.find((item) => String(item.name || '').toLowerCase() === normalizedName)
    : null;
  const suggestedReason = exactProfile?.reason || COMMON_REASON_BY_CATEGORY[category] || 'Passed Expiration Date';
  const previewCost = formType === 'recipe'
    ? selectedMenuItemCost * (Number.isFinite(quantityValue) ? quantityValue : 0)
    : parseFloat(cost);
  const previewCostLabel = Number.isFinite(previewCost) ? `R${previewCost.toFixed(2)}` : 'Cost pending';
  const previewQuantityLabel = formType === 'recipe'
    ? `${formatNumber(quantityValue) || '0'} finished menu item${Number(quantityValue) === 1 ? '' : 's'}`
    : unit === 'portion'
    ? measuredAmount
      ? `${formatNumber(quantityValue)} portions = ${formatNumber(measuredAmount)} ${portionUnit}`
      : 'Portion size pending'
    : `${formatNumber(quantityValue) || '0'} ${unit}`;

  const applyProfile = (profile) => {
    if (!profile) return;

    setName(profile.name || '');
    setCategory(profile.category || 'Produce');
    setQuantity(String(profile.quantity || '1'));
    setUnit(profile.unit || 'g');
    setCost(Number(profile.cost) > 0 ? Number(profile.cost).toFixed(2) : '');

    if (profile.unit === 'portion') {
      setPortionAmount(profile.portionSize ? String(profile.portionSize) : '');
      setPortionUnit(profile.portionSizeUnit || 'g');
    }

    if (REASON_OPTIONS.includes(profile.reason)) {
      setReason(profile.reason);
      setCustomReason('');
    } else if (profile.reason) {
      setReason('Other');
      setCustomReason(profile.reason);
    }

    setFormMessage(`Loaded recent values for ${profile.name}.`);
  };

  useEffect(() => {
    const selectedMenuItemExists = safeMenuItems.some((item) => item.key === selectedRecipeKey);

    if (safeMenuItems.length > 0 && (!selectedRecipeKey || !selectedMenuItemExists)) {
      setSelectedRecipeKey(safeMenuItems[0].key);
    }
  }, [safeMenuItems, selectedRecipeKey]);

  useEffect(() => {
    if (formType !== 'single' || unit !== 'portion') {
      return;
    }

    if (activePortionProfile) {
      setPortionAmount(String(activePortionProfile.amount));
      setPortionUnit(activePortionProfile.unit);
      return;
    }

    setPortionAmount('');
    setPortionUnit('g');
  }, [formType, unit, activeWasteItem.key, activePortionProfile]);

  useEffect(() => {
    if (formType !== 'recipe') {
      return;
    }

    const recipe = recipes[selectedRecipeKey];
    const menuItem = safeMenuItems.find((item) => item.key === selectedRecipeKey);
    const recipeTotal = Array.isArray(recipe?.ingredients)
      ? recipe.ingredients.reduce((sum, ing) => sum + (Number(ing.cost) || 0), 0)
      : 0;
    const singleItemCost = Number(menuItem?.menuPrice ?? recipeTotal) || 0;
    const qtyMultiplier = parseFloat(quantity) || 1;

    setCost((singleItemCost * qtyMultiplier).toFixed(2));
  }, [formType, selectedRecipeKey, quantity, recipes, safeMenuItems]);

  const handleFormTypeChange = (nextFormType) => {
    setFormType(nextFormType);
    setUnit(nextFormType === 'recipe' ? 'portion' : 'g');
    setQuantity('1');
    setPortionAmount('');
    setPortionUnit('g');
    setFormMessage('');

    if (nextFormType === 'single') {
      setCost('');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (formType === 'single' && !name.trim()) {
      setFormMessage('Enter the food item name before saving.');
      return;
    }

    if (formType === 'single' && cost === '') {
      setFormMessage('Enter the cost loss for this item.');
      return;
    }

    if (formType === 'recipe' && !selectedRecipeKey) {
      setFormMessage('Choose a menu item before saving.');
      return;
    }

    const qtyMultiplier = parseFloat(quantity);
    if (!Number.isFinite(qtyMultiplier) || qtyMultiplier <= 0) {
      setFormMessage('Enter a quantity greater than zero.');
      return;
    }

    let measuredQuantity = qtyMultiplier;
    let measuredUnit = unit;
    let portionSize = null;
    let portionSizeUnit = '';

    if (formType === 'recipe') {
      measuredQuantity = qtyMultiplier;
      measuredUnit = 'portion';
    } else if (unit === 'portion') {
      if (!activeWasteItem.key || !activeWasteItem.name) {
        setFormMessage('Choose or enter the wasted item before saving a portion size.');
        return;
      }

      if (!Number.isFinite(portionAmountValue) || portionAmountValue <= 0) {
        setFormMessage('Enter what one portion equals.');
        return;
      }

      portionSize = portionAmountValue;
      portionSizeUnit = portionUnit;
      measuredQuantity = qtyMultiplier * portionAmountValue;
      measuredUnit = portionUnit;
    }

    if (!staff) {
      setFormMessage('Select the responsible staff member.');
      return;
    }

    const actualReason = reason === 'Other' ? customReason.trim() : reason;
    if (reason === 'Other' && !actualReason) {
      setFormMessage('Provide a custom reason.');
      return;
    }

    const [y, m, d] = wasteDate.split('-');
    const formattedDate = `${d}/${m}/${y}`;

    let finalEntry = {
      id: Date.now().toString(),
      reason: actualReason,
      staff,
      date: formattedDate,
    };

    if (formType === 'single') {
      finalEntry = {
        ...finalEntry,
        name,
        quantity,
        unit,
        measuredQuantity,
        measuredUnit,
        portionSize,
        portionSizeUnit,
        category,
        cost: parseFloat(cost) || 0,
        isRecipe: false,
        ingredients: [],
      };
    } else {
      const activeRecipe = recipes[selectedRecipeKey];
      const activeMenuItem = safeMenuItems.find((item) => item.key === selectedRecipeKey);
      const recipeTotal = Array.isArray(activeRecipe?.ingredients)
        ? activeRecipe.ingredients.reduce((sum, ing) => sum + (Number(ing.cost) || 0), 0)
        : 0;
      const menuItemCost = Number(activeMenuItem?.menuPrice ?? recipeTotal) || 0;
      const finalCost = menuItemCost * qtyMultiplier;
      const targetCost = finalCost;
      const parsedIngredients = Array.isArray(activeRecipe?.ingredients)
        ? recipeTotal > 0
          ? activeRecipe.ingredients.map((ing) => ({
            ...ing,
            cost: (Number(ing.cost) || 0) * (targetCost / recipeTotal),
          }))
          : splitCostAcrossIngredients(targetCost, activeRecipe.ingredients)
        : [];

      finalEntry = {
        ...finalEntry,
        name: activeMenuItem?.name || activeRecipe?.name || selectedRecipeKey,
        quantity,
        unit: 'portion',
        measuredQuantity,
        measuredUnit,
        portionSize,
        portionSizeUnit,
        category: activeRecipe ? 'Menu Recipe' : 'Menu Item',
        cost: finalCost,
        isRecipe: Boolean(activeRecipe),
        recipeKey: selectedRecipeKey,
        ingredients: parsedIngredients,
      };
    }

    onAddEntry(finalEntry);
    setFormMessage(`Logged ${finalEntry.name} for R${(Number(finalEntry.cost) || 0).toFixed(2)}.`);
    if (formType === 'single' && unit === 'portion') {
      onSavePortionProfile?.({
        key: activeWasteItem.key,
        name: activeWasteItem.name,
        amount: portionSize,
        unit: portionSizeUnit,
      });
    }
    setName('');
    setQuantity('1');
    setUnit(formType === 'recipe' ? 'portion' : 'g');
    if (formType === 'single') {
      setPortionAmount('');
      setPortionUnit('g');
    }
    setStaff('');
    setReason('Passed Expiration Date');
    setCustomReason('');
    setWasteDate(getTodayYMD());
    if (formType === 'single') setCost('');
  };

  return (
    <form onSubmit={handleSubmit} className="panel form-panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Waste entry</p>
            <h2 className="title">Log Wasted Food</h2>
            <p className="subtitle">Capture one ingredient or a full menu item.</p>
          </div>
        </div>

        <div className="segmented-control" aria-label="Waste entry type" style={{ marginBottom: '16px' }}>
          <button
            type="button"
            onClick={() => handleFormTypeChange('single')}
            className={`segment-button${formType === 'single' ? ' is-active' : ''}`}
          >
            Ingredient
          </button>
          <button
            type="button"
            onClick={() => handleFormTypeChange('recipe')}
            className={`segment-button${formType === 'recipe' ? ' is-active' : ''}`}
          >
            Menu item
          </button>
        </div>

        {formType === 'single' ? (
          <>
            <div className="field">
              <label htmlFor="food-name">Food item name</label>
              <input
                id="food-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cheddar block"
                list="known-waste-items"
                className="input"
              />
              {itemNameOptions.length > 0 && (
                <datalist id="known-waste-items">
                  {itemNameOptions.map((itemName) => (
                    <option key={itemName} value={itemName} />
                  ))}
                </datalist>
              )}
            </div>

            <div className="field">
              <label htmlFor="food-category">Category</label>
              <select id="food-category" value={category} onChange={(e) => setCategory(e.target.value)} className="select">
                {CATEGORY_OPTIONS.map((categoryOption) => (
                  <option key={categoryOption.value} value={categoryOption.value}>
                    {categoryOption.label}
                  </option>
                ))}
              </select>
            </div>

            {matchingProfiles.length > 0 && (
              <div className="smart-panel">
                <div className="smart-panel__header">
                  <span className="breakdown-title">Recent matches</span>
                  <span className="badge">{matchingProfiles.length}</span>
                </div>
                <div className="suggestion-row">
                  {matchingProfiles.map((profile) => (
                    <button
                      key={`${profile.id}-${profile.name}`}
                      type="button"
                      onClick={() => applyProfile(profile)}
                      className="suggestion-button"
                    >
                      <span>{profile.name}</span>
                      <strong>R{(Number(profile.cost) || 0).toFixed(2)}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="field">
            <label htmlFor="menu-item">Menu item</label>
            {safeMenuItems.length === 0 ? (
              <div className="muted-box">No menu items found.</div>
            ) : (
              <select id="menu-item" value={selectedRecipeKey} onChange={(e) => setSelectedRecipeKey(e.target.value)} className="select">
                {safeMenuItems.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.name}{item.menuPrice !== null ? ` - R${item.menuPrice.toFixed(2)}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {formType === 'recipe' && selectedRecipe && (
          <div className="smart-panel">
            <div className="smart-panel__header">
              <span className="breakdown-title">Recipe breakdown</span>
              <span className="badge">{Array.isArray(selectedRecipe.ingredients) ? selectedRecipe.ingredients.length : 0} ingredients</span>
            </div>
            {Array.isArray(selectedRecipe.ingredients) && selectedRecipe.ingredients.length > 0 ? (
              <div className="ingredient-list">
                {selectedRecipe.ingredients.slice(0, 5).map((ingredient, index) => (
                  <div key={`${ingredient.name}-${index}`} className="ingredient-card item-row">
                    <span className="small-text">
                      {ingredient.name}
                      {ingredient.quantity && <span className="badge">{ingredient.quantity}</span>}
                      <span className="badge">{ingredient.category || 'Other'}</span>
                    </span>
                    <span className="price">R{(Number(ingredient.cost) || 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted-box">
                <p className="small-text" style={{ margin: 0 }}>No ingredient breakdown linked.</p>
              </div>
            )}
          </div>
        )}

        <div className={`field-grid${formType === 'single' ? ' field-grid--three' : ''}`}>
          <div className="field">
            <label htmlFor="quantity">{formType === 'recipe' ? 'Menu items wasted' : 'Quantity'}</label>
            <input
              id="quantity"
              type="number"
              min="0.01"
              step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input"
            />
          </div>

          {formType === 'single' && (
            <div className="field">
              <label htmlFor="quantity-unit">Unit</label>
              <select id="quantity-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="select">
                {WASTE_UNITS.map((unitOption) => (
                  <option key={unitOption.value} value={unitOption.value}>
                    {unitOption.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="cost-loss">{formType === 'recipe' ? 'Calculated cost loss' : 'Cost loss'}</label>
            <input
              id="cost-loss"
              type="number"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              disabled={formType === 'recipe'}
              placeholder="R"
              className="input"
            />
          </div>
        </div>

        {formType === 'single' && unit === 'portion' && (
          <div className="budget-panel portion-panel">
            <h3 className="breakdown-title">Portion size</h3>
            <div className="field-grid">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="portion-amount">1 portion equals</label>
                <input
                  id="portion-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={portionAmount}
                  onChange={(e) => setPortionAmount(e.target.value)}
                  placeholder="150"
                  className="input"
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="portion-unit">Measured unit</label>
                <select id="portion-unit" value={portionUnit} onChange={(e) => setPortionUnit(e.target.value)} className="select">
                  {PORTION_SIZE_UNITS.map((unitOption) => (
                    <option key={unitOption.value} value={unitOption.value}>
                      {unitOption.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="budget-row" style={{ marginTop: '12px' }}>
              <span className="small-text">
                {activePortionProfile ? `Remembered for ${activePortionProfile.name}` : 'New portion size'}
              </span>
              <span className="badge is-green">
                {measuredAmount ? `${formatNumber(quantityValue)} portions = ${formatNumber(measuredAmount)} ${portionUnit}` : 'Enter size'}
              </span>
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="responsible-staff">Responsible staff member</label>

          {safeStaffList.length === 0 ? (
            <div className="muted-box">
              <p className="small-text" style={{ margin: 0 }}>Add staff members in Settings before logging waste.</p>
            </div>
          ) : (
            <select id="responsible-staff" value={staff} onChange={(e) => setStaff(e.target.value)} className="select">
              <option value="">Choose staff member</option>
              {safeStaffList.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name} - {member.role}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="field">
          <label htmlFor="waste-date">Date of waste</label>
          <input
            id="waste-date"
            type="date"
            value={wasteDate}
            onChange={(e) => setWasteDate(e.target.value)}
            max={getTodayYMD()}
            className="input"
          />
        </div>

        <div className="field">
          <label htmlFor="waste-reason">Reason for waste</label>
          <select id="waste-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="select">
            <option value="Passed Expiration Date">Passed expiration date</option>
            <option value="Spoiled/Overripe">Spoiled / overripe</option>
            <option value="Kitchen Prep Mistake">Kitchen prep mistake</option>
            <option value="Other">Other</option>
          </select>
          {suggestedReason && suggestedReason !== reason && (
            <button
              type="button"
              onClick={() => {
                setReason(suggestedReason);
                setCustomReason('');
              }}
              className="ghost-button compact-action"
            >
              Use {suggestedReason}
            </button>
          )}
          {reason === 'Other' && (
            <input
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Type the custom reason"
              className="input"
              style={{ marginTop: '10px' }}
            />
          )}
        </div>

        <div className="entry-preview">
          <div className="budget-row">
            <span className="small-text">{activeWasteItem.name || 'Entry preview'}</span>
            <span className={Number.isFinite(previewCost) ? 'price' : 'badge'}>
              {previewCostLabel}
            </span>
          </div>
          <div className="small-text">
            {previewQuantityLabel}
            {formType === 'recipe' && selectedMenuItemCost <= 0 ? ' - add a price or ingredient costs in Settings' : ''}
          </div>
        </div>

        <button type="submit" disabled={formType === 'recipe' && safeMenuItems.length === 0} className="primary-button">
          Log waste
        </button>

        {formMessage && (
          <div className="inline-message" role="status">
            {formMessage}
          </div>
        )}
      </div>
    </form>
  );
}

export default WasteForm;
