import { describe, expect, it } from 'vitest'
import { resolveDevOverride } from './devOverrides'

describe('resolveDevOverride', () => {
  // THE test that matters. The flag is a convenience for a machine with no
  // Supabase project behind it; if a production bundle could honour it, the
  // convenience would ship as an admin bypass.
  it('is ignored outside a dev build even when the flag is set', () => {
    expect(resolveDevOverride({ DEV: false, VITE_DEV_FORCE_ADMIN: 'true' })).toBeNull()
  })

  it('is off unless the flag is exactly true', () => {
    expect(resolveDevOverride({ DEV: true })).toBeNull()
    expect(resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: 'false' })).toBeNull()
    // A present-but-empty var is how a commented-out line usually reads.
    expect(resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: '' })).toBeNull()
    expect(resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: '1' })).toBeNull()
  })

  it('grants admin with a placeholder address in a dev build', () => {
    expect(resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: 'true' })).toEqual({
      isAdmin: true,
      email: 'dev@localhost',
    })
  })

  it('uses a supplied address so the footer can be checked with a real length', () => {
    expect(
      resolveDevOverride({
        DEV: true,
        VITE_DEV_FORCE_ADMIN: 'true',
        VITE_DEV_FORCE_EMAIL: 'jose@optinetsolutions.com',
      }),
    ).toEqual({ isAdmin: true, email: 'jose@optinetsolutions.com' })
  })

  it('falls back to the placeholder for a blank address', () => {
    expect(
      resolveDevOverride({ DEV: true, VITE_DEV_FORCE_ADMIN: 'true', VITE_DEV_FORCE_EMAIL: '' }),
    ).toEqual({ isAdmin: true, email: 'dev@localhost' })
  })
})
