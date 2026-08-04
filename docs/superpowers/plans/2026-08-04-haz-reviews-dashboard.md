# Haz Reviews Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal dashboard that ingests a keyword-ranking spreadsheet for `hazreviews.com`, stores each import as an immutable dated snapshot, and renders it as a filterable matrix with movement indicators, inline editing, an audit log, and approval-gated auth.

**Architecture:** React 19 SPA with one state container (`Layout` in `src/App.tsx`) that owns all data and passes it to pages through `useOutletContext`. State holds exactly what the database holds; every transformation (carry-forward, stats, grouping) is a pure function recomputed in `useMemo`. The browser talks to Supabase PostgREST directly — there is no backend for the data path, and security lives in RLS policies. Keyword→group membership is derived at render time from a single registry file, never stored.

**Tech Stack:** Vite 6, React 19, TypeScript 5.8 (strict), Tailwind v4 (CSS variables, no config file), Supabase (Postgres + Auth + RLS), `xlsx` for parsing, `lucide-react` for icons, Vitest (node environment), Vercel for hosting.

**Spec:** [docs/superpowers/specs/2026-08-04-haz-reviews-dashboard-design.md](../specs/2026-08-04-haz-reviews-dashboard-design.md)

## Global Constraints

- TypeScript `strict: true`. `noUnusedLocals` / `noUnusedParameters` **off**; `noFallthroughCasesInSwitch` **on**.
- Named exports only. No default exports anywhere in `src/` (Vercel functions in `api/` are exempt — they require a default export).
- `import type` for all type-only imports.
- Tailwind v4 with **no `tailwind.config.js`**. All tokens are CSS variables in `src/index.css`. `@source not "../docs"` is required or committed markdown injects dead CSS.
- No hard-coded hex values outside `src/index.css`. Components reference `var(--token)` in Tailwind arbitrary-value brackets. Inline `style` only for computed values.
- Dev port **3002** with `strictPort: true`.
- localStorage keys use the `hz_` prefix. Every localStorage access is wrapped in `try/catch` — private-mode browsers throw.
- DB is `snake_case`, TS is `camelCase`, mapped explicitly in the storage layer. No auto-mapper.
- Error handling: `err instanceof Error ? err.message : String(err)` → toast. Never let a bare `throw` reach the user.
- Comments explain **why**, and specifically why the obvious alternative is wrong.
- Section separators inside long files: `// ─── Name ───────────`.
- All shared types live in `src/types/index.ts`. Local types stay local.
- Commit after every task. Conventional prefixes scoped to an area: `feat(rankings):`, `fix(parser):`, `chore(db):`, `docs:`.

---

## File Structure

```
Haz-Reviews-Dashboard/
├── index.html                  # Vite entry, Google Fonts preconnect
├── package.json
├── vite.config.ts              # react + tailwind plugins, port 3002 strictPort
├── vitest.config.ts            # node env, src/**/*.test.ts
├── tsconfig.json               # composite root, references only
├── tsconfig.app.json           # include: ["src"]
├── tsconfig.node.json          # include: vite.config.ts, vitest.config.ts
├── vercel.json                 # SPA rewrite
├── .npmrc                      # legacy-peer-deps=true
├── .env.example
│
├── supabase/
│   ├── setup.sql               # tables + indexes + permissive RLS
│   └── auth-lockdown.sql       # authenticated+approved read AND write
│
├── src/
│   ├── main.tsx                # applyTheme() before first paint, BrowserRouter
│   ├── App.tsx                 # Layout (all state) + route table + RankingGate
│   ├── index.css               # Tailwind import + ALL design tokens
│   ├── vite-env.d.ts
│   ├── types/index.ts          # every shared type
│   │
│   ├── lib/
│   │   ├── groups.ts           # REGISTRY + groupForKeyword (single source of truth)
│   │   ├── groups.test.ts
│   │   ├── normalize.ts        # parsePosition, parseChange, effectiveDelta, computeStats
│   │   ├── normalize.test.ts
│   │   ├── dates.ts            # toIsoLocal, formatDisplayDate, normalizeDateValue
│   │   ├── dates.test.ts
│   │   ├── carryForward.ts     # applyCarryForward
│   │   ├── carryForward.test.ts
│   │   ├── parser.ts           # parseSheet (flat sheet → Snapshot)
│   │   ├── parser.test.ts
│   │   ├── supabase.ts         # client singleton, throws on missing env
│   │   ├── storage.ts          # all snapshot/record DB access
│   │   ├── storage.test.ts
│   │   ├── auth.ts             # Supabase Auth wrappers + REQUIRE_AUTH flag
│   │   ├── useAuth.ts          # session + approval + requireAuth gate
│   │   ├── userAccess.ts       # user_access CRUD
│   │   ├── activityLog.ts      # best-effort audit writes + reads
│   │   └── theme.ts            # light/dark persistence
│   │
│   ├── components/
│   │   ├── Sidebar.tsx  Topbar.tsx
│   │   ├── AuthGate.tsx  Login.tsx  LoginModal.tsx
│   │   ├── UploadModal.tsx  UploadSummary.tsx  DuplicateWarning.tsx
│   │   ├── StatsRow.tsx  PosBadge.tsx  SnapshotTabs.tsx
│   │   ├── EditableCell.tsx  Toast.tsx
│   │   └── RankingMatrix.tsx
│   │
│   └── pages/
│       ├── Home.tsx  Rankings.tsx  Log.tsx  AdminUsers.tsx  HowItWorks.tsx
└── docs/superpowers/{specs,plans}/
```

**Decomposition note:** `Rankings.tsx` holds its own private sub-components (`GroupGrid`, `GroupView`, `MarketFilter`, `StatsCardModal`) separated by section rules, following the template's convention. `RankingMatrix.tsx` is extracted because `Home` also renders a compact variant. Only genuinely cross-page components live in `components/`.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `.npmrc`, `index.html`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vercel.json`, `.env.example`, `src/vite-env.d.ts`, `src/main.tsx`, `src/App.tsx`, `src/index.css`

**Interfaces:**
- Consumes: nothing
- Produces: a buildable, testable project. `npm run build` and `npm test` both exit 0.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "haz-reviews-dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.105.4",
    "lucide-react": "^1.14.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.15.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.5",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.4.1",
    "tailwindcss": "^4.1.5",
    "typescript": "~5.8.3",
    "vite": "^6.3.5",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Write `.npmrc` and `vite.config.ts`**

`.npmrc`:
```
legacy-peer-deps=true
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Port 3002 is deliberate: 3000 belongs to Ranking-Reports and 3001 to
// TryBet-Dashboard. strictPort makes a collision fail loudly instead of
// silently moving the dev server somewhere the team does not expect.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3002, strictPort: true },
})
```

- [ ] **Step 3: Write the three tsconfigs and `vitest.config.ts`**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "composite": true,
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo"
  },
  "include": ["src"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "composite": true,
    "types": ["node"],
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo"
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
```

- [ ] **Step 4: Write `index.html`, `vercel.json`, `.env.example`, `src/vite-env.d.ts`**

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Haz Reviews · Ranking Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`vercel.json`:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

`.env.example`:
```
# Client vars are inlined into the bundle at build time — treat as public.
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
# 'true' gates the whole app behind sign-in + admin approval.
VITE_REQUIRE_AUTH=true
```

`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 5: Write placeholder `src/index.css`, `src/main.tsx`, `src/App.tsx`**

These are replaced in Task 2 and Task 10; they exist now so the build can be verified.

`src/index.css`:
```css
@import "tailwindcss";
@source not "../docs";
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

`src/App.tsx`:
```tsx
export function App() {
  return <div className="p-8 font-sans">Haz Reviews Dashboard</div>
}
```

- [ ] **Step 6: Install and verify the build**

Run: `npm install`
Then: `npm run build`
Expected: `tsc -b` emits no errors and `vite build` writes `dist/`.

Run: `npm test`
Expected: Vitest exits 0 reporting "No test files found" is **not** acceptable — pass `--passWithNoTests` is *not* added; instead this step only verifies `npm run build`. Test verification begins in Task 4 when the first test file exists.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React 19 + Tailwind v4 project"
```

---

## Task 2: Design tokens and theme

**Files:**
- Modify: `src/index.css`, `src/main.tsx`
- Create: `src/lib/theme.ts`, `src/lib/theme.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `applyTheme(theme: Theme): void`, `loadTheme(): Theme`, `toggleTheme(current: Theme): Theme`, `type Theme = 'light' | 'dark'`

- [ ] **Step 1: Write the full token sheet into `src/index.css`**

Three tiers, light values on `:root`, dark overrides under `.dark`. Copy these values exactly — they are the audited Color System v1 palette shared across the sibling dashboards.

```css
@import "tailwindcss";

/* Tailwind v4 auto-detects sources and generates CSS from class-looking
   strings inside committed markdown. Without this, an old plan file emits
   real rules for hexes that no longer exist in src/. */
@source not "../docs";

@theme {
  --font-display: 'Outfit', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --font-body: 'Figtree', sans-serif;
}

:root {
  /* Tier 1 — semantic app tokens */
  --page: #F5F7FA;        --grid-line: #E7ECF3;
  --surface: #FFFFFF;     --surface-2: #FAFBFD;   --surface-3: #F2F5F9;
  --hover: #F0F4F9;
  --border: #DCE3ED;      --border-2: #E4EAF2;    --border-3: #EDF1F7;
  --border-strong: #C6D0DE;
  --ink: #101A2E;         --ink-2: #1E293B;
  --text-2: #475467;      --muted: #64728A;       --muted-2: #7C8AA1;
  --muted-3: #94A2B8;
  --brand-navy: #1E2A6E;  --brand-blue: #1C9FE0;  --brand-light: #7FD4F5;
  --navy-text: #1E2A6E;   --brand-blue-deep: #1580B8;
  --btn-ink: #101A2E;     --btn-ink-hover: #1E2A6E;
  --active-tint: #EAF4FC;
  --pos: #0F7A3D;  --pos-surface: #E8F6EE;  --pos-border: #BEE3CE;
  --neg: #C42A3B;  --neg-surface: #FCEBEC;  --neg-border: #F3C7CC;
  --info: #1F5FBF; --info-surface: #EAF1FC; --info-border: #C6D9F5;
  --warn: #B45309; --warn-surface: #FDF3E7; --warn-border: #F5DDBC;
  --scrollbar: #C6D0DE;   --scrollbar-hover: #A9B6C8;

  /* Tier 2 — matrix tokens. MUST be fully opaque: sticky cells overlay
     scrolled content, and alpha would let rows show through. --mx-hover is
     the single exception and is applied only to non-sticky cells. */
  --mx-bg: #FFFFFF;       --mx-alt: #F7F9FC;      --mx-ink: #1B2436;
  --mx-ink-2: #55627A;    --mx-line: #DFE6F0;     --mx-line-2: #EAEFF6;
  --mx-head: #EEF2F8;     --mx-head-ink: #2A3550;
  --mx-sticky: #FFFFFF;   --mx-sticky-alt: #F7F9FC;
  --mx-pos: #0F7A3D;      --mx-neg: #C42A3B;
  --mx-hover: rgba(28, 159, 224, 0.06);
  --band-date: #3D5FA8;   /* theme-independent on purpose */

  /* Tier 3 — group column palette (header/cell pairs) */
  --mx-col-purple-h: #D9D2E9; --mx-col-purple-c: #EDE8F5;
  --mx-col-grey-h:   #D9D9D9; --mx-col-grey-c:   #EFEFEF;
  --mx-col-yellow-h: #FFE599; --mx-col-yellow-c: #FFF2CC;
  --mx-col-green-h:  #D9EAD3; --mx-col-green-c:  #EAF4E6;
  --mx-col-cyan-h:   #D0E0E3; --mx-col-cyan-c:   #E7EFF1;
  --mx-col-orange-h: #FCE5CD; --mx-col-orange-c: #FDF0E3;
  --mx-col-blue-h:   #CFE2F3; --mx-col-blue-c:   #E7F0FA;
  --mx-col-magenta-h:#EAD1DC; --mx-col-magenta-c:#F4E8EE;
}

.dark {
  --page: #0A0E15;        --grid-line: #141B27;
  --surface: #131A26;     --surface-2: #172030;   --surface-3: #1C2634;
  --hover: #1B2532;
  --border: #29354A;      --border-2: #232E40;    --border-3: #1E2836;
  --border-strong: #3A4860;
  --ink: #E8EDF6;         --ink-2: #D3DCEA;
  --text-2: #B6C2D6;      --muted: #8EA1BA;       --muted-2: #7C8DA6;
  --muted-3: #6B7C94;
  --navy-text: #9DB4F0;   --brand-blue-deep: #2AAEEF;
  --btn-ink: #1C9FE0;     --btn-ink-hover: #2AAEEF;
  --active-tint: #16283A;
  --pos: #35CE86;  --pos-surface: #102B1E;  --pos-border: #1F4A34;
  --neg: #FF6B7A;  --neg-surface: #2C1418;  --neg-border: #4D2129;
  --info: #6BA8F0; --info-surface: #11203A; --info-border: #21375C;
  --warn: #F0B34A; --warn-surface: #2B2010; --warn-border: #4C3A1B;
  --scrollbar: #2F3C52;   --scrollbar-hover: #3F5069;

  --mx-bg: #121A27;       --mx-alt: #16202F;      --mx-ink: #DCE4F0;
  --mx-ink-2: #94A5BF;    --mx-line: #263349;     --mx-line-2: #1F2B3D;
  --mx-head: #1B2637;     --mx-head-ink: #C7D4E6;
  --mx-sticky: #121A27;   --mx-sticky-alt: #16202F;
  --mx-pos: #35CE86;      --mx-neg: #FF6B7A;
  --mx-hover: rgba(28, 159, 224, 0.10);

  --mx-col-purple-h: #3A3350; --mx-col-purple-c: #272238;
  --mx-col-grey-h:   #333B47; --mx-col-grey-c:   #242B35;
  --mx-col-yellow-h: #4A3F22; --mx-col-yellow-c: #332B16;
  --mx-col-green-h:  #23402C; --mx-col-green-c:  #182C1E;
  --mx-col-cyan-h:   #21383D; --mx-col-cyan-c:   #17272B;
  --mx-col-orange-h: #4A3524; --mx-col-orange-c: #332417;
  --mx-col-blue-h:   #22364F; --mx-col-blue-c:   #182538;
  --mx-col-magenta-h:#432B36; --mx-col-magenta-c:#2E1D25;
}

body {
  font-family: var(--font-body);
  background: var(--page);
  color: var(--ink);
}

.font-display { font-family: var(--font-display); }
.font-mono    { font-family: var(--font-mono); }

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); }

