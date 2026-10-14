// scopeOf over the contract's example ad (contracts/examples/document.ad.json) and small edits of it:
// what a node gets from its links, upstream, and its own text (ui-behaviour 3.16, 3.4, 3.6).

import { describe, expect, it } from 'vitest'
import type { Link, ProductionDocument } from '../contracts/types'
import { loadJson } from '../test/schemas'
import { inputChips, nodeKindOf, scopeOf, scopeRefs } from './scope'

const ex = loadJson<ProductionDocument>('examples/document.ad.json')
const fresh = (): ProductionDocument => structuredClone(ex)
const SB = 'storyboard_01K7A000000000000000000012'
const SCRIPT = 'script_01K7A00000000000000000000Z'
const VIDEO = 'video_01K7A000000000000000000027'
const SKETCH = 'sketch_01K7A000000000000000000021'
const S15 = 'shot_01K7A000000000000000000015'
const S16 = 'shot_01K7A000000000000000000016'
const MAYA_FRONT = 'ref_01K7A00000000000000000000N'
const MAYA_SIDE = 'ref_01K7A00000000000000000000P'
const LOC_BEACH = 'ref_01K7A00000000000000000000Q'
const GOLDEN = 'ref_01K7A00000000000000000000R'
const BOTTLE = 'ref_01K7A00000000000000000000S'
const link = (from: Link['from'], to: Link['to'], role: Link['role'], id = `link_x${Math.random().toString(36).slice(2, 8)}`): Link => ({ id, v: 1, field_v: {}, from, to, role })

