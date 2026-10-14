// The selection bar's contents (features/canvas-edit-tools.clan; ui-behaviour 3.9),
// pure: what is selected in, the bar's actions out, in the table's order, most
// likely first. Actions that are not built yet are kept in their place, greyed,
// with the reason; More always holds Copy link to this, Duplicate, Lock and Delete.
// And the in-page question before deleting a node something is still being made on
// (3.3 Delete): "Wren is still making clip 4. Stop it and delete?".

import type { DocJob, ProductionDocument } from '../../contracts/types'
import { CAST, castOf, MAKER_OF } from '../../ui/agents/cast'
import { shotNumber } from '../../model/selectors'

export type CardKind = 'script' | 'storyboard' | 'video'

/** What is selected, as the bar reads it. */
export interface SelInfo {
  /** The document's nodes among it. */
  cards: CardKind[]
  /** Links among it. */
  links: number
  /** One whole group (ink when every member is a pen stroke), or null. */
  group: { ink: boolean } | null
  /** How many things: groups count once. */
  units: number
  /** Every selected thing is locked. */
  locked: boolean
}

export type ActionId =
  | 'open' | 'make-video' | 'plan-shots' | 'make-clips' | 'render-ad' | 'make-sizes'
  | 'convert' | 'group' | 'ungroup' | 'move-to-board' | 'delete'

export interface BarAction {
  id: ActionId
  label: string
  /** The one primary (#D63B1F) action, only when it makes something. */
  primary?: boolean
  /** An icon button (Delete). */
  icon?: boolean
  /** Not built yet: shown greyed, with why. */
  off?: string
}

export interface MoreAction {
  id: 'copy-link' | 'duplicate' | 'lock' | 'unlock' | 'delete'
  label: string
  off?: string
}

const LATER = 'Not built yet.'
const OFF: Partial<Record<ActionId, string>> = {
  'make-video': 'Make video comes with starting from a prompt. Open the Video for now.',
  'plan-shots': 'Plan shots from the Storyboard for now (Open).',
  'make-clips': 'Make clips from the Storyboard for now (Open).',
  'render-ad': 'Render the ad from the Video for now (Open).',
  'make-sizes': 'Make all sizes comes with format sheets.',
  convert: 'Ellis reading your ink comes in a later build.',
  'move-to-board': 'Drag it onto a board for now.',
}

const act = (id: ActionId, label: string, extra: Partial<BarAction> = {}): BarAction => ({ id, label, ...(OFF[id] ? { off: OFF[id] } : {}), ...extra })
const DELETE = act('delete', 'Delete', { icon: true })

/** The bar for a selection (the 3.9 table), or [] when the canvas's picture bar has it instead. */
export function barFor(s: SelInfo): BarAction[] {
  if (!s.units) return []
  if (s.group && s.units === 1) {
    return s.group.ink
      ? [act('convert', 'Convert to text'), act('ungroup', 'Ungroup'), act('move-to-board', 'Move to board'), DELETE]
      : [act('ungroup', 'Ungroup'), act('move-to-board', 'Move to board'), DELETE]
  }
  const only = s.cards.length === s.units && !s.links
  if (only && s.units === 2 && s.cards.includes('script') && s.cards.includes('storyboard')) {
    return [act('make-video', 'Make video', { primary: true }), act('plan-shots', 'Plan shots'), act('group', 'Group')]
  }
  if (only && s.units === 1) {
    switch (s.cards[0]) {
      case 'script': return [act('open', 'Open'), act('plan-shots', 'Plan shots')]
      case 'storyboard': return [act('open', 'Open'), act('make-clips', 'Make clips…')]
      case 'video': return [act('open', 'Open'), act('render-ad', 'Render ad…'), act('make-sizes', 'Make all sizes…')]
    }
  }
  if (s.links === s.units) return [DELETE]
  return [act('group', 'Group'), act('move-to-board', 'Move to board'), DELETE]
}

/** More (⋯): on every bar with nodes or a single link, as 3.9 says. */
export function moreFor(s: SelInfo): MoreAction[] {
  return [
    { id: 'copy-link', label: 'Copy link to this', off: LATER },
    { id: 'duplicate', label: 'Duplicate', off: LATER },
    s.locked ? { id: 'unlock', label: 'Unlock' } : { id: 'lock', label: 'Lock' },
    { id: 'delete', label: 'Delete' },
  ]
}

/** Does the bar end in More? (Rows with Delete as their last action end there instead.) */
export function hasMore(bar: readonly BarAction[]): boolean {
  return bar.length > 0 && bar.at(-1)!.id !== 'delete'
}

const VERB: Partial<Record<DocJob['op'], string>> = { write: 'writing', shot_list: 'planning', generate: 'drawing', view: 'drawing', frame: 'drawing', stitch: 'putting together', clip: 'making', clip_edit: 'changing' }

/** What a running job is making, in words: 'clip 4', 'frame 2', 'the shots', 'the ad'. */
function making(d: ProductionDocument, j: DocJob): string {
  const n = j.node.kind === 'shot' ? shotNumber(d, j.node.id) : 0
  switch (j.op) {
    case 'clip': case 'clip_edit': case 'clip_patch': return n ? `clip ${n}` : 'a clip'
    case 'frame': case 'frame_edit': return n ? `frame ${n}` : 'a frame'
    case 'shot_list': return 'the shots'
    case 'write': return 'a draft'
    case 'stitch': return 'the ad'
    default: return 'a picture'
  }
}

/** The question before deleting a node with a job still running on it (3.3 Delete). */
export function busyQuestion(d: ProductionDocument, j: DocJob): string {
  const who = CAST[j.op === 'shot_list' ? 'dex' : j.crew ? castOf(j.crew) : MAKER_OF[j.op] ?? 'dex'].given
  return `${who} is still ${VERB[j.op] ?? 'making'} ${making(d, j)}. Stop it and delete?`
}
