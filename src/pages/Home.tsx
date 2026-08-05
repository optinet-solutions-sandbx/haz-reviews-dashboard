import { useMemo } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { HzOutletContext, RankingRecord, Snapshot, TierCounts } from '../types'
import { GROUPS, OTHER_GROUP, groupForKeyword, groupSlug } from '../lib/groups'
import { avgPosition, computeTiers, parsePosition } from '../lib/normalize'
import { LoadError } from '../components/LoadError'

const MOVER_LIMIT = 10

export function Home() {
  const ctx = useOutletContext<HzOutletContext>()
  const active = ctx.snapshots.find((s) => s.id === ctx.activeSnapshotId) ?? ctx.snapshots[0]
  const previous = active ? ctx.snapshots[ctx.snapshots.indexOf(active) + 1] : undefined

  const tiers = useMemo(() => computeTiers(active?.records ?? []), [active])
  const movers = useMemo(() => computeMovers(active, previous), [active, previous])
  const leaderboard = useMemo(() => computeLeaderboard(ctx.snapshots), [ctx.snapshots])

  // A failed load must never render as an empty dataset.
  if (ctx.snapshotsError) {
    return <LoadError message={ctx.snapshotsError} onRetry={ctx.onReloadSnapshots} />
  }

  if (!active) {
    return (
      <div
        className="animate-fade-up rounded-xl px-6 py-12 text-center"
        style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
      >
        <h2 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
          Nothing to show yet
        </h2>
        <p className="pt-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
          Import a ranking export and this page will fill in.
        </p>
      </div>
    )
  }

  const keywords = new Set(active.records.map((r) => r.keyword)).size
  const markets = new Set(active.records.map((r) => r.market)).size
  const groupsWithData = new Set(active.records.map((r) => groupForKeyword(r.keyword).name)).size
  const page1Pct = tiers.top10 + tiers.page2 + tiers.nr > 0
    ? Math.round((tiers.top10 / active.records.length) * 100)
    : 0

  return (
    <div className="animate-fade-up flex flex-col gap-5">
      {/* Headline totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Keywords" value={keywords.toLocaleString()} />
        <Kpi label="Markets" value={String(markets)} />
        <Kpi label="Groups" value={String(groupsWithData)} />
        <Kpi label="Snapshots" value={String(ctx.snapshotMeta.length)} />
      </div>

      {/* Tier distribution */}
      <Panel
        title="Position tiers"
        subtitle={`${page1Pct}% of tracked keywords are on page 1 · ${active.displayDate}`}
      >
        <TierBars tiers={tiers} total={active.records.length} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Leaderboard */}
        <Panel title="Group leaderboard" subtitle="Best average position first">
          <div className="flex flex-col">
            {leaderboard.length === 0 && <Empty>No groups with data.</Empty>}
            {leaderboard.map(({ group, keywords: kw, avg, fromDate }) => (
              <Link
                key={group.name}
                to={`/${ctx.activeSite.slug}/rankings/${groupSlug(group.name)}`}
                className="flex h-[38px] items-center gap-2.5 border-b px-1 text-[12px] last:border-b-0"
                style={{ borderColor: 'var(--border-3)' }}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                  style={{ background: group.color }}
                >
                  {group.abbr}
                </span>
                <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ink)' }}>
                  {group.name}
                </span>
                {fromDate && (
                  <span
                    className="shrink-0 font-mono text-[9px]"
                    style={{ color: 'var(--muted-3)' }}
                    title="This group was absent from the latest snapshot, so its last known state is shown"
                  >
                    {fromDate}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[10px]" style={{ color: 'var(--muted)' }}>
                  {kw} kw
                </span>
                <span
                  className="w-10 shrink-0 text-right font-mono text-[11px] font-medium"
                  style={{ color: 'var(--ink)' }}
                >
                  {avg === null ? '—' : avg.toFixed(1)}
                </span>
              </Link>
            ))}
          </div>
        </Panel>

        {/* Movers */}
        <Panel
          title="Top movers"
          subtitle={previous ? `vs ${previous.displayDate}` : 'Needs a second snapshot to compare'}
        >
          {!previous && <Empty>Import another date to see movement.</Empty>}
          {previous && movers.up.length === 0 && movers.down.length === 0 && (
            <Empty>No position changes between these two snapshots.</Empty>
          )}
          {previous && (
            <div className="flex flex-col gap-3">
              {movers.up.length > 0 && <MoverList title="Improved" records={movers.up} positive />}
              {movers.down.length > 0 && <MoverList title="Dropped" records={movers.down} />}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-[10px] px-3.5 py-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
    >
      <div
        className="font-display text-[22px] font-semibold leading-none sm:text-[32px]"
        style={{ color: 'var(--ink)' }}
      >
        {value}
      </div>
      <div
        className="pt-1.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </div>
    </div>
  )
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section
      className="rounded-xl p-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
    >
      <h2 className="font-display text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
        {title}
      </h2>
      {subtitle && (
        <p className="pb-3 pt-0.5 text-[11px]" style={{ color: 'var(--muted)' }}>
          {subtitle}
        </p>
      )}
      {children}
    </section>
  )
}

const TIER_META: Array<{ key: keyof TierCounts; label: string; color: string }> = [
  { key: 'p1', label: '#1', color: 'var(--pos)' },
  { key: 'top3', label: 'Top 3', color: 'var(--info)' },
  { key: 'top10', label: 'Top 10', color: 'var(--brand-blue)' },
  { key: 'page2', label: 'Page 2', color: 'var(--warn)' },
  { key: 'nr', label: 'Not ranking', color: 'var(--muted-2)' },
]

function TierBars({ tiers, total }: { tiers: TierCounts; total: number }) {
  const max = Math.max(...TIER_META.map((t) => tiers[t.key]), 1)

  return (
    <div className="flex items-end gap-3" style={{ height: 140 }}>
      {TIER_META.map(({ key, label, color }) => {
        const value = tiers[key]
        const pct = total > 0 ? Math.round((value / total) * 100) : 0
        return (
          <div key={key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="font-mono text-[11px] font-medium" style={{ color: 'var(--ink)' }}>
              {value.toLocaleString()}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="animate-bar-rise w-full rounded-t-[3px]"
                style={{ background: color, height: `${(value / max) * 100}%`, minHeight: 2 }}
              />
            </div>
            <span
              className="truncate text-[9px] font-semibold uppercase tracking-[0.1em]"
              style={{ color: 'var(--muted)' }}
            >
              {label}
            </span>
            <span className="font-mono text-[9px]" style={{ color: 'var(--muted-3)' }}>
              {pct}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

interface Mover {
  keyword: string
  market: string
  from: number
  to: number
}

function MoverList({
  title,
  records,
  positive,
}: {
  title: string
  records: Mover[]
  positive?: boolean
}) {
  return (
    <div>
      <div
        className="pb-1 text-[9px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: 'var(--muted-3)' }}
      >
        {title}
      </div>
      {records.map((m) => (
        <div
          key={`${m.keyword}|${m.market}`}
          className="flex items-center gap-2 border-b py-1 text-[11px] last:border-b-0"
          style={{ borderColor: 'var(--border-3)' }}
        >
          <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ink)' }} title={m.keyword}>
            {m.keyword}
          </span>
          <span className="shrink-0 font-mono text-[9px]" style={{ color: 'var(--muted-3)' }}>
            {m.market}
          </span>
          <span
            className="shrink-0 font-mono text-[10px] font-medium"
            style={{ color: positive ? 'var(--pos)' : 'var(--neg)' }}
          >
            {m.from} → {m.to} ({positive ? '▲' : '▼'}
            {Math.abs(m.from - m.to)})
          </span>
        </div>
      ))}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-4 text-center font-mono text-[11px]" style={{ color: 'var(--muted-3)' }}>
      {children}
    </p>
  )
}

// ─── Derivations ────────────────────────────────────────────────────────────

/**
 * Movement by cross-snapshot comparison rather than the export's change column,
 * so a keyword the spreadsheet mislabelled still reports the truth.
 */
function computeMovers(
  active: Snapshot | undefined,
  previous: Snapshot | undefined,
): { up: Mover[]; down: Mover[] } {
  if (!active || !previous) return { up: [], down: [] }

  const prevByKey = new Map<string, number>()
  for (const r of previous.records) {
    const pos = parsePosition(r.position)
    if (typeof pos === 'number') {
      prevByKey.set(`${r.keyword.toLowerCase()}|${r.market.toLowerCase()}`, pos)
    }
  }

  const moves: Mover[] = []
  for (const r of active.records) {
    const pos = parsePosition(r.position)
    if (typeof pos !== 'number') continue
    const from = prevByKey.get(`${r.keyword.toLowerCase()}|${r.market.toLowerCase()}`)
    if (from === undefined || from === pos) continue
    moves.push({ keyword: r.keyword, market: r.market, from, to: pos })
  }

  // Lower is better, so from > to is an improvement.
  const up = moves.filter((m) => m.from > m.to).sort((a, b) => b.from - b.to - (a.from - a.to))
  const down = moves.filter((m) => m.from < m.to).sort((a, b) => b.to - b.from - (a.to - a.from))

  return { up: up.slice(0, MOVER_LIMIT), down: down.slice(0, MOVER_LIMIT) }
}

interface LeaderboardRow {
  group: (typeof GROUPS)[number]
  keywords: number
  avg: number | null
  /** Set when the data came from an older snapshot than the latest. */
  fromDate: string | null
}

/**
 * For each group, walks snapshots newest → oldest to find the most recent one
 * that actually has records for it. A group missing from the latest import shows
 * its last known state rather than a misleading zero.
 */
function computeLeaderboard(snapshots: Snapshot[]): LeaderboardRow[] {
  if (snapshots.length === 0) return []

  const rows: LeaderboardRow[] = []

  for (const group of [...GROUPS, OTHER_GROUP]) {
    for (let i = 0; i < snapshots.length; i++) {
      const records = snapshots[i].records.filter(
        (r: RankingRecord) => groupForKeyword(r.keyword).name === group.name,
      )
      if (records.length === 0) continue
      rows.push({
        group,
        keywords: new Set(records.map((r) => r.keyword)).size,
        avg: avgPosition(records),
        fromDate: i === 0 ? null : snapshots[i].displayDate,
      })
      break
    }
  }

  // Lower average position is better; groups with nothing ranking sink to the end.
  return rows.sort((a, b) => (a.avg ?? Infinity) - (b.avg ?? Infinity))
}
