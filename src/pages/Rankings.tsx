import { ArrowLeft, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useOutletContext, useParams } from 'react-router-dom'
import type { HzOutletContext, KeywordGroup, RankingRecord, Snapshot } from '../types'
import { GROUPS, GROUP_BY_SLUG, OTHER_GROUP, groupForKeyword, groupSlug, orderMarkets } from '../lib/groups'
import { avgPosition, computeStats, effectiveDelta, parsePosition } from '../lib/normalize'
import { LoadError } from '../components/LoadError'
import { RankingMatrix } from '../components/RankingMatrix'
import { SnapshotTabs } from '../components/SnapshotTabs'
import { PageHeader } from '../components/PageHeader'
import { StatsRow, type StatKey } from '../components/StatsRow'

export function Rankings() {
  const ctx = useOutletContext<HzOutletContext>()
  const { groupSlug: slug } = useParams<{ groupSlug: string }>()

  // A failed load must never render as an empty dataset.
  if (ctx.snapshotsError) {
    return <LoadError message={ctx.snapshotsError} onRetry={ctx.onReloadSnapshots} />
  }

  if (!slug) return <GroupGrid ctx={ctx} />

  const group =
    GROUP_BY_SLUG.get(slug) ?? (slug === groupSlug(OTHER_GROUP.name) ? OTHER_GROUP : undefined)
  if (!group) return <Navigate to={`/${ctx.activeSite.slug}/rankings`} replace />

  // Keyed so switching group remounts with clean internal filter state.
  return <GroupView key={group.name} ctx={ctx} group={group} />
}

// ─── Grid mode ──────────────────────────────────────────────────────────────

