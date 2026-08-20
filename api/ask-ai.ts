// `.js`, not extensionless and not `.ts`. Vercel transpiles each file here
// separately rather than bundling them, and package.json declares
// `"type": "module"`, so Node's own resolver handles this specifier and requires a
// real extension — one naming the EMITTED file. Extensionless resolves fine in dev,
// where Vite resolves it and Node never sees it, then fails in production with
// ERR_MODULE_NOT_FOUND and a 500 on every request. Asserted by
// server/nodeEsm.test.ts, because no build or type-check catches it.
import {
  ASK_AI_FEATURE,
  ASK_AI_RATE_LIMIT,
  isAskAiRequest,
  probeBody,
  readAskAiConfig,
  streamAskAi,
  UNCONFIGURED,
  type AskAiEvent,
} from '../server/askAi.js'
import {
  createRateLimiter,
  endpointGate,
  readEndpointAuthConfig,
} from '../server/endpointAuth.js'

/**
 * PRODUCTION endpoint for Ask AI, and the deployed counterpart to
 * `vite/askAiProxy.ts` — which is `apply: 'serve'` and therefore does not exist in
 * a build at all. Same path, same NDJSON contract, same readiness probe, so
 * `src/lib/assistant.ts` needs no change and stays provider-blind.
 *
 * Exported as NAMED HTTP methods, never as a default. That choice is what selects
 * Vercel's Web signature — a `Request` in and a `Response` out — and a default
 * export would instead select the Node `(req, res)` signature and expect this code
 * to write to `res` itself. Mixing them does not fail loudly: a Web-style body
 * behind a default export receives `(IncomingMessage, ServerResponse)`,
 * `request.method` exists on IncomingMessage so nothing throws, the `Response` is
 * built and returned, and nothing ever writes to the real response — so every
 * request hangs until maxDuration and answers 504. Asserted by
 * server/vercelHandlers.test.ts.
 *
 * The Web signature is also what makes the streaming honest: a `ReadableStream`
 * body streams, where Node-style buffering is what would quietly turn a
 * token-by-token reply into one lump arriving after a long pause.
 *
 * There is no OPTIONS or PUT here on purpose — Vercel answers 405 for any method
 * this module does not export.
 *
 * The key is read from `process.env`, never `VITE_`-prefixed, or it would be
 * inlined into the client bundle and readable in devtools (invariant 27).
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const readEnv = (name: string) => process.env[name] ?? ''

/**
 * Module scope on purpose: a warm instance reuses this between invocations, which
 * is the only reason a per-instance counter counts anything at all. See the
 * limiter's own note on why that makes it a speed bump, not a spend guarantee.
 */
const limiter = createRateLimiter(ASK_AI_RATE_LIMIT)

/**
 * The readiness probe. Answers JSON so the client can tell "this endpoint exists
 * and is configured" from a static host quietly serving index.html for an unknown
 * path — which is what a deployment without this function does, and which a bare
 * status-code check would read as success. Spends no tokens.
 */
export function GET(): Response {
  return new Response(JSON.stringify(probeBody(readAskAiConfig(readEnv))), {
    status: 200,
    headers: JSON_HEADERS,
  })
}

export async function POST(request: Request): Promise<Response> {
  // Before ANY branch that could spend money, and before the key is even read. An
  // anonymous caller must not reach the provider, and must not learn from a POST
  // whether a key is configured either.
  const refusal = await endpointGate({
    auth: readEndpointAuthConfig(readEnv),
    feature: ASK_AI_FEATURE,
    limiter,
    authorizationHeader: request.headers.get('authorization'),
    now: Date.now(),
    fetchImpl: fetch,
  })
  if (refusal) {
    return new Response(JSON.stringify({ error: refusal.error }), {
      status: refusal.status,
      headers: refusal.retryAfterSeconds
        ? { ...JSON_HEADERS, 'Retry-After': String(refusal.retryAfterSeconds) }
        : JSON_HEADERS,
    })
  }

  const config = readAskAiConfig(readEnv)

  // 503 rather than an error event: "not configured" is a different state from
  // "the request failed", and the UI shows a different thing for each.
  if (!config.apiKey) {
    return new Response(JSON.stringify({ error: UNCONFIGURED }), {
      status: 503,
      headers: JSON_HEADERS,
    })
  }

  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Malformed JSON body.' }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }
  if (!isAskAiRequest(parsed)) {
    return new Response(JSON.stringify({ error: 'Expected { system, messages[] }.' }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  // Narrowed before the stream below captures it, so the body cannot close over
  // the un-validated value.
  const askAiRequest = parsed
  const encoder = new TextEncoder()

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskAiEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      // streamAskAi never throws — by this point the 200 and the headers are
      // committed, so a mid-stream failure has to arrive as an event.
      await streamAskAi(config, askAiRequest, send)
      controller.close()
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Conventional opt-out for proxies that buffer a response of unknown length;
      // inert where it is not understood, and cheaper than discovering that an
      // intermediary batched the whole answer into one chunk.
      'X-Accel-Buffering': 'no',
    },
  })
}