@keyframes fadeUp  { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes modalIn { from { opacity: 0; transform: scale(.96) translateY(8px) } to { opacity: 1; transform: none } }
@keyframes toastIn { from { opacity: 0; transform: translateX(20px) } to { opacity: 1; transform: none } }
@keyframes barRise { from { transform: scaleY(0) } to { transform: scaleY(1) } }

.animate-fade-up  { animation: fadeUp .25s ease-out both }
.animate-modal-in { animation: modalIn .18s ease-out both }
.animate-toast-in { animation: toastIn .2s ease-out both }

.text-glow:hover {
  color: var(--brand-blue);
  text-shadow: 0 0 6px rgba(28,159,224,.55), 0 0 2px rgba(28,159,224,.45);
}
.text-glow-light:hover {
  text-shadow: 0 0 8px rgba(127,212,245,.85), 0 0 3px rgba(255,255,255,.6);
}
```

- [ ] **Step 2: Write the failing test for `theme.ts`**

`src/lib/theme.test.ts`:
```ts
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { loadTheme, toggleTheme, THEME_KEY } from './theme'

describe('theme', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  it('defaults to light when nothing is stored', () => {
    expect(loadTheme()).toBe('light')
  })

  it('reads a stored theme', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    expect(loadTheme()).toBe('dark')
  })

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem(THEME_KEY, 'chartreuse')
    expect(loadTheme()).toBe('light')
  })

  it('toggles between light and dark', () => {
    expect(toggleTheme('light')).toBe('dark')
    expect(toggleTheme('dark')).toBe('light')
  })

  it('survives localStorage throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('private mode') },
      setItem: () => { throw new Error('private mode') },
    })
    expect(loadTheme()).toBe('light')
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: FAIL — cannot resolve `./theme`.

- [ ] **Step 4: Implement `src/lib/theme.ts`**

```ts
export type Theme = 'light' | 'dark'

export const THEME_KEY = 'hz_theme'

/** Reads the stored theme. Falls back to light on anything unexpected —
 *  private-mode browsers throw on localStorage access, and a corrupted value
 *  must not brick first paint. */
export function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function toggleTheme(current: Theme): Theme {
  return current === 'light' ? 'dark' : 'light'
}

/** Applies the theme to <html> and persists it. Called from main.tsx BEFORE
 *  the first React render, so a dark-mode user never sees a light flash. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Persistence is a nicety; the class is already applied.
  }
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Wire theme-before-paint into `src/main.tsx`**

Add above `createRoot`:
```tsx
import { applyTheme, loadTheme } from './lib/theme'

// Before first paint, deliberately. Applying this inside a component would
// render one light frame for dark-mode users.
applyTheme(loadTheme())
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(design): add three-tier token sheet and theme persistence"
```

---

## Task 3: Shared types

**Files:**
- Create: `src/types/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: every shared type used by later tasks. Exact definitions below — later tasks reference these names verbatim.

- [ ] **Step 1: Write `src/types/index.ts`**

```ts
// ─── Data ────────────────────────────────────────────────────────────────

/** One tracked keyword in one market, as of one snapshot.
 *  `position`, `previous` and `change` are strings on purpose — the source
 *  vocabulary includes 'NR', 'Not in top 100' and '-', and normalising at
 *  write time would destroy information we cannot recover. */
export interface RankingRecord {
  keyword: string
  market: string
  position: string
  previous: string
  /** Verbatim source token, e.g. '+2', '-3', '▲ 4'. Deltas are computed
   *  separately by effectiveDelta(); badges render what the export showed. */
  change: string
  urlFound: string
  searchVolume: string
  date: string
}

export interface Snapshot {
  id: string           // 'snap-<rawDate>' — deterministic, so upsert is idempotent
  rawDate: string      // 'YYYY-MM-DD'
  displayDate: string  // e.g. '4 Aug 26' — re-derived on read, never trusted
  records: RankingRecord[]
}

export interface SnapshotMeta {
  id: string
  rawDate: string
  displayDate: string
}

export type ParsedPosition = number | 'NR' | null

// ─── Grouping ────────────────────────────────────────────────────────────

export type GroupKind = 'brand' | 'category'

/** A keyword group. Membership is DERIVED from this registry by
 *  groupForKeyword() and never stored on a record, so improving the registry
 *  re-groups all history retroactively. */
export interface KeywordGroup {
  name: string
  abbr: string
  color: string
  kind: GroupKind
  /** Extra phrases that mean this group. Must never contain a token that
   *  appears inside an unrelated word — see groups.test.ts. */
  aliases: string[]
}

// ─── Stats ───────────────────────────────────────────────────────────────

/** Movement buckets (improved/dropped/unchanged/notRanking) are mutually
 *  exclusive and sum to total. `top3` OVERLAPS them by design and is not
 *  part of that sum. */
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
  /** Keywords that fell through to the Other group — surfaced so the
   *  registry can be improved. Never dropped. */
  unmatchedKeywords: string[]
  markets: string[]
  /** Markets not present in MARKET_ORDER. Rendered appended, never dropped. */
  unknownMarkets: string[]
  detectedDate: string
}

// ─── App state ───────────────────────────────────────────────────────────

export interface AppState {
  snapshots: Snapshot[]        // hydrated: recent window + on-demand older
  snapshotMeta: SnapshotMeta[] // every snapshot that exists, metadata only
  activeSnapshotId: string | null
}

export interface ToastItem {
  id: string
  message: string
  type: 'success' | 'warning' | 'error'
}

// ─── Auth ────────────────────────────────────────────────────────────────

/** Presentational-only gate for write-triggering controls. Does NOT replace
 *  requireAuth/RLS as the enforcement boundary. */
export interface WriteGate {
  disabled: boolean
  editDisabled: boolean
  title?: string
}

/** 'revoked' is a distinct third state, not a return to 'pending', so an
 *  admin who cut someone off never sees them again as a new signup. */
export type UserAccessStatus = 'pending' | 'approved' | 'revoked'

export interface UserAccessRow {
  userId: string
  email: string
  status: UserAccessStatus
  isAdmin: boolean
  createdAt: string
  revokedAt: string | null
}

export interface ActivityLogRow {
  id: number
  createdAt: string
  email: string
  action: 'upload' | 'edit' | 'delete'
  section: string
  summary: string
}

// ─── Outlet context ──────────────────────────────────────────────────────

export interface RecordMatcher {
  keyword?: string
  market?: string
}

export interface RecordPatch {
  searchVolume?: string
}

/** The entire contract between Layout and every page. Pages read this via
 *  useOutletContext<HzOutletContext>() and never import from one another. */
export interface HzOutletContext {
  snapshots: Snapshot[]        // carry-forward APPLIED — this is the view
  snapshotMeta: SnapshotMeta[]
  activeSnapshotId: string | null
  onSelectSnapshot: (id: string) => void
  onOpenUpload: () => void
  onDeleteSnapshot: (id: string) => void
  onEditCell: (snapshotId: string, matcher: RecordMatcher, patch: RecordPatch) => Promise<void>
  onLoadOlderSnapshots: () => Promise<void>
  addToast: (message: string, type?: ToastItem['type']) => void
  requireAuth: <T>(fn: () => T | Promise<T>) => Promise<T>
  currentUserId: string | null
  writeGate: WriteGate
  isAdmin: boolean
  accessLoading: boolean
  snapshotsLoading: boolean
  loadingOlderSnapshots: boolean
  loadOlderError: string | null
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(types): add shared type vocabulary"
```

---

## Task 4: The group registry and keyword matching

This is the highest-risk logic in the project. Tests come first and are exhaustive.

**Files:**
- Create: `src/lib/groups.ts`, `src/lib/groups.test.ts`

**Interfaces:**
- Consumes: `KeywordGroup`, `GroupKind` from `src/types`
- Produces:
  - `GROUPS: KeywordGroup[]`
  - `OTHER_GROUP: KeywordGroup`
  - `MARKET_ORDER: string[]`
  - `groupSlug(name: string): string`
  - `GROUP_BY_SLUG: Map<string, KeywordGroup>`
  - `groupForKeyword(keyword: string): KeywordGroup`
  - `orderMarkets(markets: string[]): string[]`

- [ ] **Step 1: Write the failing tests**

`src/lib/groups.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  GROUPS, GROUP_BY_SLUG, MARKET_ORDER, OTHER_GROUP,
  groupForKeyword, groupSlug, orderMarkets,
} from './groups'

describe('groupSlug', () => {
  it('strips everything that is not alphanumeric', () => {
    expect(groupSlug('Lucky7Even')).toBe('lucky7even')
    expect(groupSlug('BC.Game')).toBe('bcgame')
    expect(groupSlug('Wild.io')).toBe('wildio')
    expect(groupSlug('Live Casino')).toBe('livecasino')
  })
})

describe('registry integrity', () => {
  it('has unique slugs', () => {
    const slugs = GROUPS.map(g => groupSlug(g.name))
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('indexes every group by slug', () => {
    for (const g of GROUPS) {
      expect(GROUP_BY_SLUG.get(groupSlug(g.name))).toBe(g)
    }
  })

  it('does not include the Other fallback in the registry', () => {
    expect(GROUPS).not.toContain(OTHER_GROUP)
  })

  it('gives every group a hex colour and a short abbreviation', () => {
    for (const g of GROUPS) {
      expect(g.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(g.abbr.length).toBeGreaterThan(0)
      expect(g.abbr.length).toBeLessThanOrEqual(3)
    }
  })
})

describe('groupForKeyword — brand matching', () => {
  it('matches a plain brand term', () => {
    expect(groupForKeyword('cleobetra casino review').name).toBe('Cleobetra')
  })

  it('is case and punctuation insensitive', () => {
    expect(groupForKeyword('CLEOBETRA  Casino!').name).toBe('Cleobetra')
  })

  it('matches a brand written with punctuation via its alias', () => {
    expect(groupForKeyword('bc game promo code').name).toBe('BC.Game')
    expect(groupForKeyword('wild io casino').name).toBe('Wild.io')
    expect(groupForKeyword('jack com review').name).toBe('Jack.com')
  })

  it('matches a numeric brand name', () => {
    expect(groupForKeyword('10bet bonus').name).toBe('10Bet')
    expect(groupForKeyword('lucky7even free spins').name).toBe('Lucky7Even')
  })
})

describe('groupForKeyword — the collision that matters', () => {
  // 'Jack.com' is a real brand and 'live blackjack' is a real keyword.
  // Substring matching classifies the second as the first, which is wrong
  // and looks plausible in the UI. Word-boundary matching is what prevents it.
  it('does not classify "live blackjack" as Jack.com', () => {
    const g = groupForKeyword('live blackjack')
    expect(g.name).not.toBe('Jack.com')
    expect(g.name).toBe('Live Casino')
  })

  it('does not classify "best blackjack sites" as Jack.com', () => {
    expect(groupForKeyword('best blackjack sites').name).not.toBe('Jack.com')
  })

  it('still classifies a genuine Jack.com term correctly', () => {
    expect(groupForKeyword('jack.com casino review').name).toBe('Jack.com')
  })

  it('does not match a brand inside a longer unrelated word', () => {
    // 'Stake' must not swallow 'mistaken', 'Realz' must not swallow 'realzy'
    expect(groupForKeyword('mistaken identity casino').name).not.toBe('Stake')
    expect(groupForKeyword('realzy bonus').name).not.toBe('Realz')
  })
})

describe('groupForKeyword — precedence', () => {
  it('prefers the longest match', () => {
    // 'live casino' (2 tokens) must beat a hypothetical 1-token match
    expect(groupForKeyword('best live casino uae').name).toBe('Live Casino')
  })

  it('prefers a brand over a category on an equal-length match', () => {
    // 'casinia' (brand, 1 token) vs 'bonus' (category, 1 token)
    expect(groupForKeyword('casinia bonus').name).toBe('Casinia')
  })

  it('is deterministic for the same input', () => {
    const a = groupForKeyword('spinsup casino bonus')
    const b = groupForKeyword('spinsup casino bonus')
    expect(a.name).toBe(b.name)
  })
})

describe('groupForKeyword — categories', () => {
  it('matches crypto terms', () => {
    expect(groupForKeyword('best crypto casinos uae').name).toBe('Crypto Casinos')
    expect(groupForKeyword('no kyc bitcoin casino').name).toBe('Crypto Casinos')
  })

  it('matches bonus terms', () => {
    expect(groupForKeyword('no deposit bonus codes').name).toBe('Bonuses')
    expect(groupForKeyword('casino cashback offers').name).toBe('Bonuses')
  })

  it('matches slot terms', () => {
    expect(groupForKeyword('high rtp slots').name).toBe('Slots')
    expect(groupForKeyword('best payout jackpot game').name).toBe('Slots')
  })

  it('matches crash and instant games', () => {
    expect(groupForKeyword('aviator game strategy').name).toBe('Crash & Instant')
    expect(groupForKeyword('plinko casino').name).toBe('Crash & Instant')
  })
})

describe('groupForKeyword — fallback', () => {
  it('returns Other for an unmatched keyword rather than dropping it', () => {
    expect(groupForKeyword('zzz unmatched phrase').name).toBe(OTHER_GROUP.name)
  })

  it('returns Other for an empty keyword', () => {
    expect(groupForKeyword('').name).toBe(OTHER_GROUP.name)
  })
})

describe('orderMarkets', () => {
  it('puts registry markets first in registry order', () => {
    expect(orderMarkets(['US', 'AE'])).toEqual(['AE', 'US'])
  })

  it('appends unlisted markets alphabetically rather than dropping them', () => {
    // Dropping an unexpected market loses data silently, which is worse than
    // showing a column nobody planned for.
    expect(orderMarkets(['ZA', 'US', 'AE', 'KW'])).toEqual(['AE', 'KW', 'US', 'ZA'])
  })

  it('deduplicates', () => {
    expect(orderMarkets(['AE', 'AE', 'US'])).toEqual(['AE', 'US'])
  })

  it('includes AE by default in the registry order', () => {
    expect(MARKET_ORDER[0]).toBe('AE')
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/groups.test.ts`
Expected: FAIL — cannot resolve `./groups`.

- [ ] **Step 3: Implement `src/lib/groups.ts`**

