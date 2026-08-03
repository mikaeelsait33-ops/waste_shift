import { useState } from 'react';
import KitchenPulse3D from './KitchenPulse3D';

function AuthGate({
  isPreparingAuth,
  authIsConfigured = false,
  staffList = [],
  managerSetupRequired = false,
  onLogin,
  onInitialManagerSetup,
  onBootstrapManagerAccess,
}) {
  const [mode, setMode] = useState(managerSetupRequired ? 'management' : 'staff');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const staffLoginOptions = (Array.isArray(staffList) ? staffList : [])
    .filter((member) => (
      member?.id
      && !member.removed
      && member.staffSection !== 'management'
      && !/\b(owner|manager)\b/i.test(String(member.role || ''))
    ))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const managerLoginOptions = (Array.isArray(staffList) ? staffList : [])
    .filter((member) => (
      member?.id
      && !member.removed
      && (
        member.staffSection === 'management'
        || /\b(owner|manager)\b/i.test(String(member.role || member.roleKey || ''))
      )
    ))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  const handleLoginSubmit = async (event) => {
    event.preventDefault();

    if (!authIsConfigured) {
      if (!name.trim()) {
        setMessage('Enter the first manager name.');
        return;
      }

      if (pin !== confirmPin) {
        setMessage('Management PINs do not match.');
        return;
      }

      setIsBusy(true);
      setMessage('');

      try {
        const result = await onInitialManagerSetup?.({
          name: name.trim(),
          managementPin: pin,
        });

        if (!result?.ok) {
          setMessage(result?.message || 'Could not create manager access.');
          return;
        }

        setPin('');
        setConfirmPin('');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (managerSetupRequired) {
      if (!name.trim()) {
        setMessage('Enter the manager name.');
        return;
      }

      if (!/^\d{4,8}$/.test(pin) || pin !== confirmPin) {
        setMessage(pin !== confirmPin ? 'Management PINs do not match.' : 'Use a 4 to 8 digit PIN.');
        return;
      }

      setIsBusy(true);
      setMessage('');

      try {
        const result = await onBootstrapManagerAccess?.({
          name: name.trim(),
          pin,
        });
        if (!result?.ok) {
          setMessage(result?.message || 'Could not create manager access.');
          return;
        }

        setPin('');
        setConfirmPin('');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (!name.trim()) {
      setMessage(mode === 'management' ? 'Enter your management name.' : 'Choose your staff profile.');
      return;
    }

    setIsBusy(true);
    setMessage('');

    try {
      const result = await onLogin?.({
        mode,
        name: name.trim(),
        pin,
      });

      if (!result?.ok) {
        setMessage(result?.message || 'PIN login failed.');
        return;
      }

      setPin('');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="auth-screen auth-experience">
      <aside className="auth-visual" aria-label="WasteShift restaurant operations">
        <KitchenPulse3D />
        <div className="auth-visual__brand" aria-hidden="true">
          <span className="auth-visual__mark">WS</span>
          <div>
            <strong>WasteShift</strong>
            <span>Restaurant operations</span>
          </div>
        </div>
        <div className="auth-visual__signal" aria-hidden="true">
          <span />
          Kitchen pulse active
        </div>
      </aside>

      <section className="auth-panel">
        <div className="brand auth-brand auth-brand--panel">
          <span className="brand-mark">WS</span>
          <div>
            <h1 className="brand-name">WasteShift</h1>
            <p className="brand-subtitle">Secure shift access</p>
          </div>
        </div>

        {isPreparingAuth ? (
          <div className="auth-form">
            <div>
              <p className="eyebrow">Access setup</p>
              <h2 className="title">Preparing PIN access</h2>
              <p className="subtitle">WasteShift is setting up staff and management access for this restaurant.</p>
            </div>
            <div className="muted-box" style={{ marginBottom: 0 }}>Almost ready.</div>
          </div>
        ) : (
          <form onSubmit={handleLoginSubmit} className="auth-form">
              <div>
                <p className="eyebrow">{!authIsConfigured || managerSetupRequired ? 'Manager setup' : mode === 'management' ? 'Management login' : 'Staff login'}</p>
                <h2 className="title">{!authIsConfigured || managerSetupRequired ? 'Create Manager Access' : mode === 'management' ? 'Unlock Management' : 'Start Waste Logging'}</h2>
                <p className="subtitle">
                  {!authIsConfigured
                    ? 'Create the first manager profile and secure management PIN for this restaurant.'
                     : managerSetupRequired
                     ? 'No active manager is linked to this restaurant. Create one with a name and PIN.'
                     : mode === 'management'
                    ? 'Choose the restaurant manager and enter the management PIN.'
                     : 'Choose a manager-added staff profile and enter the 5 digit PIN issued in Settings.'}
                </p>
              </div>

            {authIsConfigured && !managerSetupRequired && (
              <div className="segmented-control" aria-label="Login type">
              <button
                type="button"
                onClick={() => {
                  setMode('staff');
                  setName('');
                  setPin('');
                  setConfirmPin('');
                  setMessage('');
                }}
                className={`segment-button${mode === 'staff' ? ' is-active' : ''}`}
              >
                Staff Login
              </button>
              <button
                type="button"
                 onClick={() => {
                   setMode('management');
                   setName(managerLoginOptions.length === 1 ? managerLoginOptions[0].name : '');
                   setPin('');
                   setConfirmPin('');
                   setMessage('');
                }}
                className={`segment-button${mode === 'management' ? ' is-active' : ''}`}
              >
                Management Login
              </button>
            </div>
            )}

            {!authIsConfigured || managerSetupRequired ? (
              <div className="field">
                <label htmlFor="login-name">{authIsConfigured ? 'Management name' : 'First manager name'}</label>
                <input
                  id="login-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Nadia"
                  className="input"
                />
              </div>
            ) : mode === 'management' ? (
              <div className="field">
                <label htmlFor="login-name">Manager account</label>
                <select
                  id="login-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="select"
                >
                  <option value="">Choose manager</option>
                  {managerLoginOptions.map((member) => (
                    <option key={member.id} value={member.name}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="login-name">Staff profile</label>
                  <select
                    id="login-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="select"
                  >
                    <option value="">Choose staff member</option>
                    {staffLoginOptions.map((member) => (
                      <option key={member.id} value={member.name}>
                        {member.name} - {member.role}
                      </option>
                    ))}
                  </select>
                </div>

                {staffLoginOptions.length === 0 && (
                  <div className="muted-box" style={{ marginBottom: 0 }}>
                    No staff PINs have been issued yet. A manager must add staff in Settings and share their PIN.
                  </div>
                )}
              </>
            )}

            <div className="field">
              <label htmlFor="login-pin">{!authIsConfigured || managerSetupRequired || mode === 'management' ? 'Management PIN' : '5 digit staff PIN'}</label>
              <input
                id="login-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder={!authIsConfigured || managerSetupRequired || mode === 'management' ? 'Enter PIN' : 'Enter 5 digit PIN'}
                className="input"
              />
            </div>

            {(!authIsConfigured || managerSetupRequired) && (
              <div className="field">
                <label htmlFor="confirm-login-pin">Confirm management PIN</label>
                <input
                  id="confirm-login-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value)}
                  placeholder="Re-enter PIN"
                  className="input"
                />
              </div>
            )}

            <button type="submit" className="primary-button" disabled={isBusy}>
              {isBusy ? 'Checking...' : !authIsConfigured || managerSetupRequired ? 'Create manager access' : mode === 'management' ? 'Unlock management' : 'Continue'}
            </button>
          </form>
        )}

        {message && (
          <div className="inline-message" role="status">
            {message}
          </div>
        )}
      </section>
    </main>
  );
}

export default AuthGate;
