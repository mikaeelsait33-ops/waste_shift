import { useEffect, useMemo, useState } from 'react';
import MenuImportPanel from './MenuImportPanel';
import { createRecordId } from '../utils/ids';
import { createMenuItemKey, parseMenuPrice } from '../utils/menuImport';
import { createRandomPin, validatePin } from '../utils/pinAuth';
import { STAFF_SECTIONS } from '../utils/staffSections';

const SETUP_PROGRESS_KEY = 'wasteShiftSetupProgress';

const createInitialProgress = () => ({
  stepIndex: 0,
  restaurantName: '',
  branchName: '',
  currency: 'ZAR',
  timezone: 'Africa/Johannesburg',
  managerName: '',
  managerPin: '',
  confirmManagerPin: '',
  budget: '',
  dailyWasteValueLimit: '',
  dailyWasteEntryLimit: '',
  staffMembers: [],
  menuItems: [],
});

const STEPS = [
  'Welcome',
  'Restaurant',
  'Manager',
  'Settings',
  'Staff',
  'Menu',
  'Review',
];

const loadSavedProgress = () => {
  try {
    const savedProgress = localStorage.getItem(SETUP_PROGRESS_KEY);
    return savedProgress ? { ...createInitialProgress(), ...JSON.parse(savedProgress) } : createInitialProgress();
  } catch {
    return createInitialProgress();
  }
};

const createBlankStaffDraft = () => ({
  name: '',
  role: '',
  staffSection: 'kitchen',
  code: createRandomPin(6),
  active: true,
});

const createBlankMenuDraft = () => ({
  name: '',
  category: '',
  sellingPrice: '',
});

