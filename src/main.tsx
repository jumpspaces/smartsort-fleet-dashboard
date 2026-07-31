import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { initTheme } from './lib/theme.ts'
import './styles.css'

// Before the first paint, so a dark-mode operator never gets a white flash.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
