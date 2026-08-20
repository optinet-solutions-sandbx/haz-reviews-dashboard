import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { askAiProxy } from './vite/askAiProxy'
import { bpnRanksProxy } from './vite/bpnRanksProxy'

// Port 3002 is deliberate: 3000 belongs to Ranking-Reports and 3001 to
// TryBet-Dashboard. strictPort makes a collision fail loudly instead of
// silently moving the dev server somewhere the team does not expect.
export default defineConfig({
  // Both proxies are `apply: 'serve'` — they exist only under `npm run dev`, which
  // is what lets OPENAI_API_KEY and SITES_API_KEY stay in Node and out of the
  // client bundle. Their deployed counterparts are the functions under api/.
  plugins: [react(), tailwindcss(), askAiProxy(), bpnRanksProxy()],
  server: { port: 3002, strictPort: true },
})
