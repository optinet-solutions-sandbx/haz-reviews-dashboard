/**
 * LOCAL DEVELOPMENT AND THE DEPLOYED DEMO — lets the signed-in and admin
 * surfaces render on a build with no Supabase project behind it. Without it,
 * `isAdmin` and the account email can only come from a real session, so the
 * admin nav group and the footer identity are unreachable until a backend
 * exists.
 *
 * This is NOT a security control and cannot be used as one. RLS is the boundary
 * (invariant 10): forcing `isAdmin` reveals two nav rows and stops one redirect,
 * and every row of data behind them is still fetched with the anon key under the
 * policies in `supabase/setup.sql`. A forced admin with no session reads nothing
 * it could not already read.
 *
 * There are two separate unlocks, and keeping them separate is the whole design:
 *
 * - `DEV` + `VITE_DEV_FORCE_ADMIN` is the local convenience. The `DEV` guard is
 *   the load-bearing part: `import.meta.env.DEV` is statically false in a
 *   production build, so a stray `VITE_DEV_FORCE_ADMIN=true` in a deployed
 *   environment does nothing. Never replace that guard with a runtime check on
 *   the flag alone.
 * - `VITE_DEMO_MODE` is the deployed demo, which has no backend at all and so
 *   could never obtain a real session. It is its OWN flag rather than a lifted
 *   `DEV` guard precisely so the bullet above stays true: publishing a demo is
 *   then an explicit act, never something a leftover local variable can cause.
 */

/** The subset of `import.meta.env` this reads, so the resolver stays pure. */
export interface DevEnv {
  DEV?: boolean
  VITE_DEMO_MODE?: string
  VITE_DEV_FORCE_ADMIN?: string
  VITE_DEV_FORCE_EMAIL?: string
}

/** Narrowed to the demo switch, for the resolvers that only need that much. */
export interface DemoEnv {
  VITE_DEMO_MODE?: string
}

/**
 * True when this build is the deployed demo: stand-in data, no backend, no gate.
 *
 * Exactly 'true', for the same reason the dev flags are — a commented-out line
 * usually reads as an empty string, and treating anything truthy as consent
 * would publish a demo by accident.
 */
export function isDemoBuild(env: DemoEnv): boolean {
  return env.VITE_DEMO_MODE === 'true'
}

export interface DevOverride {
  isAdmin: true
  email: string
}

export function resolveDevOverride(env: DevEnv): DevOverride | null {
  const demo = isDemoBuild(env)
  if (!demo) {
    if (!env.DEV) return null
    // Exactly 'true'. A commented-out line often reads as an empty string, and
    // treating anything truthy as consent would enable this by accident.
    if (env.VITE_DEV_FORCE_ADMIN !== 'true') return null
  }
  return {
    isAdmin: true,
    // A real address can be supplied to check the footer truncates at a
    // realistic length rather than at 12 characters. The demo default differs
    // from dev's on purpose: a deployed footer reading 'dev@localhost' looks
    // like leaked local config, and example.com is reserved for exactly this.
    email: env.VITE_DEV_FORCE_EMAIL || (demo ? 'demo@example.com' : 'dev@localhost'),
  }
}

/** Resolved once at module load; `null` in any build that is neither. */
export const DEV_OVERRIDE = resolveDevOverride(import.meta.env)

/**
 * Whether the whole app sits behind sign-in plus admin approval.
 *
 * Lives here rather than beside the rest of auth so it can be unit-tested:
 * `auth.ts` imports the Supabase client, which throws at module load without
 * credentials, and a test has none to give it.
 *
 * A demo build forces the gate OFF rather than trusting configuration. The demo
 * has no auth backend, so the gate could never be passed: `VITE_DEMO_MODE=true`
 * with the gate left on deploys a login wall in front of data that is stand-in
 * anyway, which reads as a broken deploy rather than a misconfigured one.
 *
 * Takes the whole `DevEnv` even though it reads two fields of it. A parameter
 * typed with none but optional `VITE_` properties is a *weak type*, and
 * `ImportMetaEnv` declares none of them, so `resolveRequireAuth(import.meta.env)`
 * — the one call site that matters — fails to compile. `DEV` is the property they
 * have in common.
 */
export function resolveRequireAuth(env: DevEnv & { VITE_REQUIRE_AUTH?: string }): boolean {
  if (isDemoBuild(env)) return false
  return env.VITE_REQUIRE_AUTH === 'true'
}

/**
 * Whether to offer "Continue with Google" on the sign-in portal.
 *
 * Opt-IN, which is the opposite of how every other flag in this file reads, and
 * deliberately so: this one's failure direction is reversed. `signInWithOAuth`
 * throws `Unsupported provider` until a Google OAuth client is configured in the
 * Supabase project, so the default has to be the state that is always correct.
 * A portal with no Google button reads as "this app uses passwords"; a portal
 * with one that errors reads as "this app is broken", and that is the first
 * thing a new user would see.
 *
 * Exactly 'true' for the same reason the others are — a commented-out line
 * usually reads as an empty string.
 */
// Takes the whole DevEnv for the reason resolveRequireAuth documents: a parameter
// of only optional VITE_ properties is a WEAK TYPE, ImportMetaEnv declares none
// of them, and the one call site that matters would not compile. `DEV` is the
// property they have in common.
export function resolveGoogleAuth(env: DevEnv & { VITE_ENABLE_GOOGLE_AUTH?: string }): boolean {
  // A demo build has no Supabase project at all, so the provider cannot have
  // been configured there by definition.
  if (isDemoBuild(env)) return false
  return env.VITE_ENABLE_GOOGLE_AUTH === 'true'
}

/** Resolved once at module load, like DEV_OVERRIDE. */
export const GOOGLE_AUTH_ENABLED = resolveGoogleAuth(import.meta.env)
