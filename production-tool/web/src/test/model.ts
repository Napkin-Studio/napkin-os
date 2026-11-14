// For tests: the real napkin-wasm behind a ModelStore, and contract-3 entities
// made the short way. Node only (it reads the wasm from disk).

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { ClanDocumentStore, newUlidId, rankBetween, ranksBetween, type Persistence, type Person, type SerializedUndo } from '../../../clan-store/src'
import type { DocAsset, DocJob, Frame, Generation, ProductionDocument, Shot } from '../contracts/types'
import { pickInCut } from '../doc/cutWrites'
import { mainScript, mainStoryboard, mainVideo, scenesOf } from '../model/selectors'
import { ModelStore } from '../model/store'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', '..', '..', 'clan-store', 'src', 'wasm', 'napkin_wasm_bg.wasm')

let wasmBytes: Uint8Array | null = null
/** napkin-wasm's bytes, built by `npm run clan-store`. */
export function wasm(): Uint8Array {
  if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: run \`npm run clan-store\` first`)
  return (wasmBytes ??= new Uint8Array(readFileSync(wasmPath)))
}

export const TENANT = '5b6f3c1e-9d2a-5c4b-8e7f-0a1b2c3d4e5f'
export const MAYA: Person = { id: 'p_maya01', handle: 'maya', tenant_id: TENANT }
export const T = '2026-10-13T10:40:00Z'
export const SHA = (c: string) => `sha256:${c.repeat(64)}`
export const id = (prefix: string) => newUlidId(prefix)

/** A ModelStore over the real wasm, saving nowhere (or to `persistence`). */
export function modelStore(opts: { person?: Person; persistence?: Persistence | null; undo?: { saved: SerializedUndo | null | undefined; save: (s: SerializedUndo) => void } } = {}): ModelStore {
  const person = opts.person ?? MAYA
  return new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence: opts.persistence ?? null, person, saveDebounceMs: 0 }), { debounceMs: 1, undo: opts.undo })
}

const base = <T extends object>(prefix: string, rest: T) => {
  const i = id(prefix)
  return { id: i, v: 1, field_v: {}, ...rest }
}

export function asset(sha: string, kind: DocAsset['kind'] = 'image', extra: Partial<DocAsset> = {}): DocAsset {
  return { sha256: sha, kind, mime: kind === 'video' ? 'video/mp4' : 'image/png', origin: 'generated', locations: [], ...extra }
}

export function job(d: ProductionDocument, op: DocJob['op'], inputs: string[], out: string | null, extra: Partial<DocJob> = {}): DocJob {
  const state = extra.state ?? 'completed'
  return base('job', {
    op, state, node: { kind: 'storyboard', id: mainStoryboard(d)!.id }, started_by: `human:${MAYA.id}`, tenant_id: TENANT, nonce: id('n'),
    crew: 'wren', parent_ids: [], input_hashes: inputs, outputs: out && state === 'completed' ? [out] : [], created_at: T, ...extra,
  }) as DocJob
}

/** `n` new shots at the end of the main storyboard, in rank order. */
export function addShots(d: ProductionDocument, n: number, extra: Partial<Shot> = {}): Shot[] {
  const sb = mainStoryboard(d)!
  const last = Object.values(d.shots).filter((s) => s.storyboard_id === sb.id).map((s) => s.rank).sort().at(-1) ?? null
  return ranksBetween(last, null, n).map((rank) => {
    const s = base('shot', { storyboard_id: sb.id, rank, kind: 'shot', duration_s: 5, camera: { size: 'medium' }, status: 'locked', ...extra }) as Shot
    d.shots[s.id] = s
    return s
  })
}

export function addFrame(d: ProductionDocument, shot: Shot, sha: string, opts: { pick?: boolean; parent?: Frame; job?: DocJob } = {}): Frame {
  const version = Object.values(d.frames).filter((f) => f.shot_id === shot.id).length + 1
  const f = base('frame', {
    shot_id: shot.id, version, kind: 'mock', asset: sha, crew: 'wren', ...(opts.job ? { job_id: opts.job.id } : {}), ...(opts.parent ? { parent_id: opts.parent.id } : {}),
  }) as Frame
  d.frames[f.id] = f
  d.assets[sha] ??= asset(sha)
  if (opts.pick) shot.pick = { current: f.id, alternates: [...(shot.pick ? [shot.pick.current] : []), ...(shot.pick?.alternates ?? [])] }
  return f
}

/** A ready take (a generation) of one shot, made by job `j`; with `pick` it is the shot's clip in the main
 *  video's cut (its V1 clip, as the Video editor puts it there). */
export function addTake(d: ProductionDocument, shot: Shot, sha: string, j: DocJob, opts: { pick?: boolean; parent?: Generation } = {}): Generation {
  const g = base('gen', {
    kind: opts.parent ? 'change' : 'clip', ...(opts.parent ? { parent_id: opts.parent.id } : {}),
    inputs: { model: 'mock', length_s: shot.duration_s }, shot_ids: [shot.id], asset: sha, duration_s: shot.duration_s, state: 'ready',
    job_id: j.id, provider: 'mock', crew: 'wren', mock: true, created_at: j.created_at ?? T, by: `human:${MAYA.id}`,
  }) as Generation
  d.generations[g.id] = g
  d.assets[sha] ??= asset(sha, 'video', { duration_s: shot.duration_s })
  if (opts.pick) pickInCut(d, mainVideo(d)!.id, shot.id, g.id)
  return g
}

/** Plain JSON, for comparing documents. */
export const plain = <X>(x: X): X => JSON.parse(JSON.stringify(x))

/** A document with the bus's bookkeeping (v, field_v) taken out, for comparing what a person sees. */
export function content(d: ProductionDocument): unknown {
  return JSON.parse(JSON.stringify(d, (k, v) => (k === 'v' || k === 'field_v' ? undefined : v)))
}

/** A real .clan whose data says contract 2: what a project from before contract 3 is to this build. */
export async function v2Clan(): Promise<Uint8Array> {
  const s = modelStore()
  await s.create(MAYA, 'Before')
  const files = unzipSync(await s.exportClan())
  await s.close()
  const data = new TextDecoder().decode(files['shared/data.yaml'])
  if (!data.includes("contract_version: '3'")) throw new Error('the data no longer says its contract the way v2Clan expects')
  files['shared/data.yaml'] = strToU8(data.replace("contract_version: '3'", "contract_version: '2'"))
  return zipSync(files)
}

/** For tests: a script's words in its first scene (made when there is none), the other scenes' emptied,
 *  as a draft change (the store writes them as live text). The app writes words only through the
 *  editors (features/script-editor.clan). */
export function scriptWords(d: ProductionDocument, text: string) {
  const script = mainScript(d)
  if (!script) throw new Error('This project has no script.')
  const scenes = scenesOf(d, script.id)
  if (!scenes.length) {
    if (!text) return
    const sid = id('scene')
    d.scenes[sid] = { id: sid, v: 1, field_v: {}, script_id: script.id, rank: rankBetween(null, null), heading: '', text }
    return
  }
  const [first, ...rest] = scenes
  d.scenes[first.id].text = text
  for (const sc of rest) if (sc.text) d.scenes[sc.id].text = ''
}
