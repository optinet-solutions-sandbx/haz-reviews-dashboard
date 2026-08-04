import type { UserAccessRow, UserAccessStatus } from '../types'
import { supabase } from './supabase'

interface UserAccessDbRow {
  user_id: string
  email: string
  status: UserAccessStatus
  is_admin: boolean
  created_at: string
  revoked_at: string | null
}

function toRow(row: UserAccessDbRow): UserAccessRow {
  return {
    userId: row.user_id,
    email: row.email,
    status: row.status,
    isAdmin: row.is_admin,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}

/**
 * RLS returns every row to an admin and only their own row to everyone else, so
 * this one query serves both the admin console and a self-status check.
 */
export async function loadUserAccess(): Promise<UserAccessRow[]> {
  const { data, error } = await supabase
    .from('user_access')
    .select('user_id, email, status, is_admin, created_at, revoked_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Could not load users: ${error.message}`)
  return ((data ?? []) as UserAccessDbRow[]).map(toRow)
}

/**
 * Sets a user's access status.
 *
 * `revoked_at` is stamped on revoke and cleared otherwise, so the column always
 * describes the current status rather than accumulating stale history.
 */
export async function setUserStatus(
  userId: string,
  status: UserAccessStatus,
): Promise<void> {
  const { error } = await supabase
    .from('user_access')
    .update({ status, revoked_at: status === 'revoked' ? new Date().toISOString() : null })
    .eq('user_id', userId)
  if (error) throw new Error(`Could not update access: ${error.message}`)
}

export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<void> {
  const { error } = await supabase
    .from('user_access')
    .update({ is_admin: isAdmin })
    .eq('user_id', userId)
  if (error) throw new Error(`Could not update admin rights: ${error.message}`)
}
