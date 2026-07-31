import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { initTheme } from './lib/theme.ts'
import './styles.css'

// Before the first paint, so a dark-mode operator never gets a white flash.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside App, so a crash in the sign-in screen is caught too. A blank
        page is the one failure a monitoring tool must never show — it is
        indistinguishable from "nothing is wrong". */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
