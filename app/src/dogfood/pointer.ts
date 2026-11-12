// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Feedback by pointing at what it is about (features/feedback-point.clan; the
// owner's mock feedback-point-v1, 2026-11-13). "Feedback" in the account menu,
// or F anywhere, starts pointing: what is under the cursor is outlined and
// named, in the shell (FeedbackPoint.tsx) and inside the tool's frame (the
// shared snippet, app/templates/shared/clan-fields.html). One click picks it,
// Esc cancels; a note card then says Wrong / Unclear / Idea and a line, and
// Send records one `feedback-point` event through the dogfood recorder.
//
// The frame is sandboxed and cross-origin, so the two talk by postMessage:
//   shell → page  {type:'clan:feedback-pick', on}
//   page → shell  {type:'clan:feedback-picked', target:{kind,id,label}|null, rect, version, title}
//                 (null: the person pressed Esc in the page; version and title are the document's own)
//   page → shell  {type:'clan:feedback-key'}  (F pressed in the page, not typing)

import { feedbackPoint, recording } from './recorder'

export type TargetKind = 'part' | 'section' | 'fact' | 'finding' | 'control'
export type NoteKind = 'wrong' | 'unclear' | 'idea'

/** What the person pointed at: a part, section, fact or finding by its id, a button by its label. */
export interface FeedbackTarget { kind: TargetKind; id: string; label: string }
export interface Rect { x: number; y: number; w: number; h: number }
/** The document's own version ("v1") and title, as its page named them; absent for a pick in the shell. */
export interface PageDoc { version: string | null; title: string | null }
export interface Picked { target: FeedbackTarget; in: 'shell' | 'app'; rect: Rect; page?: PageDoc }

export type PointState =
  | { phase: 'idle' }
  | { phase: 'pointing' }
  | { phase: 'note'; picked: Picked }
  | { phase: 'sent' }

/** The open document, as the note card names it and the event carries it. */
export interface FeedbackDoc {
  path: string
  title: string
  appId: string | null
  tool: string | null
  toolVersion: string | null
  /** The document's content version (its manifest's sha256). */
  version: string
  /** What the card calls it: brief, research, deck … */
  noun: string
  /** Its runs the host has not seen finish (`LibraryItem.jobs`). */
  jobs: readonly string[]
}

const KINDS: readonly TargetKind[] = ['part', 'section', 'fact', 'finding', 'control']

// ── the shared state ────────────────────────────────────────────────────────

let state: PointState = { phase: 'idle' }
let doc: FeedbackDoc | null = null
let frame: { postMessage(m: unknown, origin: string): void } | null = null
const subs = new Set<() => void>()

function set(next: PointState) {
  state = next
  subs.forEach(f => f())
}

export function pointState(): PointState { return state }
export function subscribePoint(f: () => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}

/** The open tool's frame (AppRuntime), told when pointing starts and stops; null when none. */
export function setFeedbackFrame(w: { postMessage(m: unknown, origin: string): void } | null) {
  frame = w
  if (w && state.phase === 'pointing') w.postMessage({ type: 'clan:feedback-pick', on: true }, '*')
}

/** The open document (AppHost), or null on the desk. */
export function setFeedbackDoc(d: FeedbackDoc | null) { doc = d }
export function feedbackDoc(): FeedbackDoc | null { return doc }

function tellFrame(on: boolean) {
  try { frame?.postMessage({ type: 'clan:feedback-pick', on }, '*') } catch { /* a frame gone mid-way */ }
}

/** Start pointing: only in a build that records, with the person's agreement. */
export function startPointing() {
  if (!recording() || state.phase === 'pointing') return
  set({ phase: 'pointing' })
  tellFrame(true)
}

/** Esc, Cancel, or the card closing: back to nothing, and the frame stops too. */
export function cancelPointing() {
  if (state.phase === 'pointing') tellFrame(false)
  if (state.phase !== 'idle') set({ phase: 'idle' })
}

