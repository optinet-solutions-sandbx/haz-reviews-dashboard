import type { Site } from '../lib/sites'

// ─── Data ────────────────────────────────────────────────────────────────

/**
 * One tracked keyword in one market, as of one snapshot.
 *
 * `position`, `previous` and `change` are strings on purpose. The source
 * vocabulary includes 'NR', 'Not in top 100' and '-', and normalising at write
 * time would destroy information we cannot recover. parsePosition() and
 * parseChange() do that work at the view layer instead.
 */
export interface RankingRecord {
  keyword: string
  market: string
  position: string
  previous: string
  /**
   * Verbatim source token, e.g. '+2', '-3', '▲ 4'. Badges render what the
   * export showed; deltas are computed separately by effectiveDelta(). Keeping
   * the raw token kills the "which side of the parens is the previous
   * position" class of bug.
   */
  change: string
  urlFound: string
  searchVolume: string
  date: string
}

export interface Snapshot {
  /** 'snap-<siteId>-<rawDate>' — deterministic, which is what makes upsert
   *  idempotent, and site-scoped so two properties can share a date. */
  id: string
  /** A site id from the registry in lib/sites.ts. Stored, so never renamed. */
  site: string
  rawDate: string
  /** e.g. '4 Aug 26'. Re-derived from rawDate on read, never trusted. */
  displayDate: string
  records: RankingRecord[]
}

export interface SnapshotMeta {
  id: string
  site: string
  rawDate: string
  displayDate: string
}

/** null = never checked · 'NR' = checked and absent · number = ranked. */
export type ParsedPosition = number | 'NR' | null

// ─── Grouping ────────────────────────────────────────────────────────────

export type GroupKind = 'brand' | 'category'

/**
 * A keyword group. Membership is DERIVED from the registry by
 * groupForKeyword() and never stored on a record, so improving the registry
 * re-groups all history retroactively.
 */
export interface KeywordGroup {
  name: string
  abbr: string
  color: string
  kind: GroupKind
  /**
   * Extra phrases that mean this group. Must never contain a token that
   * appears inside an unrelated word — a bare 'jack' alias would classify
   * 'live blackjack' as Jack.com. groups.test.ts guards exactly that.
   */
  aliases: string[]
}

// ─── Stats ───────────────────────────────────────────────────────────────

/**
 * Movement buckets (improved / dropped / unchanged / notRanking) are mutually
 * exclusive and sum to `total`. `top3` OVERLAPS them by design and is not part
 * of that sum — a top-3 keyword that moved up should read green AND count in
 * Top 3.
 */
export interface StatsCounts {
  total: number
  top3: number
  improved: number
  dropped: number
  notRanking: number
  unchanged: number
}

export interface TierCounts {
  p1: number
  top3: number
  top10: number
  page2: number
  nr: number
}

// ─── Import ──────────────────────────────────────────────────────────────

export interface ParseResult {
  snapshot: Snapshot
  skippedRows: number
  /**
   * Keywords that fell through to the Other group. Surfaced so the registry
   * can be improved — never dropped.
   */
  unmatchedKeywords: string[]
  markets: string[]
  /** Markets absent from MARKET_ORDER. Rendered appended, never dropped. */
  unknownMarkets: string[]
  detectedDate: string
}

// ─── App state ───────────────────────────────────────────────────────────

export interface AppState {
  /** Hydrated: the recent window plus any older snapshots loaded on demand.
   *  Holds BOTH sites; views filter by the active one. */
  snapshots: Snapshot[]
  /** Every snapshot that exists, metadata only. Both sites. */
  snapshotMeta: SnapshotMeta[]
  /**
   * Keyed by site id — null means "the most recent for that site".
   *
   * A single shared id would leak across the switcher: selecting an August date
   * on HAZREVIEWS and then switching to Kuwait would look up an id belonging to
   * the other property, silently falling back to Kuwait's latest while the date
   * tab bar still highlighted August.
   */
  activeSnapshotIdBySite: Record<string, string | null>
}

export interface ToastItem {
  id: string
  message: string
  type: 'success' | 'warning' | 'error'
}

// ─── Auth ────────────────────────────────────────────────────────────────

/**
 * Presentational-only gate for write-triggering controls. Does NOT replace
 * requireAuth or RLS as the enforcement boundary — RLS is the boundary.
 */
export interface WriteGate {
  disabled: boolean
  editDisabled: boolean
  title?: string
}

/**
 * 'pending'  — signed up, never approved
 * 'approved' — has access
 * 'revoked'  — an admin took access away. A distinct third state, not a return
 *              to 'pending', so a deliberately cut-off user is never mistaken
 *              for a new signup.
 */
export type UserAccessStatus = 'pending' | 'approved' | 'revoked'

export interface UserAccessRow {
  userId: string
  email: string
  status: UserAccessStatus
  isAdmin: boolean
  createdAt: string
  revokedAt: string | null
}

export type ActivityAction = 'upload' | 'edit' | 'delete'

export interface ActivityLogRow {
  id: number
  createdAt: string
  email: string
  action: ActivityAction
  section: string
  summary: string
}

// ─── Outlet context ──────────────────────────────────────────────────────

/** An omitted field widens the predicate, so one matcher serves both
 *  "this exact row" and "every row for this keyword". */
export interface RecordMatcher {
  keyword?: string
  market?: string
}

export interface RecordPatch {
  searchVolume?: string
}

/**
 * The entire contract between Layout and every page. Pages read it via
 * useOutletContext<HzOutletContext>() and never import from one another, so
 * there is no prop drilling and no provider nesting.
 */
export interface HzOutletContext {
  /** Read from the URL, not from state — so a link to a property is shareable. */
  activeSite: Site
  /** Carry-forward APPLIED, and FILTERED to activeSite. */
  snapshots: Snapshot[]
  /** Metadata for activeSite only. */
  snapshotMeta: SnapshotMeta[]
  activeSnapshotId: string | null
  onSelectSnapshot: (id: string) => void
  onOpenUpload: () => void
  onDeleteSnapshot: (id: string) => void
  onEditCell: (
    snapshotId: string,
    matcher: RecordMatcher,
    patch: RecordPatch,
  ) => Promise<void>
  onLoadOlderSnapshots: () => Promise<void>
  addToast: (message: string, type?: ToastItem['type']) => void
  requireAuth: <T>(fn: () => T | Promise<T>) => Promise<T>
  currentUserId: string | null
  writeGate: WriteGate
  isAdmin: boolean
  accessLoading: boolean
  snapshotsLoading: boolean
  /**
   * Set when the initial load FAILED, as opposed to succeeding with no rows.
   * Pages must distinguish the two: rendering "no data yet" for an unreachable
   * database tells the user their dataset is empty when it is not.
   */
  snapshotsError: string | null
  onReloadSnapshots: () => void
  loadingOlderSnapshots: boolean
  loadOlderError: string | null
}
