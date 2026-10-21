// Where a shot's clip starts: its picked storyboard frame, else a Bin picture linked into the shot as its
// frame (a ref→shot `frame` link, ui-behaviour 3.4; the Make room's start-frame well, rooms/newBox.ts).

import type { Id, ProductionDocument } from '../contracts/types'
import { currentFrame } from '../model/selectors'

/** The picture a shot starts on: its picked frame, else a Bin picture linked in as its frame (3.4 frame link). */
export function startPicture(d: ProductionDocument, shotId: Id): { sha: string; refId?: Id; frameId?: Id } | undefined {
  const f = currentFrame(d, shotId)
  if (f) return { sha: f.asset, frameId: f.id }
  const l = Object.values(d.links ?? {}).find((x) => x.to.kind === 'shot' && x.to.id === shotId && x.role === 'frame' && x.from.kind === 'ref')
  const r = l ? d.refs?.[l.from.id] : undefined
  return r?.asset ? { sha: r.asset, refId: r.id } : undefined
}

