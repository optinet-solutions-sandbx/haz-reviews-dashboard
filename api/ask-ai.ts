import {
  isAskAiRequest,
  probeBody,
  readAskAiConfig,
  streamAskAi,
  UNCONFIGURED,
  type AskAiEvent,
} from '../server/askAi'

/**
 * PRODUCTION endpoint for Ask AI, and the deployed counterpart to
 * `vite/askAiProxy.ts` — which is `apply: 'serve'` and therefore does not exist
 * in a build at all. Same path, same NDJSON contract, same readiness probe, so
 * `src/lib/assistant.ts` needs no change and stays provider-blind.
 *
 * Written against the Web `Request`/`Response` signature rather than the Node
 * `(req, res)` one specifically for the streaming: a `ReadableStream` body is the
 * documented way to stream from a Vercel function, where Node-style buffering
 * behaviour is the thing that would quietly turn a token-by-token reply into one
 * lump arriving after a long pause.
 *
 * The key is read from `process.env` here — never `VITE_`-prefixed, or it would be
 * inlined into the client bundle and readable in devtools (invariant 27).
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export default async function handler(request: Request): Promise<Response> {
  const config = readAskAiConfig((name) => process.env[name] ?? '')

  // GET is the readiness probe. It answers JSON so the client can tell "this
  // endpoint exists and is configured" from a static host quietly serving
  // index.html for an unknown path — which is what a build without this function
  // does, and which a bare status-code check would read as success.
  if (request.method === 'GET') {
    return new Response(JSON.stringify(probeBody(config)), { status: 200, headers: JSON_HEADERS })
  }

  if (request.method !== 'POST') return new Response(null, { status: 405 })

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

  // Narrowed before the closure below captures it, so the stream body cannot see
  // the un-validated value.
  const askAiRequest = parsed
  const encoder = new TextEncoder()

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskAiEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      // streamAskAi never throws — a mid-stream failure arrives as an event,
      // because the 200 and the headers are already committed by this point.
      await streamAskAi(config, askAiRequest, send)
      controller.close()
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // Conventional opt-out for proxies that buffer a response of unknown
      // length; inert where it is not understood, and cheaper than discovering
      // an intermediary batched the whole answer into one chunk.
      'X-Accel-Buffering': 'no',
    },
  })
}
