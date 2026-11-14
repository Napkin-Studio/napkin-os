// The in-browser mock relay's Skye (features/script-editor.clan): a plain, predictable draft per
// intent, as the relay's PassthroughWriter answers with no model (relay/writer.py). The target
// and base_hash are the input's, echoed, as the relay does.

import type { Write, WriteInput } from '../contracts/types'

const firstSentence = (t: string) => t.trim().split(/(?<=[.!?])\s+/)[0] ?? t

const NOTE: Record<WriteInput['intent'], (w: WriteInput) => string> = {
  tighten: () => 'I tightened it.',
  fit_seconds: (w) => `I tightened it to fit ${w.seconds ?? 0} s.`,
  rephrase: () => 'I said it another way.',
  add_beat: () => 'I added a beat.',
  write_vo: () => 'I wrote the VO.',
  draft: () => 'I drafted it from your line.',
  cut_name: (w) => `I cut @${w.name ?? ''}.`,
}

export function mockWrites(w: WriteInput): Write[] {
  const lines = w.lines.map((l) => ({ ...l }))
  const words = lines.map((l) => l.text).join(' ')
  const d: Write = { target: w.target, base_hash: w.base_hash, note: NOTE[w.intent](w), lines }
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
      d.lines = [{ type: 'action', text: words.trim() || 'An idea in a line.' }, { type: 'action', text: 'We hold on it, then cut to the end card.' }]
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
