import { defineConfig } from 'vitest/config'

// Node environment on purpose: every test targets pure logic (group matching,
// parsing, normalisation, carry-forward, pagination maths). Nothing here needs a
// DOM, and jsdom would only slow the suite down.
//
// The two Supabase vars are dummies. src/lib/supabase.ts throws at module load
// when they are missing — which is the behaviour we want in production — so any
// suite that transitively imports the storage layer needs them present. No test
// makes a network call; the client is constructed and never used.
export default defineConfig({
  test: {
    environment: 'node',
    // server/ is included but api/ deliberately is not: Vercel publishes every file
    // under api/ as a function, so a test file there would become an endpoint.
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
