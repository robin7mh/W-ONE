import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme, initialTheme } from './lib/theme'
import './index.css'

// Before the first paint, so the window never flashes the wrong theme.
applyTheme(initialTheme())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
