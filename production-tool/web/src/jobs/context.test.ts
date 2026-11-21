// JobInput.context (features/pt-dex-context.clan): the project's brand rules and the documents linked into the node
// reach Dex; a view and the non-director ops carry none; the request stays within the contract's limits.
import { describe, expect, it } from 'vitest'
import type { JobInput, NamedRef, ProductionDocument } from '../contracts/types'
import { loadJson, makeAjv, SCHEMA } from '../test/schemas'
import { brandRows, brandWork, brandWords, CONTEXT_OPS, ITEMS_MAX, TOTAL_MAX, withContext } from './context'

const ex = loadJson<ProductionDocument>('examples/document.ad.json')
const S15 = { kind: 'shot', id: 'shot_01K7A000000000000000000015' } as const
const SCRIPT = { kind: 'script', id: 'script_01K7A00000000000000000000Z' } as const
const PALETTE = 'ref_01K7A00000000000000000000V'
const TYPE = 'ref_01K7A00000000000000000000W'
const RULE = 'ref_01K7A00000000000000000000X'
const NOTES = 'doc_01K7A000000000000000000009'

const ajv = makeAjv()
const validInput = (input: JobInput) => {
  const ok = ajv.validate(`${SCHEMA('relay-api')}#/$defs/JobInput`, input)
  return ok ? true : ajv.errors
}

describe('input.context', () => {
  it('carries the project’s brand: its rules first, then the palette and the type, each with a row', () => {
    const { input, rows } = withContext(ex, 'frame', S15, { text: 'wide' })
    const brand = input.context!.filter((c) => c.kind !== 'document')
    expect(brand).toEqual([
      { kind: 'brand_rule', title: '@' + refName(ex.refs[RULE]), text: 'Do: Leave one cap height of clear space around the logo.' },
      { kind: 'palette', title: expect.any(String), text: 'Accents: Lumen blue #0B5FFF, #F4F1EA' },
      { kind: 'typography', title: expect.any(String), text: 'Lumen Sans (headlines)' },
    ])
    expect(rows.filter((r) => r.kind === 'brand').map((r) => [r.ref, r.used_as])).toEqual([[RULE, 'brand rule'], [PALETTE, 'brand palette'], [TYPE, 'brand typography']])
    expect(validInput(input)).toBe(true)
  })

  it('carries a document linked into the node by its excerpt, never one linked elsewhere', () => {
    const onScript = withContext(ex, 'shot_list', SCRIPT, {})
    expect(onScript.input.context!.filter((c) => c.kind === 'document')).toEqual([{ kind: 'document', title: 'Client notes', text: 'Keep it calm. No running.' }])
    expect(onScript.rows.find((r) => r.kind === 'document')).toMatchObject({ ref: NOTES, used_as: 'background document', link_id: expect.any(String) })
    // The brand book is linked into nothing: never sent.
    expect(JSON.stringify(onScript.input)).not.toContain('Lumen brand book')
  })

  it('a view and the ops with no director read none; an input that has context is left as it was', () => {
    for (const op of ['view', 'upscale', 'resize', 'cutdown', 'stitch', 'write'] as const) {
      const input: JobInput = { text: 'x' }
      expect(withContext(ex, op, S15, input).input).toBe(input)
    }
    const given: JobInput = { context: [{ kind: 'note', text: 'mine' }] }
    expect(withContext(ex, 'frame', S15, given).input).toBe(given)
    expect(CONTEXT_OPS).not.toContain('view')
  })

  it('a project with no brand and nothing linked sends exactly what it did', () => {
    const bare = structuredClone(ex)
    bare.refs = {}
    bare.links = {}
    const input: JobInput = { text: 'x' }
    const out = withContext(bare, 'generate', { kind: 'group', id: 'node_x' }, input)
    expect(out.input).toBe(input)
    expect(out.rows).toEqual([])
  })

  it('a big brand board stays within the contract: 16 items, 600 characters each, 3,000 in all', () => {
    const big = structuredClone(ex)
    for (let i = 0; i < 30; i++) {
      const id = `ref_01K7A0000000000000000R${String(i).padStart(4, '0')}`
      big.refs[id] = { id, v: 1, field_v: {}, key: `rule${i}`, variant: 'main', role: 'brand_rule', rule: { kind: 'dont', text: 'never '.repeat(200) } } as NamedRef
    }
    const { input, rows } = withContext(big, 'frame', S15, {})
    expect(input.context!.length).toBeLessThanOrEqual(ITEMS_MAX)
    expect(input.context!.every((c) => c.text.length <= 600 && (c.title ?? '').length <= 200)).toBe(true)
    expect(input.context!.reduce((n, c) => n + c.text.length + (c.title?.length ?? 0), 0)).toBeLessThanOrEqual(TOTAL_MAX)
    expect(rows.length).toBe(input.context!.length)
    expect(validInput(input)).toBe(true)
  })

  it('a brand ref with nothing to say sends nothing', () => {
    const r = (x: Partial<NamedRef>) => ({ id: 'ref_x', v: 1, field_v: {}, key: 'k', variant: 'v', ...x }) as NamedRef
    expect(brandWords(r({ role: 'palette', swatches: [] }))).toBeUndefined()
    expect(brandWords(r({ role: 'typography' }))).toBeUndefined()
    expect(brandWords(r({ role: 'brand_rule', rule: { kind: 'dont', text: ' ' } }))).toBeUndefined()
    expect(brandWords(r({ role: 'brand_rule', rule: { kind: 'tone', text: 'Warm, never jokey' } }))).toEqual({ kind: 'brand_rule', text: 'Tone: Warm, never jokey' })
    expect(brandWords(r({ role: 'palette', swatches: [{ hex: 'ff6f59', name: 'Coral' }] }))).toEqual({ kind: 'palette', text: 'Coral #FF6F59' })
    expect(brandWords(r({ role: 'character' }))).toBeUndefined()
  })
})