```ts
import type { KeywordGroup } from '../types'

/**
 * THE REGISTRY — the single source of truth for keyword grouping.
 *
 * HazReviews is one site, so the sibling dashboards' "brand → many domains"
 * model does not apply: the domain column would be constant. Keywords are
 * grouped instead, by the casino brand they target or the content category
 * they belong to.
 *
 * Group membership is DERIVED by groupForKeyword() and never stored on a
 * record. That is deliberate: improving this list re-groups the entire
 * history retroactively, where a stored column would freeze today's
 * classification mistakes and need a backfill migration to fix.
 *
 * Brands are seeded from the hazreviews.com toplist as of 2026-08-04.
 * Adding a group is one entry here and nothing else.
 *
 * `aliases` exist for names whose punctuation disappears under
 * normalisation ('BC.Game' → 'bc game'). NEVER add an alias that is a token
 * appearing inside an unrelated word — a bare 'jack' alias would classify
 * 'live blackjack' as Jack.com. groups.test.ts guards exactly that.
 */
export const GROUPS: KeywordGroup[] = [
  // ─── Brands ───────────────────────────────────────────────────────────
  { name: 'BetRepublic', abbr: 'BR',  color: '#2F6FED', kind: 'brand', aliases: ['bet republic'] },
  { name: 'Cleobetra',   abbr: 'CB',  color: '#D4A017', kind: 'brand', aliases: [] },
  { name: 'Jack.com',    abbr: 'JC',  color: '#E0342B', kind: 'brand', aliases: ['jack com', 'jackcom'] },
  { name: 'Rabona',      abbr: 'RB',  color: '#12A150', kind: 'brand', aliases: [] },
  { name: 'BetScore',    abbr: 'BS',  color: '#1F7AE0', kind: 'brand', aliases: ['bet score'] },
  { name: 'JawharaBet',  abbr: 'JW',  color: '#8E44AD', kind: 'brand', aliases: ['jawhara bet'] },
  { name: 'Kingmaker',   abbr: 'KM',  color: '#B8860B', kind: 'brand', aliases: ['king maker'] },
  { name: 'AlaWin',      abbr: 'AW',  color: '#00A3A3', kind: 'brand', aliases: ['ala win'] },
  { name: 'Sportuna',    abbr: 'SP',  color: '#E8590C', kind: 'brand', aliases: [] },
  { name: 'Spinational',  abbr: 'SN', color: '#5B4FE0', kind: 'brand', aliases: [] },
  { name: 'AmunRa',      abbr: 'AR',  color: '#C79A2E', kind: 'brand', aliases: ['amun ra'] },
  { name: 'Legiano',     abbr: 'LG',  color: '#2E7D32', kind: 'brand', aliases: [] },
  { name: 'Malina',      abbr: 'ML',  color: '#D6336C', kind: 'brand', aliases: [] },
  { name: 'Tikitaka',    abbr: 'TT',  color: '#F76707', kind: 'brand', aliases: ['tiki taka'] },
  { name: 'Rollero',     abbr: 'RL',  color: '#1C7ED6', kind: 'brand', aliases: [] },
  { name: 'Millioner',   abbr: 'MI',  color: '#7048E8', kind: 'brand', aliases: [] },
  { name: 'Realz',       abbr: 'RZ',  color: '#0CA678', kind: 'brand', aliases: [] },
  { name: 'FortunePlay', abbr: 'FP',  color: '#E03131', kind: 'brand', aliases: ['fortune play'] },
  { name: 'Lucky7Even',  abbr: 'L7',  color: '#F59F00', kind: 'brand', aliases: ['lucky 7even', 'lucky7 even', 'lucky seven'] },
  { name: 'Wyns',        abbr: 'WY',  color: '#3B5BDB', kind: 'brand', aliases: [] },
  { name: 'Royals',      abbr: 'RY',  color: '#9C36B5', kind: 'brand', aliases: [] },
  { name: '10Bet',       abbr: '10',  color: '#1971C2', kind: 'brand', aliases: ['10 bet'] },
  { name: 'Wild.io',     abbr: 'WI',  color: '#F03E3E', kind: 'brand', aliases: ['wild io', 'wildio'] },
  { name: 'Shuffle',     abbr: 'SH',  color: '#495057', kind: 'brand', aliases: [] },
  { name: 'JB',          abbr: 'JB',  color: '#0B7285', kind: 'brand', aliases: [] },
  { name: 'Casinia',     abbr: 'CA',  color: '#E8B84B', kind: 'brand', aliases: [] },
  { name: 'Thrill',      abbr: 'TH',  color: '#C2255C', kind: 'brand', aliases: [] },
  { name: 'YYY',         abbr: 'YY',  color: '#5C940D', kind: 'brand', aliases: ['yyy casino'] },
  { name: 'LuckyOnes',   abbr: 'LO',  color: '#F08C00', kind: 'brand', aliases: ['lucky ones'] },
  { name: 'JustCasino',  abbr: 'JU',  color: '#1098AD', kind: 'brand', aliases: ['just casino'] },
  { name: 'PlayMojo',    abbr: 'PM',  color: '#7950F2', kind: 'brand', aliases: ['play mojo'] },
  { name: 'BC.Game',     abbr: 'BC',  color: '#22B573', kind: 'brand', aliases: ['bc game', 'bcgame'] },
  { name: 'Stake',       abbr: 'ST',  color: '#1A6DD6', kind: 'brand', aliases: [] },
  { name: 'Spinsup',     abbr: 'SU',  color: '#E64980', kind: 'brand', aliases: ['spins up'] },
  { name: 'LuckyDreams', abbr: 'LD',  color: '#4C6EF5', kind: 'brand', aliases: ['lucky dreams'] },
  { name: 'NovaJackpot', abbr: 'NJ',  color: '#12B886', kind: 'brand', aliases: ['nova jackpot'] },
  { name: 'Spinight',    abbr: 'SG',  color: '#6741D9', kind: 'brand', aliases: [] },
  { name: 'Roosterbet',  abbr: 'RO',  color: '#D9480F', kind: 'brand', aliases: ['rooster bet'] },

  // ─── Categories ───────────────────────────────────────────────────────
  // Multi-word aliases win over single-word brand matches by length, which is
  // what makes 'best live casino' land here rather than on a brand.
  { name: 'Crypto Casinos', abbr: 'CR', color: '#F7931A', kind: 'category',
    aliases: ['crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'usdt', 'no kyc', 'nokyc', 'anonymous'] },
  { name: 'Bonuses', abbr: 'BN', color: '#FAB005', kind: 'category',
    aliases: ['bonus', 'bonuses', 'no deposit', 'free spins', 'cashback', 'vip', 'wagering', 'promo code', 'welcome offer'] },
  { name: 'Slots', abbr: 'SL', color: '#7048E8', kind: 'category',
    aliases: ['slot', 'slots', 'rtp', 'jackpot', 'jackpots', 'bonus buy', 'megaways', 'best payout'] },
  { name: 'Live Casino', abbr: 'LV', color: '#C2255C', kind: 'category',
    aliases: ['live casino', 'live dealer', 'blackjack', 'roulette', 'baccarat', 'poker'] },
  { name: 'Crash & Instant', abbr: 'CI', color: '#0CA678', kind: 'category',
    aliases: ['aviator', 'plinko', 'dice', 'crash game', 'mines'] },
  { name: 'Payments & Payouts', abbr: 'PY', color: '#1098AD', kind: 'category',
    aliases: ['fast withdrawal', 'fast payout', 'withdrawal', 'payout', 'low deposit', 'minimum deposit', 'payment methods'] },
  { name: 'New & Trending', abbr: 'NW', color: '#4C6EF5', kind: 'category',
    aliases: ['new casino', 'new casinos', 'newest', 'best casino', 'best casinos', 'top casinos'] },
  { name: 'Guides & Trust', abbr: 'GD', color: '#495057', kind: 'category',
    aliases: ['review', 'reviews', 'guide', 'how to', 'is legit', 'legit', 'safe', 'licence', 'license', 'rigged'] },
]

/** Fallback group. Kept OUT of GROUPS so it never appears as a real
 *  registry entry, but every keyword still resolves to something — an
 *  unmatched keyword must be visible, not dropped. */
export const OTHER_GROUP: KeywordGroup = {
  name: 'Other', abbr: 'OT', color: '#8EA1BA', kind: 'category', aliases: [],
}

/**
 * Matrix column order. Unlisted markets are appended, never dropped.
 *
 * ASSUMPTION: the real market list is unconfirmed. UAE-primary is inferred
 * from the site's en-AE tag and its link to hazemirates.com. Correcting this
 * is a one-line edit once a real export arrives.
 */
export const MARKET_ORDER: string[] = ['AE']

export function groupSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export const GROUP_BY_SLUG: Map<string, KeywordGroup> = new Map(
  GROUPS.map(g => [groupSlug(g.name), g]),
)

/** Lowercases, turns every non-alphanumeric run into a single space, and
 *  pads with spaces so ' token ' matching is a true word-boundary test. */
function normalizeForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

interface Candidate {
  group: KeywordGroup
  /** Token count of the matched phrase — the longest match wins. */
  length: number
}

/** Every phrase that means a given group: its name plus its aliases. */
function phrasesFor(group: KeywordGroup): string[] {
  return [group.name, ...group.aliases].map(p =>
    p.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  ).filter(p => p.length > 0)
}

/**
 * Resolves a keyword to exactly one group.
 *
 * Matching is word-boundary only. Substring matching is the obvious
 * implementation and it is wrong: the brand 'Jack.com' would claim the
 * keyword 'live blackjack', which is both incorrect and plausible-looking in
 * the UI. Padding the haystack and needle with spaces makes ' jack ' fail
 * against ' live blackjack ' while still matching ' jack com review '.
 *
 * Precedence: longest matched phrase wins; a brand beats a category at equal
 * length; ties beyond that fall to registry order, so the result is stable.
 */
export function groupForKeyword(keyword: string): KeywordGroup {
  const haystack = normalizeForMatch(keyword)
  if (haystack.trim().length === 0) return OTHER_GROUP

  let best: Candidate | null = null

  for (const group of GROUPS) {
    for (const phrase of phrasesFor(group)) {
      if (!haystack.includes(` ${phrase} `)) continue

      const length = phrase.split(' ').length
      if (best === null || length > best.length) {
        best = { group, length }
      } else if (length === best.length &&
                 best.group.kind === 'category' && group.kind === 'brand') {
        // Equal-length tie: a brand term is the more specific claim.
        best = { group, length }
      }
    }
  }

  return best?.group ?? OTHER_GROUP
}

/** Registry markets first in registry order, then anything unexpected
 *  appended alphabetically. Unknown markets are surfaced, never dropped —
 *  losing data silently is worse than an unplanned column. */
export function orderMarkets(markets: string[]): string[] {
  const unique = Array.from(new Set(markets))
  const known = MARKET_ORDER.filter(m => unique.includes(m))
  const unknown = unique.filter(m => !MARKET_ORDER.includes(m)).sort()
  return [...known, ...unknown]
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/groups.test.ts`
Expected: PASS, all tests. If `best live casino uae` resolves to `New & Trending` instead of `Live Casino`, both matched at length 2 and registry order decided it — move `Live Casino` above `New & Trending` in `GROUPS`, or lengthen the winning phrase. Fix the registry, not the test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(groups): add keyword group registry with word-boundary matching"
```

---

## Task 5: Position and change normalisation

**Files:**
- Create: `src/lib/normalize.ts`, `src/lib/normalize.test.ts`

**Interfaces:**
- Consumes: `RankingRecord`, `ParsedPosition`, `StatsCounts`, `TierCounts` from `src/types`
- Produces:
  - `parsePosition(pos: string): ParsedPosition`
  - `parseChange(chg: string): number | null`
  - `effectiveDelta(change: string, currentPos: ParsedPosition): number`
  - `computeStats(records: RankingRecord[]): StatsCounts`
  - `computeTiers(records: RankingRecord[]): TierCounts`
  - `avgPosition(records: RankingRecord[]): number | null`

- [ ] **Step 1: Write the failing tests**

`src/lib/normalize.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { RankingRecord } from '../types'
import {
  avgPosition, computeStats, computeTiers, effectiveDelta,
  parseChange, parsePosition,
} from './normalize'

function rec(partial: Partial<RankingRecord>): RankingRecord {
  return {
    keyword: 'k', market: 'AE', position: '', previous: '', change: '',
    urlFound: '', searchVolume: '', date: '2026-08-04', ...partial,
  }
}

describe('parsePosition', () => {
  it('returns null for an empty value', () => {
    expect(parsePosition('')).toBeNull()
    expect(parsePosition('   ')).toBeNull()
  })

  it('parses a numeric position', () => {
    expect(parsePosition('4')).toBe(4)
    expect(parsePosition(' 12 ')).toBe(12)
  })

  it('maps the not-ranking vocabulary to NR', () => {
    for (const v of ['NR', 'nr', 'not ranking', 'Not in top 100', '-', '—']) {
      expect(parsePosition(v)).toBe('NR')
    }
  })

  it('treats an unparseable non-empty value as NR rather than guessing', () => {
    expect(parsePosition('banana')).toBe('NR')
  })
})

describe('parseChange', () => {
  it('returns null when there is no signal', () => {
    expect(parseChange('')).toBeNull()
    expect(parseChange('  ')).toBeNull()
  })

  it('parses signed numbers', () => {
    expect(parseChange('+2')).toBe(2)
    expect(parseChange('-3')).toBe(-3)
    expect(parseChange('0')).toBe(0)
  })

  it('parses arrow-and-magnitude tokens', () => {
    expect(parseChange('▲ 10')).toBe(10)
    expect(parseChange('▼ 10')).toBe(-10)
  })

  it('parses a bare arrow as a magnitude-unknown sentinel', () => {
    expect(parseChange('▲')).toBe(1)
    expect(parseChange('▼')).toBe(-1)
  })

  it('parses the parenthesised previous-position form', () => {
    expect(parseChange('▲ (6)')).toBe(6)
    expect(parseChange('▼ (3)')).toBe(-3)
  })
})

describe('effectiveDelta', () => {
  it('passes a normal delta through', () => {
    expect(effectiveDelta('+2', 5)).toBe(2)
  })

  it('reports no movement when the parenthesised previous equals current', () => {
    // In this cell grammar the number in parens is the PREVIOUS position, not
    // a delta. If it equals the current position, nothing actually moved.
    expect(effectiveDelta('▲ (4)', 4)).toBe(0)
  })

  it('keeps the delta when the parenthesised previous differs', () => {
    expect(effectiveDelta('▲ (6)', 4)).toBe(6)
  })

  it('returns 0 when there is no change token', () => {
    expect(effectiveDelta('', 4)).toBe(0)
  })
})

