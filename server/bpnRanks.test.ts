import { describe, expect, it } from 'vitest'
import {
  BPN_FEATURE,
  bpnProbeBody,
  clampOffset,
  clampPageSize,
  isBpnAction,
  isValidDomain,
  serveBpnRanks,
} from './bpnRanks'
import { createRateLimiter, type EndpointAuthConfig } from './endpointAuth'

/**
 * The BPN core.
 *
 * Every test here targets a failure that does NOT announce itself. This endpoint
 * carries a credential to a third party, and the four things that can go wrong all
 * go wrong quietly: a widened pull that returns other people's data, a truncated
 * pull that reports success, an anonymous caller spending our key, and a
 * credentialled request aimed somewhere it was never meant to go. None of those
 * throw, so none of them are caught by `tsc -b`, `vite build`, or by using the app.
 */

// ─── Clamps ──────────────────────────────────────────────────────────────────

/**
 * THE COERCION TRAP, and the reason these are tested before anything else.
 *
 * `Number(null)` and `Number('')` are both `0`, and `0` is finite — so the
 * natural-looking guard `Number.isFinite(n) ? clamp(n) : fallback` reads an ABSENT
 * parameter as zero and clamps it to the minimum. For a page size that is one row
 * per page; one row is shorter than the page requested, so pagination terminates on
 * the first page and the import reports success having pulled a single keyword.
 * There is no error anywhere in that story, which is what makes it worth a test
 * rather than a comment.
 */
describe('clampPageSize', () => {
  it('falls back to the full page size when the parameter is absent', () => {
    expect(clampPageSize(null)).toBe(1000)
    expect(clampPageSize(undefined)).toBe(1000)
  })

  /** An empty or blank value is absence spelled differently. `Number(' ')` is 0 too. */
  it('treats blank as absent rather than as zero', () => {
    expect(clampPageSize('')).toBe(1000)
    expect(clampPageSize('   ')).toBe(1000)
  })

  it('clamps an explicit zero or negative to the minimum, not to the fallback', () => {
    // A caller who actually SENT 0 gets the clamp. The distinction matters: absence
    // must not be readable as an explicit request for the smallest possible page.
    expect(clampPageSize('0')).toBe(1)
    expect(clampPageSize('-500')).toBe(1)
  })

  it('clamps above the vendor ceiling and passes a sane value through', () => {
    expect(clampPageSize('5000')).toBe(1000)
    expect(clampPageSize('250')).toBe(250)
  })

  it('falls back for anything unparseable, and truncates a fraction', () => {
    expect(clampPageSize('abc')).toBe(1000)
    expect(clampPageSize('250.7')).toBe(250)
  })
})

describe('clampOffset', () => {
  it('starts at zero when absent', () => {
    expect(clampOffset(null)).toBe(0)
    expect(clampOffset('')).toBe(0)
  })

  it('refuses to go negative and passes a real offset through', () => {
    expect(clampOffset('-10')).toBe(0)
    expect(clampOffset('1000')).toBe(1000)
  })
})

// ─── Action allow-list ───────────────────────────────────────────────────────

describe('isBpnAction', () => {
  it('permits exactly the two read actions', () => {
    expect(isBpnAction('results')).toBe(true)
    expect(isBpnAction('domains')).toBe(true)
  })

  /**
   * `check_all` is the one this list exists for. It queues a sweep of ~1,727
   * keywords at ~7s each on a single-threaded queue — hours of vendor work that
   * nothing here can cancel, and a double-click would ask for twice.
   */
  it('refuses check_all and every other vendor action', () => {
    for (const action of ['check_all', 'history', 'run_status', 'CHECK_ALL', '']) {
      expect(isBpnAction(action)).toBe(false)
    }
  })

  it('is case-sensitive and rejects non-strings', () => {
    expect(isBpnAction('RESULTS')).toBe(false)
    expect(isBpnAction(undefined)).toBe(false)
    expect(isBpnAction(['results'])).toBe(false)
  })
})

// ─── Domain validation ───────────────────────────────────────────────────────

/**
 * Built from a char code rather than written as an escape sequence.
 *
 * These cases exist to pin down exactly WHICH byte is present, and a literal
 * control character in the source is both invisible in review and liable to be
 * rewritten by any tool that touches the file — an escape that silently became a
 * real newline would leave a test that still looks plausible while asserting
 * something else. The code is also what appears in the failure message.
 */
const inside = (code: number) => `haz${String.fromCharCode(code)}reviews.com`
const around = (code: number) => {
  const c = String.fromCharCode(code)
  return `${c}hazreviews.com${c}`
}
const label = (code: number) => `U+${code.toString(16).padStart(4, '0').toUpperCase()}`

