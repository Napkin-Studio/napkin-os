// The precompiled validators (src/validators.gen.js, owner 2026-11-24: no eval in the page) must say exactly what
// runtime ajv said: the same verdict and the same errors, on every contract example, valid and invalid.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { EXPORTS, generate } from '../scripts/precompile-validators.mjs'
import * as gen from '../src/validators.gen.js'

const contracts = join(__dirname, '..', '..', 'contracts')
const schema = (n: string) => JSON.parse(readFileSync(join(contracts, `${n}.schema.json`), 'utf8'))

/** Runtime ajv as validate.ts and bus/local.ts built it before the precompile. */
function runtime() {
  const Ajv = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020)
  const formats = ((addFormats as unknown as { default?: typeof addFormats }).default ?? addFormats)
  const ajv = new Ajv({ allErrors: true, strict: false })
  formats(ajv)
  for (const n of ['common', 'director', 'patch', 'document']) ajv.addSchema(schema(n))
  return ajv
}

const examples = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ name: f, data: JSON.parse(readFileSync(join(dir, f), 'utf8')) }))
const all = [...examples(join(contracts, 'examples')), ...examples(join(contracts, 'examples', 'invalid')).map((e) => ({ ...e, name: `invalid/${e.name}` }))]
const shape = (errors: { instancePath: string; keyword?: string; message?: string; params?: unknown }[] | null | undefined) =>
  (errors ?? []).map((e) => ({ instancePath: e.instancePath, keyword: e.keyword, message: e.message, params: e.params }))

describe('precompiled validators', () => {
  it('src/validators.gen.js is what the script makes from the contracts now (run `npm run validators`)', () => {
    expect(readFileSync(join(__dirname, '..', 'src', 'validators.gen.js'), 'utf8') === generate()).toBe(true)
  })

  it('carries no eval and no new Function', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'validators.gen.js'), 'utf8')
    expect(src).not.toMatch(/new Function|\beval\(|(^|[^'"\w.])require\(|^import /m)
    expect(src).toMatch(/^export \{/m)
  })

  const ajv = runtime()
  for (const [name, ref] of Object.entries(EXPORTS)) {
    it(`${name} gives runtime ajv's verdict and errors on every contract example`, () => {
      const v = (gen as unknown as Record<string, ((d: unknown) => boolean) & { errors?: never }>)[name]
      const r = ajv.getSchema(ref)!
      let valid = 0
      let invalid = 0
      for (const ex of all) {
        const a = r(ex.data)
        const b = v(ex.data)
        expect(b, ex.name).toBe(a)
        expect(shape(v.errors), ex.name).toEqual(shape(r.errors))
        if (a) valid++; else invalid++
      }
      // both sides of the line are exercised
      expect(valid, 'some example is valid').toBeGreaterThan(0)
      expect(invalid, 'some example is invalid').toBeGreaterThan(0)
    })
  }

  it('the contract examples of a document and a patch batch are valid', () => {
    for (const ex of all.filter((e) => /^document\.[^/]*json$/.test(e.name))) expect(gen.validateDocument(ex.data), ex.name).toBe(true)
    for (const ex of all.filter((e) => e.name.startsWith('patch-batch.'))) expect(gen.validatePatchBatch(ex.data), ex.name).toBe(true)
  })

  // UAT 2026-11-26: a project made with Continue in from a brief carries the client's default Brand Clan node, and
  // the page refused to open it ("must NOT have additional properties (brand_clans)"): the committed file predated
  // brand_clans, and the build regenerated it before the tests, so nothing caught it.
  it('a document carrying a Brand Clan node opens, as runtime ajv says', () => {
    const base = all.find((e) => e.name === 'document.json')!.data as Record<string, unknown>
    const id = 'bclan_01K7A0000000000000000000C1'
    const node = {
      id, v: 1, field_v: {}, title: 'Original',
      client: { id: 'client_solas', name: 'Sólás Lights' },
      source: { document_id: 'doc-ie-napkin-brand-1', path: 'brand/original', app_id: 'ie.napkin.brand', version: 2, at: '2026-11-26T12:13:00Z', how: 'default' },
      bible: { visual: { logos: [{ id: 'solas-logo', asset: 'human/assets/solas-logo.png' }] }, voice: {}, imagery: {} },
    }
    const doc = { ...base, brand_clans: { [id]: node } }
    expect(gen.validateDocument(doc), JSON.stringify(gen.validateDocument.errors)).toBe(true)
    expect(ajv.getSchema(EXPORTS.validateDocument)!(doc)).toBe(true)
    const bad = { ...base, brand_clans: { [id]: { ...node, colour: 'teal' } } }
    expect(gen.validateDocument(bad)).toBe(false)
  })
})
