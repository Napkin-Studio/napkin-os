// What the Sound view can say today about the film's sound (UAT 2026-11-21, F8: it read "No shot sound yet" and "No
// lines voiced yet" while three clips in the cut carried sound, and the NARRATOR's voice-over on the end card was
// never voiced with nothing said). It reads the cut: each shot's clip, the model it was made on, and whether that
// model made sound for it (relay/sound.py: a line, a VO or a sound beat on a model with a sound switch; a model
// without a switch that makes its own background sound always does). Pure.

import type { Id, ProductionDocument } from '../contracts/types'
import { modelEntry } from '../jobs/runs'
import { beatsOf, shotNumber } from '../model/selectors'
import { readCut } from '../rooms/timeline'
import { isSilence } from '../rooms/boxModel'

export type ShotSound = 'made' | 'background' | 'silent' | 'none'
export interface ShotSoundFact { shotId: Id; n: number; sound: ShotSound; words: string }
export interface LineFact { shotId: Id; n: number; who?: string; text: string; voiced: boolean; why: string }

const wants = (d: ProductionDocument, shotIds: Id[]) =>
  shotIds.some((id) => beatsOf(d, id).some((b) => (b.kind === 'line' || b.kind === 'vo' || b.kind === 'sound') && !!b.text?.trim() && !isSilence(b)))

/** Each shot's sound as its clip in the cut has it. */
export function shotSounds(d: ProductionDocument, videoId: Id | undefined, shotIds: Id[]): ShotSoundFact[] {
  const cut = readCut(d, videoId)
  return shotIds.map((shotId) => {
    const n = shotNumber(d, shotId)
    const clip = cut.v1.find((c) => c.follows?.shotId === shotId)
    const g = clip ? d.generations[clip.genId] : undefined
    if (d.shots[shotId]?.kind === 'end_card') return { shotId, n, sound: 'silent' as const, words: 'End card: silent' }
    if (!g) return { shotId, n, sound: 'none' as const, words: 'No clip in the cut' }
    const e = g.provider && g.inputs?.model ? modelEntry(g.provider as never, g.inputs.model) : null
    const label = e?.label ?? g.inputs?.model ?? 'the mock'
    if (e?.video.audioControl && wants(d, g.shot_ids)) return { shotId, n, sound: 'made' as const, words: `Clip sound · ${label}` }
    if (e && !e.video.audioControl && e.video.audioDefault) return { shotId, n, sound: 'background' as const, words: `Background sound · ${label}` }
    return { shotId, n, sound: 'silent' as const, words: `Silent clip · ${label}` }
  })
}

/** Every spoken line and voice-over of the shots: voiced in its clip, or not, and why. */
export function lineFacts(d: ProductionDocument, videoId: Id | undefined, shotIds: Id[]): LineFact[] {
  const sounds = new Map(shotSounds(d, videoId, shotIds).map((s) => [s.shotId, s]))
  const out: LineFact[] = []
  for (const shotId of shotIds) {
    const n = shotNumber(d, shotId)
    for (const b of beatsOf(d, shotId)) {
      if ((b.kind !== 'line' && b.kind !== 'vo') || !b.text?.trim()) continue
      const s = sounds.get(shotId)
      const who = b.speaker?.trim() || undefined
      if (d.shots[shotId]?.kind === 'end_card') {
        out.push({ shotId, n, who, text: b.text.trim(), voiced: false, why: `The end card has no clip, so its ${b.kind === 'vo' ? 'voice-over' : 'line'} is not voiced in this version: it is heard nowhere. Its words show on the card.` })
      } else if (s?.sound === 'made') {
        out.push({ shotId, n, who, text: b.text.trim(), voiced: true, why: 'Spoken in the clip.' })
      } else {
        out.push({ shotId, n, who, text: b.text.trim(), voiced: false, why: s?.sound === 'none' ? 'Not voiced yet: the shot has no clip in the cut.' : `Not voiced: ${s?.words.split(' · ')[1] ?? 'its model'} made no speech for it. Make the shot on Veo 3.1, Kling or WAN 3 to hear it.` })
      }
    }
  }
  return out
}
