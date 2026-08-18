import type { Snapshot } from '../types'
import { groupForKeyword } from './groups'
import { computeTiers, parsePosition } from './normalize'
import { SITES, type Site } from './sites'

/**
 * Turns the snapshots already in memory into the text the assistant reasons over.
 *
 * The assistant has no database access and no tools — it answers only from this
 * string. That is deliberate: the browser holds the data already, so a question
 * about it needs no retrieval, and an assistant that cannot query cannot invent a
 * query result.
 */

/**
 * Row ceiling. A real import is thousands of keywords; without a cap the context
 * would exceed the window on a large site and the request would fail outright
 * rather than answer from a subset.
 */
export const MAX_CONTEXT_ROWS = 400

/** Newest snapshot for a site, and the one before it for movement. */
function newestTwo(snapshots: Snapshot[], siteId: string): [Snapshot | undefined, Snapshot | undefined] {
  const forSite = snapshots
    .filter((s) => s.site === siteId)
    .sort((a, b) => b.rawDate.localeCompare(a.rawDate))
  return [forSite[0], forSite[1]]
}

interface Move {
  keyword: string
  market: string
  was: number
  now: number
  /** Positive is an improvement, because position 1 is the best. */
  delta: number
}

/** Keyword+market, lowercased — the same key the movers panel uses. */
function moveKey(keyword: string, market: string): string {
  return `${keyword.toLowerCase()}|${market.toLowerCase()}`
}

function previousPositions(previous: Snapshot | undefined): Map<string, number> {
  const before = new Map<string, number>()
  for (const r of previous?.records ?? []) {
    const pos = parsePosition(r.position)
    if (typeof pos === 'number') before.set(moveKey(r.keyword, r.market), pos)
  }
  return before
}

/**
 * Every row whose movement is real at both ends, biggest improvement first.
 *
 * Shared by the single-site context and the overview so the two can never report
 * different movement for the same keyword.
 */
function rankMoves(current: Snapshot, previous: Snapshot | undefined): Move[] {
  const before = previousPositions(previous)
  return current.records
    .map((r) => {
      const pos = parsePosition(r.position)
      const was = before.get(moveKey(r.keyword, r.market))
      // Both ends must be real positions. 'NR' has no number, and treating it as
      // one would invent a rank the export never reported.
      if (typeof pos !== 'number' || was === undefined || was === pos) return null
      return { keyword: r.keyword, market: r.market, was, now: pos, delta: was - pos }
    })
    .filter((m): m is Move => m !== null)
    .sort((a, b) => b.delta - a.delta)
}

function describeMove(m: Move): string {
  return `${m.keyword} ${m.was}→${m.now} (${m.delta > 0 ? '+' : ''}${m.delta})`
}

export function buildAskAiContext(snapshots: Snapshot[], site: Site): string {
  const [current, previous] = newestTwo(snapshots, site.id)

  if (!current) {
    return [
      `Site: ${site.name} (${site.domain})`,
      '',
      'No ranking data has been imported for this site yet, so there is nothing to',
      'analyse. Say so if asked about positions, movement or keywords.',
    ].join('\n')
  }

  const tiers = computeTiers(current.records)
  const keywords = new Set(current.records.map((r) => r.keyword)).size

  const before = previousPositions(previous)
  const moves = rankMoves(current, previous)

  const rows = current.records.slice(0, MAX_CONTEXT_ROWS).map((r) => {
    const group = groupForKeyword(r.keyword).name
    const pos = parsePosition(r.position)
    const was = before.get(moveKey(r.keyword, r.market))
    // Movement only when both ends are real positions. 'NR' has no number, and
    // treating it as one would invent a rank the export never reported.
    const move =
      typeof pos === 'number' && was !== undefined && was !== pos
        ? ` | was ${was} (${was > pos ? 'improved' : 'dropped'} ${Math.abs(was - pos)})`
        : ''
    return `${r.keyword} | ${r.market} | ${r.position} | ${group}${move}`
  })

  const omitted = current.records.length - rows.length

  /**
   * The rankings, precomputed.
   *
   * "What moved the most" is the question this page exists to answer, and getting
   * it from the rows means comparing a delta on every line — arithmetic a chat
   * model does confidently and wrong. Verified: asked over the rows alone, the
   * model named the second-largest improvement. Ranking it here also keeps the
   * answer identical to the movers panel, which is the same rule as everywhere
   * else in this app — derive once, never twice.
   */
  const improved = moves.filter((m) => m.delta > 0).slice(0, 5)
  const dropped = [...moves].reverse().filter((m) => m.delta < 0).slice(0, 5)
  const line = (m: Move) => `  ${describeMove(m)} in ${m.market}`

  const movers = moves.length
    ? [
        '',
        improved.length ? 'Biggest improvements (already ranked — do not recompute):' : '',
        ...improved.map(line),
        dropped.length ? 'Biggest drops (already ranked — do not recompute):' : '',
        ...dropped.map(line),
      ].filter(Boolean)
    : []

  return [
    `Site: ${site.name} (${site.domain})`,
    `Latest import: ${current.rawDate}${previous ? ` (previous: ${previous.rawDate})` : ' (no earlier import to compare)'}`,
    `Tracked keywords: ${keywords} · rows: ${current.records.length}`,
    `Tiers — P1: ${tiers.p1} · Top-3: ${tiers.top3} · Top-10: ${tiers.top10} · Page 2: ${tiers.page2} · Not ranking: ${tiers.nr}`,
    ...movers,
    '',
    'Rows below are: keyword | market | position | group | movement vs previous import',
    ...rows,
    ...(omitted > 0
      ? ['', `(${omitted} further rows truncated — only the first ${MAX_CONTEXT_ROWS} are shown.)`]
      : []),
  ].join('\n')
}