describe('computeStats', () => {
  const records = [
    rec({ position: '1', change: '+2' }),   // top3 + improved
    rec({ position: '2', change: '-1' }),    // top3 + dropped
    rec({ position: '3', change: '0' }),     // top3 + unchanged
    rec({ position: '15', change: '+5' }),   // improved
    rec({ position: 'NR', change: '' }),     // notRanking
    rec({ position: '', change: '' }),       // no position at all
  ]

  it('makes the movement buckets mutually exclusive and total-summing', () => {
    const s = computeStats(records)
    expect(s.improved + s.dropped + s.unchanged + s.notRanking).toBe(s.total)
  })

  it('counts top3 as an overlapping bucket, not part of the sum', () => {
    const s = computeStats(records)
    expect(s.top3).toBe(3)
    // Deliberately does not equal total; Top 3 overlaps the movement buckets.
    expect(s.top3 + s.improved + s.dropped + s.unchanged + s.notRanking)
      .not.toBe(s.total)
  })

  it('classifies by the change sign so counters match the badges', () => {
    const s = computeStats(records)
    expect(s.improved).toBe(2)
    expect(s.dropped).toBe(1)
    expect(s.notRanking).toBe(1)
  })

  it('returns all zeros for no records', () => {
    expect(computeStats([])).toEqual({
      total: 0, top3: 0, improved: 0, dropped: 0, notRanking: 0, unchanged: 0,
    })
  })
})

describe('computeTiers', () => {
  it('buckets by position band', () => {
    const t = computeTiers([
      rec({ position: '1' }), rec({ position: '2' }), rec({ position: '9' }),
      rec({ position: '14' }), rec({ position: 'NR' }),
    ])
    expect(t).toEqual({ p1: 1, top3: 2, top10: 3, page2: 1, nr: 1 })
  })
})

