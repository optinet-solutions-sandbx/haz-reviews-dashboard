import { describe, expect, it } from 'vitest'
import type { RankingRecord, Snapshot } from '../types'
import {
  ALL_SITES,
  MAX_CONTEXT_ROWS,
  buildAskAiContext,
  buildOverviewContext,
  buildWireMessages,
  suggestionsFor,
} from './askAiContext'
import type { Site } from './sites'
import { SITES, siteById } from './sites'

function rec(keyword: string, position: string, previous = ''): RankingRecord {
  return {
    keyword,
    market: 'AE',
    position,
    previous,
    change: '',
    urlFound: '',
    searchVolume: '',
    date: '',
  }
}

function snap(rawDate: string, records: RankingRecord[]): Snapshot {
  return { id: `snap-hazreviews-${rawDate}`, site: 'hazreviews', rawDate, displayDate: rawDate, records }
}

const NEW = snap('2026-08-13', [rec('rabona', '1'), rec('cleobetra', '8'), rec('sportuna', 'NR')])
const OLD = snap('2026-08-06', [rec('rabona', '4'), rec('cleobetra', '8'), rec('sportuna', 'NR')])
const haz = siteById('hazreviews')

describe('buildAskAiContext', () => {
  it('names the site and its latest week', () => {
    const ctx = buildAskAiContext([NEW, OLD], haz)
    expect(ctx).toContain('hazreviews.com')
    expect(ctx).toContain('2026-08-13')
  })

  // The model can only answer from what it is given, so every ranking row in the
  // newest snapshot has to appear.
  it('includes every keyword from the newest snapshot', () => {
    const ctx = buildAskAiContext([NEW, OLD], haz)
    for (const kw of ['rabona', 'cleobetra', 'sportuna']) expect(ctx).toContain(kw)
  })

  // Only the newest week. Including every snapshot would repeat each keyword once
  // per import and let the model report a stale position as current.
  it('does not include older snapshots as if they were current', () => {
    const ctx = buildAskAiContext([NEW, OLD], haz)
    // 'rabona' moved 4 -> 1. The old position may appear as movement, never as a
    // second current row.
    expect(ctx.match(/^rabona\b/gm)?.length ?? 0).toBe(1)
  })

  it('reports movement against the previous week', () => {
    const ctx = buildAskAiContext([NEW, OLD], haz)
    expect(ctx).toMatch(/rabona.*4.*1|rabona.*improved/i)
  })

  // Group membership is derived, never stored — the assistant should see the same
  // grouping the UI shows.
  it('labels each keyword with its derived group', () => {
    expect(buildAskAiContext([NEW], haz)).toContain('Rabona')
  })

  // 'NR' is not a number. Presenting it as one would let the model average it in
  // or call it a rank.
  it('keeps NR verbatim rather than coercing it', () => {
    const ctx = buildAskAiContext([NEW], haz)
    expect(ctx).toContain('NR')
    expect(ctx).not.toMatch(/sportuna\s*\|\s*0/)
  })

  it('states plainly when there is no data at all', () => {
    expect(buildAskAiContext([], haz)).toMatch(/no (ranking )?data/i)
  })

  /**
   * A real import is thousands of rows. Without a cap the context would blow past
   * the window on a large site and the request would fail rather than degrade.
   */
  it('caps the row count and says so', () => {
    const many = snap(
      '2026-08-13',
      Array.from({ length: MAX_CONTEXT_ROWS + 50 }, (_, i) => rec(`keyword ${i}`, String((i % 30) + 1))),
    )
    const ctx = buildAskAiContext([many], haz)
    expect(ctx.split('\n').filter((l) => l.startsWith('keyword ')).length).toBe(MAX_CONTEXT_ROWS)
    expect(ctx).toMatch(/truncated|omitted|first 400/i)
  })

  it('summarises the tier counts', () => {
    const ctx = buildAskAiContext([NEW], haz)
    // rabona at 1 -> P1 1, Top-3 1, Top-10 2 (rabona + cleobetra at 8)
    expect(ctx).toMatch(/P1[^\n]*1/)
    expect(ctx).toMatch(/Top-10[^\n]*2/)
  })

  /**
   * Ranking the movers here rather than leaving it to the model. "What moved most"
   * is the most common question this page gets, and it is arithmetic across every
   * row — the thing a chat model is least reliable at and most confident about.
   * Precomputing it also keeps the answer identical to the dashboard's own movers
   * panel, which is the point of §3 of the architecture: one derivation, not two.
   */
  it('ranks the biggest movers so the model does not have to', () => {
    const now = snap('2026-08-13', [
      rec('kingmaker slots', '5'),
      rec('cleobetra', '2'),
      rec('rabona', '1'),
      rec('sportuna', '30'),
    ])
    const then = snap('2026-08-06', [
      rec('kingmaker slots', '12'),
      rec('cleobetra', '8'),
      rec('rabona', '2'),
      rec('sportuna', '10'),
    ])
    const ctx = buildAskAiContext([now, then], haz)
    const movers = ctx.slice(ctx.indexOf('Biggest'))
    // +7 beats +6, so kingmaker slots has to be named before cleobetra.
    expect(movers.indexOf('kingmaker slots')).toBeLessThan(movers.indexOf('cleobetra'))
    expect(movers).toContain('sportuna')
    expect(ctx).toMatch(/kingmaker slots[^\n]*7/)
  })

  it('omits the movers block when there is nothing to compare against', () => {
    expect(buildAskAiContext([NEW], haz)).not.toContain('Biggest')
  })
})

