import type { Session } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { getWriteGate } from './useAuth'

const SESSION = { user: { id: 'u1' } } as unknown as Session

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
