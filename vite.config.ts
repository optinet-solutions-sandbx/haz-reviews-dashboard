import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Port 3002 is deliberate: 3000 belongs to Ranking-Reports and 3001 to
// TryBet-Dashboard. strictPort makes a collision fail loudly instead of
// silently moving the dev server somewhere the team does not expect.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3002, strictPort: true },
})
