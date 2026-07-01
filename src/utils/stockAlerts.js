import { createInvoiceKey, getBaseUnitInfo } from './invoiceParsing.js';

const DEFAULT_USAGE_WINDOW_DAYS = 30;
const DEFAULT_RISK_DAYS = 7;

const parseMovementDate = (movement) => {
  const parsedDate = new Date(movement?.createdAt || movement?.date || 0);

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

export const parseUsageQuantity = (movement) => {
  const explicitAmount = Number(movement?.changeAmount);

  if (Number.isFinite(explicitAmount) && explicitAmount !== 0) {
    return {
      quantity: Math.abs(explicitAmount),
      unit: movement?.unit || '',
    };
  }

  const labelMatch = String(movement?.changeLabel || '').match(/(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/);

  if (!labelMatch) {
    return null;
  }

  const quantity = Math.abs(Number(labelMatch[1]));

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return {
    quantity,
    unit: labelMatch[2] || movement?.unit || '',
  };
};

const toBaseQuantity = (quantity, unit) => {
  const base = getBaseUnitInfo(quantity, unit || 'each');

  if (!base || !Number.isFinite(Number(base.quantity))) {
    return null;
  }

  return {
    quantity: Number(base.quantity),
    unit: base.unit || unit || 'each',
  };
};

const getStockNameKey = ({ stock, ingredientsById }) => {
  const ingredient = ingredientsById.get(stock?.ingredientId || stock?.id);

  return createInvoiceKey(ingredient?.name || stock?.ingredientName || stock?.name || '');
};

export const createLowStockAlerts = ({
  ingredients = [],
  stockLevels = [],
  inventoryMovements = [],
  usageWindowDays = DEFAULT_USAGE_WINDOW_DAYS,
  riskDays = DEFAULT_RISK_DAYS,
} = {}) => {
  const now = new Date();
  const windowStartMs = now.getTime() - (Number(usageWindowDays) || DEFAULT_USAGE_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const ingredientsById = new Map((Array.isArray(ingredients) ? ingredients : []).map((ingredient) => [ingredient.id, ingredient]));
  const usageByName = new Map();

  (Array.isArray(inventoryMovements) ? inventoryMovements : []).forEach((movement) => {
    const movementDate = parseMovementDate(movement);

    if (!movementDate || movementDate.getTime() < windowStartMs) {
      return;
    }

    const usageQuantity = parseUsageQuantity(movement);
    const nameKey = createInvoiceKey(movement?.ingredientName);

    if (!usageQuantity || !nameKey) {
      return;
    }

    const baseUsage = toBaseQuantity(usageQuantity.quantity, usageQuantity.unit);

    if (!baseUsage) {
      return;
    }

    const currentUsage = usageByName.get(nameKey) || {
      quantity: 0,
      unit: baseUsage.unit,
      movements: 0,
    };

    if (currentUsage.unit !== baseUsage.unit) {
      return;
    }

    usageByName.set(nameKey, {
      quantity: currentUsage.quantity + baseUsage.quantity,
      unit: baseUsage.unit,
      movements: currentUsage.movements + 1,
    });
  });

  return (Array.isArray(stockLevels) ? stockLevels : [])
    .map((stock) => {
      const stockBase = toBaseQuantity(Number(stock?.currentQty) || 0, stock?.unit || 'each');
      const reorderBase = toBaseQuantity(Number(stock?.reorderPoint) || 0, stock?.unit || 'each');
      const nameKey = getStockNameKey({ stock, ingredientsById });
      const usage = usageByName.get(nameKey);
      const dailyUsage = usage?.quantity > 0
        ? usage.quantity / (Number(usageWindowDays) || DEFAULT_USAGE_WINDOW_DAYS)
        : 0;
      const projectedDaysLeft = dailyUsage > 0 && stockBase?.unit === usage?.unit
        ? stockBase.quantity / dailyUsage
        : null;
      const belowReorder = reorderBase?.quantity > 0 && stockBase?.quantity <= reorderBase.quantity;
      const forecastLow = projectedDaysLeft !== null && projectedDaysLeft <= (Number(riskDays) || DEFAULT_RISK_DAYS);
      const alreadyLow = String(stock?.status || '').toLowerCase() === 'low';

      if (!alreadyLow && !belowReorder && !forecastLow) {
        return null;
      }

      const ingredient = ingredientsById.get(stock?.ingredientId || stock?.id);

      return {
        ingredientId: stock?.ingredientId || stock?.id || '',
        ingredientName: ingredient?.name || stock?.ingredientName || stock?.name || 'Unknown ingredient',
        currentQty: Number(stock?.currentQty) || 0,
        unit: stock?.unit || 'each',
        reorderPoint: Number(stock?.reorderPoint) || 0,
        parLevel: Number(stock?.parLevel) || 0,
        recentUsage: usage?.quantity || 0,
        recentUsageUnit: usage?.unit || stock?.unit || 'each',
        projectedDaysLeft: projectedDaysLeft === null ? null : Math.max(0, Math.round(projectedDaysLeft * 10) / 10),
        severity: alreadyLow || belowReorder ? 'critical' : 'watch',
        reason: alreadyLow || belowReorder ? 'At or below reorder point' : 'Usage trend may run stock down soon',
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return (a.projectedDaysLeft ?? 999) - (b.projectedDaysLeft ?? 999);
    });
};
