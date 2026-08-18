import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeAssistant, streamAssistant } from './assistant'

/**
 * The wire format between the browser and /api/ask-ai.
 *
 * Tested here rather than in a browser because the failure mode is silent: a
 * dropped line or a mis-joined chunk loses part of an answer without erroring, and
 * an eyeball on a streaming reply cannot tell a truncated one from a short one.
 */

/**
 * Real `Response`, so header and body semantics are the platform's, not a mock's.
 *
 * One chunk per `pull`, not a loop inside `start`: enqueueing everything up front
 * lets the stream hand the reader a single coalesced chunk, and then a test that
 * means to split an event across a boundary silently stops testing one. `pull`
 * runs once per read, so each chunk arrives in its own `read()`.
 */
function ndjson(chunks: string[]): Response {
  const encoder = new TextEncoder()
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]))
      else controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}

function stubFetch(res: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => res))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('probeAssistant', () => {
  it('reports ready when the endpoint names itself', async () => {
    stubFetch(
      new Response(JSON.stringify({ assistant: 'ready', model: 'gpt-4o' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(await probeAssistant()).toEqual({ state: 'ready', model: 'gpt-4o' })
  })

  /**
   * The probe reports the model even though the header no longer displays it: it is
   * configuration rather than a constant, and keeping it on the wire means a
   * debug surface or a log line can name what actually answered without another
   * round trip. `undefined` is a valid answer, so it must not read as offline.
   */
  it('is still ready when the endpoint does not name a model', async () => {
    stubFetch(
      new Response(JSON.stringify({ assistant: 'ready' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(await probeAssistant()).toEqual({ state: 'ready', model: undefined })
  })

  it("passes through the server's reason when the key is missing", async () => {
    stubFetch(
      new Response(JSON.stringify({ assistant: 'unconfigured', reason: 'OPENAI_API_KEY is not set.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const status = await probeAssistant()
    expect(status.state).toBe('offline')
    expect(status).toMatchObject({ reason: expect.stringContaining('OPENAI_API_KEY') })
  })

  /**
   * The reason the probe reads the body at all. A static host answers an unknown
   * path with index.html and a 200, so a status-code check would report a deployed
   * build — which has no endpoint — as ready, and every question would then fail
   * at send time instead of the page saying so up front.
   */
  it('treats a 200 of index.html as offline, not ready', async () => {
    stubFetch(
      new Response('<!doctype html><title>Haz Reviews</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    expect((await probeAssistant()).state).toBe('offline')
  })

  it('is offline when nothing answers at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    expect((await probeAssistant()).state).toBe('offline')
  })
})

describe('streamAssistant', () => {
  const ask = (res: Response) => {
    stubFetch(res)
    const seen: string[] = []
    return {
      seen,
      run: () =>
        streamAssistant({
          system: 's',
          messages: [{ role: 'user', content: 'q' }],
          onText: (c) => seen.push(c),
        }),
    }
  }

  it('emits each text delta in order', async () => {
    const { seen, run } = ask(
      ndjson([
        `${JSON.stringify({ type: 'text', text: 'Rabona ' })}\n`,
        `${JSON.stringify({ type: 'text', text: 'moved to 1.' })}\n`,
        `${JSON.stringify({ type: 'done' })}\n`,
      ]),
    )
    await run()
    expect(seen.join('')).toBe('Rabona moved to 1.')
  })

  /**
   * The whole reason for the line buffer. A network chunk boundary lands wherever
   * TCP puts it, so a JSON object routinely arrives in two pieces; parsing per
   * chunk would drop that object and lose the words with it.
   */
  it('reassembles an event split across two chunks', async () => {
    const line = JSON.stringify({ type: 'text', text: 'position 4' })
    const cut = Math.floor(line.length / 2)
    const { seen, run } = ask(ndjson([line.slice(0, cut), `${line.slice(cut)}\n`]))
    await run()
    expect(seen.join('')).toBe('position 4')
  })

  it('handles several events arriving in one chunk', async () => {
    const { seen, run } = ask(
      ndjson([
        `${JSON.stringify({ type: 'text', text: 'a' })}\n${JSON.stringify({ type: 'text', text: 'b' })}\n`,
      ]),
    )
    await run()
    expect(seen.join('')).toBe('ab')
  })

  /**
   * A refusal is an outcome, not a transport failure — it arrives with HTTP 200.
   * Rejecting would render it as a crash, and swallowing it would leave an empty
   * bubble that reads as a bug.
   */
  it('surfaces a refusal as a completed reply', async () => {
    const { seen, run } = ask(
      ndjson([`${JSON.stringify({ type: 'refusal', reason: 'content filter' })}\n`]),
    )
    const result = await run()
    expect(result.refused).toBe(true)
    expect(seen.join('')).toContain('declined')
    expect(seen.join('')).toContain('content filter')
  })

  /**
   * A reply that hit the token ceiling stops mid-sentence. Without a marker it is
   * indistinguishable from a model that simply finished, so the reader trusts a
   * half-finished answer — and on a reasoning model, where thinking tokens count
   * against the same ceiling, the visible answer can be cut to nothing.
   */
  it('marks a reply that hit the token ceiling', async () => {
    const { seen, run } = ask(
      ndjson([
        `${JSON.stringify({ type: 'text', text: 'The biggest movers are' })}\n`,
        `${JSON.stringify({ type: 'truncated' })}\n`,
      ]),
    )
    const result = await run()
    expect(result.truncated).toBe(true)
    expect(seen.join('')).toMatch(/cut off|truncated|token limit/i)
  })

  it('reports a complete reply as neither refused nor truncated', async () => {
    const { run } = ask(ndjson([`${JSON.stringify({ type: 'text', text: 'done' })}\n`]))
    expect(await run()).toEqual({ refused: false, truncated: false })
  })

  it('throws when the server reports a mid-stream error', async () => {
    const { run } = ask(ndjson([`${JSON.stringify({ type: 'error', message: 'overloaded' })}\n`]))
    await expect(run()).rejects.toThrow('overloaded')
  })

  // 503 is the not-configured case. Its message tells the user what to add and
  // where, so losing it in favour of a status code makes the failure unactionable.
  it("throws the server's message on a non-OK response", async () => {
    stubFetch(
      new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(
      streamAssistant({ system: 's', messages: [], onText: () => {} }),
    ).rejects.toThrow('ANTHROPIC_API_KEY')
  })

  it('ignores a blank or unparseable line rather than aborting the reply', async () => {
    const { seen, run } = ask(
      ndjson([`\n{not json}\n${JSON.stringify({ type: 'text', text: 'still here' })}\n`]),
    )
    await run()
    expect(seen.join('')).toBe('still here')
  })
})
