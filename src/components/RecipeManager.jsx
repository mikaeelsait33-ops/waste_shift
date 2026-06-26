import { useState } from 'react';

function RecipeManager({ recipes, onAddRecipe, onClearRecipes }) {
  const [recipeName, setRecipeName] = useState('');
  const [ingredients, setIngredients] = useState([
    { name: '', cost: '', category: 'Produce', stock: 50 },
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
    if (!recipeName || ingredients.some((ing) => !ing.name || !ing.cost)) {
      alert('Please fill out the recipe name and all ingredient fields.');
      return;
    }

    const recipeKey = recipeName.toLowerCase().trim().replace(/\s+/g, '_');
    const formattedIngredients = ingredients.map((ing) => ({
      name: ing.name,
      cost: parseFloat(ing.cost) || 0,
      category: ing.category,
      stock: parseInt(ing.stock, 10) || 0,
    }));

    onAddRecipe(recipeKey, {
      name: recipeName,
      ingredients: formattedIngredients,
    });

    setRecipeName('');
    setIngredients([{ name: '', cost: '', category: 'Produce', stock: 50 }]);
    alert(`"${recipeName}" has been added to your recipe database.`);
  };

  return (
    <section className="inventory-section">
      <form onSubmit={handleSubmitRecipe} className="panel">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Stockroom</p>
              <h2 className="title">Recipe & Stock Creator</h2>
              <p className="subtitle">Build recipes with ingredient costs and stock counts.</p>
            </div>
          </div>

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

          <h3 className="breakdown-title">Ingredients and pricing</h3>
          <div className="ingredient-list">
            {ingredients.map((ing, idx) => (
              <div key={idx} className="ingredient-card">
                <div className="field-grid">
                  <input
                    type="text"
                    placeholder="Ingredient name"
                    value={ing.name}
                    onChange={(e) => handleIngredientChange(idx, 'name', e.target.value)}
                    className="input"
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Cost (R)"
                    value={ing.cost}
                    onChange={(e) => handleIngredientChange(idx, 'cost', e.target.value)}
                    className="input"
                  />
                </div>

                <div className="field-grid" style={{ marginTop: '10px' }}>
                  <select
                    value={ing.category}
                    onChange={(e) => handleIngredientChange(idx, 'category', e.target.value)}
                    className="select"
                  >
                    <option value="Produce">Produce</option>
                    <option value="Dairy">Dairy & Eggs</option>
                    <option value="Bakery">Bakery & Grains</option>
                    <option value="Meat/Poultry">Meat & Poultry</option>
                    <option value="Pantry">Pantry Goods</option>
                  </select>

                  <div className="manager-row">
                    <input
                      type="number"
                      placeholder="Stock"
                      value={ing.stock}
                      onChange={(e) => handleIngredientChange(idx, 'stock', e.target.value)}
                      className="input"
                    />
                    {ingredients.length > 1 && (
                      <button type="button" onClick={() => removeIngredientRow(idx)} className="delete-button" title="Remove ingredient">
                        x
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addIngredientRow} className="ghost-button" style={{ width: '100%', margin: '14px 0' }}>
            Add ingredient
          </button>

          <button type="submit" className="primary-button">
            Save recipe
          </button>
        </div>
      </form>

      <div className="panel">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Inventory</p>
              <h2 className="title">Live Stockroom</h2>
              <p className="subtitle">Ingredient values and stock levels by recipe.</p>
            </div>
            {Object.keys(recipes).length > 0 && (
              <button type="button" onClick={onClearRecipes} className="danger-button">
                Wipe recipes
              </button>
            )}
          </div>

          {Object.keys(recipes).length === 0 ? (
            <div className="empty-state">Your stockroom database is empty. Create a custom item above.</div>
          ) : (
            Object.keys(recipes).map((key) => {
              const recipe = recipes[key];
              const recipeTotal = Number(recipe.menuPrice ?? recipe.ingredients.reduce((sum, ing) => sum + (Number(ing.cost) || 0), 0));

              return (
                <div key={key} className="inventory-card">
                  <div className="inventory-heading">
                    <h3 className="inventory-title">{recipe.name}</h3>
                    <span className="price is-total">R{recipeTotal.toFixed(2)}</span>
                  </div>

                  <div className="ingredient-list">
                    {recipe.ingredients.map((ing, i) => (
                      <div key={`${ing.name}-${i}`} className="ingredient-card item-row">
                        <span className="small-text">
                          {ing.name} <span className="badge">{ing.category}</span>
                        </span>
                        <div className="manager-row">
                          <span className="price">R{(Number(ing.cost) || 0).toFixed(2)}</span>
                          <span className={`badge${ing.stock <= 5 ? ' is-red' : ' is-green'}`}>
                            Stock: {ing.stock}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
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
