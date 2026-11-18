// The Start card on an empty canvas (features/production-new-ui.clan; mock production-new-ui-v2 "canvas-empty"):
// there is no New film screen. The card asks what the film should be (a brief to start from, a line or a
// pasted script, the length and the shape), and "Write the script" lays the film out on the canvas:
// the Script (with the Brief node linked into it when there is one), the Storyboard it drives, at the
// chosen shape and length. The words then go to the Script agent (stages/FilmStart.tsx), as a node's own
// start does.

import type { Id, Ratio } from '../contracts/types'
import { cardOf, createNode, linkInput, type NodeEnv } from '../canvas/nodes/nodes'
import { updateDoc } from '../doc/store'
import { mainStoryboard, storyboardOfScript, videoOfStoryboard } from '../model/selectors'
import { setScriptTarget } from '../script/length'
import type { BriefSource } from '../brief/os'
import { startFromBriefId } from '../brief/start'
import { scriptToWrite } from './startCard'

/** The card's lengths and shapes (mock: 6, 10, 15, 30 s; 16:9, 9:16, 1:1, 4:5). */
export const START_LENGTHS = [6, 10, 15, 30] as const
export const START_SHAPES: readonly Ratio[] = ['16:9', '9:16', '1:1', '4:5']

export interface FilmStart {
  seconds: number
  ratio: Ratio
  /** Start from this Brief Maker brief: linked (frozen here) or spun off (a new film from it, linked back). */
  brief?: { documentId: string; how: 'link' | 'spinoff' }
}

export interface StartedFilm { scriptId: Id; storyboardId?: Id; briefId?: Id }

/**
 * Lay the film out: the Script (from the brief when one is picked), the Storyboard it drives (made and
 * linked when the project has none), then the length on the chain and the shape on the storyboard and its
 * video, in one undo step. `env` is our own engine's (Excalidraw cannot make nodes; null there).
 */
export async function startFilm(env: NodeEnv | null, src: BriefSource, o: FilmStart): Promise<StartedFilm> {
  if (!env) throw new Error('This canvas cannot lay out a film yet. Open it on the new canvas.')
  let scriptId: Id | undefined
  let briefId: Id | undefined
  if (o.brief) {
    const r = await startFromBriefId(env, src, o.brief.documentId, o.brief.how)
    scriptId = r.scriptId
    briefId = r.briefId
  } else {
    scriptId = await scriptToWrite(env.doc.get(), env)
  }
  if (!scriptId) throw new Error('The script could not be made.')
  let sb = storyboardOfScript(env.doc.get(), scriptId) ?? mainStoryboard(env.doc.get())
  if (!sb) {
    const scriptEl = env.canvas.elements().find((e) => cardOf(e)?.id === scriptId)
    const at = scriptEl ? { x: scriptEl.x + scriptEl.width + 120 + 360, y: scriptEl.y + 100 } : undefined
    const el = await createNode(env, 'storyboard', at)
    const id = cardOf(el)?.id
    if (id) await linkInput(env.doc, env.doc.get(), { kind: 'script', id: scriptId }, { kind: 'storyboard', id })
    sb = id ? env.doc.get().storyboards[id] : undefined
  }
  const sbId = sb?.id
  const sid = scriptId
  await updateDoc(env.doc, (d) => {
    setScriptTarget(d, sid, sbId, o.seconds)
    if (sbId && d.storyboards[sbId]) {
      d.storyboards[sbId].ratio = o.ratio
      const v = videoOfStoryboard(d, sbId)
      if (v) d.videos[v.id].ratio = o.ratio
    }
  }, `start the film: ${o.seconds} s, ${o.ratio}`)
  return { scriptId, ...(sbId ? { storyboardId: sbId } : {}), ...(briefId ? { briefId } : {}) }
}
