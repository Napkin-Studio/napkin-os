// Where each waiting question is on screen (owner 2026-10-15; ui-behaviour 3.17, 5.2): every job that
// stopped at needs_input has a visible place to answer it, never none. A card that shows an ask in its
// place (JobNode, JobSlot, the Script editor's item or page top) registers here while it is mounted; the
// ask dock (ui/AskDock.tsx) shows, under the bar, any waiting ask that belongs on this screen and that no
// card shows, and the one the tray's Show asked for when it is nowhere else. Show then scrolls to the
// card and puts the focus on its first answer.

import { useSyncExternalStore } from 'react'
import type { Route } from '../app/route'
import type { Ask, DocJob, JobState, ProductionDocument } from '../contracts/types'
import type { JobCtx, StageName } from '../doc/ui'
import { askOf } from '../jobs/runner'
import { whereIs } from './tray'

const placed = new Map<string, number>()
const listeners = new Set<() => void>()
let version = 0
let summoned: string | null = null

function changed() {
  version += 1
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** A card shows this ask in its place: until the returned function runs. */
export function placeAsk(askId: string): () => void {
  placed.set(askId, (placed.get(askId) ?? 0) + 1)
  changed()
  return () => {
    const n = (placed.get(askId) ?? 1) - 1
    if (n > 0) placed.set(askId, n)
    else placed.delete(askId)
    changed()
  }
}

export function isPlaced(askId: string): boolean {
  return placed.has(askId)
}

/** Show asked for this ask and found it nowhere: the dock shows it, wherever the person is. */
export function summonAsk(askId: string | null) {
  if (summoned === askId) return
  summoned = askId
  changed()
}

export function summonedAsk(): string | null {
  return summoned
}

// Every bar has a tray and so a dock, and a hidden screen keeps its bar mounted: only the newest dock shows.
const docks: symbol[] = []

/** A dock mounts: it shows while it is the newest, until the returned function runs. */
export function claimDock(me: symbol): () => void {
  docks.push(me)
  changed()
  return () => {
    const i = docks.indexOf(me)
    if (i >= 0) docks.splice(i, 1)
    changed()
  }
}

export function isTopDock(me: symbol): boolean {
  return docks.at(-1) === me
}

/** Re-render when a card places or lets go of an ask, or Show summons one. */
export function useAskPlaces(): number {
  return useSyncExternalStore(subscribe, () => version, () => version)
}

/** Where a job's question belongs: the Script editor of its script (Skye's write), else its stage. */
export type AskHome = { script: string } | { stage: StageName }

export function homeOf(job: Pick<DocJob, 'op' | 'node'>, ctx: JobCtx | undefined): AskHome {
  if (job.op === 'write') return { script: ctx?.for === 'write' && ctx.scriptId ? ctx.scriptId : job.node.id }
  return { stage: whereIs(job, ctx).stage }
}

/** The screen the person is on: a Script editor, or a stage (the canvas is 'character'). */
export function hereOf(route: Route | null, stage: StageName): AskHome {
  return route?.kind === 'script' ? { script: route.scriptId } : { stage }
}

export function sameHome(a: AskHome, b: AskHome): boolean {
  return 'script' in a ? 'script' in b && a.script === b.script : 'stage' in b && a.stage === b.stage
}

export interface WaitingAsk { ask: Ask; job: DocJob }

/** Every job waiting on a person's answer (its live state, else the document's), with its open ask. */
export function waitingAsks(d: ProductionDocument, liveState: (jobId: string) => JobState | undefined = () => undefined): WaitingAsk[] {
  const out: WaitingAsk[] = []
  for (const job of Object.values(d.jobs)) {
    if ((liveState(job.id) ?? job.state) !== 'needs_input') continue
    const ask = askOf(d, job.id)
    if (ask && ask.state === 'open') out.push({ ask, job })
  }
  return out.sort((a, b) => (a.job.created_at < b.job.created_at ? -1 : 1))
}

/** The asks the dock shows here: waiting, shown by no card, and belonging on this screen or summoned. */
export function dockAsks(waiting: WaitingAsk[], here: AskHome, ctxOf: (jobId: string) => JobCtx | undefined,
  shown: (askId: string) => boolean = isPlaced, called: string | null = summoned): WaitingAsk[] {
  return waiting.filter(({ ask, job }) => !shown(ask.id) && (ask.id === called || sameHome(homeOf(job, ctxOf(job.id)), here)))
}

/** Bring an ask's card into view and put the focus on its first answer; false when it is not on screen. */
export function focusAsk(askId: string): boolean {
  const card = [...document.querySelectorAll<HTMLElement>(`[data-ask="${CSS.escape(askId)}"]`)].find((el) => el.isConnected)
  if (!card) return false
  // Put off with Later: open it again first (the next look finds the card).
  if (card.classList.contains('askcard-later')) {
    card.click()
    return false
  }
  card.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  const first = card.querySelector<HTMLElement>('button:not([disabled]):not(.askcard-latr), input, textarea') ?? card
  if (first === card && !card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1')
  first.focus({ preventScroll: true })
  card.classList.remove('flash')
  void card.offsetWidth
  card.classList.add('flash')
  return true
}

/** Show from the tray: look for the ask's card for a few frames; when no card shows it, the dock does. */
export async function showAsk(askId: string, frames = 20): Promise<boolean> {
  for (let i = 0; i < frames; i++) {
    if (focusAsk(askId)) return true
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  }
  summonAsk(askId)
  for (let i = 0; i < frames; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    if (focusAsk(askId)) return true
  }
  return false
}
