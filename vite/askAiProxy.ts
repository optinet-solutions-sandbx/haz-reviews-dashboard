import { loadEnv, type Plugin } from 'vite'
import {
  isAskAiRequest,
  probeBody,
  readAskAiConfig,
  streamAskAi,
  UNCONFIGURED,
  type AskAiEvent,
} from '../server/askAi'

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
      const config = readAskAiConfig((name) => env[name] || process.env[name] || '')

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

        // 503 rather than an error event: "not configured" is a different state
        // from "the request failed", and the UI shows a different thing for each.
        if (!config.apiKey) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: UNCONFIGURED }))
          return
        }

        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })

        req.on('end', () => {
          void (async () => {
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
      })
    },
  }
}
