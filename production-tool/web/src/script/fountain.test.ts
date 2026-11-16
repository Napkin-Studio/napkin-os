// Fountain import (features/script-editor.clan). Every fixture here is ours.

import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { fountainProse } from './edits'
import { checkSizes, droppedLine, FountainTooBig, parseFountain, sceneFlat } from './fountain'

const SCRIPT = `Title: First Light
Credit: written by
Author: Napkin Studio
Draft date: 2026-10-13

# ACT ONE

= Maya greets the sea.

EXT. BEACH - DAWN

@maya_front walks the waterline. The light is low and gold.

MAYA
(quietly)
It's perfect.

[[Laurence: tighter here]]

CUT TO:

.INSIDE THE CAR

The jogger runs past far behind @maya_front.

@McCLANE
Yippee.

INT./EXT. CAR - DAY

BRICK ^
Dual one.

STEEL
Dual two.

I/E VAN - NIGHT

> THE END <

/* An old scene
EXT. NOWHERE - DAY
Cut. */

EST. CITY - DUSK

!SHOUTING FROM BELOW
`

describe('parseFountain', () => {
  const s = parseFountain(SCRIPT)

  it('takes the title page Title', () => {
    expect(s.title).toBe('First Light')
  })

  it('makes one scene per heading, forced "." and INT./EXT. and I/E and EST. included', () => {
    expect(s.scenes.map((x) => x.heading)).toEqual(['EXT. BEACH - DAWN', 'INSIDE THE CAR', 'INT./EXT. CAR - DAY', 'I/E VAN - NIGHT', 'EST. CITY - DUSK'])
  })

  it('keeps characters, parentheticals and dialogue; a transition keeps its own block', () => {
    expect(s.scenes[0].blocks).toEqual([
      { type: 'action', text: '@maya_front walks the waterline. The light is low and gold.' },
      { type: 'character', text: 'MAYA' },
      { type: 'parenthetical', text: 'quietly' },
      { type: 'dialogue', text: "It's perfect." },
      { type: 'transition', text: 'CUT TO:' },
    ])
  })

  it('a forced @NAME character loses its @; a dual cue marks its dialogue dual', () => {
    expect(s.scenes[1].blocks).toContainEqual({ type: 'character', text: 'McCLANE' })
    expect(s.scenes[2].blocks).toEqual([
      { type: 'character', text: 'BRICK' },
      { type: 'dialogue', text: 'Dual one.', dual: true },
      { type: 'character', text: 'STEEL' },
      { type: 'dialogue', text: 'Dual two.' },
    ])
  })

  it('centred text keeps its own block; forced action stays action', () => {
    expect(s.scenes[3].blocks).toEqual([{ type: 'centered', text: 'THE END' }])
    expect(s.scenes[4].blocks).toEqual([{ type: 'action', text: 'SHOUTING FROM BELOW' }])
  })

  it('drops sections, synopses, notes and the boneyard, and counts them', () => {
    expect(s.dropped).toEqual({ sections: 1, synopses: 1, notes: 1, boneyard: 1 })
    expect(droppedLine(s.dropped)).toBe('Left out 1 section, 1 synopsis, 1 note and 1 boneyard block.')
    expect(s.scenes.some((x) => x.heading.includes('NOWHERE'))).toBe(false)
  })

  it('fountainProse puts the dual mark on a dual dialogue block, and leaves a plain one untouched', () => {
    const d = { refs: {}, keys: {} } as unknown as ProductionDocument
    const prose = fountainProse(d, [
      { type: 'character', text: 'BRICK' },
      { type: 'dialogue', text: 'Dual one.', dual: true },
      { type: 'dialogue', text: 'Plain.' },
      { type: 'transition', text: 'CUT TO:' },
      { type: 'centered', text: 'THE END' },
    ])
    expect(prose.content).toEqual([
      { type: 'character', content: [{ type: 'text', text: 'BRICK' }] },
      { type: 'dialogue', content: [{ type: 'text', text: 'Dual one.', marks: [{ type: 'dual' }] }] },
      { type: 'dialogue', content: [{ type: 'text', text: 'Plain.' }] },
      { type: 'transition', content: [{ type: 'text', text: 'CUT TO:' }] },
      { type: 'centered', content: [{ type: 'text', text: 'THE END' }] },
    ])
  })

  it('text before the first heading is a scene with no heading', () => {
    const p = parseFountain('A line with no scene.\n\nINT. ROOM - DAY\n\nInside.')
    expect(p.scenes.map((x) => x.heading)).toEqual(['', 'INT. ROOM - DAY'])
  })

  it('is refused, naming the scene, when a scene would pass 20,000 flat characters', () => {
    const big = parseFountain(`INT. LONG - DAY\n\n${'Words go on. '.repeat(1700)}\n`)
    expect(sceneFlat(big.scenes[0].blocks).length).toBeGreaterThan(20000)
    expect(() => checkSizes(big, () => 1)).toThrow(FountainTooBig)
    expect(() => checkSizes(big, () => 1)).toThrow(/“INT. LONG - DAY” is 22,099 characters/)
    expect(() => checkSizes(s, () => 70 * 1024)).toThrow(/over 64 KB/)
  })
})
