import { useEffect, useState } from 'react';

function AuthGate({
  isPreparingAuth,
  authIsConfigured = false,
  staffList = [],
  serverSync,
  syncAccessKey = '',
  onLogin,
  onInitialManagerSetup,
  onSyncAccessKeySubmit,
}) {
  const [mode, setMode] = useState('staff');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [accessKey, setAccessKey] = useState(syncAccessKey);
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isSavingAccessKey, setIsSavingAccessKey] = useState(false);
  const staffLoginOptions = (Array.isArray(staffList) ? staffList : [])
    .filter((member) => (
      member?.id
      && !member.removed
      && member.staffCode
      && member.staffSection !== 'management'
      && !/\b(owner|manager)\b/i.test(String(member.role || ''))
    ))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  useEffect(() => {
    setAccessKey(syncAccessKey);
  }, [syncAccessKey]);

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

  const handleAccessKeySubmit = async (event) => {
    event.preventDefault();

    if (!accessKey.trim()) {
      setMessage('Enter the manager access key first.');
      return;
    }

    setIsSavingAccessKey(true);
    setMessage('');

    try {
      const result = await onSyncAccessKeySubmit?.(accessKey);

      setMessage(result?.message || 'Access key saved. Loading shared restaurant data...');
    } finally {
      setIsSavingAccessKey(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="brand auth-brand">
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
          <>
            <form onSubmit={handleAccessKeySubmit} className="auth-form auth-form--compact">
              <div>
                <p className="eyebrow">Existing restaurant</p>
                <h2 className="title">Load Shared Access</h2>
                <p className="subtitle">
                  On a new phone or tablet, enter the manager access key once so WasteShift can load the shared staff list and PIN settings.
                </p>
              </div>

              <div className="field">
                <label htmlFor="sync-access-key">Manager access key</label>
                <input
                  id="sync-access-key"
                  type="password"
                  autoComplete="current-password"
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                  placeholder="Paste the Vercel manager key"
                  className="input"
                />
              </div>

              <button type="submit" className="ghost-button is-warning" disabled={isSavingAccessKey}>
                {isSavingAccessKey ? 'Saving...' : 'Load existing restaurant'}
              </button>
              {serverSync?.message && (
                <p className="small-text" style={{ margin: 0 }}>{serverSync.message}</p>
              )}
            </form>

            <form onSubmit={handleLoginSubmit} className="auth-form">
              <div>
                <p className="eyebrow">{!authIsConfigured ? 'First-time setup' : mode === 'management' ? 'Management login' : 'Staff login'}</p>
                <h2 className="title">{!authIsConfigured ? 'Create Manager Access' : mode === 'management' ? 'Unlock Management' : 'Start Waste Logging'}</h2>
                <p className="subtitle">
                  {!authIsConfigured
                    ? 'Create the first manager profile only if this is a new restaurant. Existing restaurants should load shared access first.'
                    : mode === 'management'
                    ? 'Enter your name and the management PIN to create or open a manager account.'
                    : 'Choose a manager-added staff profile and enter the personal code issued in Settings.'}
                </p>
              </div>

            {authIsConfigured && (
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
                  setName('');
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

            {!authIsConfigured || mode === 'management' ? (
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
                    No staff codes have been issued yet. A manager must add staff in Settings and share their code.
                  </div>
                )}
              </>
            )}

            <div className="field">
              <label htmlFor="login-pin">{!authIsConfigured || mode === 'management' ? 'Management PIN' : 'Personal staff code'}</label>
              <input
                id="login-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder={!authIsConfigured || mode === 'management' ? 'Enter PIN' : 'Enter staff code'}
                className="input"
              />
            </div>

            {!authIsConfigured && (
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
              {isBusy ? 'Checking...' : !authIsConfigured ? 'Create manager access' : mode === 'management' ? 'Unlock management' : 'Continue'}
            </button>
            </form>
          </>
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