describe('isValidDomain', () => {
  it('accepts ordinary hostnames', () => {
    for (const host of [
      'hazreviews.com',
      'gulfrecoverygroup.com',
      'casinoduelz.co.uk',
      'god-of-casino.com',
      'godof.casino',
      'xn--80ak6aa92e.com',
      'HAZREVIEWS.COM',
    ]) {
      expect(isValidDomain(host), host).toBe(true)
    }
  })

  /**
   * Each of these is a different way to aim a CREDENTIALLED outbound request
   * somewhere else, which is what makes the list worth enumerating one disguise at a
   * time rather than asserting a single regex.
   */
  it('refuses anything carrying a scheme, authority, path, port or second query', () => {
    for (const host of [
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      'hazreviews.com/../x',
      'hazreviews.com?api_key=stolen',
      'hazreviews.com&action=check_all',
      'hazreviews.com#frag',
      'user@evil.com',
      'hazreviews.com:8080',
      '%2Fevil.com',
    ]) {
      expect(isValidDomain(host), host).toBe(false)
    }
  })

  /**
   * The anchored-regex hole, and why the character check is a negated class searched
   * anywhere rather than `/^[a-z0-9.-]+$/`. In JavaScript `$` also matches
   * immediately before a trailing newline without the `m` flag, so the anchored form
   * accepts a value ending in one. An INTERIOR control character is the case that
   * survives trimming, and a browser stripping the tab out of `java\tscript:` after
   * a naive check has already approved the string is the same trick relocated.
   */
  it('refuses interior whitespace and control characters', () => {
    // NUL, tab, LF, CR, unit separator, space, DEL.
    for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x20, 0x7f]) {
      expect(isValidDomain(inside(code)), label(code)).toBe(false)
    }
  })

  /**
   * Surrounding whitespace is TRIMMED, so what remains is a genuinely valid host and
   * accepting it is right. Asserted next to the case above so the difference is
   * explicit rather than incidental: a trailing newline is stripped, an interior one
   * is fatal.
   */
  it('trims surrounding whitespace rather than rejecting it', () => {
    for (const code of [0x20, 0x09, 0x0a, 0x0d]) {
      expect(isValidDomain(around(code)), label(code)).toBe(true)
    }
  })

  /** NUL is not whitespace, so trim leaves it — and it must still be refused. */
  it('does not trim a trailing NUL into validity', () => {
    expect(isValidDomain(`hazreviews.com${String.fromCharCode(0)}`)).toBe(false)
  })

  it('refuses malformed label structure', () => {
    for (const host of [
      '',
      'hazreviews',
      '.hazreviews.com',
      'hazreviews.com.',
      'haz..reviews.com',
      '-hazreviews.com',
      'hazreviews-.com',
      `${'a'.repeat(64)}.com`,
      `${'a'.repeat(250)}.com`,
    ]) {
      expect(isValidDomain(host), JSON.stringify(host)).toBe(false)
    }
  })

  /**
   * A bare IP is how a proxy gets pointed at a cloud metadata service, and the panel
   * indexes domains — so an alphabetic TLD is required rather than merely preferred.
   */
  it('refuses bare IPs and single-label hosts', () => {
    for (const host of ['127.0.0.1', '169.254.169.254', 'localhost', '[::1]']) {
      expect(isValidDomain(host), host).toBe(false)
    }
  })
})

// ─── serveBpnRanks ───────────────────────────────────────────────────────────

const OPEN: EndpointAuthConfig = { required: false, supabaseUrl: '', anonKey: '' }
const GATED: EndpointAuthConfig = {
  required: true,
  supabaseUrl: 'https://proj.supabase.co',
  anonKey: 'anon-key',
}

const KEYED = { apiKey: 'bpn_test_key' }

/** One vendor row, in the shape the live panel actually returns. */
const row = (keyword: string) => ({
  domain: 'gulfrecoverygroup.com',
  keyword,
  country: 'AE',
  language: 'ar',
  position: 0,
  previous_position: 9,
  change: 9,
  url_found: null,
  checked_at: '2026-08-17 03:29:21',
  project_id: 18,
})

/**
 * Answers each upstream request from `pages`, recording every URL it was asked for.
 *
 * A fresh `Response` per call, because a body can only be read once — reusing one
 * makes the second page fail to parse, which then looks like a vendor problem rather
 * than a test problem.
 */