/** One click picked it: the note card opens next to it. */
export function pick(picked: Picked) {
  if (state.phase !== 'pointing') return
  tellFrame(false)
  set({ phase: 'note', picked })
}

/** The account menu's opener: only while recording, so the row shows only then. */
export function feedbackOpener(on: boolean): (() => void) | undefined {
  return on ? startPointing : undefined
}

// ── the keyboard ────────────────────────────────────────────────────────────

interface El { tagName?: string; isContentEditable?: boolean; type?: string; closest?: (s: string) => unknown }

const TEXT_INPUTS = /^(?:text|search|email|url|tel|password|number|date|datetime-local|month|time|week)?$/i

/** The person is typing: an input that takes text, a textarea, a select, or editable content. */
export function isTyping(el: El | null | undefined): boolean {
  if (!el) return false
  const tag = String(el.tagName || '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return TEXT_INPUTS.test(String(el.type ?? ''))
  if (el.isContentEditable) return true
  return !!el.closest?.('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]')
}

interface Key { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown; repeat?: boolean }

/** What a key does here: F starts pointing (not while typing, not with a modifier); Esc cancels. */
export function keyAction(e: Key, phase: PointState['phase']): 'start' | 'cancel' | null {
  if (e.key === 'Escape') return phase === 'pointing' || phase === 'note' ? 'cancel' : null
  if (e.key !== 'f' && e.key !== 'F') return null
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return null
  if (phase !== 'idle' && phase !== 'sent') return null
  return isTyping(e.target as El) ? null : 'start'
}

// ── the frame's answers ─────────────────────────────────────────────────────

function str(x: unknown, max: number): string { return typeof x === 'string' ? x.slice(0, max) : '' }

/** A target as the page sent it, checked; null when it is not one. */
export function targetFrom(x: unknown): FeedbackTarget | null {
  if (!x || typeof x !== 'object') return null
  const t = x as Record<string, unknown>
  const kind = KINDS.find(k => k === t.kind)
  const label = str(t.label, 120).trim()
  if (!kind || !label) return null
  return { kind, id: str(t.id, 200), label }
}

function rectFrom(x: unknown): Rect {
  const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return { x: n(r.x), y: n(r.y), w: n(r.w), h: n(r.h) }
}

/**
 * A message from the open tool's frame (AppRuntime hears only its own).
 * `offset` is where the frame sits in the shell, so the card lands next to
 * what was picked. Returns whether it was one of ours.
 */
export function fromFrame(m: unknown, offset: { x: number; y: number }): boolean {
  const msg = m as { type?: unknown; target?: unknown; rect?: unknown; version?: unknown; title?: unknown } | null
  if (msg?.type === 'clan:feedback-key') {
    if (state.phase === 'idle' || state.phase === 'sent') startPointing()
    return true
  }
  if (msg?.type !== 'clan:feedback-picked') return false
  if (state.phase !== 'pointing') return true
  const target = targetFrom(msg.target)
  if (!target) { cancelPointing(); return true }
  const r = rectFrom(msg.rect)
  const page = { version: str(msg.version, 40).trim() || null, title: str(msg.title, 160).trim() || null }
  pick({ target, in: 'app', rect: { x: r.x + offset.x, y: r.y + offset.y, w: r.w, h: r.h }, page })
  return true
}

// ── the shell's own things ──────────────────────────────────────────────────

interface Node0 {
  tagName?: string
  textContent?: string | null
  getAttribute?: (n: string) => string | null
  closest?: (s: string) => Node0 | null
  querySelector?: (s: string) => Node0 | null
}

const CONTROLS = 'button,a,[role="button"],[role="menuitem"],[role="tab"],[role="switch"],summary,select,input,textarea'
const AREAS = '[data-feedback-label],[aria-label],section,aside,header,nav,main,dialog,[role="dialog"]'

function said(el: Node0, max = 80): string {
  const a = el.getAttribute?.bind(el)
  const t = a?.('data-feedback-label') || a?.('aria-label') || a?.('title') || String(el.textContent || '')
  return t.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** A thing in the shell, named: a control by its label, else the area it sits in. */
export function describeShell(el: Node0 | null): { target: FeedbackTarget; el: Node0 } | null {
  if (!el?.closest) return null
  const c = el.closest(CONTROLS)
  if (c) {
    const label = said(c) || String(c.tagName || 'control').toLowerCase()
    return { target: { kind: 'control', id: c.getAttribute?.('data-dogfood') || label, label }, el: c }
  }
  const a = el.closest(AREAS)
  if (a) {
    const h = a.querySelector?.('h1,h2,h3')
    const label = a.getAttribute?.('data-feedback-label') || a.getAttribute?.('aria-label') || (h ? said(h) : '') || 'This screen'
    return { target: { kind: 'section', id: a.getAttribute?.('id') || String(a.tagName || '').toLowerCase(), label: label.slice(0, 80) }, el: a }
  }
  return { target: { kind: 'section', id: 'screen', label: 'This screen' }, el }
}

// ── the note card ───────────────────────────────────────────────────────────

const NOUN: Record<TargetKind, string> = { part: 'part', section: 'section', fact: 'fact', finding: 'finding', control: 'button' }

/**
 * "ABOUT · The barrier · Brief v1 · Welcome Back, Barista": the document's own version, as its
 * page names it; a pick in the shell has none, and the tool stands alone (never the tool's version).
 */
export function aboutLine(t: FeedbackTarget, d: FeedbackDoc | null, page?: PageDoc): string {
  const tool = d?.tool ? `${d.tool}${page?.version ? ` ${page.version}` : ''}` : ''
  return ['ABOUT', t.label, tool, page?.title || d?.title || ''].filter(Boolean).join(' · ')
}

/** The plain line that says what goes with the note. */
export function sentWithLine(t: FeedbackTarget, d: FeedbackDoc | null): string {
  if (!d) return `Sent with: your name, this ${NOUN[t.kind]}, and the screen you are on.`
  return `Sent with: your name, this ${NOUN[t.kind]}, the ${d.noun}'s version, and the job running now (${d.jobs[0] ?? 'none'}).`
}

/** Where the card goes: under what was picked, a little in, kept on screen. */
export function cardSpot(r: Rect, view: { w: number; h: number }, card = { w: 360, h: 300 }): { left: number; top: number } {
  const left = Math.max(8, Math.min(r.x + Math.min(r.w * 0.4, 260), view.w - card.w - 8))
  const below = r.y + r.h + 8
  const top = below + card.h <= view.h - 8 ? below : Math.max(8, r.y - card.h - 8)
  return { left, top }
}

/** The event's data: what was said, what it was about, and where. */
export function pointFeedbackData(kind: NoteKind, text: string, p: Picked, d: FeedbackDoc | null): Record<string, unknown> {
  return {
    kind,
    text: text.trim(),
    target: { kind: p.target.kind, id: p.target.id, label: p.target.label, in: p.in },
    doc_version: d?.version ?? null,
    doc_version_label: p.page?.version ?? null,
    doc_title: p.page?.title || d?.title || null,
    tool: d?.tool ?? null,
    tool_version: d?.toolVersion ?? null,
    job: d?.jobs[0] ?? null,
  }
}

/** Send the note: one `feedback-point` event, flushed at once; then the thanks. */
export function sendNote(kind: NoteKind, text: string) {
  if (state.phase !== 'note') return
  const p = state.picked
  feedbackPoint(`${p.target.kind}: ${p.target.label}`, pointFeedbackData(kind, text, p, doc))
  set({ phase: 'sent' })
}

/** The thanks has been read: back to nothing. */
export function doneSent() { if (state.phase === 'sent') set({ phase: 'idle' }) }

/** For tests: back to the start. */
export function __resetPoint() { state = { phase: 'idle' }; doc = null; frame = null }
