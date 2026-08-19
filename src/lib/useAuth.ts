import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UserAccessStatus, WriteGate } from '../types'
import { supabase } from './supabase'

interface PendingAction {
  run: () => void
  reject: (err: Error) => void
}

export interface UseAuthResult {
  session: Session | null
  sessionLoading: boolean
  modalOpen: boolean
  requireAuth: <T>(fn: () => T | Promise<T>) => Promise<T>
  openLogin: () => void
  cancelAuth: () => void
  status: UserAccessStatus | null
  isApproved: boolean
  isAdmin: boolean
  accessLoading: boolean
  refreshAccess: () => Promise<boolean>
  /**
   * The current access token, or null when signed out. For `/api/ask-ai`, which
   * verifies the session server-side before it will spend anything.
   *
   * Async and asked for per call, deliberately. An access token is short-lived and
   * Supabase rotates it; reading `session.access_token` out of render state would
   * hand out whatever was current at the last render, so a tab left open long
   * enough would start sending an expired one and the assistant would answer
   * "your session has expired" to someone who is plainly signed in.
   */
  getAccessToken: () => Promise<string | null>
}


/**
 * Session + approval state, plus the pending-action gate.
 *
 * Four decisions here are easy to get wrong and each caused a real bug in the
 * sibling project:
 *
 * 1. `requireAuth` has a STABLE identity (empty dep array) and reads session and
 *    approval from REFS, not state. An async operation that captured requireAuth
 *    before sign-in completed must see current state when it finally runs.
 *    Do NOT add [session] to its dependency array.
 * 2. `accessCheck` is a PROMISE ref. requireAuth awaits the in-flight approval
 *    lookup before running, so a fast click right after sign-in cannot race ahead
 *    of the approval query.
 * 3. `accessGen` is a GENERATION COUNTER. A slow lookup belonging to a stale
 *    session must not clobber a newer verdict after a quick sign-out/sign-in.
 * 4. A superseded pending action is REJECTED, not orphaned, so its caller's
 *    promise always settles.
 */
