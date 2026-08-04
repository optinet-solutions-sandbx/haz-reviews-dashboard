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

const SECTION_TITLES: Record<string, [string, string]> = {
  '/rankings': ['Rankings', 'Keyword positions for hazreviews.com'],
  '/log': ['Activity Log', 'Who changed what, and when'],
  '/how-it-works': ['How It Works', 'A quick guide to using the dashboard'],
  '/admin/users': ['Users', 'Access and approvals'],
}

const DEFAULT_TITLE: [string, string] = ['Haz Reviews', 'Command center · hazreviews.com']

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route
            index
            element={
              <RankingGate>
                <Home />
              </RankingGate>
            }
          />
          <Route
            path="rankings"
            element={
              <RankingGate>
                <Rankings />
              </RankingGate>
            }
          />
          <Route
            path="rankings/:groupSlug"
            element={
              <RankingGate>
                <Rankings />
              </RankingGate>
            }
          />
          {/* These have their own data sources and must not wait on a large
              ranking fetch, so they sit outside RankingGate. */}
          <Route path="log" element={<Log />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="admin/users" element={<AdminUsers />} />
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

  const [state, setState] = useState<AppState>({
    snapshots: [],
    snapshotMeta: [],
    activeSnapshotId: null,
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
    loadRecentSnapshots(DEFAULT_RECENT)
      .then(({ meta, snapshots }) => {
        if (!active) return
        setState({ snapshotMeta: meta, snapshots, activeSnapshotId: null })
      })
      .catch((err: unknown) => {
        if (!active) return
        addToast(err instanceof Error ? err.message : String(err), 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [addToast])

  // ─── Derived view ─────────────────────────────────────────────────────────

  // State is RAW — exactly what the DB holds. Carry-forward is DERIVED here so
  // that editing an early snapshot's volume re-propagates downstream. Applying it
  // to state at load time would freeze inheritance permanently: downstream
  // records would already hold inherited values, so the fill-only-if-empty rule
  // would skip them forever.
  const viewSnapshots = useMemo(() => applyCarryForward(state.snapshots), [state.snapshots])

  const writeGate = useMemo(
    () => getWriteGate(auth.session, auth.isApproved, auth.accessLoading),
    [auth.session, auth.isApproved, auth.accessLoading],
  )

  // Groups that actually have data, for the sidebar's contextual list.
  const groupsWithData = useMemo(() => {
    const active =
      viewSnapshots.find((s) => s.id === state.activeSnapshotId) ?? viewSnapshots[0]
    if (!active) return []
    const present = new Set(active.records.map((r) => groupForKeyword(r.keyword).name))
    return [...GROUPS, OTHER_GROUP].filter((g) => present.has(g.name))
  }, [viewSnapshots, state.activeSnapshotId])

  const [title, subtitle] = useMemo(() => {
    const match = Object.keys(SECTION_TITLES).find((p) => location.pathname.startsWith(p))
    return match ? SECTION_TITLES[match] : DEFAULT_TITLE
  }, [location.pathname])

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
            { id: snapshot.id, rawDate: snapshot.rawDate, displayDate: snapshot.displayDate },
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
      void logActivity(
        'upload',
        'rankings',
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
      void logActivity('delete', 'rankings', `Deleted snapshot ${target?.displayDate ?? id}`)
      setState((prev) => ({
        ...prev,
        snapshots: prev.snapshots.filter((s) => s.id !== id),
        snapshotMeta: prev.snapshotMeta.filter((m) => m.id !== id),
        activeSnapshotId: prev.activeSnapshotId === id ? null : prev.activeSnapshotId,
      }))
      addToast(`Deleted snapshot ${target?.displayDate ?? id}`)
    },
    [state.snapshotMeta, auth, addToast],
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
          'rankings',
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
    [state.snapshots, auth],
  )

  const handleLoadOlder = useCallback(async () => {
    setLoadingOlder(true)
    setLoadOlderError(null)
    try {
      const loadedIds = new Set(state.snapshots.map((s) => s.id))
      const next = state.snapshotMeta.filter((m) => !loadedIds.has(m.id)).slice(0, DEFAULT_RECENT)
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
  }, [state.snapshots, state.snapshotMeta])

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
      snapshots: viewSnapshots,
      snapshotMeta: state.snapshotMeta,
      activeSnapshotId: state.activeSnapshotId,
      onSelectSnapshot: (id) => setState((prev) => ({ ...prev, activeSnapshotId: id })),
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
      loadingOlderSnapshots: loadingOlder,
      loadOlderError,
    }),
    [
      viewSnapshots,
      state.snapshotMeta,
      state.activeSnapshotId,
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
      loadingOlder,
      loadOlderError,
    ],
  )

  const latestDate = state.snapshotMeta[0]?.displayDate ?? null
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
        <UploadModal onClose={() => setShowUpload(false)} onConfirm={handleUploadConfirm} />
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
