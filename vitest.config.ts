import { defineConfig } from 'vitest/config'

// Node environment on purpose: every test targets pure logic (group matching,
// parsing, normalisation, carry-forward). Nothing here needs a DOM, and a
// jsdom environment would only slow the suite down.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
