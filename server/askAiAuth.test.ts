import { describe, expect, it } from 'vitest'
import {
  askAiGate,
  authorizeAskAi,
  createRateLimiter,
  bearerToken,
  readAskAiAuthConfig,
  type AskAiAuthConfig,
} from './askAiAuth'

/**
 * Authorization for the assistant endpoint.
 *
 * Tested here rather than through either host because the failure mode is a silent
 * open door: `/api/ask-ai` spends a real API key, and a check that quietly resolves
 * to "allowed" costs money without erroring anywhere. Every default in here is
 * asserted in the closed direction on purpose.
 */

/** A `read` that only knows the names it is given, like a sparse environment. */
const env = (vars: Record<string, string>) => (name: string) => vars[name] ?? ''

describe('readAskAiAuthConfig', () => {
  /**
   * The load-bearing default. An endpoint that spends money must not become
   * world-callable because a variable was forgotten during a deploy — so absence
   * means locked, and only an explicit opt-out opens it.
   */
  it('requires auth when the flag is absent', () => {
    expect(readAskAiAuthConfig(env({})).required).toBe(true)
  })

  it('opens the endpoint for an explicit false', () => {
    expect(readAskAiAuthConfig(env({ ASK_AI_REQUIRE_AUTH: 'false' })).required).toBe(false)
  })

  /**
   * Exactly 'false', matching how the client-side flags in devOverrides.ts read
   * their own switches. A commented-out line usually arrives as an empty string,
   * and anything-truthy-opens would turn a typo into an open endpoint.
   */
  it('treats any other value as still requiring auth', () => {
    for (const value of ['true', 'FALSE', '0', 'no', '', 'off']) {
      expect(readAskAiAuthConfig(env({ ASK_AI_REQUIRE_AUTH: value })).required).toBe(true)
    }
  })

  /**
   * The un-prefixed names win, but the `VITE_` ones are accepted as a fallback so a
   * deployment does not have to carry the same URL twice under two names. Reading
   * them server-side is not a leak: both are public by construction.
   */
  it('prefers un-prefixed Supabase values and falls back to the VITE_ ones', () => {
    const both = readAskAiAuthConfig(
      env({
        SUPABASE_URL: 'https://server.supabase.co',
        VITE_SUPABASE_URL: 'https://client.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'anon-from-client',
      }),
    )
    expect(both.supabaseUrl).toBe('https://server.supabase.co')
    expect(both.anonKey).toBe('anon-from-client')
  })

  /** A trailing slash would produce a double slash in the verification URL. */
  it('strips a trailing slash from the project URL', () => {
    expect(readAskAiAuthConfig(env({ SUPABASE_URL: 'https://x.supabase.co/' })).supabaseUrl).toBe(
      'https://x.supabase.co',
    )
  })
})