function fakeUpstream(pages: Array<{ data: unknown[]; total?: number }>) {
  const urls: string[] = []
  const headers: Array<Record<string, string>> = []
  let call = 0
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input))
    headers.push(
      Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
    )
    const page = pages[call] ?? { data: [] }
    call += 1
    return new Response(
      JSON.stringify({ ok: true, meta: { total: page.total ?? page.data.length }, data: page.data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as unknown as typeof fetch
  return { impl, urls, headers }
}

const serve = (over: Partial<Parameters<typeof serveBpnRanks>[0]> = {}) =>
  serveBpnRanks({
    method: 'GET',
    params: new URLSearchParams(),
    authorizationHeader: null,
    config: KEYED,
    auth: OPEN,
    limiter: createRateLimiter({ limit: 100, windowMs: 60_000 }),
    now: 1_000,
    fetchImpl: fakeUpstream([]).impl,
    ...over,
  })

describe('serveBpnRanks — method and probe', () => {
  /**
   * `check_all` is a POST upstream. Refusing every non-GET means the sweep stays
   * unreachable through this endpoint even if the allow-list were widened by
   * accident.
   */
  it('refuses every method except GET, and says which is allowed', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await serve({ method })
      expect(res.status, method).toBe(405)
      expect(res.headers.Allow).toBe('GET')
    }
  })

  /**
   * Answers before the gate, on purpose. A signed-out page has to be able to say why
   * the control is disabled; gating the explanation makes "no key configured" and
   * "not signed in" indistinguishable from outside.
   */
  it('answers the probe anonymously, without reaching upstream', async () => {
    const upstream = fakeUpstream([{ data: [row('k')] }])
    const res = await serve({ auth: GATED, authorizationHeader: null, fetchImpl: upstream.impl })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ranks: 'ready' })
    expect(upstream.urls).toEqual([])
  })

  it('reports itself unconfigured when no key is set', async () => {
    const res = await serve({ config: { apiKey: '' } })
    expect(res.body).toMatchObject({ ranks: 'unconfigured' })
  })

  /**
   * JSON, so a static host answering an unknown path with index.html and a 200
   * cannot read as ready — the same trap the assistant's probe avoids.
   */
  it('always answers JSON', async () => {
    const res = await serve()
    expect(res.headers['Content-Type']).toBe('application/json')
  })

  it('never reports the key or the vendor host in the probe', () => {
    expect(JSON.stringify(bpnProbeBody(KEYED))).not.toContain('bpn_test_key')
    expect(JSON.stringify(bpnProbeBody({ apiKey: '' }))).not.toContain('3213211')
  })
})

