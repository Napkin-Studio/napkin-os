// The beta's recorder (features/production-tool-dogfood.clan), copied from Napkin OS's dogfood
// build (app/src/dogfood/recorder.ts) and adapted: the relay takes the events (POST
// /dogfood/events with the session's token), the screen is {stage, project}, and none of the
// noise Napkin OS's first record had (features/dogfood-log-quality.clan):
//
// - only clicks and submits a person made (isTrusted), named the same way every day (nameOf);
// - no hover, pointer moves, scroll, wheel, video timeupdate or keystrokes: what was typed goes
//   with the action that sends it (job-submit carries the text);
// - jobs as state changes only (jobState), never a poll;
// - a run of identical events is sent as its first plus one 'repeat' {of, count, first, last},
//   count being how many more times it happened.
//
// On only when config.json says flags.dogfood and the relay is the real one; for a participant
// only after they have read the notice. Recording never gets in the way: nothing is awaited and
// every failure is swallowed.

/** Who to write to about the record (the notice says so). */
export const CONTACT = 'hello@napkin.ie'

export interface DogfoodState {
  /** This build records (config flags.dogfood, on the real relay). */
  on: boolean
  /** This participant has read the notice. */
  consented: boolean
}

export interface ShellEvent {
  kind: string
  name: string
  project?: string
  stage?: string
  data?: Record<string, unknown>
  at?: string
  tab?: string
  seq?: number
}

/** Where the person is: Home, or a stage of a project. */
export interface Screen {
  stage: string
  project?: string | null
}

export type Send = (events: ShellEvent[], leaving: boolean) => void

/** What changes between identical events: never part of what makes them the same. */
const VOLATILE = new Set(['at', 'seq', 'tab', 'ms', 'latencyMs'])
/** A person's own statements never fold. */
const UNFOLDED = new Set(['feedback', 'feedback-note', 'repeat'])

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/** What makes two events the same: kind, name, where, and data without timings. */
export function foldKey(e: ShellEvent): string | null {
  if (UNFOLDED.has(e.kind)) return null
  const data = Object.fromEntries(Object.entries(e.data ?? {}).filter(([k]) => !VOLATILE.has(k)))
  return stable([e.kind, e.name, e.project ?? null, e.stage ?? null, data])
}

/** Batches events; sends every `every` ms, at `max` events, and when the page is left. Folds runs. */
export class Recorder {
  private queue: ShellEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private run: { key: string; first: ShellEvent; count: number; start: string; last: string } | null = null
  private readonly send: Send
  private readonly max: number
  private readonly every: number
  constructor(send: Send, max = 50, every = 5000) {
    this.send = send
    this.max = max
    this.every = every
  }

  push(e: ShellEvent) {
    const key = foldKey(e)
    const at = e.at ?? new Date().toISOString()
    if (key !== null && this.run?.key === key) {
      this.run.count++
      if (!this.run.start) this.run.start = at
      this.run.last = at
      this.arm()
      return
    }
    this.closeRun()
    this.queue.push(e)
    this.run = key === null ? null : { key, first: e, count: 0, start: '', last: '' }
    if (this.queue.length >= this.max) this.flush(false)
    else this.arm()
  }

  private arm() {
    this.timer ??= setTimeout(() => this.flush(false), this.every)
  }

  /** The repeat line for what was folded since the run's last one; the run goes on. */
  private closeRun() {
    const r = this.run
    if (!r || !r.count) return
    const { kind, name, project, stage } = r.first
    this.queue.push({ kind: 'repeat', name, project, stage, at: r.last, data: { of: kind, count: r.count, first: r.start, last: r.last } })
    r.count = 0
    r.start = ''
  }

  flush(leaving: boolean) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.closeRun()
    if (!this.queue.length) return
    const batch = this.queue
    this.queue = []
    this.send(batch, leaving)
  }

  get pending(): number { return this.queue.length + (this.run?.count ? 1 : 0) }
}

// ── the shared state ────────────────────────────────────────────────────────