function refName(r: NamedRef) {
  return `${r.key}_${r.variant}`
}


// UAT round 3 R3-2: the palette turned every picture into a 3-colour poster. The brand goes per op and per job.
describe('the brand per job (pt-canvas-r3)', () => {
  const bare = () => {
    const d = structuredClone(ex)
    d.links = Object.fromEntries(Object.entries(d.links).filter(([, l]) => l.role !== 'brand'))
    return d
  }
  const NODE = { kind: 'group', id: 'node_x' } as const
  const kinds = (input: JobInput) => (input.context ?? []).map((c) => c.kind)

  it('a plain photo gets the brand rule only: no palette, no type', () => {
    const { input } = withContext(bare(), 'generate', NODE, { text: 'a cottage at midday, photo' })
    expect(kinds(input)).toEqual(['brand_rule'])
  })

  it('brand work gets the palette as accents and the type: an ad, a product, a brief, a Brand board linked', () => {
    for (const input of [{ text: 'a poster for the harbour picnic' }, { text: 'x', refs: [{ id: 'r', role: 'product', asset: { sha256: 'sha256:' + 'a'.repeat(64), url: 'https://x/a', mime: 'image/png' } }] }] as JobInput[]) {
      const out = withContext(bare(), 'generate', NODE, input).input
      expect(kinds(out)).toEqual(['brand_rule', 'palette', 'typography'])
      expect(out.context!.find((c) => c.kind === 'palette')!.text.startsWith('Accents: ')).toBe(true)
    }
    expect(kinds(withContext(ex, 'frame', S15, { text: 'wide' }).input)).toContain('palette') // its storyboard has a Brand board
    expect(brandWork(bare(), NODE, { brief: { title: 'b', spine: {} } as JobInput['brief'] })).toBe(true)
  })

  it('a Fill of the sky reads no brand at all, unless it is brand work', () => {
    expect(withContext(bare(), 'region_edit', NODE, { text: 'more sky' }).input.context).toBeUndefined()
    expect(kinds(withContext(bare(), 'region_edit', NODE, { text: 'put our logo on the sign' }).input)).toEqual(['brand_rule', 'palette', 'typography'])
  })

  it('the tray’s ticks leave one out, put one in, and make the palette strict', () => {
    const d = bare()
    const rows = brandRows(d, 'generate', NODE, { text: 'a cottage' })
    expect(rows.map((r) => [r.ref, r.on, r.byDefault])).toEqual([[RULE, true, true], [PALETTE, false, false], [TYPE, false, false]])
    const out = withContext(d, 'generate', NODE, { text: 'a cottage' }, { leave: [RULE], add: [PALETTE], strict: true }).input
    expect(out.context).toEqual([{ kind: 'palette', title: expect.any(String), text: 'Strict: Lumen blue #0B5FFF, #F4F1EA' }])
    // A selected note a Brand board links into makes it brand work (R2-5).
    expect(brandRows(d, 'generate', NODE, { text: 'a cottage' }, { work: true }).every((r) => r.on)).toBe(true)
  })

  it('a note a Brand board links into turns the brand on for the node it feeds', () => {
    const d = bare()
    const noteLink = Object.values(ex.links).find((l) => l.from.kind === 'text' || (l.from as { kind: string }).kind === 'note')
    expect(noteLink).toBeTruthy()
    const board = Object.values(ex.links).find((l) => l.role === 'brand')!.from
    d.links.lnk_brand_note = { id: 'lnk_brand_note', v: 1, field_v: {}, from: board, to: noteLink!.from, role: 'brand' } as never
    const fed = noteLink!.to
    expect(brandWork(d, fed, {})).toBe(true)
  })
})
