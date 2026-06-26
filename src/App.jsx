import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import WasteForm from './components/WasteForm';
import WasteList from './components/WasteList';
import RecipeManager from './components/RecipeManager';
import defaultRecipes from './data/defaultRecipes';

// Seed stockroom recipes from the bundled menu catalog.
const DEFAULT_RECIPES = defaultRecipes;
const DEFAULT_RECIPE_SEED_VERSION = 'gemini-code-1782487423638-priced-menu-v1';

const isRecipeMap = (value) => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const cloneRecipeMap = (recipeMap) => Object.fromEntries(
  Object.entries(recipeMap).map(([key, recipe]) => [
    key,
    {
      ...recipe,
      ingredients: Array.isArray(recipe.ingredients)
        ? recipe.ingredients.map((ingredient) => ({ ...ingredient }))
        : [],
    },
  ])
);

const mergeDefaultRecipeUpdates = (savedRecipeMap) => {
  const savedRecipes = cloneRecipeMap(savedRecipeMap);
  const updatedRecipes = {
    ...savedRecipes,
    ...cloneRecipeMap(DEFAULT_RECIPES),
  };

  for (const key of Object.keys(DEFAULT_RECIPES)) {
    const savedRecipe = savedRecipes[key];
    if (!savedRecipe || !Array.isArray(savedRecipe.ingredients)) continue;

    const savedStockByIngredientName = new Map(
      savedRecipe.ingredients.map((ingredient) => [ingredient.name, ingredient.stock])
    );

    updatedRecipes[key] = {
      ...updatedRecipes[key],
      ingredients: updatedRecipes[key].ingredients.map((ingredient) => ({
        ...ingredient,
        stock: savedStockByIngredientName.get(ingredient.name) ?? ingredient.stock,
      })),
    };
  }

  return updatedRecipes;
};

const buildInitialRecipes = () => {
  const savedRecipes = localStorage.getItem('customRecipes');
  const savedSeedVersion = localStorage.getItem('defaultRecipeSeedVersion');
  const savedRecipeMap = savedRecipes ? JSON.parse(savedRecipes) : {};

  if (!isRecipeMap(savedRecipeMap)) {
    return cloneRecipeMap(DEFAULT_RECIPES);
  }

  if (!savedRecipes || savedSeedVersion !== DEFAULT_RECIPE_SEED_VERSION) {
    return mergeDefaultRecipeUpdates(savedRecipeMap);
  }

  return cloneRecipeMap(savedRecipeMap);
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  const [wasteItems, setWasteItems] = useState(() => {
    try {
      const savedItems = localStorage.getItem('wasteItems');
      const parsed = savedItems ? JSON.parse(savedItems) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Corrupted waste items in storage, resetting.", e);
      return [];
    }
  });

  const [budget, setBudget] = useState(() => {
    const savedBudget = localStorage.getItem('wasteBudget');
    return savedBudget ? parseFloat(savedBudget) : 500; 
  });

  // Custom dynamic recipe database state loop
  const [recipes, setRecipes] = useState(() => {
    try {
      return buildInitialRecipes();
    } catch (e) {
      console.error("Corrupted recipes in storage, resetting.", e);
      return cloneRecipeMap(DEFAULT_RECIPES);
    }
  });

  // Dynamic staff list with roles
  const [staffList, setStaffList] = useState(() => {
    try {
      const savedStaff = localStorage.getItem('staffList');
      const parsed = savedStaff ? JSON.parse(savedStaff) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Corrupted staff list in storage, resetting.", e);
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('wasteItems', JSON.stringify(wasteItems));
  }, [wasteItems]);

  useEffect(() => {
    localStorage.setItem('wasteBudget', budget.toString());
  }, [budget]);

  useEffect(() => {
    localStorage.setItem('customRecipes', JSON.stringify(recipes));
    localStorage.setItem('defaultRecipeSeedVersion', DEFAULT_RECIPE_SEED_VERSION);
  }, [recipes]);

  useEffect(() => {
    localStorage.setItem('staffList', JSON.stringify(staffList));
  }, [staffList]);

  const handleAddStaff = (newStaffMember) => {
    setStaffList(prev => [...prev, { ...newStaffMember, id: Date.now().toString() }]);
  };

  const handleDeleteStaff = (staffId) => {
    setStaffList(prev => prev.filter(s => s.id !== staffId));
  };

  // Deducts raw physical ingredients from inventory stock parameters upon a waste submission
  const handleAddEntry = (newEntry) => {
    setWasteItems([...wasteItems, newEntry]);

    if (newEntry.isRecipe && newEntry.recipeKey) {
      setRecipes(prevRecipes => {
        const updatedRecipes = { ...prevRecipes };
        if (updatedRecipes[newEntry.recipeKey]) {
          const qty = parseFloat(newEntry.quantity) || 1;
          updatedRecipes[newEntry.recipeKey].ingredients = updatedRecipes[newEntry.recipeKey].ingredients.map(ing => ({
            ...ing,
            stock: Math.max(0, ing.stock - qty) // Prevents negative numbers
          }));
        }
        return updatedRecipes;
      });
    }
  };

  const handleAddNewRecipe = (key, recipeObject) => {
    setRecipes(prev => ({
      ...prev,
      [key]: recipeObject
    }));
  };

  const handleDeleteEntry = (idToDelete) => {
    setWasteItems(wasteItems.filter(item => item.id !== idToDelete));
  };

  const handleClearAll = () => {
    if (window.confirm("Are you sure you want to clear your entire log? 🚨")) {
      setWasteItems([]);
    }
  };

  // Completely wipes out browser storage cache memory for custom recipes
  const handleClearRecipes = () => {
    if (window.confirm("Are you sure you want to completely clear out your entire recipe database? This cannot be undone! 🚨")) {
      setRecipes({});
      localStorage.setItem('customRecipes', JSON.stringify({}));
      localStorage.setItem('defaultRecipeSeedVersion', DEFAULT_RECIPE_SEED_VERSION);
    }
  };

  return (
    <div className="app-shell">
      <Navbar activePage={activeTab} onNavigate={setActiveTab} wasteCount={wasteItems.length} />

      <main className={`app-page${activeTab === 'wasteLog' ? ' app-page--wide' : ''}`}>
        {activeTab === 'dashboard' && (
          <Dashboard items={wasteItems} budget={budget} setBudget={setBudget} />
        )}

        {activeTab === 'logWaste' && (
          <WasteForm onAddEntry={handleAddEntry} recipes={recipes} staffList={staffList} onAddStaff={handleAddStaff} onDeleteStaff={handleDeleteStaff} />
        )}

        {activeTab === 'wasteLog' && (
          <WasteList items={wasteItems} onDeleteEntry={handleDeleteEntry} onClearAll={handleClearAll} />
        )}

        {activeTab === 'stockroom' && (
          <RecipeManager 
            recipes={recipes} 
            onAddRecipe={handleAddNewRecipe} 
            onClearRecipes={handleClearRecipes} 
          />
        )}
      </main>
    </div>
  );
}

export default App;
