import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useOutletContext,
} from 'react-router-dom'
import type {
  AppState,
  HzOutletContext,
  ParseResult,
  RankingRecord,
  RecordMatcher,
  RecordPatch,
  Snapshot,
  ToastItem,
} from './types'
import { logActivity } from './lib/activityLog'
import { applyCarryForward } from './lib/carryForward'
import { signOut } from './lib/auth'
import { DEV_FIXTURE } from './lib/devFixture'
import { DEV_OVERRIDE } from './lib/devOverrides'
import { GROUPS, OTHER_GROUP, groupForKeyword } from './lib/groups'
import {
  DEFAULT_RECENT,
  deleteSnapshot,
  loadOlderSnapshots,
  loadRecentSnapshots,
  updateRecordFields,
  upsertSnapshot,
} from './lib/storage'
import { DEFAULT_SITE_ID, SITE_BY_SLUG, siteById } from './lib/sites'
import { getWriteGate, useAuth } from './lib/useAuth'
import { AuthGate } from './components/AuthGate'
import { DuplicateWarning } from './components/DuplicateWarning'
import { LoginModal } from './components/LoginModal'
import {
  Sidebar,
  loadSidebarExpanded,
  saveSidebarExpanded,
} from './components/Sidebar'
import { ToastContainer } from './components/Toast'
import { Topbar } from './components/Topbar'
import { UploadModal } from './components/UploadModal'
import { UploadSummary } from './components/UploadSummary'
import { AdminUsers } from './pages/AdminUsers'
import { AskAi } from './pages/AskAi'
import { Home } from './pages/Home'
import { HowItWorks } from './pages/HowItWorks'
import { Log } from './pages/Log'
import { NotBuilt } from './pages/NotBuilt'
import { Rankings } from './pages/Rankings'
import { Sites } from './pages/Sites'

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          {/* Home, at the root. A real route rather than a redirect to the
              default property: the sidebar's Home row points here, and a
              redirect would rewrite the URL back to '/hazreviews' the instant it
              was clicked, so the row could never stay on the address it claims.
              Home is portfolio-wide here; under ':siteSlug' the same component
              narrows to that property. */}
          <Route
            index
            element={
              <RankingGate>
                <Home />
              </RankingGate>
            }
          />
          {/* The site directory. Declared BEFORE ':siteSlug', though order is not
              what saves it: React Router ranks a static segment above a dynamic
              one, so '/sites' can never be read as a site slug. A site whose slug
              was literally 'sites' would still be unreachable — hence the guard
              in the registry test. Outside RankingGate on purpose: the list comes
              from the registry, so it must not wait on a snapshot fetch. */}
          <Route path="sites" element={<Sites />} />
          {/* Site-scoped. The slug is the first segment so a link to a
              property is shareable — which matters when the deliverable is a
              link handed to a client. */}
          <Route
            path=":siteSlug"
            element={
              <RankingGate>
                <Home />
              </RankingGate>
            }
          />
          <Route
            path=":siteSlug/rankings"
            element={
              <RankingGate>
                <Rankings />
              </RankingGate>
            }
          />
          {/* The other five per-site tools from the shared design system. Real
              routes, not omitted links: the site card lists all six, and a listed
              tool that silently redirected would look broken rather than pending.
              Each page names what would feed it. */}
          <Route
            path=":siteSlug/seo"
            element={
              <NotBuilt
                title="SEO"
                note="A per-site SEO score, the way the sibling dashboard tracks it. Nothing feeds it here — this app imports keyword position exports only, with no crawl, audit or score behind them."
              />
            }
          />
          <Route
            path=":siteSlug/health"
            element={
              <NotBuilt
                title="Health"
                note="Uptime and technical health checks for this site. No checks run from this dashboard; the only data it holds is dated keyword position snapshots."
              />
            }
          />
          <Route
            path=":siteSlug/pagespeed"
            element={
              <NotBuilt
                title="PageSpeed"
                note="Core Web Vitals and Lighthouse scores over time. Nothing measures them here — wiring this up would mean a PageSpeed Insights key and somewhere to store the runs."
              />
            }
          />
          <Route
            path=":siteSlug/backlinks"
            element={
              <NotBuilt
                title="Backlinks"
                note="Referring domains and link growth for this site. No backlink source is connected; this dashboard reads spreadsheet exports of Google positions and nothing else."
              />
            }
          />
          <Route
            path=":siteSlug/qa"
            element={
              <NotBuilt
                title="QA"
                note="Content and page QA checks per site. Not built — there is no checklist model, no pass/fail store and no crawler to populate one."
              />
            }
          />
          <Route
            path=":siteSlug/rankings/:groupSlug"
            element={
              <RankingGate>
                <Rankings />
              </RankingGate>
            }
          />
          {/* Global — not scoped to a property. These have their own data
              sources and must not wait on a large ranking fetch, so they also
              sit outside RankingGate. */}
          <Route path="log" element={<Log />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="admin/users" element={<AdminUsers />} />
          {/* Nav rows carried over from the sibling dashboard whose features do
              not exist here. Declared as real routes on purpose — without them
              the catch-all below would redirect, so the row would look like it
              worked while landing the user on Home. */}
          {/* Full-bleed: see the <main> padding branch below. */}
          <Route path="ask-ai" element={<AskAi />} />
          <Route
            path="trash"
            element={
              <NotBuilt
                title="Trash"
                note="Deleting a snapshot on this dashboard is immediate and permanent — there is no soft delete for it to recover. Restoring one would need a deleted_at column on snapshots before this page could show anything."
              />
            }
          />
          {/* A multi-segment unknown path lands on Home rather than a blank
              screen. No longer catches '/' — the index route above is more
              specific, so React Router matches it first and there is no redirect
              loop.
              NOTE: a SINGLE-segment typo never reaches here, because ':siteSlug'
              matches any one segment. '/nonsense' therefore renders the default
              property's summary while keeping its bogus URL. That is the existing
              graceful-fallback behaviour, not a redirect. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthGate>
  )
}

/**
 * Blocks only the routes that read snapshots. Everything else renders
 * immediately.
 */
function RankingGate({ children }: { children: React.ReactNode }) {
  const ctx = useOutletContext<HzOutletContext>()
  if (ctx.snapshotsLoading) {
    return (
      <div className="font-mono text-[12px]" style={{ color: 'var(--muted)' }}>
        Loading rankings…
      </div>
    )
  }
  return <>{children}</>
}

/**
 * THE state container. Owns all data; pages read it through the outlet context.
 *
 * State holds exactly what the database holds. Every transformation is a pure
 * function recomputed in useMemo — that is what makes a live edit propagate
 * correctly to derived views.
 */
function Layout() {
  const location = useLocation()
  const auth = useAuth()

  // Parsed from the path rather than useParams: Layout is the PARENT of the
  // routes that declare :siteSlug, so the param is not in scope here.
  const activeSite = useMemo(() => {
    const first = location.pathname.split('/').filter(Boolean)[0]
    return (first && SITE_BY_SLUG.get(first)) || siteById(DEFAULT_SITE_ID)
  }, [location.pathname])

  const [state, setState] = useState<AppState>({
    snapshots: [],
    snapshotMeta: [],
    activeSnapshotIdBySite: {},
  })
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadSummary, setUploadSummary] = useState<ParseResult | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<ParseResult | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [sidebarExpanded, setSidebarExpanded] = useState(loadSidebarExpanded)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // Closes the mobile drawer on navigation. Adjusted during render rather than in
  // an effect: an effect fires once on mount too, and closing a drawer that was
  // never open costs an extra render pass on every single page load. The state
  // belongs here because Topbar's hamburger opens it and Sidebar renders it, so
  // it cannot live in either.
  const fullBleed = location.pathname === '/ask-ai'

  const [prevPathname, setPrevPathname] = useState(location.pathname)
  if (location.pathname !== prevPathname) {
    setPrevPathname(location.pathname)
    if (mobileNavOpen) setMobileNavOpen(false)
  }

  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null)
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null)
  /** Bumped to re-run the initial load without a full page reload. */
  const [reloadToken, setReloadToken] = useState(0)

  const addToast = useCallback((message: string, type: ToastItem['type'] = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setToasts((prev) => [...prev, { id, message, type }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 6000)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // ─── Initial load ─────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true
    setLoading(true)
    setSnapshotsError(null)
    // Stand-in data instead of a round trip. Null in every production build, so
    // this branch cannot displace a real fetch — see devFixture.ts.
    if (DEV_FIXTURE) {
      setState({
        snapshotMeta: DEV_FIXTURE.meta,
        snapshots: DEV_FIXTURE.snapshots,
        activeSnapshotIdBySite: {},
      })
      setLoading(false)
      return
    }
    loadRecentSnapshots(DEFAULT_RECENT)
      .then(({ meta, snapshots }) => {
        if (!active) return
        setState({ snapshotMeta: meta, snapshots, activeSnapshotIdBySite: {} })
      })
      .catch((err: unknown) => {
        if (!active) return
        const message = err instanceof Error ? err.message : String(err)
        // Recorded in state as well as toasted. A toast auto-dismisses, and a
        // dismissed toast would leave the empty state claiming there is no data
        // when the truth is that we could not reach the database.
        setSnapshotsError(message)
        addToast(message, 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [addToast, reloadToken])

  // ─── Derived view ─────────────────────────────────────────────────────────

  // State is RAW — exactly what the DB holds. Carry-forward is DERIVED here so
  // that editing an early snapshot's volume re-propagates downstream. Applying it
  // to state at load time would freeze inheritance permanently: downstream
  // records would already hold inherited values, so the fill-only-if-empty rule
  // would skip them forever.
  // Carry-forward runs across BOTH sites — applyCarryForward partitions
  // internally — and the view then narrows to the active one.
  const viewSnapshots = useMemo(() => applyCarryForward(state.snapshots), [state.snapshots])

  const siteSnapshots = useMemo(
    () => viewSnapshots.filter((s) => s.site === activeSite.id),
    [viewSnapshots, activeSite.id],
  )

  const siteMeta = useMemo(
    () => state.snapshotMeta.filter((m) => m.site === activeSite.id),
    [state.snapshotMeta, activeSite.id],
  )

  const activeSnapshotId = state.activeSnapshotIdBySite[activeSite.id] ?? null

  const writeGate = useMemo(
    () => getWriteGate(auth.session, auth.isApproved, auth.accessLoading),
    [auth.session, auth.isApproved, auth.accessLoading],
  )

  // Applied here, at the single point where auth reaches the view, rather than
  // inside useAuth: the hook stays the honest report of what Supabase actually
  // said. DEV_OVERRIDE is null in every production build — see devOverrides.ts.
  //
  // writeGate is deliberately NOT overridden. It is derived from the real
  // session, so a forced admin still sees "Sign in to make changes" — which is
  // true, and pretending otherwise would offer writes that must fail.
  const isAdmin = DEV_OVERRIDE?.isAdmin ?? auth.isAdmin
  const accountEmail = DEV_OVERRIDE?.email ?? auth.session?.user.email ?? null
  // A forced admin has no access row to wait on, and AdminUsers holds its
  // redirect until this clears.
  const accessLoading = DEV_OVERRIDE ? false : auth.accessLoading

  // Groups that actually have data, for the sidebar's contextual list.
  const groupsWithData = useMemo(() => {
    const active = siteSnapshots.find((s) => s.id === activeSnapshotId) ?? siteSnapshots[0]
    if (!active) return []
    const present = new Set(active.records.map((r) => groupForKeyword(r.keyword).name))
    return [...GROUPS, OTHER_GROUP].filter((g) => present.has(g.name))
  }, [siteSnapshots, activeSnapshotId])

  // ─── Persistence primitives ───────────────────────────────────────────────

  /**
   * Shared low-level primitive. Wraps upsert in requireAuth, keeps snapshots and
   * snapshotMeta sorted newest-first by rawDate, and returns null on failure so
   * callers decide how to surface the outcome. Deliberately shows no toasts of
   * its own.
   */
  const persistOneSnapshot = useCallback(
    async (snapshot: Snapshot): Promise<Snapshot | null> => {
      try {
        await auth.requireAuth(() => upsertSnapshot(snapshot))
        setState((prev) => {
          const snapshots = [...prev.snapshots.filter((s) => s.id !== snapshot.id), snapshot].sort(
            (a, b) => b.rawDate.localeCompare(a.rawDate),
          )
          const meta = [
            ...prev.snapshotMeta.filter((m) => m.id !== snapshot.id),
            {
              id: snapshot.id,
              site: snapshot.site,
              rawDate: snapshot.rawDate,
              displayDate: snapshot.displayDate,
            },
          ].sort((a, b) => b.rawDate.localeCompare(a.rawDate))
          return { ...prev, snapshots, snapshotMeta: meta }
        })
        return snapshot
      } catch (err) {
        addToast(err instanceof Error ? err.message : String(err), 'error')
        return null
      }
    },
    [auth, addToast],
  )

  const commitImport = useCallback(
    async (result: ParseResult) => {
      const saved = await persistOneSnapshot(result.snapshot)
      if (!saved) return

      const groups = new Set(result.snapshot.records.map((r) => groupForKeyword(r.keyword).name))
      // Site-qualified: with two properties in one log, "Imported … 4 Aug 26"
      // is ambiguous — there can be two.
      void logActivity(
        'upload',
        `rankings:${result.snapshot.site}`,
        `Imported ${result.snapshot.records.length.toLocaleString()} records · ${groups.size} groups — ${result.snapshot.displayDate}`,
      )

      setUploadSummary(result)
      addToast(
        `Imported ${result.snapshot.records.length.toLocaleString()} records · ${groups.size} groups · ${result.markets.length} market${result.markets.length === 1 ? '' : 's'} — ${result.snapshot.displayDate}`,
      )
      if (result.unmatchedKeywords.length > 0) {
        addToast(
          `${result.unmatchedKeywords.length} keyword${result.unmatchedKeywords.length === 1 ? '' : 's'} not matched to a group — add them to src/lib/groups.ts`,
          'warning',
        )
      }
    },
    [persistOneSnapshot, addToast],
  )

  const handleUploadConfirm = useCallback(
    (result: ParseResult) => {
      setShowUpload(false)
      // A snapshot already exists for this date — confirm before replacing.
      if (state.snapshotMeta.some((m) => m.id === result.snapshot.id)) {
        setDuplicateWarning(result)
        return
      }
      void commitImport(result)
    },
    [state.snapshotMeta, commitImport],
  )

  const handleReplaceConfirm = useCallback(async () => {
    const result = duplicateWarning
    setDuplicateWarning(null)
    if (!result) return
    try {
      await auth.requireAuth(() => deleteSnapshot(result.snapshot.id))
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
    await commitImport(result)
  }, [duplicateWarning, auth, addToast, commitImport])

  const handleDeleteSnapshot = useCallback(
    async (id: string) => {
      const target = state.snapshotMeta.find((m) => m.id === id)
      try {
        await auth.requireAuth(() => deleteSnapshot(id))
      } catch (err) {
        addToast(err instanceof Error ? err.message : String(err), 'error')
        return
      }
      // Site read off the meta entry that was already looked up, so the log can
      // never disagree with what was actually deleted.
      void logActivity(
        'delete',
        `rankings:${target?.site ?? activeSite.id}`,
        `Deleted snapshot ${target?.displayDate ?? id}`,
      )
      setState((prev) => ({
        ...prev,
        snapshots: prev.snapshots.filter((s) => s.id !== id),
        snapshotMeta: prev.snapshotMeta.filter((m) => m.id !== id),
        activeSnapshotIdBySite: Object.fromEntries(
          Object.entries(prev.activeSnapshotIdBySite).map(([site, active]) => [
            site,
            active === id ? null : active,
          ]),
        ),
      }))
      addToast(`Deleted snapshot ${target?.displayDate ?? id}`)
    },
    [state.snapshotMeta, auth, addToast, activeSite.id],
  )

  const handleEditCell = useCallback(
    async (snapshotId: string, matcher: RecordMatcher, patch: RecordPatch) => {
      const snapshot = state.snapshots.find((s) => s.id === snapshotId)

      // Defined once and used by BOTH the before-value lookup and the state
      // update, so the logged old value can never drift from the row actually
      // patched.
      const matchRecord = (r: RankingRecord) =>
        (matcher.keyword === undefined || r.keyword === matcher.keyword) &&
        (matcher.market === undefined || r.market === matcher.market)

      const before = snapshot?.records.find(matchRecord)

      // DB first: if the write is rejected, state must not claim it succeeded.
      await auth.requireAuth(() => updateRecordFields(snapshotId, matcher, patch))

      if ('searchVolume' in patch) {
        void logActivity(
          'edit',
          `rankings:${snapshot?.site ?? activeSite.id}`,
          `Volume '${before?.searchVolume ?? ''}' → '${patch.searchVolume ?? ''}' · ${matcher.keyword ?? 'all keywords'}`,
        )
      }

      setState((prev) => ({
        ...prev,
        snapshots: prev.snapshots.map((s) =>
          s.id !== snapshotId
            ? s
            : { ...s, records: s.records.map((r) => (matchRecord(r) ? { ...r, ...patch } : r)) },
        ),
      }))
    },
    [state.snapshots, auth, activeSite.id],
  )

  const handleLoadOlder = useCallback(async () => {
    setLoadingOlder(true)
    setLoadOlderError(null)
    try {
      const loadedIds = new Set(state.snapshots.map((s) => s.id))
      // Active site only — otherwise the button on one property silently pulls
      // the other property's history into memory.
      const next = state.snapshotMeta
        .filter((m) => m.site === activeSite.id && !loadedIds.has(m.id))
        .slice(0, DEFAULT_RECENT)
      if (next.length === 0) return
      const older = await loadOlderSnapshots(next)
      setState((prev) => ({
        ...prev,
        snapshots: [...prev.snapshots, ...older].sort((a, b) => b.rawDate.localeCompare(a.rawDate)),
      }))
    } catch (err) {
      setLoadOlderError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingOlder(false)
    }
  }, [state.snapshots, state.snapshotMeta, activeSite.id])

  const handleToggleSidebar = useCallback(() => {
    setSidebarExpanded((prev) => {
      saveSidebarExpanded(!prev)
      return !prev
    })
  }, [])

  const handleOpenUpload = useCallback(() => {
    // requireAuth resolves once a session exists, so a signed-out click opens the
    // login modal first and the upload dialog opens after a successful sign-in.
    void auth.requireAuth(() => setShowUpload(true)).catch(() => {
      // Cancelled or superseded sign-in — nothing to report.
    })
  }, [auth])

  const context: HzOutletContext = useMemo(
    () => ({
      activeSite,
      snapshots: siteSnapshots,
      allSnapshots: viewSnapshots,
      snapshotMeta: siteMeta,
      activeSnapshotId,
      onSelectSnapshot: (id) =>
        setState((prev) => ({
          ...prev,
          activeSnapshotIdBySite: { ...prev.activeSnapshotIdBySite, [activeSite.id]: id },
        })),
      onOpenUpload: handleOpenUpload,
      onDeleteSnapshot: (id) => void handleDeleteSnapshot(id),
      onEditCell: handleEditCell,
      onLoadOlderSnapshots: handleLoadOlder,
      addToast,
      requireAuth: auth.requireAuth,
      currentUserId: auth.session?.user.id ?? null,
      getAccessToken: auth.getAccessToken,
      writeGate,
      isAdmin,
      accessLoading,
      snapshotsLoading: loading,
      snapshotsError,
      onReloadSnapshots: () => setReloadToken((t) => t + 1),
      loadingOlderSnapshots: loadingOlder,
      loadOlderError,
    }),
    [
      activeSite,
      siteSnapshots,
      viewSnapshots,
      siteMeta,
      activeSnapshotId,
      handleOpenUpload,
      handleDeleteSnapshot,
      handleEditCell,
      handleLoadOlder,
      addToast,
      auth.requireAuth,
      auth.session,
      isAdmin,
      accessLoading,
      writeGate,
      loading,
      snapshotsError,
      loadingOlder,
      loadOlderError,
    ],
  )

  const existingCount =
    duplicateWarning
      ? (state.snapshots.find((s) => s.id === duplicateWarning.snapshot.id)?.records.length ?? null)
      : null

  return (
    <div className="relative flex h-screen overflow-hidden" style={{ background: 'var(--page)' }}>
      <Sidebar
        expanded={sidebarExpanded}
        onToggleExpanded={handleToggleSidebar}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        isAdmin={isAdmin}
        groups={groupsWithData}
        activeSite={activeSite}
        email={accountEmail}
        onSignIn={auth.openLogin}
        onSignOut={() => void signOut()}
      />

      {/* Reserves the rail's footprint. The aside is `fixed`, so without this the
          rail would float over the content instead of the page reflowing around
          it. Both widths animate on the same 200ms curve — see RAIL_EXPANDED. */}
      <div
        className={`hidden shrink-0 transition-[width] duration-200 ease-out md:block ${
          sidebarExpanded ? 'md:w-[240px]' : 'md:w-[64px]'
        }`}
        aria-hidden
      />

      {/* min-w-0 is required: without it a wide matrix forces the whole layout to
          overflow horizontally instead of scrolling inside its own container. */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar open={mobileNavOpen} onOpenMobileNav={() => setMobileNavOpen(true)} />

        {/* `px-4 py-6 md:px-6` verbatim from the shared shell. This gutter is why
            two dashboards side by side look misaligned even when every card in
            them measures identically — it offsets the entire page, and the `sm:`
            breakpoint it used before disagreed with the rail's `md:` besides.

            `scrollbar-gutter` is the other half of the same alignment. The
            shared shell scrolls the WINDOW; here `main` owns the scroll, so its
            scrollbar eats the box that centres a `max-w-*` page — which parked
            every centred column half a scrollbar left of the reference's, and
            shifted it sideways again between a page that scrolls and one that
            does not. `both-edges` reserves the gutter on both sides, so the
            centre is the same number whether a scrollbar is there or not.
            
            Ask AI is the one exception — the shared system's single shell escape
            hatch. It owns its own scroll and pins its composer to the bottom, so
            page padding and an outer scrollbar would both fight it. One pathname
            check, not a second layout. */}
        <main
          className={
            fullBleed
              ? 'min-h-0 flex-1 overflow-hidden'
              : 'flex-1 overflow-auto px-4 py-6 [scrollbar-gutter:stable_both-edges] md:px-6'
          }
        >
          <Outlet context={context} />
        </main>
      </div>

      {showUpload && (
        <UploadModal
          defaultSiteId={activeSite.id}
          onClose={() => setShowUpload(false)}
          onConfirm={handleUploadConfirm}
        />
      )}
      {duplicateWarning && (
        <DuplicateWarning
          displayDate={duplicateWarning.snapshot.displayDate}
          incomingCount={duplicateWarning.snapshot.records.length}
          existingCount={existingCount}
          onReplace={() => void handleReplaceConfirm()}
          onCancel={() => setDuplicateWarning(null)}
        />
      )}
      {uploadSummary && (
        <UploadSummary result={uploadSummary} onClose={() => setUploadSummary(null)} />
      )}
      {auth.modalOpen && <LoginModal onCancel={auth.cancelAuth} />}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
