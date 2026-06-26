const rawDefaultRecipes = {
  oatmeal: {
    name: 'Oatmeal',
    ingredients: [
      { name: 'Raw Oatmeal (70g)', cost: 0.0, category: 'Bakery', stock: 50 },
      { name: 'Full Cream Milk (300ml)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Banana (60g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Dried Cranberry (15g)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Roasted Hazelnut (15g)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Honey (15ml)', cost: 0.0, category: 'Pantry', stock: 50 },
    ],
  },
  avo_hummus_toast: {
    name: 'Avo & Hummus Toast',
    ingredients: [
      { name: 'Bread slices (2)', cost: 0.0, category: 'Bakery', stock: 50 },
      { name: 'Avocado (1)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Hummus (60g)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Cherry Tomato (20g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Seeds (10g)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Chia Seeds (5g)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Lemon Wedge (1)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Micro Greens (garnish)', cost: 0.0, category: 'Produce', stock: 50 },
    ],
  },
  berry_bliss_french_toast: {
    name: 'Berry Bliss French Toast',
    ingredients: [
      { name: 'Brioche loaf slices (2)', cost: 0.0, category: 'Bakery', stock: 50 },
      { name: 'Eggs (2)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Milk (20ml)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Vanilla Essence (2ml)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Banana (100g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Blueberry Compote (50g)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Maple Syrup (25g)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Icing Sugar (5g)', cost: 0.0, category: 'Pantry', stock: 50 },
    ],
  },
  sunrise_croissant: {
    name: 'Sunrise Croissant',
    ingredients: [
      { name: 'Croissant (1)', cost: 0.0, category: 'Bakery', stock: 50 },
      { name: 'Eggs (2)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Butter (1 portion)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Shoulder Bacon/Macon (60g)', cost: 0.0, category: 'Meat/Poultry', stock: 50 },
      { name: 'Tomato Chilli Jam (20g)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Spring Onion (5g)', cost: 0.0, category: 'Produce', stock: 50 },
    ],
  },
  scrambled_egg_avo_toast: {
    name: 'Scrambled Egg, Avo & Toast',
    ingredients: [
      { name: 'Bread slice (1)', cost: 0.0, category: 'Bakery', stock: 50 },
      { name: 'Eggs (3)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Full Cream Milk (20ml)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Micro Greens (5g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Avocado half (0.85g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Butter (1 portion)', cost: 0.0, category: 'Dairy', stock: 50 },
    ],
  },
  salmon_benedict: {
    name: 'Salmon Benedict',
    ingredients: [
      { name: 'Poached Eggs (2)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'English Muffin (1)', cost: 0.0, category: 'Bakery', stock: 50 },
      { name: 'Hollandaise Sauce (75ml)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Salmon (1 portion)', cost: 0.0, category: 'Meat/Poultry', stock: 50 },
      { name: 'Lemon Wedge (1)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Capers (5g)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Cream Cheese (30g)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Micro Green Herbs (5g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Avocado half (0.85g)', cost: 0.0, category: 'Produce', stock: 50 },
    ],
  },
  benedict_florentine: {
    name: 'Benedict Florentine',
    ingredients: [
      { name: 'Poached Eggs (2)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'English Muffin (1)', cost: 0.0, category: 'Bakery', stock: 50 },
      { name: 'Hollandaise Sauce (75ml)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Mushroom (80g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Spinach (30g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Micro Green Herbs (5g)', cost: 0.0, category: 'Produce', stock: 50 },
    ],
  },
  low_carb_benedict: {
    name: 'Low Carb Benedict',
    ingredients: [
      { name: 'Poached Eggs (2)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Hollandaise Sauce (75ml)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Shoulder Bacon/Macon (60g)', cost: 0.0, category: 'Meat/Poultry', stock: 50 },
      { name: 'Rocket (20g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Mushrooms (80g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Micro Green Herbs (5g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Avocado full (0.85g)', cost: 0.0, category: 'Produce', stock: 50 },
    ],
  },
  classic_benedict: {
    name: 'Classic Benedict',
    ingredients: [
      { name: 'English Muffin (1)', cost: 0.0, category: 'Bakery', stock: 50 },
      { name: 'Bacon/Macon (60g)', cost: 0.0, category: 'Meat/Poultry', stock: 50 },
      { name: 'Poached Eggs (2)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Hollandaise Sauce (75ml)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Chives (1g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Smoked Paprika (1g)', cost: 0.0, category: 'Pantry', stock: 50 },
    ],
  },
  berry_bliss_yogurt_bowl: {
    name: 'Berry Bliss Yogurt Bowl',
    ingredients: [
      { name: 'Plain Yogurt (200g)', cost: 0.0, category: 'Dairy', stock: 50 },
      { name: 'Vanilla (5ml)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Honey (15g)', cost: 0.0, category: 'Pantry', stock: 50 },
      { name: 'Strawberry (30g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Raspberry (30g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Blueberry (30g)', cost: 0.0, category: 'Produce', stock: 50 },
      { name: 'Granola (75g)', cost: 0.0, category: 'Bakery', stock: 50 },
      { name: 'Mint (1g)', cost: 0.0, category: 'Produce', stock: 50 },
    ],
  },
};

const menuPrices = {
  oatmeal: 95,
  avo_hummus_toast: 105,
  berry_bliss_french_toast: 115,
  sunrise_croissant: 125,
  scrambled_egg_avo_toast: 92,
  salmon_benedict: 175,
  benedict_florentine: 155,
  low_carb_benedict: 139,
  classic_benedict: 120,
  berry_bliss_yogurt_bowl: 119,
};

const splitMenuPriceAcrossIngredients = (menuPrice, ingredients) => {
  const totalCents = Math.round(menuPrice * 100);
  const baseCents = Math.floor(totalCents / ingredients.length);
  const remainderCents = totalCents - (baseCents * ingredients.length);

  return ingredients.map((ingredient, index) => ({
    ...ingredient,
    cost: (baseCents + (index < remainderCents ? 1 : 0)) / 100,
  }));
};

const defaultRecipes = Object.fromEntries(
  Object.entries(rawDefaultRecipes).map(([key, recipe]) => {
    const menuPrice = menuPrices[key];

    if (!menuPrice) {
      return [key, recipe];
    }

    return [
      key,
      {
        ...recipe,
        menuPrice,
        costBasis: 'Menu price from v1/v2 PDF split evenly across listed ingredients.',
        ingredients: splitMenuPriceAcrossIngredients(menuPrice, recipe.ingredients),
      },
    ];
  })
);

export default defaultRecipes;
