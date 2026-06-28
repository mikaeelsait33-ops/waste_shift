import { useState } from 'react';

const STAFF_SECTIONS = [
  { value: 'kitchen', label: 'Kitchen staff' },
  { value: 'waiters', label: 'Waiter / floor staff' },
  { value: 'barista', label: 'Barista / beverage staff' },
];

function AuthGate({
  isPreparingAuth,
  onLogin,
}) {
  const [mode, setMode] = useState('staff');
  const [name, setName] = useState('');
  const [staffSection, setStaffSection] = useState('kitchen');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [generatedStaffCode, setGeneratedStaffCode] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const handleLoginSubmit = async (event) => {
    event.preventDefault();

    if (!name.trim()) {
      setMessage(mode === 'management' ? 'Enter your management name.' : 'Enter your staff name.');
      return;
    }

    setIsBusy(true);
    setMessage('');
    setGeneratedStaffCode('');

    try {
      const result = await onLogin?.({
        mode,
        name: name.trim(),
        staffSection,
        pin,
      });

      if (!result?.ok) {
        setMessage(result?.message || 'PIN login failed.');
        if (result?.generatedStaffCode) {
          setGeneratedStaffCode(result.generatedStaffCode);
        }
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
              <p className="eyebrow">{mode === 'management' ? 'Management login' : 'Staff account'}</p>
              <h2 className="title">{mode === 'management' ? 'Unlock Management' : 'Start Waste Logging'}</h2>
              <p className="subtitle">
                {mode === 'management'
                  ? 'Enter your name and the management PIN to create or open a manager account.'
                  : 'Create your staff account to receive a personal code, or enter your existing staff code.'}
              </p>
            </div>

            <div className="segmented-control" aria-label="Login type">
              <button
                type="button"
                onClick={() => {
                  setMode('staff');
                  setPin('');
                  setMessage('');
                  setGeneratedStaffCode('');
                }}
                className={`segment-button${mode === 'staff' ? ' is-active' : ''}`}
              >
                Staff Account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('management');
                  setPin('');
                  setMessage('');
                  setGeneratedStaffCode('');
                }}
                className={`segment-button${mode === 'management' ? ' is-active' : ''}`}
              >
                Management Login
              </button>
            </div>

            <div className="field">
              <label htmlFor="login-name">{mode === 'management' ? 'Management name' : 'Staff name'}</label>
              <input
                id="login-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={mode === 'management' ? 'e.g. Nadia' : 'e.g. Mikaeel'}
                className="input"
              />
            </div>

            {mode === 'staff' && (
              <div className="field">
                <label htmlFor="staff-section-login">Staff section</label>
                <select
                  id="staff-section-login"
                  value={staffSection}
                  onChange={(event) => setStaffSection(event.target.value)}
                  className="select"
                >
                  {STAFF_SECTIONS.map((section) => (
                    <option key={section.value} value={section.value}>
                      {section.label}
                    </option>
                  ))}
                </select>
              </div>
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
                placeholder={mode === 'management' ? 'Enter PIN' : 'Enter code, or leave blank to create one'}
                className="input"
              />
            </div>

            <button type="submit" className="primary-button" disabled={isBusy}>
              {isBusy ? 'Checking...' : mode === 'management' ? 'Unlock management' : 'Continue'}
            </button>
          </form>
        )}

        {generatedStaffCode && (
          <div className="staff-code-reveal" role="status">
            <span className="field-label">Generated staff code</span>
            <strong>{generatedStaffCode}</strong>
            <p className="small-text">Write this down. It will not be shown again after you leave this screen.</p>
          </div>
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
