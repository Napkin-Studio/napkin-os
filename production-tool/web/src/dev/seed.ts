// Dev-only seeding for the e2e harness (production-tool/web/e2e; features/image-editor-masks-layers.clan
// P0): a project with storyboard shots and a drawn frame, made in one call instead of the slow UI path
// (drop a picture, plan, draw). It writes through the same helpers the app uses: a frame lands through
// jobs/handlers applyFrame (what a finished frame job does), shots get ranks from clan-store, and the
// picture goes into the blob store with its asset row like the Image editor's registerAsset. Loaded only
// under import.meta.env.DEV (main.tsx), as window.__seed; never in a build.

import { newProjectData, newUlidId, ranksBetween } from '../../../clan-store/src'
import type { Job, Mime, ProductionDocument, Shot } from '../contracts/types'
import type { Services } from '../app/context'
import { systemUpdate } from '../doc/store'
import { applyFrame, applyTake } from '../jobs/handlers'
import { splitHere } from '../jobs/runView'
import { selectedFrame } from '../jobs/frames'
import { putBlob } from '../lib/blobs'
import { mainScript, mainStoryboard, mainVideo, shotsOf } from '../model/selectors'
import { seedNodes, type NodeEnv } from '../canvas/nodes/nodes'
import { addBrief, newBrief } from '../brief/model'
import { linkBrief, placeBrief } from '../brief/canvas'
import type { Shell } from '../projects/shell'
import { formatRoute, scriptRoute } from '../app/route'

export interface SeedFrameOpts {
  /** The storyboard's ratio ('16:9', '9:16', '1:1', '4:5'); 16:9 by default. */
  ratio?: string
  /** The picture's size; 1344 x 756 for 16:9, 756 x 1344 for 9:16, else 1024 on the long side. */
  w?: number
  h?: number
  /** How many shots the storyboard gets (the frame goes on `frameOn`, 0-based). */
  shots?: number
  frameOn?: number
}

export interface Seeded { projectId: string; shotIds: string[]; shotId: string; frameId: string; sha: string; w: number; h: number }

const SIZES: Record<string, [number, number]> = { '16:9': [1344, 756], '9:16': [756, 1344], '1:1': [1024, 1024], '4:5': [820, 1024] }

/** A picture with known pixels: four colour quadrants, a white disc in the middle and a dark bar near the top. */
export async function seedPicture(w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const q = [['#C8553D', '#F2D0A4'], ['#2A9D8F', '#264653']]
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    ctx.fillStyle = q[y][x]
    ctx.fillRect((x * w) / 2, (y * h) / 2, w / 2, h / 2)
  }
  ctx.fillStyle = '#FFFFFF'
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.18, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#14161B'
  ctx.fillRect(w * 0.1, h * 0.08, w * 0.3, h * 0.05)
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png'))
}

