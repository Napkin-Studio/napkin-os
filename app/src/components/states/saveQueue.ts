// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shell's save queue (features/screen-states.clan): every write an app
// makes through its bridge is reported here (`clan:write`), so the shell knows
// when one did not land. The bridge in the frame holds the pending write and
// sends it again when asked (`clan:retry {id}`); the queue holds the text, the
// state and the id, and never a patch of its own, so it cannot fight the host's
// version check. A write the host refuses as stale (409) shows the Changed
// state and is never forced over the newer version.
//
// The queue is behind this one small interface, with an in-memory store now.
// Phase 2's offline presenter needs a different one; nothing else imports the
// store (record rework_risks).

export type WriteState = 'saving' | 'saved' | 'failed' | 'changed'

/** What the bridge says about one write. */
export interface WriteReport {
  id: string
  state: WriteState
  /** The field or fields written, as the app addressed them. */
  field: string
  /** The text typed, when the value was text; kept so nothing the person wrote is lost. */
  text: string
}

export interface Write extends WriteReport {
  /** How many times the shell asked for it again. */
  retries: number
}

const STATES: readonly string[] = ['saving', 'saved', 'failed', 'changed']
const MAX_TEXT = 20_000

/** A bridge message, as a report; null for anything else (a frame can send anything). */
export function writeFrom(message: unknown): WriteReport | null {
  const m = message as { type?: unknown; v?: unknown; id?: unknown; state?: unknown; field?: unknown; text?: unknown } | null
  if (!m || m.type !== 'clan:write' || m.v !== 1) return null
  if (typeof m.id !== 'string' || !m.id || m.id.length > 64) return null
  if (typeof m.state !== 'string' || !STATES.includes(m.state)) return null
  return {
    id: m.id,
    state: m.state as WriteState,
    field: typeof m.field === 'string' ? m.field.slice(0, 200) : '',
    text: typeof m.text === 'string' ? m.text.slice(0, MAX_TEXT) : '',
  }
}

/** What the shell shows for the document as a whole. */
export type SaveState = 'idle' | 'saving' | 'failed' | 'changed'

export interface SaveQueue {
  /** A report from the bridge. */
  report(r: WriteReport): void
  /** The person pressed Try again: ask the frame to send each failed write again, once each. */
  retry(): number
  /** Who sends `clan:retry` to the frame; set by the runtime that owns the frame. */
  attach(send: ((id: string) => void) | null): void
  /** Forget everything (another document opened). */
  clear(): void
  state(): SaveState
  /** Writes that did not land, oldest first. */
  unsaved(): Write[]
  subscribe(fn: () => void): () => void
  /** A counter that changes when the queue does (for useSyncExternalStore). */
  version(): number
}

export function createSaveQueue(): SaveQueue {
  const writes = new Map<string, Write>()
  const listeners = new Set<() => void>()
  let send: ((id: string) => void) | null = null
  let v = 0
  const changed = () => { v++; for (const fn of listeners) fn() }
  return {
    report(r) {
      const was = writes.get(r.id)
      // A report of a write already saved, arriving late, changes nothing.
      if (was?.state === 'saved' && r.state !== 'saved') return
      writes.set(r.id, { ...r, text: r.text || was?.text || '', retries: was?.retries ?? 0 })
      // Saved writes are only kept while another is unsettled, so the map stays small.
      if (r.state === 'saved') writes.delete(r.id)
      changed()
    },
    retry() {
      let asked = 0
      for (const w of writes.values()) {
        if (w.state !== 'failed') continue
        w.retries++
        // Shown as saving again until the bridge reports; a lost reply leaves it failed on the next report.
        w.state = 'saving'
        send?.(w.id)
        asked++
      }
      if (asked) changed()
      return asked
    },
    attach(s) { send = s },
    clear() { if (writes.size) { writes.clear(); changed() } },
    state() {
      let saving = false
      for (const w of writes.values()) {
        if (w.state === 'changed') return 'changed'
      }
      for (const w of writes.values()) {
        if (w.state === 'failed') return 'failed'
        if (w.state === 'saving') saving = true
      }
      return saving ? 'saving' : 'idle'
    },
    unsaved() { return [...writes.values()].filter(w => w.state === 'failed' || w.state === 'changed') },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    version() { return v },
  }
}
