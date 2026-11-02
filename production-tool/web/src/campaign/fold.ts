// Which lanes of a Campaign board are folded into stacks (features/art-director.clan, slice 2). A board
// with more than STACK_OVER sizes starts folded, one with fewer open; a person's own fold or unfold of a
// lane is kept for this browser and wins. A tiny store for useSyncExternalStore, like sheet.ts and pick.ts.

import type { FormatChannel } from '../contracts/types'

/** More sizes than this and a board starts as stacks (the owner's mock: Auto, by count). */
export const STACK_OVER = 12

const choice = new Map<string, boolean>() // `${setId}:${channel}` -> folded
let version = 0
const subs = new Set<() => void>()
const emit = () => { version++; for (const f of subs) f() }
const key = (setId: string, channel: FormatChannel) => `${setId}:${channel}`

/** Whether a lane is folded: the person's choice, else the board's size decides. */
export function isFolded(setId: string, channel: FormatChannel, sizeCount: number): boolean {
  return choice.get(key(setId, channel)) ?? sizeCount > STACK_OVER
}

export const campaignFold = {
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn) } },
  /** Changes whenever any fold changes: what useSyncExternalStore reads. */
  version: () => version,
  set(setId: string, channel: FormatChannel, folded: boolean) { choice.set(key(setId, channel), folded); emit() },
  toggle(setId: string, channel: FormatChannel, sizeCount: number) { campaignFold.set(setId, channel, !isFolded(setId, channel, sizeCount)) },
  /** Fold or unfold every lane of a board at once. */
  setAll(setId: string, channels: readonly FormatChannel[], folded: boolean) { for (const c of channels) choice.set(key(setId, c), folded); emit() },
  /** Back to the automatic rule (tests, and a board that is deleted). */
  reset(setId?: string) { for (const k of [...choice.keys()]) if (!setId || k.startsWith(`${setId}:`)) choice.delete(k); emit() },
}
