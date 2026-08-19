#!/usr/bin/env node
/**
 * Verifies a live Supabase project against what this app requires.
 *
 *   node scripts/verify-supabase.mjs
 *   ADMIN_PASSWORD=... node scripts/verify-supabase.mjs   # adds the account checks
 *
 * Credentials come from .env.local rather than argv — a password on the command
 * line lands in shell history and in the process list.
 *
 * WHY THIS RATHER THAN A pg_policies QUERY. The SQL version inspects
 * configuration; this inspects BEHAVIOUR, using the very anon key the browser
 * ships with. That is what actually matters: not "is a policy present" but "can
 * someone who is not signed in read the data". Those two come apart, because a
 * policy can be present and still permissive.
 *
 * It is also the only thing in this project that exercises the read path against a
 * real database — CLAUDE.md's "Known state" has called that unverified since the
 * build.
 *
 * Every check runs inside main(). Calling process.exit() mid-run aborts Node with a
 * libuv assertion while undici still holds sockets open, which surfaces as exit
 * code 127 instead of the code meant to be reported.
 */

import { readFileSync } from 'node:fs'

const RESET = '\x1b[0m'
const S = {
  pass: '\x1b[32m',
  fail: '\x1b[31m',
  warn: '\x1b[33m',
  dim: '\x1b[90m',
  bold: '\x1b[1m',
}

const results = []
function record(name, status, detail) {
  results.push({ name, status, detail })
  const colour = status === 'PASS' ? S.pass : status === 'FAIL' ? S.fail : S.warn
  console.log(`${colour}${status.padEnd(6)}${RESET} ${name.padEnd(30)} ${S.dim}${detail}${RESET}`)
}

/**
 * A deliberately tiny .env reader rather than a dependency — it only has to handle
 * this one file, and a package to read four lines is not a trade worth making.
 */