/**
 * The all-sites overview.
 *
 * A second site is fabricated here rather than registered, the same trick
 * `sites.test.ts` uses: only one site exists in the registry today, so without an
 * injected one every cross-site assertion would pass on a single row and prove
 * nothing about the case this function exists for.
 */
describe('buildOverviewContext', () => {
  const HAZ = siteById('hazreviews')
  const OTHER: Site = {
    id: 'secondsite',
    name: 'SECONDSITE',
    slug: 'secondsite',
    domain: 'secondsite.com',
    color: '#123456',
  }
  const registry = [HAZ, OTHER]

  const hazNow = snap('2026-08-13', [rec('rabona', '1'), rec('cleobetra', '4')])
  const hazThen = snap('2026-08-06', [rec('rabona', '3'), rec('cleobetra', '4')])
  const other = (rawDate: string, records: RankingRecord[]): Snapshot => ({
    ...snap(rawDate, records),
    id: `snap-secondsite-${rawDate}`,
    site: 'secondsite',
  })
  const otherNow = other('2026-08-13', [rec('bet republic', '20'), rec('sportuna', 'NR')])
  const otherThen = other('2026-08-06', [rec('bet republic', '9'), rec('sportuna', 'NR')])
  const all = [hazNow, hazThen, otherNow, otherThen]

  it('names every registered site', () => {
    const ctx = buildOverviewContext(all, registry)
    expect(ctx).toContain('hazreviews.com')
    expect(ctx).toContain('secondsite.com')
  })

  /**
   * States the site count outright, because leaving it to be counted from the blocks
   * gets it wrong. Verified: asked "how many sites are tracked?" over a one-site
   * overview, the model answered "ten" — it had read the per-site keyword count as a
   * site count. Every number a reader might ask for directly belongs in the text.
   */
  it('states how many sites the overview covers', () => {
    expect(buildOverviewContext(all, registry)).toMatch(/2 sites/i)
    expect(buildOverviewContext(all, [HAZ])).toMatch(/1 site\b/i)
  })

  /**
   * The whole point of an overview: one site's numbers must not be attributed to
   * another. A rollup that merges them silently is invariant 23's failure mode.
   */
  it('keeps each site’s figures under its own heading', () => {
    const ctx = buildOverviewContext(all, registry)
    // Anchored on the block HEADING, not the bare name: the header also lists every
    // site name, so a bare-name search would slice inside that line instead.
    const hazBlock = ctx.slice(
      ctx.indexOf('HAZREVIEWS (hazreviews.com)'),
      ctx.indexOf('SECONDSITE (secondsite.com)'),
    )
    expect(hazBlock).toContain('rabona')
    expect(hazBlock).not.toContain('bet republic')
  })

  it('reports movement per site', () => {
    const ctx = buildOverviewContext(all, registry)
    // rabona 3 -> 1 improved 2; bet republic 9 -> 20 dropped 11.
    expect(ctx).toMatch(/rabona[^\n]*2/)
    expect(ctx).toMatch(/bet republic[^\n]*11/)
  })

  // A site with nothing imported is stated, not omitted — invariant 17's rule.
  // Silently dropping it would read as "that site has no problems".
  it('says so when a registered site has no data', () => {
    const ctx = buildOverviewContext([hazNow], registry)
    expect(ctx.slice(ctx.indexOf('SECONDSITE'))).toMatch(/no data|nothing imported|not imported/i)
  })

  /**
   * Overview mode carries summaries, not every keyword — across sites that would
   * blow the window. It has to SAY so, or the model answers keyword-level questions
   * from a list it cannot see.
   */
  it('tells the model that keyword rows are not included', () => {
    expect(buildOverviewContext(all, registry)).toMatch(/pick a single site|per-keyword|keyword-level/i)
  })
})

