// What a new take changes from its parent (features/make-and-edit.clan): the Change drawer's diff, the take's
// one-line label in the Bin and on the takes stack, and the Keeps line. Plain British English, no internal
// mode names, no prices. The delta is the only thing a remake changes (remakeWith).

import { CAMERA_WORDS } from '../contracts/load'
import type { CameraWordField } from '../contracts/types'

/** The Change drawer's verbs, in the order the drawer lists them (P1 builds the first four). */
export type ChangeVerb = 'camera' | 'words' | 'moment' | 'feel'
export const VERBS: { id: ChangeVerb; label: string; hint: string }[] = [
  { id: 'camera', label: 'Camera', hint: 'Size, angle and movement of one shot' },
  { id: 'words', label: 'Words', hint: 'What happens in one shot' },
  { id: 'moment', label: 'A moment', hint: 'Change part of the picture for a second or two' },
  { id: 'feel', label: 'The whole feel', hint: 'Light, colour and mood of the whole take' },
]

/** One changed thing. `field`: camera.size | camera.angle | camera.movement | camera.movement_speed | words |
 *  moment | feel. `shot_id`: the shot it changes (camera and words), absent for the whole take. */
export interface DeltaRow {
  field: string
  from?: string | number | null
  to: string | number | null
  shot_id?: string
  /** A moment's window, in take seconds. */
  window?: { from_s: number; to_s: number }
}

const CAMERA_FIELDS: Record<string, CameraWordField> = {
  'camera.size': 'size', 'camera.angle': 'angle', 'camera.movement': 'movement', 'camera.movement_speed': 'movement_speed',
}
const FIELD_WORDS: Record<string, string> = {
  'camera.size': 'size', 'camera.angle': 'angle', 'camera.movement': 'movement', 'camera.movement_speed': 'speed',
}

/** A camera value as its chip says it ("push_in" → "Push in"). */
export function cameraWord(field: CameraWordField, value: string | null | undefined): string {
  if (!value) return field === 'movement' ? 'Static' : 'Not set'
  const label = CAMERA_WORDS[field]?.[value]?.label ?? value.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** Words cut to `n` characters on a word boundary, with an ellipsis. */
export function shortWords(s: string, n = 28): string {
  const t = s.trim().replace(/\s+/g, ' ')
  if (t.length <= n) return t
  const cut = t.slice(0, n).replace(/\s+\S*$/, '')
  return `${cut || t.slice(0, n)}…`
}
/** "0:01" from seconds. */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** A row's value in words. */
function valueWords(row: DeltaRow): string {
  const cam = CAMERA_FIELDS[row.field]
  if (cam) return cameraWord(cam, row.to == null ? null : String(row.to)).toLowerCase()
  return shortWords(String(row.to ?? ''))
}

/**
 * A take's one-line label from its delta: "Camera: handheld (shot 3)", "Words: swifter fold (shot 4)",
 * "Shirt red 0:00-0:02", "Feel: golden hour". No delta: "First take". `shotNo` names a shot by number.
 */
export function changeLabel(delta: DeltaRow[] | undefined, shotNo: (id: string) => number): string {
  if (!delta?.length) return 'First take'
  const one = (row: DeltaRow) => {
    const where = row.shot_id && shotNo(row.shot_id) ? ` (shot ${shotNo(row.shot_id)})` : ''
    if (CAMERA_FIELDS[row.field]) return `Camera: ${valueWords(row)}${where}`
    if (row.field === 'words') return `Words: ${shortWords(String(row.to ?? ''), 24)}${where}`
    if (row.field === 'moment') return `${sentence(shortWords(String(row.to ?? ''), 22))}${row.window ? ` ${clock(row.window.from_s)}-${clock(row.window.to_s)}` : ''}`
    if (row.field === 'feel') return `Feel: ${shortWords(String(row.to ?? ''), 24)}`
    return sentence(shortWords(String(row.to ?? '')))
  }
  return delta.length === 1 ? one(delta[0]) : `${one(delta[0])} and ${delta.length - 1} more`
}

/** The drawer's diff lines: "Shot 3 camera movement: Static → Handheld". */
export function diffLines(delta: DeltaRow[], shotNo: (id: string) => number): string[] {
  return delta.map((row) => {
    const who = row.shot_id && shotNo(row.shot_id) ? `Shot ${shotNo(row.shot_id)} ` : ''
    const cam = CAMERA_FIELDS[row.field]
    if (cam) return `${who}camera ${FIELD_WORDS[row.field]}: ${cameraWord(cam, row.from == null ? null : String(row.from))} → ${cameraWord(cam, row.to == null ? null : String(row.to))}`
    if (row.field === 'words') return `${who}words: ${row.from ? `“${shortWords(String(row.from), 40)}” → ` : ''}“${shortWords(String(row.to ?? ''), 60)}”`
    if (row.field === 'moment') return `${sentence(shortWords(String(row.to ?? ''), 40))}${row.window ? ` ${clock(row.window.from_s)}-${clock(row.window.to_s)}` : ''}`
    if (row.field === 'feel') return `The whole feel: ${shortWords(String(row.to ?? ''), 60)}`
    return sentence(String(row.to ?? ''))
  })
}

/** What a new take keeps from its parent, per verb. `seed`: the model can repeat the take. */
export function keepsWords(verb: ChangeVerb, o: { refs: string[]; lengthS: number; seed: boolean; window?: { from_s: number; to_s: number } }): string {
  const refs = o.refs.length ? `References ${o.refs.map((r) => `@${r}`).join(' ')}` : 'References'
  const len = `Length ${Math.round(o.lengthS * 10) / 10} s`
  if (verb === 'moment') return ['Everything outside', o.window ? `${clock(o.window.from_s)}-${clock(o.window.to_s)}` : 'the window', '·', 'Sound', '·', len].join(' ')
  if (verb === 'feel') return `The motion and timing · ${len}`
  const parts = ['Start frame', refs, ...(verb === 'words' ? [] : ['Words']), len, ...(o.seed ? ['Seed'] : [])]
  return parts.join(' · ')
}

/** The delta for a camera change on one shot: only the parts that really change. */
export function cameraDelta(shotId: string, from: Record<string, unknown>, to: Record<string, unknown>): DeltaRow[] {
  return (['size', 'angle', 'movement', 'movement_speed'] as const)
    .filter((k) => to[k] !== undefined && (to[k] ?? null) !== (from[k] ?? (k === 'movement' ? 'static' : null)))
    .map((k) => ({ field: `camera.${k}`, from: (from[k] as string | undefined) ?? (k === 'movement' ? 'static' : null), to: to[k] as string, shot_id: shotId }))
}

/** A Change can be sent: it changes something. */
export const changesSomething = (delta: DeltaRow[]) => delta.some((r) => r.to !== null && r.to !== '' && r.to !== r.from)