describe('bearerToken', () => {
  it('reads the token out of an Authorization header', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  /** Some clients and proxies normalise the scheme's case. */
  it('accepts the scheme in any case', () => {
    expect(bearerToken('bearer abc')).toBe('abc')
    expect(bearerToken('BEARER abc')).toBe('abc')
  })

  it('is empty for a missing or malformed header', () => {
    expect(bearerToken(null)).toBe('')
    expect(bearerToken(undefined)).toBe('')
    expect(bearerToken('')).toBe('')
    expect(bearerToken('abc.def.ghi')).toBe('')
    expect(bearerToken('Basic abc')).toBe('')
  })

  /**
   * `Bearer ` with nothing after it must not read as a token, or an empty string
   * gets sent to PostgREST and the refusal happens a round trip later than needed.
   */
  it('is empty when the scheme carries no credentials', () => {
    expect(bearerToken('Bearer')).toBe('')
    expect(bearerToken('Bearer ')).toBe('')
    expect(bearerToken('Bearer    ')).toBe('')
  })
})

// ─── authorizeAskAi ──────────────────────────────────────────────────────────

const CONFIGURED: AskAiAuthConfig = {
  required: true,
  supabaseUrl: 'https://proj.supabase.co',
  anonKey: 'anon-key',
}

/**
 * Records what the caller asked for and answers with a real `Response`, so header
 * and JSON semantics are the platform's rather than a mock's.
 */
function fakeFetch(answer: Response | (() => never)) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
    })
    if (typeof answer === 'function') answer()
    return answer
  }) as unknown as typeof fetch
  return { impl, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const approved = [{ user_id: 'user-1', status: 'approved' }]

describe('authorizeAskAi', () => {
  /**
   * Dev and the demo build have no session to present, so the opt-out has to be a
   * real bypass — and it must not cost a round trip to reach.
   */
  it('allows the caller and makes no request when auth is not required', async () => {
    const { impl, calls } = fakeFetch(json(approved))
    const result = await authorizeAskAi({ ...CONFIGURED, required: false }, '', impl)
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('refuses with 401 when no token is presented', async () => {
    const { impl, calls } = fakeFetch(json(approved))
    const result = await authorizeAskAi(CONFIGURED, '', impl)
    expect(result).toMatchObject({ ok: false, status: 401 })
    expect(calls).toHaveLength(0)
  })

  /**
   * The case that decides whether this is a security control or decoration. A
   * required check with nothing to check against is a MISCONFIGURATION, and the
   * only safe reading of it is "refuse" — resolving it to "allow" would mean a
   * deployment that forgot its Supabase values silently served an open endpoint.
   */
  it('refuses rather than allowing when auth is required but Supabase is unconfigured', async () => {
    const { impl, calls } = fakeFetch(json(approved))
    const result = await authorizeAskAi(
      { required: true, supabaseUrl: '', anonKey: '' },
      'a.token',
      impl,
    )
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('allows an approved caller and reports their user id', async () => {
    const { impl } = fakeFetch(json(approved))
    expect(await authorizeAskAi(CONFIGURED, 'a.token', impl)).toEqual({
      ok: true,
      userId: 'user-1',
    })
  })

  /**
   * PostgREST verifies the JWT signature and expiry itself, so its 401 IS the
   * token check — there is no separate signature step to get wrong here.
   */
  it('refuses with 401 when the project rejects the token', async () => {
    const { impl } = fakeFetch(json({ message: 'JWT expired' }, 401))
    expect(await authorizeAskAi(CONFIGURED, 'expired.token', impl)).toMatchObject({
      ok: false,
      status: 401,
    })
  })

  /**
   * A valid token with no access row is a signed-up account that no admin has
   * touched yet. It must not spend tokens: `handle_new_user` provisions everyone as
   * pending, so this is the state every new account starts in.
   */
  it('refuses an authenticated caller with no access row', async () => {
    const { impl } = fakeFetch(json([]))
    expect(await authorizeAskAi(CONFIGURED, 'a.token', impl)).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it('refuses a pending account', async () => {
    const { impl } = fakeFetch(json([{ user_id: 'user-1', status: 'pending' }]))
    expect(await authorizeAskAi(CONFIGURED, 'a.token', impl)).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it('refuses a revoked account', async () => {
    const { impl } = fakeFetch(json([{ user_id: 'user-1', status: 'revoked' }]))
    expect(await authorizeAskAi(CONFIGURED, 'a.token', impl)).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  /** Fail closed on an unreachable or broken project, not open. */
  it('refuses when the project answers an unexpected status', async () => {
    const { impl } = fakeFetch(json({ message: 'boom' }, 500))
    expect((await authorizeAskAi(CONFIGURED, 'a.token', impl)).ok).toBe(false)
  })

  it('refuses when the verification request throws', async () => {
    const { impl } = fakeFetch(() => {
      throw new Error('ECONNREFUSED')
    })
    expect((await authorizeAskAi(CONFIGURED, 'a.token', impl)).ok).toBe(false)
  })

  /**
   * Both headers are required: `apikey` identifies the project, and the bearer token
   * is what RLS resolves `auth.uid()` from. Sending only the anon key would return
   * the anonymous role's view — zero rows — and read as "not approved" for everyone.
   */
  it('presents both the project key and the caller token', async () => {
    const { impl, calls } = fakeFetch(json(approved))
    await authorizeAskAi(CONFIGURED, 'a.token', impl)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/rest/v1/user_access')
    expect(calls[0].headers.apikey).toBe('anon-key')
    expect(calls[0].headers.authorization).toBe('Bearer a.token')
  })
})

// ─── createRateLimiter ───────────────────────────────────────────────────────

/**
 * `now` is a parameter rather than a call to `Date.now()` inside the limiter, so
 * these tests are deterministic and no timer has to be faked to cross a window.
 */
describe('createRateLimiter', () => {
  const opts = { limit: 3, windowMs: 60_000 }

  it('allows requests up to the limit', () => {
    const limiter = createRateLimiter(opts)
    expect(limiter.check('u1', 1_000).allowed).toBe(true)
    expect(limiter.check('u1', 2_000).allowed).toBe(true)
    expect(limiter.check('u1', 3_000).allowed).toBe(true)
  })

  it('refuses the request past the limit', () => {
    const limiter = createRateLimiter(opts)
    for (const t of [1_000, 2_000, 3_000]) limiter.check('u1', t)
    expect(limiter.check('u1', 4_000).allowed).toBe(false)
  })

  /** Surfaced as Retry-After, so it has to be a positive whole number of seconds. */
  it('reports when a refused caller may retry', () => {
    const limiter = createRateLimiter(opts)
    for (const t of [1_000, 2_000, 3_000]) limiter.check('u1', t)
    const verdict = limiter.check('u1', 4_000)
    expect(verdict.retryAfterSeconds).toBeGreaterThan(0)
    expect(Number.isInteger(verdict.retryAfterSeconds)).toBe(true)
  })

  /** Sliding, not fixed: the oldest hit ageing out is what frees a slot. */
  it('allows again once the oldest hit leaves the window', () => {
    const limiter = createRateLimiter(opts)
    for (const t of [1_000, 2_000, 3_000]) limiter.check('u1', t)
    expect(limiter.check('u1', 4_000).allowed).toBe(false)
    expect(limiter.check('u1', 61_500).allowed).toBe(true)
  })

  it('counts each caller separately', () => {
    const limiter = createRateLimiter(opts)
    for (const t of [1_000, 2_000, 3_000]) limiter.check('u1', t)
    expect(limiter.check('u1', 4_000).allowed).toBe(false)
    expect(limiter.check('u2', 4_000).allowed).toBe(true)
  })

  /**
   * Without pruning the map grows for the lifetime of the process, one entry per
   * caller that ever asked a question — a slow leak in the dev server, which runs
   * for days.
   */
  it('forgets callers who have gone quiet', () => {
    const limiter = createRateLimiter(opts)
    limiter.check('u1', 1_000)
    limiter.check('u2', 1_000)
    expect(limiter.trackedCallers()).toBe(2)
    limiter.check('u3', 500_000)
    expect(limiter.trackedCallers()).toBe(1)
  })
})

// ─── askAiGate ───────────────────────────────────────────────────────────────

/**
 * The single entry point both hosts call. It exists so the ORDER of the checks
 * cannot differ between `vite/askAiProxy.ts` and `api/ask-ai.ts` — two call sites
 * doing the same three things in their own order is how dev ends up permitting what
 * production refuses, which is the drift the shared core exists to prevent.
 */
describe('askAiGate', () => {
  const gateOpts = (over: Partial<Parameters<typeof askAiGate>[0]> = {}) => ({
    auth: CONFIGURED,
    limiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
    authorizationHeader: 'Bearer a.token',
    now: 1_000,
    fetchImpl: fakeFetch(json(approved)).impl,
    ...over,
  })

  it('returns null for an approved caller within the limit', async () => {
    expect(await askAiGate(gateOpts())).toBeNull()
  })

  it('returns the refusal when the caller is not authorized', async () => {
    const refusal = await askAiGate(gateOpts({ authorizationHeader: null }))
    expect(refusal).toMatchObject({ status: 401 })
  })

  it('returns a 429 carrying a retry hint once the caller is over the limit', async () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 })
    expect(await askAiGate(gateOpts({ limiter, now: 1_000 }))).toBeNull()
    expect(await askAiGate(gateOpts({ limiter, now: 2_000 }))).toBeNull()
    const refusal = await askAiGate(gateOpts({ limiter, now: 3_000 }))
    expect(refusal?.status).toBe(429)
    expect(refusal?.retryAfterSeconds).toBeGreaterThan(0)
  })

  /**
   * Opt-out mode has no identity to count against, so every request would share one
   * bucket keyed on nothing. Dev would then start refusing its own requests after
   * the limit, which looks exactly like a broken endpoint.
   */
  it('never rate-limits when auth is not required', async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 })
    const open = { ...CONFIGURED, required: false }
    for (const now of [1_000, 2_000, 3_000, 4_000]) {
      expect(await askAiGate(gateOpts({ auth: open, limiter, now }))).toBeNull()
    }
  })
})
