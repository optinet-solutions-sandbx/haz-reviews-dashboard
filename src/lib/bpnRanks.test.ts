import { afterEach, describe, expect, it, vi } from 'vitest'
import { BPN_ENDPOINT, fetchBpnResults, probeBpnRanks } from './bpnRanks'

/**
 * The browser client.
 *
 * Two things are worth testing here and the rest is plumbing: that a CANCELLED probe
 * can never become a verdict about the endpoint (invariant 33, learned the hard way
 * on the assistant's probe), and that this module never learns anything about the
 * vendor.
 */

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const stub = (impl: (input: unknown, init?: RequestInit) => Promise<Response>) => {
  const spy = vi.fn(impl)
  globalThis.fetch = spy as unknown as typeof fetch
  return spy
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// ─── The endpoint it talks to ────────────────────────────────────────────────

describe('what this module knows', () => {
  /**
   * The bundle grep, as a unit test. `dist/` is also grepped after a build, but that
   * only happens when somebody remembers to do it; this runs on every commit.
   *
   * It asserts on the vendor's IDENTIFIERS and on the key's own prefix — never on the
   * env variable's NAME. Naming `SITES_API_KEY` in a message is not a leak, and the
   * server's unconfigured reason deliberately does name it so a developer knows what
   * to set (the same convention `UNCONFIGURED` follows for `OPENAI_API_KEY`). What
   * must never appear is a credential or a route to the upstream.
   */
  it('knows our own path and nothing about the vendor', async () => {
    const source = await import('./bpnRanks?raw').then(
      (m) => (m as unknown as { default: string }).default,
      // Vitest resolves `?raw` through Vite; if that ever stops working, fail loudly
      // rather than passing by having imported nothing.
      () => null,
    )
    expect(BPN_ENDPOINT).toBe('/api/bpn-ranks')
    expect(source, 'could not read the module source to check it').not.toBeNull()
    expect(source).not.toContain('3213211')
    expect(source).not.toContain('bpn-panel-cc')
    expect(source).not.toContain('ranks.php')
    expect(source).not.toContain('api_key')
    expect(source).not.toContain('bpn_')
    expect(source).not.toContain('project_id')
  })
})

// ─── probeBpnRanks ───────────────────────────────────────────────────────────

describe('probeBpnRanks', () => {
  it('reports ready when the endpoint says so', async () => {
    stub(async () => json({ ranks: 'ready' }))
    expect(await probeBpnRanks()).toEqual({ state: 'ready' })
  })

  it('passes the server reason through when unconfigured', async () => {
    stub(async () => json({ ranks: 'unconfigured', reason: 'SITES_API_KEY is missing.' }))
    expect(await probeBpnRanks()).toEqual({
      state: 'offline',
      reason: 'SITES_API_KEY is missing.',
    })
  })

  /**
   * A static host answers an unknown path with index.html and a 200, so a
   * status-code check alone would report a deployment with no function as ready.
   */
  it('is offline for a 200 that is not JSON', async () => {
    stub(async () => new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }))
    expect(await probeBpnRanks()).toMatchObject({ state: 'offline' })
  })

  it('is offline for a non-ok status', async () => {
    stub(async () => json({ error: 'nope' }, 500))
    expect(await probeBpnRanks()).toMatchObject({ state: 'offline' })
  })

  it('is offline when the request fails outright', async () => {
    stub(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await probeBpnRanks()).toMatchObject({ state: 'offline' })
  })

  /**
   * THE INVARIANT-33 CASE.
   *
   * The modal mounts on demand and StrictMode mounts it twice, so the cleanup ALWAYS
   * cancels the first probe mid-flight. If that cancellation resolved to `offline`,
   * the dead probe would race the live one and whichever settled last would decide
   * the UI — a perfectly good key rendering "unavailable" on roughly every other
   * open, which reads as a missing key rather than as a race. An abort means "this
   * answer is no longer wanted", never "the endpoint is down".
   */
  it('rethrows an abort instead of resolving it to a status', async () => {
    stub(async () => {
      const err = new Error('The operation was aborted.')
      err.name = 'AbortError'
      throw err
    })
    await expect(probeBpnRanks(new AbortController().signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  /**
   * Browsers reject with a DOMException, whose inheritance from Error was only
   * specified later — so the check reads `name` off the value rather than narrowing
   * with `instanceof Error`. A false negative there silently restores the bug.
   */
  it('rethrows an abort that is not an Error instance', async () => {
    stub(async () => {
      throw { name: 'AbortError', message: 'aborted' }
    })
    await expect(probeBpnRanks()).rejects.toMatchObject({ name: 'AbortError' })
  })
})

// ─── fetchBpnResults ─────────────────────────────────────────────────────────

describe('fetchBpnResults', () => {
  const pull = {
    ok: true,
    action: 'results',
    domain: 'gulfrecoverygroup.com',
    rowCount: 2,
    pages: 1,
    reportedTotal: 2,
    truncated: false,
    rows: [{ keyword: 'a' }, { keyword: 'b' }],
  }

  it('asks for the results action and the requested domain', async () => {
    const spy = stub(async () => json(pull))
    await fetchBpnResults({ domain: 'gulfrecoverygroup.com' })
    const url = new URL(String(spy.mock.calls[0][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/bpn-ranks')
    expect(url.searchParams.get('action')).toBe('results')
    expect(url.searchParams.get('domain')).toBe('gulfrecoverygroup.com')
  })

  it('returns the rows and the counts the server reported', async () => {
    stub(async () => json(pull))
    expect(await fetchBpnResults({ domain: 'gulfrecoverygroup.com' })).toEqual({
      rows: [{ keyword: 'a' }, { keyword: 'b' }],
      rowCount: 2,
      pages: 1,
      reportedTotal: 2,
      truncated: false,
    })
  })

  it('sends a bearer token when one is supplied', async () => {
    const spy = stub(async () => json(pull))
    await fetchBpnResults({ domain: 'x.com', token: 'a.token' })
    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer a.token')
  })

  /** `Bearer ` with no credential is malformed, and a proxy may reject it before the
   *  endpoint can answer with its own readable refusal. */
  it('omits the header entirely when there is no token', async () => {
    const spy = stub(async () => json(pull))
    await fetchBpnResults({ domain: 'x.com' })
    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  /**
   * The server's copy reaches the user verbatim. This is the whole reason the shared
   * gate takes a feature label: a signed-out click on Import must not surface
   * "Sign in to use the assistant".
   */
  it('rejects with the server message so the gate copy reaches the modal', async () => {
    stub(async () => json({ error: 'Sign in to import ranking data.' }, 401))
    await expect(fetchBpnResults({ domain: 'x.com' })).rejects.toThrow(
      'Sign in to import ranking data.',
    )
  })

  it('falls back to the status when the error body is unreadable', async () => {
    stub(async () => new Response('not json', { status: 502 }))
    await expect(fetchBpnResults({ domain: 'x.com' })).rejects.toThrow(/502/)
  })

  it('rejects a success body with no rows array', async () => {
    stub(async () => json({ ok: true, rowCount: 0 }))
    await expect(fetchBpnResults({ domain: 'x.com' })).rejects.toThrow(/no rows array/i)
  })

  /**
   * Zero rows is a SUCCESS at this layer and must stay one — the refusal to build a
   * snapshot from it belongs to `parseBpnRows`, which is the only place that knows
   * an empty snapshot would poison every later delta. Rejecting here as well would
   * put the same rule in two places with two different messages.
   */
  it('resolves an empty pull rather than rejecting it', async () => {
    stub(async () => json({ ...pull, rowCount: 0, rows: [] }))
    await expect(fetchBpnResults({ domain: 'hazreviews.com' })).resolves.toMatchObject({
      rows: [],
      rowCount: 0,
    })
  })

  it('carries the truncation flag through', async () => {
    stub(async () => json({ ...pull, truncated: true, pages: 25 }))
    expect((await fetchBpnResults({ domain: 'x.com' })).truncated).toBe(true)
  })
})