describe('scopeOf', () => {
  it('knows what kind a node id is', () => {
    expect(nodeKindOf(ex, SB)).toBe('storyboard')
    expect(nodeKindOf(ex, SCRIPT)).toBe('script')
    expect(nodeKindOf(ex, SKETCH)).toBe('sketch')
    expect(nodeKindOf(ex, 'nope')).toBeNull()
  })

  it('a storyboard: its script, its reference with role, boards with their pictures, group, note and brand', () => {
    const items = scopeOf(ex, SB)
    const chips = inputChips(items)
    expect(chips.map((c) => c.label)).toEqual([
      'Script · First Light', 'Locations · 1', 'Brand · Lumen · 5', 'Group', '@maya_front', 'Note',
    ])
    expect(chips.find((c) => c.kind === 'ref')).toMatchObject({ id: MAYA_FRONT, role: 'character', name: 'maya_front', via: 'link' })
    // the Locations board brings its picture in, right after it
    const loc = items.findIndex((i) => i.label === 'Locations · 1')
    expect(items[loc + 1]).toMatchObject({ id: LOC_BEACH, via: 'board', through: 'board_01K7A00000000000000000000C', role: 'location' })
  })

  it('takes what the script has linked in (upstream), and says which shots name each reference', () => {
    const items = scopeOf(ex, SB)
    expect(items.find((i) => i.kind === 'document')).toMatchObject({ via: 'upstream', through: SCRIPT, role: 'context', label: 'client_notes.docx · 2 pages' })
    expect(items.find((i) => i.id === MAYA_FRONT)!.usedBy).toEqual([S15])
    expect(items.find((i) => i.id === LOC_BEACH)!.usedBy).toEqual([S15])
  })

  it('a reference named in the text but not linked shows as a mention, with its shots', () => {
    const it = scopeOf(ex, SB).find((i) => i.id === BOTTLE)!
    expect(it).toMatchObject({ via: 'mention', name: 'product_bottle', usedBy: [S16] })
    expect(it.linkId).toBeUndefined()
  })

  it('an @word that names nothing is an unknown name (3.6), and a typed @name resolves', () => {
    const d = fresh()
    d.shots[S16].action = 'A @jogger runs past @maya_side.'
    const items = scopeOf(d, SB)
    expect(items.find((i) => i.kind === 'unknown')).toMatchObject({ id: 'jogger', label: '@jogger', usedBy: [S16] })
    expect(items.find((i) => i.id === MAYA_SIDE)).toMatchObject({ via: 'mention', usedBy: [S16] })
    expect(scopeRefs(items).map((i) => i.label)).toContain('@jogger')
  })

  it('updates with the links: one added shows, one removed goes', () => {
    const d = fresh()
    const l = link({ kind: 'ref', id: GOLDEN }, { kind: 'script', id: SCRIPT }, 'lighting')
    d.links[l.id] = l
    expect(inputChips(scopeOf(d, SCRIPT)).map((c) => c.label)).toContain('golden hour · lighting')
    // and the storyboard sees it upstream
    expect(scopeOf(d, SB).find((i) => i.id === GOLDEN)).toMatchObject({ via: 'upstream', through: SCRIPT, role: 'lighting' })
    delete d.links[l.id]
    expect(scopeOf(d, SCRIPT).some((i) => i.id === GOLDEN)).toBe(false)
  })

  it('a reference linked with another role than its own says the role; a labelled one uses its label', () => {
    const d = fresh()
    const l = link({ kind: 'ref', id: BOTTLE }, { kind: 'script', id: SCRIPT }, 'composition')
    d.links[l.id] = l
    expect(scopeOf(d, SCRIPT).find((i) => i.id === BOTTLE)!.label).toBe('@product_bottle · composition')
    d.refs[GOLDEN].label = 'golden hour'
    expect(scopeOf(d, SKETCH).find((i) => i.id === GOLDEN)!.label).toBe('golden hour · lighting')
  })

  it('a sketch area: its lighting reference and the ink linked as a note, drawn', () => {
    const items = scopeOf(ex, SKETCH)
    expect(items.map((i) => [i.kind, i.role])).toEqual([['ref', 'lighting'], ['ink', 'note']])
    expect(items[1].drawn).toBe(true)
  })

  it('a video: its storyboard, and through it the script and everything they link in', () => {
    const items = scopeOf(ex, VIDEO)
    expect(inputChips(items).map((i) => i.label)).toEqual(['Storyboard · First Light'])
    expect(items.find((i) => i.kind === 'script')).toMatchObject({ via: 'upstream', through: SB })
    expect(items.find((i) => i.id === MAYA_FRONT)).toMatchObject({ via: 'upstream' })
    expect(items.find((i) => i.kind === 'document')).toMatchObject({ via: 'upstream', through: SCRIPT })
  })

  it('a reference both on a linked board and linked itself keeps its own chip', () => {
    const d = fresh()
    const l = link({ kind: 'ref', id: LOC_BEACH }, { kind: 'storyboard', id: SB }, 'location', 'link_a0') // sorts before the board's link
    d.links[l.id] = l
    const items = scopeOf(d, SB)
    expect(items.filter((i) => i.id === LOC_BEACH)).toHaveLength(1)
    expect(items.find((i) => i.id === LOC_BEACH)!.via).toBe('link')
  })

  it('board membership can come from the canvas', () => {
    const items = scopeOf(ex, SB, { members: (e) => (e.kind === 'group' ? [MAYA_SIDE, GOLDEN] : undefined) })
    expect(items.find((i) => i.kind === 'group')!.label).toBe('Group · 2')
    expect(items.find((i) => i.id === MAYA_SIDE)).toMatchObject({ via: 'board', through: 'grpQ7xK2mP' })
  })

  it('a script names what its scenes mention, and nothing loops', () => {
    const d = fresh()
    const sc = Object.values(d.scenes).find((s) => s.script_id === SCRIPT && s.text)!
    sc.text = 'Maya laughs at @loc_beach.'
    const back = link({ kind: 'storyboard', id: SB }, { kind: 'script', id: SCRIPT }, 'drives')
    d.links[back.id] = back
    const items = scopeOf(d, SCRIPT)
    expect(items.find((i) => i.id === LOC_BEACH)).toBeTruthy()
    expect(items.filter((i) => i.kind === 'storyboard')).toHaveLength(1)
  })
})

describe('scopeOf reads the live text too', () => {
  it('typed @words inside the prose, and a mention whose reference is gone, are unknown names', () => {
    const d = fresh()
    d.shots[S16].prose = { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'A @jogger runs past ' }, { type: 'mention', attrs: { id: 'ref_gone', label: 'old_name' } }] }] }
    const unknown = scopeOf(d, SB).filter((i) => i.kind === 'unknown').map((i) => i.name)
    expect(unknown.sort()).toEqual(['jogger', 'old_name'])
  })

  it('a script counts the shots of the storyboard it drives, scene or not', () => {
    const d = fresh()
    d.shots[S16].action = 'A @jogger.'
    delete d.shots[S16].scene_id
    expect(scopeOf(d, SCRIPT).find((i) => i.kind === 'unknown')).toMatchObject({ name: 'jogger', usedBy: [S16] })
  })
})
