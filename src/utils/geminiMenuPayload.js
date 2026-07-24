const normalizeDishes = (payload = {}) => {
  if (Array.isArray(payload.dishes)) {
    return payload.dishes;
  }

  if (Array.isArray(payload.items)) {
    return payload.items.map((item) => ({
      ...item,
      ingredients: item.ingredients || item.components || [],
      instructions: item.instructions || item.description || '',
    }));
  }

  return [];
};

export const mergeGeminiMenuImportPayloads = (payloads = []) => {
  const dishesByName = new Map();
  const warnings = new Set();

  payloads.forEach((payload) => {
    (Array.isArray(payload?.warnings) ? payload.warnings : []).forEach((warning) => {
      if (warning) warnings.add(String(warning));
    });

    normalizeDishes(payload).forEach((dish) => {
      const name = String(dish?.name || '').trim();
      if (!name) return;

      const key = name.toLowerCase().replace(/\s+/g, ' ');
      const existing = dishesByName.get(key);
      if (!existing) {
        dishesByName.set(key, {
          ...dish,
          name,
          ingredients: Array.isArray(dish.ingredients) ? [...dish.ingredients] : [],
          warnings: Array.isArray(dish.warnings) ? [...dish.warnings] : [],
        });
        return;
      }

      const ingredientsByName = new Map(
        (Array.isArray(existing.ingredients) ? existing.ingredients : []).map((ingredient) => [
          String(ingredient?.name || ingredient?.ingredientName || '').toLowerCase().trim(),
          ingredient,
        ]),
      );

      (Array.isArray(dish.ingredients) ? dish.ingredients : []).forEach((ingredient) => {
        const ingredientKey = String(ingredient?.name || ingredient?.ingredientName || '').toLowerCase().trim();
        const current = ingredientsByName.get(ingredientKey);

        if (!current || (current.quantity == null && ingredient.quantity != null)) {
          ingredientsByName.set(ingredientKey, ingredient);
        }
      });

      dishesByName.set(key, {
        ...existing,
        category: existing.category || dish.category || '',
        sellingPrice: existing.sellingPrice ?? dish.sellingPrice ?? null,
        instructions: existing.instructions || dish.instructions || '',
        ingredients: [...ingredientsByName.values()],
        confidence: Math.max(Number(existing.confidence) || 0, Number(dish.confidence) || 0),
        warnings: [...new Set([
          ...(Array.isArray(existing.warnings) ? existing.warnings : []),
          ...(Array.isArray(dish.warnings) ? dish.warnings : []),
        ])],
      });
    });
  });

  const dishes = [...dishesByName.values()];
  const items = dishes.map((dish) => ({
    name: dish.name,
    category: dish.category,
    sellingPrice: dish.sellingPrice,
    description: dish.instructions || '',
    components: (Array.isArray(dish.ingredients) ? dish.ingredients : []).map((ingredient) => ({
      name: ingredient.name || ingredient.ingredientName,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    })),
    confidence: dish.confidence,
    warnings: dish.warnings || [],
    source: dish.source || 'gemini',
  }));

  return {
    ok: true,
    model: payloads.find((payload) => payload?.model)?.model || '',
    batchCount: payloads.reduce((count, payload) => count + (Number(payload?.batchCount) || 1), 0),
    requestBatchCount: payloads.length,
    dishes,
    items,
    warnings: [...warnings],
  };
};
