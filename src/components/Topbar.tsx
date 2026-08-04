import { LogOut, Menu, Moon, Sun } from 'lucide-react'
import type { Theme } from '../lib/theme'

interface TopbarProps {
  title: string
  subtitle: string
  theme: Theme
  onToggleTheme: () => void
  onOpenMobileNav: () => void
  email: string | null
  onSignIn: () => void
  onSignOut: () => void
}

export function Topbar({
  title,
  subtitle,
  theme,
  onToggleTheme,
  onOpenMobileNav,
  email,
  onSignIn,
  onSignOut,
}: TopbarProps) {
  return (
    <header
      className="flex h-16 min-h-[64px] shrink-0 flex-col"
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border-2)' }}
    >
      {/* Accent strip: three equal bands, navy → blue → light. */}
      <div className="flex h-[3px] w-full shrink-0" aria-hidden>
        <div className="flex-1" style={{ background: 'var(--brand-navy)' }} />
        <div className="flex-1" style={{ background: 'var(--brand-blue)' }} />
        <div className="flex-1" style={{ background: 'var(--brand-light)' }} />
      </div>

      <div className="flex flex-1 items-center gap-3 px-3 sm:px-7">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          className="sm:hidden"
          style={{ color: 'var(--muted)' }}
        >
          <Menu size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <h1
            className="truncate font-display text-[18px] font-semibold leading-tight sm:text-[26px]"
            style={{ color: 'var(--ink)' }}
          >
            {title}
          </h1>
          <p className="truncate text-[11px]" style={{ color: 'var(--muted)' }}>
            {subtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
        >
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>

        {email ? (
          <div className="flex shrink-0 items-center gap-2">
            <span
              className="hidden max-w-[180px] truncate font-mono text-[10px] sm:block"
              style={{ color: 'var(--muted)' }}
              title={email}
            >
              {email}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white"
            style={{ background: 'var(--btn-ink)' }}
          >
            Sign in
          </button>
        )}
      </div>
    </header>
  )
}
