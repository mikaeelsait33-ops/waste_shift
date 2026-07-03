import { roundMoney } from './invoiceParsing.js';

const sanitizeString = (value) => String(value ?? '').trim();

const sanitizeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

export const createStockMovementId = ({ invoiceId, lineItemId, ingredientId }) => (
  `${sanitizeString(invoiceId)}_${sanitizeString(lineItemId) || sanitizeString(ingredientId)}_${sanitizeString(ingredientId)}`
    .replace(/[^a-z0-9_-]/gi, '_')
);

export const createStockMovementRecord = ({
  movementId,
  invoiceId,
  invoiceNumber = '',
  supplier = '',
  invoiceDate = '',
  receivedDate = '',
  lineItem = {},
  ingredientRow = {},
  previousQty = 0,
  incomingQty = 0,
  nextQty = 0,
  unit = 'each',
  status = 'ok',
  postingMode = 'posted',
  postedBy = '',
  createdAt,
}) => {
  const safeMovementId = sanitizeString(movementId);
  const safeIngredientId = sanitizeString(ingredientRow.ingredientId);
  const safeUnit = sanitizeString(unit || lineItem.baseUnit || lineItem.unit || ingredientRow.unit) || 'each';

  return {
    movementId: safeMovementId,
    type: postingMode === 'historical_posted' ? 'historical_receive' : 'receive',
    quantityBase: roundMoney(incomingQty),
    baseUnit: safeUnit,
    sourceType: 'invoice',
    sourceId: sanitizeString(invoiceId),
    invoiceId: sanitizeString(invoiceId),
    invoiceNumber: sanitizeString(invoiceNumber),
    supplier: sanitizeString(supplier),
    invoiceDate: sanitizeString(invoiceDate),
    receivedDate: sanitizeString(receivedDate || invoiceDate),
    ingredientId: safeIngredientId,
    ingredientName: sanitizeString(ingredientRow.ingredientName || lineItem.itemName),
    lineItemId: sanitizeString(lineItem.id || ingredientRow.lineItemId),
    lineItemName: sanitizeString(lineItem.itemName || ingredientRow.ingredientName),
    previousQuantityBase: roundMoney(previousQty),
    resultingQuantityBase: roundMoney(nextQty),
    status: sanitizeString(status) || 'ok',
    unitPriceExVAT: roundMoney(lineItem.unitPriceExVAT ?? ingredientRow.unitPriceExVAT),
    lineTotalExVAT: roundMoney(lineItem.priceExVAT ?? ingredientRow.priceExVAT),
    postingMode: sanitizeString(postingMode) || 'posted',
    postedBy: sanitizeString(postedBy) || 'WasteShift user',
    createdAt,
    sortDate: sanitizeString(receivedDate || invoiceDate) || new Date().toISOString().slice(0, 10),
  };
};

export const summarizeStockMovement = (movement) => ({
  ingredientId: sanitizeString(movement?.ingredientId),
  ingredientName: sanitizeString(movement?.ingredientName),
  quantityBase: sanitizeNumber(movement?.quantityBase),
  baseUnit: sanitizeString(movement?.baseUnit) || 'each',
  sourceId: sanitizeString(movement?.sourceId || movement?.invoiceId),
});
