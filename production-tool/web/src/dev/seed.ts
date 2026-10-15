// Dev-only seeding for the e2e harness (production-tool/web/e2e; features/image-editor-masks-layers.clan
// P0): a project with storyboard shots and a drawn frame, made in one call instead of the slow UI path
// (drop a picture, plan, draw). It writes through the same helpers the app uses: a frame lands through
// jobs/handlers applyFrame (what a finished frame job does), shots get ranks from clan-store, and the
// picture goes into the blob store with its asset row like the Image editor's registerAsset. Loaded only
// under import.meta.env.DEV (main.tsx), as window.__seed; never in a build.

import { newUlidId, ranksBetween } from '../../../clan-store/src'
import type { Job, Mime, ProductionDocument, Shot } from '../contracts/types'
import type { Services } from '../app/context'
import { systemUpdate } from '../doc/store'
import { applyFrame } from '../jobs/handlers'
import { idbLocation, putBlob } from '../lib/blobs'
import { mainStoryboard, shotsOf } from '../model/selectors'
import type { Shell } from '../projects/shell'

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
  if (!shell.get().session) await shell.newProject()
  const services: Services = shell.get().session!.services
  const projectId = services.project.id
  const blob = await seedPicture(w, h)
  const sha = await putBlob(blob)
  const n = Math.max(1, opts.shots ?? 3)
  const on = Math.min(n - 1, opts.frameOn ?? 0)
  let shotIds: string[] = []
  let frameId = ''
  await systemUpdate(services.doc, (d: ProductionDocument) => {
    const sb = mainStoryboard(d)
    if (!sb) throw new Error('This project has no storyboard.')
    sb.ratio = ratio as typeof sb.ratio
    const last = shotsOf(d, sb.id).at(-1)?.rank ?? null
    shotIds = ranksBetween(last, null, n).map((rank) => {
      const s: Shot = { id: newUlidId('shot'), v: 1, field_v: {}, storyboard_id: sb.id, rank, kind: 'shot', duration_s: 5, camera: { size: 'insert' }, status: 'locked' } as Shot
      d.shots[s.id] = s
      return s.id
    })
    d.assets[sha] = { sha256: sha, kind: 'image', mime: (blob.type || 'image/png') as Mime, bytes: blob.size, w, h, origin: 'generated', locations: [idbLocation(sha)] }
    // As a finished frame job lands (jobs/handlers applyFrame): a new version, picked now.
    const job = { jobId: newUlidId('job'), op: 'frame', kind: 'mock', outputs: [{ sha256: sha, w, h }] } as unknown as Job
    frameId = applyFrame(d, job, { shotId: shotIds[on] })?.id ?? ''
  }, 'e2e seed')
  await (services.doc as { flush?: () => Promise<void> }).flush?.()
  return { projectId, shotIds, shotId: shotIds[on], frameId, sha, w, h }
}

/** The seed helpers on window, for the e2e specs and the dev console. */
export function installSeed(shell: Shell) {
  ;(window as unknown as { __seed: unknown }).__seed = {
    frame: (opts?: SeedFrameOpts) => seedFrame(shell, opts),
    /** Opens the storyboard stage (the Image editor opens from a shot there). */
    storyboard: () => shell.get().session?.services.ui.update((u) => { u.stage = 'storyboard' }, 'e2e seed'),
  }
}
