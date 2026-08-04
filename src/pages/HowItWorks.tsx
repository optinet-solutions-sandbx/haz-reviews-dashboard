const SECTIONS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: 'The five stat cards do not add up to the total',
    body: (
      <>
        Improved, Dropped, Unchanged and Not ranking are mutually exclusive and do sum to the
        total. <strong>Top 3 overlaps them</strong> — a keyword sitting at position 2 that also
        moved up counts as both Improved and Top 3. That is deliberate: you want to see both facts
        about the same keyword, not pick one.
      </>
    ),
  },
  {
    title: '"NR" and a blank cell mean different things',
    body: (
      <>
        <strong>NR</strong> means the keyword was checked and was not found in the results.{' '}
        <strong>Blank</strong> (—) means it was never checked in that market. Both look like
        "no ranking" but only the first is a result, and the difference matters when you are
        deciding whether a page failed or was simply not measured.
      </>
    ),
  },
  {
    title: 'Movement compares snapshots, not the export column',
    body: (
      <>
        Where a previous snapshot exists, the arrow is calculated by comparing this snapshot's
        position with the last one — not by reading the export's own change column. So a ranking
        that genuinely did not move shows no colour even if the spreadsheet claimed a change. A
        keyword that appears for the first time is marked <strong>new</strong> rather than being
        painted as an improvement.
      </>
    ),
  },
  {
    title: 'Search volume carries forward until you overwrite it',
    body: (
      <>
        Many exports omit volume, so a value you type once fills forward into later snapshots that
        have none. It never overwrites a real value from the file. Clear it on the snapshot where
        you entered it and the carry stops there — the inheritance is recalculated on every render
        rather than baked into the stored data.
      </>
    ),
  },
  {
    title: 'Keyword groups are derived, so fixing one fixes history',
    body: (
      <>
        A keyword's group is worked out from its text every time the page renders, using the
        registry in <code>src/lib/groups.ts</code>. Nothing is stored on the record. Add a brand or
        an alias and <strong>every past snapshot re-groups too</strong> — no backfill, no
        migration. Keywords that match nothing land in <strong>Other</strong> and are listed after
        each import so the registry can be improved.
      </>
    ),
  },
  {
    title: 'Nothing is ever silently dropped',
    body: (
      <>
        An unmatched keyword goes to Other. A market that is not in the configured column order is
        appended to the right and flagged in the import summary. Rows with no keyword at all are
        skipped and counted. If a number here looks low, the import summary will say why rather
        than leaving you to guess.
      </>
    ),
  },
  {
    title: 'Re-importing the same date replaces it',
    body: (
      <>
        Snapshots are identified by their date, so importing the same day twice replaces rather
        than duplicates — you will be asked to confirm first. That also means a failed import can
        simply be run again. Manual volume edits on a replaced snapshot are lost, which is why the
        confirmation says so.
      </>
    ),
  },
]

export function HowItWorks() {
  return (
    <div className="animate-fade-up flex max-w-[720px] flex-col gap-3">
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
        This dashboard tracks Google keyword positions for <strong>hazreviews.com</strong> over
        time. Each import is stored as an immutable dated snapshot, so history never changes
        underneath you. Below are the rules that are not obvious from the screen — every one of
        them looks like a bug until you know it.
      </p>

      {SECTIONS.map(({ title, body }) => (
        <section
          key={title}
          className="rounded-xl p-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border-2)' }}
        >
          <h2 className="font-display text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
            {title}
          </h2>
          <p className="pt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {body}
          </p>
        </section>
      ))}

      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border-3)' }}
      >
        <h2 className="font-display text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
          Importing
        </h2>
        <ol
          className="list-decimal pt-1.5 pl-4 text-[12px] leading-relaxed"
          style={{ color: 'var(--text-2)' }}
        >
          <li>Click Import Data. If you are signed out, sign in first and it reopens.</li>
          <li>Drop an .xlsx, .xls or .csv export. Only a Keyword column is required.</li>
          <li>Check the detected snapshot date and correct it if the export carried none.</li>
          <li>Review the summary — especially the unmatched keyword list.</li>
        </ol>
      </section>
    </div>
  )
}
