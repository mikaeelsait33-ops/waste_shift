import { useState } from 'react';

// 1. Add "onClearRecipes" to the incoming properties here:
function RecipeManager({ recipes, onAddRecipe, onClearRecipes }) {
  const [recipeName, setRecipeName] = useState('');
  const [ingredients, setIngredients] = useState([
    { name: '', cost: '', category: 'Produce', stock: 50 }
  ]);

  const handleIngredientChange = (index, field, value) => {
    const updated = [...ingredients];
    updated[index][field] = value;
    setIngredients(updated);
  };

  const addIngredientRow = () => {
    setIngredients([...ingredients, { name: '', cost: '', category: 'Produce', stock: 50 }]);
  };

  const removeIngredientRow = (index) => {
    if (ingredients.length > 1) {
      setIngredients(ingredients.filter((_, i) => i !== index));
    }
  };

  const handleSubmitRecipe = (e) => {
    e.preventDefault();
    if (!recipeName || ingredients.some(ing => !ing.name || !ing.cost)) {
      alert("Please fill out the recipe name and all ingredient fields! ⚠️");
      return;
    }

    const recipeKey = recipeName.toLowerCase().trim().replace(/\s+/g, '_');
    
    const formattedIngredients = ingredients.map(ing => ({
      name: ing.name,
      cost: parseFloat(ing.cost) || 0,
      category: ing.category,
      stock: parseInt(ing.stock) || 0
    }));

    onAddRecipe(recipeKey, {
      name: recipeName,
      ingredients: formattedIngredients
    });

    setRecipeName('');
    setIngredients([{ name: '', cost: '', category: 'Produce', stock: 50 }]);
    alert(`🎉 "${recipeName}" has been successfully added to your master database!`);
  };

  return (
    <div style={{ maxWidth: '500px', margin: '0 auto' }}>
      
      {/* Creator Form */}
      <form onSubmit={handleSubmitRecipe} style={{ backgroundColor: '#1a1a1a', padding: '20px', borderRadius: '8px', border: '1px solid #333', marginBottom: '25px' }}>
        <h3 style={{ marginTop: 0, fontSize: '1.1rem', color: '#ff9800' }}>🔨 Custom Recipe & Stock Creator</h3>
        
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>Menu Item Name:</label>
          <input type="text" value={recipeName} onChange={(e) => setRecipeName(e.target.value)} placeholder="e.g., Chicken Schnitzel Strips" style={{ width: '100%', padding: '8px', boxSizing: 'border-box', backgroundColor: '#222', border: '1px solid #444', color: '#fff', borderRadius: '4px' }} />
        </div>

        <h4 style={{ fontSize: '0.9rem', color: '#ccc', marginBottom: '10px' }}>Ingredients Breakdown & Pricing:</h4>
        {ingredients.map((ing, idx) => (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: '#222', padding: '10px', borderRadius: '6px', marginBottom: '10px', border: '1px solid #2a2a2a' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="text" placeholder="Ingredient Name" value={ing.name} onChange={(e) => handleIngredientChange(idx, 'name', e.target.value)} style={{ flex: 2, padding: '6px', backgroundColor: '#111', border: '1px solid #444', color: '#fff', borderRadius: '4px', fontSize: '0.85rem' }} />
              <input type="number" step="0.01" placeholder="Cost (R)" value={ing.cost} onChange={(e) => handleIngredientChange(idx, 'cost', e.target.value)} style={{ flex: 1, padding: '6px', backgroundColor: '#111', border: '1px solid #444', color: '#fff', borderRadius: '4px', fontSize: '0.85rem' }} />
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select value={ing.category} onChange={(e) => handleIngredientChange(idx, 'category', e.target.value)} style={{ flex: 1, padding: '6px', backgroundColor: '#111', border: '1px solid #444', color: '#fff', borderRadius: '4px', fontSize: '0.8rem' }}>
                <option value="Produce">Produce</option>
                <option value="Dairy">Dairy & Eggs</option>
                <option value="Bakery">Bakery & Grains</option>
                <option value="Meat/Poultry">Meat & Poultry</option>
                <option value="Pantry">Pantry Goods</option>
              </select>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                <span style={{ fontSize: '0.75rem', color: '#888' }}>Stock:</span>
                <input type="number" placeholder="Qty" value={ing.stock} onChange={(e) => handleIngredientChange(idx, 'stock', e.target.value)} style={{ width: '100%', padding: '6px', backgroundColor: '#111', border: '1px solid #444', color: '#fff', borderRadius: '4px', fontSize: '0.85rem' }} />
              </div>

              {ingredients.length > 1 && (
                <button type="button" onClick={() => removeIngredientRow(idx)} style={{ backgroundColor: '#ff4d4d', border: 'none', color: '#fff', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
              )}
            </div>
          </div>
        ))}

        <button type="button" onClick={addIngredientRow} style={{ width: '100%', padding: '6px', backgroundColor: '#333', color: '#ccc', border: '1px dashed #555', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', marginBottom: '15px' }}>
          ＋ Add Another Sub-Ingredient
        </button>

        <button type="submit" style={{ width: '100%', padding: '10px', backgroundColor: '#ff9800', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
          Save Recipe to Database
        </button>
      </form>

      {/* Live Stockroom Room Panel */}
      <div style={{ backgroundColor: '#1a1a1a', padding: '20px', borderRadius: '8px', border: '1px solid #333' }}>
        {/* 2. Added header layout container with the clear trigger button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#4CAF50' }}>🏢 Live Stockroom Inventory</h3>
          {Object.keys(recipes).length > 0 && (
            <button onClick={onClearRecipes} style={{ backgroundColor: '#ff4d4d', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold' }}>
              Wipe All Recipes 🗑️
            </button>
          )}
        </div>

        {Object.keys(recipes).length === 0 ? (
          <p style={{ color: '#666', fontSize: '0.9rem', textAlign: 'center', margin: '20px 0' }}>Your stockroom database is empty. Create a custom item above!</p>
        ) : (
          Object.keys(recipes).map(key => (
            <div key={key} style={{ marginBottom: '15px', borderBottom: '1px solid #222', paddingBottom: '10px' }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#fff' }}>{recipes[key].name}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {recipes[key].ingredients.map((ing, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', backgroundColor: '#222', padding: '6px 10px', borderRadius: '4px' }}>
                    <span style={{ color: '#aaa' }}>{ing.name} <code style={{ color: '#666' }}>({ing.category})</code></span>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <span style={{ color: '#ff4d4d' }}>R{ing.cost.toFixed(2)}</span>
                      <span style={{ 
                        backgroundColor: ing.stock <= 5 ? '#5a1818' : '#2d2d2d', 
                        color: ing.stock <= 5 ? '#ff4d4d' : '#4CAF50', 
                        padding: '2px 6px', 
                        borderRadius: '4px', 
                        fontWeight: 'bold',
                        fontSize: '0.75rem'
                      }}>
                        Stock: {ing.stock} units
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default RecipeManager;