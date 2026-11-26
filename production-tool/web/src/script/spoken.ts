// How long a spoken line takes (UAT round 5, R5-F2: Plan shots gave the whispered "Good boy." 1.0 s, WAN 3 voiced it
// from 0.4 s to 1.7 s of its 2 s take, and the ad played only 0-1.0 s). The twin of relay/sound.py spoken_need: one rule
// for the shot list (the relay gives a line's shot at least this) and for a voiced lone take's window (rooms/model).
// Words at the band's rate (2.5 a second, compose.ts roughSeconds), whispered slower (2 a second), after a lead-in and
// with a tail, in half seconds. Pure.

import type { Beat } from '../contracts/types'

export const SPOKEN_RATE = 2.5
export const WHISPER_RATE = 2.0
export const LEAD_IN_S = 0.5
export const TAIL_S = 0.5

const SOFT = /\b(?:whisper\w*|murmur\w*|mutter\w*|hush\w*|softly|under (?:her|his|their) breath)\b/i

/** The seconds a line's words take to say: whispered (its parenthetical says so) slower. */
export function spokenSeconds(text: string, parenthetical?: string): number {
  const words = (text.match(/[\p{L}\p{N}']+/gu) ?? []).length
  return words / (SOFT.test(parenthetical ?? '') ? WHISPER_RATE : SPOKEN_RATE)
}

const halfUp = (s: number) => Math.ceil(s * 2 - 1e-6) / 2

/** Where a shot's spoken lines (line and VO beats) end, from its start: the latest line's start (at least the lead-in),
 *  its words, and the tail, in half seconds. 0: the shot says nothing. */
export function spokenEndS(beats: readonly Pick<Beat, 'kind' | 'at_s' | 'text' | 'parenthetical'>[]): number {
  let end = 0
  for (const b of beats) {
    if ((b.kind !== 'line' && b.kind !== 'vo') || !b.text?.trim()) continue
    end = Math.max(end, Math.max(b.at_s ?? 0, LEAD_IN_S) + spokenSeconds(b.text, b.parenthetical) + TAIL_S)
  }
  return end ? halfUp(end) : 0
}
