const ISO_LITERAL = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Local calendar date as 'YYYY-MM-DD'.
 *
 * NOT toISOString().slice(0, 10): that converts to UTC first, so local midnight
 * becomes the previous day in every positive-UTC zone and every snapshot
 * silently lands on the wrong date.
 */
export function toIsoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Renders 'YYYY-MM-DD' as e.g. '4 Aug 26'.
 *
 * Builds the Date from parts rather than letting new Date(str) treat the literal
 * as UTC — that renders the previous day in every negative-UTC zone. The two
 * traps are symmetrical: one shifts on write, this one shifts on read.
 */
export function formatDisplayDate(raw: string): string {
  const m = ISO_LITERAL.exec((raw ?? '').trim())
  if (!m) return raw
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const local = new Date(y, mo - 1, d)
  return `${local.getDate()} ${MONTHS[local.getMonth()]} ${String(y).slice(2)}`
}

/**
 * Coerces whatever a spreadsheet cell holds into 'YYYY-MM-DD', or '' when it
 * cannot be trusted.
 *
 * Returning '' is deliberate: a wrong date corrupts every movement calculation
 * downstream, so no-answer beats a guess. The caller decides what to do with an
 * absent date — the upload modal asks the user.
 */
export function normalizeDateValue(value: unknown): string {
  if (value === null || value === undefined) return ''

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : toIsoLocal(value)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return ''
    // Excel serial → ms. 25569 is the offset between the 1900 date system's
    // epoch and the Unix epoch.
    const d = new Date((value - 25569) * 86400 * 1000)
    if (Number.isNaN(d.getTime())) return ''
    // Read back in UTC: the serial encodes a calendar date with no timezone, so
    // local getters would shift it by the local offset.
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  const raw = String(value).trim()
  if (raw === '') return ''

  // A literal is trusted as-is and never round-tripped through Date.
  if (ISO_LITERAL.test(raw)) return raw

  const slash = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/.exec(raw)
  if (slash) {
    const a = Number(slash[1])
    const b = Number(slash[2])
    let y = Number(slash[3])
    if (y < 100) y += 2000
    // Month-first, matching the US-style exports this app receives.
    const d = new Date(y, a - 1, b)
    return Number.isNaN(d.getTime()) ? '' : toIsoLocal(d)
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : toIsoLocal(parsed)
}
