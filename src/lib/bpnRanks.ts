/**
 * Browser-side client for the ranking-API import.
 *
 * Deliberately knows ONE thing about the integration: the path `/api/bpn-ranks`. Not
 * the vendor host, not the API key, not the project id, not the clamps. All of that
 * is in `server/bpnRanks.ts`, which runs in Node.
 *
 * That is not a style preference, it is the constraint the whole feature is built
 * around. Vite inlines every `VITE_`-prefixed variable into the client bundle, so
 * anything a module here could reach is readable in devtools by anyone who loads the
 * page (invariant 27) — and independently of the key, the vendor is a third-party
 * origin, so a direct browser call is refused by CORS regardless. `dist/` is grepped
 * for the key, the vendor host and the upstream path; all three must be absent.
 *
 * The `action` parameter below names OUR endpoint's parameter, which happens to share
 * the vendor's vocabulary. That is not a leak — the server's allow-list is what
 * decides whether a value is permitted, and it never forwards a caller's parameters
 * verbatim.
 */

/** Same path in dev and production, so deploying the real function needs no change. */
export const BPN_ENDPOINT = '/api/bpn-ranks'

export type BpnStatus =
  | { state: 'connecting' }
  | { state: 'ready' }
  | { state: 'offline'; reason: string }

/**
 * The "there is nothing here" state, which is NOT the "no key" state — the server
 * supplies its own, more specific reason for that one and it names the variable to
 * set. Conflating them would send someone to configure a key on a host that has no
 * function to read it.
 */
const OFFLINE_NO_ENDPOINT =
  'No ranking-API endpoint is running. Under `npm run dev` this is served by the Vite ' +
  'middleware; a deployed build needs a real server-side function at /api/bpn-ranks.'

export interface BpnPull {
  rows: unknown[]
  /** What the server counted. Compared against the parsed record count in the UI. */
  rowCount: number
  pages: number
  /** The vendor's own claim. Reported for diagnostics, never used to decide. */
  reportedTotal: number | null
  /** True when the page ceiling stopped the walk, so rows are missing. */
  truncated: boolean
}

/**
 * Asks whether an import can be attempted, without touching the vendor.
 *
 * A static host answers an unknown path with index.html and a 200, so a status-code
 * check alone would report a deployment with no function as ready. The body has to be
 * JSON saying so before we believe it — the same trap the assistant's probe avoids.
 *
 * ON ABORT THIS RETHROWS, and that is load-bearing rather than tidy. `UploadModal`
 * mounts and unmounts on demand and StrictMode mounts it twice, so the cleanup
 * ALWAYS cancels the first probe while it is in flight. A bare `catch` turning that
 * cancellation into `{state:'offline'}` puts the dead probe in a race with the live
 * one, and whichever settles last decides the UI — so a perfectly good
 * `SITES_API_KEY` would render "unavailable" on roughly every other open, reading as
 * a missing key rather than as a race. An abort means "this answer is no longer
 * wanted", never "the endpoint is down". Invariant 33, which was learned the hard way
 * on exactly this shape of code; the caller must re-check `signal.aborted` before it
 * sets state, and must still `catch` the rejection or every mount logs an unhandled
 * one.
 *
 * `name` is read off the value rather than narrowed with `instanceof Error`, because
 * browsers reject with a DOMException whose inheritance from Error was only specified
 * later — a false negative there silently restores the bug.
 */
export async function probeBpnRanks(signal?: AbortSignal): Promise<BpnStatus> {
  try {
    const res = await fetch(BPN_ENDPOINT, { method: 'GET', signal })
    if (!res.ok) return { state: 'offline', reason: OFFLINE_NO_ENDPOINT }
    if (!res.headers.get('content-type')?.includes('application/json')) {
      return { state: 'offline', reason: OFFLINE_NO_ENDPOINT }
    }
    const body: unknown = await res.json()
    if ((body as { ranks?: unknown }).ranks === 'ready') return { state: 'ready' }
    const reason = (body as { reason?: unknown }).reason
    return { state: 'offline', reason: typeof reason === 'string' ? reason : OFFLINE_NO_ENDPOINT }
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === 'AbortError') throw err
    return { state: 'offline', reason: OFFLINE_NO_ENDPOINT }
  }
}

/**
 * Pulls every ranking row the panel holds for one domain.
 *
 * One request: the server walks the vendor's pagination itself, because terminating
 * on a short page rather than on a reported count is a decision that belongs with the
 * other decisions — and a client doing it would be a second place to get it wrong.
 *
 * Rejects with the server's own message, which is why the gate's copy names this
 * feature: a signed-out click surfaces "Sign in to import ranking data." in the
 * modal, verbatim, rather than a status code.
 */
export async function fetchBpnResults(opts: {
  domain: string
  /**
   * The caller's Supabase access token, for the endpoint's server-side authorization.
   *
   * Passed in rather than read here, for the same reason `streamAssistant` takes one:
   * this module must not import the Supabase client, which throws at module load
   * without credentials, and importing it would make this file impossible to
   * unit-test.
   */
  token?: string
  signal?: AbortSignal
}): Promise<BpnPull> {
  const query = new URLSearchParams({ action: 'results', domain: opts.domain })

  const res = await fetch(`${BPN_ENDPOINT}?${query.toString()}`, {
    method: 'GET',
    headers: {
      // Omitted rather than sent empty: `Bearer ` with no credential is malformed and
      // a proxy may reject it before the endpoint can answer with its own readable
      // refusal.
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      Accept: 'application/json',
    },
    signal: opts.signal,
  })

  const body: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    const message = (body as { error?: unknown } | null)?.error
    throw new Error(
      typeof message === 'string' ? message : `The ranking import failed (${res.status}).`,
    )
  }

  const rows = (body as { rows?: unknown } | null)?.rows
  if (!Array.isArray(rows)) throw new Error('The ranking import returned no rows array.')

  const b = body as { rowCount?: unknown; pages?: unknown; reportedTotal?: unknown; truncated?: unknown }
  return {
    rows,
    rowCount: typeof b.rowCount === 'number' ? b.rowCount : rows.length,
    pages: typeof b.pages === 'number' ? b.pages : 1,
    reportedTotal: typeof b.reportedTotal === 'number' ? b.reportedTotal : null,
    truncated: b.truncated === true,
  }
}
