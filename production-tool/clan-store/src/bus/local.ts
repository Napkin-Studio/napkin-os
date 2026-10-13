// LocalPatchBus: PatchBus over ClanDocumentStore in one browser
// (contracts/collab.md §7-8). A batch is checked (shape, leaves, owners,
// versions), applied to a copy, written as one merge patch through the store
// (which validates the whole document and records one decision with the
// targets this bus derives), and handed to LocalUndo as one step.
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import common from '../../../contracts/common.schema.json'
import patchSchema from '../../../contracts/patch.schema.json'
import { deepEqual, diffMergePatch } from '../merge-patch'
import type { ClanDocumentStore } from '../store'
import type { Doc, Entity } from '../types'
import { InvalidDocument } from '../validate'
import { entityAddress, leafAddress, leafProblem, newestFieldV, readPath, textOwned, writePath } from './leaf'
import type { ApplyOptions, EntityName, Patch, PatchBatch, PatchBus, PatchConflict, PatchResult } from './types'
import type { LocalUndo } from './undo'

/** What must hold for an undo step to apply: each leaf (or entity) as the step left it. */
export interface Expect { entity: EntityName; id: string; path?: string; value?: unknown; exists: boolean }

/** At most this many leaves get their own target; past it, one target per entity (collab.md §8). */
export const LEAF_TARGETS_MAX = 8

