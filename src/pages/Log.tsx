import { useEffect, useState } from 'react'
import type { ActivityLogRow } from '../types'
import { loadActivityLog } from '../lib/activityLog'

const ACTION_ACCENT: Record<string, string> = {
  upload: 'var(--info)',
  edit: 'var(--warn)',
  delete: 'var(--neg)',
}

export function Log() {
  const [rows, setRows] = useState<ActivityLogRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    loadActivityLog(200)
      .then((r) => {
        if (active) setRows(r)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      active = false
    }
  }, [])

  if (error) {
    return (
      <p className="animate-fade-up text-[12px]" style={{ color: 'var(--neg)' }}>
        {error}
      </p>
    )
  }

  if (rows === null) {
    return (
      <p className="animate-fade-up font-mono text-[12px]" style={{ color: 'var(--muted)' }}>
        Loading activity…
      </p>
    )
  }

  if (rows.length === 0) {
    return (
      <div
        className="animate-fade-up rounded-xl px-6 py-12 text-center"
        style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
      >
        <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
          No activity recorded yet.
        </p>
      </div>
    )
  }

  return (
    <div
      className="animate-fade-up overflow-hidden rounded-xl"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr style={{ background: 'var(--surface-3)' }}>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Section</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td mono>{new Date(r.createdAt).toLocaleString()}</Td>
                <Td mono>{r.email}</Td>
                <Td>
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                    style={{
                      color: ACTION_ACCENT[r.action] ?? 'var(--muted)',
                      border: `1px solid ${ACTION_ACCENT[r.action] ?? 'var(--border)'}`,
                    }}
                  >
                    {r.action}
                  </span>
                </Td>
                <Td>{r.section}</Td>
                <Td>{r.summary}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
