import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { applyTheme, loadTheme } from './lib/theme'
import './index.css'

// Before first paint, deliberately. Applying the theme inside a component
// renders one light frame for dark-mode users on every load.
applyTheme(loadTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