/** A new project (unless one is open and empty of shots), `shots` shots and a frame on one of them. */
export async function seedFrame(shell: Shell, opts: SeedFrameOpts = {}): Promise<Seeded> {
  const ratio = opts.ratio ?? '16:9'
  const [dw, dh] = SIZES[ratio] ?? [1024, 1024]
  const w = opts.w ?? dw
  const h = opts.h ?? dh
  await seedTarget(shell)
  const services: Services = shell.get().session!.services
  const projectId = services.project.id
  const blob = await seedPicture(w, h)
  const sha = await putBlob(blob)
  const n = Math.max(1, opts.shots ?? 3)
  const on = Math.min(n - 1, opts.frameOn ?? 0)
  let shotIds: string[] = []
  let frameId = ''
  await systemUpdate(services.doc, (d: ProductionDocument) => {
    // A new project starts blank (the app asks clan-store for blank since 2026-11-04): give it the three
    // stages (script, storyboard, video, linked) a non-blank project starts with, as clan-store makes them.
    if (!mainStoryboard(d)) {
      const person = { id: String(d.project.created_by ?? 'human:e2e').replace(/^human:/, ''), handle: 'e2e', tenant_id: String(d.project.tenant_id ?? '') }
      const stages = newProjectData({ person, title: d.project.title ?? 'e2e', newId: newUlidId, now: new Date().toISOString() }) as unknown as ProductionDocument
      Object.assign(d.scripts, stages.scripts)
      Object.assign(d.storyboards, stages.storyboards)
      Object.assign(d.videos, stages.videos)
      Object.assign(d.links, stages.links)
    }
    const sb = mainStoryboard(d)
    if (!sb) throw new Error('This project has no storyboard.')
    sb.ratio = ratio as typeof sb.ratio
    const last = shotsOf(d, sb.id).at(-1)?.rank ?? null
    shotIds = ranksBetween(last, null, n).map((rank) => {
      const s: Shot = { id: newUlidId('shot'), v: 1, field_v: {}, storyboard_id: sb.id, rank, kind: 'shot', duration_s: 5, camera: { size: 'insert' }, status: 'locked' } as Shot
      d.shots[s.id] = s
      return s.id
    })
    d.assets[sha] = { sha256: sha, kind: 'image', mime: (blob.type || 'image/png') as Mime, bytes: blob.size, w, h, origin: 'generated' }
    // As a finished frame job lands (jobs/handlers applyFrame): a new version, picked now.
    const job = { jobId: newUlidId('job'), op: 'frame', kind: 'mock', outputs: [{ sha256: sha, w, h }] } as unknown as Job
    frameId = applyFrame(d, job, { shotId: shotIds[on] })?.id ?? ''
  }, 'e2e seed')
  await (services.doc as { flush?: () => Promise<void> }).flush?.()
  return { projectId, shotIds, shotId: shotIds[on], frameId, sha, w, h }
}

/** The film a seed writes into: the open one, unless it is the blank canvas the tool opened on (a draft), whose
 *  canvas has already read its scene and so would not draw the Script, Storyboard and Film a seed adds; then a
 *  fresh film, as at boot before entry opened a blank canvas (owner 2026-11-18). */
async function seedTarget(shell: Shell): Promise<void> {
  const open = shell.get().session
  if (!open || shell.index.get(open.id)?.draft) await shell.newProject()
}

