// The free page (features/script-freeform.clan): one stored text, read two ways. A scene with no heading
// whose blocks are all action is free text, shown as written in Geist; a scene with a heading, or with
// screenplay elements (character, dialogue, …), keeps the screenplay layout in Geist Mono. Nothing is
// stored to say which: it is read from the scene. Pure.

import { flatText, type PMNode } from '../../../clan-store/src'
import type { Id, ProductionDocument, Scene } from '../contracts/types'
import { scenesOf, shotsOf } from '../model/selectors'
import { composeScript } from './compose'
import { bulletMarker, refNames } from './extensions'

type Doc = ProductionDocument

const blocksOf = (scene: Scene): PMNode[] => ((scene.prose as { content?: PMNode[] } | undefined)?.content ?? [])

/** Free text: no heading, and nothing but plain lines (action blocks). */
export function sceneIsFree(scene: Scene): boolean {
  return !scene.heading.trim() && blocksOf(scene).every((b) => b.type === 'action')
}

/** A whole script of free text: every scene free, and no shots planned yet. */
export function scriptIsFree(d: Doc, scriptId: Id): boolean {
  const c = composeScript(d, scriptId)
  if (!c) return true
  return !c.shots.length && scenesOf(d, scriptId).every(sceneIsFree)
}

/** A scene's lines with words, as the outline lists them: the block's index and its words. */
export function sceneLines(d: Doc, scene: Scene, types: string[] = ['action']): { index: number; text: string }[] {
  const refs = refNames(d)
  const out: { index: number; text: string }[] = []
  blocksOf(scene).forEach((b, index) => {
    if (!types.includes(b.type)) return
    // A bullet's marker is how it was typed; the outline lists its words.
    const words = flatText(b.content, refs)
    const text = words.slice(bulletMarker(words)).trim()
    if (text) out.push({ index, text })
  })
  return out
}

/** The paragraphs of a free script, in order (¶1, ¶2, …): each scene's lines with words. */
export function paragraphs(d: Doc, scriptId: Id): { sceneId: Id; index: number; text: string }[] {
  return scenesOf(d, scriptId).flatMap((sc) => sceneLines(d, sc).map((l) => ({ sceneId: sc.id, ...l })))
}

/** Whether a script has any words yet (its scenes' headings or text, or a planned shot). */
export function hasWords(d: Doc, scriptId: Id): boolean {
  const c = composeScript(d, scriptId)
  if (!c) return false
  if (c.storyboard && shotsOf(d, c.storyboard.id).length) return true
  return scenesOf(d, scriptId).some((s) => !!s.heading.trim() || !!s.text?.trim() || blocksOf(s).some((b) => (b.content ?? []).length > 0))
}
