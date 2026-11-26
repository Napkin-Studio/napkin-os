// The texts linked into a node are its input words (features/canvas-text.clan), but a storyboard frame reads only its
// own shot's (UAT round 3 R3-12 and round 4 S2-1, the live repro: a 4-beat note linked into the Script that drives the
// storyboard reached every frame job, and frame 3 came back as a 2x2 collage of all four beats).

import { describe, expect, it } from 'vitest'
import type { JobInput, ProductionDocument } from '../contracts/types'
import { linkedTexts, withLinkedText } from './linkedText'

const NOTE = 'Mia, a woman in her thirties with long blonde braided hair and a yellow raincoat, finds a lost puppy in the rain on a city street. 1: Mia spots the shivering puppy under a bench. 2: She kneels and wraps it in her scarf. 3: She carries it into a warm corner cafe. 4: The puppy laps milk from a saucer while Mia laughs. Four shots, no dialogue.'
const ID = (p: string, n: number) => `${p}_01M7Y1CS5CF881A1QHSC32B3A${n}`

/** The round-4 project: note -> Script (note), Script -> Storyboard (drives), four shots; a text linked into shot 3. */
function repro(): ProductionDocument {
  const script = ID('script', 1), sb = ID('sb', 1), note = ID('text', 1), own = ID('text', 2)
  const shots = Object.fromEntries([1, 2, 3, 4].map((n) => [ID('shot', n), { id: ID('shot', n), v: 1, field_v: {}, storyboard_id: sb, kind: 'shot', action: `beat ${n}`, duration_s: 3.5 }]))
  const link = (id: string, from: { kind: string; id: string }, to: { kind: string; id: string }, role: string) => ({ id, v: 1, field_v: {}, from, to, role })
  return {
    scripts: { [script]: { id: script, v: 1, field_v: {}, title: 'Script 2' } },
    storyboards: { [sb]: { id: sb, v: 1, field_v: {}, target_s: 14 } },
    shots,
    texts: { [note]: { id: note, v: 1, field_v: {}, node: 'el_note', words: NOTE }, [own]: { id: own, v: 1, field_v: {}, node: 'el_own', words: 'Low angle, through the cafe window.' } },
    links: {
      [ID('link', 1)]: link(ID('link', 1), { kind: 'text', id: note }, { kind: 'script', id: script }, 'note'),
      [ID('link', 2)]: link(ID('link', 2), { kind: 'script', id: script }, { kind: 'storyboard', id: sb }, 'drives'),
      [ID('link', 3)]: link(ID('link', 3), { kind: 'text', id: own }, { kind: 'shot', id: ID('shot', 3) }, 'note'),
    },
    refs: {}, keys: {}, boards: {}, videos: {}, frames: {}, beats: {}, scenes: {}, assets: {}, jobs: {}, asks: {},
  } as unknown as ProductionDocument
}

const frameInput: JobInput = {
  script: 'Shot 1 (@anchor): In the rain on a city street, Mia, in her yellow raincoat, spots a shivering lost puppy under a bench.',
  shot: { id: ID('shot', 3), kind: 'shot', duration_s: 3.5, camera: { size: 'medium_wide', angle: 'eye_level', movement: 'track', movement_speed: 'normal' }, action: 'Mia carries the bundled puppy through the rain and into a warm corner cafe.', refs: [] },
} as unknown as JobInput

describe('a frame reads its own shot, never the note that feeds the script (S2-1)', () => {
  it('frame 3 of the live repro carries no word of the 4-beat note, only the text linked into shot 3', () => {
    const d = repro()
    const { input, rows } = withLinkedText(d, 'frame', { kind: 'shot', id: ID('shot', 3) }, frameInput)
    expect(input.text ?? '').not.toContain('1: Mia spots')
    expect(input.text ?? '').not.toContain('Four shots')
    expect(input.text).toBe('Low angle, through the cafe window.')
    expect(rows.map((r) => r.text)).toEqual(['Low angle, through the cafe window.'])
    expect(input.script).toBe(frameInput.script) // shot 1's beat stays as the anchor's place
  })

  it('a frame of a shot with nothing linked gets no text at all', () => {
    const d = repro()
    const { input } = withLinkedText(d, 'frame', { kind: 'shot', id: ID('shot', 2) }, { ...frameInput, shot: { ...frameInput.shot!, id: ID('shot', 2) } })
    expect(input.text).toBeUndefined()
  })

  it('planning still reads the note: the shot list is made from it', () => {
    const d = repro()
    expect(linkedTexts(d, { kind: 'storyboard', id: ID('sb', 1) }).map((t) => t.words)).toEqual([NOTE])
    const { input } = withLinkedText(d, 'shot_list', { kind: 'storyboard', id: ID('sb', 1) }, { script: 'x' } as JobInput)
    expect(input.text).toContain('3: She carries it into a warm corner cafe.')
  })
})