/**
 * Sentinel for the "All sites (overview)" entry in the site picker.
 *
 * The empty string, matching the shared markup these dashboards are ported from —
 * "no site chosen" is exactly what an unset `<select>` value means, so a future port
 * in either direction needs no translation.
 *
 * What keeps it safe is not the literal but the ordering: `siteById` falls back to
 * the default site for anything it does not recognise (invariant 24), so overview
 * mode must be decided BEFORE any id lookup, never by asking the registry what ''
 * resolves to. A test asserts the sentinel can never collide with a registered id.
 */
export const ALL_SITES = ''

/** Per-site summary blocks, no keyword rows. */
export function buildOverviewContext(snapshots: Snapshot[], registry: Site[] = SITES): string {
  const blocks = registry.map((site) => {
    const [current, previous] = newestTwo(snapshots, site.id)
    if (!current) {
      // Stated, never omitted (invariant 17). A missing site read as an absent
      // heading looks like a site with no problems.
      return [`${site.name} (${site.domain})`, '  No data imported for this site yet.'].join('\n')
    }

    const tiers = computeTiers(current.records)
    const moves = rankMoves(current, previous)
    const top = (list: typeof moves, label: string) =>
      list.length ? [`  ${label}: ${list.slice(0, 3).map(describeMove).join(', ')}`] : []

    return [
      `${site.name} (${site.domain})`,
      `  Latest import: ${current.rawDate}${previous ? ` (previous: ${previous.rawDate})` : ' (no earlier import)'}`,
      `  Keywords: ${new Set(current.records.map((r) => r.keyword)).size} · rows: ${current.records.length}`,
      `  P1: ${tiers.p1} · Top-3: ${tiers.top3} · Top-10: ${tiers.top10} · Page 2: ${tiers.page2} · Not ranking: ${tiers.nr}`,
      ...top(
        moves.filter((m) => m.delta > 0),
        'Biggest improvements',
      ),
      ...top(
        [...moves].reverse().filter((m) => m.delta < 0),
        'Biggest drops',
      ),
    ].join('\n')
  })

  const withData = registry.filter((site) => newestTwo(snapshots, site.id)[0]).length

  return [
    // Counted here, not left to the model. Verified: it read a per-site keyword
    // count as a site count and answered "ten sites" for a one-site portfolio.
    `Portfolio overview — ${registry.length} site${registry.length === 1 ? '' : 's'} tracked` +
      `${withData === registry.length ? '' : `, ${withData} with imported data`}.`,
    `Site names: ${registry.map((s) => s.name).join(', ')}.`,
    '',
    // Said out loud, because the model cannot tell an omitted list from an empty
    // one: without this it answers keyword questions from rows it never received.
    'This overview carries per-site summaries only, not the individual keyword rows —',
    'across every site those would not fit. For keyword-level detail the reader can',
    'pick a single site in the Site selector; say so rather than guessing at rows.',
    '',
    ...blocks.flatMap((b) => [b, '']),
  ]
    .join('\n')
    .trimEnd()
}

/**
 * The starter questions shown in the empty state.
 *
 * Every one has to be answerable from the context it ships with. The sibling
 * dashboard offers domain rating, PageSpeed and QA-check chips because it holds
 * that data; this app imports keyword positions only, so those three are replaced
 * rather than copied — a chip whose reliable answer is "that is not in this import"
 * spends a request to tell the reader the feature is empty. Asserted in the tests.
 */
