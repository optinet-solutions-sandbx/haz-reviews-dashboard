export type Theme = 'light' | 'dark'

export const THEME_KEY = 'hz_theme'

/**
 * Reads the stored theme.
 *
 * Falls back to light on anything unexpected. Private-mode browsers throw on
 * localStorage access, and a corrupted value must not brick first paint —
 * every read of this store is wrapped for that reason.
 */
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

/**
 * Applies the theme to <html> and persists it.
 *
 * Called from main.tsx BEFORE the first React render. Doing this inside a
 * component would render one light frame for every dark-mode user.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Persistence is a nicety; the class is already applied either way.
  }
}
