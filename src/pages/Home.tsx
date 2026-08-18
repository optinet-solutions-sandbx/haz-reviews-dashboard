import { useMemo, useState } from 'react'
import { Link, useLocation, useOutletContext } from 'react-router-dom'
import type { HzOutletContext, Snapshot } from '../types'
import { isSiteScopedPath } from '../lib/nav'
import { parsePosition } from '../lib/normalize'
import {
  computePortfolioMovers,
  computeSiteLeaderboard,
  latestWeek,
  portfolioKeywords,
  type PortfolioMover,
  type SiteRow,
} from '../lib/portfolio'
import { LoadError } from '../components/LoadError'
import { DialogShell } from '../components/DialogShell'
import { PageHeader } from '../components/PageHeader'

type OpenDialog = null | { kind: 'keywords' } | { kind: 'sites' } | { kind: 'tier'; row: SiteRow; tier: 'p1' | 'top3' | 'top10' }

const TIER_LABEL = { p1: 'P1', top3: 'Top-3', top10: 'Top-10' } as const
const TIER_CEILING = { p1: 1, top3: 3, top10: 10 } as const

export function Home() {
  const ctx = useOutletContext<HzOutletContext>()
  const { pathname } = useLocation()
  const [dialog, setDialog] = useState<OpenDialog>(null)

  // Portfolio-wide at '/', narrowed under '/:siteSlug'. The page decides what a
  // missing property means rather than the route: with no property named, a
  // single-property leaderboard would be a one-row table claiming to rank.
  const scoped = isSiteScopedPath(pathname)
  const snapshots = scoped ? ctx.snapshots : ctx.allSnapshots

  const { rows, totals } = useMemo(() => computeSiteLeaderboard(snapshots), [snapshots])
  const movers = useMemo(() => computePortfolioMovers(snapshots), [snapshots])
  const keywords = useMemo(() => portfolioKeywords(snapshots), [snapshots])
  const week = useMemo(() => latestWeek(snapshots), [snapshots])

  // A failed load must never render as an empty dataset.
  if (ctx.snapshotsError) {
    return <LoadError message={ctx.snapshotsError} onRetry={ctx.onReloadSnapshots} />
  }

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title={scoped ? ctx.activeSite.name : 'Home'}>
        {week ? (
          <>
            {/* The raw ISO date, rendered verbatim. latestWeek returns
                `rawDate`, so nothing parses it into a Date — which is exactly
                how the off-by-one timezone shift gets avoided. */}
            Latest week: <span className="font-mono tabular-nums">{week}</span>
          </>
        ) : (
          'No data imported yet'
        )}
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <HeroCard
          label="Keywords"
          value={keywords}
          tone="navy"
          onOpen={() => setDialog({ kind: 'keywords' })}
        />
        <HeroCard
          label={scoped ? 'Tracked in' : 'Sites'}
          value={scoped ? new Set(ctx.snapshots.flatMap((s) => s.records.map((r) => r.market))).size : rows.length}
          tone="azure"
          onOpen={() => setDialog({ kind: 'sites' })}
        />
      </div>

      {/* Stretched on purpose, so both cards end on the same line and the totals
          row settles level with the bottom of the movers panel. The dead space
          that used to make this look broken is now absorbed by a spacer row
          INSIDE the table — see the leaderboard. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Leaderboard
          rows={rows}
          totals={totals}
          onOpenTier={(row, tier) => setDialog({ kind: 'tier', row, tier })}
        />
        <Movers up={movers.up} down={movers.down} hasHistory={hasHistory(snapshots)} />
      </div>

      <DialogShell
        open={dialog?.kind === 'keywords'}
        title="Keywords"
        caption={`${keywords} keyword${keywords === 1 ? '' : 's'} · ${rows.length} site${rows.length === 1 ? '' : 's'}`}
        onClose={() => setDialog(null)}
      >
        <KeywordMatrix rows={rows} snapshots={snapshots} />
      </DialogShell>

      <DialogShell
        open={dialog?.kind === 'sites'}
        title={scoped ? 'Markets' : 'Sites'}
        caption="Best position counts from each site's newest import"
        onClose={() => setDialog(null)}
      >
        <SiteList rows={rows} />
      </DialogShell>

      <DialogShell
        open={dialog?.kind === 'tier'}
        title={dialog?.kind === 'tier' ? `${TIER_LABEL[dialog.tier]} · ${dialog.row.site.name}` : ''}
        caption={
          dialog?.kind === 'tier'
            ? `Keywords at position ${TIER_CEILING[dialog.tier]} or better`
            : undefined
        }
        onClose={() => setDialog(null)}
      >
        {dialog?.kind === 'tier' && (
          <TierList snapshots={snapshots} row={dialog.row} tier={dialog.tier} />
        )}
      </DialogShell>
    </div>
  )
}

/** True once any property has a second snapshot to compare against. */
function hasHistory(snapshots: Snapshot[]): boolean {
  const perSite = new Map<string, number>()
  for (const s of snapshots) perSite.set(s.site, (perSite.get(s.site) ?? 0) + 1)
  return [...perSite.values()].some((n) => n > 1)
}

// ─── Hero cards ─────────────────────────────────────────────────────────────

/**
 * A button, not a div: it opens a dialog, so it must be keyboard reachable and
 * announce that something opens. `aria-haspopup="dialog"` is what tells a screen
 * reader the difference between this and a link.
 */
function HeroCard({
  label,
  value,
  tone,
  onOpen,
}: {
  label: string
  value: number
  tone: 'navy' | 'azure'
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="relative block cursor-pointer overflow-hidden rounded-xl px-4 py-4 text-left transition-opacity hover:opacity-90 sm:px-6 sm:py-5"
      style={{ background: tone === 'navy' ? 'var(--brand-navy)' : 'var(--brand-blue-700)' }}
    >
      {/* Corner disc. `overflow-hidden` on the card is what crops it. */}
      <div
        className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white opacity-10"
        aria-hidden
      />
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">
        {label}
      </div>
      {/* font-normal, never bold: at 38px the size carries the emphasis and
          weight would shout. tabular-nums so the figure cannot jitter. */}
      <div className="font-display text-[28px] font-semibold leading-none tabular-nums text-white sm:text-[38px]">
        {value.toLocaleString()}
      </div>
    </button>
  )
}

// ─── Panels ─────────────────────────────────────────────────────────────────

function Panel({
  title,
  caption,
  children,
  className = '',
}: {
  title: string
  caption: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl ${className}`}
      style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
    >
      <div
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid var(--border-3)' }}
      >
        {/* The brand strip in miniature, so a panel head carries the same mark
            as the top of the app. */}
        <div
          className="flex h-[15px] w-[3px] shrink-0 flex-col overflow-hidden rounded-sm"
          aria-hidden
        >
          <div className="flex-1" style={{ background: 'var(--brand-navy)' }} />
          <div className="flex-1" style={{ background: 'var(--brand-blue)' }} />
          <div className="flex-1" style={{ background: 'var(--brand-light)' }} />
        </div>
        <div>
          <h2
            className="text-[13px] font-semibold leading-none"
            style={{ color: 'var(--navy-text)' }}
          >
            {title}
          </h2>
          <p className="mt-0.5 text-[10px]" style={{ color: 'var(--muted)' }}>
            {caption}
          </p>
        </div>
      </div>
      {children}
    </section>
  )
}

const TH = 'px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]'

function Leaderboard({
  rows,
  totals,
  onOpenTier,
}: {
  rows: SiteRow[]
  totals: { p1: number; top3: number; top10: number }
  onOpenTier: (row: SiteRow, tier: 'p1' | 'top3' | 'top10') => void
}) {
  return (
    <Panel title="Site Leaderboard" caption="Ranked by Top-10 keyword count" className="flex flex-col">
      {/* The scroll container sits INSIDE the panel, never on it: the panel's
          overflow-hidden is what stops square table corners escaping its radius. */}
      <div className="flex-1 overflow-x-auto">
        {/* h-full fills the stretched card so the totals row sits at its bottom
            edge. On its own that distributes the spare height across the data
            rows — two properties became two 200px rows — so a single spacer row
            below the data takes `height: 100%` and soaks up all of it, leaving
            the real rows at their natural height. */}
        <table aria-label="Site Leaderboard" className="h-full w-full text-left">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-3)' }}>
              <th scope="col" className={`w-10 py-1.5 pl-5 pr-2 ${TH}`} style={{ color: 'var(--muted)' }}>
                #
              </th>
              <th scope="col" className={TH} style={{ color: 'var(--muted)' }}>
                Site
              </th>
              <th scope="col" className={`text-right ${TH}`} style={{ color: 'var(--muted)' }}>
                P1
              </th>
              <th scope="col" className={`text-right ${TH}`} style={{ color: 'var(--neg)' }}>
                Top-3
              </th>
              <th scope="col" className={`text-right ${TH}`} style={{ color: 'var(--navy-text)' }}>
                Top-10
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-[12px]" style={{ color: 'var(--muted)' }}>
                  No imports yet.
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={row.site.id} className="nav-row" style={{ borderBottom: '1px solid var(--border-3)' }}>
                <td className="py-2 pl-5 pr-2">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>
                      {['🥇', '🥈', '🥉'][i] ?? i + 1}
                    </span>
                    {row.rankDelta !== null && row.rankDelta !== 0 && (
                      <span
                        className="font-mono text-[9px] font-semibold"
                        style={{ color: row.rankDelta > 0 ? 'var(--pos)' : 'var(--neg)' }}
                      >
                        {row.rankDelta > 0 ? '↑' : '↓'}
                        {Math.abs(row.rankDelta)}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-[13px] font-medium">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-7 w-[3px] shrink-0 rounded-full"
                      aria-hidden
                      style={{ background: row.site.color }}
                    />
                    <Link
                      to={`/${row.site.slug}/rankings`}
                      className="rounded underline-offset-2 hover:underline"
                      style={{ color: 'var(--navy-text)' }}
                    >
                      {row.site.name}
                    </Link>
                  </div>
                </td>
                {(['p1', 'top3', 'top10'] as const).map((tier) => (
                  <td key={tier} className="px-3 py-2 text-right">
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-label={`${row[tier]} ${TIER_LABEL[tier]} keywords for ${row.site.name}`}
                      onClick={() => onOpenTier(row, tier)}
                      className="cursor-pointer rounded font-mono text-[13px] tabular-nums underline-offset-2 hover:underline"
                      style={{
                        color:
                          tier === 'top3'
                            ? 'var(--neg)'
                            : tier === 'top10'
                              ? 'var(--navy-text)'
                              : 'var(--ink)',
                        fontWeight: tier === 'top10' ? 500 : 400,
                      }}
                    >
                      {row[tier]}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
            {/* The slack absorber. Without it, h-full above stretches the data
                rows instead. */}
            {rows.length > 0 && (
              <tr aria-hidden className="h-full">
                <td colSpan={5} />
              </tr>
            )}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-3)' }}>
                <td colSpan={2} className={`py-2 pl-5 pr-2 ${TH}`} style={{ color: 'var(--muted)' }}>
                  All sites
                </td>
                <Total value={totals.p1} color="var(--ink)" />
                <Total value={totals.top3} color="var(--neg)" />
                <Total value={totals.top10} color="var(--navy-text)" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Panel>
  )
}

function Total({ value, color }: { value: number; color: string }) {
  return (
    <td
      className="px-3 py-2 text-right font-mono text-[13px] font-semibold tabular-nums"
      style={{ color }}
    >
      {value}
    </td>
  )
}

// ─── Movers ─────────────────────────────────────────────────────────────────

function Movers({
  up,
  down,
  hasHistory,
}: {
  up: PortfolioMover[]
  down: PortfolioMover[]
  hasHistory: boolean
}) {
  return (
    <Panel title="Top Movers" caption={hasHistory ? 'vs. previous week' : 'Needs a second import'}>
      <div className="space-y-4 px-5 py-4">
        <MoverGroup label="Climbers" tone="var(--pos)" movers={up} hasHistory={hasHistory} />
        <div className="h-px" style={{ background: 'var(--border-3)' }} />
        <MoverGroup label="Droppers" tone="var(--neg)" movers={down} hasHistory={hasHistory} />
      </div>
    </Panel>
  )
}

function MoverGroup({
  label,
  tone,
  movers,
  hasHistory,
}: {
  label: string
  tone: string
  movers: PortfolioMover[]
  hasHistory: boolean
}) {
  const climbing = label === 'Climbers'
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: tone }}>
          {label}
        </span>
        <div className="h-px flex-1" style={{ background: 'var(--border-3)' }} />
      </div>
      {movers.length === 0 ? (
        <p className="px-1 text-[12px]" style={{ color: 'var(--muted)' }}>
          {!hasHistory
            ? 'Import another week to see movement.'
            : climbing
              ? 'No upward movement.'
              : 'No downward movement.'}
        </p>
      ) : (
        <ul role="list" aria-label={label} className="space-y-0.5">
          {movers.map((m) => (
            <li key={`${m.site.id}|${m.keyword}|${m.market}`}>
              <div className="nav-row flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left">
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-[12px] font-medium leading-snug"
                    style={{ color: 'var(--ink)' }}
                  >
                    {m.keyword}
                  </div>
                  <div
                    className="mt-0.5 truncate font-mono text-[10px] tabular-nums"
                    style={{ color: 'var(--muted)' }}
                  >
                    {m.site.name} · {m.market} · {m.from} → {m.to}
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-lg px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums"
                  style={{
                    color: tone,
                    background: climbing ? 'var(--pos-surface)' : 'var(--neg-surface)',
                    border: `1px solid ${climbing ? 'var(--pos-border)' : 'var(--neg-border)'}`,
                  }}
                >
                  {climbing ? '+' : '−'}
                  {m.delta}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Dialog bodies ──────────────────────────────────────────────────────────

const DTH = 'py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]'
const DTD = 'py-2 text-[13px]'

/** Newest snapshot per property, so a dialog never mixes weeks. */
function newestPerSite(snapshots: Snapshot[]): Map<string, Snapshot> {
  const map = new Map<string, Snapshot>()
  for (const s of snapshots) {
    const held = map.get(s.site)
    if (!held || s.rawDate > held.rawDate) map.set(s.site, s)
  }
  return map
}

/**
 * Keyword × property. Best position per keyword, because a keyword tracked in
 * several markets has several positions and the strongest is the one worth
 * comparing across properties.
 */
function KeywordMatrix({ rows, snapshots }: { rows: SiteRow[]; snapshots: Snapshot[] }) {
  const newest = newestPerSite(snapshots)
  const best = new Map<string, Map<string, number>>()

  for (const [siteId, snapshot] of newest) {
    for (const r of snapshot.records) {
      const pos = parsePosition(r.position)
      if (typeof pos !== 'number') continue
      const perSite = best.get(r.keyword) ?? new Map<string, number>()
      const held = perSite.get(siteId)
      if (held === undefined || pos < held) perSite.set(siteId, pos)
      best.set(r.keyword, perSite)
    }
  }

  const keywords = [...best.keys()].sort()
  if (keywords.length === 0) return <Empty>No ranking keywords yet.</Empty>

  return (
    <>
      <table aria-label="Keyword positions by site" className="w-full text-left">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-3)' }}>
            <th scope="col" className={`pr-3 ${DTH}`} style={{ color: 'var(--muted)' }}>
              Keyword
            </th>
            {rows.map((r) => (
              <th
                key={r.site.id}
                scope="col"
                className={`px-3 text-right ${DTH}`}
                style={{ color: 'var(--muted)' }}
              >
                {r.site.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keywords.map((kw) => (
            <tr key={kw} style={{ borderBottom: '1px solid var(--border-3)' }}>
              <th scope="row" className={`pr-3 font-medium ${DTD}`} style={{ color: 'var(--ink)' }}>
                {kw}
              </th>
              {rows.map((r) => {
                const pos = best.get(kw)?.get(r.site.id)
                return (
                  <td
                    key={r.site.id}
                    className={`px-3 text-right font-mono tabular-nums ${DTD}`}
                    style={{
                      color: pos === undefined ? 'var(--muted-3)' : pos <= 10 ? 'var(--pos)' : 'var(--ink)',
                      fontWeight: pos !== undefined && pos <= 10 ? 600 : 400,
                    }}
                  >
                    {pos ?? '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-right text-[10px]" style={{ color: 'var(--muted)' }}>
        best position across markets · lower is better
      </p>
    </>
  )
}

function SiteList({ rows }: { rows: SiteRow[] }) {
  if (rows.length === 0) return <Empty>No imports yet.</Empty>
  return (
    <table aria-label="Sites" className="w-full text-left">
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-3)' }}>
          <th scope="col" className={`pr-3 ${DTH}`} style={{ color: 'var(--muted)' }}>
            Site
          </th>
          <th scope="col" className={`px-3 text-right ${DTH}`} style={{ color: 'var(--muted)' }}>
            Keywords
          </th>
          <th scope="col" className={`pl-3 text-right ${DTH}`} style={{ color: 'var(--muted)' }}>
            Top-10
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.site.id} style={{ borderBottom: '1px solid var(--border-3)' }}>
            <th scope="row" className={`pr-3 font-medium ${DTD}`} style={{ color: 'var(--ink)' }}>
              <Link to={`/${r.site.slug}`} className="underline-offset-2 hover:underline" style={{ color: 'var(--navy-text)' }}>
                {r.site.name}
              </Link>
              <span className="ml-2 font-mono text-[10px]" style={{ color: 'var(--muted)' }}>
                {r.site.domain}
              </span>
            </th>
            <td className={`px-3 text-right font-mono tabular-nums ${DTD}`} style={{ color: 'var(--ink)' }}>
              {r.keywords}
            </td>
            <td className={`pl-3 text-right font-mono tabular-nums ${DTD}`} style={{ color: 'var(--navy-text)' }}>
              {r.top10}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TierList({
  snapshots,
  row,
  tier,
}: {
  snapshots: Snapshot[]
  row: SiteRow
  tier: 'p1' | 'top3' | 'top10'
}) {
  const snapshot = newestPerSite(snapshots).get(row.site.id)
  const ceiling = TIER_CEILING[tier]

  const hits = (snapshot?.records ?? [])
    .map((r) => ({ r, pos: parsePosition(r.position) }))
    .filter((x): x is { r: typeof x.r; pos: number } => typeof x.pos === 'number' && x.pos <= ceiling)
    .sort((a, b) => a.pos - b.pos)

  if (hits.length === 0) return <Empty>No keywords in this tier.</Empty>

  return (
    <table aria-label="Keywords" className="w-full text-left">
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-3)' }}>
          <th scope="col" className={`pr-3 ${DTH}`} style={{ color: 'var(--muted)' }}>
            Keyword
          </th>
          <th scope="col" className={`px-3 text-right ${DTH}`} style={{ color: 'var(--muted)' }}>
            Market
          </th>
          <th scope="col" className={`pl-3 text-right ${DTH}`} style={{ color: 'var(--muted)' }}>
            Position
          </th>
        </tr>
      </thead>
      <tbody>
        {hits.map(({ r, pos }) => (
          <tr key={`${r.keyword}|${r.market}`} style={{ borderBottom: '1px solid var(--border-3)' }}>
            <th scope="row" className={`pr-3 font-medium ${DTD}`} style={{ color: 'var(--ink)' }}>
              {r.keyword}
            </th>
            <td className={`px-3 text-right font-mono ${DTD}`} style={{ color: 'var(--muted)' }}>
              {r.market}
            </td>
            <td
              className={`pl-3 text-right font-mono font-semibold tabular-nums ${DTD}`}
              style={{ color: 'var(--pos)' }}
            >
              {pos}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-10 text-center text-[12px]" style={{ color: 'var(--muted)' }}>
      {children}
    </p>
  )
}
