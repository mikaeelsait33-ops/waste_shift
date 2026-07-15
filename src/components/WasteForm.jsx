import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateItemPriceCost,
  findItemPriceRecord,
  sanitizeItemPriceCatalog,
} from '../utils/itemPriceCatalog';
import {
  buildRecipeIngredientBreakdown,
  DEFAULT_WASTE_CLASSIFICATION,
  WASTE_CATEGORY_OPTIONS,
  WASTE_CLASSIFICATION_OPTIONS,
  WASTE_REASONS,
  calculateMenuWasteFinancials,
  getEntryFoodCostLost,
  getMenuSellingPrice,
  getRestaurantDateTimeParts,
  getRecipeIngredientTotal,
  getWasteClassificationMeta,
  roundCurrency,
} from '../utils/wasteCalculations';
import { createRecordId } from '../utils/ids';
import {
  deleteWasteFormDraft,
  loadWasteFormDraft,
  saveWasteFormDraft,
  wasteDraftHasContent,
} from '../utils/wasteDrafts';

const WASTE_UNITS = [
  { value: 'each', label: 'items / each' },
  { value: 'g', label: 'grams (g)' },
  { value: 'kg', label: 'kilograms (kg)' },
  { value: 'ml', label: 'millilitres (ml)' },
  { value: 'l', label: 'litres (L)' },
  { value: 'portion', label: 'portions' },
];

const PORTION_SIZE_UNITS = WASTE_UNITS.filter((unitOption) => unitOption.value !== 'portion');
const MAX_PHOTO_INPUT_BYTES = 8 * 1024 * 1024;
const PHOTO_TARGET_BYTES = 220 * 1024;
const PHOTO_INITIAL_QUALITY = 0.74;
const PHOTO_MIN_QUALITY = 0.46;
const PHOTO_MAX_DIMENSION = 1100;
const PHOTO_MIN_DIMENSION = 640;

const COMMON_REASON_BY_CATEGORY = {
  Produce: 'Spoiled',
  Dairy: 'Expired',
  Bakery: 'Expired',
  'Meat/Poultry': 'Expired',
  Pantry: 'Expired',
  'Coffee/Tea': 'Quality issue',
  Drinks: 'Quality issue',
  Other: 'Quality issue',
};

const DRINK_MENU_TERMS = [
  'americano',
  'barista',
  'beverage',
  'cappuccino',
  'chai',
  'coffee',
  'drink',
  'espresso',
  'juice',
  'latte',
  'milkshake',
  'mocha',
  'smoothie',
  'tea',
];

const createWasteItemKey = (itemName) => String(itemName || '')
  .trim()
  .toLowerCase()
  .replace(/&/g, ' ')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const formatNumber = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '';
  }

  return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

const formatSimpleQuantityLabel = (value, unit) => {
  const amountLabel = formatNumber(value) || '0';

  if (unit === 'each') {
    return `${amountLabel} item${Number(value) === 1 ? '' : 's'}`;
  }

  return `${amountLabel} ${unit}`;
};

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Unable to read image file.'));
  reader.readAsDataURL(file);
});

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Unable to load image file.'));
  image.src = src;
});

const canvasToJpegBlob = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
      return;
    }

    reject(new Error('Unable to prepare this photo.'));
  }, 'image/jpeg', quality);
});

const compressWastePhoto = async (file) => {
  const isImage = file.type
    ? file.type.startsWith('image/')
    : /\.(jpe?g|png|webp)$/i.test(file.name || '');

  if (!isImage) {
    throw new Error('Choose a JPG, PNG, or WebP photo for the waste entry.');
  }

  if (file.size > MAX_PHOTO_INPUT_BYTES) {
    throw new Error('Choose a photo under 8 MB.');
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);

  let maxDimension = PHOTO_MAX_DIMENSION;
  let quality = PHOTO_INITIAL_QUALITY;
  let bestBlob = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to prepare this photo.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    bestBlob = await canvasToJpegBlob(canvas, quality);

    if (bestBlob.size <= PHOTO_TARGET_BYTES) {
      break;
    }

    if (quality > PHOTO_MIN_QUALITY) {
      quality = Math.max(PHOTO_MIN_QUALITY, quality - 0.08);
    } else {
      maxDimension = Math.max(PHOTO_MIN_DIMENSION, Math.round(maxDimension * 0.82));
    }
  }

  if (!bestBlob || bestBlob.size > PHOTO_TARGET_BYTES * 1.8) {
    throw new Error('This photo is still too large. Try a clearer cropped photo.');
  }

  return readFileAsDataUrl(bestBlob);
};

const getMenuWasteCategory = (menuItem, recipe) => {
  const ingredientParts = Array.isArray(recipe?.ingredients)
    ? recipe.ingredients.flatMap((ingredient) => [ingredient?.name, ingredient?.category])
    : [];
  const searchableText = [
    menuItem?.name,
    recipe?.name,
    ...ingredientParts,
  ].join(' ').toLowerCase();

  if (DRINK_MENU_TERMS.some((term) => searchableText.includes(term))) {
    return 'Drink Menu Item';
  }

  return recipe ? 'Menu Recipe' : 'Menu Item';
};

