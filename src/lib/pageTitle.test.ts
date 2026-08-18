import { describe, expect, it } from 'vitest'
import { BASE_TITLE, pageTitle } from './pageTitle'

describe('pageTitle', () => {
  it('appends the base title after the page label', () => {
    expect(pageTitle('How It Works')).toBe('How It Works · Haz Reviews')
  })

  it('does not name a single property as the app', () => {
    // The base title is the app's name, never a site's — even now that the sole
    // registered property shares that name, which is when the distinction is
    // easiest to lose. If this ever reads like a brand claim ("Haz Reviews
    // Casino") the lead paragraph is wrong too.
    expect(BASE_TITLE).toBe('Haz Reviews')
  })

  it('emits the base alone rather than a dangling separator', () => {
    // A page that passes '' would otherwise title the tab '· Haz Reviews'.
    expect(pageTitle('')).toBe('Haz Reviews')
    expect(pageTitle('   ')).toBe('Haz Reviews')
  })

  it('trims the label so the separator spacing stays single', () => {
    expect(pageTitle('  Rankings  ')).toBe('Rankings · Haz Reviews')
  })
})
