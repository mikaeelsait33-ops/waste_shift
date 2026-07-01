import { useState } from 'react';

function AuthGate({
  isPreparingAuth,
  staffList = [],
  onLogin,
}) {
  const [mode, setMode] = useState('staff');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
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
              <p className="eyebrow">{mode === 'management' ? 'Management login' : 'Staff login'}</p>
              <h2 className="title">{mode === 'management' ? 'Unlock Management' : 'Start Waste Logging'}</h2>
              <p className="subtitle">
                {mode === 'management'
                  ? 'Enter your name and the management PIN to create or open a manager account.'
                  : 'Choose a manager-added staff profile and enter the personal code issued in Settings.'}
              </p>
            </div>

            <div className="segmented-control" aria-label="Login type">
              <button
                type="button"
                onClick={() => {
                  setMode('staff');
                  setName('');
                  setPin('');
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
                  setMessage('');
                }}
                className={`segment-button${mode === 'management' ? ' is-active' : ''}`}
              >
                Management Login
              </button>
            </div>

            {mode === 'management' ? (
              <div className="field">
                <label htmlFor="login-name">Management name</label>
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
              <label htmlFor="login-pin">{mode === 'management' ? 'Management PIN' : 'Personal staff code'}</label>
              <input
                id="login-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                placeholder={mode === 'management' ? 'Enter PIN' : 'Enter staff code'}
                className="input"
              />
            </div>

            <button type="submit" className="primary-button" disabled={isBusy}>
              {isBusy ? 'Checking...' : mode === 'management' ? 'Unlock management' : 'Continue'}
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
