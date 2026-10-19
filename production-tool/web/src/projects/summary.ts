// What Home shows of a project without opening it: worked out from the
// document (and the project's job purposes) whenever the project changes, and
// kept in the project index.

import type { ProductionDocument, Sha256, StageName } from '../contracts/types'
import type { JobCtx } from '../doc/ui'
import { isActive } from '../jobs/runner'
import { whoIsWorking } from '../ui/agents/cast'

export interface ProjectSummary {
  /** The stage the project is on. */
  stage: StageName
  /** Named pictures (refs) and every other image the project holds. */
  pictures: number
  shots: number
  /** Things marked out of date (stale), waiting for "Update what follows". */
  behind: number
  /** The rendered ad's length in seconds, when there is one. */
  adSeconds: number | null
  /** Jobs still being made when the project was last open. */
  active: number
  /** What the newest of them is, in words ("Dex is making the clip for shot 3"). */
  making?: string
  /** The picture on its card: the first shot's frame, else a picture from the canvas. */
  thumb?: Sha256
  /** Every picture and clip the project uses, so Clean up in another project leaves them alone. */
  shas: Sha256[]
}

export const UNTITLED = 'Untitled project'

export function summarise(d: ProductionDocument, jobCtx: Record<string, JobCtx> = {}): ProjectSummary {
  const shots = [...(d.shots ?? [])].sort((a, b) => a.order - b.order)
  const behind = new Set((d.stale ?? []).map((s) => `${s.target.kind}:${s.target.id}`)).size
  const ad = [...(d.exports ?? [])].reverse().find((e) => e.kind === 'ad_mp4')
  const adAsset = ad && d.assets.find((a) => a.sha256 === ad.asset)
  const active = d.jobs.filter((j) => isActive(j.state))
  const newest = active.at(-1)
  let making: string | undefined
  if (newest) {
    const ctx = jobCtx[newest.id]
    const shotId = ctx && 'shotId' in ctx ? ctx.shotId : undefined
    const order = shotId ? shots.findIndex((s) => s.id === shotId) + 1 || undefined : undefined
    making = whoIsWorking(newest, newest.state, ctx, order).line
  }
  return {
    stage: d.stage.current,
    pictures: d.assets.filter((a) => a.kind === 'image').length,
    shots: shots.length,
    behind,
    adSeconds: ad ? Math.round(adAsset?.duration_s ?? shots.reduce((t, s) => t + (s.duration_s ?? 0), 0)) : null,
    active: active.length,
    ...(making ? { making } : {}),
    ...thumbOf(d, shots),
    shas: d.assets.map((a) => a.sha256),
  }
}

function thumbOf(d: ProductionDocument, shots: NonNullable<ProductionDocument['shots']>): { thumb?: Sha256 } {
  const frames = d.frames ?? []
  for (const s of shots) {
    const f = s.storyboard_frame ?? frames.find((x) => x.shot_id === s.id && x.selected)?.asset ?? frames.find((x) => x.shot_id === s.id)?.asset
    if (f) return { thumb: f }
  }
  if (frames[0]) return { thumb: frames[0].asset }
  const ref = d.refs[0]?.asset
  if (ref) return { thumb: ref }
  const pic = d.assets.find((a) => a.kind === 'image' && a.origin !== 'drawn') ?? d.assets.find((a) => a.kind === 'image')
  return pic ? { thumb: pic.sha256 } : {}
}

/** The name a project takes by itself: the first line of its script, once it has one. */
export function autoName(d: ProductionDocument): string | null {
  const revs = d.script?.revisions ?? []
  const rev = revs.find((r) => r.id === d.script?.current) ?? revs.at(-1)
  const line = rev?.imported_text.split('\n').map((l) => l.trim()).find(Boolean)
  if (!line) return null
  return clip(line.replace(/\s+/g, ' '), 60)
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s
  const cut = s.slice(0, n)
  const space = cut.lastIndexOf(' ')
  return `${(space > n * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`
}

/** Has the person put anything in it? (An empty document is all a first visit ever had.) */
export function isEmptyDocument(d: ProductionDocument): boolean {
  return !d.assets.length && !d.refs.length && !d.jobs.length && !(d.script?.revisions ?? []).length && !(d.shots ?? []).length
}
