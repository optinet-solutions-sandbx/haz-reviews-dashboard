/**
 * The dashboard's own documentation, in the shared shell's step-card shape:
 * a centred column, a display-face title with the caption beneath it, and
 * numbered cards.
 *
 * THIS PAGE OWNS ITS HEADER rather than using `PageHeader`, which is the one
 * deliberate break from every other route. `PageHeader` puts a caption on the
 * title's baseline because a data view needs the pair to read as one compact
 * row above a table. This page has no table — it is prose — so the caption
 * belongs under the title as a lead paragraph, and the title can carry the
 * larger display size the shell's own guide page uses. Invariant 25 is still
 * satisfied: exactly one `<h1>`.
 *
 * The copy is written against what is actually built here. The sibling's guide
 * describes six live modules, an Export button and a month filter; five of those
 * modules are `NotBuilt` on this dashboard and neither control exists, so its
 * text was rewritten rather than copied. A guide that names a button the reader
 * cannot find is worse than no guide.
 */

import { useDocumentTitle } from '../lib/pageTitle'

// ─── Content ────────────────────────────────────────────────────────────────

interface Entry {
  title: string
  body: React.ReactNode
}

const STEPS: Entry[] = [
  {
    title: 'Pick a property',
    body: (
      <>
        Open <strong>Sites</strong> in the sidebar for the directory, or expand the row to jump
        straight to one. Until you pick one, Home shows a roll-up across every property. The address
        bar carries the property, so a link you copy points at what you were looking at, and
        switching keeps you on the page you were reading rather than sending you back to Home.
        Imports, snapshots, date selections and search volumes are kept entirely separate per
        property — nothing carries across. Keyword groups are the one shared thing, so a casino
        brand appearing on two properties keeps the same colour in both.
      </>
    ),
  },
  {
    title: 'Know which modules are built',
    body: (
      <>
        Each property lists six: SEO, Health, PageSpeed, Rankings, Backlinks and QA. Only{' '}
        <strong>Rankings</strong> has a feature behind it — the other five open a page that says so.
        They are listed rather than hidden because a tool list is only useful if every entry leads
        somewhere that explains itself, and a row pointing at nothing would quietly drop you on Home
        instead.
      </>
    ),
  },
  {
    title: 'Import a keyword export',
    body: (
      <>
        <p>
          Rankings shows an <strong>Import Data</strong> button while a property has no snapshot
          yet. If you are signed out, sign in first and the dialog reopens on its own.
        </p>
        <ol className="list-decimal pt-1.5 pl-4">
          <li>
            Drop an .xlsx, .xls or .csv export. Only a <strong>Keyword</strong> column is required —
            position, market, volume and URL are picked up automatically if present.
          </li>
          <li>Check the detected snapshot date and correct it if the export carried none.</li>
          <li>Confirm the target property. It defaults to the one you are viewing.</li>
          <li>Review the summary, especially the unmatched keyword list.</li>
        </ol>
      </>
    ),
  },
  {
    title: 'Read the ranking grid',
    body: (
      <>
        Rankings opens on the keyword groups for that property, each card showing how many keywords
        it holds and their average position. Open a group for the grid itself: every row is a
        keyword, every column a market. Colour is movement against the previous snapshot — green
        improved, red dropped — and search volume is editable in place, so a figure your export
        omitted can be typed straight into the cell.
      </>
    ),
  },
  {
    title: 'Compare snapshots and filter',
    body: (
      <>
        The snapshot tabs switch dates, and every panel recomputes against the snapshot before the
        one you selected. The five stat cards double as filters: click <strong>Improved</strong> to
        narrow the grid to improved keywords, and click it again to clear. The filter box narrows by
        keyword text, and the two combine.
      </>
    ),
  },
  {
    title: 'Ask AI',
    body: (
      <>
        Open <strong>Ask AI</strong> from the sidebar to ask about the imported numbers in plain
        language. The picker's first entry is a roll-up across every property; choosing a single
        property hands the assistant that property's keyword rows, so it can answer about individual
        keywords rather than only totals. It only ever sees what has actually been imported.
      </>
    ),
  },
]

// ─── Card ───────────────────────────────────────────────────────────────────

/**
 * One numbered step.
 *
 * The badge digit is REAL ANNOUNCED TEXT, not `aria-hidden`. It was hidden here
 * on the theory that the wrapping `<ol>` already carries the ordering, which is
 * true only where the list keeps its semantics. Tailwind's Preflight sets
 * `list-style: none` on every `ol`, and that is the exact condition under which
 * Safari/VoiceOver drops list semantics altogether — so on that pairing the
 * hidden digit left the step number announced by nothing at all.
 *
 * The cost of un-hiding it is a screen reader that reads "1" twice wherever the
 * list markers DO survive. A duplicated number is a blemish; a missing one loses
 * the sequence the whole page is built on.
 */
function Card({
  title,
  step,
  children,
}: {
  title: string
  step: number
  children: React.ReactNode
}) {
  return (
    <div
      className="flex items-start gap-4 rounded-[14px] p-5"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-2)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-[13px] text-white"
        /* --brand-navy, not --btn-ink: this is a filled brand chip, and --btn-ink
           flips navy → azure between themes, which would recolour every badge
           while the cards around them stayed put. The three brand hues are
           theme-independent by design. */
        style={{ background: 'var(--brand-navy)' }}
      >
        {step}
      </div>
      {/* min-w-0 so a long unbroken string wraps instead of widening the card
          past the column. */}
      <div className="min-w-0">
        <h2
          className="mb-1 font-display text-[15px] tracking-wide"
          style={{ color: 'var(--ink)' }}
        >
          {title}
        </h2>
        <div className="text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function HowItWorks() {
  useDocumentTitle('How It Works')

  return (
    <div className="animate-fade-up mx-auto w-full max-w-2xl">
      <h1 className="mb-2 font-display text-[28px] tracking-wider" style={{ color: 'var(--ink)' }}>
        How It Works
      </h1>
      <p className="mb-8 text-[14px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
        A quick guide to this dashboard, from picking a property to reading the results.
      </p>

      <ol className="flex flex-col gap-4">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <Card title={step.title} step={i + 1}>
              {step.body}
            </Card>
          </li>
        ))}
      </ol>
    </div>
  )
}
