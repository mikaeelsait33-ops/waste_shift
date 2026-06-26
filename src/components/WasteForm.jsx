import { useState, useEffect } from 'react';

function WasteForm({ onAddEntry, recipes }) {
  const [formType, setFormType] = useState('single'); 
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [category, setCategory] = useState('Produce');
  const [reason, setReason] = useState('Passed Expiration Date');
  const [staff, setStaff] = useState(''); // 🧑‍🍳 Staff state
  const [cost, setCost] = useState('');
  
  // Custom staff list - feel free to change these names to your real team!
  const staffList = ["Chef Thabo", "Nadia", "Sarah (Kitchen)", "David (Prep)", "John (Service)"];

  const recipeKeys = Object.keys(recipes);
  const [selectedRecipeKey, setSelectedRecipeKey] = useState(recipeKeys[0] || '');

  useEffect(() => {
    if (recipeKeys.length > 0 && !recipes[selectedRecipeKey]) {
      setSelectedRecipeKey(recipeKeys[0]);
    }
  }, [recipes, recipeKeys, selectedRecipeKey]);

  useEffect(() => {
    if (formType === 'recipe' && recipes[selectedRecipeKey]) {
      const recipe = recipes[selectedRecipeKey];
      const singleRecipeTotal = recipe.ingredients.reduce((sum, ing) => sum + ing.cost, 0);
      const qtyMultiplier = parseFloat(quantity) || 1;
      setCost((singleRecipeTotal * qtyMultiplier).toFixed(2));
    } else if (formType === 'single') {
      setCost('');
    }
  }, [formType, selectedRecipeKey, quantity, recipes]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (formType === 'single' && (!name || !cost)) return;
    if (formType === 'recipe' && !selectedRecipeKey) return;
    
    // Validation: Make sure a staff member was chosen
    if (!staff) {
      alert("Please select the staff member responsible! 🧑‍🍳");
      return;
    }

    let finalEntry = {
      id: Date.now().toString(),
      reason: reason,
      staff: staff, // Saved to database record
      date: new Date().toLocaleDateString('en-GB'),
    };

    if (formType === 'single') {
      finalEntry = {
        ...finalEntry,
        name: name,
        quantity: quantity,
        category: category,
        cost: parseFloat(cost) || 0,
        isRecipe: false,
        ingredients: []
      };
    } else {
      const activeRecipe = recipes[selectedRecipeKey];
      const qtyMultiplier = parseFloat(quantity) || 1;
      
      const parsedIngredients = activeRecipe.ingredients.map(ing => ({
        ...ing,
        cost: ing.cost * qtyMultiplier
      }));

      finalEntry = {
        ...finalEntry,
        name: activeRecipe.name,
        quantity: quantity,
        category: "Menu Recipe",
        cost: parseFloat(cost) || 0,
        isRecipe: true,
        recipeKey: selectedRecipeKey,
        ingredients: parsedIngredients
      };
    }

    onAddEntry(finalEntry);

    // Reset Form
    setName('');
    setQuantity('1');
    setStaff(''); // Reset dropdown
    if (formType === 'single') setCost('');
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: '400px', margin: '20px auto', padding: '20px', backgroundColor: '#1a1a1a', borderRadius: '8px', border: '1px solid #333' }}>
      <h3 style={{ marginTop: 0, textAlign: 'center', fontSize: '1.2rem' }}>Log Wasted Food</h3>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
        <button type="button" onClick={() => setFormType('single')} style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #444', backgroundColor: formType === 'single' ? '#333' : 'transparent', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
          Ingredient Log
        </button>
        <button type="button" onClick={() => setFormType('recipe')} style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #444', backgroundColor: formType === 'recipe' ? '#333' : 'transparent', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
          Menu Recipe Log
        </button>
      </div>

      {formType === 'single' ? (
        <>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>Food Item Name:</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Cheddar Block" style={{ width: '100%', padding: '8px', boxSizing: 'border-box', backgroundColor: '#222', border: '1px solid #444', color: '#fff', borderRadius: '4px' }} />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>Category:</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', backgroundColor: '#222', border: '1px solid #444', color: '#fff', borderRadius: '4px' }}>
              <option value="Produce">🥦 Produce</option>
              <option value="Dairy">🥛 Dairy & Eggs</option>
              <option value="Bakery">🍞 Bakery & Grains</option>
              <option value="Meat/Poultry">🥩 Meat & Poultry</option>
              <option value="Pantry">🥫 Pantry Goods</option>
            </select>
          </div>
        </>
      ) : (
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>Select Menu Item:</label>
          {recipeKeys.length === 0 ? (
            <p style={{ color: '#ff4d4d', fontSize: '0.85rem', margin: '5px 0' }}>No recipes found! Create one in the stockroom manager first.</p>
          ) : (
            <select value={selectedRecipeKey} onChange={(e) => setSelectedRecipeKey(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', backgroundColor: '#222', border: '1px solid #444', color: '#fff', borderRadius: '4px' }}>
              {recipeKeys.map((key) => (
                <option key={key} value={key}>{recipes[key]?.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>Portions:</label>
          <input type="number" min="0.5" step="0.5" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', backgroundColor: '#222', border: '1px solid #444', color: '#fff', borderRadius: '4px' }} />
        </div>

        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>Cost Loss:</label>
          <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} disabled={formType === 'recipe'} placeholder="R" style={{ width: '100%', padding: '8px', boxSizing: 'border-box', backgroundColor: formType === 'recipe' ? '#2d2d2d' : '#222', border: '1px solid #444', color: formType === 'recipe' ? '#4CAF50' : '#fff', fontWeight: 'bold', borderRadius: '4px' }} />
        </div>
      </div>

      {/* 🧑‍🍳 New Dropdown: Staff Accountability Assignment */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>Responsible Staff Member:</label>
        <select value={staff} onChange={(e) => setStaff(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', backgroundColor: '#222', border: '1px solid #444', color: '#fff', borderRadius: '4px' }}>
          <option value="">-- Choose Staff Name --</option>
          {staffList.map((name, i) => (
            <option key={i} value={name}>{name}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>Reason for Waste:</label>
        <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box', backgroundColor: '#222', border: '1px solid #444', color: '#fff', borderRadius: '4px' }}>
          <option value="Passed Expiration Date">📆 Passed Expiration Date</option>
          <option value="Spoiled/Overripe">🤢 Spoiled / Overripe</option>
          <option value="Kitchen Prep Mistake">🍳 Kitchen Prep Mistake</option>
        </select>
      </div>

      <button type="submit" disabled={formType === 'recipe' && recipeKeys.length === 0} style={{ width: '100%', padding: '10px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer', opacity: (formType === 'recipe' && recipeKeys.length === 0) ? 0.5 : 1 }}>
        Log this waste
      </button>
    </form>
  );
}

export default WasteForm;