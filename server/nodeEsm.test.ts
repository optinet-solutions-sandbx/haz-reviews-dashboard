import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `api/` and `server/` are the only code here that runs under raw Node ESM, and
 * that changes the rules for imports.
 *
 * Vercel transpiles each file separately rather than bundling them, and
 * `package.json` declares `"type": "module"`, so Node's own resolver handles the
 * specifiers — and it requires an explicit file extension on every relative
 * import. An extensionless one resolves perfectly in dev, because Vite resolves it
 * itself and never consults Node, and then fails in production with
 * ERR_MODULE_NOT_FOUND.
 *
 * This shipped exactly once, and nothing caught it: `api/ask-ai.ts` imported
 * '../server/askAi', `tsc -b` passed, `vite build` passed, all 245 tests passed,
 * and the deployed function answered 500 FUNCTION_INVOCATION_FAILED on every
 * request. Hence a test that reads the source rather than importing it — the
 * failure is in module resolution, so any test that could `import` the module has
 * already resolved it the wrong way.
 *
 * The extension is `.js` even though the file on disk is `.ts`: it names the
 * EMITTED file, which is what Node resolves at runtime. TypeScript maps it back to
 * the `.ts` source, so both ends are satisfied.
 */

const RUNS_UNDER_NODE_ESM = ['api', 'server']

/** `from '...'` and `import('...')`, for specifiers starting with a dot. */
const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*'(\.[^']*)'/g

function sourcesIn(dir: string): Array<[string, string]> {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name): [string, string] => [join(dir, name), readFileSync(join(dir, name), 'utf8')])
}

describe.each(RUNS_UNDER_NODE_ESM)('%s/ runs under Node ESM', (dir) => {
  const sources = sourcesIn(dir)

  // Guards the guard: a typo in the directory name would make this suite pass by
  // examining nothing at all.
  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(0)
  })

  it.each(sources)('%s gives every relative import an explicit extension', (_file, source) => {
    const offenders = [...source.matchAll(RELATIVE_IMPORT)]
      .map(([, specifier]) => specifier)
      .filter((specifier) => !specifier.endsWith('.js'))
    expect(offenders).toEqual([])
  })
})
