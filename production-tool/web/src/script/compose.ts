// The Script editor's row model (features/script-editor.clan): ONE ordered list of
// rows over contract 3's entities, which both views (Screenplay and Video · Audio)
// render, so they cannot drift. Pure.
//
// Order is never in a fragment (contracts/collab.md §2): scenes by rank; a scene's
// shots by rank; a shot's beats by at_s, then rank; shots with no scene (or a scene
// that is gone) after the last scene; the end card last.

import type { Beat, Id, ProductionDocument, Scene, Script, Shot, Storyboard } from '../contracts/types'
import { beatsOf, mainScript, mainStoryboard, scenesOf } from '../model/selectors'

type Doc = ProductionDocument

export type ScriptRow =
  | { kind: 'scene'; id: Id; scene: Scene; number: number }
  | { kind: 'shot'; id: Id; shot: Shot; number: number; sceneId?: Id; start_s: number }
  | { kind: 'beat'; id: Id; beat: Beat; shotId: Id }
  | { kind: 'end_card'; id: Id; shot: Shot; number: number; start_s: number }

export interface ComposedScript {
  script: Script
  /** The storyboard whose shots the script shows (the one it drives). */
  storyboard?: Storyboard
  rows: ScriptRow[]
  /** The shots in script order (numbered 1…), end card included. */
  shots: Shot[]
  total_s: number
}

const byRank = <T extends { rank: string; id: string }>(a: T, b: T) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The storyboards a script drives, most recently linked first (open question 9: 'Shots from:'). */
export function storyboardsOf(d: Doc, scriptId: Id): Storyboard[] {
  const links = Object.values(d.links ?? {}).filter((l) => l.role === 'drives' && l.from.kind === 'script' && l.from.id === scriptId && l.to.kind === 'storyboard')
  return links.sort((a, b) => (a.id < b.id ? 1 : -1)).map((l) => d.storyboards[l.to.id]).filter((s): s is Storyboard => !!s)
}

/** The ordered rows of a script; `storyboardId` picks which storyboard's shots (default: the newest it drives). */
export function composeScript(d: Doc, scriptId: Id | undefined = mainScript(d)?.id, storyboardId?: Id): ComposedScript | null {
  const script = scriptId ? d.scripts[scriptId] : undefined
  if (!script) return null
  const storyboard = storyboardId ? d.storyboards[storyboardId] : storyboardsOf(d, script.id)[0] ?? (script.id === mainScript(d)?.id ? mainStoryboard(d) : undefined)
  const scenes = scenesOf(d, script.id)
  const sceneIds = new Set(scenes.map((s) => s.id))
  const all = Object.values(d.shots).filter((s) => storyboard && s.storyboard_id === storyboard.id).sort(byRank)
  const ends = all.filter((s) => s.kind === 'end_card')
  const plain = all.filter((s) => s.kind !== 'end_card')
  const rows: ScriptRow[] = []
  const shots: Shot[] = []
  let t = 0
  const pushShot = (s: Shot, sceneId?: Id) => {
    shots.push(s)
    rows.push({ kind: 'shot', id: s.id, shot: s, number: shots.length, ...(sceneId ? { sceneId } : {}), start_s: t })
    t += s.duration_s
    for (const b of beatsOf(d, s.id)) rows.push({ kind: 'beat', id: b.id, beat: b, shotId: s.id })
  }
  scenes.forEach((sc, i) => {
    rows.push({ kind: 'scene', id: sc.id, scene: sc, number: i + 1 })
    for (const s of plain.filter((x) => x.scene_id === sc.id)) pushShot(s, sc.id)
  })
  for (const s of plain.filter((x) => !x.scene_id || !sceneIds.has(x.scene_id))) pushShot(s)
  for (const s of ends) {
    shots.push(s)
    rows.push({ kind: 'end_card', id: s.id, shot: s, number: shots.length, start_s: t })
    t += s.duration_s
  }
  return { script, ...(storyboard ? { storyboard } : {}), rows, shots, total_s: Math.round(t * 10) / 10 }
}

/** The shot rows' order, for a drag: the neighbours a shot would land between at `index` (in `ids`, without it). */
export function neighboursAt(ids: Id[], moving: Id, index: number): { beforeId: Id | null; afterId: Id | null } {
  const rest = ids.filter((x) => x !== moving)
  const i = Math.max(0, Math.min(rest.length, index))
  return { beforeId: rest[i - 1] ?? null, afterId: rest[i] ?? null }
}

/** The scene a shot dropped between two neighbours belongs to: the one above's, else the one below's. */
export function sceneAt(rows: ScriptRow[], beforeId: Id | null, afterId: Id | null): Id | null {
  const sceneOf = (id: Id | null) => {
    const r = id ? rows.find((x) => x.kind === 'shot' && x.id === id) : undefined
    return r && r.kind === 'shot' ? r.sceneId ?? null : undefined
  }
  const above = sceneOf(beforeId)
  if (above !== undefined) return above
  const below = sceneOf(afterId)
  return below ?? null
}

/**
 * A rough length before shots exist (open question 8): dialogue at 2.5 words a second,
 * about 2 s per action line. Labelled 'rough, from the words'.
 */
export function roughSeconds(text: string): number {
  let s = 0
  let speaking = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      speaking = false
      continue
    }
    if (/^[A-Z][A-Z0-9 .'-]+$/.test(line) && line.length < 40) {
      speaking = true
      continue
    }
    if (/^\(.*\)$/.test(line)) continue
    if (speaking) s += line.split(/\s+/).length / 2.5
    else s += 2
  }
  return Math.round(s * 10) / 10
}