describe('avgPosition', () => {
  it('averages only ranking positions', () => {
    expect(avgPosition([
      rec({ position: '2' }), rec({ position: '4' }),
      rec({ position: 'NR' }), rec({ position: '' }),
    ])).toBe(3)
  })

  it('returns null when nothing ranks', () => {
    expect(avgPosition([rec({ position: 'NR' })])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/normalize.test.ts`
Expected: FAIL — cannot resolve `./normalize`.

- [ ] **Step 3: Implement `src/lib/normalize.ts`**

```ts
import type { ParsedPosition, RankingRecord, StatsCounts, TierCounts } from '../types'

const NOT_RANKING = new Set(['nr', 'not ranking', 'not in top 100', '-', '—', '--'])

/** Normalises a raw position cell. Downstream code must compare against 'NR',
 *  never against the original source strings — the vocabulary varies by
 *  export and new spellings appear without warning. */
export function parsePosition(pos: string): ParsedPosition {
  const raw = (pos ?? '').trim()
  if (raw === '') return null
  if (NOT_RANKING.has(raw.toLowerCase())) return 'NR'
  const n = parseInt(raw, 10)
  // An unparseable but non-empty value means "we looked and it wasn't there",
  // which is NR — not null, which means "we never looked".
  return Number.isFinite(n) ? n : 'NR'
}

/** Parses a movement token. Handles signed numbers, arrow+magnitude, bare
 *  arrows (magnitude unknown → ±1 sentinel), and the parenthesised
 *  previous-position form. */
export function parseChange(chg: string): number | null {
  const raw = (chg ?? '').trim()
  if (raw === '') return null

  const parens = /^([▲▼↑↓])\s*\(\s*(\d+)\s*\)$/.exec(raw)
  if (parens) {
    const n = parseInt(parens[2], 10)
    return parens[1] === '▲' || parens[1] === '↑' ? n : -n
  }

  const arrowNum = /^([▲▼↑↓])\s*(\d+)$/.exec(raw)
  if (arrowNum) {
    const n = parseInt(arrowNum[2], 10)
    return arrowNum[1] === '▲' || arrowNum[1] === '↑' ? n : -n
  }

  if (/^[▲↑]$/.test(raw)) return 1
  if (/^[▼↓]$/.test(raw)) return -1

  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * The delta that actually happened.
 *
 * In the parenthesised grammar the number is the PREVIOUS position, not a
 * delta. If it equals the current position nothing moved, and reporting a
 * jump there would paint a green arrow on a static ranking.
 */
export function effectiveDelta(change: string, currentPos: ParsedPosition): number {
  const d = parseChange(change) ?? 0
  if (d !== 0 && typeof currentPos === 'number') {
    const m = /^[▲▼↑↓]\s*\(\s*(\d+)\s*\)$/.exec((change ?? '').trim())
    if (m && parseInt(m[1], 10) === currentPos) return 0
  }
  return d
}

/**
 * Two layers of counting.
 *
 * Movement buckets are mutually exclusive and sum to `total`. `top3`
 * OVERLAPS them on purpose: a top-3 keyword that moved up should read green
 * AND count in Top 3. The five stat cards therefore do not sum to total, and
 * /how-it-works explains that to users.
 *
 * Movement is driven by the change sign so the counters track precisely what
 * PosBadge paints.
 */
export function computeStats(records: RankingRecord[]): StatsCounts {
  const s: StatsCounts = {
    total: 0, top3: 0, improved: 0, dropped: 0, notRanking: 0, unchanged: 0,
  }

  for (const r of records) {
    s.total += 1
    const pos = parsePosition(r.position)

    if (pos === 'NR' || pos === null) {
      s.notRanking += 1
    } else {
      const d = effectiveDelta(r.change, pos)
      if (d > 0) s.improved += 1
      else if (d < 0) s.dropped += 1
      else s.unchanged += 1

      if (pos >= 1 && pos <= 3) s.top3 += 1
    }
  }

  return s
}

export function computeTiers(records: RankingRecord[]): TierCounts {
  const t: TierCounts = { p1: 0, top3: 0, top10: 0, page2: 0, nr: 0 }
  for (const r of records) {
    const pos = parsePosition(r.position)
    if (typeof pos !== 'number') { t.nr += 1; continue }
    if (pos === 1) t.p1 += 1
    if (pos <= 3) t.top3 += 1
    if (pos <= 10) t.top10 += 1
    else if (pos <= 20) t.page2 += 1
  }
  return t
}

export function avgPosition(records: RankingRecord[]): number | null {
  const ranking = records
    .map(r => parsePosition(r.position))
    .filter((p): p is number => typeof p === 'number')
  if (ranking.length === 0) return null
  return ranking.reduce((a, b) => a + b, 0) / ranking.length
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(normalize): add position/change parsing and stat counting"
```

---

## Task 6: Date handling

**Files:**
- Create: `src/lib/dates.ts`, `src/lib/dates.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `toIsoLocal(d: Date): string`
  - `formatDisplayDate(raw: string): string`
  - `normalizeDateValue(value: unknown): string`

- [ ] **Step 1: Write the failing tests**

`src/lib/dates.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { formatDisplayDate, normalizeDateValue, toIsoLocal } from './dates'

describe('toIsoLocal', () => {
  it('uses local calendar fields, not UTC', () => {
    // Local midnight. toISOString() would report the PREVIOUS day in any
    // positive-UTC zone, silently shifting every snapshot by one.
    const d = new Date(2026, 7, 4, 0, 0, 0)
    expect(toIsoLocal(d)).toBe('2026-08-04')
  })

  it('zero-pads month and day', () => {
    expect(toIsoLocal(new Date(2026, 0, 9))).toBe('2026-01-09')
  })
})

describe('formatDisplayDate', () => {
  it('formats a YYYY-MM-DD literal without a timezone shift', () => {
    // new Date('2026-08-04') is parsed as UTC and renders as 3 Aug in any
    // negative-UTC zone. Constructing from parts keeps it local.
    expect(formatDisplayDate('2026-08-04')).toBe('4 Aug 26')
  })

  it('returns the input unchanged when it is not a date literal', () => {
    expect(formatDisplayDate('whenever')).toBe('whenever')
  })
})

describe('normalizeDateValue', () => {
  it('trusts a YYYY-MM-DD literal as-is', () => {
    expect(normalizeDateValue('2026-08-04')).toBe('2026-08-04')
  })

  it('converts an Excel serial number', () => {
    // 46238 = 2026-08-04 in the 1900 date system.
    expect(normalizeDateValue(46238)).toBe('2026-08-04')
  })

  it('parses a slash-formatted date', () => {
    expect(normalizeDateValue('08/04/2026')).toBe('2026-08-04')
  })

  it('accepts a Date instance', () => {
    expect(normalizeDateValue(new Date(2026, 7, 4))).toBe('2026-08-04')
  })

  it('returns empty string for junk rather than a wrong date', () => {
    expect(normalizeDateValue('n/a')).toBe('')
    expect(normalizeDateValue(null)).toBe('')
    expect(normalizeDateValue(undefined)).toBe('')
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL — cannot resolve `./dates`.

- [ ] **Step 3: Implement `src/lib/dates.ts`**

```ts
const ISO_LITERAL = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** Local calendar date as 'YYYY-MM-DD'.
 *
 *  NOT toISOString().slice(0,10): that converts to UTC first, so local
 *  midnight becomes the previous day in every positive-UTC zone and every
 *  snapshot silently lands on the wrong date. */
export function toIsoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Renders 'YYYY-MM-DD' as e.g. '4 Aug 26'.
 *
 *  Builds the Date from parts rather than letting new Date(str) treat the
 *  literal as UTC — that renders the previous day in negative-UTC zones. */
export function formatDisplayDate(raw: string): string {
  const m = ISO_LITERAL.exec((raw ?? '').trim())
  if (!m) return raw
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const local = new Date(y, mo - 1, d)
  return `${local.getDate()} ${MONTHS[local.getMonth()]} ${String(y).slice(2)}`
}

/** Coerces whatever a spreadsheet cell holds into 'YYYY-MM-DD', or '' when
 *  it cannot be trusted. Returning '' is deliberate: a wrong date corrupts
 *  every movement calculation downstream, so no-answer beats a guess. */
export function normalizeDateValue(value: unknown): string {
  if (value === null || value === undefined) return ''

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : toIsoLocal(value)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return ''
    // Excel serial → ms. 25569 is the offset between the 1900 date system
    // epoch and the Unix epoch.
    const ms = (value - 25569) * 86400 * 1000
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return ''
    // Read back in UTC: the serial encodes a calendar date with no timezone,
    // so local getters would shift it.
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }

  const raw = String(value).trim()
  if (raw === '') return ''

  // A literal is trusted as-is and never round-tripped through Date.
  if (ISO_LITERAL.test(raw)) return raw

  const slash = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/.exec(raw)
  if (slash) {
    const a = Number(slash[1]), b = Number(slash[2])
    let y = Number(slash[3])
    if (y < 100) y += 2000
    // US-style month-first, matching the exports this app receives.
    const d = new Date(y, a - 1, b)
    return Number.isNaN(d.getTime()) ? '' : toIsoLocal(d)
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : toIsoLocal(parsed)
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: PASS. If the Excel serial assertion fails, print the produced value and correct the expected serial in the test to match a verified 2026-08-04 — but only after confirming by hand that the conversion arithmetic is right.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(dates): add timezone-safe date helpers"
```

---

## Task 7: Carry-forward

**Files:**
- Create: `src/lib/carryForward.ts`, `src/lib/carryForward.test.ts`

**Interfaces:**
- Consumes: `RankingRecord` from `src/types`
- Produces: `applyCarryForward<T extends { rawDate: string; records: RankingRecord[] }>(snapshots: T[]): T[]`

- [ ] **Step 1: Write the failing tests**

`src/lib/carryForward.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { RankingRecord } from '../types'
import { applyCarryForward } from './carryForward'

function rec(keyword: string, market: string, searchVolume = ''): RankingRecord {
  return {
    keyword, market, position: '1', previous: '', change: '',
    urlFound: '', searchVolume, date: '',
  }
}

function snap(rawDate: string, records: RankingRecord[]) {
  return { id: `snap-${rawDate}`, rawDate, displayDate: rawDate, records }
}

describe('applyCarryForward', () => {
  it('fills an empty searchVolume from an older snapshot', () => {
    const out = applyCarryForward([
      snap('2026-08-04', [rec('crypto casino', 'AE', '')]),
      snap('2026-07-28', [rec('crypto casino', 'AE', '2.4K')]),
    ])
    const newest = out.find(s => s.rawDate === '2026-08-04')!
    expect(newest.records[0].searchVolume).toBe('2.4K')
  })

  it('never overwrites a value the record already has', () => {
    const out = applyCarryForward([
      snap('2026-07-28', [rec('k', 'AE', '1K')]),
      snap('2026-08-04', [rec('k', 'AE', '9K')]),
    ])
    expect(out.find(s => s.rawDate === '2026-08-04')!.records[0].searchVolume).toBe('9K')
  })

  it('keys on keyword AND market, so markets do not bleed into each other', () => {
    const out = applyCarryForward([
      snap('2026-07-28', [rec('k', 'AE', '1K')]),
      snap('2026-08-04', [rec('k', 'US', '')]),
    ])
    expect(out.find(s => s.rawDate === '2026-08-04')!.records[0].searchVolume).toBe('')
  })

  it('does not let a cleared upstream value keep flowing forward', () => {
    // Seeding from DERIVED values would make '1K' immortal: it would fill
    // 08-04 from the already-filled 07-28 even though 07-28's raw value is
    // now empty. Seeding from RAW values is what makes a deletion stick.
    const out = applyCarryForward([
      snap('2026-07-21', [rec('k', 'AE', '1K')]),
      snap('2026-07-28', [rec('k', 'AE', '')]),
      snap('2026-08-04', [rec('k', 'AE', '')]),
    ])
    const byDate = (d: string) => out.find(s => s.rawDate === d)!.records[0].searchVolume
    expect(byDate('2026-07-28')).toBe('1K')
    expect(byDate('2026-08-04')).toBe('1K')
  })

  it('preserves the caller-controlled snapshot order', () => {
    const out = applyCarryForward([
      snap('2026-08-04', [rec('k', 'AE')]),
      snap('2026-07-28', [rec('k', 'AE')]),
    ])
    expect(out.map(s => s.rawDate)).toEqual(['2026-08-04', '2026-07-28'])
  })

  it('does not mutate the input', () => {
    const input = [
      snap('2026-07-28', [rec('k', 'AE', '1K')]),
      snap('2026-08-04', [rec('k', 'AE', '')]),
    ]
    applyCarryForward(input)
    expect(input[1].records[0].searchVolume).toBe('')
  })

  it('handles an empty list', () => {
    expect(applyCarryForward([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/carryForward.test.ts`
Expected: FAIL — cannot resolve `./carryForward`.

- [ ] **Step 3: Implement `src/lib/carryForward.ts`**

```ts
import type { RankingRecord } from '../types'

function key(r: RankingRecord): string {
  return `${r.keyword.toLowerCase()}|${r.market.toLowerCase()}`
}

/**
 * Fills empty `searchVolume` values forward from older snapshots.
 *
 * Two rules make this correct, and both are easy to break:
 *
 * 1. The maps are seeded from RAW values, never from values this function
 *    just filled in. Otherwise clearing a volume upstream would keep the old
 *    number flowing forward forever, with no way to delete it.
 * 2. The result is derived, never persisted. Applying this to stored state
 *    would freeze inheritance: downstream records would hold inherited
 *    (non-empty) values, so the fill-only-if-empty rule would skip them and
 *    later edits would stop propagating.
 */
export function applyCarryForward<
  T extends { rawDate: string; records: RankingRecord[] }
>(snapshots: T[]): T[] {
  if (snapshots.length === 0) return []

  // Oldest → newest for the walk, without disturbing the caller's order.
  const ascending = [...snapshots].sort((a, b) => a.rawDate.localeCompare(b.rawDate))

  const volumes = new Map<string, string>()
  const filled = new Map<string, RankingRecord[]>()

  for (const snapshot of ascending) {
    const records = snapshot.records.map(r => {
      const k = key(r)
      const raw = r.searchVolume.trim()

      // Seed from the raw value first, so a cleared value stops propagating.
      if (raw !== '') {
        volumes.set(k, r.searchVolume)
        return r
      }

      const inherited = volumes.get(k)
      return inherited ? { ...r, searchVolume: inherited } : r
    })

    filled.set(snapshot.id ?? snapshot.rawDate, records)
  }

  return snapshots.map(s => ({
    ...s,
    records: filled.get((s as { id?: string }).id ?? s.rawDate) ?? s.records,
  }))
}
```

**Note on the id lookup:** `T` is only constrained to `{ rawDate, records }`, so the implementation falls back to `rawDate` as the map key. Every real caller passes `Snapshot`, which has an `id`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/carryForward.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(carry-forward): inherit search volume forward from raw values"
```

---

## Task 8: Spreadsheet parsing

**Files:**
- Create: `src/lib/parser.ts`, `src/lib/parser.test.ts`

**Interfaces:**
- Consumes: `dates.ts` (`normalizeDateValue`, `toIsoLocal`, `formatDisplayDate`), `groups.ts` (`groupForKeyword`, `MARKET_ORDER`, `OTHER_GROUP`), types `ParseResult`, `RankingRecord`, `Snapshot`
- Produces:
  - `parseRows(rows: unknown[][]): ParseResult` — the pure core, tested directly
  - `parseSheet(buffer: ArrayBuffer): ParseResult` — reads the workbook with `xlsx` and delegates
  - `snapshotIdFor(rawDate: string): string`

- [ ] **Step 1: Write the failing tests**

`src/lib/parser.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseRows, snapshotIdFor } from './parser'

const HEADER = ['Keyword', 'Country', 'Position', 'Previous', 'Change', 'URL', 'Search Volume', 'Date']

describe('snapshotIdFor', () => {
  it('is deterministic so re-upload replaces rather than duplicates', () => {
    expect(snapshotIdFor('2026-08-04')).toBe('snap-2026-08-04')
  })
})

describe('parseRows', () => {
  it('parses a simple sheet', () => {
    const r = parseRows([
      HEADER,
      ['crypto casino uae', 'AE', '4', '6', '+2', 'https://hazreviews.com/crypto', '2.4K', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.snapshot.records[0]).toMatchObject({
      keyword: 'crypto casino uae', market: 'AE', position: '4',
      previous: '6', change: '+2', searchVolume: '2.4K',
      urlFound: 'https://hazreviews.com/crypto',
    })
    expect(r.snapshot.rawDate).toBe('2026-08-04')
    expect(r.snapshot.id).toBe('snap-2026-08-04')
  })

  it('finds the header row when it is not the first row', () => {
    const r = parseRows([
      ['Export generated 4 Aug'], [], HEADER,
      ['stake casino', 'AE', '2', '', '', '', '', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(1)
  })

  it('resolves columns by prefix as well as exact match', () => {
    const r = parseRows([
      ['keyword', 'market', 'rank', 'last check'],
      ['plinko casino', 'AE', '7', '2026-08-04'],
    ])
    expect(r.snapshot.records[0].position).toBe('7')
    expect(r.snapshot.records[0].market).toBe('AE')
  })

  it('skips and counts rows with no keyword', () => {
    const r = parseRows([
      HEADER,
      ['', 'AE', '4', '', '', '', '', '2026-08-04'],
      ['real keyword', 'AE', '5', '', '', '', '', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.skippedRows).toBe(1)
  })

  it('dedupes on keyword+market with last occurrence winning', () => {
    const r = parseRows([
      HEADER,
      ['dup', 'AE', '9', '', '', '', '', '2026-08-04'],
      ['dup', 'AE', '3', '', '', '', '', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.snapshot.records[0].position).toBe('3')
  })

  it('keeps the same keyword in different markets', () => {
    const r = parseRows([
      HEADER,
      ['k', 'AE', '9', '', '', '', '', '2026-08-04'],
      ['k', 'US', '3', '', '', '', '', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(2)
  })

  it('uses the modal date when the column disagrees with itself', () => {
    const r = parseRows([
      HEADER,
      ['a', 'AE', '1', '', '', '', '', '2026-08-04'],
      ['b', 'AE', '1', '', '', '', '', '2026-08-04'],
      ['c', 'AE', '1', '', '', '', '', '2026-07-28'],
    ])
    expect(r.snapshot.rawDate).toBe('2026-08-04')
  })

  it('reports unmatched keywords instead of dropping them', () => {
    const r = parseRows([
      HEADER,
      ['zzz nothing matches this', 'AE', '4', '', '', '', '', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.unmatchedKeywords).toContain('zzz nothing matches this')
  })

  it('reports markets outside MARKET_ORDER instead of dropping them', () => {
    const r = parseRows([
      HEADER,
      ['stake casino', 'ZA', '4', '', '', '', '', '2026-08-04'],
    ])
    expect(r.snapshot.records).toHaveLength(1)
    expect(r.unknownMarkets).toContain('ZA')
  })

  it('defaults the market when the sheet has no country column', () => {
    const r = parseRows([
      ['keyword', 'position'],
      ['stake casino', '4'],
    ])
    expect(r.snapshot.records[0].market).toBe('AE')
  })

  it('throws a readable error when there is no keyword column', () => {
    expect(() => parseRows([['foo', 'bar'], ['1', '2']]))
      .toThrow(/keyword column/i)
  })

  it('throws a readable error when the sheet has no data rows', () => {
    expect(() => parseRows([HEADER])).toThrow(/no data rows/i)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/parser.test.ts`
Expected: FAIL — cannot resolve `./parser`.

- [ ] **Step 3: Implement `src/lib/parser.ts`**

```ts
import * as XLSX from 'xlsx'
import type { ParseResult, RankingRecord } from '../types'
import { formatDisplayDate, normalizeDateValue, toIsoLocal } from './dates'
import { MARKET_ORDER, OTHER_GROUP, groupForKeyword } from './groups'

const HEADER_SCAN_ROWS = 5

/** Column aliases, most specific first. Resolution is exact-then-prefix, so
 *  'position' matches a header of 'Position (Google)'. */
const COLUMNS = {
  keyword:  ['keyword', 'query', 'search term'],
  market:   ['country', 'market', 'location', 'region'],
  position: ['position', 'rank', 'current position'],
  previous: ['previous', 'prev', 'previous position'],
  change:   ['change', 'delta', 'movement'],
  url:      ['url', 'url found', 'landing page', 'page'],
  volume:   ['search volume', 'volume', 'sv'],
  date:     ['last check', 'date', 'checked at', 'checked'],
} as const

type ColumnKey = keyof typeof COLUMNS

export function snapshotIdFor(rawDate: string): string {
  return `snap-${rawDate}`
}

function cell(row: unknown[], index: number): string {
  if (index < 0) return ''
  const v = row[index]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function normalizeHeader(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

/** Finds the header row by looking for a keyword column in the first few
 *  rows — exports routinely prepend a title or a blank line. */
function findHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length)
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] ?? []).map(normalizeHeader)
    if (cells.some(c => COLUMNS.keyword.some(a => c === a || c.startsWith(a)))) {
      return i
    }
  }
  return -1
}

function resolveColumns(header: unknown[]): Record<ColumnKey, number> {
  const cells = header.map(normalizeHeader)
  const out = {} as Record<ColumnKey, number>

  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    let found = -1
    for (const alias of COLUMNS[key]) {
      found = cells.findIndex(c => c === alias)
      if (found >= 0) break
    }
    if (found < 0) {
      for (const alias of COLUMNS[key]) {
        found = cells.findIndex(c => c.startsWith(alias))
        if (found >= 0) break
      }
    }
    out[key] = found
  }

  return out
}

/** The most frequent non-empty value. Used for the snapshot date: a stray
 *  row with a bad date must not rename the whole snapshot. */
function modal(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) {
    if (v === '') continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c }
  }
  return best
}

/**
 * The pure core of the importer: rows in, ParseResult out.
 *
 * Split from parseSheet so it is testable without building a workbook, which
 * is where every interesting edge case lives.
 */
export function parseRows(rows: unknown[][]): ParseResult {
  const headerIndex = findHeaderRow(rows)
  if (headerIndex < 0) {
    throw new Error(
      'Could not find a keyword column. Expected a header row containing "Keyword" within the first 5 rows.',
    )
  }

  const cols = resolveColumns(rows[headerIndex] ?? [])
  const dataRows = rows.slice(headerIndex + 1).filter(r => (r ?? []).length > 0)
  if (dataRows.length === 0) {
    throw new Error('The sheet has no data rows below the header.')
  }

  // Keyed dedupe: last occurrence wins, matching how exports append
  // corrections below the original row.
  const byKey = new Map<string, RankingRecord>()
  const dateValues: string[] = []
  let skippedRows = 0

  for (const row of dataRows) {
    const keyword = cell(row, cols.keyword)
    if (keyword === '') { skippedRows += 1; continue }

    const market = cell(row, cols.market) || MARKET_ORDER[0]
    const date = normalizeDateValue(cols.date >= 0 ? row[cols.date] : '')
    if (date !== '') dateValues.push(date)

    byKey.set(`${keyword.toLowerCase()}|${market.toLowerCase()}`, {
      keyword,
      market,
      position: cell(row, cols.position),
      previous: cell(row, cols.previous),
      change: cell(row, cols.change),
      urlFound: cell(row, cols.url),
      searchVolume: cell(row, cols.volume),
      date,
    })
  }

  const records = Array.from(byKey.values())

  // Fall back to today only when the export carried no usable date at all.
  // The upload modal lets the user override this before committing.
  const detectedDate = modal(dateValues) || toIsoLocal(new Date())

  const markets = Array.from(new Set(records.map(r => r.market)))

  // Unmatched keywords and unlisted markets are REPORTED, never dropped.
  // Silently discarding a row is the failure mode that makes every counter
  // read low with no error anywhere.
  const unmatchedKeywords = records
    .filter(r => groupForKeyword(r.keyword).name === OTHER_GROUP.name)
    .map(r => r.keyword)
  const unknownMarkets = markets.filter(m => !MARKET_ORDER.includes(m))

  return {
    snapshot: {
      id: snapshotIdFor(detectedDate),
      rawDate: detectedDate,
      displayDate: formatDisplayDate(detectedDate),
      records,
    },
    skippedRows,
    unmatchedKeywords,
    markets,
    unknownMarkets,
    detectedDate,
  }
}

/** Reads the first sheet of a workbook (or CSV) and delegates to parseRows. */
export function parseSheet(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('The file contains no sheets.')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1, raw: true, defval: '',
  })
  return parseRows(rows)
}

/** Re-stamps a parsed snapshot with a user-chosen date. Called when the
 *  upload modal's date override is used — the id must change with the date or
 *  the snapshot would overwrite a different day's data. */
export function withSnapshotDate(result: ParseResult, rawDate: string): ParseResult {
  return {
    ...result,
    detectedDate: rawDate,
    snapshot: {
      ...result.snapshot,
      id: snapshotIdFor(rawDate),
      rawDate,
      displayDate: formatDisplayDate(rawDate),
    },
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/parser.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm test && npm run build`
Expected: all tests pass, build clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(parser): add flat-sheet importer with dedupe and date detection"
```

---

## Task 9: Database schema and storage layer

**Files:**
- Create: `supabase/setup.sql`, `supabase/auth-lockdown.sql`, `src/lib/supabase.ts`, `src/lib/storage.ts`, `src/lib/storage.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `SnapshotMeta`, `RankingRecord`, `RecordMatcher`, `RecordPatch`; `formatDisplayDate` from `dates.ts`
- Produces:
  - `DEFAULT_RECENT = 8`
  - `loadSnapshotMeta(): Promise<SnapshotMeta[]>`
  - `loadSnapshotRecords(ids: string[]): Promise<Map<string, RankingRecord[]>>`
  - `loadRecentSnapshots(recentCount?: number): Promise<{ meta: SnapshotMeta[]; snapshots: Snapshot[] }>`
  - `loadOlderSnapshots(metaEntries: SnapshotMeta[]): Promise<Snapshot[]>`
  - `upsertSnapshot(snapshot: Snapshot): Promise<void>`
  - `deleteSnapshot(id: string): Promise<void>`
  - `updateRecordFields(snapshotId: string, matcher: RecordMatcher, patch: RecordPatch): Promise<void>`
  - `toSnapshotMeta(row: { id: string; raw_date: string }): SnapshotMeta`
  - `pageRanges(count: number): Array<[number, number]>`

- [ ] **Step 1: Write `supabase/setup.sql`**

Every statement is idempotent so the file can be re-run safely.

```sql
-- Haz Reviews Dashboard — base schema.
-- Run this first on a fresh project, then auth-lockdown.sql.

create table if not exists public.snapshots (
  id            text primary key,   -- 'snap-<raw_date>', client-generated
  raw_date      text not null,      -- 'YYYY-MM-DD'
  display_date  text not null,      -- re-derived on read; never trusted
  created_at    timestamptz not null default now()
);

-- Ordering is by the snapshot's own date, not insert order: a backfill writes
-- newest-first, so created_at desc alone would surface the OLDEST snapshot as
-- "latest".
create index if not exists snapshots_raw_date_idx
  on public.snapshots (raw_date desc);

create table if not exists public.ranking_records (
  id            bigserial primary key,
  snapshot_id   text not null references public.snapshots(id) on delete cascade,
  keyword       text not null,
  market        text not null,
  -- TEXT, not int: the source vocabulary includes 'NR' and 'Not in top 100'.
  -- Normalisation happens at the view layer so nothing is destroyed here.
  position      text not null,
  previous      text not null default '',
  -- Verbatim source token. Deltas are computed separately.
  change        text not null default '',
  url_found     text not null default '',
  search_volume text not null default '',
  date          text not null default ''
);

create index if not exists ranking_records_snapshot_idx
  on public.ranking_records (snapshot_id);
-- Matches the updateRecordFields predicate exactly.
create index if not exists ranking_records_lookup_idx
  on public.ranking_records (snapshot_id, keyword, market);

create table if not exists public.user_access (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  -- 'revoked' is a distinct third state, not a return to 'pending', so an
  -- admin who cut someone off never sees them again as a new signup.
  status     text not null default 'pending'
             check (status in ('pending', 'approved', 'revoked')),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.activity_log (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  user_id    uuid references auth.users(id) on delete set null,
  email      text not null,
  action     text not null,   -- 'upload' | 'edit' | 'delete'
  section    text not null,
  summary    text not null
);
create index if not exists activity_log_created_at_idx
  on public.activity_log (created_at desc);

-- Auto-provision an access row for every new auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_access (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row
  execute function public.handle_new_user();

-- A policy ON user_access containing a bare
-- `exists (select ... from user_access ...)` re-triggers itself for every
-- scanned row and Postgres raises 42P17 infinite recursion. SECURITY DEFINER
-- bypasses RLS internally, which is the only clean way out.
create or replace function public.user_is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce(is_admin, false) from public.user_access where user_id = auth.uid();
$$;

alter table public.snapshots       enable row level security;
alter table public.ranking_records enable row level security;
alter table public.user_access     enable row level security;
alter table public.activity_log    enable row level security;

-- Permissive to start: get data flowing, then run auth-lockdown.sql.
drop policy if exists "open snapshots" on public.snapshots;
create policy "open snapshots" on public.snapshots for all using (true) with check (true);
drop policy if exists "open ranking_records" on public.ranking_records;
create policy "open ranking_records" on public.ranking_records for all using (true) with check (true);

drop policy if exists "self or admin read user_access" on public.user_access;
create policy "self or admin read user_access" on public.user_access
  for select using (user_id = auth.uid() or public.user_is_admin());
drop policy if exists "admin update user_access" on public.user_access;
create policy "admin update user_access" on public.user_access
  for update using (public.user_is_admin()) with check (public.user_is_admin());
```

- [ ] **Step 2: Write `supabase/auth-lockdown.sql`**

```sql
-- Haz Reviews Dashboard — lockdown migration.
-- Departure from the sibling dashboards: reads require auth too. Nothing here
-- is public, and one rule is easier to keep correct than two.

drop policy if exists "open snapshots" on public.snapshots;
drop policy if exists "open ranking_records" on public.ranking_records;

create or replace function public.user_is_approved()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.user_access
    where user_id = auth.uid() and status = 'approved'
  );
$$;

-- snapshots
drop policy if exists "approved read snapshots" on public.snapshots;
create policy "approved read snapshots" on public.snapshots
  for select to authenticated using (public.user_is_approved());
drop policy if exists "approved write snapshots" on public.snapshots;
create policy "approved write snapshots" on public.snapshots
  for insert to authenticated with check (public.user_is_approved());
drop policy if exists "approved update snapshots" on public.snapshots;
create policy "approved update snapshots" on public.snapshots
  for update to authenticated using (public.user_is_approved()) with check (public.user_is_approved());
drop policy if exists "approved delete snapshots" on public.snapshots;
create policy "approved delete snapshots" on public.snapshots
  for delete to authenticated using (public.user_is_approved());

-- ranking_records (same four policies)
drop policy if exists "approved read ranking_records" on public.ranking_records;
create policy "approved read ranking_records" on public.ranking_records
  for select to authenticated using (public.user_is_approved());
drop policy if exists "approved write ranking_records" on public.ranking_records;
create policy "approved write ranking_records" on public.ranking_records
  for insert to authenticated with check (public.user_is_approved());
drop policy if exists "approved update ranking_records" on public.ranking_records;
create policy "approved update ranking_records" on public.ranking_records
  for update to authenticated using (public.user_is_approved()) with check (public.user_is_approved());
drop policy if exists "approved delete ranking_records" on public.ranking_records;
create policy "approved delete ranking_records" on public.ranking_records
  for delete to authenticated using (public.user_is_approved());

-- activity_log: append-only by OMISSION — no update or delete policy exists
-- for any role. Insert additionally pins user_id to the caller so nobody can
-- forge an entry attributed to someone else.
drop policy if exists "approved read activity_log" on public.activity_log;
create policy "approved read activity_log" on public.activity_log
  for select to authenticated using (public.user_is_approved());
drop policy if exists "approved insert activity_log" on public.activity_log;
create policy "approved insert activity_log" on public.activity_log
  for insert to authenticated
  with check (public.user_is_approved() and user_id = auth.uid());
```

- [ ] **Step 3: Write `src/lib/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Throw at module load rather than letting every query fail with a confusing
// 401 later. Fail fast, with a message that names the missing variable.
if (!url) throw new Error('VITE_SUPABASE_URL is not set. Copy .env.example to .env.local.')
if (!anonKey) throw new Error('VITE_SUPABASE_ANON_KEY is not set. Copy .env.example to .env.local.')

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Required: the password-reset link delivers its tokens in the URL hash.
    detectSessionInUrl: true,
  },
})
```

- [ ] **Step 4: Write the failing tests for the pure helpers**

`src/lib/storage.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { PAGE, dedupeRecords, pageRanges, toSnapshotMeta } from './storage'

describe('pageRanges', () => {
  it('returns one range for an empty table', () => {
    expect(pageRanges(0)).toEqual([[0, PAGE - 1]])
  })

  it('returns one range when everything fits in a page', () => {
    expect(pageRanges(500)).toEqual([[0, PAGE - 1]])
  })

  it('covers every row above the PostgREST cap', () => {
    // PostgREST caps a response at 1000 rows and does NOT error on truncation.
    // Losing this makes every counter read low with no visible failure.
    const ranges = pageRanges(2500)
    expect(ranges).toHaveLength(3)
    expect(ranges[0]).toEqual([0, 999])
    expect(ranges[1]).toEqual([1000, 1999])
    expect(ranges[2]).toEqual([2000, 2999])
  })
})

describe('toSnapshotMeta', () => {
  it('re-derives displayDate rather than trusting the stored column', () => {
    const meta = toSnapshotMeta({ id: 'snap-2026-08-04', raw_date: '2026-08-04' })
    expect(meta).toEqual({
      id: 'snap-2026-08-04', rawDate: '2026-08-04', displayDate: '4 Aug 26',
    })
  })
})

describe('dedupeRecords', () => {
  it('collapses duplicate keyword+market rows', () => {
    // Orphan rows from a past upload would otherwise make stats read 2x what
    // the matrix renders.
    const out = dedupeRecords([
      { keyword: 'k', market: 'AE', position: '4', previous: '', change: '', urlFound: '', searchVolume: '', date: '' },
      { keyword: 'K', market: 'ae', position: '2', previous: '', change: '', urlFound: '', searchVolume: '', date: '' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].position).toBe('2')
  })
})
```

- [ ] **Step 5: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/storage.test.ts`
Expected: FAIL — cannot resolve `./storage`.

- [ ] **Step 6: Implement `src/lib/storage.ts`**

```ts
import type {
  RankingRecord, RecordMatcher, RecordPatch, Snapshot, SnapshotMeta,
} from '../types'
import { formatDisplayDate } from './dates'
import { supabase } from './supabase'

/** ~2 months at a weekly cadence — enough history to read movement without
 *  downloading everything on mount. */
export const DEFAULT_RECENT = 8

/** PostgREST caps a response at 1000 rows. */
export const PAGE = 1000
/** Insert batch size. Large enough to be few round trips, small enough to
 *  stay well under statement and payload limits. */
export const CHUNK = 500

const RECORD_COLS =
  'snapshot_id, keyword, market, position, previous, change, url_found, search_volume, date'

interface RecordRow {
  snapshot_id: string
  keyword: string
  market: string
  position: string
  previous: string | null
  change: string | null
  url_found: string | null
  search_volume: string | null
  date: string | null
}

// ─── Mapping ─────────────────────────────────────────────────────────────

/** Re-derives displayDate from raw_date instead of trusting the stored
 *  column, so rows written under an older format still render correctly.
 *  Store the derived value, never trust it on read. */
export function toSnapshotMeta(row: { id: string; raw_date: string }): SnapshotMeta {
  return {
    id: row.id,
    rawDate: row.raw_date,
    displayDate: formatDisplayDate(row.raw_date),
  }
}

function toRecord(row: RecordRow): RankingRecord {
  return {
    keyword: row.keyword,
    market: row.market,
    position: row.position,
    previous: row.previous ?? '',
    change: row.change ?? '',
    urlFound: row.url_found ?? '',
    searchVolume: row.search_volume ?? '',
    date: row.date ?? '',
  }
}

function toRow(snapshotId: string, r: RankingRecord): RecordRow {
  return {
    snapshot_id: snapshotId,
    keyword: r.keyword,
    market: r.market,
    position: r.position,
    previous: r.previous,
    change: r.change,
    url_found: r.urlFound,
    search_volume: r.searchVolume,
    date: r.date,
  }
}

/** Defensive: keys by keyword|market so a past upload that left orphans
 *  behind cannot make stats read double what the matrix renders. */
export function dedupeRecords(records: RankingRecord[]): RankingRecord[] {
  const byKey = new Map<string, RankingRecord>()
  for (const r of records) {
    byKey.set(`${r.keyword.toLowerCase()}|${r.market.toLowerCase()}`, r)
  }
  return Array.from(byKey.values())
}

/** All page ranges needed to read `count` rows. Always at least one range so
 *  an empty table still issues a well-formed query. */
export function pageRanges(count: number): Array<[number, number]> {
  const pages = Math.max(1, Math.ceil(count / PAGE))
  return Array.from({ length: pages },
    (_, i) => [i * PAGE, i * PAGE + PAGE - 1] as [number, number])
}

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`)
}

// ─── Reads ───────────────────────────────────────────────────────────────

export async function loadSnapshotMeta(): Promise<SnapshotMeta[]> {
  const { data, error } = await supabase
    .from('snapshots')
    .select('id, raw_date')
    // raw_date first: a backfill writes newest-first, so created_at desc
    // alone would report the oldest snapshot as the latest.
    .order('raw_date', { ascending: false })
    .order('created_at', { ascending: false })
  fail('Could not load snapshot list', error)
  return (data ?? []).map(toSnapshotMeta)
}

/**
 * Reads all records for the given snapshots.
 *
 * One head-count, then every page IN PARALLEL — latency is
 * 1 + ceil(N/1000) round trips, not N/1000 sequential ones. If this is ever
 * "simplified" into a single select, large datasets truncate silently at 1000
 * rows and every stat counter reads low with no error anywhere.
 */
export async function loadSnapshotRecords(
  ids: string[],
): Promise<Map<string, RankingRecord[]>> {
  const out = new Map<string, RankingRecord[]>()
  if (ids.length === 0) return out

  const { count, error: countError } = await supabase
    .from('ranking_records')
    .select('*', { count: 'exact', head: true })
    .in('snapshot_id', ids)
  fail('Could not count ranking records', countError)

  const pages = await Promise.all(
    pageRanges(count ?? 0).map(([from, to]) =>
      supabase.from('ranking_records').select(RECORD_COLS)
        .in('snapshot_id', ids).range(from, to),
    ),
  )

  const grouped = new Map<string, RankingRecord[]>()
  for (const page of pages) {
    fail('Could not load ranking records', page.error)
    for (const row of (page.data ?? []) as RecordRow[]) {
      const list = grouped.get(row.snapshot_id) ?? []
      list.push(toRecord(row))
      grouped.set(row.snapshot_id, list)
    }
  }

  for (const [id, records] of grouped) out.set(id, dedupeRecords(records))
  return out
}

/** The mount query: ALL metadata (cheap, dozens of rows) but records only for
 *  the newest `recentCount` snapshots. The UI therefore knows how much
 *  history exists without downloading it. */
export async function loadRecentSnapshots(
  recentCount: number = DEFAULT_RECENT,
): Promise<{ meta: SnapshotMeta[]; snapshots: Snapshot[] }> {
  const meta = await loadSnapshotMeta()
  const recent = meta.slice(0, recentCount)
  const records = await loadSnapshotRecords(recent.map(m => m.id))
  return {
    meta,
    snapshots: recent.map(m => ({ ...m, records: records.get(m.id) ?? [] })),
  }
}

export async function loadOlderSnapshots(
  metaEntries: SnapshotMeta[],
): Promise<Snapshot[]> {
  if (metaEntries.length === 0) return []
  const records = await loadSnapshotRecords(metaEntries.map(m => m.id))
  return metaEntries.map(m => ({ ...m, records: records.get(m.id) ?? [] }))
}

// ─── Writes ──────────────────────────────────────────────────────────────

/**
 * Wipe-and-replace, idempotent by construction.
 *
 * Child rows are deleted EXPLICITLY rather than relying on
 * ON DELETE CASCADE. If the cascade is not actually configured on the
 * deployed database, deleting only the snapshot leaves orphans and the next
 * re-upload silently doubles the data.
 */
export async function upsertSnapshot(snapshot: Snapshot): Promise<void> {
  const del = await supabase.from('ranking_records')
    .delete().eq('snapshot_id', snapshot.id)
  fail('Could not clear existing records', del.error)

  const delSnap = await supabase.from('snapshots').delete().eq('id', snapshot.id)
  fail('Could not clear existing snapshot', delSnap.error)

  const insSnap = await supabase.from('snapshots').insert({
    id: snapshot.id,
    raw_date: snapshot.rawDate,
    display_date: snapshot.displayDate,
  })
  fail('Could not save the snapshot', insSnap.error)

  const rows = snapshot.records.map(r => toRow(snapshot.id, r))
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const ins = await supabase.from('ranking_records').insert(chunk)
    fail('Could not save ranking records', ins.error)
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  const delRecords = await supabase.from('ranking_records')
    .delete().eq('snapshot_id', id)
  fail('Could not delete ranking records', delRecords.error)
  const delSnap = await supabase.from('snapshots').delete().eq('id', id)
  fail('Could not delete the snapshot', delSnap.error)
}

/**
 * Patches matching records.
 *
 * An omitted matcher field widens the predicate, so one function serves both
 * "this exact row" and "every row for this keyword". Patch keys are detected
 * with `in` so an explicit empty string CLEARS a value while an absent key
 * leaves it untouched.
 */
export async function updateRecordFields(
  snapshotId: string,
  matcher: RecordMatcher,
  patch: RecordPatch,
): Promise<void> {
  const update: Record<string, string> = {}
  if ('searchVolume' in patch) update.search_volume = patch.searchVolume ?? ''
  if (Object.keys(update).length === 0) return

  let query = supabase.from('ranking_records').update(update)
    .eq('snapshot_id', snapshotId)
  if (matcher.keyword !== undefined) query = query.eq('keyword', matcher.keyword)
  if (matcher.market !== undefined) query = query.eq('market', matcher.market)

  const { error } = await query
  fail('Could not save the edit', error)
}
```

- [ ] **Step 7: Run the tests and the build**

Run: `npx vitest run src/lib/storage.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: clean. `import.meta.env` requires the `vite/client` types already referenced in `src/vite-env.d.ts`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(db): add schema, RLS lockdown and paginated storage layer"
```

---

## Task 10: App shell and state container

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/Sidebar.tsx`, `src/components/Topbar.tsx`, `src/components/Toast.tsx`

**Interfaces:**
- Consumes: `storage.ts`, `carryForward.ts`, `theme.ts`, all types
- Produces:
  - `App()` — the route table
  - `Layout()` — owns all state, provides `HzOutletContext` via `<Outlet context>`
  - `RankingGate({ children })` — blocks only the routes that read snapshots
  - `Sidebar`, `Topbar`, `ToastContainer` components
  - `SECTION_TITLES: Record<string, [string, string]>`

- [ ] **Step 1: Write `src/components/Toast.tsx`**

```tsx
import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react'
import type { ToastItem } from '../types'

const ICONS = { success: CheckCircle2, warning: AlertTriangle, error: XCircle } as const
const ACCENTS = { success: '--pos', warning: '--warn', error: '--neg' } as const

export function ToastContainer({ toasts, onDismiss }: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}) {
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
      {toasts.map(t => {
        const Icon = ICONS[t.type]
        return (
          <div key={t.id}
            className="animate-toast-in flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] shadow-[0_12px_32px_rgba(0,0,0,0.12)] max-w-[380px]"
            style={{
              background: 'var(--surface)',
              borderColor: `var(${ACCENTS[t.type]}-border)`,
              color: 'var(--ink)',
            }}>
            <Icon size={15} style={{ color: `var(${ACCENTS[t.type]})`, marginTop: 1, flexShrink: 0 }} />
            <span className="flex-1 leading-snug">{t.message}</span>
            <button onClick={() => onDismiss(t.id)} aria-label="Dismiss"
              className="shrink-0 opacity-50 hover:opacity-100 transition-opacity">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Write `src/components/Sidebar.tsx`**

Requirements — implement exactly:
- Desktop rail `hidden sm:block`, width animates `transition-[width] duration-200 ease-out` between `w-[64px]` and `w-[240px]`. Labels fade with `opacity-0 transition-opacity duration-150` and keep their layout box so nothing reflows.
- Collapse toggle: 24px circular button pinned `-right-3 top-7`, straddling the seam.
- Mobile: `sm:hidden` fixed drawer, `-translate-x-full` → `translate-x-0`, `bg-black/40` backdrop, auto-closes on route change, locks `body.overflow` while open.
- Five zones: logo (36px navy rounded square with `HZ` + wordmark) → nav → contextual group sub-list (only on `/rankings*`, active group derived **from the URL**, not local state) → spacer → footer (Import Data CTA + `Updated: <date>` in mono).
- Admin nav item appended conditionally: `const pages = isAdmin ? [...PAGES, ADMIN_PAGE] : PAGES`.
- Expanded state persists at `localStorage['hz_sidebar_expanded']` inside `try/catch`.
- Active row: `background: var(--active-tint)`, `border-left: 2px solid var(--brand-blue)`, `padding-left: 10px` (12 − 2, so labels stay aligned), icon `--brand-blue`, label `--navy-text`.

```tsx
const PAGES = [
  { path: '/',            label: 'Overview',   icon: LayoutDashboard },
  { path: '/rankings',    label: 'Rankings',   icon: TrendingUp },
  { path: '/log',         label: 'Activity',   icon: History },
  { path: '/how-it-works',label: 'How it works', icon: HelpCircle },
] as const
const ADMIN_PAGE = { path: '/admin/users', label: 'Users', icon: Users } as const
```

- [ ] **Step 3: Write `src/components/Topbar.tsx`**

- `h-16 min-h-[64px] shrink-0 flex flex-col`. First child is the 3px accent strip: three equal bands `--brand-navy` / `--brand-blue` / `--brand-light`.
- Then a `flex-1` row: hamburger (mobile only) · title (26px Outfit, 18px mobile) + subtitle · theme toggle · session block (email in mono, `max-w-[180px]` truncated, `hidden sm:block`) or a Sign in button.

- [ ] **Step 4: Rewrite `src/App.tsx`**

```tsx
const SECTION_TITLES: Record<string, [string, string]> = {
  '/rankings':     ['Rankings', 'Keyword positions for hazreviews.com'],
  '/log':          ['Activity Log', 'Who changed what, and when'],
  '/how-it-works': ['How It Works', 'A quick guide to using the dashboard'],
  '/admin/users':  ['Users', 'Access and approvals'],
}
// '/' falls through to ['Haz Reviews', 'Command center · hazreviews.com']
```

`Layout` owns:
```tsx
const [state, setState] = useState<AppState>({ snapshots: [], snapshotMeta: [], activeSnapshotId: null })
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
```

The derived view — this is the central pattern:
```tsx
// State is RAW — exactly what the DB holds. Carry-forward is DERIVED here so
// that editing an early snapshot's volume re-propagates downstream. Applying
// it to state at load time would freeze inheritance permanently.
const viewSnapshots = useMemo(() => applyCarryForward(state.snapshots), [state.snapshots])
```

`onEditCell` follows this exact order — DB first, then log, then state:
```tsx
const handleEditCell = useCallback(async (
  snapshotId: string, matcher: RecordMatcher, patch: RecordPatch,
) => {
  const snapshot = state.snapshots.find(s => s.id === snapshotId)
  // matchRecord is used by BOTH the before-value lookup and the state update,
  // so the logged old value can never drift from the row actually patched.
  const matchRecord = (r: RankingRecord) =>
    (matcher.keyword === undefined || r.keyword === matcher.keyword) &&
    (matcher.market === undefined || r.market === matcher.market)
  const before = snapshot?.records.find(matchRecord)

  await requireAuth(() => updateRecordFields(snapshotId, matcher, patch))

  if ('searchVolume' in patch) {
    void logActivity('edit', 'rankings',
      `SV '${before?.searchVolume ?? ''}' → '${patch.searchVolume ?? ''}' · ${matcher.keyword ?? 'all'} · ${matcher.market ?? 'all'}`)
  }

  setState(prev => ({
    ...prev,
    snapshots: prev.snapshots.map(s => s.id !== snapshotId ? s : {
      ...s,
      records: s.records.map(r => matchRecord(r) ? { ...r, ...patch } : r),
    }),
  }))
}, [state.snapshots, requireAuth])
```

Route table:
```tsx
<Routes>
  <Route element={<Layout />}>
    <Route index element={<RankingGate><Home /></RankingGate>} />
    <Route path="rankings" element={<RankingGate><Rankings /></RankingGate>} />
    <Route path="rankings/:groupSlug" element={<RankingGate><Rankings /></RankingGate>} />
    <Route path="log" element={<Log />} />
    <Route path="how-it-works" element={<HowItWorks />} />
    <Route path="admin/users" element={<AdminUsers />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route>
</Routes>
```

`RankingGate` blocks only snapshot-reading routes:
```tsx
function RankingGate({ children }: { children: React.ReactNode }) {
  const ctx = useOutletContext<HzOutletContext>()
  if (ctx.snapshotsLoading) {
    return <div className="font-mono text-[12px] p-8" style={{ color: 'var(--muted)' }}>
      Loading rankings…
    </div>
  }
  return <>{children}</>
}
```
`/log`, `/how-it-works` and `/admin/users` render immediately — they have their own data sources and must not wait on a large ranking fetch.

Root layout classes: `flex h-screen overflow-hidden bg-[var(--page)] relative`; content column `flex flex-col flex-1 min-w-0 relative z-10 overflow-hidden`. **`min-w-0` is required** or a wide matrix forces the whole layout to overflow horizontally. Background grid: fixed, `pointer-events-none z-0 opacity-30`, two 1px linear-gradients at 40px.

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: clean.

Run: `npm run dev` and open `http://localhost:3002`. Expected: shell renders, rail collapses and expands, theme toggle flips light/dark and survives reload.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shell): add layout state container, sidebar, topbar and toasts"
```

---

## Task 11: Rankings page — group grid and detail matrix

**Files:**
- Create: `src/pages/Rankings.tsx`, `src/components/PosBadge.tsx`, `src/components/StatsRow.tsx`, `src/components/EditableCell.tsx`, `src/components/SnapshotTabs.tsx`, `src/components/RankingMatrix.tsx`

**Interfaces:**
- Consumes: `HzOutletContext`, `groups.ts`, `normalize.ts`
- Produces: `Rankings()`, `PosBadge`, `StatsRow`, `EditableCell`, `SnapshotTabs`, `RankingMatrix`

- [ ] **Step 1: Write `src/components/PosBadge.tsx`**

Dual-mode logic — copy this behaviour exactly:

```tsx
export function PosBadge({ record, crossSnapPrevPos }: {
  record: RankingRecord
  /** undefined → no previous snapshot exists; fall back to the record's own
   *  in-file change token.
   *  null → a previous snapshot exists but this key was absent from it;
   *  render with NO colour, because absence of data is not a movement. */
  crossSnapPrevPos?: ParsedPosition
}) { /* ... */ }
```

Rules:
- `crossSnapPrevPos === undefined` → colour from `effectiveDelta(record.change, pos)`.
- `crossSnapPrevPos === null` → no colour, `var(--mx-ink)`.
- `crossSnapPrevPos === 'NR'` and current is numeric → entered the rankings, green `▲`.
- Both numeric → green `▲ (prev)` if `prev > pos`, red `▼ (prev)` if `prev < pos`, plain `--mx-ink` if equal.
- Current `NR` → `NR` in `--muted`.

Cross-snapshot comparison beats trusting the file's change column: a rank that genuinely did not move renders plain regardless of what the export claims.

- [ ] **Step 2: Write `src/components/EditableCell.tsx`**

Click → input, Enter or blur commits, Escape reverts, disabled while saving. Props:
```tsx
interface EditableCellProps {
  value: string
  onSave: (next: string) => Promise<void>
  disabled?: boolean
  title?: string
  placeholder?: string
}
```
On save failure, revert to the original value and rethrow so the caller can toast. Never leave the cell showing a value the database rejected.

- [ ] **Step 3: Write `src/components/StatsRow.tsx`**

Five toggle-filter cards — Top 3 / Improved / Dropped / Unchanged / Not Ranking — in `grid grid-cols-3 sm:grid-cols-5 gap-[5px]`. Each is a filter, not a readout: clicking scopes the matrix and swaps the sub-label to `▸ filtering` in the accent colour. Active state = 2px accent border + `color-mix(in srgb, ${accent} 7%, transparent)` fill + a 3px accent ring, plus a 2px accent bar along the top edge.

`color-mix` with a variable is required — concatenating a hex with an alpha suffix breaks when `accent` is a CSS variable rather than a literal.

```tsx
type StatKey = 'top3' | 'improved' | 'dropped' | 'unchanged' | 'notRanking'
interface StatsRowProps {
  stats: StatsCounts
  active: StatKey | null
  onToggle: (key: StatKey) => void
}
```

- [ ] **Step 4: Write `src/components/RankingMatrix.tsx`**

One date's data as a spreadsheet-fidelity table:
- Sticky keyword column, `background: var(--mx-sticky)` — **fully opaque**, because it overlays scrolled content.
- One column per market, in `orderMarkets(...)` order, each carrying a palette pair from the Tier-3 tokens.
- Date band header row in `var(--band-date)` with white text.
- Position cells render `<PosBadge>`; the volume cell renders `<EditableCell>`.
- A `URL` column showing `urlFound` truncated, with the full value in `title`.
- Wide content scrolls inside its own `overflow-x-auto` container so the page body never scrolls horizontally.

```tsx
interface RankingMatrixProps {
  snapshot: Snapshot
  previousSnapshot: Snapshot | undefined
  markets: string[]
  records: RankingRecord[]
  editDisabled: boolean
  editTitle?: string
  onEditVolume: (record: RankingRecord, next: string) => Promise<void>
}
```

Build the previous-position lookup once per render:
```tsx
const prevByKey = useMemo(() => {
  if (!previousSnapshot) return null   // null → no previous snapshot at all
  const m = new Map<string, ParsedPosition>()
  for (const r of previousSnapshot.records) {
    m.set(`${r.keyword.toLowerCase()}|${r.market.toLowerCase()}`, parsePosition(r.position))
  }
  return m
}, [previousSnapshot])
```
Pass `crossSnapPrevPos={prevByKey === null ? undefined : prevByKey.get(key) ?? null}` — the three-state distinction is what keeps "absent" from rendering as "moved".

- [ ] **Step 5: Write `src/pages/Rankings.tsx`**

Two modes in one file, separated by section rules.

**Grid mode** (no `:groupSlug`): `GroupGrid` — `grid grid-cols-2 sm:grid-cols-3 gap-3` of cards, one per group that has records in the active snapshot, plus `Other` when non-empty. Each card shows the abbreviation badge filled with `group.color`, the group name, keyword count, and average position. Cards are `div`s with `role="button"`, `tabIndex={0}`, and a keydown handler guarded on `e.target` — they contain buttons, and a `<button>` inside a `<button>` is invalid DOM.

**Detail mode** (`:groupSlug`): `GroupView`, keyed by `` `${group.name}` `` so switching groups remounts with clean internal state. Contains `StatsRow` + market filter + keyword search + one `RankingMatrix` per date section (newest first) + a "Load older history" button wired to `ctx.onLoadOlderSnapshots`.

Resolve the group from the URL, and redirect on an unknown slug:
```tsx
const group = slug ? GROUP_BY_SLUG.get(slug) ?? (slug === 'other' ? OTHER_GROUP : undefined) : undefined
if (slug && !group) return <Navigate to="/rankings" replace />
```

Records for a group are computed, never stored:
```tsx
const groupRecords = useMemo(
  () => snapshot.records.filter(r => groupForKeyword(r.keyword).name === group.name),
  [snapshot.records, group.name],
)
```

- [ ] **Step 6: Verify**

Run: `npm run build`
Expected: clean.

Manual check with a seeded snapshot: the grid lists groups with counts; clicking one opens the matrix; stat cards filter; search filters; the volume cell edits and persists across reload.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(rankings): add group grid and spreadsheet-fidelity matrix"
```

---

## Task 12: Upload flow

**Files:**
- Create: `src/components/UploadModal.tsx`, `src/components/UploadSummary.tsx`, `src/components/DuplicateWarning.tsx`
- Modify: `src/App.tsx` (wire the handlers)

**Interfaces:**
- Consumes: `parseSheet`, `withSnapshotDate`, `upsertSnapshot`, `deleteSnapshot`, `logActivity`
- Produces: `UploadModal`, `UploadSummary`, `DuplicateWarning`, and `Layout`'s `persistOneSnapshot`

- [ ] **Step 1: Write `src/components/UploadModal.tsx`**

Drag-and-drop zone plus file picker accepting `.xlsx,.xls,.csv`. On file selection: read as `ArrayBuffer`, call `parseSheet`, and show a pre-commit review panel with detected date (editable `<input type="date">`), record count, market list, and unmatched-keyword count. Parse errors render inline in the modal — never as a toast that disappears while the modal is still open.

The date override matters: many exports carry no date column, and a mislabeled snapshot corrupts every movement calculation downstream. Apply it with `withSnapshotDate(result, chosenDate)` so the id changes with the date.

Modal chrome: `fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center`, panel `bg-[var(--surface)] border border-[var(--border-2)] rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.12)] w-[520px] max-w-[95vw] animate-modal-in`. Escape closes via a `useEffect` keydown listener.

- [ ] **Step 2: Write `DuplicateWarning.tsx` and `UploadSummary.tsx`**

`DuplicateWarning`: a snapshot already exists for that date → Replace or Cancel, showing the existing record count next to the incoming one.

`UploadSummary`: post-import breakdown — records imported, keywords, markets (flagging any outside `MARKET_ORDER`), skipped rows, and the unmatched keyword list (first 20, with a total). The unmatched list is the actionable output: it tells the user which groups to add to the registry.

- [ ] **Step 3: Wire the flow in `src/App.tsx`**

```tsx
/** Shared low-level primitive. Wraps upsert in requireAuth, keeps snapshots
 *  and snapshotMeta sorted newest-first by rawDate, and returns null on
 *  failure so callers decide how to surface it. Deliberately shows no toasts
 *  of its own. */
async function persistOneSnapshot(snapshot: Snapshot): Promise<Snapshot | null>
```

Flow:
```
UploadModal → parseSheet(buffer) → ParseResult
   ├── snapshotMeta has this rawDate? → DuplicateWarning
   │      └── Replace → deleteSnapshot(id) → persistOneSnapshot
   └── else → persistOneSnapshot → logActivity('upload', …) → UploadSummary + toast
```

Toast copy on success:
`✓ Imported 1,240 records · 6 groups · 3 markets — 4 Aug 26`

And when anything was unmatched:
`⚠ 12 keywords not matched to a group — add them to src/lib/groups.ts`

- [ ] **Step 4: Verify end to end**

Build a small `.csv` by hand with the columns from Task 8, upload it, and confirm: it appears in the matrix, re-uploading the same date prompts Replace, replacing does not double the row count, and the summary lists unmatched keywords.

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(upload): add import flow with date override and duplicate handling"
```

---

## Task 13: Auth

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/useAuth.ts`, `src/lib/userAccess.ts`, `src/components/AuthGate.tsx`, `src/components/Login.tsx`, `src/components/LoginModal.tsx`, `src/pages/AdminUsers.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces:
  - `REQUIRE_AUTH: boolean`
  - `signIn`, `signUp`, `signOut`, `signInWithGoogle`, `sendPasswordReset`
  - `useAuth()` → `{ session, modalOpen, requireAuth, openLogin, cancelAuth, isApproved, isAdmin, accessLoading }`
  - `getWriteGate(session, isApproved, accessLoading): WriteGate`
  - `loadUserAccess()`, `setUserStatus()`, `setUserAdmin()`

- [ ] **Step 1: Write `src/lib/auth.ts`**

```ts
export const REQUIRE_AUTH = import.meta.env.VITE_REQUIRE_AUTH === 'true'
```
Plus thin wrappers over `supabase.auth` for password sign-in/sign-up, Google OAuth, sign-out, and password reset.

- [ ] **Step 2: Write `src/lib/useAuth.ts`**

Four decisions that are easy to get wrong — implement all four:

```ts
// 1. requireAuth has a STABLE identity (empty dep array) and reads session and
//    approval from REFS, not state. An async operation that captured
//    requireAuth before sign-in completed must see current state when it
//    finally runs. Do NOT add [session] to this dependency array — that was a
//    real, fixed bug in the sibling project.
const requireAuth = useCallback(<T,>(fn: () => T | Promise<T>): Promise<T> => { /* ... */ }, [])

// 2. accessCheck is a PROMISE ref. runGated awaits the in-flight approval
//    lookup before deciding, so a fast click right after sign-in cannot race
//    ahead of the approval query.
const accessCheck = useRef<Promise<boolean> | null>(null)

// 3. accessGen is a GENERATION COUNTER. A slow lookup for a stale session must
//    not clobber a newer verdict after a quick sign-out/sign-in.
const accessGen = useRef(0)

// 4. A superseded pending action is REJECTED, not orphaned.
reject(new Error('Superseded by a newer sign-in request'))
```

`getWriteGate` — the asymmetry is the point:
```ts
export function getWriteGate(
  session: Session | null, isApproved: boolean, accessLoading: boolean,
): WriteGate {
  // Entry-point BUTTONS stay clickable while signed out — clicking is what
  // opens the login modal. Inline CELL EDITS are disabled, because there is no
  // "click to sign in" recovery from inside an already-open cell editor.
  if (!session)     return { disabled: false, editDisabled: true, title: 'Sign in to make changes' }
  if (accessLoading) return { disabled: false, editDisabled: false }
  if (!isApproved)  return { disabled: true, editDisabled: true, title: 'Awaiting admin approval' }
  return { disabled: false, editDisabled: false }
}
```

- [ ] **Step 3: Write `src/components/AuthGate.tsx`**

Active only when `REQUIRE_AUTH`. States: checking session → `<Login/>` → checking access → `pending` | `revoked` | `approved`.

Two refinements to implement:
- **Background re-check.** Repeat auth events for the *same* user (hourly `TOKEN_REFRESHED`, tab-refocus `SIGNED_IN`) re-verify without unmounting the app behind "Checking access…".
- **Fails closed, but not on a blip.** A first-time lookup failure → `pending`. A *background* re-check failure keeps the existing verdict — RLS is still the real boundary, so a transient network error must not eject an approved user mid-session.

`pending` and `revoked` get deliberately different copy. Telling someone whose access was withdrawn that they are "awaiting approval" invites them to wait for something that is not coming.

- [ ] **Step 4: Write `LoginModal.tsx`, `Login.tsx`, `userAccess.ts`, `AdminUsers.tsx`**

`AdminUsers`: lists `user_access` (RLS returns all rows to admins, only their own to everyone else). Actions: approve, revoke, promote/demote admin. Uses `currentUserId` to hide destructive self-actions. Redirects non-admins away — but **only after `accessLoading` resolves**, or a real admin sees a false redirect flash on page load:
```tsx
if (!accessLoading && !isAdmin) return <Navigate to="/" replace />
```

- [ ] **Step 5: Apply the lockdown migration and verify**

In the Supabase SQL editor, run `supabase/auth-lockdown.sql`. Seed the first admin by hand:
```sql
update public.user_access set status = 'approved', is_admin = true
where email = 'jose@optinetsolutions.com';
```

Verify: a signed-out visitor sees the login screen; a new signup sees "awaiting approval"; approving them in `/admin/users` grants access; a revoked user sees the revoked copy, not the pending copy.

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): add approval-gated auth, write gate and admin console"
```

---

## Task 14: Activity log

**Files:**
- Create: `src/lib/activityLog.ts`, `src/pages/Log.tsx`

**Interfaces:**
- Produces: `logActivity(action, section, summary): Promise<void>`, `loadActivityLog(limit?): Promise<ActivityLogRow[]>`

- [ ] **Step 1: Write `src/lib/activityLog.ts`**

```ts
/**
 * Best-effort by contract: wrapped in try/catch, NEVER throws, and callers
 * never await it (`void logActivity(...)`). A failed audit write must never
 * block or roll back the real mutation it describes.
 */
export async function logActivity(
  action: 'upload' | 'edit' | 'delete', section: string, summary: string,
): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser()
    const user = data.user
    if (!user) return
    await supabase.from('activity_log').insert({
      user_id: user.id, email: user.email ?? '', action, section, summary,
    })
  } catch {
    // Deliberately swallowed — see the contract above.
  }
}
```

- [ ] **Step 2: Write `src/pages/Log.tsx`**

`loadActivityLog(200)` → reverse-chronological table of timestamp (mono) / email (mono) / action pill / section / summary. Empty state: "No activity recorded yet."

- [ ] **Step 3: Verify**

Upload a file and edit a volume cell, then open `/log`. Expected: two rows, correct emails, and the edit summary shows the old and new values.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(log): add append-only activity log and viewer"
```

---

## Task 15: Home overview

**Files:**
- Create: `src/pages/Home.tsx`

**Interfaces:**
- Consumes: `HzOutletContext`, `normalize.ts`, `groups.ts`

- [ ] **Step 1: Implement the page**

Sections, in order:
1. **Headline totals** — keywords tracked, markets, groups with data, snapshots. 32px Outfit values desktop / 22px mobile.
2. **Tier distribution** — `computeTiers` rendered as bars using `barRise`, with a Page-1 percentage.
3. **Group leaderboard** — compact fixed-height rows, sorted by average position ascending (lower is better), showing keyword count and avg position. For each group, walk snapshots newest→oldest to find the most recent one that actually has records for it, so a group missing from the latest import shows its last known state rather than zeros.
4. **Top movers** — best 10 improvements and worst 10 drops between the active snapshot and the one before it, computed by cross-snapshot position comparison rather than the change column.

Stat tiles link into `/rankings/:groupSlug`. Escape closes any modal opened from here.

- [ ] **Step 2: Verify**

Run: `npm run build`; open `/` with at least two snapshots loaded and confirm movers are non-empty and the leaderboard ordering is by ascending average position.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(home): add KPI overview, tier bars, leaderboard and movers"
```

---

## Task 16: How It Works, docs, and final verification

**Files:**
- Create: `src/pages/HowItWorks.tsx`, `README.md`, `CLAUDE.md`, `public/favicon.svg`
- Modify: `docs/superpowers/plans/2026-08-04-haz-reviews-dashboard.md` (tick the boxes)

- [ ] **Step 1: Write `src/pages/HowItWorks.tsx`**

Document the non-obvious rules for users, because every one of them looks like a bug to someone who does not know it:
- The five stat cards do not sum to the total — Top 3 overlaps the movement buckets by design.
- `NR` means "checked and not in the top 100", while a blank means "not checked".
- Search volume carries forward from older snapshots until you overwrite it; clearing it upstream stops the carry.
- Keyword groups are derived from a registry, so fixing a group name re-groups all history.
- Movement compares against the previous snapshot, not the export's own change column — so a rank that did not move shows no colour even if the spreadsheet claimed otherwise.
- Unmatched keywords land in **Other** and are never dropped.

- [ ] **Step 2: Write `README.md` and `CLAUDE.md`**

`README.md`: what the app is, the `hazreviews.com` subject, local setup (`npm install`, copy `.env.example`, `npm run dev` on **3002**), the SQL run order (`setup.sql` then `auth-lockdown.sql`), how to seed the first admin, and how to add a keyword group.

`CLAUDE.md`: commands, architecture summary, the derived-not-stored grouping rule, the invariants list from the spec, and a pointer to the spec and this plan. State the **real** dev port and the **real** test setup — the sibling projects' docs drifted from their code on exactly these two points.

- [ ] **Step 3: Full verification**

Run: `npm test`
Expected: all suites pass. Record the count.

Run: `npm run build`
Expected: exit 0, no type errors.

Run: `npm run dev`, then walk the whole loop: sign in → import a file → view the grid → open a group → filter by stat card → edit a volume → check `/log` → approve a user in `/admin/users` → toggle dark mode → reload and confirm theme and pins persisted.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: add How It Works page, README and CLAUDE.md"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §1 Purpose | 10, 11, 12 |
| §2 Import-first, no API | 8, 12 |
| §3 Keyword groups, derived | 4 |
| §3.1 Collision handling | 4 (tests first) |
| §4 Data model | 9 |
| §4.1 Markets | 4 (`MARKET_ORDER`, `orderMarkets`), 8 (`unknownMarkets`) |
| §4.2 Editable field + carry-forward | 7, 11, 12 |
| §5 Ingest | 8, 12 |
| §6 Pages | 10 (routes), 11, 14, 15, 16, 13 (AdminUsers) |
| §7 Auth | 9 (SQL), 13 |
| §8 Testing | 2, 4, 5, 6, 7, 8, 9 |
| §9 Scope | Nothing out-of-scope appears in any task |
| §10 Infrastructure | 1, 2 |
| §11 Invariants | Encoded as comments in 4, 7, 9, 10, 11, 13, 14 |
| §12 Assumptions | 4 (`MARKET_ORDER` comment), 16 (README) |

No gaps.

**2. Placeholder scan**

No `TBD`, no "add error handling", no "similar to Task N". Tasks 10–16 specify behaviour and contracts with code for every non-obvious mechanism; the routine JSX is described precisely enough to write without further decisions.

**3. Type consistency**

Checked across tasks: `RankingRecord` fields (`keyword`, `market`, `position`, `previous`, `change`, `urlFound`, `searchVolume`, `date`) are identical in Tasks 3, 5, 7, 8, 9, 11. `ParseResult` members match between Task 3 and Task 8 (`snapshot`, `skippedRows`, `unmatchedKeywords`, `markets`, `unknownMarkets`, `detectedDate`). `HzOutletContext.onLoadOlderSnapshots` takes no argument in both Task 3 and Task 11 — unlike the template's version, which took a category, because this project has one namespace. `groupForKeyword`, `groupSlug`, `orderMarkets`, `GROUP_BY_SLUG`, `OTHER_GROUP`, `MARKET_ORDER` are named identically in Tasks 4, 8, 11, 15. `pageRanges`/`PAGE`/`dedupeRecords`/`toSnapshotMeta` match between the Task 9 test and implementation.
