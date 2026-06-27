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

function WasteForm({ onAddEntry, recipes, menuItems, staffList, onAddStaff, onDeleteStaff }) {
  const [formType, setFormType] = useState('single');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [category, setCategory] = useState('Produce');
  const [reason, setReason] = useState('Passed Expiration Date');
  const [customReason, setCustomReason] = useState('');
  const [staff, setStaff] = useState('');
  const [cost, setCost] = useState('');
  const [showStaffManager, setShowStaffManager] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('');

  const getTodayYMD = () => new Date().toISOString().split('T')[0];
  const [wasteDate, setWasteDate] = useState(getTodayYMD());

  const safeStaffList = Array.isArray(staffList) ? staffList : [];
  const safeMenuItems = useMemo(() => (Array.isArray(menuItems) ? menuItems : []), [menuItems]);
  const [selectedRecipeKey, setSelectedRecipeKey] = useState(safeMenuItems[0]?.key || '');

  useEffect(() => {
    const selectedMenuItemExists = safeMenuItems.some((item) => item.key === selectedRecipeKey);

    if (safeMenuItems.length > 0 && (!selectedRecipeKey || !selectedMenuItemExists)) {
      setSelectedRecipeKey(safeMenuItems[0].key);
    }
  }, [safeMenuItems, selectedRecipeKey]);

  useEffect(() => {
    const recipe = recipes[selectedRecipeKey];
    const menuItem = safeMenuItems.find((item) => item.key === selectedRecipeKey);
    const recipeTotal = Array.isArray(recipe?.ingredients)
      ? recipe.ingredients.reduce((sum, ing) => sum + (Number(ing.cost) || 0), 0)
      : 0;
    const singleItemCost = Number(menuItem?.menuPrice ?? recipeTotal) || 0;

    if (formType === 'recipe') {
      const qtyMultiplier = parseFloat(quantity) || 1;
      setCost((singleItemCost * qtyMultiplier).toFixed(2));
    } else if (formType === 'single') {
      setCost('');
    }
  }, [formType, selectedRecipeKey, quantity, recipes, safeMenuItems]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (formType === 'single' && (!name || !cost)) return;
    if (formType === 'recipe' && !selectedRecipeKey) return;

    if (!staff) {
      alert('Please select the responsible staff member.');
      return;
    }

    const actualReason = reason === 'Other' ? customReason.trim() : reason;
    if (reason === 'Other' && !actualReason) {
      alert('Please provide a custom reason.');
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
        category,
        cost: parseFloat(cost) || 0,
        isRecipe: false,
        ingredients: [],
      };
    } else {
      const activeRecipe = recipes[selectedRecipeKey];
      const activeMenuItem = safeMenuItems.find((item) => item.key === selectedRecipeKey);
      const qtyMultiplier = parseFloat(quantity) || 1;
      const recipeTotal = Array.isArray(activeRecipe?.ingredients)
        ? activeRecipe.ingredients.reduce((sum, ing) => sum + (Number(ing.cost) || 0), 0)
        : 0;
      const menuItemCost = Number(activeMenuItem?.menuPrice ?? recipeTotal) || 0;
      const parsedIngredients = Array.isArray(activeRecipe?.ingredients)
        ? recipeTotal > 0
          ? activeRecipe.ingredients.map((ing) => ({
            ...ing,
            cost: (Number(ing.cost) || 0) * (menuItemCost / recipeTotal) * qtyMultiplier,
          }))
          : splitCostAcrossIngredients(menuItemCost * qtyMultiplier, activeRecipe.ingredients)
        : [];

      finalEntry = {
        ...finalEntry,
        name: activeMenuItem?.name || activeRecipe?.name || selectedRecipeKey,
        quantity,
        category: activeRecipe ? 'Menu Recipe' : 'Menu Item',
        cost: parseFloat(cost) || 0,
        isRecipe: Boolean(activeRecipe),
        recipeKey: selectedRecipeKey,
        ingredients: parsedIngredients,
      };
    }

    onAddEntry(finalEntry);
    setName('');
    setQuantity('1');
    setStaff('');
    setReason('Passed Expiration Date');
    setCustomReason('');
    setWasteDate(getTodayYMD());
    if (formType === 'single') setCost('');
  };

  const handleAddStaffMember = () => {
    const trimmedName = newStaffName.trim();
    const trimmedRole = newStaffRole.trim();

    if (!trimmedName) {
      alert('Please enter a staff name.');
      return;
    }

    if (!trimmedRole) {
      alert('Please enter a role for this staff member.');
      return;
    }

    if (safeStaffList.some((s) => s.name.toLowerCase() === trimmedName.toLowerCase())) {
      alert('A staff member with this name already exists.');
      return;
    }

    onAddStaff({ name: trimmedName, role: trimmedRole });
    setNewStaffName('');
    setNewStaffRole('');
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
            onClick={() => setFormType('single')}
            className={`segment-button${formType === 'single' ? ' is-active' : ''}`}
          >
            Ingredient
          </button>
          <button
            type="button"
            onClick={() => setFormType('recipe')}
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
                className="input"
              />
            </div>

            <div className="field">
              <label htmlFor="food-category">Category</label>
              <select id="food-category" value={category} onChange={(e) => setCategory(e.target.value)} className="select">
                <option value="Produce">Produce</option>
                <option value="Dairy">Dairy & Eggs</option>
                <option value="Bakery">Bakery & Grains</option>
                <option value="Meat/Poultry">Meat & Poultry</option>
                <option value="Pantry">Pantry Goods</option>
              </select>
            </div>
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

        <div className="field-grid">
          <div className="field">
            <label htmlFor="quantity">Portions</label>
            <input
              id="quantity"
              type="number"
              min="0.5"
              step="0.5"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input"
            />
          </div>

          <div className="field">
            <label htmlFor="cost-loss">Cost loss</label>
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

        <div className="field">
          <div className="manager-row" style={{ marginBottom: '8px' }}>
            <label className="field-label" htmlFor="responsible-staff">Responsible staff member</label>
            <button
              type="button"
              onClick={() => setShowStaffManager(!showStaffManager)}
              className={`ghost-button${showStaffManager ? ' is-warning' : ''}`}
            >
              {showStaffManager ? 'Close staff' : 'Manage staff'}
            </button>
          </div>

          {safeStaffList.length === 0 ? (
            <div className="muted-box">
              <p className="small-text" style={{ margin: '0 0 10px' }}>No staff members added yet.</p>
              <button type="button" onClick={() => setShowStaffManager(true)} className="ghost-button is-warning">
                Add first staff member
              </button>
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

          {showStaffManager && (
            <div className="budget-panel" style={{ marginTop: '12px' }}>
              <h3 className="breakdown-title">Staff manager</h3>

              <div className="field-grid">
                <input
                  type="text"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  placeholder="Name"
                  className="input"
                />
                <input
                  type="text"
                  value={newStaffRole}
                  onChange={(e) => setNewStaffRole(e.target.value)}
                  placeholder="Role"
                  className="input"
                />
              </div>

              <button type="button" onClick={handleAddStaffMember} className="ghost-button is-warning" style={{ marginTop: '10px' }}>
                Add staff member
              </button>

              {safeStaffList.length > 0 && (
                <div className="staff-list" style={{ marginTop: '12px' }}>
                  {safeStaffList.map((member) => (
                    <div key={member.id} className="staff-card item-row">
                      <div>
                        <strong>{member.name}</strong>
                        <span className="badge" style={{ marginLeft: '8px' }}>{member.role}</span>
                        {member.isCsvSeed && <span className="badge" style={{ marginLeft: '8px' }}>CSV</span>}
                      </div>
                      {!member.isCsvSeed && (
                        <button type="button" onClick={() => onDeleteStaff(member.id)} className="delete-button" title={`Remove ${member.name}`}>
                          x
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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

        <button type="submit" disabled={formType === 'recipe' && safeMenuItems.length === 0} className="primary-button">
          Log waste
        </button>
      </div>
    </form>
  );
}

export default WasteForm;
