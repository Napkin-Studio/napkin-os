// The leaf rules (contracts/collab.md §7) and addresses (§9).
import type { EntityName } from './types'

/** Fields live text owns: only checkpoint() writes them. */
export const TEXT_OWNED: Partial<Record<EntityName, readonly string[]>> = {
  shots: ['prose', 'action', 'direction', 'refs', 'text_problem', 'last_writer'],
  scenes: ['prose', 'text', 'last_writer'],
  beats: ['prose', 'text', 'last_writer'],
  reviews: ['prose', 'text', 'last_writer'],
}

const CAMERA_PARTS = ['size', 'angle', 'movement', 'movement_speed', 'lens_mm', 'macro']
const PICK_PARTS = ['current', 'alternates']
const EDL_ITEM_FIELDS = ['rank', 'kind', 'shot_id', 'in_s', 'out_s']
const NEVER = ['id', 'v', 'field_v']
const ID_RE = /^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/

/** Why `path` is not a leaf of an entity in `entity`, or null when it is one. */
export function leafProblem(entity: EntityName, path: string): string | null {
  const s = path.split('/')
  if (s.some((x) => !x)) return `${path} has an empty part`
  if (NEVER.includes(s[0])) return `${s[0]} is the bus's, never a patch's`
  if (entity === 'project' || entity === 'assets') return s.length === 1 ? null : `${entity} fields are set whole`
  if (s.length === 1) {
    if (s[0] === 'camera' || s[0] === 'pick' || s[0] === 'edl') return `${s[0]} has parts: set ${s[0]}/<part>`
    return null
  }
  if (s[0] === 'camera') return s.length === 2 && CAMERA_PARTS.includes(s[1]) ? null : `camera's parts are ${CAMERA_PARTS.join(', ')}`
  if (s[0] === 'pick') return s.length === 2 && PICK_PARTS.includes(s[1]) ? null : 'pick has current and alternates'
  if (s[0] === 'edl' && entity === 'videos') {
    if (!ID_RE.test(s[1])) return 'an edl item is named by its id'
    if (s.length === 2) return null
    if (s.length === 3 && EDL_ITEM_FIELDS.includes(s[2])) return null
    if (s.length === 4 && s[2] === 'pick' && PICK_PARTS.includes(s[3])) return null
    return `edl/<item> has ${EDL_ITEM_FIELDS.join(', ')} and pick/current|alternates`
  }
  return `${s[0]} is set whole`
}

/** Whether `path` writes a field live text owns. */
export function textOwned(entity: EntityName, path: string): boolean {
  return (TEXT_OWNED[entity] ?? []).includes(path.split('/')[0])
}

/** <doc>#map[id] */
export function entityAddress(docId: string, entity: EntityName, id: string): string {
  return entity === 'project' ? `${docId}#project` : `${docId}#${entity}[${id}]`
}

/** <doc>#map[id].field.part, nested map keys as [key]: shots[shot_X].camera.size, videos[v].edl[e].pick */
export function leafAddress(docId: string, entity: EntityName, id: string, path: string): string {
  let out = entityAddress(docId, entity, id)
  const s = path.split('/')
  s.forEach((seg, i) => {
    out += ID_RE.test(seg) || (i > 0 && s[i - 1] === 'edl') ? `[${seg}]` : `.${seg}`
  })
  return out
}

/** Read the value at a '/' path inside an object. */
export function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('/')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** Write (or with undefined/null, remove) the value at a '/' path, making objects on the way. */
export function writePath(obj: Record<string, unknown>, path: string, value: unknown) {
  const s = path.split('/')
  const last = s[s.length - 1]
  if (value === null || value === undefined) {
    // Remove the leaf, then any object it leaves empty (pick/current alone leaves no pick).
    const trail: Record<string, unknown>[] = [obj]
    for (const seg of s.slice(0, -1)) {
      const next = trail[trail.length - 1][seg]
      if (next === null || typeof next !== 'object' || Array.isArray(next)) return
      trail.push(next as Record<string, unknown>)
    }
    delete trail[trail.length - 1][last]
    for (let i = trail.length - 1; i > 0; i--) {
      if (Object.keys(trail[i]).length) break
      delete trail[i - 1][s[i - 1]]
    }
    return
  }
  let cur = obj
  for (const seg of s.slice(0, -1)) {
    const next = cur[seg]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) cur[seg] = {}
    cur = cur[seg] as Record<string, unknown>
  }
  cur[last] = structuredClone(value)
}

/** The newest field_v of `path`, counting the leaves above and below it (camera/size
 * conflicts with a newer camera, and edl/X with a newer edl/X/pick/current). */
export function newestFieldV(fieldV: Record<string, number>, path: string): number {
  let n = 0
  for (const [k, v] of Object.entries(fieldV)) {
    if (k === path || k.startsWith(`${path}/`) || path.startsWith(`${k}/`)) n = Math.max(n, v)
  }
  return n
}
