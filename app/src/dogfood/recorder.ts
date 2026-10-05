// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The dogfood build's recorder (napkin-web NAPKIN_DOGFOOD=1;
// features/dogfood-telemetry.clan).
//
// The server says whether this build records (`/api/session` → dogfood) and
// whether this person has acknowledged it (consented). Until they have, nothing
// is taken. After, every click and screen in the shell, every click inside an
// app frame (a listener the shell adds to the frame's page, which posts
// `clan:interaction`), and every thumbs-up or -down is queued here and sent in
// batches to /api/dogfood/events. What people send (prompts, saves, uploads)
// the server records itself, at the request. Off — production, the desktop,
// the browser-only build — none of this runs.

/** Who to write to about the record (the notice says so). */
export const CONTACT = 'hello@napkin.ie'

export interface DogfoodState {
  /** This build records. */
  on: boolean
  /** This person has acknowledged it. */
  consented: boolean
}

export interface ShellEvent {
  kind: string
  name: string
  doc?: string | null
  app?: string | null
  data?: Record<string, unknown>
  at?: string
}

/** Where the person is: the screen, and the document and app open in it. */
export interface Screen {
  screen: string
  doc?: string | null
  app?: string | null
}

type Send = (events: ShellEvent[], leaving: boolean) => void

/** Batches events; sends every `every` ms, at `max` events, and when the page is left. */
export class Recorder {
  private queue: ShellEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly send: Send
  private readonly max: number
  private readonly every: number
  constructor(send: Send, max = 50, every = 5000) {
    this.send = send
    this.max = max
    this.every = every
  }

  push(e: ShellEvent) {
    this.queue.push(e)
    if (this.queue.length >= this.max) this.flush(false)
    else this.timer ??= setTimeout(() => this.flush(false), this.every)
  }

  flush(leaving: boolean) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.queue.length) return
    const batch = this.queue
    this.queue = []
    this.send(batch, leaving)
  }

  get pending(): number { return this.queue.length }
}

/** To the server: fetch with keepalive, or a beacon as the page goes. Never awaited. */
function post(events: ShellEvent[], leaving: boolean) {
  const body = JSON.stringify({ events })
  if (leaving && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon('/api/dogfood/events', new Blob([body], { type: 'application/json' }))
    return
  }
  fetch('/api/dogfood/events', {
    method: 'POST', credentials: 'same-origin', keepalive: true,
    headers: { 'Content-Type': 'application/json' }, body,
  }).catch(() => { /* recording never gets in the way */ })
}

// ── the shared state ────────────────────────────────────────────────────────

let state: DogfoodState = { on: false, consented: false }
let screen: Screen = { screen: 'home' }
const listeners = new Set<() => void>()
let recorder = new Recorder(post)

export function dogfoodState(): DogfoodState { return state }

export function subscribe(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

function setState(next: DogfoodState) {
  state = next
  listeners.forEach(f => f())
}

/** Whether events are being taken: a recording build, and this person has agreed. */
export function recording(): boolean { return state.on && state.consented }

/** Queue one event, with the screen it happened on. Dropped unless recording. */
export function record(kind: string, name: string, data?: Record<string, unknown>, where: Screen = screen) {
  if (!recording()) return
  recorder.push({ kind, name, doc: where.doc ?? null, app: where.app ?? null, data: { screen: where.screen, ...data }, at: new Date().toISOString() })
}

/** The person moved: record it, and remember it for what follows. */
export function setScreen(next: Screen) {
  if (next.screen === screen.screen && next.doc === screen.doc && next.app === screen.app) return
  screen = next
  record('nav', next.screen, {}, next)
}

export function currentScreen(): Screen { return screen }

/** A thumbs-up or -down, with an optional note, on a screen or an agent's result. */
export function feedback(on: string, thumb: 'up' | 'down', note: string, extra?: Record<string, unknown>) {
  record('feedback', on, { thumb, note: note.trim() || undefined, ...extra })
  recorder.flush(false)
}

/** Ask the server whether this build records; on the desktop and offline it does not. */
export async function loadDogfood(): Promise<DogfoodState> {
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin' })
    if (r.ok) {
      const s = await r.json()
      setState({ on: s.dogfood === true, consented: s.consented === true })
      if (recording()) startCapture()
    }
  } catch { /* no server: nothing records */ }
  return state
}

/** The person has read the notice: tell the server, then start. */
export async function acknowledge(): Promise<boolean> {
  try {
    const r = await fetch('/api/dogfood/consent', { method: 'POST', credentials: 'same-origin' })
    if (!r.ok) return false
  } catch { return false }
  setState({ ...state, consented: true })
  startCapture()
  record('nav', screen.screen)
  return true
}

// ── capture in the shell ────────────────────────────────────────────────────

/** A name for what was clicked: its data-dogfood name, label, title or text. */
export function nameOf(el: Element | null): string {
  if (!el) return 'page'
  const target = el.closest('[data-dogfood],button,a,[role="button"],[role="menuitem"],[role="tab"],input,select,textarea,summary,label') ?? el
  const tag = target.tagName.toLowerCase()
  const label = target.getAttribute('data-dogfood')
    ?? target.getAttribute('aria-label')
    ?? target.getAttribute('title')
    ?? (target.textContent ?? '').replace(/\s+/g, ' ').trim()
  return `${tag}: ${label.slice(0, 80) || '(no label)'}`
}

let capturing = false
function startCapture() {
  if (capturing || typeof document === 'undefined') return
  capturing = true
  document.addEventListener('click', e => {
    record('click', nameOf(e.target instanceof Element ? e.target : null), { in: 'shell' })
  }, { capture: true, passive: true })
  document.addEventListener('submit', e => {
    record('submit', nameOf(e.target instanceof Element ? e.target : null), { in: 'shell' })
  }, { capture: true, passive: true })
  const leave = () => recorder.flush(true)
  window.addEventListener('pagehide', leave)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave() })
}

// ── capture inside app frames ───────────────────────────────────────────────

/**
 * The listener the shell adds to an app frame's page when this build records:
 * it only listens (capture phase, passive) and tells the shell what was
 * clicked or submitted. No app changes; a template can name things with
 * `data-dogfood`.
 */
export const FRAME_CAPTURE = `<script data-dogfood-capture>(function(){
function nameOf(el){if(!el||!el.closest)return 'page';var t=el.closest('[data-dogfood],button,a,[role="button"],[role="menuitem"],[role="tab"],input,select,textarea,summary,label')||el;
var l=t.getAttribute('data-dogfood')||t.getAttribute('aria-label')||t.getAttribute('title')||(t.textContent||'').replace(/\\s+/g,' ').trim();
return t.tagName.toLowerCase()+': '+(l.slice(0,80)||'(no label)')}
function tell(kind,e){try{parent.postMessage({type:'clan:interaction',kind:kind,name:nameOf(e.target)},'*')}catch(_){}}
document.addEventListener('click',function(e){tell('click',e)},{capture:true,passive:true});
document.addEventListener('submit',function(e){tell('submit',e)},{capture:true,passive:true});
})();</script>`

/**
 * What to add to an app page beside the edit bridge: the frame listener when
 * this build records, else nothing. (The bridge is spliced in at the page's
 * last `</body>`; an app's script may hold an earlier one in a string.)
 */
export function frameCapture(on: boolean): string {
  return on ? FRAME_CAPTURE : ''
}

/** For tests: set the state and the transport directly. */
export function __test(next: DogfoodState, send?: Send) {
  setState(next)
  if (send) recorder = new Recorder(send)
}