describe('serveBpnRanks — the gate', () => {
  /**
   * The load-bearing one. Ungated this is an open proxy onto the vendor's whole
   * panel — 135 domains belonging to other properties — billed to our key, with
   * nothing in the UI to show it happening.
   */
  it('refuses an anonymous data request without reaching upstream', async () => {
    const upstream = fakeUpstream([{ data: [row('k')] }])
    const res = await serve({
      auth: GATED,
      authorizationHeader: null,
      params: new URLSearchParams({ action: 'results', domain: 'gulfrecoverygroup.com' }),
      fetchImpl: upstream.impl,
    })
    expect(res.status).toBe(401)
    expect(upstream.urls).toEqual([])
  })

  /**
   * A refused user is told to sign in to THIS feature. Inheriting the assistant's
   * copy would send someone who clicked Import off to investigate a feature they
   * never touched — and read as a bug there rather than a sign-in prompt here.
   */
  it('names the ranking import in the refusal, not the assistant', async () => {
    const res = await serve({
      auth: GATED,
      authorizationHeader: null,
      params: new URLSearchParams({ action: 'domains' }),
    })
    expect(res.body).toEqual({ error: 'Sign in to import ranking data.' })
    expect(BPN_FEATURE.signInTo).not.toContain('assistant')
  })

  /**
   * Ordering, asserted directly: the gate runs BEFORE the allow-list, so an
   * anonymous caller learns nothing about which actions exist and cannot use a
   * rejected action to probe the endpoint's shape.
   */
  it('gates before it validates the action', async () => {
    const res = await serve({
      auth: GATED,
      authorizationHeader: null,
      params: new URLSearchParams({ action: 'check_all' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('serveBpnRanks — allow-list and validation', () => {
  it('refuses a non-allow-listed action with 403 and lists what is allowed', async () => {
    const upstream = fakeUpstream([{ data: [row('k')] }])
    const res = await serve({
      params: new URLSearchParams({ action: 'check_all' }),
      fetchImpl: upstream.impl,
    })
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ error: expect.stringContaining('results, domains') })
    expect(upstream.urls).toEqual([])
  })

  it('requires a domain for a rankings pull', async () => {
    const upstream = fakeUpstream([{ data: [row('k')] }])
    const res = await serve({
      params: new URLSearchParams({ action: 'results' }),
      fetchImpl: upstream.impl,
    })
    expect(res.status).toBe(400)
    expect(upstream.urls).toEqual([])
  })

  it('refuses an invalid domain before spending a credentialled request', async () => {
    const upstream = fakeUpstream([{ data: [row('k')] }])
    const res = await serve({
      params: new URLSearchParams({ action: 'results', domain: 'https://evil.com/x' }),
      fetchImpl: upstream.impl,
    })
    expect(res.status).toBe(400)
    expect(upstream.urls).toEqual([])
  })

  it('answers 503 when authorized but unconfigured', async () => {
    const res = await serve({
      config: { apiKey: '' },
      params: new URLSearchParams({ action: 'domains' }),
    })
    expect(res.status).toBe(503)
  })
})

describe('serveBpnRanks — the upstream request', () => {
  it('pins project_id to 18 and ignores a caller-supplied one', async () => {
    const upstream = fakeUpstream([{ data: [row('k')] }])
    await serve({
      params: new URLSearchParams({
        action: 'results',
        domain: 'gulfrecoverygroup.com',
        project_id: '0',
      }),
      fetchImpl: upstream.impl,
    })
    const query = new URL(upstream.urls[0]).searchParams
    // `project_id=0` upstream does not filter — PHP reads 0 as falsy and returns
    // every project the key can see. So a caller-supplied 0 would WIDEN the pull.
    expect(query.getAll('project_id')).toEqual(['18'])
  })

  it('sends the key as a bearer header and never in the query string', async () => {
    const upstream = fakeUpstream([{ data: [row('k')] }])
    await serve({
      params: new URLSearchParams({ action: 'domains' }),
      fetchImpl: upstream.impl,
    })
    expect(upstream.headers[0].authorization).toBe('Bearer bpn_test_key')
    // A query string is what lands in the vendor's access logs and any
    // intermediary's.
    expect(upstream.urls[0]).not.toContain('bpn_test_key')
    expect(upstream.urls[0]).not.toContain('api_key')
  })

  it('forwards the domain lowercased', async () => {
    const upstream = fakeUpstream([{ data: [row('k')] }])
    await serve({
      params: new URLSearchParams({ action: 'results', domain: 'GulfRecoveryGroup.COM' }),
      fetchImpl: upstream.impl,
    })
    expect(new URL(upstream.urls[0]).searchParams.get('domain')).toBe('gulfrecoverygroup.com')
  })

  /** No caller parameter may become part of the upstream query except the ones the
   *  core chooses. A stray passthrough is how `keyword=` or `from=` would silently
   *  reshape a pull that the review panel then presents as a full week. */
  it('forwards only the parameters the core decided on', async () => {
    const upstream = fakeUpstream([{ data: [row('k')] }])
    await serve({
      params: new URLSearchParams({
        action: 'results',
        domain: 'gulfrecoverygroup.com',
        keyword: 'sneaky',
        from: '2020-01-01',
        api_key: 'attacker-supplied',
      }),
      fetchImpl: upstream.impl,
    })
    const keys = [...new URL(upstream.urls[0]).searchParams.keys()].sort()
    expect(keys).toEqual(['action', 'domain', 'limit', 'offset', 'project_id'])
  })
})

describe('serveBpnRanks — pagination', () => {
  it('walks pages until one comes back short, and returns every row', async () => {
    const upstream = fakeUpstream([
      { data: Array.from({ length: 3 }, (_, i) => row(`a${i}`)) },
      { data: Array.from({ length: 3 }, (_, i) => row(`b${i}`)) },
      { data: [row('c0')] },
    ])
    const res = await serve({
      params: new URLSearchParams({
        action: 'results',
        domain: 'gulfrecoverygroup.com',
        limit: '3',
      }),
      fetchImpl: upstream.impl,
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ rowCount: 7, pages: 3, truncated: false })
    expect(upstream.urls.map((u) => new URL(u).searchParams.get('offset'))).toEqual(['0', '3', '6'])
  })

  /**
   * The whole reason termination is on a short page. `meta.total` has been seen
   * disagreeing with the array it describes, and `action=domains` reports a count of
   * DOMAINS under the same key — so a pull that trusted it would import a PREFIX of
   * the keywords and report success. That prefix then becomes the newest snapshot
   * every delta is measured against.
   */
  it('ignores a meta.total that understates the data', async () => {
    const upstream = fakeUpstream([
      { data: Array.from({ length: 3 }, (_, i) => row(`a${i}`)), total: 3 },
      { data: Array.from({ length: 3 }, (_, i) => row(`b${i}`)), total: 3 },
      { data: [], total: 3 },
    ])
    const res = await serve({
      params: new URLSearchParams({
        action: 'results',
        domain: 'gulfrecoverygroup.com',
        limit: '3',
      }),
      fetchImpl: upstream.impl,
    })
    // Six rows behind a reported total of three, and all six arrive.
    expect(res.body).toMatchObject({ rowCount: 6, reportedTotal: 3 })
  })

  /** An exact multiple costs one extra request, which is the price of the rule. */
  it('makes one more request when the last full page was the last page', async () => {
    const upstream = fakeUpstream([
      { data: Array.from({ length: 2 }, (_, i) => row(`a${i}`)) },
      { data: [] },
    ])
    const res = await serve({
      params: new URLSearchParams({
        action: 'results',
        domain: 'gulfrecoverygroup.com',
        limit: '2',
      }),
      fetchImpl: upstream.impl,
    })
    expect(res.body).toMatchObject({ rowCount: 2, pages: 2 })
  })

  /**
   * The absent-limit path, end to end. With the clamp broken this pulls one row and
   * reports success — so it is asserted through the endpoint and not only against
   * the clamp in isolation.
   */
  it('uses the full page size when no limit is given', async () => {
    const upstream = fakeUpstream([{ data: [row('only')] }])
    const res = await serve({
      params: new URLSearchParams({ action: 'results', domain: 'gulfrecoverygroup.com' }),
      fetchImpl: upstream.impl,
    })
    expect(new URL(upstream.urls[0]).searchParams.get('limit')).toBe('1000')
    expect(res.body).toMatchObject({ rowCount: 1, pages: 1 })
  })

  /**
   * A vendor answering full pages forever must not hold the function open to its
   * maxDuration — and the caller has to be TOLD rows are missing, or a truncated
   * pull is indistinguishable from a complete one.
   */
  it('stops at the page ceiling and says the pull was truncated', async () => {
    const upstream = fakeUpstream(Array.from({ length: 40 }, () => ({ data: [row('x')] })))
    const res = await serve({
      params: new URLSearchParams({
        action: 'results',
        domain: 'gulfrecoverygroup.com',
        limit: '1',
      }),
      fetchImpl: upstream.impl,
    })
    expect(res.body).toMatchObject({ truncated: true, pages: 25 })
  })
})

describe('serveBpnRanks — upstream failures', () => {
  const failing = (status: number, body: unknown) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch

  /**
   * Our misconfiguration, not the caller's. Forwarding the 401 would show a
   * signed-in user a sign-in error about a credential they do not hold and cannot
   * fix.
   */
  it('maps an upstream 401 to a 502 that blames our key', async () => {
    const res = await serve({
      params: new URLSearchParams({ action: 'domains' }),
      fetchImpl: failing(401, { ok: false, error: 'Invalid or revoked API key.' }),
    })
    expect(res.status).toBe(502)
    expect(res.body).toMatchObject({ error: expect.stringContaining('our API key') })
  })

  /**
   * The vendor signals some failures in the body with a 200, so `ok:false` has to be
   * read rather than inferred from the status line.
   */
  it('treats ok:false as a failure even behind a 200', async () => {
    const res = await serve({
      params: new URLSearchParams({ action: 'domains' }),
      fetchImpl: failing(200, { ok: false, error: 'Unknown action' }),
    })
    expect(res.status).toBe(502)
  })

  it('refuses a response with no data array', async () => {
    const res = await serve({
      params: new URLSearchParams({ action: 'domains' }),
      fetchImpl: failing(200, { ok: true, meta: { total: 0 } }),
    })
    expect(res.status).toBe(502)
  })

  it('surfaces a transport failure as 504 rather than throwing', async () => {
    const res = await serve({
      params: new URLSearchParams({ action: 'domains' }),
      fetchImpl: (() => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch,
    })
    expect(res.status).toBe(504)
  })

  /**
   * Zero rows is NOT an error at this layer. The endpoint reports honestly and the
   * client refuses to build a snapshot from it — see `src/lib/bpnRows.ts` on why an
   * empty snapshot must never be written.
   */
  it('returns an empty pull as a successful zero-row response', async () => {
    const res = await serve({
      params: new URLSearchParams({ action: 'results', domain: 'hazreviews.com' }),
      fetchImpl: fakeUpstream([{ data: [] }]).impl,
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ rowCount: 0, rows: [] })
  })
})
