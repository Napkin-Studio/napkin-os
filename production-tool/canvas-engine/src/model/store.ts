// The scene store (features/canvas-engine.clan; grown from Spike O's SceneStore,
// spike/canvas-own-engine own-engine/src/model.ts): napkin/1 records in an
// @tldraw/store Store, mirrored field by field into the Y layout (src/y/layout.ts).
//
// Local writes go through change(): the store diff of the function
// (extractingChanges, synchronous) is written to Y in one transaction, LOCAL when
// it is the person's step and SYSTEM when it is nobody's. Remote writes come back
// through the Y observer and are merged into the store with mergeRemoteChanges, so
// they are never written back. A stroke's points live beside the records (they are
// bytes, and immutable) in Y's 'pts' and in a side table here.
//
// The store keeps no undo stack: each undoable change is reported as a Step of
// field changes for the UndoCoordinator (engine-select), which keeps per-person
// undo on clan-store's LocalUndo with ui-behaviour 4.5's skip rule.
//
// 'meta' carries schemaVersion (napkin/<n>) and sequence (the record migrations
// applied). A doc from a newer build opens read-only; one from an older sequence
// is migrated up as a SYSTEM write.

import { Store, type StoreSchema } from '@tldraw/store'
import * as Y from 'yjs'
import { elId, schema as napkinSchema, SCHEMA_VERSION, SEQUENCE_ID, sequenceVersion, type ElementRecord } from './records'
import { changedIds, elementsMap, flatten, LOCAL, metaMap, readAll, readElement, readPoints, SYSTEM, writeElement, writePoints } from '../y/layout'

/**
 * One field of one element before and after. '$record' is the whole element (a create or a
 * removal) and '$pts' a stroke's points, so an undo can put a removed stroke back whole.
 */
export interface FieldChange {
  id: string
  field: string
  before: unknown
  after: unknown
}

export interface Step {
  changes: FieldChange[]
}

export interface SceneTx {
  put(records: ElementRecord[]): void
  remove(ids: string[]): void
  get(id: string): ElementRecord | undefined
  /** A new stroke's points (once; src/model/points.ts). */
  setPoints(id: string, pts: Uint8Array): void
}

export interface SceneStoreOptions {
  schema?: StoreSchema<ElementRecord>
}

export class ReadOnlyScene extends Error {
  constructor(why: string) {
    super(`This canvas was saved by a newer version (${why}). Reload to get the latest version.`)
  }
}

export class SceneStore {
  readonly doc: Y.Doc
  readonly map: Y.Map<Y.Map<unknown>>
  readonly meta: Y.Map<unknown>
  readonly store: Store<ElementRecord>
  /** Why the scene is read-only, when it is (a newer schemaVersion or migration sequence). */
  readonly readOnly: string | null
  private readonly schemaRef: StoreSchema<ElementRecord>
  private readonly pts = new Map<string, Uint8Array>()
  private readonly changeCbs = new Set<(ids: string[], remote: boolean) => void>()
  private readonly stepCbs = new Set<(s: Step) => void>()
  private readonly off: () => void

