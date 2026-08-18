/**
 * Module glyphs, as local SVGs. Only chrome glyphs (chevrons, sign-out, upload)
 * come from `lucide-react` — these are the nav's own icon set, matched to the
 * sibling dashboard path for path.
 *
 * All of them stroke at 1.75 and inherit `currentColor`, so the tint applied to
 * the wrapper span in Sidebar reaches them. Lucide's default stroke is 2, which
 * is why these are not lucide equivalents: at 18px the extra quarter-pixel reads
 * as a heavier icon beside its neighbours.
 *
 * Ask AI is the one deliberate exception — a full-colour mascot, so it matches
 * the assistant it opens. Its fills use brand tokens rather than the source's
 * literal hexes, both to honour the no-hex-outside-index.css rule and so the
 * mascot cannot drift from the palette.
 */

interface IconProps {
  size?: number
}

export type NavIcon = (props: IconProps) => React.ReactElement

/** Shared line-icon frame: 24-unit grid, 1.75 stroke, rounded caps and joins. */
function Line({ size = 18, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  )
}

export function HomeIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </Line>
  )
}

export function SitesIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </Line>
  )
}

export function HowItWorksIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.8.3-1.2.9-1.2 1.7v.4" />
      <path d="M12 17h.01" />
    </Line>
  )
}

export function RankingsIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="10" />
    </Line>
  )
}

/* ─── Per-site tools ─────────────────────────────────────────────────────────
   Paths taken verbatim from the sibling dashboard so the two site cards carry an
   identical glyph set. Five of the six have no feature behind them here yet —
   their routes render NotBuilt rather than 404 or silently redirect. */

export function SeoIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Line>
  )
}

export function HealthIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </Line>
  )
}

export function PageSpeedIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <path d="M4 20a8 8 0 1 1 16 0" />
      <line x1="12" y1="14" x2="16" y2="10" />
    </Line>
  )
}

export function BacklinksIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Line>
  )
}

export function QaIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </Line>
  )
}

/**
 * The account avatar's glyph. Local rather than lucide's `User`, which draws a
 * different figure: a larger head (r=4 at y=7) over squarer shoulders, at stroke
 * 2. This is a smaller head on a single arc, at 1.75 — visibly lighter inside a
 * 32px disc, and the shape the shared system uses.
 */
export function UserIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </Line>
  )
}

export function TrashIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <path d="M4 7h16" />
      <path d="M10 4h4" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </Line>
  )
}

export function AuditIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </Line>
  )
}

export function ManageIcon({ size }: IconProps) {
  return (
    <Line size={size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Line>
  )
}

export function AskAiIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path
        d="M 22 52 C 20 18 80 18 78 52"
        stroke="var(--brand-blue)"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="18" cy="56" r="14" fill="var(--brand-light)" />
      <circle cx="18" cy="56" r="9" fill="var(--brand-blue)" />
      <circle cx="18" cy="49" r="3" fill="var(--brand-navy)" />
      <circle cx="82" cy="56" r="14" fill="var(--brand-light)" />
      <circle cx="82" cy="56" r="9" fill="var(--brand-blue)" />
      <circle cx="82" cy="49" r="3" fill="var(--brand-navy)" />
      <circle cx="50" cy="57" r="24" fill="var(--brand-navy)" />
      <circle cx="50" cy="55" r="22" fill="var(--brand-blue)" />
      <ellipse cx="50" cy="58" rx="15" ry="13" fill="var(--brand-light)" />
      <circle cx="44" cy="54" r="4.5" fill="white" />
      <circle cx="56" cy="54" r="4.5" fill="white" />
      <circle cx="44" cy="54" r="2.5" fill="var(--brand-navy)" />
      <circle cx="56" cy="54" r="2.5" fill="var(--brand-navy)" />
      <circle cx="45" cy="53" r="1" fill="white" />
      <circle cx="57" cy="53" r="1" fill="white" />
      <path
        d="M 43 63 Q 50 70 57 63"
        stroke="var(--brand-navy)"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="12" y="68" width="4" height="9" rx="2" fill="var(--brand-blue)" />
      <circle cx="14" cy="79" r="3.5" fill="var(--brand-light)" />
    </svg>
  )
}
