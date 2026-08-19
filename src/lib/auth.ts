import { resolveRequireAuth } from './devOverrides'
import { supabase } from './supabase'

/**
 * When true the whole app is gated behind sign-in plus admin approval.
 *
 * This project runs with it ON — nothing here is public. It stays a flag so a
 * local developer can turn the gate off without editing code, and a demo build
 * forces it off outright: see `resolveRequireAuth`, which is where the rule and
 * its test live because this module cannot be imported without credentials.
 */
export const REQUIRE_AUTH = resolveRequireAuth(import.meta.env)

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}

export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
}

/**
 * Google OAuth reloads the page, so any pending action captured by requireAuth
 * is lost by design. The user re-clicks after landing back on the app.
 */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(error.message)
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw new Error(error.message)
}

/**
 * Sets a new password for the CURRENT session.
 *
 * Reached two ways, and it is the same call for both: the recovery link from
 * `sendPasswordReset`, which signs the user in before landing them on
 * /reset-password, and a signed-in user changing their own password.
 *
 * It follows that /reset-password cannot sit behind AuthGate. The recovery link
 * establishes a real session, so the gate would wave the user straight through to
 * the dashboard and they would never reach the screen the email promised.
 */
export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(error.message)
}