function SetupWizard({
  firestoreConfigured,
  firebaseSync,
  onFinishSetup,
}) {
  const [progress, setProgress] = useState(loadSavedProgress);
  const [staffDraft, setStaffDraft] = useState(createBlankStaffDraft);
  const [menuDraft, setMenuDraft] = useState(createBlankMenuDraft);
  const [message, setMessage] = useState('');
  const [isFinishing, setIsFinishing] = useState(false);
  const stepIndex = Math.max(0, Math.min(STEPS.length - 1, Number(progress.stepIndex) || 0));
  const currentStep = STEPS[stepIndex];
  const completionPercent = Math.round(((stepIndex + 1) / STEPS.length) * 100);

  useEffect(() => {
    localStorage.setItem(SETUP_PROGRESS_KEY, JSON.stringify({ ...progress, stepIndex }));
  }, [progress, stepIndex]);

  const existingMenuItems = useMemo(() => progress.menuItems.map((item) => ({
    key: item.key || createMenuItemKey(item.name),
    name: item.name,
  })), [progress.menuItems]);

  const updateProgress = (updates) => {
    setProgress((currentProgress) => ({ ...currentProgress, ...updates }));
  };

  const validateCurrentStep = () => {
    if (currentStep === 'Restaurant' && !progress.restaurantName.trim()) {
      return 'Enter the restaurant name.';
    }

    if (currentStep === 'Manager') {
      if (!progress.managerName.trim()) {
        return 'Enter the manager/admin name.';
      }

      const pinError = validatePin(progress.managerPin);

      if (pinError) {
        return pinError;
      }

      if (progress.managerPin !== progress.confirmManagerPin) {
        return 'Manager PINs do not match.';
      }
    }

    return '';
  };

  const goNext = () => {
    const validationError = validateCurrentStep();

    if (validationError) {
      setMessage(validationError);
      return;
    }

    setMessage('');
    updateProgress({ stepIndex: Math.min(STEPS.length - 1, stepIndex + 1) });
  };

  const goBack = () => {
    setMessage('');
    updateProgress({ stepIndex: Math.max(0, stepIndex - 1) });
  };

  const addStaffDraft = () => {
    const trimmedName = staffDraft.name.trim();
    const duplicate = progress.staffMembers.some((member) => (
      member.name.trim().toLowerCase() === trimmedName.toLowerCase()
    ));
    const codeError = validatePin(staffDraft.code);

    if (!trimmedName) {
      setMessage('Enter the staff member name.');
      return;
    }

    if (duplicate) {
      setMessage('That staff member is already in the setup list.');
      return;
    }

    if (codeError) {
      setMessage(codeError);
      return;
    }

    updateProgress({
      staffMembers: [
        ...progress.staffMembers,
        {
          ...staffDraft,
          id: createRecordId('setup_staff'),
          name: trimmedName,
          role: staffDraft.role.trim() || 'Team',
        },
      ],
    });
    setStaffDraft(createBlankStaffDraft());
    setMessage(`Staff added. Code for ${trimmedName}: ${staffDraft.code}`);
  };

  const addManualMenuDraft = () => {
    const trimmedName = menuDraft.name.trim();
    const key = createMenuItemKey(trimmedName);
    const duplicate = progress.menuItems.some((item) => item.key === key);
    const sellingPrice = parseMenuPrice(menuDraft.sellingPrice);

    if (!trimmedName || !key) {
      setMessage('Enter the menu item name.');
      return;
    }

    if (duplicate) {
      setMessage('That menu item is already in the setup list.');
      return;
    }

    if (sellingPrice === null) {
      setMessage('Enter a valid selling price.');
      return;
    }

    updateProgress({
      menuItems: [
        ...progress.menuItems,
        {
          key,
          name: trimmedName,
          category: menuDraft.category.trim(),
          sellingPrice,
          components: [],
          source: 'manual',
        },
      ],
    });
    setMenuDraft(createBlankMenuDraft());
    setMessage(`${trimmedName} added to setup menu.`);
  };

  const saveImportedMenuItems = async ({ items }) => {
    const nextItemsByKey = new Map(progress.menuItems.map((item) => [item.key, item]));

    items.forEach((item) => {
      nextItemsByKey.set(item.key, {
        key: item.key,
        name: item.name,
        category: item.category,
        sellingPrice: item.sellingPrice,
        description: item.description,
        portion: item.portion,
        components: item.components,
        source: item.source,
      });
    });

    updateProgress({ menuItems: [...nextItemsByKey.values()] });
    return { ok: true, message: `${items.length} menu item${items.length === 1 ? '' : 's'} added to setup review.` };
  };

  const finishSetup = async () => {
    const managerValidation = validateCurrentStep();

    if (currentStep === 'Manager' && managerValidation) {
      setMessage(managerValidation);
      return;
    }

    if (!progress.restaurantName.trim() || !progress.managerName.trim() || validatePin(progress.managerPin)) {
      setMessage('Restaurant name and manager PIN setup are required before finishing.');
      return;
    }

    if (!firestoreConfigured) {
      setMessage('Firebase is not configured. Add Firebase env vars before completing setup.');
      return;
    }

    setIsFinishing(true);
    setMessage('Finishing setup...');

    try {
      const result = await onFinishSetup?.(progress);

      if (!result?.ok) {
        throw new Error(result?.message || 'Could not finish setup.');
      }

      localStorage.removeItem(SETUP_PROGRESS_KEY);
      setMessage('Setup complete.');
    } catch (error) {
      setMessage(error?.message || 'Could not finish setup.');
    } finally {
      setIsFinishing(false);
    }
  };

  return (
    <main className="auth-screen setup-screen">
      <section className="auth-panel setup-panel">
        <div className="brand auth-brand">
          <span className="brand-mark">WS</span>
          <div>
            <h1 className="brand-name">WasteShift</h1>
            <p className="brand-subtitle">Restaurant setup</p>
          </div>
        </div>

        <div className="progress-track" aria-label="Setup progress">
          <div className="progress-fill" style={{ width: `${completionPercent}%` }} />
        </div>
        <div className="import-summary-grid">
          {STEPS.map((step, index) => (
            <span key={step} className={`badge${index === stepIndex ? ' is-green' : ''}`}>
              {index + 1}. {step}
            </span>
          ))}
        </div>

        {currentStep === 'Welcome' && (
          <div className="auth-form">
            <div>
              <p className="eyebrow">First-time setup</p>
              <h2 className="title">Set Up This Restaurant</h2>
              <p className="subtitle">Create the restaurant profile, first manager access, optional staff, and a starter menu.</p>
            </div>
            <div className="notice-panel">
              <span className={firestoreConfigured ? 'badge is-green' : 'badge is-red'}>
                {firestoreConfigured ? 'Firebase ready' : 'Firebase required'}
              </span>
              <p className="small-text" style={{ margin: 0 }}>
                {firebaseSync?.message || 'Restaurant setup saves to Firestore.'}
              </p>
            </div>
          </div>
        )}

        {currentStep === 'Restaurant' && (
          <div className="auth-form">
            <div>
              <p className="eyebrow">Restaurant profile</p>
              <h2 className="title">Name The Location</h2>
            </div>
            <div className="field">
              <label htmlFor="setup-restaurant-name">Restaurant name</label>
              <input
                id="setup-restaurant-name"
                value={progress.restaurantName}
                onChange={(event) => updateProgress({ restaurantName: event.target.value })}
                className="input"
                placeholder="e.g. RAW Espresso Bar"
              />
            </div>
            <div className="field">
              <label htmlFor="setup-branch-name">Branch/location</label>
              <input
                id="setup-branch-name"
                value={progress.branchName}
                onChange={(event) => updateProgress({ branchName: event.target.value })}
                className="input"
                placeholder="Optional"
              />
            </div>
          </div>
        )}

        {currentStep === 'Manager' && (
          <div className="auth-form">
            <div>
              <p className="eyebrow">Manager access</p>
              <h2 className="title">Create Admin PIN</h2>
              <p className="subtitle">This manager can add staff, import menus, reset data, and manage settings.</p>
            </div>
            <div className="field">
              <label htmlFor="setup-manager-name">Manager name</label>
              <input
                id="setup-manager-name"
                value={progress.managerName}
                onChange={(event) => updateProgress({ managerName: event.target.value })}
                className="input"
              />
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="setup-manager-pin">Management PIN</label>
                <input
                  id="setup-manager-pin"
                  type="password"
                  inputMode="numeric"
                  value={progress.managerPin}
                  onChange={(event) => updateProgress({ managerPin: event.target.value })}
                  className="input"
                />
              </div>
              <div className="field">
                <label htmlFor="setup-manager-pin-confirm">Confirm PIN</label>
                <input
                  id="setup-manager-pin-confirm"
                  type="password"
                  inputMode="numeric"
                  value={progress.confirmManagerPin}
                  onChange={(event) => updateProgress({ confirmManagerPin: event.target.value })}
                  className="input"
                />
              </div>
            </div>
          </div>
        )}

        {currentStep === 'Settings' && (
          <div className="auth-form">
            <div>
              <p className="eyebrow">Basic settings</p>
              <h2 className="title">Set Defaults</h2>
            </div>
            <div className="field-grid">
              <div className="field">
                <label>Currency</label>
                <input value="ZAR" className="input" readOnly />
              </div>
              <div className="field">
                <label>Timezone</label>
                <input value="Africa/Johannesburg" className="input" readOnly />
              </div>
              <div className="field">
                <label htmlFor="setup-budget">Monthly waste budget</label>
                <input
                  id="setup-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  value={progress.budget}
                  onChange={(event) => updateProgress({ budget: event.target.value })}
                  className="input"
                  placeholder="Optional"
                />
              </div>
              <div className="field">
                <label htmlFor="setup-daily-limit">Daily waste limit</label>
                <input
                  id="setup-daily-limit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={progress.dailyWasteValueLimit}
                  onChange={(event) => updateProgress({ dailyWasteValueLimit: event.target.value })}
                  className="input"
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>
        )}

        {currentStep === 'Staff' && (
          <div className="auth-form">
            <div>
              <p className="eyebrow">Staff setup</p>
              <h2 className="title">Add Staff Codes</h2>
              <p className="subtitle">Optional. Staff can also be added later in Settings.</p>
            </div>
            <div className="field-grid">
              <input className="input" value={staffDraft.name} onChange={(event) => setStaffDraft({ ...staffDraft, name: event.target.value })} placeholder="Staff name" />
              <input className="input" value={staffDraft.role} onChange={(event) => setStaffDraft({ ...staffDraft, role: event.target.value })} placeholder="Role" />
              <select className="select" value={staffDraft.staffSection} onChange={(event) => setStaffDraft({ ...staffDraft, staffSection: event.target.value })}>
                {STAFF_SECTIONS.map((section) => (
                  <option key={section.key} value={section.key}>{section.label}</option>
                ))}
                <option value="management">Management</option>
              </select>
              <input className="input" value={staffDraft.code} onChange={(event) => setStaffDraft({ ...staffDraft, code: event.target.value })} placeholder="4-8 digit code" />
            </div>
            <button type="button" className="ghost-button" onClick={addStaffDraft}>Add staff</button>
            {progress.staffMembers.length > 0 && (
              <div className="ingredient-list">
                {progress.staffMembers.map((member) => (
                  <div key={member.id} className="ingredient-card item-row">
                    <span>{member.name} <span className="badge">{member.role}</span></span>
                    <span className="badge is-green">Code {member.code}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {currentStep === 'Menu' && (
          <div className="auth-form">
            <div>
              <p className="eyebrow">Menu setup</p>
              <h2 className="title">Create Or Import Menu</h2>
              <p className="subtitle">Optional. You can add menu items manually, import text/CSV, or use Gemini for PDF/image menus.</p>
            </div>
            <div className="field-grid">
              <input className="input" value={menuDraft.name} onChange={(event) => setMenuDraft({ ...menuDraft, name: event.target.value })} placeholder="Menu item" />
              <input className="input" value={menuDraft.category} onChange={(event) => setMenuDraft({ ...menuDraft, category: event.target.value })} placeholder="Category" />
              <input className="input" type="number" min="0" step="0.01" value={menuDraft.sellingPrice} onChange={(event) => setMenuDraft({ ...menuDraft, sellingPrice: event.target.value })} placeholder="Selling price" />
            </div>
            <button type="button" className="ghost-button" onClick={addManualMenuDraft}>Add menu item</button>
            <MenuImportPanel
              compact
              existingMenuItems={existingMenuItems}
              onSaveApprovedItems={saveImportedMenuItems}
            />
            {progress.menuItems.length > 0 && (
              <div className="import-summary-grid">
                {progress.menuItems.map((item) => (
                  <span key={item.key} className="badge is-green">{item.name} R{Number(item.sellingPrice || 0).toFixed(2)}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {currentStep === 'Review' && (
          <div className="auth-form">
            <div>
              <p className="eyebrow">Review</p>
              <h2 className="title">Finish Setup</h2>
            </div>
            <div className="import-summary-grid">
              <span className="badge is-green">{progress.restaurantName || 'Restaurant pending'}</span>
              <span className="badge is-green">Manager: {progress.managerName || 'Pending'}</span>
              <span className="badge">{progress.staffMembers.length} staff</span>
              <span className="badge">{progress.menuItems.length} menu items</span>
              <span className="badge">ZAR</span>
              <span className="badge">Africa/Johannesburg</span>
            </div>
            <button type="button" className="primary-button" onClick={finishSetup} disabled={isFinishing}>
              {isFinishing ? 'Finishing setup...' : 'Finish setup'}
            </button>
          </div>
        )}

        {message && (
          <div className="inline-message" role="status">
            {message}
          </div>
        )}

        <div className="manager-row" style={{ marginTop: 18 }}>
          <button type="button" className="ghost-button" onClick={goBack} disabled={stepIndex === 0 || isFinishing}>
            Back
          </button>
          {currentStep !== 'Review' && (
            <button type="button" className="primary-button" onClick={goNext} disabled={isFinishing}>
              {currentStep === 'Staff' || currentStep === 'Menu' ? 'Continue or skip' : 'Continue'}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export default SetupWizard;

