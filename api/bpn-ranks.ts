// `.js`, not extensionless and not `.ts`. Vercel transpiles each file here
// separately rather than bundling them, and package.json declares
// `"type": "module"`, so Node's own resolver handles this specifier and requires a
// real extension — one naming the EMITTED file. Extensionless resolves fine in dev,
// where Vite resolves it and Node never sees it, then fails in production with
// ERR_MODULE_NOT_FOUND and a 500 on every request. Asserted by
// server/nodeEsm.test.ts, because no build or type-check catches it.
import { BPN_RATE_LIMIT, readBpnConfig, serveBpnRanks } from '../server/bpnRanks.js'
import { createRateLimiter, readEndpointAuthConfig } from '../server/endpointAuth.js'

/**
 * PRODUCTION host for the BPN ranks import, and the deployed counterpart to
 * `vite/bpnRanksProxy.ts` — which is `apply: 'serve'` and therefore does not exist
 * in a build at all. Same path, same JSON contract, so `src/lib/bpnRanks.ts` needs
 * no change and stays vendor-blind.
 *
 * A signature adapter and nothing else. Every decision — the action allow-list, the
 * pinned project id, the clamps, hostname validation, the timeout, the pagination
 * rule and the order the session gate runs in — lives in `server/bpnRanks.ts` and is
 * made exactly once, because a rule written in two hosts is a rule that eventually
 * differs between them.
 *
 * Exported as a NAMED HTTP method, never as a default. That choice is what selects
 * Vercel's Web signature — a `Request` in and a `Response` out — and a default export
 * would instead select the Node `(req, res)` signature and expect this code to write
 * to `res` itself. Mixing them does not fail loudly: `request.method` exists on
 * IncomingMessage so nothing throws, the `Response` is built and returned, nothing
 * ever writes to the real response, and every request HANGS until maxDuration and
 * answers 504 — 60 seconds of billed compute apiece. Asserted by
 * server/vercelHandlers.test.ts (CLAUDE.md invariant 32).
 *
 * GET only, and there is deliberately no POST here: the vendor's `check_all` is a
 * POST that queues an hours-long sweep, and Vercel answers 405 for any method this
 * module does not export. So the sweep is unreachable by two independent means —
 * this file exports no way to reach it, and the core's allow-list would refuse it.
 *
 * `SITES_API_KEY` is read from `process.env`, never `VITE_`-prefixed, or it would be
 * inlined into the client bundle and readable in devtools (invariant 27).
 */

const readEnv = (name: string) => process.env[name] ?? ''

/**
 * Module scope on purpose: a warm instance reuses this between invocations, which is
 * the only reason a per-instance counter counts anything at all. See BPN_RATE_LIMIT
 * on why that makes it a speed bump rather than a promise to the vendor.
 */
const limiter = createRateLimiter(BPN_RATE_LIMIT)

export async function GET(request: Request): Promise<Response> {
  const result = await serveBpnRanks({
    method: 'GET',
    params: new URL(request.url).searchParams,
    authorizationHeader: request.headers.get('authorization'),
    config: readBpnConfig(readEnv),
    auth: readEndpointAuthConfig(readEnv),
    limiter,
    now: Date.now(),
    fetchImpl: fetch,
  })

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    // no-store because the response carries somebody's live rankings behind a
    // session check. A cached copy on a shared hop would be servable to the next
    // caller without the gate ever running again.
    headers: { ...result.headers, 'Cache-Control': 'no-store' },
  })
}
