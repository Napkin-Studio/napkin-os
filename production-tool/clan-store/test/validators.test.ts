// The precompiled validators (src/validators.gen.js, ajv standalone) against
// the schemas: no runtime code generation, in step with the contract, and the
// same verdicts and errors as ajv's compile() (which only this test uses).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { generate } from '../scripts/make-validators.mjs'
import { problems } from '../src/index'
import { patchBatch } from '../src/validators.gen.js'
import { CONTRACTS, example } from './fixtures'

const read = (name: string) => JSON.parse(readFileSync(join(CONTRACTS, name), 'utf8'))
const PATCH_BATCH = 'https://napkin.ie/production-tool/contracts/patch.schema.json#/$defs/PatchBatch'

// The reference: what src/validate.ts and src/bus/local.ts compiled at runtime before.
function reference() {
  const Ajv = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020)
  const formats = ((addFormats as unknown as { default?: typeof addFormats }).default ?? addFormats)
  const ajv = new Ajv({ allErrors: true, strict: false })
  formats(ajv)
  ajv.addSchema(read('common.schema.json'))
  ajv.addSchema(read('director.schema.json'))
  ajv.addSchema(read('patch.schema.json'))
  const doc = ajv.compile(read('document.schema.json'))
  const batch = ajv.getSchema(PATCH_BATCH)!
  return { doc, batch }
}

type Err = { instancePath: string; message?: string; params?: unknown; keyword?: string; schemaPath?: string }
const verdict = (fn: ((d: unknown) => boolean) & { errors?: Err[] | null }, d: unknown) =>
  fn(d) ? { valid: true, errors: [] as Err[] } : { valid: false, errors: JSON.parse(JSON.stringify(fn.errors ?? [])) as Err[] }

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
function mutate(base: Record<string, unknown>, f: (d: any) => void) { const d = clone(base); f(d); return d }

const baseDoc = example('document.json')
const firstKey = (o: Record<string, unknown>) => Object.keys(o)[0]!
const DOCS: [string, unknown][] = [
  ['example document', baseDoc],
  ['example ad', example('document.ad.json')],
  ['example briefs', example('document.briefs.json')],
  ['example campaign', example('document.campaign.json')],
  ['example finals', example('document.finals.json')],
  ['not an object', 'text'],
  ['null', null],
  ['an array', []],
  ['empty object', {}],
  ['wrong contract version', mutate(baseDoc, (d) => { d.contract_version = '2' })],
  ['wrong app', mutate(baseDoc, (d) => { d.app = 'other' })],
  ['extra top-level property', mutate(baseDoc, (d) => { d.surprise = 1 })],
  ['bad project id', mutate(baseDoc, (d) => { d.project.id = 'nope' })],
  ['empty project title', mutate(baseDoc, (d) => { d.project.title = '' })],
  ['long project title', mutate(baseDoc, (d) => { d.project.title = 'x'.repeat(121) })],
  ['bad created_at format', mutate(baseDoc, (d) => { d.project.created_at = 'yesterday' })],
  ['extra project property', mutate(baseDoc, (d) => { d.project.colour = 'red' })],
  ['missing project', mutate(baseDoc, (d) => { delete d.project })],
  ['boards not a map', mutate(baseDoc, (d) => { d.boards = [] })],
  ['an entity with a bad field',
    mutate(baseDoc, (d) => { const m = d.shots ?? {}; const k = firstKey(m); if (k) m[k].v = 'one'; else d.boards = { x: 1 } })],
  ['an entity without its id',
    mutate(baseDoc, (d) => { const m = d.shots ?? {}; const k = firstKey(m); if (k) delete m[k].id; else d.jobs = { x: {} } })],
  ['several errors at once', mutate(baseDoc, (d) => { d.app = 1; d.contract_version = 9; d.project.id = 2; d.extra = true })],
]

