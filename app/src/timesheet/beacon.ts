// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the shell tells the server about a job's document being open and in focus, and no more
// (features/timesheet-sessions.clan). It is a plain object with an injected clock, so what it
// sends over a simulated hour is counted in a test.
//
// The rules: only the document in focus speaks; one `focus` heartbeat at most every 30 seconds;
// a tab that loses focus says so after a few seconds' grace, so flicking between windows sends
// nothing; leaving a document says `close` at once. It sends nothing about what the person does
// in the document: no keys, no clicks, no text.

export const HEARTBEAT_MS = 30_000
export const BLUR_GRACE_MS = 5_000

export type WorkEvent = 'open' | 'focus' | 'blur' | 'close'

export class Beacon {
  private doc: string | null = null
  private focused = true
  /** The server has an open session for `doc` (we said open or focus, and not blur or close since). */
  private live = false
  private lastSent = 0
  private blurredAt: number | null = null

  private readonly send: (event: WorkEvent, doc: string) => void
  private readonly now: () => number

  constructor(send: (event: WorkEvent, doc: string) => void, now: () => number) {
    this.send = send
    this.now = now
  }

  private emit(event: WorkEvent) {
    if (!this.doc) return
    this.send(event, this.doc)
    this.lastSent = this.now()
    this.live = event === 'open' || event === 'focus'
  }

  /** A job's document is now the one on screen. A different one ends the last. */
  open(doc: string) {
    if (this.doc === doc) return
    this.close()
    this.doc = doc
    this.focused = true
    this.blurredAt = null
    this.emit('open')
  }

  /** The document is left, or the shell is. */
  close() {
    if (this.doc && this.live) this.emit('close')
    this.doc = null
    this.live = false
    this.blurredAt = null
  }

  /** The window or tab gained or lost focus. */
  setFocused(focused: boolean) {
    this.focused = focused
    if (focused) {
      this.blurredAt = null
      if (this.doc && !this.live) this.emit('focus')
    } else if (this.blurredAt === null) {
      this.blurredAt = this.now()
    }
  }

  /** Called every few seconds: the blur after its grace, or the heartbeat. */
  tick() {
    if (!this.doc) return
    const t = this.now()
    if (!this.focused && this.blurredAt !== null && t - this.blurredAt >= BLUR_GRACE_MS) {
      if (this.live) this.emit('blur')
      this.blurredAt = null
    } else if (this.focused && this.live && t - this.lastSent >= HEARTBEAT_MS) {
      this.emit('focus')
    }
  }
}

/** Whether the shell may tell the server anything at all: a signed-in person who has said yes, in a document. */
export function capturing(signedIn: boolean, consent: 'not_asked' | 'yes' | 'no' | null, doc: string | null): boolean {
  return signedIn && consent === 'yes' && doc !== null
}
