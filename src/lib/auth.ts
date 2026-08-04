import { supabase } from './supabase'

/**
 * When true the whole app is gated behind sign-in plus admin approval.
 *
 * This project runs with it ON — nothing here is public. It stays a flag so a
 * local developer can turn the gate off without editing code.
 */
export const REQUIRE_AUTH = import.meta.env.VITE_REQUIRE_AUTH === 'true'

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