function readEnvLocal() {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

const TABLES = ['snapshots', 'ranking_records', 'user_access', 'activity_log']

async function main() {
  let env
  try {
    env = readEnvLocal()
  } catch {
    console.error('Could not read .env.local — run this from the repo root.')
    return 2
  }

  const BASE = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  const ANON = env.VITE_SUPABASE_ANON_KEY || ''
  // The real environment WINS over .env.local, so a one-off run or a CI job can
  // override the file without editing it. Falling back to .env.local is what lets
  // `npm run verify:supabase` work with no argument juggling.
  //
  // Safe here in a way it would never be in the app: this file runs in Node and
  // reads .env.local off disk itself. Vite only inlines `VITE_`-prefixed names into
  // the client bundle, so an unprefixed password is invisible to the browser. See
  // invariant 40 — the rule is about a password reaching the CLIENT, not about the
  // file.
  const PASSWORD = process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD || ''
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || env.ADMIN_EMAIL || 'admin@dashboard.com'

  if (!BASE || !ANON) {
    console.error('VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing from .env.local.')
    return 2
  }
  if (BASE.includes('placeholder')) {
    console.error(`VITE_SUPABASE_URL is still a placeholder (${BASE}).`)
    return 2
  }
  if (BASE.includes('supabase.com/dashboard')) {
    // The mistake is easy to make and the symptom is unhelpful, so name it here.
    console.error(
      'VITE_SUPABASE_URL is the dashboard address, not the API origin.\n' +
        'It should look like https://<project-ref>.supabase.co',
    )
    return 2
  }

  // Both headers are always required. The anon key authorises the REQUEST; the
  // bearer token decides WHO it is. Sending only the anon key resolves auth.uid()
  // to null, which reads as "nobody is approved" rather than as a missing header.
  const headers = (token) => ({ apikey: ANON, Authorization: `Bearer ${token || ANON}` })

  /** Row count from the content-range header, so no rows travel over the wire. */
  const countRows = async (table, token) => {
    const res = await fetch(`${BASE}/rest/v1/${table}?select=*&limit=0`, {
      headers: { ...headers(token), Prefer: 'count=exact' },
    })
    const total = Number((res.headers.get('content-range') || '').split('/')[1])
    // `ok`, not `=== 200`. A counted request with `limit=0` is a RANGE request, so
    // PostgREST answers 206 Partial Content as soon as the table holds anything —
    // and 200 only while it is empty. Checking for 200 therefore passes on an empty
    // database and fails the moment real data arrives, which is precisely backwards.
    return { ok: res.ok, status: res.status, count: Number.isFinite(total) ? total : null }
  }

  console.log(`\n${S.bold}Verifying ${BASE}${RESET}`)
  console.log(`${S.dim}${'─'.repeat(70)}${RESET}`)

  // ─── 1. Reachability ──────────────────────────────────────────────────────

  try {
    // The health route needs the anon key like every other route; without it the
    // answer is 401 and the project looks unreachable when it is merely unasked.
    const res = await fetch(`${BASE}/auth/v1/health`, { headers: { apikey: ANON } })
    record(
      'project reachable',
      res.ok ? 'PASS' : 'FAIL',
      res.ok ? 'auth service responding' : `auth health returned ${res.status}`,
    )
    if (!res.ok) {
      console.log(`\n${S.fail}Cannot reach the project. Nothing else can be checked.${RESET}\n`)
      return 1
    }
  } catch (err) {
    record('project reachable', 'FAIL', err instanceof Error ? err.message : String(err))
    console.log(`\n${S.fail}Cannot reach the project. Nothing else can be checked.${RESET}\n`)
    return 1
  }

  // ─── 2. Schema ────────────────────────────────────────────────────────────

  const missing = []
  for (const table of TABLES) {
    const res = await fetch(`${BASE}/rest/v1/${table}?select=*&limit=0`, { headers: headers() })
    // 404 carries PGRST205, "not in the schema cache" — the table is absent. A 401
    // or an empty 200 both mean it exists.
    if (res.status === 404) missing.push(table)
  }
  const schemaOk = missing.length === 0
  record(
    'tables exist',
    schemaOk ? 'PASS' : 'FAIL',
    schemaOk ? `all ${TABLES.length} present` : `missing ${missing.join(', ')}`,
  )

  if (!schemaOk) {
    console.log(
      `\n${S.fail}Schema incomplete.${RESET} Run ${S.bold}supabase/setup.sql${RESET}` +
        ` then ${S.bold}supabase/auth-lockdown.sql${RESET} in the\nSQL editor, then run this again.\n`,
    )
    return 1
  }

  // ─── 3. The account, and its own permission row ───────────────────────────

  let token = null
  let ownRow = null

  if (!PASSWORD) {
    record('admin can sign in', 'SKIP', 'set ADMIN_PASSWORD to check')
    record('admin is approved', 'SKIP', 'needs a session')
  } else {
    const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD }),
    })
    const body = await res.json().catch(() => ({}))
    token = body.access_token || null

    if (token) {
      record('admin can sign in', 'PASS', `${ADMIN_EMAIL}, email confirmed`)
    } else {
      const msg = body.error_description || body.msg || body.error || `HTTP ${res.status}`
      // Supabase returns the same message for a missing account, a wrong password
      // AND an unconfirmed email, so name all three instead of picking one.
      const hint = /invalid login/i.test(msg)
        ? ' (account missing, wrong password, or email not confirmed)'
        : ''
      record('admin can sign in', 'FAIL', `${msg}${hint}`)
    }

    if (token) {
      // Reads the caller's OWN row, which is itself a test of the RLS policy:
      // auth.uid() has to resolve before the row is visible at all.
      const r = await fetch(`${BASE}/rest/v1/user_access?select=email,status,is_admin`, {
        headers: headers(token),
      })
      const rows = await r.json().catch(() => [])
      ownRow = Array.isArray(rows) ? rows.find((x) => x.email === ADMIN_EMAIL) || rows[0] : null

      if (!ownRow) {
        record('admin is approved', 'FAIL', 'no user_access row visible — trigger or RLS')
      } else if (ownRow.status !== 'approved') {
        record('admin is approved', 'FAIL', `status=${ownRow.status}, run the promote statement`)
      } else {
        record(
          'admin is approved',
          'PASS',
          `approved, is_admin=${ownRow.is_admin}${ownRow.is_admin ? '' : ' (read-only)'}`,
        )
      }
    }
  }

  // ─── 4. The read path, as an approved user ────────────────────────────────

  let authedCount = null
  if (token && ownRow?.status === 'approved') {
    const { ok, status, count } = await countRows('snapshots', token)
    authedCount = count
    record(
      'approved user can read',
      ok ? 'PASS' : 'FAIL',
      ok ? `snapshots readable, ${count} row(s)` : `HTTP ${status}`,
    )
  } else {
    record('approved user can read', 'SKIP', 'needs an approved session')
  }

  // ─── 5. Signed-out reads ──────────────────────────────────────────────────

  const anon = await countRows('snapshots')
  if (anon.count === null) {
    record('signed-out reader blocked', 'WARN', `no count returned (HTTP ${anon.status})`)
  } else if (anon.count > 0) {
    // Unambiguous: rows are reaching a caller with no session, holding only the
    // key that ships inside the JavaScript bundle.
    record(
      'signed-out reader blocked',
      'FAIL',
      `${anon.count} row(s) readable with NO session — run auth-lockdown.sql`,
    )
  } else if (authedCount === null || authedCount === 0) {
    // Both reads return zero, so zero proves nothing either way. Reporting PASS
    // here would be exactly the false comfort this script exists to avoid — the
    // write probe below is what settles it while the table is still empty.
    record('signed-out reader blocked', 'WARN', 'no rows yet, so a read proves nothing')
  } else {
    record(
      'signed-out reader blocked',
      'PASS',
      `${authedCount} row(s) signed in, 0 signed out — RLS filtering`,
    )
  }

  // ─── 6. THE security check: can a stranger WRITE? ─────────────────────────

  /**
   * setup.sql's interim policies are `for all using (true) with check (true)` with
   * no TO clause — which defaults to PUBLIC and therefore includes `anon`. So
   * before auth-lockdown.sql runs, an unauthenticated caller can INSERT. That is a
   * far worse exposure than reading, and unlike reading it is provable on an empty
   * database.
   *
   * The probe writes NOTHING. `snapshot_id` carries a foreign key, and Postgres
   * evaluates RLS (ExecWithCheckOptions) BEFORE the FK trigger fires at end of
   * statement — so the two outcomes are distinguishable, and the FK violation
   * aborts the statement in the permissive case:
   *
   *   RLS refused    → 42501, nothing was ever attempted
   *   RLS permitted  → 23503 foreign-key violation, row rolled back
   *
   * A 201 would mean the FK is missing too; the row is deleted in that case rather
   * than left behind.
   */
  const probeId = 'rls-probe-nonexistent-snapshot'
  const probe = await fetch(`${BASE}/rest/v1/ranking_records`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshot_id: probeId,
      keyword: 'rls probe',
      market: 'XX',
      position: 'NR',
    }),
  })
  const probeBody = await probe.json().catch(() => ({}))
  const code = probeBody?.code

  if (code === '42501' || probe.status === 401 || probe.status === 403) {
    record('signed-out writer blocked', 'PASS', 'insert refused by RLS — lockdown is in place')
  } else if (code === '23503') {
    record(
      'signed-out writer blocked',
      'FAIL',
      'RLS ALLOWED the insert (only the foreign key stopped it) — auth-lockdown.sql has NOT run',
    )
  } else if (probe.ok) {
    // The FK did not exist either, so a real row was written. Remove it.
    await fetch(`${BASE}/rest/v1/ranking_records?snapshot_id=eq.${probeId}`, {
      method: 'DELETE',
      headers: headers(),
    })
    record(
      'signed-out writer blocked',
      'FAIL',
      'anonymous INSERT succeeded outright — probe row deleted, run auth-lockdown.sql',
    )
  } else {
    record(
      'signed-out writer blocked',
      'WARN',
      `unexpected: HTTP ${probe.status} ${code || ''} ${probeBody?.message || ''}`.trim(),
    )
  }

  // ─── Summary ──────────────────────────────────────────────────────────────

  const failed = results.filter((r) => r.status === 'FAIL')
  const warned = results.filter((r) => r.status === 'WARN')
  const skipped = results.filter((r) => r.status === 'SKIP')

  console.log(`${S.dim}${'─'.repeat(70)}${RESET}`)
  if (failed.length) {
    console.log(
      `${S.fail}${S.bold}${failed.length} failed${RESET} ${S.dim}· ` +
        `${failed.map((f) => f.name).join(', ')}${RESET}\n`,
    )
    return 1
  }
  console.log(
    `${S.pass}${S.bold}All checks passed${RESET}` +
      (warned.length ? ` ${S.warn}· ${warned.length} inconclusive${RESET}` : '') +
      (skipped.length ? ` ${S.dim}· ${skipped.length} skipped${RESET}` : '') +
      '\n',
  )
  return 0
}

process.exitCode = await main()
