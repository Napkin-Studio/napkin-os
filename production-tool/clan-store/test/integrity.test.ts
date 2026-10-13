// integrity.ts over the examples, and over broken copies of the overhaul scenario.
import { describe, expect, it } from 'vitest'
import { canLink, integrity, makesLoop, type Doc, type Entity } from '../src/index'
import { example, id } from './fixtures'

const ad = () => structuredClone(example<Doc>('document.ad.json'))
const first = (d: Doc, map: keyof Doc) => Object.values(d[map] as Record<string, Entity>)[0]
const find = (d: Doc, map: keyof Doc, f: (e: Entity) => boolean) => Object.values(d[map] as Record<string, Entity>).find(f)!
const add = (d: Doc, map: keyof Doc, e: Record<string, unknown>) => {
  (d[map] as Record<string, unknown>)[e.id as string] = { v: 1, field_v: {}, ...e }
}

describe('integrity', () => {
  it('passes the examples', () => {
    expect(integrity(example<Doc>('document.json'))).toEqual([])
    expect(integrity(ad())).toEqual([])
  })

  const broken: [string, (d: Doc) => void, RegExp][] = [
    ['a link not in linkRule', (d) => { const l = first(d, 'links'); l.from = { kind: 'video', id: first(d, 'videos').id }; l.to = { kind: 'script', id: first(d, 'scripts').id }; l.role = 'renders' }, /video is an output/],
    ['two drives links into one storyboard', (d) => {
      const sb = first(d, 'storyboards').id
      add(d, 'scripts', { id: id('script', 9), title: 'Other', target_s: 15 })
      add(d, 'links', { id: id('link', 90), from: { kind: 'script', id: id('script', 9) }, to: { kind: 'storyboard', id: sb }, role: 'drives' })
    }, /2 drives links into storyboard/],
    ['two links of one role on one port', (d) => {
      const l = find(d, 'links', (x) => x.role === 'lighting')
      add(d, 'links', { ...structuredClone(l), id: id('link', 91) })
    }, /2 links of one role on one port/],
    ['a duplicate ref name', (d) => { const r = first(d, 'refs'); add(d, 'refs', { ...structuredClone(r), id: id('ref', 99) }) }, /is also refs/],
    ['a palette ref without swatches', (d) => { delete find(d, 'refs', (r) => r.role === 'palette').swatches }, /palette ref holds swatches/],
    ['an image role without an asset', (d) => { delete find(d, 'refs', (r) => r.role === 'character').asset }, /character ref holds asset/],
    ['a beat past its shot', (d) => { first(d, 'beats').at_s = 29.5 }, /past the end/],
    ['a 1 s window', (d) => { find(d, 'reviews', (r) => !!r.window).window = { from_s: 2, to_s: 3 } }, /at least 2 s/],
    ['a window across a cut', (d) => { find(d, 'reviews', (r) => !!r.window).window = { from_s: 4, to_s: 7 } }, /crosses a cut/],
    ['an orphan size', (d) => { first(d, 'sizes').set_id = id('fset', 99) }, /orphan size/],
    ['an ask without its job', (d) => { find(d, 'asks', (a) => !!a.job_id).job_id = id('job', 999) }, /its job .* is not in the document/],
    ['text in both a scene and a shot', (d) => {
      const s = find(d, 'shots', (x) => typeof x.action === 'string' && (x.action as string).length > 12 && !!x.scene_id)
      d.scenes[s.scene_id as string].text = `before ${s.action as string} after`
    }, /text has one owner/],
    ['a bad rank', (d) => { first(d, 'shots').rank = 'a0' + '0' }, /not an order key/],
    ['a key that is not its id', (d) => { first(d, 'boards').id = id('board', 99) }, /not its key/],
  ]
  for (const [name, mutate, want] of broken) {
    it(`refuses ${name}`, () => {
      const d = ad()
      mutate(d)
      expect(integrity(d).join('\n')).toMatch(want)
    })
  }

  // linkRule's kinds make no cycle today (nothing leaves a shot, a video feeds only a format
  // set); the loop check stands behind it for the rules to come.
  it('finds a loop', () => {
    const links = [
      { from: { kind: 'script', id: 'a' }, to: { kind: 'storyboard', id: 'b' } },
      { from: { kind: 'storyboard', id: 'b' }, to: { kind: 'video', id: 'c' } },
    ]
    expect(makesLoop(links, { kind: 'video', id: 'c' }, { kind: 'script', id: 'a' })).toBe(true)
    expect(makesLoop(links, { kind: 'script', id: 'a' }, { kind: 'video', id: 'd' })).toBe(false)
  })

  it('canLink agrees with examples/links.json', () => {
    const { cases } = example<{ cases: { from: string; to: string; role: string; ok: boolean; board_purpose?: string }[] }>('links.json')
    for (const c of cases) expect([c.from, c.to, c.role, canLink(c.from, c.to, c.role, c.board_purpose)]).toEqual([c.from, c.to, c.role, c.ok])
  })
})
