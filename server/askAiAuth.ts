/**
 * Authorization for the assistant endpoint, shared by both hosts.
 *
 * Lives beside `askAi.ts` for the same reason that does: `vite/askAiProxy.ts` and
 * `api/ask-ai.ts` are two different calling conventions in front of one behaviour,
 * and a check that exists in only one of them is a check that does not exist. Dev
 * would pass while production spent money, or the reverse.
 *
 * Why this is needed at all: the sign-in gate in the app is client-side. CLAUDE.md
 * invariant 10 already says so — RLS is the real boundary — and RLS does not cover
 * an OpenAI endpoint. Without a check here, anyone who knows the URL can POST an
 * arbitrary system prompt and arbitrary messages and bill it to the configured key.
 *
 * Every default resolves toward CLOSED. An endpoint that spends money must fail by
 * refusing, never by allowing: a refusal is visible in the UI on the first
 * question, whereas an accidental opening is invisible until the bill arrives.
 */

/** Read via a caller-supplied lookup, so the two hosts can source env differently. */
export interface AskAiAuthConfig {
  /** True unless explicitly opted out. Absence means locked. */
  required: boolean
  /** Empty when unconfigured, which is a misconfiguration rather than an opening. */
  supabaseUrl: string
  anonKey: string
}

export function readAskAiAuthConfig(read: (name: string) => string): AskAiAuthConfig {
  return {
    // Exactly 'false', and absence requires auth. The inverse default — open unless
    // told otherwise — is the same shape of bug as a firewall that fails open: one
    // forgotten variable on one deploy, and the endpoint is anonymous.
    required: read('ASK_AI_REQUIRE_AUTH') !== 'false',
    // The un-prefixed name wins so a server-only override is possible, but the
    // client's own variables are accepted rather than demanding the same URL be
    // configured twice. Reading them here leaks nothing: both are already in the
    // browser bundle by construction.
    supabaseUrl: (read('SUPABASE_URL') || read('VITE_SUPABASE_URL')).replace(/\/+$/, ''),
    anonKey: read('SUPABASE_ANON_KEY') || read('VITE_SUPABASE_ANON_KEY'),
  }
}

/**
 * Pulls the credential out of an `Authorization` header.
 *
 * Returns '' rather than throwing or returning null: every caller's next move is
 * the same either way — refuse — and one empty-string check reads better than a
 * three-way union. A blank credential after the scheme counts as absent, so
 * `Bearer ` never reaches PostgREST as an empty token.
 */
export function bearerToken(header: string | null | undefined): string {
  if (!header) return ''
  const match = /^bearer[ \t]+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : ''
}

export type AskAiAuthResult =
  /** `userId` is null ONLY in opt-out mode, where there is no identity to report. */
  | { ok: true; userId: string | null }
  | { ok: false; status: number; error: string }

/**
 * Decides whether one caller may spend a request.
 *
 * Verification is a single PostgREST read of the caller's own `user_access` row,
 * which does three jobs at once and is why there is no separate JWT step:
 *
 * 1. PostgREST validates the token's signature and expiry, answering 401 if either
 *    fails. Checking it here as well would mean owning key rotation for no gain.
 * 2. RLS resolves `auth.uid()` from that token, and the `self or admin read
 *    user_access` policy returns exactly the caller's row — so the row that comes
 *    back cannot be someone else's.
 * 3. The row carries `status`, so a signed-in but unapproved account is refused in
 *    the same round trip. That matters: every account starts life as `pending`
 *    because `handle_new_user` makes it so, and a pending user spending tokens
 *    would bypass approval entirely.
 *
 * `fetchImpl` is injected rather than closed over so this is testable without a
 * network, and so the Vercel runtime's global `fetch` is not assumed.
 */
