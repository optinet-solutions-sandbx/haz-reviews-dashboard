import OpenAI from 'openai'

/**
 * The provider-facing core of Ask AI, shared by the two hosts that expose it:
 * `vite/askAiProxy.ts` under `npm run dev`, and `api/ask-ai.ts` on Vercel.
 *
 * It lives outside `src/` because nothing under `src/` may import a provider SDK
 * (invariant 27). Vite inlines every `VITE_`-prefixed variable into the client
 * bundle, so a key reachable from the browser is readable in devtools; the key is
 * therefore only ever read in Node, and the browser only ever sees the endpoint.
 *
 * Shared rather than copied into both hosts, because the subtle part is here:
 * THREE distinct failures arrive with HTTP 200 — a refusal, a content filter and
 * truncation — and code that streams content and then stops reports every one of
 * them as success. Duplicated, a fix would land in one host and not the other,
 * and the symptom is a silently half-answered question rather than an error.
 */

/**
 * Model and base URL are configuration, not constants. The model in particular is
 * read at request time rather than compiled in: choosing a different one is then
 * an environment change, not a code change, which is the whole reason the
 * readiness probe reports the resolved name back to the client.
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

/**
 * Names the variable and says where it goes. Worded for both hosts: dev reads
 * `.env.local` at server start, Vercel reads project environment variables at
 * invocation, so one of "restart" and "redeploy" always applies.
 */
export const UNCONFIGURED =
  'OPENAI_API_KEY is not set. Add it WITHOUT a VITE_ prefix — to .env.local for ' +
  'local development, or to the deployment environment — then restart or redeploy.'

/** Line-delimited JSON, so the client can distinguish text from failure. */
export type AskAiEvent =
  | { type: 'text'; text: string }
  | { type: 'refusal'; reason: string | null }
  | { type: 'truncated' }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface AskAiRequest {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export function isAskAiRequest(value: unknown): value is AskAiRequest {
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

export interface AskAiConfig {
  /** Empty when unconfigured. The hosts branch on this, not on a thrown error. */
  apiKey: string
  model: string
  baseURL: string | undefined
}

/**
 * Reads configuration through a caller-supplied lookup rather than touching
 * `process.env` directly, because the two hosts source it differently: Vite
 * merges `.env.local` via `loadEnv` with an empty prefix (so NON-`VITE_`
 * variables are visible at all), while a deployed function has only
 * `process.env`.
 */
export function readAskAiConfig(read: (name: string) => string): AskAiConfig {
  return {
    apiKey: read('OPENAI_API_KEY'),
    model: read('OPENAI_MODEL') || DEFAULT_MODEL,
    // Optional: lets the same endpoint serve Azure OpenAI or a compatible proxy
    // without a code change.
    baseURL: read('OPENAI_BASE_URL') || undefined,
  }
}

/** The body of the readiness probe, identical in both hosts. */
export function probeBody(config: AskAiConfig): Record<string, string> {
  return config.apiKey
    ? { assistant: 'ready', model: config.model }
    : { assistant: 'unconfigured', reason: UNCONFIGURED }
}

/**
 * Streams one reply, emitting events through `send`.
 *
 * Never throws: by the time this is called the host has already committed to a
 * 200 and an open stream, so a failure has to arrive as an event rather than as a
 * status code. Provider errors land here too — a bad key, or a model the account
 * cannot reach — and their messages are the diagnostic, so they are passed
 * through.
 */
export async function streamAskAi(
  config: AskAiConfig,
  request: AskAiRequest,
  send: (event: AskAiEvent) => void,
): Promise<void> {
  try {
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })

    // Streaming because the answer renders token by token in a chat panel, and
    // because a large token ceiling on a non-streaming request risks an HTTP
    // timeout.
    const stream = await client.chat.completions.create({
      model: config.model,
      stream: true,
      // `max_completion_tokens`, not the deprecated `max_tokens` — the latter is
      // rejected outright by the reasoning models.
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      // No `temperature`: several current models accept only the default and 400
      // on anything else, and this task has no reason to want a different one.
      messages: [{ role: 'system', content: request.system }, ...request.messages],
    })

    // A refusal streams as its own delta field rather than as content, so it has
    // to be accumulated separately or it is lost entirely.
    let refusal = ''
    let finish: string | null = null

    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      if (!choice) continue
      if (choice.delta?.content) send({ type: 'text', text: choice.delta.content })
      if (choice.delta?.refusal) refusal += choice.delta.refusal
      if (choice.finish_reason) finish = choice.finish_reason
    }

    // Checked before calling the reply complete: all three of these arrive with
    // HTTP 200, so code that streams content and stops reports a blocked or
    // half-finished answer as a success.
    if (refusal) send({ type: 'refusal', reason: refusal })
    else if (finish === 'content_filter') send({ type: 'refusal', reason: 'content filter' })
    else if (finish === 'length') send({ type: 'truncated' })

    send({ type: 'done' })
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
