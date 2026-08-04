import { useEffect, useRef, useState } from 'react'

interface EditableCellProps {
  value: string
  onSave: (next: string) => Promise<void>
  disabled?: boolean
  title?: string
  placeholder?: string
  /** Optional truncated rendering for a long underlying value. */
  renderDisplay?: (value: string) => React.ReactNode
}

/**
 * Click to edit, Enter or blur to commit, Escape to revert.
 *
 * On a save failure the cell reverts to the original value and the error is
 * rethrown, so the caller can toast it. Leaving a rejected value on screen would
 * tell the user their edit stuck when the database disagreed.
 */
export function EditableCell({
  value,
  onSave,
  disabled,
  title,
  placeholder,
  renderDisplay,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Escape must not be undone by the blur that immediately follows it. */
  const cancelled = useRef(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const next = draft.trim()
    if (next === value.trim()) {
      setEditing(false)
      return
    }

    setSaving(true)
    try {
      await onSave(next)
      setEditing(false)
    } catch (err) {
      setDraft(value)
      setEditing(false)
      throw err
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancelled.current = true
            setDraft(value)
            setEditing(false)
          }
        }}
        className="w-full rounded-[2px] px-1 py-0.5 font-mono text-[11px] outline-none"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--brand-blue)',
          color: 'var(--mx-ink)',
        }}
      />
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? title : (title ?? 'Click to edit')}
      onClick={() => setEditing(true)}
      className="w-full cursor-pointer truncate px-1 py-0.5 text-left font-mono text-[11px] disabled:cursor-default"
      style={{ color: value ? 'var(--mx-ink)' : 'var(--muted-3)' }}
    >
      {value ? (renderDisplay ? renderDisplay(value) : value) : (placeholder ?? '—')}
    </button>
  )
}