function WasteForm({
  onAddEntry,
  wasteItems,
  recipes,
  menuItems,
  staffList,
  portionProfiles,
  itemPriceCatalog,
  accessProfile,
  onSavePortionProfile,
  activeStaffId,
  onActiveStaffChange,
  onRetryEntrySync,
}) {
  const [formType, setFormType] = useState('single');
  const [menuSearch, setMenuSearch] = useState('');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('each');
  const [portionAmount, setPortionAmount] = useState('');
  const [portionUnit, setPortionUnit] = useState('g');
  const [category, setCategory] = useState('Produce');
  const [wasteClassification, setWasteClassification] = useState(DEFAULT_WASTE_CLASSIFICATION);
  const [reason, setReason] = useState('Expired');
  const [customReason, setCustomReason] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState(activeStaffId || '');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoName, setPhotoName] = useState('');
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [isSavingEntry, setIsSavingEntry] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState('');
  const [lastSavedEntryId, setLastSavedEntryId] = useState('');
  const submitInFlightRef = useRef(false);
  const submitButtonRef = useRef(null);
  const [smartSubmitVisible, setSmartSubmitVisible] = useState(false);

  const getTodayYMD = () => new Date().toISOString().split('T')[0];
  const [wasteDate, setWasteDate] = useState(getTodayYMD());

  const safeStaffList = Array.isArray(staffList) ? staffList : [];
  const safeWasteItems = useMemo(() => (Array.isArray(wasteItems) ? wasteItems : []), [wasteItems]);
  const safeMenuItems = useMemo(() => (Array.isArray(menuItems) ? menuItems : []), [menuItems]);
  const safePortionProfiles = portionProfiles && typeof portionProfiles === 'object' ? portionProfiles : {};
  const safeItemPriceCatalog = useMemo(() => sanitizeItemPriceCatalog(itemPriceCatalog), [itemPriceCatalog]);
  const [selectedRecipeKey, setSelectedRecipeKey] = useState(safeMenuItems[0]?.key || '');
  const [selectedComponentKeys, setSelectedComponentKeys] = useState([]);
  const selectedMenuItem = safeMenuItems.find((item) => item.key === selectedRecipeKey);
  const selectedRecipe = recipes[selectedRecipeKey];
  const quantityValue = parseFloat(quantity);
  const selectedRecipeFinancials = calculateMenuWasteFinancials({
    recipe: selectedRecipe,
    menuItem: selectedMenuItem,
    quantity,
    itemPriceCatalog: safeItemPriceCatalog,
    selectedComponentKeys,
  });
  const allRecipeComponents = useMemo(() => (
    buildRecipeIngredientBreakdown(selectedRecipe, quantityValue || 1, safeItemPriceCatalog)
  ), [quantityValue, safeItemPriceCatalog, selectedRecipe]);
  const recipeComponentSignature = allRecipeComponents.map((component) => component.componentKey).join('|');
  const allRecipeComponentKeys = useMemo(() => (
    recipeComponentSignature ? recipeComponentSignature.split('|') : []
  ), [recipeComponentSignature]);
  const selectedRecipeComponentCount = selectedComponentKeys.filter((key) => allRecipeComponentKeys.includes(key)).length;
  const componentSelectionIsPartial = allRecipeComponents.length > 0
    && selectedRecipeComponentCount > 0
    && selectedRecipeComponentCount < allRecipeComponents.length;
  const selectedRecipeTotal = getRecipeIngredientTotal(selectedRecipe?.ingredients, safeItemPriceCatalog);
  const selectedMenuItemPrice = getMenuSellingPrice(selectedMenuItem, selectedRecipe);
  const activeStaffMember = safeStaffList.find((member) => member.id === selectedStaffId);
  const menuSearchValue = menuSearch.trim().toLowerCase();
  const filteredMenuItems = useMemo(() => (
    menuSearchValue
      ? safeMenuItems.filter((item) => [
        item.name,
        item.key,
        recipes[item.key]?.name,
        ...(Array.isArray(recipes[item.key]?.ingredients) ? recipes[item.key].ingredients.map((ingredient) => ingredient.name) : []),
      ].some((part) => String(part || '').toLowerCase().includes(menuSearchValue)))
      : safeMenuItems
  ), [menuSearchValue, recipes, safeMenuItems]);
  const menuItemOptions = selectedMenuItem && !filteredMenuItems.some((item) => item.key === selectedMenuItem.key)
    ? [selectedMenuItem, ...filteredMenuItems]
    : filteredMenuItems;
  const activeWasteItem = formType === 'recipe'
    ? {
      key: selectedRecipeKey,
      name: selectedMenuItem?.name || recipes[selectedRecipeKey]?.name || '',
    }
    : {
      key: createWasteItemKey(name),
      name: name.trim(),
    };
  const activePortionProfile = formType === 'single' && activeWasteItem.key ? safePortionProfiles[activeWasteItem.key] : null;
  const portionAmountValue = parseFloat(portionAmount);
  const measuredAmount = formType === 'single'
    && unit === 'portion'
    && Number.isFinite(quantityValue)
    && Number.isFinite(portionAmountValue)
    && quantityValue > 0
    && portionAmountValue > 0
      ? quantityValue * portionAmountValue
      : null;
  const activeItemPriceRecord = formType === 'single' ? findItemPriceRecord(safeItemPriceCatalog, activeWasteItem.name) : null;
  const activePriceCalculation = calculateItemPriceCost({
    priceRecord: activeItemPriceRecord,
    quantity: quantityValue,
    unit,
    measuredQuantity: measuredAmount,
    measuredUnit: unit === 'portion' ? portionUnit : unit,
  });
  const canEditManualCost = Boolean(accessProfile?.canViewFinancials || accessProfile?.canManageMenu);
  const recentSingleItemProfiles = useMemo(() => {
    const seenNames = new Set();

    return [...safeWasteItems]
      .reverse()
      .filter((item) => !item?.isRecipe && item?.name)
      .filter((item) => {
        const key = String(item.name).trim().toLowerCase();

        if (!key || seenNames.has(key)) {
          return false;
        }

        seenNames.add(key);
        return true;
      })
      .slice(0, 18);
  }, [safeWasteItems]);
  const recentMenuItemProfiles = useMemo(() => {
    const seenKeys = new Set();

    return [...safeWasteItems]
      .reverse()
      .filter((item) => item?.isRecipe && (item?.recipeKey || item?.name))
      .filter((item) => {
        const key = item.recipeKey || createWasteItemKey(item.name);

        if (!key || seenKeys.has(key)) {
          return false;
        }

        seenKeys.add(key);
        return true;
      })
      .slice(0, 6);
  }, [safeWasteItems]);
  const lastEntry = safeWasteItems[safeWasteItems.length - 1];
  const itemNameOptions = Array.from(new Set([
    ...Object.values(safeItemPriceCatalog).map((item) => item.name),
    ...recentSingleItemProfiles.map((item) => item.name),
  ]));
  const normalizedName = name.trim().toLowerCase();
  const matchingProfiles = normalizedName
    ? recentSingleItemProfiles
      .filter((item) => String(item.name || '').toLowerCase().includes(normalizedName))
      .slice(0, 3)
    : recentSingleItemProfiles.slice(0, 3);
  const exactProfile = normalizedName
    ? recentSingleItemProfiles.find((item) => String(item.name || '').toLowerCase() === normalizedName)
    : null;
  const suggestedReason = exactProfile?.reason || COMMON_REASON_BY_CATEGORY[category] || 'Expired';
  const previewCost = formType === 'recipe'
    ? selectedRecipeFinancials.foodCostLost
    : parseFloat(cost);
  const previewCostLabel = Number.isFinite(previewCost)
    ? `R${previewCost.toFixed(2)}`
    : formType === 'single' && !canEditManualCost
      ? 'Needs item price'
      : 'Cost pending';
  const previewRevenueLabel = formType === 'recipe'
    ? `Revenue R${selectedRecipeFinancials.potentialRevenueLost.toFixed(2)}`
    : 'No revenue impact';
  const previewProfitLabel = formType === 'recipe' && selectedRecipeFinancials.costStatus === 'calculated'
    ? `Gross profit R${selectedRecipeFinancials.grossProfitLost.toFixed(2)}`
    : 'Gross profit pending';
  const previewQuantityLabel = formType === 'recipe'
    ? `${formatNumber(quantityValue) || '0'} finished menu item${Number(quantityValue) === 1 ? '' : 's'}`
    : unit === 'portion'
    ? measuredAmount
      ? `${formatNumber(quantityValue)} portions = ${formatNumber(measuredAmount)} ${portionUnit}`
      : 'Portion size pending'
    : formatSimpleQuantityLabel(quantityValue, unit);
  const componentPreviewLabel = formType === 'recipe' && allRecipeComponents.length > 0
    ? componentSelectionIsPartial
      ? `${selectedRecipeComponentCount} of ${allRecipeComponents.length} components`
      : 'Full item'
    : '';
  const submitIsDisabled = isSavingEntry || isProcessingPhoto || (formType === 'recipe' && safeMenuItems.length === 0);
  const smartSubmitCanShow = smartSubmitVisible && Boolean(activeWasteItem.name) && !submitIsDisabled;
  const quickReasonOptions = useMemo(() => (
    Array.from(new Set([
      suggestedReason,
      'Expired',
      'Spoiled',
      'Overproduction',
      'Dropped',
      'Quality issue',
    ].filter(Boolean))).slice(0, 5)
  ), [suggestedReason]);
  const draftFields = useMemo(() => ({
    formType,
    menuSearch,
    name,
    quantity,
    unit,
    portionAmount,
    portionUnit,
    category,
    wasteClassification,
    reason,
    customReason,
    selectedStaffId,
    cost,
    notes,
    wasteDate,
    selectedRecipeKey,
    selectedComponentKeys,
  }), [category, cost, customReason, formType, menuSearch, name, notes, portionAmount, portionUnit, quantity, reason, selectedComponentKeys, selectedRecipeKey, selectedStaffId, unit, wasteClassification, wasteDate]);

  const clearFormAfterSave = () => {
    setName('');
    setQuantity('1');
    setUnit(formType === 'recipe' ? 'portion' : 'each');
    if (formType === 'single') {
      setPortionAmount('');
      setPortionUnit('g');
      setCost('');
    } else {
      setSelectedComponentKeys(allRecipeComponentKeys);
    }
    setReason('Expired');
    setCustomReason('');
    setNotes('');
    setWasteDate(getTodayYMD());
    setPhotoPreview('');
    setPhotoName('');
    deleteWasteFormDraft().catch(() => {});
    setDraftSavedAt('');
  };

  const applyDraftFields = useCallback((fields) => {
    setFormType(fields.formType || 'single');
    setMenuSearch(fields.menuSearch || '');
    setName(fields.name || '');
    setQuantity(fields.quantity || '1');
    setUnit(fields.unit || 'each');
    setPortionAmount(fields.portionAmount || '');
    setPortionUnit(fields.portionUnit || 'g');
    setCategory(fields.category || 'Produce');
    setWasteClassification(fields.wasteClassification || DEFAULT_WASTE_CLASSIFICATION);
    setReason(fields.reason || 'Expired');
    setCustomReason(fields.customReason || '');
    setSelectedStaffId(fields.selectedStaffId || activeStaffId || '');
    setCost(fields.cost || '');
    setNotes(fields.notes || '');
    setWasteDate(fields.wasteDate || getTodayYMD());
    setSelectedRecipeKey(fields.selectedRecipeKey || safeMenuItems[0]?.key || '');
    setSelectedComponentKeys(Array.isArray(fields.selectedComponentKeys) ? fields.selectedComponentKeys : []);
  }, [activeStaffId, safeMenuItems]);

  const applyProfile = (profile) => {
    if (!profile) return;

    setName(profile.name || '');
    setCategory(profile.category || 'Produce');
    setQuantity(String(profile.quantity || '1'));
    setUnit(profile.unit || 'each');
    setCost(Number(profile.cost) > 0 ? Number(profile.cost).toFixed(2) : '');
    setWasteClassification(profile.wasteClassification || DEFAULT_WASTE_CLASSIFICATION);

    if (profile.unit === 'portion') {
      setPortionAmount(profile.portionSize ? String(profile.portionSize) : '');
      setPortionUnit(profile.portionSizeUnit || 'g');
    }

    if (WASTE_REASONS.includes(profile.reason)) {
      setReason(profile.reason);
      setCustomReason('');
    } else if (profile.reason) {
      setReason('Other');
      setCustomReason(profile.reason);
    }

    setFormMessage(`Loaded recent values for ${profile.name}.`);
  };

  const selectAllRecipeComponents = () => {
    setSelectedComponentKeys(allRecipeComponentKeys);
  };

  const toggleRecipeComponent = (componentKey) => {
    setSelectedComponentKeys((currentKeys) => {
      const safeCurrentKeys = currentKeys.filter((key) => allRecipeComponentKeys.includes(key));

      if (safeCurrentKeys.includes(componentKey)) {
        if (safeCurrentKeys.length <= 1) {
          return safeCurrentKeys;
        }

        return safeCurrentKeys.filter((key) => key !== componentKey);
      }

      return [...safeCurrentKeys, componentKey];
    });
  };

  useEffect(() => {
    const selectedMenuItemExists = safeMenuItems.some((item) => item.key === selectedRecipeKey);

    if (safeMenuItems.length > 0 && (!selectedRecipeKey || !selectedMenuItemExists)) {
      setSelectedRecipeKey(safeMenuItems[0].key);
    }
  }, [safeMenuItems, selectedRecipeKey]);

  useEffect(() => {
    if (formType !== 'recipe' || !menuSearchValue || filteredMenuItems.length === 0) {
      return;
    }

    const selectedItemIsVisible = filteredMenuItems.some((item) => item.key === selectedRecipeKey);

    if (!selectedItemIsVisible) {
      setSelectedRecipeKey(filteredMenuItems[0].key);
    }
  }, [filteredMenuItems, formType, menuSearchValue, selectedRecipeKey]);

  useEffect(() => {
    if (formType !== 'recipe') {
      return;
    }

    setSelectedComponentKeys(allRecipeComponentKeys);
  }, [allRecipeComponentKeys, formType, recipeComponentSignature, selectedRecipeKey]);

  useEffect(() => {
    if (activeStaffId && activeStaffId !== selectedStaffId) {
      setSelectedStaffId(activeStaffId);
    }
  }, [activeStaffId, selectedStaffId]);

  useEffect(() => {
    const submitButton = submitButtonRef.current;

    if (!submitButton || typeof IntersectionObserver === 'undefined') {
      setSmartSubmitVisible(false);
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setSmartSubmitVisible(!entry?.isIntersecting);
    }, {
      root: null,
      threshold: 0.45,
      rootMargin: '0px 0px -96px 0px',
    });

    observer.observe(submitButton);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let isCancelled = false;

    loadWasteFormDraft()
      .then((draft) => {
        if (isCancelled) {
          return;
        }

        if (draft?.fields && wasteDraftHasContent(draft)) {
          applyDraftFields(draft.fields);
          setDraftSavedAt(draft.savedAt || '');
          setFormMessage('Draft restored. Finish it or discard it.');
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!isCancelled) {
          setDraftLoaded(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [applyDraftFields]);

  useEffect(() => {
    if (!draftLoaded || isSavingEntry) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      if (!wasteDraftHasContent(draftFields)) {
        deleteWasteFormDraft().catch(() => {});
        setDraftSavedAt('');
        return;
      }

      saveWasteFormDraft(draftFields)
        .then(() => setDraftSavedAt(new Date().toISOString()))
        .catch(() => {});
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [draftFields, draftLoaded, isSavingEntry]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!wasteDraftHasContent(draftFields)) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [draftFields]);

  useEffect(() => {
    if (formType !== 'single' || unit !== 'portion') {
      return;
    }

    if (activePortionProfile) {
      setPortionAmount(String(activePortionProfile.amount));
      setPortionUnit(activePortionProfile.unit);
      return;
    }

    setPortionAmount('');
    setPortionUnit('g');
  }, [formType, unit, activeWasteItem.key, activePortionProfile]);

  useEffect(() => {
    if (formType !== 'recipe') {
      return;
    }

    setCost(selectedRecipeFinancials.foodCostLost.toFixed(2));
  }, [formType, selectedRecipeFinancials.foodCostLost]);

  useEffect(() => {
    if (formType !== 'single') {
      return;
    }

    if (activeItemPriceRecord?.category) {
      setCategory(activeItemPriceRecord.category);
    }

    if (activePriceCalculation.canCalculate) {
      setCost(activePriceCalculation.cost.toFixed(2));
      return;
    }

    if (!canEditManualCost) {
      setCost('');
    }
  }, [activeItemPriceRecord, activePriceCalculation.canCalculate, activePriceCalculation.cost, canEditManualCost, formType]);

  const handleFormTypeChange = (nextFormType) => {
    setFormType(nextFormType);
    setUnit(nextFormType === 'recipe' ? 'portion' : 'each');
    setQuantity('1');
    setPortionAmount('');
    setPortionUnit('g');
    setFormMessage('');

    if (nextFormType === 'single') {
      setCost('');
    }
  };

  const getTodayDateParts = () => getRestaurantDateTimeParts();

  const handleStaffChange = (staffId) => {
    setSelectedStaffId(staffId);
    onActiveStaffChange?.(staffId);
  };

  const handleDiscardDraft = async () => {
    clearFormAfterSave();
    await deleteWasteFormDraft().catch(() => {});
    setFormMessage('Draft discarded.');
  };

  const handleRetryLastSync = async () => {
    if (!lastSavedEntryId || !onRetryEntrySync) {
      return;
    }

    setIsSavingEntry(true);
    setFormMessage('Retrying sync...');

    try {
      const result = await onRetryEntrySync(lastSavedEntryId);
      setFormMessage(result?.ok ? 'Entry synced.' : result?.message || 'Entry still needs sync.');
    } finally {
      setIsSavingEntry(false);
    }
  };

  const handleRepeatLastEntry = async () => {
    if (!lastEntry) {
      return;
    }

    if (submitInFlightRef.current) {
      return;
    }

    const { now, formattedDate, time } = getTodayDateParts();
    const repeatedStaff = activeStaffMember
      ? {
        staffId: activeStaffMember.id,
        staff: activeStaffMember.name,
        staffRole: activeStaffMember.role,
        department: activeStaffMember.staffSection,
        createdBy: activeStaffMember.name,
        lastEditedBy: activeStaffMember.name,
      }
      : {};
    const repeatedEntry = {
      ...lastEntry,
      ...repeatedStaff,
      id: createRecordId('waste'),
      date: formattedDate,
      time,
      createdAt: now.toISOString(),
      status: 'logged',
      syncStatus: 'pending',
      repeatedFromId: lastEntry.id,
      notes: '',
      photoUrl: '',
      photoName: '',
      photoCapturedAt: '',
    };

    submitInFlightRef.current = true;
    setIsSavingEntry(true);
    setFormMessage('Saving repeated entry...');

    try {
      const result = await onAddEntry(repeatedEntry);
      setLastSavedEntryId(repeatedEntry.id);
      setFormMessage(
        result?.syncStatus === 'failed'
          ? `Repeated ${lastEntry.name}. Saved locally, sync needs retry.`
          : result?.syncStatus === 'pending'
            ? `Repeated ${lastEntry.name}. It will sync when online.`
            : `Repeated ${lastEntry.name} for R${getEntryFoodCostLost(repeatedEntry).toFixed(2)}.`
      );
    } finally {
      submitInFlightRef.current = false;
      setIsSavingEntry(false);
    }
  };

  const handlePhotoChange = async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsProcessingPhoto(true);
    setFormMessage('');

    try {
      const compressedPhoto = await compressWastePhoto(file);
      setPhotoPreview(compressedPhoto);
      setPhotoName(file.name);
    } catch (error) {
      setPhotoPreview('');
      setPhotoName('');
      setFormMessage(error.message || 'Unable to attach this photo.');
    } finally {
      setIsProcessingPhoto(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (submitInFlightRef.current || isSavingEntry) {
      return;
    }

    if (isProcessingPhoto) {
      setFormMessage('Wait a moment while WasteShift prepares the photo, then save again.');
      return;
    }

    if (formType === 'single' && !name.trim()) {
      setFormMessage('Enter the ingredient or stock item before saving.');
      return;
    }

    if (formType === 'single' && cost === '' && canEditManualCost) {
      setFormMessage('Add an item price in Settings or enter the total cost loss.');
      return;
    }

    if (formType === 'recipe' && !selectedRecipeKey) {
      setFormMessage('Choose a menu item before saving.');
      return;
    }

    if (formType === 'recipe' && allRecipeComponents.length > 0 && selectedRecipeComponentCount === 0) {
      setFormMessage('Choose at least one wasted component.');
      return;
    }

    const qtyMultiplier = parseFloat(quantity);
    if (!Number.isFinite(qtyMultiplier) || qtyMultiplier <= 0) {
      setFormMessage('Enter a quantity greater than zero.');
      return;
    }

    let measuredQuantity = qtyMultiplier;
    let measuredUnit = unit;
    let portionSize = null;
    let portionSizeUnit = '';

    if (formType === 'recipe') {
      measuredQuantity = qtyMultiplier;
      measuredUnit = 'portion';
    } else if (unit === 'portion') {
      if (!activeWasteItem.key || !activeWasteItem.name) {
        setFormMessage('Choose or enter the wasted item before saving a portion size.');
        return;
      }

      if (!Number.isFinite(portionAmountValue) || portionAmountValue <= 0) {
        setFormMessage('Enter what one portion equals.');
        return;
      }

      portionSize = portionAmountValue;
      portionSizeUnit = portionUnit;
      measuredQuantity = qtyMultiplier * portionAmountValue;
      measuredUnit = portionUnit;
    }

    const selectedStaffMember = safeStaffList.find((member) => member.id === selectedStaffId);

    if (!selectedStaffMember) {
      setFormMessage('Choose who is logging waste for this shift.');
      return;
    }

    const actualReason = reason === 'Other' ? customReason.trim() : reason;
    if (reason === 'Other' && !actualReason) {
      setFormMessage('Provide a custom reason.');
      return;
    }

    const [y, m, d] = wasteDate.split('-');
    const now = new Date();
    const formattedDate = `${d}/${m}/${y}`;
    const entryTime = now.toTimeString().slice(0, 5);

    let finalEntry = {
      id: createRecordId('waste'),
      reason: actualReason,
      notes: notes.trim(),
      wasteClassification,
      wasteClassificationLabel: getWasteClassificationMeta(wasteClassification).label,
      staffId: selectedStaffMember.id,
      staff: selectedStaffMember.name,
      staffRole: selectedStaffMember.role,
      department: selectedStaffMember.staffSection,
      date: formattedDate,
      time: entryTime,
      createdAt: now.toISOString(),
      createdBy: selectedStaffMember.name,
      lastEditedBy: selectedStaffMember.name,
      status: 'logged',
      syncStatus: 'pending',
      photoUrl: photoPreview,
      photoName,
      photoCapturedAt: photoPreview ? now.toISOString() : '',
    };

    if (formType === 'single') {
      const costStatus = activePriceCalculation.canCalculate
        ? 'catalog'
        : cost === ''
          ? 'needs_item_price'
          : 'manual';
      const foodCostLost = costStatus === 'needs_item_price' ? 0 : roundCurrency(parseFloat(cost) || 0);

      finalEntry = {
        ...finalEntry,
        name,
        quantity,
        unit,
        measuredQuantity,
        measuredUnit,
        portionSize,
        portionSizeUnit,
        category,
        itemType: 'ingredient',
        cost: foodCostLost,
        foodCostLost,
        sellingPrice: null,
        potentialRevenueLost: 0,
        grossProfitLost: 0,
        foodCostPercentage: null,
        costStatus,
        priceCatalogKey: activeItemPriceRecord?.key || '',
        pricePerUnit: activeItemPriceRecord?.price ?? null,
        priceUnit: activeItemPriceRecord?.unit || '',
        isRecipe: false,
        ingredients: [],
      };
    } else {
      const activeRecipe = recipes[selectedRecipeKey];
      const activeMenuItem = safeMenuItems.find((item) => item.key === selectedRecipeKey);
      const financials = calculateMenuWasteFinancials({
        recipe: activeRecipe,
        menuItem: activeMenuItem,
        quantity: qtyMultiplier,
        itemPriceCatalog: safeItemPriceCatalog,
        selectedComponentKeys,
      });

      finalEntry = {
        ...finalEntry,
        name: activeMenuItem?.name || activeRecipe?.name || selectedRecipeKey,
        quantity,
        unit: 'portion',
        measuredQuantity,
        measuredUnit,
        portionSize,
        portionSizeUnit,
        category: getMenuWasteCategory(activeMenuItem, activeRecipe),
        itemType: 'menuItem',
        cost: financials.foodCostLost,
        foodCostLost: financials.foodCostLost,
        sellingPrice: financials.sellingPrice,
        potentialRevenueLost: financials.potentialRevenueLost,
        grossProfitLost: financials.grossProfitLost,
        foodCostPercentage: financials.foodCostPercentage,
        costStatus: financials.costStatus,
        isRecipe: Boolean(activeRecipe),
        recipeKey: selectedRecipeKey,
        ingredients: financials.ingredients,
        partialWaste: financials.partialWaste,
        allComponentsSelected: financials.allComponentsSelected,
        totalComponentCount: financials.allComponents.length,
        wastedComponentCount: financials.selectedComponents.length,
        totalMenuItemCost: financials.fullFoodCostLost,
        selectedComponentKeys: financials.selectedComponents.map((component) => component.key),
        wastedComponents: financials.selectedComponents,
        componentsWasted: financials.selectedComponents.map((component) => component.name),
      };
    }

    submitInFlightRef.current = true;
    setIsSavingEntry(true);
    setFormMessage('Saving waste entry...');

    let saveResult = null;

    try {
      saveResult = await onAddEntry(finalEntry);
    } finally {
      submitInFlightRef.current = false;
      setIsSavingEntry(false);
    }

    if (saveResult && saveResult.ok === false) {
      setFormMessage(saveResult.message || 'Could not save this waste entry.');
      return;
    }

    setLastSavedEntryId(finalEntry.id);
    setFormMessage(
      saveResult?.syncStatus === 'failed'
        ? `Logged ${finalEntry.name} locally. Sync failed, use retry.`
        : saveResult?.syncStatus === 'pending'
          ? `Logged ${finalEntry.name}. It will sync when online.`
          : finalEntry.costStatus === 'needs_item_price'
            ? `Logged ${finalEntry.name}. Management needs to add an item price.`
            : `Logged ${finalEntry.name} for R${(Number(finalEntry.cost) || 0).toFixed(2)}.`
    );
    if (formType === 'single' && unit === 'portion') {
      onSavePortionProfile?.({
        key: activeWasteItem.key,
        name: activeWasteItem.name,
        amount: portionSize,
        unit: portionSizeUnit,
      });
    }
    clearFormAfterSave();
  };

  return (
    <form onSubmit={handleSubmit} className="panel form-panel">
      <div className="panel-body">
        <div className="section-header">
          <div>
            <p className="eyebrow">Waste entry</p>
            <h2 className="title">Log Waste</h2>
            <p className="subtitle">Capture raw stock waste or finished menu items.</p>
          </div>
          <div className="manager-row">
            {draftSavedAt && <span className="badge">Draft saved</span>}
            <button type="button" className="ghost-button compact-action" onClick={handleDiscardDraft}>
              Clear form
            </button>
          </div>
        </div>

        <div className="segmented-control" aria-label="Waste entry type" style={{ marginBottom: '16px' }}>
          <button
            type="button"
            onClick={() => handleFormTypeChange('single')}
            className={`segment-button${formType === 'single' ? ' is-active' : ''}`}
          >
            Ingredient / stock
          </button>
          <button
            type="button"
            onClick={() => handleFormTypeChange('recipe')}
            className={`segment-button${formType === 'recipe' ? ' is-active' : ''}`}
          >
            Menu item / drink
          </button>
        </div>

        <div className="smart-panel shift-panel">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="shift-staff">Logging as</label>
            {safeStaffList.length === 0 ? (
              <div className="muted-box" style={{ marginBottom: 0 }}>
                <p className="small-text" style={{ margin: 0 }}>Add staff members in Settings before logging waste.</p>
              </div>
            ) : (
              <select
                id="shift-staff"
                value={selectedStaffId}
                onChange={(e) => handleStaffChange(e.target.value)}
                className="select"
              >
                <option value="">Choose staff member</option>
                {safeStaffList.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} - {member.role}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button type="button" onClick={handleRepeatLastEntry} className="ghost-button is-warning" disabled={!lastEntry}>
            Repeat last
          </button>
        </div>

        {formType === 'single' ? (
          <>
            <div className="field">
              <label htmlFor="food-name">Ingredient or stock item</label>
              <input
                id="food-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Tomato, cheddar block, coffee beans"
                list="known-waste-items"
                className="input"
              />
              {itemNameOptions.length > 0 && (
                <datalist id="known-waste-items">
                  {itemNameOptions.map((itemName) => (
                    <option key={itemName} value={itemName} />
                  ))}
                </datalist>
              )}
            </div>

            <div className="field">
              <label htmlFor="food-category">Category</label>
              <select id="food-category" value={category} onChange={(e) => setCategory(e.target.value)} className="select">
                {WASTE_CATEGORY_OPTIONS.map((categoryOption) => (
                  <option key={categoryOption.value} value={categoryOption.value}>
                    {categoryOption.label}
                  </option>
                ))}
              </select>
            </div>

            {matchingProfiles.length > 0 && (
              <div className="smart-panel">
                <div className="smart-panel__header">
                  <span className="breakdown-title">Recent matches</span>
                  <span className="badge">{matchingProfiles.length}</span>
                </div>
                <div className="suggestion-row">
                  {matchingProfiles.map((profile) => (
                    <button
                      key={`${profile.id}-${profile.name}`}
                      type="button"
                      onClick={() => applyProfile(profile)}
                      className="suggestion-button"
                    >
                      <span>{profile.name}</span>
                      <strong>R{(Number(profile.cost) || 0).toFixed(2)}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="menu-search">Search menu item or drink</label>
              <input
                id="menu-search"
                type="search"
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                placeholder="e.g. latte, smoothie, burger"
                className="input"
              />
            </div>

            {menuSearchValue && (
              <div className="search-status" role="status">
                <span>
                  <strong>{filteredMenuItems.length}</strong> match{filteredMenuItems.length === 1 ? '' : 'es'} for <strong>{menuSearch.trim()}</strong>
                </span>
                {filteredMenuItems[0] && <span>Top result: {filteredMenuItems[0].name}</span>}
              </div>
            )}

            <div className="field">
              <label htmlFor="menu-item">Menu item / drink</label>
              {safeMenuItems.length === 0 ? (
                <div className="muted-box">No menu items found.</div>
              ) : menuItemOptions.length === 0 ? (
                <div className="muted-box">No menu items match "{menuSearch.trim()}".</div>
              ) : (
                <select id="menu-item" value={selectedRecipeKey} onChange={(e) => setSelectedRecipeKey(e.target.value)} className="select">
                  {menuItemOptions.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.name}{item.menuPrice !== null ? ` - R${item.menuPrice.toFixed(2)}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {recentMenuItemProfiles.length > 0 && (
              <div className="smart-panel">
                <div className="smart-panel__header">
                  <span className="breakdown-title">Recent menu items</span>
                  <span className="badge">{recentMenuItemProfiles.length}</span>
                </div>
                <div className="suggestion-row">
                  {recentMenuItemProfiles.map((profile) => (
                    <button
                      key={`${profile.id}-${profile.recipeKey || profile.name}`}
                      type="button"
                      onClick={() => setSelectedRecipeKey(profile.recipeKey || createWasteItemKey(profile.name))}
                      className="suggestion-button"
                    >
                      <span>{profile.name}</span>
                      <strong>R{getEntryFoodCostLost(profile).toFixed(2)}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="field">
          <span className="field-label">Waste type</span>
          <div className="segmented-control" aria-label="Waste type">
            {WASTE_CLASSIFICATION_OPTIONS.map((classificationOption) => (
              <button
                key={classificationOption.value}
                type="button"
                onClick={() => setWasteClassification(classificationOption.value)}
                className={`segment-button${wasteClassification === classificationOption.value ? ' is-active' : ''}`}
              >
                {classificationOption.shortLabel}
              </button>
            ))}
          </div>
        </div>

        {formType === 'recipe' && selectedRecipe && (
          <div className="smart-panel">
            <div className="smart-panel__header">
              <span className="breakdown-title">Wasted components</span>
              <span className="badge">
                {allRecipeComponents.length > 0
                  ? `${selectedRecipeComponentCount || allRecipeComponents.length}/${allRecipeComponents.length} selected`
                  : 'No components'}
              </span>
            </div>
            <div className="import-summary-grid" style={{ marginBottom: '12px' }}>
              <span className="badge">Food cost R{selectedRecipeFinancials.foodCostLost.toFixed(2)}</span>
              {componentSelectionIsPartial && (
                <span className="badge is-green">Partial waste</span>
              )}
              {selectedRecipeFinancials.fullFoodCostLost > selectedRecipeFinancials.foodCostLost && (
                <span className="badge">Full item R{selectedRecipeFinancials.fullFoodCostLost.toFixed(2)}</span>
              )}
              <span className={selectedMenuItemPrice > 0 ? 'badge is-green' : 'badge'}>Revenue R{selectedRecipeFinancials.potentialRevenueLost.toFixed(2)}</span>
              <span className={selectedRecipeFinancials.costStatus === 'calculated' ? 'badge is-green' : 'badge is-red'}>
                {selectedRecipeFinancials.costStatus === 'calculated'
                  ? `Gross R${selectedRecipeFinancials.grossProfitLost.toFixed(2)}`
                  : 'Add ingredient costs'}
              </span>
              {selectedRecipeFinancials.foodCostPercentage !== null && (
                <span className="badge">{selectedRecipeFinancials.foodCostPercentage.toFixed(1)}% food cost</span>
              )}
            </div>

            {allRecipeComponents.length > 0 ? (
              <div className="component-checklist" aria-label="Recipe components">
                <div className="component-checklist__actions">
                  <span className="small-text">Select only the parts that were wasted.</span>
                  <button type="button" onClick={selectAllRecipeComponents} className="ghost-button compact-action">
                    Select all
                  </button>
                </div>
                {allRecipeComponents.map((component) => {
                  const isSelected = selectedComponentKeys.includes(component.componentKey);
                  const cannotUncheck = isSelected && selectedRecipeComponentCount <= 1;

                  return (
                    <label key={component.componentKey} className={`component-option${isSelected ? ' is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRecipeComponent(component.componentKey)}
                        disabled={cannotUncheck}
                      />
                      <span>
                        <strong>{component.name}</strong>
                        <small>{component.quantity || '1 each'}{component.category ? ` - ${component.category}` : ''}</small>
                      </span>
                      <span className="price">R{(Number(component.cost) || 0).toFixed(2)}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="muted-box">
                <p className="small-text" style={{ margin: 0 }}>No component breakdown linked.</p>
              </div>
            )}
          </div>
        )}

        <div className={`field-grid${formType === 'single' ? ' field-grid--three' : ''}`}>
          <div className="field">
            <label htmlFor="quantity">{formType === 'recipe' ? 'Items wasted' : 'Quantity'}</label>
            <input
              id="quantity"
              type="number"
              min="0.01"
              step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input"
            />
            <div className="suggestion-row suggestion-row--compact">
              {['1', '2', '3'].map((quickQuantity) => (
                <button
                  key={quickQuantity}
                  type="button"
                  onClick={() => setQuantity(quickQuantity)}
                  className={`pill-button${quantity === quickQuantity ? ' is-active' : ''}`}
                >
                  {quickQuantity}
                </button>
              ))}
            </div>
          </div>

          {formType === 'single' && (
            <div className="field">
              <label htmlFor="quantity-unit">Unit</label>
              <select id="quantity-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="select">
                {WASTE_UNITS.map((unitOption) => (
                  <option key={unitOption.value} value={unitOption.value}>
                    {unitOption.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label htmlFor="cost-loss">{formType === 'recipe' ? 'Food cost lost' : 'Total cost loss'}</label>
            <input
              id="cost-loss"
              type="number"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              disabled={formType === 'recipe' || (formType === 'single' && (!canEditManualCost || activePriceCalculation.canCalculate))}
              placeholder="R total"
              className="input"
            />
            {formType === 'single' && (
              <span className="small-text">
                {activePriceCalculation.canCalculate
                  ? `Auto from ${activeItemPriceRecord.name}: R${Number(activeItemPriceRecord.price).toFixed(2)} per ${activeItemPriceRecord.unit}.`
                  : activeItemPriceRecord
                    ? `Price saved for ${activeItemPriceRecord.unit}, but this unit cannot be converted.`
                    : canEditManualCost
                      ? 'Add this item in Settings > Ingredients for staff auto-costing.'
                      : 'Management needs to add this item price.'}
              </span>
            )}
          </div>
        </div>

        {formType === 'single' && unit === 'portion' && (
          <div className="budget-panel portion-panel">
            <h3 className="breakdown-title">Portion size</h3>
            <div className="field-grid">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="portion-amount">1 portion equals</label>
                <input
                  id="portion-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={portionAmount}
                  onChange={(e) => setPortionAmount(e.target.value)}
                  placeholder="150"
                  className="input"
                />
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="portion-unit">Measured unit</label>
                <select id="portion-unit" value={portionUnit} onChange={(e) => setPortionUnit(e.target.value)} className="select">
                  {PORTION_SIZE_UNITS.map((unitOption) => (
                    <option key={unitOption.value} value={unitOption.value}>
                      {unitOption.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="budget-row" style={{ marginTop: '12px' }}>
              <span className="small-text">
                {activePortionProfile ? `Remembered for ${activePortionProfile.name}` : 'New portion size'}
              </span>
              <span className="badge is-green">
                {measuredAmount ? `${formatNumber(quantityValue)} portions = ${formatNumber(measuredAmount)} ${portionUnit}` : 'Enter size'}
              </span>
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="waste-date">Date of waste</label>
          <input
            id="waste-date"
            type="date"
            value={wasteDate}
            onChange={(e) => setWasteDate(e.target.value)}
            max={getTodayYMD()}
            className="input"
          />
        </div>

        <div className="field">
          <label htmlFor="waste-reason">Reason for waste</label>
          <div className="filter-row" style={{ marginBottom: 10 }}>
            {quickReasonOptions.map((quickReason) => (
              <button
                key={quickReason}
                type="button"
                onClick={() => {
                  setReason(quickReason);
                  setCustomReason('');
                }}
                className={`pill-button${reason === quickReason ? ' is-active' : ''}`}
              >
                {quickReason}
              </button>
            ))}
          </div>
          <select id="waste-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="select">
            {WASTE_REASONS.map((reasonOption) => (
              <option key={reasonOption} value={reasonOption}>
                {reasonOption}
              </option>
            ))}
          </select>
          {suggestedReason && suggestedReason !== reason && (
            <button
              type="button"
              onClick={() => {
                setReason(suggestedReason);
                setCustomReason('');
              }}
              className="ghost-button compact-action"
            >
              Use {suggestedReason}
            </button>
          )}
          {reason === 'Other' && (
            <input
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Type the custom reason"
              className="input"
              style={{ marginTop: '10px' }}
            />
          )}
        </div>

        <div className="field">
          <label htmlFor="waste-notes">Notes</label>
          <textarea
            id="waste-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={180}
            placeholder="e.g. dropped during prep, customer returned, machine purge"
            className="input note-textarea"
          />
          <span className="small-text">{notes.length}/180</span>
        </div>

        <div className="field">
          <span className="field-label">Waste photo</span>
          <div className="photo-upload">
            {photoPreview ? (
              <img src={photoPreview} alt="Waste preview" className="photo-upload__image" />
            ) : (
              <div className="photo-upload__placeholder">
                <span>Add photo</span>
              </div>
            )}
            <div className="photo-upload__controls">
              <label className="ghost-button photo-upload__button" htmlFor="waste-photo">
                {photoPreview ? 'Change photo' : 'Add photo'}
              </label>
              <input
                id="waste-photo"
                type="file"
                accept="image/*"
                capture="environment"
                onClick={(event) => {
                  event.currentTarget.value = '';
                }}
                onChange={handlePhotoChange}
                className="visually-hidden"
              />
              {photoPreview && (
                <button
                  type="button"
                  onClick={() => {
                    setPhotoPreview('');
                    setPhotoName('');
                  }}
                  className="ghost-button"
                >
                  Remove
                </button>
              )}
              <span className="small-text">
                {isProcessingPhoto ? 'Preparing photo...' : photoName || 'Optional evidence for this entry'}
              </span>
            </div>
          </div>
        </div>

        <div className="entry-preview">
          <div className="budget-row">
            <span className="small-text">{activeWasteItem.name || 'Entry preview'}</span>
            <span className={Number.isFinite(previewCost) ? 'price' : 'badge'}>
              {previewCostLabel}
            </span>
          </div>
          <div className="import-summary-grid">
            <span className="badge">{previewRevenueLabel}</span>
            {formType === 'recipe' && <span className="badge">{previewProfitLabel}</span>}
            {componentPreviewLabel && <span className="badge">{componentPreviewLabel}</span>}
            {formType === 'recipe' && selectedRecipeTotal > 0 && (
              <span className="badge">Base cost R{selectedRecipeTotal.toFixed(2)}</span>
            )}
          </div>
          <div className="small-text">
            {previewQuantityLabel}
            {formType === 'recipe' && selectedRecipeFinancials.costStatus !== 'calculated' ? ' - add ingredient costs in Settings or via invoice import' : ''}
          </div>
        </div>

        <button
          ref={submitButtonRef}
          type="submit"
          disabled={submitIsDisabled}
          className="primary-button"
        >
          {isSavingEntry ? 'Saving...' : isProcessingPhoto ? 'Preparing photo...' : 'Log waste'}
        </button>

        {smartSubmitCanShow && (
          <div className="smart-submit-rail" role="status" aria-label="Waste entry quick submit">
            <button type="submit" className="smart-submit-button">
              <span>
                <strong>{previewCostLabel}</strong>
                <small>{activeWasteItem.name}</small>
              </span>
              <span>Log</span>
            </button>
          </div>
        )}

        {formMessage && (
          <div className="inline-message" role="status">
            {formMessage}
            {lastSavedEntryId && /sync/i.test(formMessage) && (
              <button type="button" className="ghost-button compact-action" onClick={handleRetryLastSync} disabled={isSavingEntry}>
                Retry sync
              </button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

export default WasteForm;
