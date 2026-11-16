// Building contract-3 documents for the jobs tests: a person, a project with a
// script scene, named pictures, planned shots (through the shot list's own
// landing, as flat text), notes.

import { newUlidId, rankBetween, type Person } from '../../../clan-store/src'
import type { KeyEntry, NamedRef, PlannedShot, ProductionDocument, RefRole, Review } from '../contracts/types'
import { emptyDocument, SnapshotDocumentStore } from '../doc/store'
import { applyShotList } from '../jobs/plan'
import { mainScript, scenesOf } from '../model/selectors'

export const TENANT = '5b6f3c1e-9d2a-5c4b-8e7f-0a1b2c3d4e5f'
export const MAYA: Person = { id: 'p_test01', handle: 'maya', tenant_id: TENANT }

/** A new project on the snapshot store (no wasm), written at once. */
export function snapshotDoc(person = MAYA): SnapshotDocumentStore {
  return new SnapshotDocumentStore(emptyDocument(person, 'Test ad'), null, 0)
}

/** The main script's first scene, with `text` as its unplanned words. */
export function addScene(d: ProductionDocument, text: string, heading = 'EXT. CITY STREET - DAY'): string {
  const script = mainScript(d)!
  const last = scenesOf(d).at(-1)
  const id = newUlidId('scene')
  d.scenes[id] = { id, v: 1, field_v: {}, script_id: script.id, rank: rankBetween(last?.rank ?? null, null), heading, text }
  return id
}

export function addKey(d: ProductionDocument, key: string, role: RefRole = 'character'): KeyEntry {
  const id = newUlidId('key')
  d.keys[id] = { id, v: 1, field_v: {}, key, role }
  return d.keys[id]
}

export function addRef(d: ProductionDocument, key: string, variant: string, asset: string, role: RefRole = 'character'): NamedRef {
  const id = newUlidId('ref')
  d.refs[id] = { id, v: 1, field_v: {}, key, variant, role, asset }
  return d.refs[id]
}

/** Shots on the main storyboard, planned as Dex's landing writes them. */
export function addShots(d: ProductionDocument, shots: PlannedShot[]) {
  return applyShotList(d, { shots })
}

/** A planned shot (mock-like). */
export function planned(action: string, duration_s = 5, extra: Partial<PlannedShot> = {}): PlannedShot {
  return { kind: 'shot', duration_s, camera: { size: 'medium', movement: 'push_in' }, action, refs: [], ...extra }
}

/** A person's note on something. */
export function note(target: Review['target'], text: string, extra: Partial<Review> = {}): Review {
  const id = newUlidId('rev')
  return { id, v: 1, field_v: {}, target, text, by: `human:${MAYA.id}`, state: 'open', created_at: new Date().toISOString(), ...extra }
}