let batchCheck: ((d: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null } | null = null
function checkBatch(batch: unknown): string[] {
  if (!batchCheck) {
    const Ajv = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020)
    const formats = ((addFormats as unknown as { default?: typeof addFormats }).default ?? addFormats)
    const ajv = new Ajv({ allErrors: true, strict: false })
    formats(ajv)
    ajv.addSchema(common)
    ajv.addSchema(patchSchema)
    batchCheck = ajv.getSchema('https://napkin.ie/production-tool/contracts/patch.schema.json#/$defs/PatchBatch') as unknown as typeof batchCheck
  }
  if (batchCheck!(batch)) return []
  return (batchCheck!.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`)
}

type Bag = Record<string, Record<string, unknown>>

function table(doc: Doc, entity: EntityName): Bag | null {
  if (entity === 'project') return null
  return (doc as unknown as Record<string, Bag>)[entity] ?? null
}

/** The result of an applied batch, with what an undo step must find. */
export interface Applied extends PatchResult { expect: Expect[] }

export class LocalPatchBus implements PatchBus {
  private readonly listeners = new Set<(r: PatchResult, batch: PatchBatch) => void>()
  undo: LocalUndo | null = null

  readonly store: ClanDocumentStore

  constructor(store: ClanDocumentStore) {
    this.store = store
  }

  doc(): Doc {
    return this.store.get()
  }

  onApplied(cb: (r: PatchResult, batch: PatchBatch) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async apply(batch: PatchBatch, opts: ApplyOptions = {}): Promise<PatchResult> {
    const { expect: _expect, ...result } = await this.applyWithExpect(batch, opts)
    return result
  }

  /** apply(), also giving what an undo step of this batch must find. */
  async applyWithExpect(batch: PatchBatch, opts: ApplyOptions = {}): Promise<Applied> {
    const shape = checkBatch(batch)
    if (shape.length) return refusedAll('invalid', `the batch does not match patch.schema.json: ${shape.join('; ')}`)
    const before = this.store.get()
    const next = structuredClone(before)
    const refused: PatchResult['refused'] = []
    const conflicts: PatchConflict[] = []
    const inverse: Patch[] = []
    const expect: Expect[] = []
    const touched = new Map<string, { entity: EntityName; id: string }>()
    const created = new Set<string>()
    const deleted = new Set<string>()
    const setPaths = new Map<string, Set<string>>()
    const k = (entity: EntityName, id: string) => `${entity}/${id}`

    batch.patches.forEach((p, index) => {
      const key = k(p.entity, p.id)
      const versioned = p.entity !== 'assets' && p.entity !== 'project'
      // project: the root object, one entity whose id is project.id.
      if (p.entity === 'project') {
        if (p.id !== next.project.id) return refused.push({ index, reason: 'not_found', message: `the project is ${next.project.id}` })
        if (p.op !== 'set') return refused.push({ index, reason: 'read_only', message: 'the project is set leaf by leaf, never created or deleted' })
      }
      const bag = table(next, p.entity)
      const current = p.entity === 'project' ? (next.project as unknown as Record<string, unknown>) : bag?.[p.id]
      if (p.op === 'create') {
        if (current !== undefined) return refused.push({ index, reason: 'exists', message: `${key} exists` })
        if (!p.value || typeof p.value !== 'object' || Array.isArray(p.value)) return refused.push({ index, reason: 'invalid', message: 'create carries the whole entity' })
        const owned = Object.keys(p.value).find((f) => textOwned(p.entity, f))
        if (owned && !opts.checkpoint) return refused.push({ index, reason: 'owned_by_text', message: `${p.entity}.${owned} comes from the live text; write the fragment instead` })
        const fresh = versioned ? { ...structuredClone(p.value as object), id: p.id, v: 1, field_v: {} } : structuredClone(p.value as Record<string, unknown>)
        bag![p.id] = fresh
        created.add(key)
        touched.set(key, { entity: p.entity, id: p.id })
        inverse.unshift({ op: 'delete', entity: p.entity, id: p.id, base_version: 0 })
        expect.push({ entity: p.entity, id: p.id, exists: true })
        return
      }
      if (current === undefined) return refused.push({ index, reason: 'not_found', message: `${key} is not in the document` })
      const ent = current as Entity
      if (p.op === 'delete') {
        if (versioned && !opts.force && ent.v > p.base_version) {
          return conflicts.push({ index, entity: p.entity, id: p.id, base_version: p.base_version, field_v: ent.v })
        }
        const { id: _i, v: _v, field_v: _f, ...rest } = structuredClone(ent)
        delete bag![p.id]
        deleted.add(key)
        touched.set(key, { entity: p.entity, id: p.id })
        inverse.unshift({ op: 'create', entity: p.entity, id: p.id, value: versioned ? rest : structuredClone(ent), base_version: 0 })
        expect.push({ entity: p.entity, id: p.id, exists: false })
        return
      }
      // set
      const path = p.path!
      const leaf = leafProblem(p.entity, path)
      if (leaf) return refused.push({ index, reason: 'not_leaf', message: leaf })
      if (textOwned(p.entity, path) && !opts.checkpoint) {
        return refused.push({ index, reason: 'owned_by_text', message: `${p.entity}.${path.split('/')[0]} is written from the live text; type it instead` })
      }
      if (versioned && !opts.force) {
        const fv = newestFieldV(ent.field_v ?? {}, path)
        if (fv > p.base_version) {
          return conflicts.push({ index, entity: p.entity, id: p.id, path, base_version: p.base_version, field_v: fv, current: readPath(ent, path) })
        }
      }
      const old = readPath(ent, path)
      writePath(ent as Record<string, unknown>, path, p.value)
      touched.set(key, { entity: p.entity, id: p.id })
      if (!setPaths.has(key)) setPaths.set(key, new Set())
      setPaths.get(key)!.add(path)
      inverse.unshift({ op: 'set', entity: p.entity, id: p.id, path, value: old === undefined ? null : structuredClone(old), base_version: 0 })
      expect.push({ entity: p.entity, id: p.id, path, value: p.value === null ? undefined : structuredClone(p.value), exists: true })
    })
    if (refused.length || conflicts.length) return { applied: false, v: {}, conflicts, refused, expect: [] }
    if (!touched.size) return { applied: true, v: {}, conflicts: [], refused: [], expect: [] }

    // Versions: one more for each entity the batch touched; each leaf set records it.
    const v: Record<string, number> = {}
    for (const [key, { entity, id }] of touched) {
      if (deleted.has(key) || entity === 'assets' || entity === 'project') continue
      const ent = table(next, entity)![id] as Entity
      const was = (table(before, entity)?.[id] as Entity | undefined)?.v ?? 0
      ent.v = created.has(key) ? 1 : was + 1
      for (const path of setPaths.get(key) ?? []) {
        for (const f of Object.keys(ent.field_v)) if (f.startsWith(`${path}/`)) delete ent.field_v[f]
        ent.field_v[path] = ent.v
      }
      v[key] = ent.v
    }
    for (const p of inverse) p.base_version = v[k(p.entity, p.id)] ?? 0

    // One merge patch for the touched entities, and the decision's targets.
    const body: Record<string, unknown> = {}
    for (const [key, { entity, id }] of touched) {
      if (entity === 'project') {
        body.project = diffMergePatch(before.project, next.project)
        continue
      }
      const m = (body[entity] ??= {}) as Record<string, unknown>
      m[id] = deleted.has(key) ? null : created.has(key) ? table(next, entity)![id] : diffMergePatch(table(before, entity)![id], table(next, entity)![id])
      if (m[id] === undefined) delete m[id]
      if (!deleted.has(key) && !created.has(key) && deepEqual(table(before, entity)![id], table(next, entity)![id])) delete m[id]
    }
    const docId = this.store.documentId()
    const leafCount = [...setPaths.values()].reduce((n, s) => n + s.size, 0)
    const targets: string[] = []
    for (const [key, { entity, id }] of touched) {
      targets.push(entityAddress(docId, entity, id))
      if (leafCount <= LEAF_TARGETS_MAX) for (const path of setPaths.get(key) ?? []) targets.push(leafAddress(docId, entity, id, path))
    }
    const why = batch.why
    try {
      await this.store.patch(body, {
        action: why.action,
        agent: why.agent,
        rationale: why.rationale,
        reasoning: why.reasoning,
        cites: why.cites,
        pinned: why.pinned,
        quiet: why.quiet,
        targets: targets.slice(0, 512),
      })
    } catch (e) {
      if (e instanceof InvalidDocument) return refusedAll('invalid', e.problems.join('; '))
      throw e
    }
    const result: Applied = { applied: true, v, conflicts: [], refused: [], inverse: { patches: inverse, why: { ...undoWhy(why) } }, expect }
    if (this.undo && (opts.undo ?? !why.quiet)) this.undo.pushPatch(why.action, result.inverse!, expect, opts.joinStep)
    for (const cb of this.listeners) {
      try {
        cb(result, batch)
      } catch (err) {
        console.error('onApplied listener failed', err)
      }
    }
    return result
  }
}

function refusedAll(reason: 'invalid', message: string): Applied {
  return { applied: false, v: {}, conflicts: [], refused: [{ index: 0, reason, message }], expect: [] }
}

/** The decision an undo of `why` records: the verb undo, then what it undoes. */
function undoWhy(why: PatchBatch['why']): PatchBatch['why'] {
  const action = why.action.startsWith('undo ') ? `redo ${why.action.slice(5)}` : why.action.startsWith('redo ') ? `undo ${why.action.slice(5)}` : `undo ${why.action}`
  return { action: action.slice(0, 300), ...(why.agent?.startsWith('human:') ? { agent: why.agent } : {}), ...(why.quiet ? { quiet: true } : {}) }
}

/** The current value an Expect looks at. */
export function expectHolds(doc: Doc, e: Expect): boolean {
  const ent = e.entity === 'project' ? (doc.project as unknown as Record<string, unknown>) : table(doc, e.entity)?.[e.id]
  if (!e.exists) return ent === undefined
  if (ent === undefined) return false
  if (!e.path) return true
  return deepEqual(readPath(ent, e.path), e.value)
}