export function useAuth(): UseAuthResult {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [status, setStatus] = useState<UserAccessStatus | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [accessLoading, setAccessLoading] = useState(true)

  const sessionRef = useRef<Session | null>(null)
  const accessCheck = useRef<Promise<boolean> | null>(null)
  const accessGen = useRef(0)
  const pending = useRef<PendingAction | null>(null)
  /** True once a verdict has landed. A BACKGROUND re-check failure must keep the
   *  existing verdict rather than ejecting an approved user on a network blip. */
  const hasVerdict = useRef(false)

  const lookupAccess = useCallback(async (userId: string | null): Promise<boolean> => {
    const gen = ++accessGen.current

    if (!userId) {
      setStatus(null)
      setIsAdmin(false)
      setAccessLoading(false)
      hasVerdict.current = false
      accessCheck.current = null
      return false
    }

    setAccessLoading(true)

    const check = (async (): Promise<boolean> => {
      try {
        const { data, error } = await supabase
          .from('user_access')
          .select('status, is_admin')
          .eq('user_id', userId)
          .maybeSingle()
        if (error) throw new Error(error.message)

        // A stale generation must not overwrite a newer verdict.
        if (gen !== accessGen.current) return data?.status === 'approved'

        const nextStatus = (data?.status ?? 'pending') as UserAccessStatus
        setStatus(nextStatus)
        setIsAdmin(Boolean(data?.is_admin))
        hasVerdict.current = true
        return nextStatus === 'approved'
      } catch {
        if (gen !== accessGen.current) return false
        // Fails closed on a FIRST lookup; a background re-check keeps whatever
        // verdict we already have. RLS is still the real boundary, so a
        // transient network error must not eject someone mid-session.
        if (!hasVerdict.current) {
          setStatus('pending')
          setIsAdmin(false)
        }
        return false
      } finally {
        if (gen === accessGen.current) setAccessLoading(false)
      }
    })()

    accessCheck.current = check
    return check
  }, [])

  useEffect(() => {
    let active = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      sessionRef.current = data.session
      setSession(data.session)
      setSessionLoading(false)
      void lookupAccess(data.session?.user.id ?? null)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      const previousUserId = sessionRef.current?.user.id ?? null
      sessionRef.current = next
      setSession(next)
      setSessionLoading(false)

      // Re-verify whenever the user identity changes. Repeat events for the SAME
      // user (hourly TOKEN_REFRESHED, tab-refocus SIGNED_IN) still re-check, but
      // hasVerdict keeps the UI from flashing back to a loading state.
      void lookupAccess(next?.user.id ?? null)

      if (next && pending.current) {
        const action = pending.current
        pending.current = null
        setModalOpen(false)
        action.run()
      } else if (!next && previousUserId) {
        pending.current?.reject(new Error('Signed out before the action could run'))
        pending.current = null
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [lookupAccess])

  const requireAuth = useCallback(<T,>(fn: () => T | Promise<T>): Promise<T> => {
    if (sessionRef.current) {
      // Await any in-flight approval lookup first, so a click landing
      // milliseconds after sign-in does not overtake the approval query.
      const check = accessCheck.current
      return check
        ? (check.then(() => fn()) as Promise<T>)
        : (Promise.resolve().then(fn) as Promise<T>)
    }

    return new Promise<T>((resolve, reject) => {
      // Reject rather than orphan: the previous caller is still awaiting a
      // promise that would otherwise never settle.
      pending.current?.reject(new Error('Superseded by a newer sign-in request'))
      pending.current = {
        run: () => void Promise.resolve().then(fn).then(resolve, reject),
        reject,
      }
      setModalOpen(true)
    })
  }, [])

  const openLogin = useCallback(() => setModalOpen(true), [])

  const cancelAuth = useCallback(() => {
    pending.current?.reject(new Error('Sign-in cancelled'))
    pending.current = null
    setModalOpen(false)
  }, [])

  // getSession() rather than the `session` state: it returns a valid token,
  // refreshing it first if the current one has expired. Empty deps, so this keeps a
  // stable identity like requireAuth does and never re-triggers a caller's effect.
  const getAccessToken = useCallback(
    async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    [],
  )

  const refreshAccess = useCallback(
    () => lookupAccess(sessionRef.current?.user.id ?? null),
    [lookupAccess],
  )

  return {
    session,
    sessionLoading,
    modalOpen,
    requireAuth,
    openLogin,
    cancelAuth,
    status,
    isApproved: status === 'approved',
    isAdmin,
    accessLoading,
    refreshAccess,
    getAccessToken,
  }

}

/**
 * Presentational gate for write-triggering controls.
 *
 * The asymmetry is the point. Entry-point BUTTONS stay clickable while signed
 * out — clicking is what opens the login modal. Inline CELL EDITS are disabled,
 * because there is no "click to sign in" recovery from inside an already-open
 * cell editor.
 *
 * Never treat this as security. RLS is the boundary.
 */
export function getWriteGate(
  session: Session | null,
  isApproved: boolean,
  accessLoading: boolean,
): WriteGate {
  if (!session) return { disabled: false, editDisabled: true, title: 'Sign in to make changes' }
  if (accessLoading) return { disabled: false, editDisabled: false }
  if (!isApproved) return { disabled: true, editDisabled: true, title: 'Awaiting admin approval' }
  return { disabled: false, editDisabled: false }
}

export interface IdentityGate {
  /** The address to display, or null when there is none to show. */
  email: string | null
  /** Whether ending the session is a thing that can actually happen. */
  canSignOut: boolean
}

/**
 * What the sidebar footer shows, and which action it offers.
 *
 * The two answers come from DIFFERENT sources, and conflating them is what made
 * "Sign out" a dead button. The footer used to decide it was signed in whenever
 * it had an address to render, but `DEV_OVERRIDE` forces an address precisely so
 * the signed-in surfaces render with no backend — so a forced identity selected
 * the signed-in branch with no session behind it. Clicking then called
 * `supabase.auth.signOut()`, which short-circuits when there is nothing to sign
 * out of: no request, no error, no state change, nothing on screen. It reads as a
 * broken control rather than as a configuration that has no session to end.
 *
 * So: the LABEL may be forced, because that is what the override is for. The
 * ACTION follows the session, which cannot be forced.
 *
 * Never treat this as security (invariant 10). It decides which of two buttons to
 * draw.
 */
export function getIdentityGate(
  session: Session | null,
  overrideEmail: string | null,
): IdentityGate {
  return {
    // The override wins the label deliberately — a developer who set
    // VITE_DEV_FORCE_EMAIL to check truncation wants to see that address.
    email: overrideEmail ?? session?.user.email ?? null,
    // Tracks the session and nothing else. An emailless session is still a
    // session, and a forced address is still not one.
    canSignOut: session !== null,
  }
}