const batchEx = example('patch-batch.plan.json')
const batchRestore = example('patch-batch.restore.json')
const BATCHES: [string, unknown][] = [
  ['plan batch', batchEx],
  ['restore batch', batchRestore],
  ['empty object', {}],
  ['null', null],
  ['a string', 'x'],
  ['extra property', mutate(batchEx, (b) => { b.surprise = 1 })],
  ['no patches', mutate(batchEx, (b) => { b.patches = [] })],
  ['patches not an array', mutate(batchEx, (b) => { b.patches = {} })],
  ['bad patch', mutate(batchEx, (b) => { b.patches = [{ nonsense: true }] })],
  ['several errors', mutate(batchEx, (b) => { b.patches = 3; b.extra = 1 })],
]

describe('the precompiled validators', () => {
  const ref = reference()

  it('give the same verdict and the same errors as ajv compile() for every document', () => {
    for (const [name, d] of DOCS) {
      const want = verdict(ref.doc as never, d)
      const got = problems(d)
      const wantLines = want.errors.map((e) => {
        const extra = e.params && typeof e.params === 'object' && 'additionalProperty' in e.params ? ` (${String((e.params as any).additionalProperty)})` : ''
        return `${e.instancePath || '/'} ${e.message ?? 'is invalid'}${extra}`
      })
      expect(got, name).toEqual(wantLines)
    }
    expect(problems(baseDoc)).toEqual([])
    expect(problems(null).length).toBeGreaterThan(0)
  })

  it('give the same raw ajv errors (keyword, schemaPath, params) for every document', async () => {
    const mod = await import('../src/validators.gen.js')
    for (const [name, d] of DOCS) {
      expect(verdict(mod.document as never, d), name).toEqual(verdict(ref.doc as never, d))
    }
  })

  it('give the same verdict and errors as ajv for every patch batch', () => {
    for (const [name, d] of BATCHES) {
      expect(verdict(patchBatch as never, d), name).toEqual(verdict(ref.batch as never, d))
    }
    expect(patchBatch(batchEx)).toBe(true)
    expect(patchBatch({})).toBe(false)
  })

  it('are in step with the schemas: regenerating changes nothing', () => {
    expect(readFileSync(new URL('../src/validators.gen.js', import.meta.url), 'utf8') === generate(),
      'src/validators.gen.js is stale: run `npm run validators`').toBe(true)
  })

  it('contain no runtime code generation, in the source or in a bundle, and run with it disallowed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-val-'))
    try {
      const gen = readFileSync(new URL('../src/validators.gen.js', import.meta.url), 'utf8')
      expect(gen).not.toMatch(/new Function|\beval\s*\(|Function\s*\(/)
      const entry = join(dir, 'entry.ts')
      const srcIndex = new URL('../src/validate.ts', import.meta.url).pathname
      const srcBus = new URL('../src/bus/local.ts', import.meta.url).pathname
      writeFileSync(entry, `import { problems } from ${JSON.stringify(srcIndex)}\nimport * as bus from ${JSON.stringify(srcBus)}\nglobalThis.__bus = bus\nconsole.log(JSON.stringify([problems({}).length > 0, problems(null).length > 0]))\n`)
      const out = join(dir, 'out.mjs')
      // Same shape as the page: the store's source and everything it imports, in one bundle.
      await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', outfile: out, loader: { '.wasm': 'empty' }, logLevel: 'silent', external: ['node:*'] })
      const bundled = readFileSync(out, 'utf8')
      expect(bundled).toContain('must have required property')
      expect(bundled).not.toMatch(/new Function\s*\(/)
      expect(bundled).not.toMatch(/(^|[^.\w$])eval\s*\(/)
      // The proof: Node refuses string-to-code outright with this flag.
      const res = execFileSync(process.execPath, ['--disallow-code-generation-from-strings', out], { encoding: 'utf8' })
      expect(JSON.parse(res)).toEqual([true, true])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
