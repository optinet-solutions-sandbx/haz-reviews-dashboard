import { Menu } from 'lucide-react'

/**
 * The mobile header: the drawer trigger and the wordmark, on a filled navy bar.
 *
 * It exists only below `md`, where the rail is a drawer parked at
 * `-translate-x-full` and this button is the only thing that opens it. Above
 * `md` there is nothing left to render — titles moved into the pages
 * (`PageHeader`), and the theme toggle was removed — so the whole header is
 * `md:hidden` rather than an empty `banner` landmark a screen reader would
 * still announce.
 *
 * NAVY, NOT `--surface`. The rail carries the brand on desktop; below `md` the
 * rail is hidden, so a neutral bar would leave the app with no identity at all
 * on the only viewport where the whole chrome collapses to one strip. The three
 * brand hues are theme-independent by design, so this bar stays navy in dark
 * mode — the same rule the HZ tile and the step badges follow.
 *
 * The wordmark is the rail's, not a second mark: the pills carry the two azure
 * hues because navy-on-navy would be invisible, and they are `aria-hidden`
 * because they are decoration beside a name that is already text.
 *
 * `aria-expanded` is why the open state has to be a prop. Without it the button
 * announces as a plain button and nothing tells a screen-reader user that the
 * drawer it controls is already open — `aria-controls` alone only names the
 * target.
 */
interface TopbarProps {
  /** Whether the drawer this button controls is currently open. */
  open: boolean
  onOpenMobileNav: () => void
}

export function Topbar({ open, onOpenMobileNav }: TopbarProps) {
  return (
    <header
      className="flex shrink-0 items-center gap-3 px-4 py-3 text-white md:hidden"
      style={{
        background: 'var(--brand-navy)',
        borderBottom: '1px solid var(--brand-navy-deep)',
      }}
    >
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        aria-controls="hz-rail"
        aria-expanded={open}
        className="topbar-trigger cursor-pointer rounded-md p-1.5"
      >
        <Menu size={22} />
      </button>

      <span className="flex items-center gap-2.5">
        <span aria-hidden className="flex items-center gap-1">
          <span
            className="h-[18px] w-1.5 rounded-full"
            style={{ background: 'var(--brand-blue)' }}
          />
          <span
            className="h-[18px] w-1.5 rounded-full"
            style={{ background: 'var(--brand-light)' }}
          />
        </span>
        {/* leading-none so the cap height, not the line box, sets the bar's
            height — otherwise the wordmark pushes the strip taller than the
            34px button beside it. */}
        <span className="font-display text-[15px] font-bold leading-none tracking-widest">
          HAZ REVIEWS
        </span>
      </span>
    </header>
  )
}
