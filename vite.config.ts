import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Internal fleet dashboard. Standalone SPA; it talks to the cloud droplet's
// /fleet/* endpoints (base URL is entered at login and stored locally).
export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
})
