import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { applyStoredTheme } from './lib/theme.ts'
import { applyStoredDensity } from './lib/prefs.ts'
import './styles.css'

applyStoredTheme()
applyStoredDensity()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
