import OpenAI from 'openai'
import { loadEnv, type Plugin } from 'vite'

/**
 * DEV-SERVER ONLY endpoint that lets Ask AI talk to OpenAI without ever putting an
 * API key in the browser.
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
 * `apply: 'serve'` means none of this exists in a production build. A deployed
 * bundle has no `/api/ask-ai`, so the assistant reports itself offline until a
 * real server-side endpoint (a Supabase Edge Function is the natural home, given
 * the stack) is deployed at the same path.
 */

/**
 * Model and base URL are configuration, not constants. The model in particular is
 * read at request time rather than compiled in: choosing a different one is then
 * an `.env.local` edit, not a code change, which is the whole reason this endpoint
 * reports the resolved name back to the client.
 */
const DEFAULT_MODEL = 'gpt-4o'

/**
 * Generous, because it is a ceiling and not a target — the system prompt is what
 * keeps answers short. It has to be generous: on a reasoning model this budget
 * covers hidden reasoning tokens too, so a tight cap can spend the entire
 * allowance thinking and return an empty answer. Truncation is reported rather
 * than hidden, so hitting it looks like hitting it.
 */
const MAX_COMPLETION_TOKENS = 16384

/** Line-delimited JSON, so the client can distinguish text from failure. */
type Event =
  | { type: 'text'; text: string }
  | { type: 'refusal'; reason: string | null }
  | { type: 'truncated' }
  | { type: 'error'; message: string }
  | { type: 'done' }

interface AskAiRequest {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

function isAskAiRequest(value: unknown): value is AskAiRequest {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.system === 'string' &&
    Array.isArray(v.messages) &&
    v.messages.every(
      (m) =>
        typeof m === 'object' &&
        m !== null &&
        ((m as Record<string, unknown>).role === 'user' ||
          (m as Record<string, unknown>).role === 'assistant') &&
        typeof (m as Record<string, unknown>).content === 'string',
    )
  )
}

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

      const apiKey = read('OPENAI_API_KEY')
      const model = read('OPENAI_MODEL') || DEFAULT_MODEL
      // Optional: lets the same endpoint serve Azure OpenAI or a compatible proxy
      // without a code change.
      const baseURL = read('OPENAI_BASE_URL') || undefined

      const UNCONFIGURED =
        'OPENAI_API_KEY is not set. Add it to .env.local WITHOUT a VITE_ prefix, then restart the dev server.'

      server.middlewares.use('/api/ask-ai', (req, res) => {
        const send = (event: Event) => res.write(`${JSON.stringify(event)}\n`)

        // GET is the readiness probe. It answers JSON so the client can tell
        // "this endpoint exists and is configured" from a static host quietly
        // serving index.html for an unknown path — which is what a production
        // build does, and which a bare status-code check would read as success.
        // The model is reported so a typo in OPENAI_MODEL is visible in the UI
        // rather than surfacing later as an opaque 404 from the provider.
        if (req.method === 'GET') {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify(
              apiKey ? { assistant: 'ready', model } : { assistant: 'unconfigured', reason: UNCONFIGURED },
            ),
          )
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }

        // 503 rather than an error event: "not configured" is a different state
        // from "the request failed", and the UI shows a different thing for each.
        if (!apiKey) {
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
              const client = new OpenAI({ apiKey, baseURL })

              // Streaming because the answer renders token by token in a chat
              // panel, and because a large token ceiling on a non-streaming
              // request risks an HTTP timeout.
              const stream = await client.chat.completions.create({
                model,
                stream: true,
                // `max_completion_tokens`, not the deprecated `max_tokens` — the
                // latter is rejected outright by the reasoning models.
                max_completion_tokens: MAX_COMPLETION_TOKENS,
                // No `temperature`: several current models accept only the
                // default and 400 on anything else, and this task has no reason
                // to want a different one.
                messages: [
                  { role: 'system', content: parsed.system },
                  ...parsed.messages,
                ],
              })

              // A refusal streams as its own delta field rather than as content,
              // so it has to be accumulated separately or it is lost entirely.
              let refusal = ''
              let finish: string | null = null

              for await (const chunk of stream) {
                const choice = chunk.choices[0]
                if (!choice) continue
                if (choice.delta?.content) send({ type: 'text', text: choice.delta.content })
                if (choice.delta?.refusal) refusal += choice.delta.refusal
                if (choice.finish_reason) finish = choice.finish_reason
              }

              // Checked before calling the reply complete: all three of these
              // arrive with HTTP 200, so code that streams content and stops
              // reports a blocked or half-finished answer as a success.
              if (refusal) send({ type: 'refusal', reason: refusal })
              else if (finish === 'content_filter') send({ type: 'refusal', reason: 'content filter' })
              else if (finish === 'length') send({ type: 'truncated' })

              send({ type: 'done' })
            } catch (err) {
              // The stream is already open with a 200, so a failure has to arrive
              // as an event rather than a status code. Provider errors land here
              // too — a bad key, or a model the account cannot reach — and their
              // messages are the diagnostic, so they are passed through.
              send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
            } finally {
              res.end()
            }
          })()
        })
      })
    },
  }
}
