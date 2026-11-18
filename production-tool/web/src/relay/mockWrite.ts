// The in-browser mock relay's Skye (features/script-editor.clan): a plain, predictable draft per
// intent, as the relay's PassthroughWriter answers with no model (relay/writer.py). The target,
// base_hash and mode are the input's, echoed, as the relay does.

import type { Write, WriteInput } from '../contracts/types'
import { writeMode } from '../contracts/types'

const firstSentence = (t: string) => t.trim().split(/(?<=[.!?])\s+/)[0] ?? t

/** A short screenplay from a brief: a slugline, the premise as action, a close. The real model writes
 *  a proper draft (relay prompts/skye.v6.md); this deterministic stub keeps the shape for the mock. */
export function draftScript(instruction: string | undefined): { type: 'action'; text: string }[] {
  const brief = (instruction ?? '').trim()
  const where = [...brief.matchAll(/\b(?:at|in|inside)\s+(?:the\s+)?([a-z][a-z'-]+)/gi)].at(-1)?.[1]
  const slug = `INT. ${(where ?? 'location').toUpperCase()} - DAY`
  const premise = brief ? `${brief.charAt(0).toUpperCase()}${brief.slice(1)}`.replace(/[.\s]+$/, '') + '.' : 'An idea in a line.'
  return [
    { type: 'action', text: slug },
    { type: 'action', text: premise },
    { type: 'action', text: 'We stay on the effort, then cut to the end card.' },
  ]
}

const NOTE: Record<WriteInput['intent'], (w: WriteInput) => string> = {
  tighten: () => 'I tightened it.',
  fit_seconds: (w) => `I tightened it to fit ${w.seconds ?? 0} s.`,
  rephrase: () => 'I said it another way.',
  add_beat: () => 'I added a beat.',
  write_vo: () => 'I wrote the VO.',
  draft: () => 'I drafted it from your line.',
  cut_name: (w) => `I cut @${w.name ?? ''}.`,
  instruct: () => 'I did what you asked.',
}

export function mockWrites(w: WriteInput): Write[] {
  const lines = w.lines.map((l) => ({ ...l }))
  const words = lines.map((l) => l.text).join(' ')
  const d: Write = { target: w.target, base_hash: w.base_hash, mode: writeMode(w), note: NOTE[w.intent](w), lines }
  switch (w.intent) {
    case 'tighten':
    case 'fit_seconds':
      d.lines = lines.map((l) => (l.type === 'action' ? { ...l, text: firstSentence(l.text) } : l))
      if (w.intent === 'fit_seconds' && w.seconds) d.duration_s = Math.round(Math.min(30, Math.max(0.5, w.seconds)) * 10) / 10
      break
    case 'rephrase':
      d.lines = lines.map((l) => (l.type === 'action' ? { ...l, text: l.text.trim().split(/(?<=[.!?])\s+/).reverse().join(' ') } : l))
      break
    case 'cut_name': {
      const esc = (w.name ?? '').replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
      d.lines = lines.map((l) => ({ ...l, text: l.text.replace(new RegExp(`\\s*@${esc}(?![a-z0-9_-])`, 'g'), '').trim() }))
      break
    }
    case 'draft':
      // A draft writes a short screenplay from the brief (instruction), never the item's own words.
      d.lines = draftScript(w.instruction)
      break
    case 'add_beat':
      d.new_beats = [{ kind: 'moment', at_s: 0.5, text: 'A beat to breathe.' }]
      break
    case 'write_vo':
      d.new_beats = [{ kind: 'vo', at_s: 0, text: `VO: ${firstSentence(words)}`.slice(0, 500) }]
      break
  }
  return [d]
}