let state: DogfoodState = { on: false, consented: false }
let screen: Screen = { stage: 'home' }
const listeners = new Set<() => void>()
const tab = Math.random().toString(36).slice(2, 10)
let seq = 0
let transport: Send = () => {}
let recorder = new Recorder((events, leaving) => transport(events, leaving))

export function dogfoodState(): DogfoodState { return state }

export function subscribe(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

/** Set by Root from config and the session. Capture starts once both say yes. */
export function configureDogfood(next: DogfoodState, send?: Send) {
  if (send) transport = send
  if (next.on === state.on && next.consented === state.consented) return
  state = next
  listeners.forEach((f) => f())
  if (recording()) startCapture()
}

/** Whether events are taken: a recording build, and this person has agreed. */
export function recording(): boolean { return state.on && state.consented }

/** Queue one event, with the screen it happened on. Dropped unless recording. */
export function record(kind: string, name: string, data?: Record<string, unknown>, where: Screen = screen) {
  if (!recording()) return
  const e: ShellEvent = { kind, name, stage: where.stage, at: new Date().toISOString(), tab, seq: seq++ }
  if (where.project) e.project = where.project
  if (data && Object.keys(data).length) e.data = data
  recorder.push(e)
}

/** The person moved: record it, and remember it for what follows. */
export function setScreen(next: Screen) {
  if (next.stage === screen.stage && (next.project ?? null) === (screen.project ?? null)) return
  const from = screen.stage
  screen = next
  record('nav', next.project && next.stage !== 'home' ? 'stage' : next.stage, { from, to: next.stage })
}

export function currentScreen(): Screen { return screen }

/** What a thumb is about: a picture, frame, clip, the ad, a director decision, an error, the screen. */
export interface Target {
  kind: 'screen' | 'picture' | 'view' | 'frame' | 'clip' | 'ad' | 'shot-list' | 'director' | 'error'
  id?: string | null
  jobId?: string | null
  [more: string]: unknown
}

/** A thumb, recorded the moment it is chosen: most people never write the note. */
export function feedback(target: Target, thumb: 'up' | 'down') {
  const { kind, ...rest } = target
  record('feedback', kind, { thumb, ...clean(rest) })
  recorder.flush(false)
}

/** The note someone added to the thumb they chose. */
export function feedbackNote(target: Target, thumb: 'up' | 'down', note: string) {
  const text = note.trim()
  if (!text) return
  const { kind, ...rest } = target
  record('feedback-note', kind, { thumb, note: text, ...clean(rest) })
  recorder.flush(false)
}

function clean(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''))
}

// ── jobs: state changes only ────────────────────────────────────────────────

const jobStates = new Map<string, string>()

/** A job moved (the runner's transitions). Recorded once per change, never per poll. */
export function jobState(jobId: string, state: string, data: Record<string, unknown> = {}) {
  if (jobStates.get(jobId) === state) return
  jobStates.set(jobId, state)
  record('job-state', state, { jobId, ...clean(data) })
}

/** An error the person was shown, once per thing shown (a job's error is shown on every render). */
const shown = new Set<string>()
export function errorShown(where: string, message: string, data: Record<string, unknown> = {}) {
  const key = `${where}|${message}|${String(data.jobId ?? '')}`
  if (shown.has(key)) return
  shown.add(key)
  record('error-shown', where, { message: message.slice(0, 500), ...clean(data) })
}

// ── capture in the page ─────────────────────────────────────────────────────

/**
 * A name for what was clicked that stays the same from day to day: the control's data-dogfood,
 * aria-label or title (a field: its placeholder; a key field: 'key'); else its text, a part per
 * child element (' · '), with dates, times, counts and prices taken out. A click on no control is
 * named by its area ('in canvas: background'), never by the page's text. At most 80 characters.
 */
