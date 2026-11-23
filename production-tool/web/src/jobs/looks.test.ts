// UAT round 5, S2-A (features/pt-canvas-r5.clan): frames lost the person's look from the note. The live repro: the note
// "Leo, a man in his forties with a short grey beard and a red knitted beanie, cycles to work. 1: … 4: …" made a script
// that drives a storyboard; Dex's shot list left the look out ("Leo's look is in the script"), and frame 1 got only
// "Leo unlocks his bike outside a bakery at dawn." (an older man in an olive beanie).
import { describe, expect, it } from 'vitest'
import { updateDoc } from '../doc/store'
import { putBlob } from '../lib/blobs'
import { mainScript, scriptText, shotsOf } from '../model/selectors'
import { MockRelay } from '../relay/mock'
import { addScene, addShots, planned, snapshotDoc } from '../test/jobFixtures'
import { frameInput } from './frames'
import { lookLine, looksIn } from './looks'

const NOTE = 'Leo, a man in his forties with a short grey beard and a red knitted beanie, cycles to work. 1: Leo unlocks his bike outside a bakery at dawn. 2: He rides along a misty canal path. 3: He stops on a stone bridge to watch rowers pass below. 4: He hangs the bike on the wall of his woodwork shop and smiles. Four shots, no dialogue.'
const LOOK = 'a man in his forties with a short grey beard and a red knitted beanie'

describe('a person\'s look, read from the script', () => {
  it('the live note: Leo\'s introduction, never a beat', () => {
    expect([...looksIn(NOTE)]).toEqual([['leo', LOOK]])
  })
  it('a Fountain intro, "is a", "wears"; a place is not a person', () => {
    expect(looksIn('LEO (40s, short grey beard, red beanie) unlocks his bike.').get('leo')).toBe('40s, short grey beard, red beanie')
    expect(looksIn('Mia is a woman in her thirties with long blonde braids. She runs.').get('mia')).toBe('a woman in her thirties with long blonde braids')
    expect(looksIn('Ruby wears a yellow raincoat and green boots.').get('ruby')).toBe('wears a yellow raincoat and green boots')
    expect(looksIn('Paris, a city of light, wakes up. 1: Leo cycles.').size).toBe(0)
    expect(looksIn('1: Leo unlocks his bike outside a bakery at dawn.').size).toBe(0)
  })
})

describe('every frame a person is in carries their look, and no beat of another shot (S2-A)', () => {
  /** The live project: the note linked into the Script that drives the storyboard (New storyboard from this text);
   *  planning moved the script's words into the shots, so the note is where the look still is. */
  async function repro() {
    const doc = snapshotDoc()
    await updateDoc(doc, (d) => {
      addScene(d, NOTE, '')
      addShots(d, [
        planned('Leo unlocks his bike outside a bakery at dawn.', 4),
        planned('He rides along a misty canal path.', 4),
        planned('He stops on a stone bridge to watch rowers pass below.', 3.5),
        planned('Behind the counter, a baker waves to someone.', 3.5),
      ])
      const note = 'text_01M7Y8BRBCAVJQ48E6A8P1DPK1'
      const link = 'link_01M7Y8BRBCAVJQ48E6A8P1DPK1'
      d.texts = { ...(d.texts ?? {}), [note]: { id: note, v: 1, field_v: {}, node: 'el_note', words: NOTE } } as never
      d.links[link] = { id: link, v: 1, field_v: {}, from: { kind: 'text', id: note }, to: { kind: 'script', id: mainScript(d)!.id }, role: 'note' } as never
    })
    // Planning took the words out of the script: only the shots' actions are left there.
    expect(scriptText(doc.get())).not.toContain('grey beard')
    const relay = new MockRelay({ renderer: { async render() { return [] } }, persistKey: null })
    return { doc, relay }
  }

  it('frame 1 (named) and frame 2 (by pronoun) say Leo\'s look; a shot with someone else does not', async () => {
    const { doc, relay } = await repro()
    const line = lookLine('Leo', LOOK)
    expect(line).toBe(`Look: Leo, ${LOOK}.`)
    const f1 = await frameInput(relay, doc.get(), 0, undefined, false)
    expect(f1.shot?.action).toBe('Leo unlocks his bike outside a bakery at dawn.')
    expect(f1.shot?.direction).toContain(line)
    // No beat and no whole note comes back (S2-1 holds): no collage.
    const all = JSON.stringify(f1)
    for (const beat of ['misty canal', 'stone bridge', 'woodwork shop', 'Four shots']) expect(all).not.toContain(beat)
    // A later frame, drawn side by side before frame 1 is there (loose).
    const f2 = await frameInput(relay, doc.get(), 1, undefined, false)
    expect(f2.shot?.direction).toContain(line)
    expect(JSON.stringify(f2)).not.toContain('woodwork shop')
    const f4 = await frameInput(relay, doc.get(), 3, undefined, false)
    expect(f4.shot?.direction ?? '').not.toContain('Look:')
    expect(shotsOf(doc.get())).toHaveLength(4)
  })

  it('a later frame keeps the look with frame 1 as @anchor', async () => {
    const { doc, relay } = await repro()
    const f1 = await putBlob(new Blob(['frame 1'], { type: 'image/png' }))
    await updateDoc(doc, (d) => {
      const s = shotsOf(d)[0]
      const id = 'frame_01M7Y8DZR64JMXTW3C6XWA9YNB'
      d.assets[f1] = { sha256: f1, kind: 'image', mime: 'image/png', bytes: 7 } as never
      d.frames[id] = { id, v: 1, field_v: {}, shot_id: s.id, asset: f1, version: 1, crew: 'wren', kind: 'mock' } as never
      s.pick = { current: id }
    })
    const f3 = await frameInput(relay, doc.get(), 2, undefined, false)
    expect(f3.anchorFrame?.sha256).toBe(f1)
    expect(f3.shot?.direction).toContain(lookLine('Leo', LOOK))
  })
})
