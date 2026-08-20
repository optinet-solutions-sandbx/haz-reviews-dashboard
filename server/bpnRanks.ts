import {
  endpointGate,
  type EndpointAuthConfig,
  type EndpointFeature,
  type RateLimiter,
} from './endpointAuth.js'

/**
 * The BPN ranks integration, entire.
 *
 * Every decision about talking to the vendor lives here exactly once — the action
 * allow-list, the pinned project id, the page-size and offset clamps, hostname
 * validation, the timeout, and the pagination rule. `vite/bpnRanksProxy.ts` and
 * `api/bpn-ranks.ts` are signature adapters and nothing more: they read env, call
 * `serveBpnRanks`, and write whatever it returns. Neither of them decides anything.
 *
 * That split is not tidiness. Those two hosts are two different calling conventions
 * (Connect middleware in dev, a Web `Request`/`Response` on Vercel), and any rule
 * written twice is a rule that will eventually differ between them — dev permitting
 * what production refuses, or the reverse, with the whole class of bug invisible to
 * `tsc -b`, `vite build` and the suite. `server/askAi.ts` and `server/endpointAuth.ts`
 * already exist for exactly this reason.
 *
 * WHY A PROXY AT ALL — two independent reasons, either sufficient on its own:
 *
 * 1. The key must stay out of the bundle. Vite inlines every `VITE_`-prefixed
 *    variable into client JS, so a key reachable from the browser is readable in
 *    devtools forever (CLAUDE.md invariant 27). `SITES_API_KEY` is read in Node.
 * 2. The upstream is a third-party origin, so a direct browser call is refused by
 *    CORS regardless of where the key lives.
 *
 * The browser therefore knows one path — `/api/bpn-ranks` — and nothing else: not
 * the vendor host, not the key, not the upstream action names. `dist/` is grepped
 * for all three.
 *
 * See docs/integrations/BPN_API.md for the vendor reference and, more importantly,
 * for the five ways its data is wrong in a direction that does not error.
 */

// ─── Pinned decisions ────────────────────────────────────────────────────────

/**
 * A module constant rather than configuration, deliberately.
 *
 * An env override would be one more way for our credential to be sent to a host
 * nobody audited — a typo in a hosting dashboard is enough. A vendor move is a code
 * change and a deploy, which is the correct amount of friction for "where do we send
 * the API key". It also keeps the `dist/` grep meaningful: this string appears in
 * server code only, so finding it in a bundle means something has genuinely leaked.
 */
const BPN_BASE_URL = 'https://3213211.xyz/bpn-panel-cc/api/ranks.php'

/**
 * A LITERAL, never a caller parameter.
 *
 * `project_id=0` does not filter — PHP treats `0` as falsy, drops the condition and
 * returns every project the key can see. So a caller that omitted it, or sent `0`,
 * or sent a string that coerced to `0`, would silently WIDEN the pull rather than
 * narrow it. There is no value of this parameter a caller could usefully supply, so
 * it is not accepted from one.
 */
const BPN_PROJECT_ID = 18

/**
 * The allow-list, and the reason it is an allow-list rather than a deny-list.
 *
 * `check_all` is the one that matters: it starts a full-project sweep of ~1,727
 * keywords on a single-threaded queue at roughly 7 seconds each — hours of vendor
 * work that nothing in our UI can cancel, kicked off by a double-click. `history`
 * and `run_status` are merely unused. Enumerating what is permitted means a vendor
 * action added next month is refused by default instead of proxied by default.
 */
const ALLOWED_ACTIONS = ['results', 'domains'] as const
export type BpnAction = (typeof ALLOWED_ACTIONS)[number]

export function isBpnAction(value: unknown): value is BpnAction {
  return typeof value === 'string' && (ALLOWED_ACTIONS as readonly string[]).includes(value)
}

/** Per upstream request, not per pull: a paginated pull gets this much per page. */
const BPN_TIMEOUT_MS = 20_000

