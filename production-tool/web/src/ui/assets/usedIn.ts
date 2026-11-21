// Where a character is used (UAT round 5, S3-5: "@leo · Used in · 0" while @leo_front was on all four frames, and
// "Show it on the canvas" was off with no reason). Pure reads, apart from the card.

import type { Id, KeyEntry, NamedRef, ProductionDocument, Shot } from '../../contracts/types'
import { namedCharacters } from '../../jobs/cast'
import { currentFrame, shotNumber, shotsOf } from '../../model/selectors'

type Doc = ProductionDocument

/** The shots a character is in, on every storyboard (not a video's own shot list): a shot that names it (its refs, an
 *  @mention, its name in the words, a speaker), or whose frame is one of its pictures or was drawn with one. */
export function usedIn(d: Doc, k: KeyEntry, refs: readonly NamedRef[]): { shot: Shot; n: number; storyboard: string }[] {
  const ids = new Set<Id>([k.id, ...refs.map((r) => r.id)])
  const shas = new Set(refs.map((r) => r.asset))
  const boards = Object.values(d.storyboards ?? {}).filter((b) => !b.implicit)
  const titled = boards.length > 1
  const out: { shot: Shot; n: number; storyboard: string }[] = []
  for (const b of boards) {
    for (const s of shotsOf(d, b.id)) {
      const frame = currentFrame(d, s.id)
      const drawnWith = frame?.job_id ? (d.jobs[frame.job_id]?.inputs ?? []).some((row) => row.kind === 'ref' && !!row.ref && ids.has(row.ref)) : false
      const isIt = (s.refs ?? []).some((r) => ids.has(r)) || namedCharacters(d, s).has(k.key.toLowerCase())
        || (!!frame && shas.has(frame.asset)) || drawnWith
      if (isIt) out.push({ shot: s, n: shotNumber(d, s.id), storyboard: titled ? (b.title?.trim() || 'Storyboard') : '' })
    }
  }
  return out
}

/** Where "Show it on the canvas" goes: the picture's own node; else, for a picture that is a storyboard frame (Keep a
 *  person names frame 1), that storyboard's node; else nothing, with the reason in words. */
export function showTarget(d: Doc, front: NamedRef | undefined): { node: string } | { storyboard: Id } | { why: string } {
  if (!front) return { why: 'No view is named yet.' }
  if (front.node) return { node: front.node }
  const frame = Object.values(d.frames ?? {}).find((f) => f.asset === front.asset)
  const sb = frame?.shot_id ? d.shots[frame.shot_id]?.storyboard_id : undefined
  if (sb && d.storyboards[sb] && !d.storyboards[sb].implicit) return { storyboard: sb }
  return { why: 'Its pictures are not on the canvas: they were named from a frame or a take.' }
}
