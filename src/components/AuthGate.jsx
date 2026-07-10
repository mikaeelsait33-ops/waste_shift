import { useState } from 'react';

function AuthGate({
  isPreparingAuth,
  authIsConfigured = false,
  staffList = [],
  onLogin,
  onInitialManagerSetup,
}) {
  const [mode, setMode] = useState('staff');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const staffLoginOptions = (Array.isArray(staffList) ? staffList : [])
    .filter((member) => (
      member?.id
      && !member.removed
      && member.staffCode
      && member.staffSection !== 'management'
      && !/\b(owner|manager)\b/i.test(String(member.role || ''))
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
          <form onSubmit={handleLoginSubmit} className="auth-form">
              <div>
                <p className="eyebrow">{!authIsConfigured ? 'First-time setup' : mode === 'management' ? 'Management login' : 'Staff login'}</p>
                <h2 className="title">{!authIsConfigured ? 'Create Manager Access' : mode === 'management' ? 'Unlock Management' : 'Start Waste Logging'}</h2>
                <p className="subtitle">
                  {!authIsConfigured
                    ? 'Create the first manager profile and secure management PIN for this restaurant.'
                    : mode === 'management'
                    ? 'Enter your name and the management PIN to create or open a manager account.'
                    : 'Choose a manager-added staff profile and enter the 5 digit PIN issued in Settings.'}
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
                    No staff PINs have been issued yet. A manager must add staff in Settings and share their PIN.
                  </div>
                )}
              </>
            )}

            <div className="field">
              <label htmlFor="login-pin">{!authIsConfigured || mode === 'management' ? 'Management PIN' : '5 digit staff PIN'}</label>
              <input
                id="login-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder={!authIsConfigured || mode === 'management' ? 'Enter PIN' : 'Enter 5 digit PIN'}
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