/** The seed helpers on window, for the e2e specs and the dev console. */
export function installSeed(shell: Shell) {
  ;(window as unknown as { __seed: unknown }).__seed = {
    frame: (opts?: SeedFrameOpts) => seedFrame(shell, opts),
    /** A project open on the canvas (a new one unless one is open), for specs that drop pictures there. */
    canvas: async () => {
      await seedTarget(shell)
      shell.get().session?.services.ui.update((u) => { u.stage = 'character' }, 'e2e seed')
    },
    /** A Brief node from Brief Maker's data, placed on the canvas and linked into the main script (the
     *  paired screenshots of features/production-new-ui.clan). Needs the canvas open on our own engine. */
    brief: async (data: unknown, title = 'Colour of the market') => {
      const env = (window as unknown as { __canvasEnv?: NodeEnv }).__canvasEnv
      const services = shell.get().session?.services
      if (!env || !services) throw new Error('open a project on the canvas first')
      services.ui.update((u) => { u.configChoice = 'allon' }, 'e2e seed')
      const b = await addBrief(services.doc, newBrief({ documentId: 'doc-seed', title, appId: 'ie.napkin.brief-maker', dataSha256: `sha256:${'b'.repeat(64)}`, version: 1, data }, 'link'))
      const el = placeBrief(env, b.id)
      const script = mainScript(services.doc.get())
      if (script) await linkBrief(env, b.id, { kind: 'script', id: script.id }).catch(() => undefined)
      return { briefId: b.id, elementId: el.id }
    },
    /** The paired screenshots' project (features/production-new-ui.clan; the mock's "Market day"): a title, and
     *  one shot per picture with its words, length and a drawn frame. `pics` are data URLs. */
    market: async (o: { title?: string; noFrames?: boolean; shots: { pic: string; action: string; s: number }[] }) => {
      await seedTarget(shell)
      const services: Services = shell.get().session!.services
      const blobs = await Promise.all(o.shots.map(async (x) => (await fetch(x.pic)).blob()))
      const shas = await Promise.all(blobs.map((b) => putBlob(b)))
      await systemUpdate(services.doc, (d: ProductionDocument) => {
        if (!mainStoryboard(d)) {
          const person = { id: String(d.project.created_by ?? 'human:e2e').replace(/^human:/, ''), handle: 'e2e', tenant_id: String(d.project.tenant_id ?? '') }
          const stages = newProjectData({ person, title: o.title ?? 'Market day', newId: newUlidId, now: new Date().toISOString() }) as unknown as ProductionDocument
          Object.assign(d.scripts, stages.scripts); Object.assign(d.storyboards, stages.storyboards); Object.assign(d.videos, stages.videos); Object.assign(d.links, stages.links)
        }
        if (o.title) d.project.title = o.title
        const sb = mainStoryboard(d)!
        const sc = mainScript(d)
        if (sc) sc.target_s = o.shots.reduce((a, x) => a + x.s, 0)
        const ranks = ranksBetween(shotsOf(d, sb.id).at(-1)?.rank ?? null, null, o.shots.length)
        o.shots.forEach((x, i) => {
          const s: Shot = { id: newUlidId('shot'), v: 1, field_v: {}, storyboard_id: sb.id, rank: ranks[i], kind: 'shot', duration_s: x.s, action: x.action, camera: { size: i === 2 ? 'close' : i === 0 ? 'wide' : 'medium' }, status: 'locked' } as Shot
          d.shots[s.id] = s
          d.assets[shas[i]] = { sha256: shas[i], kind: 'image', mime: 'image/jpeg' as Mime, bytes: blobs[i].size, w: 1344, h: 756, origin: 'generated' }
          if (o.noFrames) return
          const job = { jobId: newUlidId('job'), op: 'frame', kind: 'mock', outputs: [{ sha256: shas[i], w: 1344, h: 756 }] } as unknown as Job
          applyFrame(d, job, { shotId: s.id })
        })
      }, 'e2e seed')
      await (services.doc as { flush?: () => Promise<void> }).flush?.()
      services.ui.update((u) => { u.stage = 'character' }, 'e2e seed')
    },
    /** Mock: the script's own words (a scene), so Plan shots has something to read. */
    scene: async () => {
      const services: Services = shell.get().session!.services
      await systemUpdate(services.doc, (d: ProductionDocument) => {
        const sc = mainScript(d)!
        sc.target_s = 22
        const sbd = mainStoryboard(d)
        if (sbd) sbd.target_s = 22
        const id = newUlidId('scene')
        d.scenes[id] = { id, v: 1, field_v: {}, script_id: sc.id, rank: ranksBetween(null, null, 1)[0], heading: 'EXT. FERNCLIFF STREAM - DAY', text: 'A walker stops by a stream in the sun and opens a cold can of Ferncliff.' } as never
      }, 'e2e seed')
      await (services.doc as { flush?: () => Promise<void> }).flush?.()
    },
    /** Mock: an end card shot last on the storyboard. */
    endcard: async () => {
      const services: Services = shell.get().session!.services
      await systemUpdate(services.doc, (d: ProductionDocument) => {
        const sb = mainStoryboard(d)!
        const rank = ranksBetween(shotsOf(d, sb.id).at(-1)?.rank ?? null, null, 1)[0]
        const s: Shot = { id: newUlidId('shot'), v: 1, field_v: {}, storyboard_id: sb.id, rank, kind: 'end_card', duration_s: 2, action: 'End card: "Ferncliff. Cool, lightly."', camera: { size: 'insert' }, status: 'locked' } as Shot
        d.shots[s.id] = s
      }, 'e2e seed')
      await (services.doc as { flush?: () => Promise<void> }).flush?.()
    },
    /** The Film's rooms with footage (the paired screenshots' make/edit states): after market(), each shot its
     *  own box with one ready mock take (its frame as a still), each in the Edit room's cut. */
    takes: async () => {
      const services: Services = shell.get().session!.services
      const d0 = services.doc.get()
      const sb = mainStoryboard(d0)
      const video = mainVideo(d0)
      if (!sb || !video) return
      const shots = shotsOf(d0, sb.id)
      for (const s of shots.slice(1)) await splitHere(services.doc, video.id, s.id)
      await systemUpdate(services.doc, (d: ProductionDocument) => {
        for (const s of shotsOf(d, sb.id)) {
          const sha = selectedFrame(d, s.id)?.asset
          if (!sha) continue
          const job = { jobId: newUlidId('job'), op: 'clip', kind: 'mock', provider: 'mock', model: 'mock', outputs: [{ sha256: sha, durationS: s.duration_s }] } as unknown as Job
          applyTake(d, job, { for: 'clip', shotId: s.id } as never, { inCut: true } as never)
        }
      }, 'e2e seed')
      await (services.doc as { flush?: () => Promise<void> }).flush?.()
    },
    /** Opens the main script in the Script editor (the paired screenshots' script states). */
    script: async () => {
      await seedTarget(shell)
      const services: Services = shell.get().session!.services
      // A blank project has no stages: give it a script, storyboard and video as a non-blank one starts with.
      if (!mainScript(services.doc.get())) {
        await systemUpdate(services.doc, (d: ProductionDocument) => {
          const person = { id: String(d.project.created_by ?? 'human:e2e').replace(/^human:/, ''), handle: 'e2e', tenant_id: String(d.project.tenant_id ?? '') }
          const stages = newProjectData({ person, title: d.project.title ?? 'Market day', newId: newUlidId, now: new Date().toISOString() }) as unknown as ProductionDocument
          Object.assign(d.scripts, stages.scripts); Object.assign(d.storyboards, stages.storyboards); Object.assign(d.videos, stages.videos); Object.assign(d.links, stages.links)
        }, 'e2e seed')
      }
      const sc = mainScript(services.doc.get())
      if (!sc) throw new Error('no script')
      history.pushState(history.state, '', formatRoute(scriptRoute(services.project.id, sc.id)))
      dispatchEvent(new PopStateEvent('popstate'))
      return sc.id
    },
    /** The document's Script, Storyboard and Film (when it has one) drawn on the canvas, as a project opened on a
     *  canvas that has none yet shows them. */
    nodes: async () => {
      const env = (window as unknown as { __canvasEnv?: NodeEnv }).__canvasEnv
      if (!env) throw new Error('open a project on the canvas first')
      env.canvas.transact((els) => [...els, ...seedNodes(env.canvas, env.doc.get() as ProductionDocument)], { undoable: false })
    },
    /** The blank-canvas start: a storyboard and no Film node (owner 2026-11-03), as the UAT walkthrough had it. */
    noFilm: async () => {
      const services: Services = shell.get().session!.services
      await systemUpdate(services.doc, (d: ProductionDocument) => {
        for (const id of Object.keys(d.videos)) delete d.videos[id]
        for (const [id, l] of Object.entries(d.links)) if (l.to?.kind === 'video' || l.from?.kind === 'video') delete d.links[id]
      }, 'e2e seed')
      await (services.doc as { flush?: () => Promise<void> }).flush?.()
    },
    /** Opens the storyboard stage (the Image editor opens from a shot there). */
    storyboard: () => shell.get().session?.services.ui.update((u) => { u.stage = 'storyboard' }, 'e2e seed'),
  }
}
