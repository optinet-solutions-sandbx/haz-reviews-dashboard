import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Asserts the shape of every function under `api/`.
 *
 * Vercel picks a calling convention from how the module exports its handler, and
 * the two are not interchangeable:
 *
 * - named method exports (`export function GET(request: Request)`) get the WEB
 *   signature — a `Request` in, a `Response` out.
 * - `export default function handler(req, res)` gets the NODE signature, and is
 *   expected to write to `res` itself.
 *
 * Mixing them fails in the worst available way. A Web-style body behind a default
 * export is handed `(IncomingMessage, ServerResponse)`; `request.method` exists on
 * IncomingMessage, so nothing throws, the handler builds a `Response`, returns it
 * — and nothing ever writes to the ServerResponse. Every request then HANGS until
 * the function's maxDuration expires and answers 504
 * FUNCTION_INVOCATION_TIMEOUT. That is 60 seconds of billed compute per request to
 * serve a readiness probe that returns a constant.
 *
 * This shipped once, and no local signal existed: the type-check passes (the body
 * is valid TypeScript either way), the build passes, and the suite passes. Only a
 * deployed request shows it. So the test reads the source, like
 * nodeEsm.test.ts, and for the same reason.
 *
 * It lives in `server/` rather than beside the code it checks because Vercel
 * publishes every file under `api/` as a function — a test file there would become
 * a public endpoint.
 */

const API_DIR = 'api'
const HTTP_METHOD_EXPORT = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g
const DEFAULT_EXPORT = /export\s+default\b/

function functionsInApi(): Array<[string, string]> {
  return readdirSync(API_DIR, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))
    .map((name): [string, string] => [join(API_DIR, name), readFileSync(join(API_DIR, name), 'utf8')])
}

describe('api/ handler signatures', () => {
  const functions = functionsInApi()

  // Guards the guard: a renamed directory would make this pass by checking nothing.
  it('finds the functions', () => {
    expect(functions.length).toBeGreaterThan(0)
  })

  it.each(functions)('%s exports at least one HTTP method by name', (_file, source) => {
    expect([...source.matchAll(HTTP_METHOD_EXPORT)].map(([, method]) => method)).not.toEqual([])
  })

  it.each(functions)('%s has no default export to select the Node signature', (_file, source) => {
    expect(DEFAULT_EXPORT.test(source)).toBe(false)
  })
})
