import { Mic, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { HzOutletContext } from '../types'
import {
  ALL_SITES,
  ASK_AI_SYSTEM,
  buildAskAiContext,
  buildOverviewContext,
  buildWireMessages,
  suggestionsFor,
  type AskAiTurn,
} from '../lib/askAiContext'
import { probeAssistant, streamAssistant, type AssistantStatus } from '../lib/assistant'
import { SITES, siteById } from '../lib/sites'
import { AskAiIcon } from '../components/icons'

/**
 * The assistant, over the ranking data already in the browser.
 *
 * Full-bleed: the shell drops its page padding for this route (see App.tsx) so the
 * message list owns the scroll and the composer stays pinned. That is the one
 * layout escape hatch in the app.
 *
 * No credential is reachable from this file. Everything model-side lives behind
 * /api/ask-ai — in dev the Vite middleware, in production a function you deploy.
 */

interface Turn extends AskAiTurn {
  /** Streaming replies render as they arrive; this marks the one still growing. */
  pending?: boolean
}

/**
 * The Web Speech API, narrowed to what the mic button uses.
 *
 * Declared here because `lib.dom` does not ship these types and the vendor-prefixed
 * constructor is still the only one in Chrome. Support is genuinely partial —
 * Firefox has none — so the button is rendered only when a constructor exists
 * rather than failing on click.
 *
 * Worth knowing: Chrome implements this by streaming the audio to Google's speech
 * service. It is the browser doing that, not this app, but it is still audio
 * leaving the machine — which is why the mic is opt-in per click and never
 * listens on its own.
 */
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function AskAi() {
  const ctx = useOutletContext<HzOutletContext>()
  const [status, setStatus] = useState<AssistantStatus>({ state: 'connecting' })
  // Defaults to the overview, matching the sibling dashboard: the empty state
  // invites picking a site, so landing already narrowed to one would contradict it.
  const [siteId, setSiteId] = useState<string>(ALL_SITES)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  // Resolved once: the constructor's presence is a browser fact, not state.
  const SpeechRecognition = useMemo(speechRecognitionCtor, [])

  useEffect(() => {
    const abort = new AbortController()
    // Guard the WRITE as well as the throw. The cleanup below aborts this probe on
    // StrictMode's first unmount, and a result that arrives after cancellation
    // must not reach state whatever produced it. `catch` is not incidental: with
    // the abort now rethrown, without it every mount logs an unhandled rejection.
    probeAssistant(abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) setStatus(next)
      })
      .catch(() => {
        // Only ever a cancellation — every real failure is already an `offline`
        // status, so there is nothing here to surface.
      })
    return () => abort.abort()
  }, [])

  // Follow the tail as tokens arrive, so a long answer does not scroll away.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [turns])

  const overview = siteId === ALL_SITES
  // `allSnapshots`, not `snapshots`, and one of only two places allowed to do that
  // (invariant 23). This page asks about a site chosen HERE, which need not be the
  // one being browsed, so the narrowed set would answer "no data imported" for
  // every other entry in the dropdown — and the overview needs every site by
  // definition. Safe because both builders filter by site id themselves; the
  // unfiltered set is never read unfiltered.
  const context = useMemo(
    () =>
      overview
        ? buildOverviewContext(ctx.allSnapshots)
        : buildAskAiContext(ctx.allSnapshots, siteById(siteId)),
    [ctx.allSnapshots, overview, siteId],
  )
  const suggestions = useMemo(() => suggestionsFor(siteId), [siteId])

  const ready = status.state === 'ready'
  const canSend = ready && !busy && draft.trim().length > 0

  async function ask(question: string) {
    if (!ready || busy) return
    setError(null)
    setBusy(true)

    // Assembled by a pure function, and the turn keeps what was SENT next to what
    // is shown. Replaying the visible transcript instead would drop the data from
    // turn two onward and the model would answer from nothing, fluently.
    const wire = buildWireMessages(turns, question, context, siteId)
    const sent = wire[wire.length - 1].content

    setTurns((prev) => [
      ...prev,
      { role: 'user', content: question, wire: sent, scope: siteId },
      { role: 'assistant', content: '', pending: true },
    ])

    try {
      await streamAssistant({
        system: ASK_AI_SYSTEM,
        messages: wire,
        onText: (chunk) =>
          setTurns((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.pending) next[next.length - 1] = { ...last, content: last.content + chunk }
            return next
          }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // Clear the pending flag whatever happened, or the caret blinks forever on a
      // reply that will never continue. A reply that arrived with no text at all
      // is dropped rather than left as a blank bubble — the error line below says
      // what happened, and an empty turn is debris in the next request's history.
      setTurns((prev) => {
        const last = prev[prev.length - 1]
        if (!last?.pending) return prev
        if (last.role === 'assistant' && last.content.length === 0) return prev.slice(0, -1)
        return [...prev.slice(0, -1), { ...last, pending: false }]
      })
      setBusy(false)
    }
  }

  function toggleListening() {
    if (!SpeechRecognition) return

    // Second click stops it. Kept in a ref because the instance is not state — it
    // is a live object whose identity must survive re-renders mid-utterance.
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
      setListening(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.continuous = false
    // Interim results so the words appear while speaking; the final result replaces
    // them. Without this the field sits empty until the phrase ends, which reads as
    // a dead button.
    recognition.interimResults = true
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, i) => event.results[i][0].transcript).join('')
      setDraft(transcript)
    }
    // Both paths clear the ref, or a denied mic permission leaves the button stuck
    // in its listening state with nothing running behind it.
    recognition.onerror = () => {
      recognitionRef.current = null
      setListening(false)
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
    }
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--surface)' }}>
      {/* Header */}
      <div
        className="ask-ai-header flex h-14 shrink-0 items-center gap-3 border-b px-6"
      >
        <AskAiIcon size={22} />
        {/* An <h1>, not the reference's <span>: invariant 25 gives every page exactly
            one heading, and a span would leave this one anonymous. Identical to
            render — Tailwind's preflight resets heading size and weight. */}
        <h1 className="ask-ai-title flex-1 font-display text-[15px] tracking-wider">Ask AI</h1>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="ask-ai-site" className="ask-ai-site-label">
            Site
          </label>
          {/* Enabled mid-thread, matching the sibling dashboard. Safe only because
              `buildWireMessages` attaches the new scope's data to the next question
              (see its comment) — with the data pinned to turn one, switching here
              would have relabelled the view while the answers kept describing the
              property the thread started on.

              Colours and border tint live in `.ask-ai-site` (index.css), not inline
              — see that rule for why.

              `rounded-[10px]`, not `rounded-lg`: the shell overrides --radius-lg to
              10px and this project does not, so the class that reads as parity would
              render Tailwind's stock 8px. An arbitrary value beats importing the
              override, which would resize all 42 other `rounded-lg` corners here.

              169×33 is measured off the reference, not derived. The WIDTH reproduces
              its distance between the label and the chevron — a distance that is
              INCIDENTAL there: a select sizes itself to its widest option, and the
              shell's dropdown carries site names longer than 'All sites (overview)',
              so the box overhangs the selected label. The one registered property here
              is named HAZREVIEWS, well short of the overview label, so unaided the box
              hugs it and the control reads visibly narrower than the sibling's.

              `min-w`, not `w`: a floor widens for a longer-named property exactly as
              the reference does, where a fixed width would clip the name that a second
              property is registered under.

              The HEIGHT is `h-`, and it is 0.6px more than `py-1.5` and a 14px line
              box produce on their own. Below ~32.4px it would clip the text rather
              than shrink the control.

              NOT a trailing space inside the option, which is what stood here before:
              Chrome collapses an option's leading and trailing whitespace, so the box
              measured 156px with the space and 156px without it. It read as deliberate
              padding while doing nothing. */}
          <select
            id="ask-ai-site"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="ask-ai-site h-[33px] min-w-[169px] rounded-[10px] border px-2 py-1.5 outline-none"
          >
            <option value={ALL_SITES}>All sites (overview)</option>
            {SITES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Transcript */}
      <div ref={listRef} className="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {status.state === 'connecting' && (
          <p className="ask-ai-note mt-2 text-[13px]">Connecting to the assistant…</p>
        )}

        {status.state === 'offline' && (
          <div
            className="mt-2 rounded-xl p-4"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border-2)' }}
          >
            <p className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
              Assistant offline
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {status.reason}
            </p>
          </div>
        )}

        {ready && turns.length === 0 && (
          <div className="mt-2 space-y-3">
            <p className="ask-ai-note text-[13px] leading-relaxed">
              Pick a site above to ask about it specifically, or ask now to use the
              all-sites overview.
            </p>
            {/* Starter questions. They send on click rather than filling the input:
                the value is skipping the typing, and a chip that only prefills still
                leaves the reader to press Send. Shown in the empty state only, so
                they never compete with a live thread for attention.

                The set changes with the selector — a single-site chip asking about
                "all sites" would be answered from a context that holds one, and vice
                versa. Both sets are asserted answerable in askAiContext.test.ts. */}
            <div className="flex flex-wrap gap-2">
              {suggestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => void ask(q)}
                  className="suggestion-chip cursor-pointer rounded-[10px] px-3 py-2 text-left text-[12.5px] leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--navy-text)',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <Bubble key={i} turn={turn} />
        ))}

        {error && (
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--neg)' }}>
            {error}
          </p>
        )}
      </div>

      {/* Composer */}
      <div className="mx-auto w-full max-w-3xl shrink-0 space-y-2 px-6 pb-5">
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void ask('Summarise this view: what stands out in the latest import?')}
          className="w-full cursor-pointer rounded-[10px] py-2 font-mono text-[12px] tracking-wider transition-colors enabled:hover:bg-[var(--ref-neutral-50)] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ border: '1px solid var(--ref-neutral-200)', color: 'var(--navy-text)' }}
        >
          Summarize this view
        </button>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const q = draft.trim()
            if (!q || !canSend) return
            setDraft('')
            void ask(q)
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!ready || busy}
            placeholder={
              ready
                ? SpeechRecognition
                  ? 'Ask a question or click the mic to speak'
                  : 'Ask a question'
                : 'Assistant offline'
            }
            aria-label="Ask the assistant"
            // Colours live in `.ask-ai-input` (index.css) for the picker's reason:
            // an inline declaration outranks the stylesheet, so the reference's
            // `focus:border-primary-700` could never land. The border WIDTH stays a
            // utility — `border` is 1px, the reference's own value.
            className="ask-ai-input flex-1 rounded-[10px] border px-3 py-2.5 text-[13px] outline-none disabled:cursor-not-allowed"
          />
          {/* Two conditions, both from the reference. It renders only where the API
              exists — Firefox has none, and a button that throws on click is worse
              than an absent one — and only once the assistant is ready: the
              reference composer is input+send while connecting or offline, and a mic
              beside a dead input is both misleading and an extra 46px in the row
              that shortens the input for no reason. The transcript lands in the
              draft rather than sending, because recognition mishears and
              auto-sending would spend a request on the wrong question. */}
          {SpeechRecognition && ready && (
            <button
              type="button"
              disabled={busy}
              onClick={toggleListening}
              aria-label={listening ? 'Stop listening' : 'Dictate a question'}
              aria-pressed={listening}
              title={listening ? 'Stop listening' : 'Dictate a question'}
              className="cursor-pointer rounded-[10px] p-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              // No border: `p-2.5` around a 16px icon is 36px, exactly the Send
              // button, and a 1px border would make this one 38px — two controls of
              // different sizes in the same row, with Send pushed off the baseline.
              style={{
                background: listening ? 'var(--brand-navy)' : 'var(--surface-3)',
                color: listening ? '#fff' : 'var(--text-2)',
              }}
            >
              <Mic size={16} />
            </button>
          )}
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            title="Send"
            // `.ask-ai-send` for the hover, same inline-outranks-stylesheet reason.
            className="ask-ai-send cursor-pointer rounded-[10px] p-2.5 text-white transition-[background-color,opacity] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}

function Bubble({ turn }: { turn: Turn }) {
  const mine = turn.role === 'user'
  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className="max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed"
        style={
          mine
            ? { background: 'var(--active-tint)', color: 'var(--ink)' }
            : { background: 'var(--surface-3)', color: 'var(--ink)' }
        }
      >
        {turn.content}
        {/* A caret rather than a spinner: the reply is already streaming, so the
            cue belongs at the insertion point. */}
        {turn.pending && (
          <span className="animate-pulse" style={{ color: 'var(--muted)' }}>
            ▍
          </span>
        )}
      </div>
    </div>
  )
}