/** The vendor's own documented ceiling is 1,000; asking for more just gets 1,000. */
const PAGE_SIZE = { min: 1, max: 1000, fallback: 1000 } as const
const OFFSET = { min: 0, max: 1_000_000, fallback: 0 } as const

/**
 * A runaway guard, not a data limit. At the default page size this allows 25,000
 * rows, comfortably above the 1,922 the whole panel currently holds. It exists so a
 * vendor that started answering full pages forever cannot hold a serverless
 * function open until its `maxDuration`; when it trips, the response SAYS so rather
 * than quietly returning a prefix (see `truncated` below).
 */
const MAX_PAGES = 25

/**
 * Lower than Ask AI's 20, because one click here is several upstream requests
 * against somebody else's single-threaded panel rather than one call to a provider
 * built for concurrency. Still generous for a human clicking Fetch.
 *
 * Same caveat as the assistant's limiter, and it bears repeating rather than being
 * inferred: this is in memory, per instance. A deployed function scales out and
 * resets on cold start, so the real allowance is this number times however many
 * instances are warm. A speed bump against one account hammering the vendor, NOT a
 * guarantee to the vendor about our request rate.
 */
export const BPN_RATE_LIMIT = { limit: 12, windowMs: 5 * 60_000 } as const

/**
 * How the shared gate names this feature when it refuses somebody.
 *
 * Its own name, not the assistant's. A user who clicked Import and was told to
 * "sign in to use the assistant" would go and investigate a feature they never
 * touched, and read the mismatch as a bug rather than as a sign-in prompt.
 */
export const BPN_FEATURE: EndpointFeature = {
  signInTo: 'import ranking data',
  subject: 'The ranking import',
  requests: 'imports',
}

// ─── Configuration ───────────────────────────────────────────────────────────

export interface BpnConfig {
  /** Empty when unconfigured. NEVER `VITE_`-prefixed — invariant 27. */
  apiKey: string
}

export function readBpnConfig(read: (name: string) => string): BpnConfig {
  return { apiKey: read('SITES_API_KEY').trim() }
}

export const BPN_UNCONFIGURED =
  'Ranking-API imports are not configured on this server: SITES_API_KEY is missing.'

/**
 * The readiness probe body.
 *
 * Reports only whether a key is configured — never the key, never the vendor host.
 * It is the one thing here that stays open to anonymous callers, for the same
 * reason Ask AI's `GET` does: a signed-out page has to be able to explain why the
 * control is disabled, and gating the explanation makes "not configured" and "not
 * signed in" indistinguishable from the outside.
 */
export function bpnProbeBody(config: BpnConfig): { ranks: 'ready' | 'unconfigured'; reason?: string } {
  return config.apiKey ? { ranks: 'ready' } : { ranks: 'unconfigured', reason: BPN_UNCONFIGURED }
}

// ─── Clamps ──────────────────────────────────────────────────────────────────

/**
 * Absence is tested BEFORE any coercion, and that ordering is the whole point.
 *
 * `Number(null)`, `Number(undefined && '')` and `Number('')` are `0` — and `0` is
 * finite. So the natural-looking guard
 *
 *     Number.isFinite(n) ? clamp(n) : fallback
 *
 * treats an ABSENT parameter as zero and clamps it to the MINIMUM. For a page size
 * that means one row per page; one row is shorter than the page requested, so the
 * pagination below terminates immediately and reports a successful import of a
 * single keyword. No error, no warning, and a snapshot that looks like a real one.
 *
 * `Number(' ')` is also 0, hence the trim. `Number('12abc')` is NaN, which does
 * fall through to the fallback.
 */
function clampNumeric(
  raw: string | null | undefined,
  bounds: { min: number; max: number; fallback: number },
): number {
  if (raw === null || raw === undefined || raw.trim() === '') return bounds.fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return bounds.fallback
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(n)))
}

