/**
 * Browser-side client for the Ask AI endpoint.
 *
 * Deliberately knows nothing about the provider — no SDK, no key, no model name
 * of its own. All of that lives server-side (in dev, `vite/askAiProxy.ts`). The
 * one thing this file must never do is hold a credential: anything reachable from
 * here is in the bundle and readable in devtools.
 *
 * The model arrives from the server's probe rather than being named here, so
 * switching models is an env change and not a rebuild.
 */

/** Same path in dev and production, so deploying a real function needs no client change. */
export const ASK_AI_ENDPOINT = '/api/ask-ai'

export interface AssistantTurn {
  role: 'user' | 'assistant'
  content: string
}

export type AssistantStatus =
  | { state: 'connecting' }
  /** `model` is whatever the server resolved; absent if it declined to say. */
  | { state: 'ready'; model?: string }
  | { state: 'offline'; reason: string }

const OFFLINE_NO_ENDPOINT =
  'No assistant endpoint is running. Under `npm run dev` this is served by the Vite ' +
  'middleware; a deployed build needs a real server-side function at /api/ask-ai.'

/**
 * Asks the endpoint whether it can serve a request, without spending any tokens.
 *
 * A static host answers an unknown path with index.html and a 200, so a
 * status-code check alone would report a deployed build as ready. The body has to
 * be JSON naming the assistant before we believe it.
 */
export async function probeAssistant(signal?: AbortSignal): Promise<AssistantStatus> {
  try {
    const res = await fetch(ASK_AI_ENDPOINT, { method: 'GET', signal })
    if (!res.ok) return { state: 'offline', reason: OFFLINE_NO_ENDPOINT }
    if (!res.headers.get('content-type')?.includes('application/json')) {
      return { state: 'offline', reason: OFFLINE_NO_ENDPOINT }
    }
    const body: unknown = await res.json()
    const assistant = (body as { assistant?: unknown }).assistant
    if (assistant === 'ready') {
      const model = (body as { model?: unknown }).model
      return { state: 'ready', model: typeof model === 'string' ? model : undefined }
    }
    const reason = (body as { reason?: unknown }).reason
    return { state: 'offline', reason: typeof reason === 'string' ? reason : OFFLINE_NO_ENDPOINT }
  } catch (err) {
    // An abort is not a verdict on the endpoint: it means the caller stopped
    // wanting this answer. Turning it into a status lets a CANCELLED probe
    // overwrite the live one's, and under StrictMode's double mount there is
    // always exactly one cancelled probe — so a perfectly good key rendered
    // "Assistant offline" on whichever loads the aborted request settled last.
    // Rethrow, so a cancellation can never reach state at all.
    //
    // Read `name` off the value instead of narrowing with `instanceof Error`:
    // browsers reject with a DOMException, whose inheritance from Error was only
    // specified later, and a false negative here silently restores the bug.
    if ((err as { name?: unknown } | null)?.name === 'AbortError') throw err
    return { state: 'offline', reason: OFFLINE_NO_ENDPOINT }
  }
}

/**
 * Streams one assistant reply, calling `onText` per chunk.
 *
 * Resolves when the reply is complete; rejects on transport failure or on an
 * error the server reported mid-stream. A refusal and a truncation are NOT
 * rejections — both are real outcomes that arrive with HTTP 200, so callers render
 * them as a reply rather than as a crash. Both are also annotated inline: a
 * refusal with no note is an empty bubble, and a truncation with no note is a
 * half-answer the reader has no reason to distrust.
 */
export async function streamAssistant(opts: {
  system: string
  messages: AssistantTurn[]
  onText: (chunk: string) => void
  signal?: AbortSignal
}): Promise<{ refused: boolean; truncated: boolean }> {
  const res = await fetch(ASK_AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: opts.system, messages: opts.messages }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const detail: unknown = await res.json().catch(() => null)
    const message = (detail as { error?: unknown } | null)?.error
    throw new Error(typeof message === 'string' ? message : `Assistant request failed (${res.status}).`)
  }
  if (!res.body) throw new Error('Assistant returned no response body.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let refused = false
  let truncated = false

  // Line-delimited JSON: a chunk boundary can land mid-line, so only complete
  // lines are parsed and the remainder is carried forward.
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let event: { type?: string; text?: string; message?: string; reason?: string | null }
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (event.type === 'text' && typeof event.text === 'string') opts.onText(event.text)
      else if (event.type === 'refusal') {
        refused = true
        opts.onText(
          event.reason
            ? `\n\n_The model declined to answer this (${event.reason})._`
            : '\n\n_The model declined to answer this._',
        )
      } else if (event.type === 'truncated') {
        truncated = true
        opts.onText('\n\n_This answer was cut off at the model’s token limit._')
      } else if (event.type === 'error') {
        throw new Error(event.message ?? 'The assistant failed mid-response.')
      }
    }
  }

  return { refused, truncated }
}