describe('ALL_SITES', () => {
  /**
   * The property that makes the sentinel safe, whatever its literal value.
   * `siteById` falls back to the default site for an unknown id (invariant 24), so a
   * sentinel that collided with a registered id would answer one site's numbers as
   * though they were the portfolio's — with no error to notice. Asserted against the
   * live registry so registering a site can never quietly create the collision.
   */
  it('never collides with a registered site id', () => {
    expect(SITES.some((s) => s.id === ALL_SITES)).toBe(false)
  })

  it('selects the overview rather than a single site', () => {
    expect(suggestionsFor(ALL_SITES)).not.toEqual(suggestionsFor('hazreviews'))
  })
})

describe('suggestionsFor', () => {
  /**
   * Every suggestion must be answerable from the context it is offered with. A chip
   * that reliably returns "that is not in this import" spends a request to tell the
   * user the feature is empty — worse than not offering it.
   */
  it('offers questions in both modes', () => {
    expect(suggestionsFor(ALL_SITES).length).toBeGreaterThan(0)
    expect(suggestionsFor('hazreviews').length).toBeGreaterThan(0)
  })

  it('does not ask a single site about other sites, or the overview about "this site"', () => {
    for (const s of suggestionsFor('hazreviews')) expect(s).not.toMatch(/all sites|across (the )?sites|portfolio/i)
    for (const s of suggestionsFor(ALL_SITES)) expect(s).not.toMatch(/this site/i)
  })

  /**
   * Guards the mismatch that motivated swapping three of the reference chips: this
   * dashboard holds keyword positions only, so a suggestion naming domain rating,
   * PageSpeed, traffic or QA promises data that does not exist here.
   */
  it('never offers a question the imported data cannot answer', () => {
    const absent = /domain rating|referring domain|pagespeed|page speed|lighthouse|backlink|traffic|uptime|QA check/i
    for (const mode of [ALL_SITES, 'hazreviews']) {
      for (const s of suggestionsFor(mode)) expect(s).not.toMatch(absent)
    }
  })
})

/**
 * The wire payload.
 *
 * Tested because the failure is invisible from the UI: a thread whose history has
 * lost the data still renders perfectly and still gets fluent answers — they are
 * just invented. Nothing on screen distinguishes that from a working assistant.
 */
