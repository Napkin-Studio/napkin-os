// The contract-3 mirror: every example validates with ajv, every invalid case
// is refused, the typed fixture below compiles against types.ts AND validates,
// and the tables load.ts reads from common.schema.json cover every role and op.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTRACTS, loadJson, makeAjv, SCHEMA } from '../test/schemas'
import { CAMERA_WORDS, LINK_RULE, quotaClassOf, REF_ROLE_TABLE } from './load'
import {
  CAMERA_ANGLES, CAMERA_MOVEMENTS, CAMERA_SIZES, LINK_ENDPOINT_KINDS, OPS, REF_ROLES, type FrameEditOutput, type Job, type JobRequest, type ProductionDocument, type Question,
} from './types'

const ajv = makeAjv()
const check = (ref: string, data: unknown) => {
  const v = ajv.getSchema(ref)
  if (!v) throw new Error(`no schema ${ref}`)
  const ok = v(data)
  return ok ? [] : (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`)
}

// The same pairs as contracts/check.py's CASES.
const CASES: [RegExp, string][] = [
  [/^config\..*\.json$/, SCHEMA('config')],
  [/^job-request\..*\.json$/, `${SCHEMA('relay-api')}#/$defs/JobRequest`],
  [/^job\..*\.json$/, `${SCHEMA('relay-api')}#/$defs/Job`],
  [/^job-answer\.json$/, `${SCHEMA('relay-api')}#/$defs/JobAnswer`],
  [/^answer-conflict\.json$/, `${SCHEMA('relay-api')}#/$defs/AnswerConflict`],
  [/^library-entry\..*\.json$/, `${SCHEMA('relay-api')}#/$defs/LibraryEntry`],
  [/^library-index\.json$/, `${SCHEMA('relay-api')}#/$defs/LibraryIndex`],
  [/^library-publish\..*\.json$/, `${SCHEMA('relay-api')}#/$defs/LibraryPublish`],
  [/^director\..*\.json$/, SCHEMA('director')],
  [/^customdata\..*\.json$/, SCHEMA('customdata')],
  [/^document.*\.json$/, SCHEMA('document')],
  [/^patch-batch\..*\.json$/, `${SCHEMA('patch')}#/$defs/PatchBatch`],
  [/^patch-result\..*\.json$/, `${SCHEMA('patch')}#/$defs/PatchResult`],
]

describe('contract 3 examples', () => {
  const files = readdirSync(join(CONTRACTS, 'examples')).filter((f) => f.endsWith('.json'))
  for (const [re, ref] of CASES) {
    const matched = files.filter((f) => re.test(f))
    it(`${re} has examples`, () => expect(matched.length).toBeGreaterThan(0))
    for (const f of matched) {
      it(`${f} validates`, () => expect(check(ref, loadJson(`examples/${f}`))).toEqual([]))
    }
  }

  it('format-packs.json validates', () => {
    expect(check(SCHEMA('format-packs'), loadJson('format-packs.json'))).toEqual([])
  })

  // Only the schema-level invalid cases: check.py and clan-store's integrity
  // check refuse the rest (a key that is not its id, a 1 s window, a link
  // linkRule does not allow, a map key with a dot).
  const SCHEMA_REFUSED = ['document.v2', 'document.action-601', 'document.role-feel', 'document.rank-space', 'document.ambiguity-recommended',
    'job-request.contract-2', 'job-request.frame_edit-anchor', 'job-request.quality-frame', 'job-answer.both', 'patch-batch.no-why', 'customdata.pin',
    'question.ambiguity-recommended', 'director.frame_edit-movement-job']
  const target: Record<string, string> = {
    document: SCHEMA('document'),
    'job-request': `${SCHEMA('relay-api')}#/$defs/JobRequest`,
    'job-answer': `${SCHEMA('relay-api')}#/$defs/JobAnswer`,
    'patch-batch': `${SCHEMA('patch')}#/$defs/PatchBatch`,
    customdata: SCHEMA('customdata'),
    question: `${SCHEMA('common')}#/$defs/question`,
    director: SCHEMA('director'),
  }
  for (const name of SCHEMA_REFUSED) {
    it(`invalid/${name} is refused`, () => {
      const data = loadJson(`examples/invalid/${name}.json`)
      expect(check(target[name.split('.')[0]], data).length).toBeGreaterThan(0)
    })
  }
})

describe('the tables in common.schema.json', () => {
  it('has a role line for every role, and they read as the spec says', () => {
    expect(Object.keys(REF_ROLE_TABLE).sort()).toEqual([...REF_ROLES].sort())
    expect(REF_ROLE_TABLE.lighting.ui_line).toBe('Dex matches its light only')
    expect(REF_ROLE_TABLE.layout.ui_line).toBe('Dex follows where things sit, not how they look')
    expect(Object.values(REF_ROLE_TABLE).filter((r) => r.picker === 'main')).toHaveLength(10)
  })
  it('has a quota class for every op', () => {
    for (const op of OPS) expect(['image', 'video', 'render', 'text']).toContain(quotaClassOf(op))
    expect(quotaClassOf('clip_patch')).toBe('video')
    expect(quotaClassOf('shot_list')).toBe('text')
  })
  it('says every camera value, and the frameEdit types match director.schema.json', () => {
    const common = loadJson('common.schema.json') as { $defs: Record<string, { enum?: string[]; properties?: Record<string, unknown> }> }
    expect(Object.keys(CAMERA_WORDS.size).sort()).toEqual([...CAMERA_SIZES].sort())
    expect(Object.keys(CAMERA_WORDS.angle).sort()).toEqual([...CAMERA_ANGLES].sort())
    expect(Object.keys(CAMERA_WORDS.movement).sort()).toEqual([...CAMERA_MOVEMENTS].sort())
    expect(Object.keys(CAMERA_WORDS.movement_speed).sort()).toEqual([...(common.$defs.movementSpeed.enum ?? [])].sort())
    expect(CAMERA_WORDS.angle.eye_level.label).toBe('eye level')
    const director = loadJson('director.schema.json') as { $defs: { frameEdit: { properties: Record<string, { enum?: string[] }> } } }
    const props = director.$defs.frameEdit.properties
    const edit: Required<FrameEditOutput> = { reading: 'both', runAs: 'none', camera: {}, maskUnused: true, words_as_given: true }
    expect(Object.keys(props).sort()).toEqual(Object.keys(edit).sort())
    expect(props.reading.enum).toEqual(['camera', 'local', 'both'])
    expect(props.runAs.enum).toEqual(['frame', 'region_edit', 'none'])
  })
  it('lets a script drive a storyboard and no video drive a script', () => {
    expect(LINK_RULE.rules.some((r) => r.from.includes('script') && r.to.includes('storyboard') && r.roles.includes('drives'))).toBe(true)
    expect(LINK_RULE.rules.some((r) => r.from.includes('video') && r.to.includes('script'))).toBe(false)
  })
  it('lets a text on the canvas feed a generating node as a note, once per node, and nothing feed a text (owner 2026-10-16)', () => {
    const row = LINK_RULE.rules.find((r) => r.from.includes('text'))
    expect(row).toMatchObject({ roles: ['note', 'context'], per_target: 'many', per_source: 'one' })
    expect(row?.to).toEqual(['script', 'storyboard', 'video', 'sketch', 'format_set'])
    expect(LINK_RULE.rules.some((r) => r.to.includes('text'))).toBe(false)
    const doc = loadJson<{ properties: Record<string, unknown>; required: string[] }>('document.schema.json')
    expect(doc.properties.texts).toBeDefined()
    expect(doc.required).not.toContain('texts')
  })
  it('lets a whole key feed a node once, in its ref role (owner 2026-10-15), and mirrors its endpoint kind', () => {
    const row = LINK_RULE.rules.find((r) => r.from.includes('key'))
    expect(row).toMatchObject({ per_target: 'many', per_source: 'one' })
    expect(row?.to).toEqual(expect.arrayContaining(['script', 'storyboard', 'video', 'sketch', 'shot']))
    expect(row?.roles).toEqual(expect.arrayContaining(['character', 'location', 'product']))
    const common = loadJson<{ $defs: { linkEndpointKind: { enum: string[] } } }>('common.schema.json')
    expect(common.$defs.linkEndpointKind.enum).toEqual([...LINK_ENDPOINT_KINDS])
  })
})

// ── typed fixtures: these must compile against types.ts and validate ─────────
const TENANT = '5b6f3c1e-9d2a-5c4b-8e7f-0a1b2c3d4e5f'
const U = (tail: string) => `01K7C${'0'.repeat(21 - tail.length)}${tail}`
const question: Question = {
  id: `q_${U('Q1')}`, kind: 'nudge', text: 'Plan a storyboard first?', allow_text: false, recommended_option_id: 'plan_first',
  options: [{ id: 'plan_first', label: 'Plan the storyboard first', value: { route: 'plan_storyboard' }, cost: { estimate: 1.2, currency: 'USD' } },
    { id: 'straight', label: 'Make clips straight from the script', value: { route: 'clips_from_script' } }],
}
const TYPED_DOC: ProductionDocument = {
  contract_version: '3', app: 'production-tool',
  project: { id: `proj_${U('P1')}`, tenant_id: TENANT, title: 'Typed', created_by: 'human:p_typed01', created_at: '2026-10-13T10:00:00Z' },
  assets: {}, boards: {}, sketches: {}, scripts: {}, scenes: {}, storyboards: {
    [`storyboard_${U('S1')}`]: { id: `storyboard_${U('S1')}`, v: 1, field_v: {}, title: 'Storyboard', ratio: '16:9', target_s: 15 },
  },
  shots: {
    [`shot_${U('H1')}`]: { id: `shot_${U('H1')}`, v: 2, field_v: { 'camera/size': 2 }, storyboard_id: `storyboard_${U('S1')}`, rank: 'a0', kind: 'shot', duration_s: 3,
      camera: { size: 'close', lens_mm: 85 }, status: 'planned', action: 'She smiles.', refs: [], last_writer: 'dex' },
  },
  beats: {}, frames: {}, videos: {}, takes: {}, renders: {}, reviews: {}, links: {}, keys: {}, refs: {}, documents: {}, format_sets: {}, sizes: {},
  checks: {}, asks: { [question.id]: { id: question.id, v: 1, field_v: {}, question, node: { kind: 'storyboard', id: `storyboard_${U('S1')}` }, crew: 'dex', state: 'open', answers: [] } },
  suggestions: {}, spin_ins: {}, jobs: {}, stale: {}, exports: {},
}
const TYPED_REQUEST: JobRequest = {
  contractVersion: '3', jobId: `job_${U('J1')}`, op: 'shot_list', projectId: `proj_${U('P1')}`, nonce: 'n_typed0001', node: { kind: 'storyboard', id: `storyboard_${U('S1')}` },
  parentIds: [], input: { script: 'She smiles.', targetS: 15 },
}
const TYPED_JOB: Job = {
  contractVersion: '3', jobId: `job_${U('J1')}`, participantId: 'p_typed01', tenantId: TENANT, projectId: `proj_${U('P1')}`, startedBy: 'human:p_typed01', crew: 'dex',
  node: { kind: 'storyboard', id: `storyboard_${U('S1')}` }, nonce: 'n_typed0001', op: 'shot_list', quotaClass: 'text', state: 'needs_input', inputHashes: [],
  question, cost: { currency: 'USD', unknown: true }, createdAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T10:00:01Z',
}

describe('typed fixtures', () => {
  it('validate against the schemas', () => {
    expect(check(SCHEMA('document'), TYPED_DOC)).toEqual([])
    expect(check(`${SCHEMA('relay-api')}#/$defs/JobRequest`, TYPED_REQUEST)).toEqual([])
    expect(check(`${SCHEMA('relay-api')}#/$defs/Job`, TYPED_JOB)).toEqual([])
  })
})