export function suggestionsFor(siteId: string): string[] {
  if (siteId === ALL_SITES) {
    return [
      'Which site improved the most since last week?',
      'Where are the biggest ranking drops across all sites?',
      'Which site has the most keywords on page 1?',
      'How many keywords are not ranking anywhere?',
      'Summarize how the portfolio is performing',
    ]
  }
  return [
    'How is this site ranking overall (page 1, top 10, not ranking)?',
    'Which brand groups are strongest?',
    'Biggest ranking drops since last week?',
    'Which keywords are not ranking?',
    "Summarize this site's performance",
  ]
}

/** One turn as the page holds it: what was shown, and what was actually sent. */
export interface AskAiTurn {
  role: 'user' | 'assistant'
  /** The text on screen — for a user turn, the bare question. */
  content: string
  /** What was sent for this turn, when it differs. The first question carries the data. */
  wire?: string
  /**
   * Which scope this turn was asked under — a site id, or `ALL_SITES`. Recorded so a
   * mid-thread switch of the Site picker can tell "already sent" from "never sent".
   */
  scope?: string
}

/**
 * Assembles the messages for one request.
 *
 * Separate from the component because the failure mode is invisible: the page
 * renders a bare question in the transcript, and replaying THAT as history sends a
 * data question with no data attached. The model then answers fluently from
 * nothing — no error, no empty bubble, just a confident wrong number. This is why
 * a turn keeps `wire` alongside `content`.
 *
 * The data rides in a user turn rather than the system prompt so it is sent once
 * per scope. The API is stateless, so that turn is re-sent with every later request
 * anyway; repeating the block per question would only multiply it.
 *
 * `scope` is what lets the Site picker stay enabled mid-thread. Switching it changes
 * which data the assistant needs, and a thread that had only the first scope's rows
 * would answer about the wrong property while the picker claimed otherwise — silent,
 * because a stale answer reads exactly like a current one. So a scope not yet seen
 * in the thread gets its data attached to the next question, and a scope already
 * seen does not get it twice.
 */
export function buildWireMessages(
  history: AskAiTurn[],
  question: string,
  context: string,
  scope: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const past = history
    // An assistant turn left empty by a mid-stream failure is not history — it is
    // debris, and some providers reject an empty assistant message outright.
    .filter((t) => (t.wire ?? t.content).trim().length > 0)
    .map((t) => ({ role: t.role, content: t.wire ?? t.content, scope: t.scope }))

  const alreadySent = past.some((t) => t.role === 'user' && t.scope === scope)
  const preamble =
    past.length === 0
      ? 'Here is the current ranking data.'
      : // Named as a switch so the model prefers this block over the earlier one
        // instead of blending two properties' numbers into one answer.
        'The reader switched the Site selector. Here is the data for the new selection —' +
        ' answer what follows from this, not from the earlier data.'

  return [
    ...past.map(({ role, content }) => ({ role, content })),
    {
      role: 'user' as const,
      content: alreadySent ? question : `${preamble}\n\n${context}\n\n---\n\n${question}`,
    },
  ]
}

/**
 * The assistant's brief.
 *
 * Provider-neutral on purpose — the model is chosen by env var at the endpoint, so
 * nothing here may assume which one is answering.
 *
 * The conciseness paragraph is not filler: current chat models default to long,
 * heavily-sectioned answers, and these render in a narrow chat column. A prompt
 * instruction is the only reliable lever on length.
 */
export const ASK_AI_SYSTEM = [
  'You are the assistant built into the HAZ REVIEWS dashboard, which tracks Google',
  'keyword rankings for affiliate casino-review sites.',
  '',
  'Answer only from the ranking data given to you in the user turn. You have no',
  'database access and no tools. If the data does not contain the answer, say so',
  'plainly rather than estimating — a confident wrong number about a client’s',
  'rankings is worse than "that is not in this import".',
  '',
  'Domain rules that change how the numbers read:',
  '- Position 1 is the best. Lower is better, so a move from 11 to 4 is an',
  '  improvement of 7.',
  '- "NR" means the keyword did not rank in the checked range. It is not a',
  '  position, never average it in, and never report it as a number.',
  '- Tiers are cumulative: every P1 keyword is also inside Top-3 and Top-10. They',
  '  do not sum to the total.',
  '- Each keyword belongs to exactly one group, shown on its row. Groups are',
  '  casino brands or content categories.',
  '',
  'Keep responses focused, brief, and concise. Lead with the answer, then only the',
  'supporting detail that changes what the reader would do next. Answer a simple',
  'question in a sentence or two of prose rather than headers and sections. Use a',
  'short table only for genuinely tabular facts. Do not restate the question, and',
  'do not close by offering further work.',
].join('\n')
