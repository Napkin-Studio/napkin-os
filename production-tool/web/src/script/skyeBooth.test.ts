import { describe, expect, it } from 'vitest'

describe('an edit card in screenplay layout (UAT 2026-11-21, script UX 1)', () => {
  it('keeps cues and parentheticals as lines; only a rewritten line is diffed word by word', async () => {
    const { lineDiff } = await import('./skyeBooth')
    const before = [{ kind: 'action', text: 'The kettle boils.' }, { kind: 'character', text: 'MAYA' }, { kind: 'parenthetical', text: '(softly)' }, { kind: 'dialogue', text: 'Good boy.' }]
    const after = [{ kind: 'action', text: 'The kettle boils.' }, { kind: 'character', text: 'MAYA' }, { kind: 'parenthetical', text: '(whispering)' }, { kind: 'dialogue', text: 'Good boy.' }]
    const rows = lineDiff(before, after)
    expect(rows.map((r) => [r.kind, r.change])).toEqual([['action', 'same'], ['character', 'same'], ['parenthetical', 'changed'], ['dialogue', 'same']])
    expect(rows[2].parts.filter((p) => p.kind !== 'same').map((p) => p.text)).toEqual(['(softly)', '(whispering)'])
  })
})
