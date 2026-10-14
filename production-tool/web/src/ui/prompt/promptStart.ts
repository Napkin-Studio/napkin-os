// What an empty node offers to start from (features/prompt-start.clan; ui-behaviour 3.5, 3.10,
// 3.17; plan decision 1), apart from the component so it can be tested: when each kind is empty,
// which start it shows, the words, and the two asks (the Video's hard block, the Storyboard's nudge).
// The asks are derived from the node's state, never stored: a link or a plan settles them.

import type { Id, ProductionDocument, Question } from '../../contracts/types'
import { pictureJob, scriptHasWords, storyboardOfVideo, type PromptKind } from '../../jobs/prompt'
import { isActive } from '../../jobs/runner'
import { scopeOf } from '../../model/scope'
import { currentFrame, framesOf, scenesOf, shotsOf } from '../../model/selectors'

type Doc = ProductionDocument

export type { PromptKind } from '../../jobs/prompt'

/** The words each start shows (the spec's, where it has them). One copy for the card and the editors. */
export const PROMPT_COPY = {
  script: { placeholder: 'Paste a script, or write the idea in a line.', hint: 'Enter: Skye drafts it here · Shift+Enter: new line', busy: 'Skye is drafting from your line' },
  storyboard: { placeholder: 'Describe the ad in a line', hint: 'Dex plans the shots from it', fromScript: 'Dex plans the shots from the script.', busy: 'Dex is planning the shots' },
  video: { placeholder: 'Describe it in a line or two. Type @ to pull in a character, place or product.', busy: 'Dex is planning the shots' },
  image: { placeholder: 'Describe the picture', hint: 'Wren makes it, then you say what it is', busy: 'Wren is making the picture' },
  later: 'You can always switch later.',
} as const

/** The kinds a start is for, by the entity the node id names. */
export function promptKindOf(d: Doc, nodeId: Id): PromptKind | null {
  if (d.scripts[nodeId]) return 'script'
  if (d.storyboards[nodeId]) return 'storyboard'
  if (d.videos[nodeId]) return 'video'
  return d.shots[nodeId] ? 'image' : null
}

/** A script with no shots and no words in any scene (the Script editor's rule). */
export function scriptEmpty(d: Doc, scriptId: Id): boolean {
  if (!d.scripts[scriptId]) return false
  const scenes = scenesOf(d, scriptId)
  const shots = Object.values(d.shots).some((s) => s.scene_id && scenes.some((sc) => sc.id === s.scene_id))
  return !shots && scenes.every((s) => !s.heading.trim() && !s.text?.trim())
}

/** A job of this op running on this node now. */
function running(d: Doc, op: string, node: { kind: string; id: Id }): boolean {
  return Object.values(d.jobs).some((j) => j.op === op && j.node?.kind === node.kind && j.node.id === node.id && isActive(j.state))
}

/** Nothing upstream is linked into the video: no script drives it, no storyboard renders it. */
export function videoBlocked(d: Doc, videoId: Id): boolean {
  if (!d.videos[videoId]) return false
  return !scopeOf(d, videoId).some((it) => it.via === 'link' && (it.kind === 'script' || it.kind === 'storyboard'))
}

/** Which start a node shows now, or null when it has something already (or is busy making it). */
export type PromptState =
  | { show: 'script' }
  | { show: 'storyboard'; fromScript: boolean }
  | { show: 'video-block' }
  | { show: 'video-plan'; storyboardId: Id }
  | { show: 'image-frame' }
  | { show: 'image-picture' }
  | null

export function promptState(d: Doc, kind: PromptKind, nodeId: Id): PromptState {
  switch (kind) {
    case 'script':
      return scriptEmpty(d, nodeId) && !running(d, 'write', { kind: 'script', id: nodeId }) ? { show: 'script' } : null
    case 'storyboard': {
      if (!d.storyboards[nodeId] || shotsOf(d, nodeId).length || running(d, 'shot_list', { kind: 'storyboard', id: nodeId })) return null
      return { show: 'storyboard', fromScript: scriptHasWords(d, nodeId) }
    }
    case 'video': {
      if (!d.videos[nodeId]) return null
      if (videoBlocked(d, nodeId)) return { show: 'video-block' }
      const sb = storyboardOfVideo(d, nodeId)
      if (!sb || shotsOf(d, sb.id).length || running(d, 'shot_list', { kind: 'storyboard', id: sb.id })) return null
      return { show: 'video-plan', storyboardId: sb.id }
    }
    case 'image': {
      const shot = d.shots[nodeId]
      if (shot) return !framesOf(d, shot.id).length && !currentFrame(d, shot) && !running(d, 'frame', { kind: 'shot', id: shot.id }) ? { show: 'image-frame' } : null
      // A picture node: shown until its picture is named (the role picker is part of the start).
      const job = pictureJob(d, nodeId)
      const named = job?.outputs?.[0] && Object.values(d.refs).some((r) => r.asset === job.outputs![0])
      return named ? null : { show: 'image-picture' }
    }
  }
}

/** Option ids of the Video's hard block and the Storyboard's nudge. */
export const DESCRIBE = 'describe'
export const LINK_SCRIPT = 'link_script'
export const LINK_STORYBOARD = 'link_storyboard'
export const SCRIPT_FIRST = 'script_first'
export const PLAN_NOW = 'plan_now'

/**
 * Dex's hard block on a Video with nothing linked or described (3.5, 3.17): no option is
 * recommended, the text box is the Describe it option, and nothing runs until one is done.
 */
export function videoBlock(videoId: Id): Question {
  return {
    id: `q_video_${videoId}`,
    kind: 'block',
    text: 'What should this video be?',
    why: 'Nothing is linked to it yet, so I have nothing to direct from.',
    options: [
      { id: DESCRIBE, label: 'Describe it', value: { route: DESCRIBE } },
      { id: LINK_SCRIPT, label: 'Link a script', value: { route: LINK_SCRIPT } },
      { id: LINK_STORYBOARD, label: 'Link a storyboard', value: { route: LINK_STORYBOARD } },
    ],
    allow_text: true,
  }
}

/** Dex's nudge before planning a storyboard from a line (decision 1): the script first is recommended; the plan goes ahead too. */
export function storyboardNudge(storyboardId: Id): Question {
  return {
    id: `q_storyboard_${storyboardId}`,
    kind: 'nudge',
    text: 'Write a script first?',
    why: 'Shots come out better from a script you have checked.',
    options: [
      { id: SCRIPT_FIRST, label: 'Write the script first', detail: 'Skye drafts it from your line; you keep what you like', value: { route: SCRIPT_FIRST } },
      { id: PLAN_NOW, label: 'Plan shots from the line', detail: 'Dex plans the shots straight from it', value: { route: PLAN_NOW } },
    ],
    allow_text: false,
    recommended_option_id: SCRIPT_FIRST,
  }
}

/** The primary of the Video's block: "15 s · Make it". */
export const makeItLabel = (seconds: number) => `${seconds} s · Make it`

/** The @word being typed at the caret, if any: what the mention list filters by. */
export function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  const m = /(^|[\s(])@([a-z0-9_-]*)$/.exec(text.slice(0, caret))
  return m ? { from: caret - m[2].length - 1, query: m[2] } : null
}

/** The text with the @word at `from` replaced by the name, and the caret after it. */
export function insertMention(text: string, from: number, caret: number, name: string): { text: string; caret: number } {
  const before = `${text.slice(0, from)}@${name} `
  return { text: before + text.slice(caret).replace(/^\s+/, ''), caret: before.length }
}