  constructor(doc: Y.Doc, opts: SceneStoreOptions = {}) {
    this.doc = doc
    this.schemaRef = opts.schema ?? napkinSchema
    this.store = new Store<ElementRecord>({ schema: this.schemaRef, props: {} })
    this.map = elementsMap(doc)
    this.meta = metaMap(doc)
    this.readOnly = this.checkMeta()
    const observer = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
      if (tr.local && (tr.origin === LOCAL || tr.origin === SYSTEM)) return
      this.applyFromY(changedIds(events, this.map))
    }
    this.map.observeDeep(observer)
    this.off = () => this.map.unobserveDeep(observer)
    // Start from what Y has (a joining client, or a reopened doc).
    const existing = readAll(this.map)
    for (const r of existing) {
      const p = readPoints(this.map, r.id)
      if (p) this.pts.set(r.id, p)
    }
    if (existing.length) {
      const migrated = this.readOnly ? existing : this.migrateUp(existing)
      this.store.mergeRemoteChanges(() => this.store.put(migrated))
    }
  }

  /** Is the doc from a newer build? Stamp an empty doc as ours. */
  private checkMeta(): string | null {
    const v = this.meta.get('schemaVersion')
    const seq = this.meta.get('sequence')
    if (typeof v === 'number' && v > SCHEMA_VERSION) return `napkin/${v}`
    if (typeof seq === 'number' && seq > sequenceVersion(this.schemaRef)) return `napkin/${SCHEMA_VERSION} migration ${seq}`
    return null
  }

  private stampMeta() {
    if (this.meta.get('schemaVersion') !== SCHEMA_VERSION) this.meta.set('schemaVersion', SCHEMA_VERSION)
    const seq = sequenceVersion(this.schemaRef)
    if (this.meta.get('sequence') !== seq) this.meta.set('sequence', seq)
  }

  /** Records written under an older migration sequence, brought up to ours (written back as SYSTEM). */
  private migrateUp(records: ElementRecord[]): ElementRecord[] {
    const from = this.meta.get('sequence')
    const ours = sequenceVersion(this.schemaRef)
    if (typeof from !== 'number' || from >= ours) return records
    const persisted = { schemaVersion: 2 as const, sequences: { ...this.schemaRef.serialize().sequences, [SEQUENCE_ID]: from } }
    const out = records.map((r) => {
      const m = this.schemaRef.migratePersistedRecord(r, persisted, 'up')
      if (m.type !== 'success') throw new Error(`Could not migrate ${r.id}: ${m.reason}`)
      return m.value
    })
    this.doc.transact(() => {
      for (const r of out) writeElement(this.map, r)
      this.stampMeta()
    }, SYSTEM)
    return out
  }

  onChange(fn: (ids: string[], remote: boolean) => void): () => void {
    this.changeCbs.add(fn)
    return () => void this.changeCbs.delete(fn)
  }

  /** Each local undoable change, as field changes. */
  onStep(fn: (s: Step) => void): () => void {
    this.stepCbs.add(fn)
    return () => void this.stepCbs.delete(fn)
  }

  get(id: string): ElementRecord | undefined {
    return this.store.get(elId(id))
  }

  all(): ElementRecord[] {
    return this.store.allRecords()
  }

  /** A stroke's points, as written. */
  points(id: string): Uint8Array | undefined {
    return this.pts.get(id)
  }

  /** The first writer puts the scene into Y: a system write, nobody's step. */
  seed(records: ElementRecord[], points: Record<string, Uint8Array> = {}) {
    this.change((tx) => {
      tx.put(records)
      for (const [id, p] of Object.entries(points)) tx.setPoints(id, p)
    }, { undoable: false })
  }

  /** A local change; `undoable` (default) makes it one step of this person's. Returns the step, or null. */
  change(fn: (tx: SceneTx) => void, opts: { undoable?: boolean } = {}): Step | null {
    if (this.readOnly) throw new ReadOnlyScene(this.readOnly)
    const undoable = opts.undoable ?? true
    const newPts = new Map<string, Uint8Array>()
    const tx: SceneTx = {
      put: (rs) => this.store.put(rs),
      remove: (ids) => this.store.remove(ids.map(elId)),
      get: (id) => this.get(id),
      setPoints: (id, p) => {
        if (this.pts.has(id) || newPts.has(id)) throw new Error(`Stroke ${id}'s points are already written; points are never rewritten.`)
        newPts.set(id, p)
      },
    }
    const diff = this.store.extractingChanges(() => fn(tx))
    const added = Object.values(diff.added)
    const updated = Object.values(diff.updated)
    const removed = Object.values(diff.removed)
    if (!added.length && !updated.length && !removed.length && !newPts.size) return null
    const changes: FieldChange[] = []
    this.doc.transact(() => {
      this.stampMeta()
      for (const r of added) {
        writeElement(this.map, r)
        changes.push({ id: r.id, field: '$record', before: null, after: r })
      }
      for (const [from, to] of updated) {
        const a = flatten(from)
        const b = flatten(to)
        for (const k of writeElement(this.map, to)) changes.push({ id: to.id, field: k, before: a.get(k), after: b.get(k) })
      }
      for (const r of removed) {
        this.map.delete(r.id)
        changes.push({ id: r.id, field: '$record', before: r, after: null })
        const p = this.pts.get(r.id)
        if (p) changes.push({ id: r.id, field: '$pts', before: p, after: null })
        this.pts.delete(r.id)
      }
      for (const [id, p] of newPts) {
        writePoints(this.map, id, p)
        this.pts.set(id, p)
        changes.push({ id, field: '$pts', before: null, after: p })
      }
    }, undoable ? LOCAL : SYSTEM)
    const ids = [...new Set([...added.map((r) => r.id), ...updated.map(([, to]) => to.id), ...removed.map((r) => r.id), ...newPts.keys()])]
    this.emit(ids, false)
    if (!undoable || !changes.length) return null
    const step = { changes }
    for (const cb of this.stepCbs) cb(step)
    return step
  }

  destroy() {
    this.off()
  }

  private applyFromY(ids: Set<string>) {
    if (!ids.size) return
    const put: ElementRecord[] = []
    const gone: string[] = []
    for (const id of ids) {
      const r = readElement(this.map, id)
      const p = readPoints(this.map, id)
      if (p) this.pts.set(id, p)
      if (r) put.push(r)
      else if (!this.map.has(id)) {
        this.pts.delete(id)
        if (this.get(id)) gone.push(id)
      }
    }
    this.store.mergeRemoteChanges(() => {
      if (put.length) this.store.put(put)
      if (gone.length) this.store.remove(gone.map(elId))
    })
    this.emit([...ids], true)
  }

  private emit(ids: string[], remote: boolean) {
    for (const fn of this.changeCbs) fn(ids, remote)
  }
}
