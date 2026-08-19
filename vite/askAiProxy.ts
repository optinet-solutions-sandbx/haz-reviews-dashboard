import { loadEnv, type Plugin } from 'vite'
import {
  isAskAiRequest,
  probeBody,
  readAskAiConfig,
  streamAskAi,
  UNCONFIGURED,
  type AskAiEvent,
} from '../server/askAi'
import {
  ASK_AI_RATE_LIMIT,
  askAiGate,
  createRateLimiter,
  readAskAiAuthConfig,
} from '../server/askAiAuth'

/**
 * DEV-SERVER ONLY endpoint that lets Ask AI talk to the provider without ever
 * putting an API key in the browser.
 *
 * This exists because of a hard constraint: Vite inlines every `VITE_`-prefixed
 * variable into the client bundle, so an OpenAI key placed there is readable in
 * devtools by anyone who loads the page — an organisation-scoped credential that
 * can be extracted and billed against. There is no browser-side way around that,
 * and `dangerouslyAllowBrowser` is named for a reason.
 *
 * So the key is read here, in Node, from `OPENAI_API_KEY` — deliberately WITHOUT
 * the `VITE_` prefix, which is what keeps it out of the bundle. The browser only
 * ever sees this endpoint.
 *
 * `apply: 'serve'` means none of this exists in a production build. The deployed
 * counterpart is `api/ask-ai.ts`, a real function at the same path; everything
 * either of them does with the provider lives in `server/askAi.ts`, so the two
 * cannot drift apart on the failure cases that arrive as HTTP 200.
 */
export function askAiProxy(): Plugin {
  return {
    name: 'haz-ask-ai-proxy',
    // Never present in a production build.
    apply: 'serve',

    configureServer(server) {
      // Empty prefix so NON-VITE_ variables are visible. This runs in Node only;
      // nothing here reaches the client graph.
      const env = loadEnv(server.config.mode, process.cwd(), '')
      const read = (name: string) => env[name] || process.env[name] || ''
      const config = readAskAiConfig(read)
      const authConfig = readAskAiAuthConfig(read)
      // One limiter for the life of the dev server, so its counts actually persist
      // across requests the way a warm serverless instance's do.
      const limiter = createRateLimiter(ASK_AI_RATE_LIMIT)

      server.middlewares.use('/api/ask-ai', (req, res) => {
        const send = (event: AskAiEvent) => res.write(`${JSON.stringify(event)}\n`)

        // GET is the readiness probe. It answers JSON so the client can tell
        // "this endpoint exists and is configured" from a static host quietly
        // serving index.html for an unknown path — which a bare status-code check
        // would read as success. The model is reported so a typo in OPENAI_MODEL
        // is visible rather than surfacing later as an opaque provider 404.
        if (req.method === 'GET') {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(probeBody(config)))
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }

        void (async () => {
          // The same gate, in the same order, as api/ask-ai.ts — through one shared
          // call rather than two hand-written sequences, so dev cannot drift into
          // permitting what production refuses.
          const refusal = await askAiGate({
            auth: authConfig,
            limiter,
            authorizationHeader: req.headers.authorization,
            now: Date.now(),
            fetchImpl: fetch,
          })
          if (refusal) {
            res.statusCode = refusal.status
            res.setHeader('Content-Type', 'application/json')
            if (refusal.retryAfterSeconds) {
              res.setHeader('Retry-After', String(refusal.retryAfterSeconds))
            }
            res.end(JSON.stringify({ error: refusal.error }))
            return
          }

          // 503 rather than an error event: "not configured" is a different state
          // from "the request failed", and the UI shows a different thing for each.
          if (!config.apiKey) {
            res.statusCode = 503
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: UNCONFIGURED }))
            return
          }

          // Only now read the body. Awaiting the gate first loses nothing: the
          // request stream stays paused until something listens for 'data', so the
          // bytes are still there afterwards.
          let body: string
          try {
            body = await new Promise<string>((resolve, reject) => {
              let acc = ''
              req.on('data', (chunk) => {
                acc += chunk
              })
              req.on('end', () => resolve(acc))
              req.on('error', reject)
            })
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Could not read the request body.' }))
            return
          }

          let parsed: unknown
          try {
            parsed = JSON.parse(body)
          } catch {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Malformed JSON body.' }))
            return
          }
          if (!isAskAiRequest(parsed)) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Expected { system, messages[] }.' }))
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')

          try {
            await streamAskAi(config, parsed, send)
          } finally {
            res.end()
          }
        })()
      })
    },
  }
}
