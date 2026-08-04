import type { ActivityAction, ActivityLogRow } from '../types'
import { supabase } from './supabase'

interface ActivityDbRow {
  id: number
  created_at: string
  email: string
  action: ActivityAction
  section: string
  summary: string
}

/**
 * Best-effort by contract: wrapped in try/catch, NEVER throws, and callers never
 * await it (`void logActivity(...)`).
 *
 * A failed audit write must never block or roll back the real mutation it
 * describes. An import that succeeded but whose log row failed is a bookkeeping
 * gap; an import rolled back because of a bookkeeping gap is lost work.
 */
export async function logActivity(
  action: ActivityAction,
  section: string,
  summary: string,
): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser()
    const user = data.user
    // RLS pins user_id to auth.uid() on insert, so an anonymous write would fail
    // anyway. Returning early keeps that expected case out of the console.
    if (!user) return

    await supabase.from('activity_log').insert({
      user_id: user.id,
      email: user.email ?? '',
      action,
      section,
      summary,
    })
  } catch {
    // Deliberately swallowed — see the contract above.
  }
}

export async function loadActivityLog(limit = 200): Promise<ActivityLogRow[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, created_at, email, action, section, summary')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Could not load the activity log: ${error.message}`)
  return ((data ?? []) as ActivityDbRow[]).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    email: r.email,
    action: r.action,
    section: r.section,
    summary: r.summary,
  }))
}
