// The take's notes and Final, worked out for the Change panel (TakeNotes.tsx draws them).

import { useDoc, useServices, useUi } from '../app/context'
import { SHEETS } from '../contracts/load'
import type { Generation, Region } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { modelLabel } from '../capabilities'
import { clipText } from '../lib/guard'
import { genModel, reviewsList } from '../model/selectors'
import { personOf } from '../projects/session'
import { addTakeNote } from '../stages/videoEdits'
import type { Gen } from './model'

/** The open notes on a take, oldest moment first. */
export function openNotesOf(doc: ReturnType<typeof useDoc>, takeId: string) {
  return reviewsList(doc).filter((r) => r.target.kind === 'generation' && r.target.id === takeId && r.state !== 'resolved')
    .sort((a, b) => (a.at_s ?? 0) - (b.at_s ?? 0))
}

/** Leave a note at a moment of the take (its own time), with the box when one is drawn. One undo step. */
export function useLeaveNote(parent: Gen | undefined, videoId: string) {
  const { doc: docStore } = useServices()
  const ui = useUi()
  return (shotId: string | undefined, atS: number, text: string, region: Region | null) => {
    const take = parent ? docStore.get().generations[parent.id] : undefined
    const shot = shotId ?? take?.shot_ids[0]
    if (!take || !shot || !text.trim()) return Promise.resolve()
    const seg = parent?.segments.find((x) => x.shotId === shot)
    const shotS = seg ? seg.outS - seg.inS : (take.duration_s ?? 0)
    const at = Math.round(Math.max(0, seg ? atS - seg.inS : atS) * 100) / 100
    return updateDoc(docStore, (d) => {
      addTakeNote(d, { takeId: take.id, shotId: shot, shotS, atS: at, text: clipText(text.trim(), 1000), region, by: `human:${personOf(ui.me).id}`, videoId })
    }, 'comment')
  }
}

/** What Remake as Final does with this draft: Runway makes a fresh Seedance 2.5 draft final itself within
 *  7 days; any other is made again at Final with its own words, pictures and length. */
export function finalHint(doc: ReturnType<typeof useDoc>, take: Generation): string {
  const job = take.job_id ? doc.jobs[take.job_id] : undefined
  const fresh = job?.created_at ? Date.now() - Date.parse(job.created_at) < 7 * 24 * 3600 * 1000 : false
  if (take.provider === 'runway' && SHEETS.runway?.models[genModel(take)]?.draftPromote && fresh) return 'Runway makes this draft at 1080p, without making it again'
  return `Makes it again at Final on ${modelLabel(take.provider, genModel(take))}: the same words, pictures and length`
}