export async function authorizeAskAi(
  config: AskAiAuthConfig,
  token: string,
  fetchImpl: typeof fetch,
): Promise<AskAiAuthResult> {
  if (!config.required) return { ok: true, userId: null }

  if (!token) {
    return { ok: false, status: 401, error: 'Sign in to use the assistant.' }
  }

  // Required but unconfigured is a misconfiguration, and the only safe reading of
  // it is a refusal. Resolving it to "allowed" would mean a deploy that forgot its
  // Supabase values quietly served an open, billable endpoint — the exact failure
  // this module exists to prevent.
  if (!config.supabaseUrl || !config.anonKey) {
    return {
      ok: false,
      status: 500,
      error: 'The assistant cannot verify sign-ins: its Supabase settings are missing.',
    }
  }

  let res: Response
  try {
    res = await fetchImpl(`${config.supabaseUrl}/rest/v1/user_access?select=user_id,status`, {
      headers: {
        apikey: config.anonKey,
        // Both are required. The anon key alone would resolve auth.uid() to null and
        // return zero rows, which would read as "nobody is approved".
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
  } catch {
    return { ok: false, status: 503, error: 'Could not verify your session. Try again.' }
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: 401, error: 'Your session has expired. Sign in again.' }
  }
  if (!res.ok) {
    return { ok: false, status: 503, error: 'Could not verify your session. Try again.' }
  }

  let rows: unknown
  try {
    rows = await res.json()
  } catch {
    return { ok: false, status: 503, error: 'Could not verify your session. Try again.' }
  }
  if (!Array.isArray(rows)) {
    return { ok: false, status: 503, error: 'Could not verify your session. Try again.' }
  }

  const row = rows[0] as { user_id?: unknown; status?: unknown } | undefined
  if (!row) {
    return { ok: false, status: 403, error: 'Your account is awaiting admin approval.' }
  }
  if (row.status === 'revoked') {
    return { ok: false, status: 403, error: 'Your access has been revoked.' }
  }
  if (row.status !== 'approved') {
    return { ok: false, status: 403, error: 'Your account is awaiting admin approval.' }
  }

  return {
    ok: true,
    userId: typeof row.user_id === 'string' ? row.user_id : null,
  }
}

export interface RateLimitVerdict {
  allowed: boolean
  /** Whole seconds, because it is surfaced as a `Retry-After` header. */
  retryAfterSeconds: number
}

export interface RateLimiter {
  check(callerId: string, now: number): RateLimitVerdict
  /** Live entry count. Exported for a log line, and it makes pruning observable. */
  trackedCallers(): number
}

/**
 * A sliding-window per-caller ceiling.
 *
 * BEST EFFORT, and worth being precise about what that means: state is in memory in
 * one process, and a deployed function scales to many short-lived instances, so the
 * real allowance is this limit multiplied by however many instances happen to be
 * warm, and it resets on every cold start. It is a speed bump against one signed-in
 * account burning the budget, NOT a spend guarantee. The only hard ceiling is a
 * capped key at the provider; anything stronger here needs shared state in Postgres
 * or Redis, which is a bigger change than the risk currently justifies.
 *
 * `now` is a parameter so the whole thing is deterministic under test — no fake
 * timers, and no way for a clock read to sneak into a pure function.
 */
export function createRateLimiter(opts: { limit: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>()

  return {
    check(callerId, now) {
      const cutoff = now - opts.windowMs

      // Prune every caller, not just this one: otherwise an account that asks once
      // and never returns stays in the map for the life of the process.
      for (const [id, times] of hits) {
        const live = times.filter((t) => t > cutoff)
        if (live.length === 0) hits.delete(id)
        else hits.set(id, live)
      }

      const times = hits.get(callerId) ?? []
      if (times.length >= opts.limit) {
        // The window frees a slot when its OLDEST hit ages out, so that is what the
        // caller is waiting for — not the full window from now.
        const retryAfterSeconds = Math.max(1, Math.ceil((times[0] - cutoff) / 1000))
        return { allowed: false, retryAfterSeconds }
      }

      hits.set(callerId, [...times, now])
      return { allowed: true, retryAfterSeconds: 0 }
    },

    trackedCallers() {
      return hits.size
    },
  }
}

/**
 * Deliberately generous: a reader working through a dashboard asks a handful of
 * follow-ups, and a limit that interrupts normal use would get raised to something
 * meaningless the first time it fired.
 */
export const ASK_AI_RATE_LIMIT = { limit: 20, windowMs: 5 * 60_000 } as const

export interface AskAiRefusal {
  status: number
  error: string
  /** Present only on a 429, where it becomes the `Retry-After` header. */
  retryAfterSeconds?: number
}

/**
 * The whole gate, as one call. `null` means "let it through".
 *
 * Both hosts call exactly this, and that is the point rather than a convenience:
 * two call sites each doing authorize-then-limit in their own order is precisely how
 * dev comes to permit what production refuses. `server/askAi.ts` already exists for
 * the same reason on the provider side.
 */
export async function askAiGate(opts: {
  auth: AskAiAuthConfig
  limiter: RateLimiter
  authorizationHeader: string | null | undefined
  now: number
  fetchImpl: typeof fetch
}): Promise<AskAiRefusal | null> {
  const verdict = await authorizeAskAi(
    opts.auth,
    bearerToken(opts.authorizationHeader),
    opts.fetchImpl,
  )
  if (!verdict.ok) return { status: verdict.status, error: verdict.error }

  // No identity means opt-out mode. Counting those requests would put every caller
  // in one bucket keyed on nothing, so dev would begin refusing itself.
  if (verdict.userId === null) return null

  const rate = opts.limiter.check(verdict.userId, opts.now)
  if (rate.allowed) return null

  return {
    status: 429,
    error: `That is a lot of questions at once. Try again in ${rate.retryAfterSeconds} seconds.`,
    retryAfterSeconds: rate.retryAfterSeconds,
  }
}