describe('buildWireMessages', () => {
  const CONTEXT = 'Site: HAZREVIEWS\nrabona | AE | 1 | Rabona'
  const OTHER_CONTEXT = 'Site: SECONDSITE\nbet republic | AE | 20 | BetRepublic'

  it('carries the data with the first question', () => {
    const wire = buildWireMessages([], 'what moved?', CONTEXT, 'hazreviews')
    expect(wire).toHaveLength(1)
    expect(wire[0].role).toBe('user')
    expect(wire[0].content).toContain(CONTEXT)
    expect(wire[0].content).toContain('what moved?')
  })

  /**
   * The Site picker stays enabled mid-thread, which is only safe if the switch
   * carries data. Without this the picker would name one scope while the model kept
   * answering from the scope it was handed on turn one — and the reader cannot tell,
   * because a stale answer still looks like an answer.
   */
  it('attaches the new scope’s data when the scope changes mid-thread', () => {
    const first = buildWireMessages([], 'q1', CONTEXT, 'hazreviews')
    const wire = buildWireMessages(
      [
        { role: 'user', content: 'q1', wire: first[0].content, scope: 'hazreviews' },
        { role: 'assistant', content: 'a1' },
      ],
      'and this one?',
      OTHER_CONTEXT,
      'secondsite',
    )
    expect(wire).toHaveLength(3)
    expect(wire[2].content).toContain('bet republic')
    expect(wire[2].content).toContain('and this one?')
  })

  // Switching back must not re-attach a block the thread already carries.
  it('does not resend data for a scope already in the thread', () => {
    const first = buildWireMessages([], 'q1', CONTEXT, 'hazreviews')
    const second = buildWireMessages(
      [
        { role: 'user', content: 'q1', wire: first[0].content, scope: 'hazreviews' },
        { role: 'assistant', content: 'a1' },
      ],
      'q2',
      OTHER_CONTEXT,
      'secondsite',
    )
    const wire = buildWireMessages(
      [
        { role: 'user', content: 'q1', wire: first[0].content, scope: 'hazreviews' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2', wire: second[2].content, scope: 'secondsite' },
        { role: 'assistant', content: 'a2' },
      ],
      'q3',
      CONTEXT,
      'hazreviews',
    )
    expect(wire[4].content).toBe('q3')
  })

  /**
   * The bug this function exists to prevent: the transcript on screen holds the
   * bare question, so replaying THAT as history drops the data on turn two and
   * every turn after it. The model then answers a data question with no data.
   */
  it('keeps the data in history on later turns', () => {
    const first = buildWireMessages([], 'what moved?', CONTEXT, 'hazreviews')
    const wire = buildWireMessages(
      [
        { role: 'user', content: 'what moved?', wire: first[0].content, scope: 'hazreviews' },
        { role: 'assistant', content: 'rabona improved.' },
      ],
      'how many are not ranking?',
      CONTEXT,
      'hazreviews',
    )
    expect(wire).toHaveLength(3)
    expect(wire[0].content).toContain('rabona | AE | 1')
    expect(wire[2].content).toBe('how many are not ranking?')
  })

  // Once, not once per turn: the API is stateless, so the first turn is re-sent
  // with every request anyway — repeating the block would just multiply it.
  it('sends the data exactly once across the whole payload', () => {
    const first = buildWireMessages([], 'q1', CONTEXT, 'hazreviews')
    const wire = buildWireMessages(
      [
        { role: 'user', content: 'q1', wire: first[0].content, scope: 'hazreviews' },
        { role: 'assistant', content: 'a1' },
      ],
      'q2',
      CONTEXT,
      'hazreviews',
    )
    const occurrences = wire.filter((m) => m.content.includes('rabona | AE | 1')).length
    expect(occurrences).toBe(1)
  })

  /**
   * A turn that failed mid-stream leaves an empty assistant bubble behind. Sending
   * it back verbatim asks the provider to accept an empty assistant message, which
   * is at best noise in the history and at worst a 400.
   */
  it('drops an empty assistant turn left behind by a failure', () => {
    const wire = buildWireMessages(
      [
        { role: 'user', content: 'q1', wire: 'q1 with data', scope: 'hazreviews' },
        { role: 'assistant', content: '' },
      ],
      'q2',
      CONTEXT,
      'hazreviews',
    )
    expect(wire.map((m) => m.content)).toEqual(['q1 with data', 'q2'])
  })
})
