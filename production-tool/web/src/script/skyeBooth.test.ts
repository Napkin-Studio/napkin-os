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

describe('an edit card reads line by line (UAT round 3, R3-F7)', () => {
  it('shows a rewritten line as its old line then its new line, words marked only inside them', async () => {
    const { cardLines, lineDiff } = await import('./skyeBooth')
    const before = [
      { kind: 'action', text: '1 a.m. A dark kitchen.' },
      { kind: 'action', text: 'A flatmate in socks and dressing gown creeps in, bracing for noise.' },
      { kind: 'character', text: 'WOMAN' },
      { kind: 'dialogue', text: 'Good boy.' },
    ]
    const after = [
      { kind: 'action', text: '1 a.m. A dark kitchen.' },
      { kind: 'action', text: 'A flatmate in a dressing gown flips the switch, wincing.' },
    ]
    const lines = cardLines(lineDiff(before, after))
    const text = (l: (typeof lines)[number]) => l.parts.map((p) => p.text).join('')
    expect(lines.map((l) => [l.kind, l.change, l.side ?? ''])).toEqual([
      ['action', 'same', ''], ['action', 'changed', 'was'], ['action', 'changed', 'now'], ['character', 'gone', ''], ['dialogue', 'gone', ''],
    ])
    // Each side reads whole: the old line as it was, the new as it will be.
    expect(text(lines[1])).toBe(before[1].text)
    expect(text(lines[2])).toBe(after[1].text)
    expect(lines[1].parts.some((p) => p.kind === 'new')).toBe(false)
    expect(lines[2].parts.some((p) => p.kind === 'gone')).toBe(false)
    // A phrase cut is one struck run, its space included.
    expect(lines[1].parts.filter((p) => p.kind === 'gone').map((p) => p.text)).toContain('socks and')
  })
})

describe('a draft card names the item it was asked about (UAT round 5, R5-F5)', () => {
  const sug = (kind: 'scene' | 'shot' | 'beat', mode: 'revise' | 'draft' = 'revise') => ({ target: { kind, id: `${kind}_X` }, mode, note: 'I did what you asked.' }) as never
  const write = { intent: 'instruct', instruction: 'Make the snoring line funnier' } as never
  it('a shot ask: "Shot 6, from"; a line: "This line, from"; the scene: the whole script', async () => {
    const { askedWords } = await import('./skyeBooth')
    expect(askedWords(write, sug('shot'), undefined, 'Shot 6')).toEqual({ lead: 'Shot 6, from', quote: 'Make the snoring line funnier' })
    expect(askedWords(write, sug('beat'))).toEqual({ lead: 'This line, from', quote: 'Make the snoring line funnier' })
    expect(askedWords(write, sug('scene'))).toEqual({ lead: 'The whole script, from', quote: 'Make the snoring line funnier' })
    expect(askedWords(write, sug('shot', 'draft'), undefined, 'Shot 6').lead).toBe('From your words')
  })
})
