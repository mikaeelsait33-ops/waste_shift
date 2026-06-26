function Navbar() {
  return (
    <nav style={{ background: '#1a1a2e', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <h2 style={{ color: '#00d4aa', margin: 0 }}>WasteShift</h2>
      <div style={{ display: 'flex', gap: '16px' }}>
        <button style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '16px' }}>
          Log Waste
        </button>
        <button style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '16px' }}>
          Dashboard
        </button>
      </div>
    </nav>
  )
}

export default Navbar