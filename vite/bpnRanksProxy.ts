import { loadEnv, type Plugin } from 'vite'
import { BPN_RATE_LIMIT, readBpnConfig, serveBpnRanks } from '../server/bpnRanks'
import { createRateLimiter, readEndpointAuthConfig } from '../server/endpointAuth'

/**
 * DEV-SERVER host for the BPN ranks import, at the same path the deployed function
 * serves: `/api/bpn-ranks`.
 *
 * A signature adapter and nothing else — Connect's `(req, res)` in, JSON out. Every
 * decision lives in `server/bpnRanks.ts`, which is what stops dev from permitting
 * what production refuses.
 *
 * This exists for two independent reasons, either sufficient on its own. Vite inlines
 * every `VITE_`-prefixed variable into the client bundle, so `SITES_API_KEY` has to
 * be read here in Node or it would be readable in devtools by anyone who loads the
 * page (invariant 27). And the vendor is a third-party origin, so a direct browser
 * call is refused by CORS whatever we do about the key.
 *
 * `apply: 'serve'` means none of this exists in a production build.
 */
export function bpnRanksProxy(): Plugin {
  return {
    name: 'haz-bpn-ranks-proxy',
    // Never present in a production build.
    apply: 'serve',

    configureServer(server) {
      // Empty prefix so NON-VITE_ variables are visible. This runs in Node only;
      // nothing here reaches the client graph.
      const env = loadEnv(server.config.mode, process.cwd(), '')
      const read = (name: string) => env[name] || process.env[name] || ''
      const config = readBpnConfig(read)
      const authConfig = readEndpointAuthConfig(read)
      // One limiter for the life of the dev server, so its counts actually persist
      // across requests the way a warm serverless instance's do.
      const limiter = createRateLimiter(BPN_RATE_LIMIT)

      server.middlewares.use('/api/bpn-ranks', (req, res) => {
        void (async () => {
          // `req.url` here is the path AFTER the mount prefix, and it can be as bare
          // as '/'. A dummy origin makes it parseable without caring which — only
          // the query is read, and the real host is irrelevant to that.
          const params = new URL(req.url ?? '/', 'http://localhost').searchParams

          const result = await serveBpnRanks({
            method: req.method,
            params,
            authorizationHeader: req.headers.authorization,
            config,
            auth: authConfig,
            limiter,
            now: Date.now(),
            fetchImpl: fetch,
          })

          res.statusCode = result.status
          for (const [name, value] of Object.entries(result.headers)) {
            res.setHeader(name, value)
          }
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(result.body))
        })()
      })
    },
  }
}
