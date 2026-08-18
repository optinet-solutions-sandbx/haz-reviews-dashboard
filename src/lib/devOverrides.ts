/**
 * LOCAL DEVELOPMENT ONLY — lets the signed-in and admin surfaces render on a
 * machine with no Supabase project behind it. Without it, `isAdmin` and the
 * account email can only come from a real session, so the admin nav group and
 * the footer identity are unreachable until a backend exists.
 *
 * This is NOT a security control and cannot be used as one. RLS is the boundary
 * (invariant 10): forcing `isAdmin` reveals two nav rows and stops one redirect,
 * and every row of data behind them is still fetched with the anon key under the
 * policies in `supabase/setup.sql`. A forced admin with no session reads nothing
 * it could not already read.
 *
 * The `DEV` guard is the load-bearing part. `import.meta.env.DEV` is statically
 * false in a production build, so this whole branch is dead code that the
 * bundler drops — a stray `VITE_DEV_FORCE_ADMIN=true` in a deployed environment
 * does nothing. Never replace that guard with a runtime check on the flag alone.
 */

/** The subset of `import.meta.env` this reads, so the resolver stays pure. */
export interface DevEnv {
  DEV?: boolean
  VITE_DEV_FORCE_ADMIN?: string
  VITE_DEV_FORCE_EMAIL?: string
}

export interface DevOverride {
  isAdmin: true
  email: string
}

export function resolveDevOverride(env: DevEnv): DevOverride | null {
  if (!env.DEV) return null
  // Exactly 'true'. A commented-out line often reads as an empty string, and
  // treating anything truthy as consent would enable this by accident.
  if (env.VITE_DEV_FORCE_ADMIN !== 'true') return null
  return {
    isAdmin: true,
    // A real address can be supplied to check the footer truncates at a
    // realistic length rather than at 12 characters.
    email: env.VITE_DEV_FORCE_EMAIL || 'dev@localhost',
  }
}

/** Resolved once at module load; `null` in every production build. */
export const DEV_OVERRIDE = resolveDevOverride(import.meta.env)