function GroupGrid({ ctx }: { ctx: HzOutletContext }) {
  const snapshot = activeSnapshot(ctx)

  const cards = useMemo(() => {
    if (!snapshot) return []
    const byGroup = new Map<string, RankingRecord[]>()
    for (const r of snapshot.records) {
      const name = groupForKeyword(r.keyword).name
      const list = byGroup.get(name) ?? []
      list.push(r)
      byGroup.set(name, list)
    }
    // Only groups that actually have data, so the grid reflects the dataset
    // rather than the registry.
    return [...GROUPS, OTHER_GROUP]
      .filter((g) => (byGroup.get(g.name)?.length ?? 0) > 0)
      .map((g) => {
        const records = byGroup.get(g.name) ?? []
        return {
          group: g,
          keywords: new Set(records.map((r) => r.keyword)).size,
          avg: avgPosition(records),
        }
      })
  }, [snapshot])

  const header = (
    <PageHeader title="Rankings">
      {ctx.activeSite.domain}
      {snapshot ? ` · ${snapshot.displayDate}` : ''}
    </PageHeader>
  )

  if (!snapshot) {
    return (
      <div className="animate-fade-up space-y-4">
        {header}
        <EmptyState onOpenUpload={ctx.onOpenUpload} writeDisabled={ctx.writeGate.disabled} />
      </div>
    )
  }

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      {header}
      <SnapshotTabs
        snapshots={ctx.snapshots}
        activeId={ctx.activeSnapshotId}
        onSelect={ctx.onSelectSnapshot}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(({ group, keywords, avg }) => (
          <Link
            key={group.name}
            to={`/${ctx.activeSite.slug}/rankings/${groupSlug(group.name)}`}
            className="rounded-xl p-3.5 transition-colors"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                style={{ background: group.color }}
              >
                {group.abbr}
              </span>
              <div className="min-w-0">
                <div
                  className="truncate font-display text-[13px] font-semibold"
                  style={{ color: 'var(--ink)' }}
                >
                  {group.name}
                </div>
                <div
                  className="text-[9px] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: 'var(--muted-3)' }}
                >
                  {group.kind}
                </div>
              </div>
            </div>

            <div className="flex items-end justify-between pt-3">
              <Metric label="Keywords" value={keywords.toLocaleString()} />
              <Metric label="Avg pos" value={avg === null ? '—' : avg.toFixed(1)} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="font-display text-[18px] font-semibold leading-none"
        style={{ color: 'var(--ink)' }}
      >
        {value}
      </div>
      <div
        className="pt-1 text-[9px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </div>
    </div>
  )
}

// ─── Detail mode ────────────────────────────────────────────────────────────

function GroupView({ ctx, group }: { ctx: HzOutletContext; group: KeywordGroup }) {
  const [statFilter, setStatFilter] = useState<StatKey | null>(null)
  const [search, setSearch] = useState('')

  // Group membership is COMPUTED, never stored, so a registry fix re-groups
  // every snapshot including historical ones.
  const snapshotsForGroup = useMemo(
    () =>
      ctx.snapshots.map((s) => ({
        snapshot: s,
        records: s.records.filter((r) => groupForKeyword(r.keyword).name === group.name),
      })),
    [ctx.snapshots, group.name],
  )

  const activeIndex = Math.max(
    0,
    ctx.activeSnapshotId ? ctx.snapshots.findIndex((s) => s.id === ctx.activeSnapshotId) : 0,
  )
  const active = snapshotsForGroup[activeIndex]
  const previous = ctx.snapshots[activeIndex + 1]

  const markets = useMemo(
    () => orderMarkets((active?.records ?? []).map((r) => r.market)),
    [active],
  )

  const stats = useMemo(() => computeStats(active?.records ?? []), [active])

  const visible = useMemo(() => {
    let records = active?.records ?? []

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      records = records.filter((r) => r.keyword.toLowerCase().includes(q))
    }

    if (statFilter) {
      records = records.filter((r) => matchesStat(r, statFilter))
    }

    return records
  }, [active, search, statFilter])

  const hasOlder = ctx.snapshotMeta.length > ctx.snapshots.length

  if (!active) {
    return <EmptyState onOpenUpload={ctx.onOpenUpload} writeDisabled={ctx.writeGate.disabled} />
  }

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      {/* This IS the page heading, so the group name is an h1 rather than a
          second-level one — the Topbar no longer supplies a title above it. The
          back link and colour chip stay alongside it instead of being replaced
          by a bare PageHeader. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Link
            to={`/${ctx.activeSite.slug}/rankings`}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
            aria-label="Back to all groups"
            title="Back to all groups"
          >
            <ArrowLeft size={14} />
          </Link>
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold text-white"
            style={{ background: group.color }}
            aria-hidden
          >
            {group.abbr}
          </span>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            {group.name}
          </h1>
        </div>
        <div className="text-sm" style={{ color: 'var(--muted)' }}>
          {ctx.activeSite.domain}
        </div>
      </div>

      <StatsRow
        stats={stats}
        active={statFilter}
        onToggle={(key) => setStatFilter((prev) => (prev === key ? null : key))}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border-2)', minWidth: 200 }}
        >
          <Search size={13} style={{ color: 'var(--muted-3)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter keywords…"
            className="w-full bg-transparent text-[12px] outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </div>
        <SnapshotTabs
          snapshots={ctx.snapshots}
          activeId={ctx.activeSnapshotId}
          onSelect={ctx.onSelectSnapshot}
        />
      </div>

      <RankingMatrix
        snapshot={active.snapshot}
        previousSnapshot={previous}
        markets={markets}
        records={visible}
        editDisabled={ctx.writeGate.editDisabled}
        editTitle={ctx.writeGate.title}
        onEditVolume={(record, next) =>
          ctx.onEditCell(active.snapshot.id, { keyword: record.keyword }, { searchVolume: next })
        }
      />

      {hasOlder && (
        <div className="flex flex-col items-center gap-1.5 py-2">
          <button
            type="button"
            disabled={ctx.loadingOlderSnapshots}
            onClick={() => void ctx.onLoadOlderSnapshots()}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-60"
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            {ctx.loadingOlderSnapshots
              ? 'Loading…'
              : `Load older history (${ctx.snapshotMeta.length - ctx.snapshots.length} more)`}
          </button>
          {ctx.loadOlderError && (
            <p className="text-[11px]" style={{ color: 'var(--neg)' }}>
              {ctx.loadOlderError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Mirrors computeStats' bucketing exactly, so a filter can never disagree with
 *  the counter that offered it. */
function matchesStat(r: RankingRecord, key: StatKey): boolean {
  const pos = parsePosition(r.position)

  if (pos === 'NR' || pos === null) return key === 'notRanking'

  if (key === 'top3') return pos >= 1 && pos <= 3

  const d = effectiveDelta(r.change, pos)
  if (key === 'improved') return d > 0
  if (key === 'dropped') return d < 0
  if (key === 'unchanged') return d === 0
  return false
}

function activeSnapshot(ctx: HzOutletContext): Snapshot | undefined {
  if (ctx.snapshots.length === 0) return undefined
  return ctx.snapshots.find((s) => s.id === ctx.activeSnapshotId) ?? ctx.snapshots[0]
}

function EmptyState({
  onOpenUpload,
  writeDisabled,
}: {
  onOpenUpload: () => void
  writeDisabled: boolean
}) {
  return (
    <div
      className="animate-fade-up rounded-xl px-6 py-12 text-center"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
    >
      <h2 className="font-display text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
        No ranking data yet
      </h2>
      <p className="mx-auto max-w-[420px] pt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
        Import a keyword export to get started. Any .xlsx, .xls or .csv with a Keyword column will
        do — position, market, volume and URL columns are picked up automatically if present.
      </p>
      <button
        type="button"
        onClick={onOpenUpload}
        disabled={writeDisabled}
        className="mt-4 rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
        style={{ background: 'var(--btn-ink)' }}
      >
        Import data
      </button>
    </div>
  )
}
