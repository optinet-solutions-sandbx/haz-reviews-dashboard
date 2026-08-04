import { beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_KEY, loadTheme, toggleTheme } from './theme'

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
    // Private-mode browsers throw on access. A corrupted or unavailable store
    // must not brick first paint.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('private mode')
      },
      setItem: () => {
        throw new Error('private mode')
      },
    })
    expect(loadTheme()).toBe('light')
  })
})
