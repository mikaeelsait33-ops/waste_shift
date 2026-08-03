import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { removeLegacyDatabaseQuery } from './utils/clientDatabaseId.js'

removeLegacyDatabaseQuery()
const testWorkspaceRequested = import.meta.env.VITE_WASTESHIFT_E2E === 'true'
  && new URLSearchParams(window.location.search).get('workspace') === '1'
const RootComponent = testWorkspaceRequested
  ? (await import('./e2e/WorkspaceHarness.jsx')).default
  : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <RootComponent />
    </ErrorBoundary>
  </StrictMode>,
)