export const clampPageSize = (raw: string | null | undefined) => clampNumeric(raw, PAGE_SIZE)
export const clampOffset = (raw: string | null | undefined) => clampNumeric(raw, OFFSET)

// ─── Domain validation ───────────────────────────────────────────────────────

/** Labels of 1–63 chars, no leading or trailing hyphen, and an alphabetic TLD. */
const DOMAIN_SHAPE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
/** Searched for ANYWHERE in the value — see below on why anchors are not enough. */
const FORBIDDEN_CHAR = /[^a-z0-9.-]/

/**
 * True only for something that is unambiguously a hostname.
 *
 * This value is interpolated into a URL we then fetch WITH OUR CREDENTIAL
 * ATTACHED, so the question is not "is it tidy" but "could it aim that
 * credentialled request somewhere else". A scheme, an authority, a path, a port or
 * a second query string all could.
 *
 * The character check is a NEGATED CLASS searched anywhere, not an anchored
 * allow-list, and that is deliberate. In JavaScript `$` also matches immediately
 * before a trailing newline even without the `m` flag, so `/^[a-z0-9.-]+$/` happily
 * accepts `"example.com\n"` — and control characters are a real route in rather
 * than a curiosity, because a browser strips the tab out of `java\tscript:` AFTER a
 * naive check has looked at the string and seen nothing alarming. Restricting the
 * alphabet by searching for any character outside it rejects every such disguise,
 * newline and NUL included, before shape is even considered.
 *
 * Note what this is NOT carrying alone: the upstream URL is assembled with
 * `URLSearchParams`, which already encodes `&`, `?` and `#` so they cannot become
 * syntax. Validation is the second layer, and it earns its place three ways — it
 * refuses to spend a credentialled round trip on input that cannot be a domain, it
 * gives the user a message they can act on instead of an opaque vendor error, and
 * it is what stops a future change in how that URL is built (a path segment, say)
 * from turning a cosmetic edit into an SSRF.
 *
 * Bare IPs and `localhost` are rejected by the alphabetic-TLD rule, which is the
 * behaviour we want: the panel indexes domains, and an IP is how a proxy gets
 * pointed at a metadata service.
 */
export function isValidDomain(value: string): boolean {
  const host = value.trim().toLowerCase()
  if (host === '' || host.length > 253) return false
  if (FORBIDDEN_CHAR.test(host)) return false
  if (host.includes('..')) return false
  return DOMAIN_SHAPE.test(host)
}

/** Hostnames are case-insensitive; the vendor's index is lowercase. */
export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase()
}

// ─── Upstream ────────────────────────────────────────────────────────────────

interface UpstreamPage {
  rows: unknown[]
  /** Recorded for diagnostics and NEVER used to decide anything. See below. */
  reportedTotal: number | null
}

type UpstreamOutcome = { ok: true; page: UpstreamPage } | { ok: false; status: number; error: string }

