import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Throw at module load rather than letting every query fail later with a
// confusing 401. Fail fast, naming the variable that is actually missing.
if (!url) {
  throw new Error('VITE_SUPABASE_URL is not set. Copy .env.example to .env.local.')
}
if (!anonKey) {
  throw new Error('VITE_SUPABASE_ANON_KEY is not set. Copy .env.example to .env.local.')
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Required: the password-reset link delivers its tokens in the URL hash.
    detectSessionInUrl: true,
  },
})
