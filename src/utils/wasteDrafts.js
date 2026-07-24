export const WASTE_FORM_DRAFT_ID = 'waste-form';

export const createWasteDraftPayload = (fields) => ({
  id: WASTE_FORM_DRAFT_ID,
  savedAt: new Date().toISOString(),
  fields: {
    formType: fields?.formType || 'single',
    menuSearch: fields?.menuSearch || '',
    name: fields?.name || '',
    quantity: fields?.quantity || '1',
    unit: fields?.unit || 'each',
    portionAmount: fields?.portionAmount || '',
    portionUnit: fields?.portionUnit || 'g',
    category: fields?.category || 'Produce',
    wasteClassification: fields?.wasteClassification || '',
    reason: fields?.reason || 'Expired',
    customReason: fields?.customReason || '',
    selectedStaffId: fields?.selectedStaffId || '',
    cost: fields?.cost || '',
    notes: fields?.notes || '',
    wasteDate: fields?.wasteDate || '',
    selectedRecipeKey: fields?.selectedRecipeKey || '',
    selectedComponentKeys: Array.isArray(fields?.selectedComponentKeys) ? fields.selectedComponentKeys : [],
  },
});

export const wasteDraftHasContent = (fields) => {
  const data = fields?.fields || fields || {};

  return Boolean(
    String(data.name || '').trim()
    || String(data.menuSearch || '').trim()
    || String(data.notes || '').trim()
    || String(data.customReason || '').trim()
    || String(data.cost || '').trim()
    || data.formType === 'recipe'
    || String(data.quantity || '1') !== '1'
    || String(data.reason || 'Expired') !== 'Expired'
  );
};

export const saveWasteFormDraft = async () => null;

export const loadWasteFormDraft = async () => null;

export const deleteWasteFormDraft = async () => null;
