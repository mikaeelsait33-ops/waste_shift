import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import WasteForm from './components/WasteForm';
import WasteList from './components/WasteList';
import RecipeManager from './components/RecipeManager';

// ✅ Clean Slate: Starter seeds have been completely emptied out here
const DEFAULT_RECIPES = {};

function App() {
  const [activeTab, setActiveTab] = useState('tracker'); // 'tracker' or 'stockroom'

  const [wasteItems, setWasteItems] = useState(() => {
    const savedItems = localStorage.getItem('wasteItems');
    return savedItems ? JSON.parse(savedItems) : [];
  });

  const [budget, setBudget] = useState(() => {
    const savedBudget = localStorage.getItem('wasteBudget');
    return savedBudget ? parseFloat(savedBudget) : 500; 
  });

  // Custom dynamic recipe database state loop
  const [recipes, setRecipes] = useState(() => {
    const savedRecipes = localStorage.getItem('customRecipes');
    return savedRecipes ? JSON.parse(savedRecipes) : DEFAULT_RECIPES;
  });

  useEffect(() => {
    localStorage.setItem('wasteItems', JSON.stringify(wasteItems));
  }, [wasteItems]);

  useEffect(() => {
    localStorage.setItem('wasteBudget', budget.toString());
  }, [budget]);

  useEffect(() => {
    localStorage.setItem('customRecipes', JSON.stringify(recipes));
  }, [recipes]);

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
      localStorage.removeItem('customRecipes');
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#121212', color: '#fff', fontFamily: 'sans-serif' }}>
      <Navbar />

      {/* Modern Control Header Tabs */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', margin: '20px 0 10px 0' }}>
        <button onClick={() => setActiveTab('tracker')} style={{ padding: '10px 20px', borderRadius: '20px', border: '1px solid #333', backgroundColor: activeTab === 'tracker' ? '#4CAF50' : '#222', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>
          📊 Waste Tracker Dashboard
        </button>
        <button onClick={() => setActiveTab('stockroom')} style={{ padding: '10px 20px', borderRadius: '20px', border: '1px solid #333', backgroundColor: activeTab === 'stockroom' ? '#ff9800' : '#222', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>
          🏢 Stock & Recipe Manager
        </button>
      </div>
      
      <div style={{ padding: '10px 20px', maxWidth: '600px', margin: '0 auto' }}>
        {activeTab === 'tracker' ? (
          <>
            <Dashboard items={wasteItems} budget={budget} setBudget={setBudget} />
            <WasteForm onAddEntry={handleAddEntry} recipes={recipes} />
            <WasteList items={wasteItems} onDeleteEntry={handleDeleteEntry} onClearAll={handleClearAll} />
          </>
        ) : (
          <RecipeManager 
            recipes={recipes} 
            onAddRecipe={handleAddNewRecipe} 
            onClearRecipes={handleClearRecipes} 
          />
        )}
      </div>
    </div>
  );
}

export default App;