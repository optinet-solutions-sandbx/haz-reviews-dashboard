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
import { GROUPS, OTHER_GROUP, groupForKeyword } from './lib/groups'
import {
  DEFAULT_RECENT,
  deleteSnapshot,
  loadOlderSnapshots,
  loadRecentSnapshots,
  updateRecordFields,
  upsertSnapshot,
} from './lib/storage'
import { DEFAULT_SITE_ID, SITE_BY_SLUG, siteById, type Site } from './lib/sites'
import { applyTheme, loadTheme, toggleTheme, type Theme } from './lib/theme'
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
import { Home } from './pages/Home'
import { HowItWorks } from './pages/HowItWorks'
import { Log } from './pages/Log'
import { Rankings } from './pages/Rankings'

/** Keyed by the path segment AFTER the site slug. */
const SECTION_TITLES: Record<string, [string, string]> = {
  rankings: ['Rankings', 'Keyword positions'],
  log: ['Activity Log', 'Who changed what, and when'],
  'how-it-works': ['How It Works', 'A quick guide to using the dashboard'],
  'admin/users': ['Users', 'Access and approvals'],
}

/**
 * The property is never hard-coded into a title — with two of them, a stale
 * domain in the subtitle is a lie the user has no reason to doubt.
 */
function titleFor(pathname: string, site: Site): [string, string] {
  const rest = pathname.split('/').filter(Boolean)
  // Drop the site slug when present, so '/hazreviews/rankings' and the global
  // '/log' both resolve against the same table.
  if (rest[0] && SITE_BY_SLUG.has(rest[0])) rest.shift()
  const joined = rest.join('/')
  const key = Object.keys(SECTION_TITLES).find((k) => joined.startsWith(k))
  if (!key) return [site.name, `Command center · ${site.domain}`]
  const [title, subtitle] = SECTION_TITLES[key]
  return [title, key === 'rankings' ? `${subtitle} for ${site.domain}` : subtitle]
}

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
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
          {/* Catches both '/' and an unknown slug, so a typo lands on the
              default property rather than a blank screen. Routes match on the
              SLUG, not the id — the two coincide for hazreviews and would not
              for a site whose stored id is longer than its URL segment. */}
          <Route
            path="*"
            element={<Navigate to={`/${siteById(DEFAULT_SITE_ID).slug}`} replace />}
          />
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
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [sidebarExpanded, setSidebarExpanded] = useState(loadSidebarExpanded)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
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

  // Groups that actually have data, for the sidebar's contextual list.
  const groupsWithData = useMemo(() => {
    const active = siteSnapshots.find((s) => s.id === activeSnapshotId) ?? siteSnapshots[0]
    if (!active) return []
    const present = new Set(active.records.map((r) => groupForKeyword(r.keyword).name))
    return [...GROUPS, OTHER_GROUP].filter((g) => present.has(g.name))
  }, [siteSnapshots, activeSnapshotId])

  const [title, subtitle] = useMemo(
    () => titleFor(location.pathname, activeSite),
    [location.pathname, activeSite],
  )

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

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = toggleTheme(prev)
      applyTheme(next)
      return next
    })
  }, [])

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
      writeGate,
      isAdmin: auth.isAdmin,
      accessLoading: auth.accessLoading,
      snapshotsLoading: loading,
      snapshotsError,
      onReloadSnapshots: () => setReloadToken((t) => t + 1),
      loadingOlderSnapshots: loadingOlder,
      loadOlderError,
    }),
    [
      activeSite,
      siteSnapshots,
      siteMeta,
      activeSnapshotId,
      handleOpenUpload,
      handleDeleteSnapshot,
      handleEditCell,
      handleLoadOlder,
      addToast,
      auth.requireAuth,
      auth.session,
      auth.isAdmin,
      auth.accessLoading,
      writeGate,
      loading,
      snapshotsError,
      loadingOlder,
      loadOlderError,
    ],
  )

  // Active property only — a sidebar claiming "last updated" from the other
  // site's upload would be quietly wrong.
  const latestDate = siteMeta[0]?.displayDate ?? null
  const existingCount =
    duplicateWarning
      ? (state.snapshots.find((s) => s.id === duplicateWarning.snapshot.id)?.records.length ?? null)
      : null

  return (
    <div className="relative flex h-screen overflow-hidden" style={{ background: 'var(--page)' }}>
      {/* Background grid */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
        aria-hidden
      />

      <Sidebar
        expanded={sidebarExpanded}
        onToggleExpanded={handleToggleSidebar}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        isAdmin={auth.isAdmin}
        groups={groupsWithData}
        activeSite={activeSite}
        lastUpdated={latestDate}
        writeGate={writeGate}
        onOpenUpload={handleOpenUpload}
      />

      {/* min-w-0 is required: without it a wide matrix forces the whole layout to
          overflow horizontally instead of scrolling inside its own container. */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          title={title}
          subtitle={subtitle}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          email={auth.session?.user.email ?? null}
          onSignIn={auth.openLogin}
          onSignOut={() => void signOut()}
        />

        <main className="flex-1 overflow-auto px-3 pb-7 pt-5 sm:px-7">
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
