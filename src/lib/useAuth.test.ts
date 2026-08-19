import type { Session } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { getIdentityGate, getWriteGate } from './useAuth'

const SESSION = { user: { id: 'u1' } } as unknown as Session
const SESSION_WITH_EMAIL = { user: { id: 'u1', email: 'real@example.com' } } as unknown as Session

describe('getWriteGate', () => {
  it('keeps entry-point buttons clickable while signed out', () => {
    // Clicking is what opens the login modal, so disabling the button would
    // remove the only path to signing in.
    const gate = getWriteGate(null, false, false)
    expect(gate.disabled).toBe(false)
    expect(gate.title).toBe('Sign in to make changes')
  })

  it('disables inline cell edits while signed out', () => {
    // There is no "click to sign in" recovery from inside an open cell editor.
    expect(getWriteGate(null, false, false).editDisabled).toBe(true)
  })

  it('allows both while the approval lookup is still in flight', () => {
    const gate = getWriteGate(SESSION, false, true)
    expect(gate.disabled).toBe(false)
    expect(gate.editDisabled).toBe(false)
  })

  it('blocks everything for a signed-in but unapproved user', () => {
    const gate = getWriteGate(SESSION, false, false)
    expect(gate.disabled).toBe(true)
    expect(gate.editDisabled).toBe(true)
    expect(gate.title).toBe('Awaiting admin approval')
  })

  it('allows everything for an approved user', () => {
    expect(getWriteGate(SESSION, true, false)).toEqual({
      disabled: false,
      editDisabled: false,
    })
  })
})

describe('getIdentityGate', () => {
  /**
   * THE regression test. The sidebar footer used to choose between "signed in,
   * here is Sign out" and "Sign in" by asking whether it had an EMAIL to show —
   * and App.tsx sources that email from DEV_OVERRIDE before the session. So a
   * forced dev identity put the footer in its signed-in branch with no session
   * behind it, and the Sign out button was a guaranteed no-op: supabase-js
   * short-circuits signOut() when there is nothing to sign out of, so it did not
   * even make a request, let alone an error. Reported as "sign out is broken".
   *
   * The address can be forced. A session cannot, so the ACTION follows the
   * session.
   */
  it('offers sign-in, not sign-out, when the address is forced but there is no session', () => {
    const gate = getIdentityGate(null, 'dev@localhost')
    expect(gate.email).toBe('dev@localhost')
    expect(gate.canSignOut).toBe(false)
  })

  it('offers sign-out for a real session', () => {
    expect(getIdentityGate(SESSION_WITH_EMAIL, null)).toEqual({
      email: 'real@example.com',
      canSignOut: true,
    })
  })

  it('prefers the forced address for display while still allowing sign-out', () => {
    // Both present: a developer set VITE_DEV_FORCE_EMAIL and then signed in for
    // real. The override still wins the LABEL, because that is what it is for,
    // but the session is real so ending it must stay possible.
    const gate = getIdentityGate(SESSION_WITH_EMAIL, 'dev@localhost')
    expect(gate.email).toBe('dev@localhost')
    expect(gate.canSignOut).toBe(true)
  })

  it('shows nothing at all when there is neither', () => {
    // The footer's own signed-out branch handles this; it must not be handed an
    // empty string and render a blank identity row.
    expect(getIdentityGate(null, null)).toEqual({ email: null, canSignOut: false })
  })

  it('falls back to the forced address when a session carries no email', () => {
    // A session established by a provider that returns no address still must not
    // render an empty identity row.
    expect(getIdentityGate(SESSION, 'dev@localhost').email).toBe('dev@localhost')
  })

  it('allows sign-out for an emailless session even with no address to show', () => {
    // canSignOut tracks the SESSION, never whether there is a label for it.
    expect(getIdentityGate(SESSION, null)).toEqual({ email: null, canSignOut: true })
  })
})
