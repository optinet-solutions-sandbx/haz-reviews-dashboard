import { useCallback, useEffect, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import type { HzOutletContext, UserAccessRow, UserAccessStatus } from '../types'
import { loadUserAccess, setUserAdmin, setUserStatus } from '../lib/userAccess'
import { PageHeader } from '../components/PageHeader'

const STATUS_ACCENT: Record<UserAccessStatus, string> = {
  approved: 'var(--pos)',
  pending: 'var(--warn)',
  revoked: 'var(--neg)',
}

export function AdminUsers() {
  const ctx = useOutletContext<HzOutletContext>()
  const [rows, setRows] = useState<UserAccessRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setRows(await loadUserAccess())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Wait for the verdict before redirecting. Deciding while accessLoading is true
  // bounces a real admin off their own page on every page load.
  if (ctx.accessLoading) {
    return (
      <p className="animate-fade-up font-mono text-[12px]" style={{ color: 'var(--muted)' }}>
        Checking access…
      </p>
    )
  }
  if (!ctx.isAdmin) return <Navigate to="/" replace />

  async function act(userId: string, fn: () => Promise<void>) {
    setBusyId(userId)
    try {
      await fn()
      await refresh()
    } catch (err) {
      ctx.addToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <PageHeader title="Manage">
        {rows === null ? 'Loading…' : `${rows.length} account${rows.length === 1 ? '' : 's'}`}
      </PageHeader>
      {error && (
        <p className="text-[12px]" style={{ color: 'var(--neg)' }}>
          {error}
        </p>
      )}

      <div
        className="overflow-hidden rounded-xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr style={{ background: 'var(--surface-3)' }}>
                <Th>Email</Th>
                <Th>Status</Th>
                <Th>Admin</Th>
                <Th>Joined</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((u) => {
                const isSelf = u.userId === ctx.currentUserId
                const busy = busyId === u.userId
                return (
                  <tr key={u.userId}>
                    <Td>
                      <span className="font-mono text-[11px]">{u.email}</span>
                      {isSelf && (
                        <span className="pl-1.5 text-[9px]" style={{ color: 'var(--muted-3)' }}>
                          (you)
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span
                        className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                        style={{
                          color: STATUS_ACCENT[u.status],
                          border: `1px solid ${STATUS_ACCENT[u.status]}`,
                        }}
                      >
                        {u.status}
                      </span>
                    </Td>
                    <Td>{u.isAdmin ? 'Yes' : '—'}</Td>
                    <Td mono>{new Date(u.createdAt).toLocaleDateString()}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        {u.status !== 'approved' && (
                          <Action
                            disabled={busy}
                            onClick={() => void act(u.userId, () => setUserStatus(u.userId, 'approved'))}
                          >
                            Approve
                          </Action>
                        )}
                        {/* Revoking yourself would lock you out of this page. */}
                        {u.status !== 'revoked' && !isSelf && (
                          <Action
                            danger
                            disabled={busy}
                            onClick={() => void act(u.userId, () => setUserStatus(u.userId, 'revoked'))}
                          >
                            Revoke
                          </Action>
                        )}
                        {!isSelf && (
                          <Action
                            disabled={busy}
                            onClick={() => void act(u.userId, () => setUserAdmin(u.userId, !u.isAdmin))}
                          >
                            {u.isAdmin ? 'Demote' : 'Make admin'}
                          </Action>
                        )}
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px]" style={{ color: 'var(--muted-3)' }}>
        Revoked is a distinct state from pending, so someone you deliberately cut off never
        reappears in the queue as a new signup.
      </p>
    </div>
  )
}

function Action({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-2 py-1 text-[11px] font-medium disabled:opacity-50"
      style={{
        border: `1px solid ${danger ? 'var(--neg-border)' : 'var(--border)'}`,
        color: danger ? 'var(--neg)' : 'var(--text-2)',
      }}
    >
      {children}
    </button>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.1em]"
      style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border-2)' }}
    >
      {children}
    </th>
  )
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      className={`px-3 py-2 ${mono ? 'font-mono text-[10px] whitespace-nowrap' : ''}`}
      style={{ color: 'var(--text-2)', borderBottom: '1px solid var(--border-3)' }}
    >
      {children}
    </td>
  )
}
