// What Home shows of a project without opening it: worked out from the
// document (contract 3) and the project's UI (which panel is open, what this
// browser keeps about each job) whenever the project changes, and kept in the
// project index.

import type { ProductionDocument, Sha256 } from '../contracts/types'
import type { ProjectUi, StageName } from '../doc/ui'
import { isActive } from '../jobs/runner'
import { purposeOf } from '../model/purpose'
import { assetsList, currentFrame, currentRender, framesOf, jobsList, refsList, scenesOf, shotNumber, shotsOf, storyboardSeconds } from '../model/selectors'
import { whoIsWorking } from '../ui/agents/cast'

export interface ProjectSummary {
  /** The panel the project was left on. */
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
  /** What the newest of them is, in words ("Fin is making the clip for shot 3"). */
  making?: string
  /** The picture on its card: the first shot's frame, else a picture from the canvas. */
  thumb?: Sha256
  /** Every picture and clip the project uses, so Clean up in another project leaves them alone. */
  shas: Sha256[]
}

export const UNTITLED = 'Untitled project'

export function summarise(d: ProductionDocument, ui: Partial<Pick<ProjectUi, 'stage' | 'jobs'>> = {}): ProjectSummary {
  const shots = shotsOf(d)
  const behind = new Set(Object.values(d.stale).map((s) => `${s.target.kind}:${s.target.id}`)).size
  const ad = currentRender(d)
  const adAsset = ad && d.assets[ad.asset]
  const active = jobsList(d).filter((j) => isActive(j.state))
  const newest = active.at(-1)
  let making: string | undefined
  if (newest) {
    const purpose = purposeOf(newest)
    const ctx = purpose ? { ...purpose, ...(ui.jobs?.[newest.id]?.fallbackFrom ? { fallbackFrom: ui.jobs[newest.id].fallbackFrom } : {}) } : undefined
    const shotId = newest.node.kind === 'shot' ? newest.node.id : undefined
    making = whoIsWorking(newest, newest.state, ctx, shotId ? shotNumber(d, shotId) || undefined : undefined).line
  }
  return {
    stage: ui.stage ?? 'character',
    pictures: assetsList(d).filter((a) => a.kind === 'image').length,
    shots: shots.length,
    behind,
    adSeconds: ad ? Math.round(adAsset?.duration_s ?? storyboardSeconds(d)) : null,
    active: active.length,
    ...(making ? { making } : {}),
    ...thumbOf(d),
    shas: Object.keys(d.assets),
  }
}

function thumbOf(d: ProductionDocument): { thumb?: Sha256 } {
  for (const s of shotsOf(d)) {
    const f = currentFrame(d, s)?.asset ?? framesOf(d, s.id).at(-1)?.asset
    if (f) return { thumb: f }
  }
  const frame = Object.values(d.frames).find((f) => f.asset)
  if (frame) return { thumb: frame.asset }
  const ref = refsList(d).find((r) => r.asset)?.asset
  if (ref) return { thumb: ref }
  const images = assetsList(d).filter((a) => a.kind === 'image')
  const pic = images.find((a) => a.origin !== 'drawn') ?? images[0]
  return pic ? { thumb: pic.sha256 } : {}
}

/** The script's words in order: each scene's unplanned text, then the action of the shots planned from it. */
function scriptLines(d: ProductionDocument): string[] {
  const lines: string[] = []
  for (const sc of scenesOf(d)) {
    lines.push(...(sc.text ?? '').split('\n'))
    for (const s of Object.values(d.shots).filter((x) => x.scene_id === sc.id).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))) lines.push(...(s.action ?? '').split('\n'))
  }
  return lines
}

/** The name a project takes by itself: the first line of its script, once it has one. */
export function autoName(d: ProductionDocument): string | null {
  const line = scriptLines(d).map((l) => l.trim()).find(Boolean)
  if (!line) return null
  return clip(line.replace(/\s+/g, ' '), 60)
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s
  const cut = s.slice(0, n)
  const space = cut.lastIndexOf(' ')
  return `${(space > n * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`
}

/** Has the person put anything in it? (A new project's script, storyboard and video are not work.) */
export function isEmptyDocument(d: ProductionDocument): boolean {
  return !Object.keys(d.assets).length && !Object.keys(d.refs).length && !Object.keys(d.jobs).length && !Object.keys(d.shots).length
    && !scriptLines(d).some((l) => l.trim())
}
