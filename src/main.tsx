import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startAppearance } from './lib/theme'
import { AppBoundary, installErrorReporting } from './components/shell/ErrorBoundary'
import './index.css'

// Before the first paint, so the window never flashes the wrong theme.
startAppearance()
// Uncaught errors in the UI end up in the desktop app's log.
installErrorReporting()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppBoundary>
      <App />
    </AppBoundary>
  </React.StrictMode>
)
