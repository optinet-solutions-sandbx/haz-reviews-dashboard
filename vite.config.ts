import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { askAiProxy } from './vite/askAiProxy'

// Port 3002 is deliberate: 3000 belongs to Ranking-Reports and 3001 to
// TryBet-Dashboard. strictPort makes a collision fail loudly instead of
// silently moving the dev server somewhere the team does not expect.
export default defineConfig({
  // askAiProxy is `apply: 'serve'` — it exists only under `npm run dev`, which is
  // what lets the Anthropic key stay in Node and out of the client bundle.
  plugins: [react(), tailwindcss(), askAiProxy()],
  server: { port: 3002, strictPort: true },
})
