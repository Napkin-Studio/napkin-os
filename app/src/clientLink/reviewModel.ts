// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The review link's page as plain functions (features/client-review-full.clan): the words said about a
// round and a piece, where a tap lands as a fraction of the piece's own box, and how a reviewer's marks
// on each piece come to one answer. Nothing here fetches.

export type Kind = 'text' | 'image' | 'film' | 'audio'

export interface Piece { n: number; label: string; kind: Kind; ai: string; duration_ms: number | null }

export interface Pin { x?: number; y?: number; t_ms?: number }

export interface Remark { id: string; piece: number; pin: Pin | null; tag: string; text: string }

export type Mark = 'approve' | 'changes'

/** `Version 2`: the Nth signed version of the document, as people count it. */
export function versionWords(n: number | null): string {
  return n && n > 0 ? `Version ${n}` : 'Signed version'
}

/** `Round 2 of 3` when the job's route says how many rounds, else `Round 2`. */
export function roundWords(round: number, inScope: number | null): string {
  return inScope && inScope >= round ? `Round ${round} of ${inScope}` : `Round ${round}`
}

/** Nothing is called AI-free without a record. */
export function aiWords(ai: string): string {
  if (ai === 'ai') return 'Made with AI'
  if (ai === 'none') return 'Not made with AI'
  return 'AI use not recorded'
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** A tap at (clientX, clientY) in a box, as fractions of the box (three decimals), so a pin means the
 *  same place on a phone and on a desk screen. */
export function pinFromPoint(box: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null
  const r = (n: number) => Math.round(clamp01(n) * 1000) / 1000
  return { x: r((clientX - box.left) / box.width), y: r((clientY - box.top) / box.height) }
}

/** Where a pin is drawn inside its box. */
export function pinStyle(pin: Pin): { left: string; top: string } | null {
  if (pin.x === undefined || pin.y === undefined) return null
  return { left: `${(pin.x * 100).toFixed(1)}%`, top: `${(pin.y * 100).toFixed(1)}%` }
}

/** `0:04` for 4,000 ms. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Where a remark was made, in words. */
export function whereWords(pin: Pin | null): string {
  if (!pin) return 'On the whole piece'
  if (pin.t_ms !== undefined) return `At ${clock(pin.t_ms)}`
  return 'At a spot'
}

/** One answer from the marks on each piece: confirm only when every piece is approved. `null` while a
 *  piece has no mark. */
export function overall(pieces: readonly Piece[], marks: Readonly<Record<number, Mark>>): 'confirm' | 'changes' | null {
  if (pieces.some(p => marks[p.n] === undefined)) return null
  return pieces.every(p => marks[p.n] === 'approve') ? 'confirm' : 'changes'
}

/** The first piece, after `from`, that still has no mark (wrapping round), or null. */
export function nextUnmarked(pieces: readonly Piece[], marks: Readonly<Record<number, Mark>>, from: number): number | null {
  const order = [...pieces.filter(p => p.n > from), ...pieces.filter(p => p.n <= from)]
  return order.find(p => marks[p.n] === undefined)?.n ?? null
}

/** What the answer's body holds: the answer, and a mark on each piece. Who, version, round and channel are
 *  the link's, never the page's. */
export function answerBody(pieces: readonly Piece[], marks: Readonly<Record<number, Mark>>): { answer: 'confirm' | 'changes'; pieces: { piece: number; answer: Mark }[] } | null {
  const answer = overall(pieces, marks)
  if (!answer) return null
  return { answer, pieces: pieces.map(p => ({ piece: p.n, answer: marks[p.n] })) }
}