async function fetchUpstreamPage(
  config: BpnConfig,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<UpstreamOutcome> {
  const query = new URLSearchParams({ ...params, project_id: String(BPN_PROJECT_ID) })
  const url = `${BPN_BASE_URL}?${query.toString()}`

  // A timeout is not optional here: without one, a vendor that accepts the
  // connection and never answers holds a serverless invocation open until
  // maxDuration and bills the whole wait.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BPN_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        // The header form, not `?api_key=`. Same credential either way, but a query
        // string is what ends up in the vendor's access logs and in any
        // intermediary's.
        Authorization: `Bearer ${config.apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
  } catch (err) {
    const aborted = (err as { name?: unknown } | null)?.name === 'AbortError'
    return {
      ok: false,
      status: 504,
      error: aborted
        ? `The ranking panel did not answer within ${BPN_TIMEOUT_MS / 1000} seconds.`
        : 'Could not reach the ranking panel.',
    }
  } finally {
    clearTimeout(timer)
  }

  // Upstream auth failures are OUR misconfiguration, not the caller's, and must not
  // be forwarded as-is: a 401 reaching the browser would show a signed-in user a
  // sign-in error for a credential they do not have and cannot fix.
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      status: 502,
      error: 'The ranking panel rejected our API key. It may have been revoked or rescoped.',
    }
  }
  if (!res.ok) {
    return { ok: false, status: 502, error: `The ranking panel answered ${res.status}.` }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, status: 502, error: 'The ranking panel returned a malformed response.' }
  }

  const envelope = body as { ok?: unknown; error?: unknown; data?: unknown; meta?: unknown } | null
  // The vendor signals failure in the BODY with a 200 on at least some paths, so an
  // `ok: false` has to be read rather than inferred from the status code.
  if (envelope?.ok === false) {
    const detail = typeof envelope.error === 'string' ? envelope.error : 'unspecified error'
    return { ok: false, status: 502, error: `The ranking panel refused the request: ${detail}` }
  }
  if (!Array.isArray(envelope?.data)) {
    return { ok: false, status: 502, error: 'The ranking panel returned no data array.' }
  }

  const total = (envelope?.meta as { total?: unknown } | undefined)?.total
  return {
    ok: true,
    page: {
      rows: envelope.data,
      reportedTotal: typeof total === 'number' && Number.isFinite(total) ? total : null,
    },
  }
}

export interface BpnPull {
  rows: unknown[]
  pages: number
  /**
   * What the vendor SAID the total was, on the first page. Surfaced so a
   * disagreement with `rows.length` is visible rather than swallowed — it is
   * reported, never trusted.
   */
  reportedTotal: number | null
  /** True when MAX_PAGES stopped the walk, so the caller knows rows are missing. */
  truncated: boolean
}

/**
 * Walks every page and returns all the rows.
 *
 * TERMINATION IS ON A SHORT PAGE, never on `meta.total`. That field has been seen
 * disagreeing with the array it describes (135 reported for 154 rows), and
 * `action=domains` reports a count of DOMAINS under the same key — so any caller
 * using it as a row budget is trusting a number the vendor computes with a
 * different query from the one that filled `data`. A pull that stops early on a bad
 * count does not error: it imports a prefix of the keywords and reports success,
 * which then becomes the newest snapshot every delta is measured against.
 *
 * A page shorter than the size requested is the only self-consistent end signal,
 * and it costs exactly one extra request in the case where the total was a clean
 * multiple of the page size.
 */
async function pullAllPages(
  config: BpnConfig,
  base: Record<string, string>,
  pageSize: number,
  startOffset: number,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; pull: BpnPull } | { ok: false; status: number; error: string }> {
  const rows: unknown[] = []
  let reportedTotal: number | null = null
  let offset = startOffset
  let pages = 0

  while (pages < MAX_PAGES) {
    const outcome = await fetchUpstreamPage(
      config,
      { ...base, limit: String(pageSize), offset: String(offset) },
      fetchImpl,
    )
    if (!outcome.ok) return outcome

    pages += 1
    if (pages === 1) reportedTotal = outcome.page.reportedTotal
    rows.push(...outcome.page.rows)

    if (outcome.page.rows.length < pageSize) {
      return { ok: true, pull: { rows, pages, reportedTotal, truncated: false } }
    }
    offset += pageSize
  }

  return { ok: true, pull: { rows, pages, reportedTotal, truncated: true } }
}

// ─── The endpoint ────────────────────────────────────────────────────────────

export interface BpnResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const jsonResponse = (status: number, body: unknown, extra?: Record<string, string>): BpnResponse => ({
  status,
  headers: extra ? { ...JSON_HEADERS, ...extra } : JSON_HEADERS,
  body,
})

/**
 * The whole endpoint, for both hosts.
 *
 * The ORDER below is the part worth protecting, which is why it is here and not
 * repeated in two host files:
 *
 * 1. Method. GET only — every action here is a read, and refusing everything else
 *    is what keeps `check_all` (a POST) unreachable even if the allow-list were
 *    somehow widened.
 * 2. No `action` at all means the readiness probe, which is deliberately OPEN and
 *    answers before the gate. It reveals only whether a key is configured.
 * 3. The gate — the SHARED one, `endpointGate`, not a second hand-written sequence.
 *    Ungated this is an open proxy onto the vendor's entire panel: 135 domains
 *    belonging to other properties, every request billed to our key and counted
 *    against the vendor's rate limits, with nothing in our UI to show it happening.
 * 4. Only then is the action validated, the domain checked and the key even read.
 *
 * Nothing before step 3 touches `config.apiKey`, so an anonymous caller cannot
 * cause an upstream request or learn anything about the credential.
 */
export async function serveBpnRanks(opts: {
  method: string | undefined
  params: URLSearchParams
  authorizationHeader: string | null | undefined
  config: BpnConfig
  auth: EndpointAuthConfig
  limiter: RateLimiter
  now: number
  fetchImpl: typeof fetch
}): Promise<BpnResponse> {
  if ((opts.method ?? 'GET').toUpperCase() !== 'GET') {
    return jsonResponse(405, { error: 'This endpoint only accepts GET.' }, { Allow: 'GET' })
  }

  const rawAction = opts.params.get('action')
  if (rawAction === null || rawAction.trim() === '') {
    return jsonResponse(200, bpnProbeBody(opts.config))
  }

  const refusal = await endpointGate({
    auth: opts.auth,
    feature: BPN_FEATURE,
    limiter: opts.limiter,
    authorizationHeader: opts.authorizationHeader,
    now: opts.now,
    fetchImpl: opts.fetchImpl,
  })
  if (refusal) {
    return jsonResponse(
      refusal.status,
      { error: refusal.error },
      refusal.retryAfterSeconds ? { 'Retry-After': String(refusal.retryAfterSeconds) } : undefined,
    )
  }

  const action = rawAction.trim()
  if (!isBpnAction(action)) {
    // Names what IS allowed. The refused caller is us, in a browser or a terminal,
    // and "unknown action" with no list means reading this file to find out.
    return jsonResponse(403, {
      error: `Action '${action}' is not allowed. Allowed: ${ALLOWED_ACTIONS.join(', ')}.`,
    })
  }

  if (!opts.config.apiKey) {
    // 503, matching the assistant: "not configured" is a different state from "the
    // request failed", and the UI says a different thing for each.
    return jsonResponse(503, { error: BPN_UNCONFIGURED })
  }

  const base: Record<string, string> = { action }

  if (action === 'results') {
    const rawDomain = opts.params.get('domain') ?? ''
    // Required, though the vendor makes it optional. An unfiltered `results` pull
    // returns the whole panel — 1,922 rows across 135 domains belonging to other
    // properties — and there is no screen here that wants that. Refusing it means
    // the widest thing this endpoint can ever hand back is one domain's rankings.
    if (rawDomain.trim() === '') {
      return jsonResponse(400, { error: 'A domain is required for a rankings pull.' })
    }
    if (!isValidDomain(rawDomain)) {
      return jsonResponse(400, {
        error: `'${rawDomain}' is not a valid domain. Expected a bare hostname such as example.com.`,
      })
    }
    base.domain = normalizeDomain(rawDomain)
  }

  const outcome = await pullAllPages(
    opts.config,
    base,
    clampPageSize(opts.params.get('limit')),
    clampOffset(opts.params.get('offset')),
    opts.fetchImpl,
  )
  if (!outcome.ok) return jsonResponse(outcome.status, { error: outcome.error })

  return jsonResponse(200, {
    ok: true,
    action,
    domain: base.domain ?? null,
    rowCount: outcome.pull.rows.length,
    pages: outcome.pull.pages,
    reportedTotal: outcome.pull.reportedTotal,
    truncated: outcome.pull.truncated,
    rows: outcome.pull.rows,
  })
}
