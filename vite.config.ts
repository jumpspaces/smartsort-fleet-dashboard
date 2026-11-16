/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Internal fleet dashboard. Standalone SPA; it talks to the cloud droplet's
// /fleet/* endpoints (base URL is entered at login and stored locally).
export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  // Unit and page tests only; e2e/ is Playwright's (npm run e2e).
  test: { include: ['src/**/*.test.{ts,tsx}'] },
})