export function nameOf(el: Element | null): string {
  const CONTROLS = '[data-dogfood],button,a,[role="button"],[role="menuitem"],[role="tab"],[role="option"],input,select,textarea,summary,label'
  const WHEN = /\b(?:today|yesterday|tomorrow)\b(?:,?\s*(?:at\s*)?\d{1,2}:\d{2})?|\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b|\b\d{4}-\d{2}-\d{2}(?:t[\d:.]+z?)?\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?\b|\b\d+\s*(?:s|sec|secs|seconds?|minutes?|mins?|hours?|h|days?|weeks?|months?)\s+ago\b|\bjust now\b/gi
  const MONEY = /(?:[$€£]\s*\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*(?:usd|eur|gbp|[$€£]))/gi
  const COUNT = /#?\b\d+(?:[.,]\d+)?\b(?:\s*%)?/g
  function parts(node: Node, out: string[]) {
    let run = ''
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes[i]
      if (c.nodeType === 3) run += c.textContent || ''
      else if (c.nodeType === 1) { out.push(run); run = ''; parts(c, out) }
    }
    out.push(run)
  }
  function area(e: Element): string {
    const marked = e.closest('[data-dogfood-area]')
    if (marked) return marked.getAttribute('data-dogfood-area') || 'page'
    if (e.closest('.excalidraw')) return 'canvas'
    if (e.closest('.topbar,.hm-bar')) return 'top bar'
    return 'page'
  }
  if (!el || !el.closest) return 'page'
  const target = el.closest(CONTROLS)
  if (!target) return 'in ' + area(el) + ': background'
  const tag = target.tagName.toLowerCase()
  let label = target.getAttribute('data-dogfood') || target.getAttribute('aria-label') || target.getAttribute('title') || ''
  if (!label && (tag === 'input' || tag === 'textarea')) {
    label = (target as HTMLInputElement).type === 'password' ? 'key' : target.getAttribute('placeholder') || target.getAttribute('name') || ''
  }
  if (!label) {
    const out: string[] = []
    parts(target, out)
    label = out
      .map((p) => p.replace(WHEN, '').replace(MONEY, '').replace(COUNT, '').replace(/\s+/g, ' ').replace(/^[\s,·–→↗×#:-]+|[\s,·–→↗×#:-]+$/g, ''))
      .filter(Boolean)
      .join(' · ')
  }
  return tag + ': ' + (label.slice(0, 80) || '(no label)')
}

/** A click or submit, when the person made it (the page's own clicks, like the download link, are not theirs). */
export function capture(kind: 'click' | 'submit', e: { isTrusted: boolean; target: EventTarget | null }) {
  if (!e.isTrusted) return
  const t = e.target as Element | null
  record(kind, nameOf(t && typeof t.closest === 'function' ? t : null))
}

let capturing = false
function startCapture() {
  if (capturing || typeof document === 'undefined') return
  capturing = true
  // a click the page makes itself (the download link) is not the person's
  document.addEventListener('click', (e) => capture('click', e), { capture: true, passive: true })
  document.addEventListener('submit', (e) => capture('submit', e), { capture: true, passive: true })
  window.addEventListener('error', (e) => {
    record('client-error', String(e.message || 'error').slice(0, 200), { source: 'window', stack: String(e.error?.stack ?? '').slice(0, 8000) })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined
    record('client-error', String(r?.message ?? r ?? 'rejection').slice(0, 200), { source: 'promise', stack: String(r?.stack ?? '').slice(0, 8000) })
  })
  const original = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    original(...args)
    try {
      const err = args.find((a) => a instanceof Error) as Error | undefined
      record('client-error', String(args.find((a) => typeof a === 'string') ?? err?.message ?? 'console.error').slice(0, 200), {
        source: 'console', stack: String(err?.stack ?? '').slice(0, 8000),
      })
    } catch { /* never in the way */ }
  }
  const leave = () => recorder.flush(true)
  window.addEventListener('pagehide', leave)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave() })
}

/** For tests: set the state and the transport directly, with a fresh recorder. */
export function __test(next: DogfoodState, send?: Send, max = 50, every = 5000) {
  state = next
  screen = { stage: 'home' }
  jobStates.clear()
  shown.clear()
  if (send) transport = send
  recorder = new Recorder((events, leaving) => transport(events, leaving), max, every)
  listeners.forEach((f) => f())
}

export function __flush() { recorder.flush(false) }
