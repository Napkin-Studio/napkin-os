// Finals and rights (features/prod-assets-route.clan, owner 2026-11-19): what the Deck Maker reads as
// Production's finished work. A final names the exact picture by hash and what it is of (a frame version,
// a size, or a canvas picture with no versions yet), never a shot or a pick, so moving shots does not move
// it. A size or a picture keeps one final: marking another picture of it replaces the first. A final
// stands until unmarked. The bytes stay out of the document: the relay's GET /assets/{sha256} serves them.

import { newUlidId } from '../../../clan-store/src'
import type { AssetRights, DocAsset, Final, FormatChannel, PersonRef, ProductionDocument, Sha256, Size } from '../contracts/types'

export type FinalOf = Final['of']
type Extra = Pick<Final, 'version' | 'set_id' | 'format' | 'channel'>

const sameOf = (a: FinalOf, b: FinalOf) => a.kind === b.kind && a.id === b.id

/** The finals of one frame, size or picture. */
export function finalsOf(d: ProductionDocument, of: FinalOf): Final[] {
  return Object.values(d.finals ?? {}).filter((f) => sameOf(f.of, of))
}

/** Whether this picture of it is marked final. `also`: other names for the same picture (a canvas picture's node and
 *  its frames): a final under any of them counts. */
export function isFinal(d: ProductionDocument, of: FinalOf, asset: Sha256 | undefined, also: readonly FinalOf[] = []): boolean {
  return !!asset && [of, ...also].some((o) => finalsOf(d, o).some((f) => f.asset === asset))
}

/** Mark (on) or unmark (off) a picture final, in a draft (one undo step with updateDoc).
 *  A canvas picture is final under its node until it has versions, then under a frame: UAT 2026-11-22, a final marked
 *  on the picture stayed in the project after Final was switched off in the editor on the frame of the same picture,
 *  because the two were different names. `also` lists the other names (the node, the other frames): switching off
 *  removes the final of this asset under every one of them, and marking on retires the node's own earlier final. */
export function setFinal(d: ProductionDocument, of: FinalOf, asset: Sha256, on: boolean, by: PersonRef, extra: Extra = {}, at = new Date().toISOString(), also: readonly FinalOf[] = []) {
  const all = (d.finals ??= {})
  const mine = finalsOf(d, of)
  if (!on) {
    for (const o of [of, ...also]) for (const f of finalsOf(d, o)) if (f.asset === asset) delete all[f.id]
    return
  }
  if (mine.some((f) => f.asset === asset)) return
  if (of.kind !== 'frame') for (const f of mine) delete all[f.id] // a size or a picture keeps one
  // A frame's final replaces the picture's own: the picture is the first version, not a second final.
  if (of.kind === 'frame') for (const o of also) if (o.kind === 'picture') for (const f of finalsOf(d, o)) delete all[f.id]
  const id = newUlidId('final')
  const keep = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) as Extra
  all[id] = { id, v: 1, field_v: {}, of: { kind: of.kind, id: of.id }, asset, ...keep, at, by }
}

/** The picture a size's final names: its delivery-size file when one was made for its picture, else its picture. */
export function sizeFinalAsset(s: Size): Sha256 | undefined {
  return s.full?.asset && s.full.from === s.asset ? s.full.asset : s.asset
}

/** Mark or unmark a size final, copying its set, format and lane (campaign/make channelOfSize) for the Deck. */
export function setSizeFinal(d: ProductionDocument, sizeId: string, on: boolean, by: PersonRef, channel?: FormatChannel) {
  const s = d.sizes[sizeId]
  const asset = s && sizeFinalAsset(s)
  if (!s || !asset) return
  setFinal(d, { kind: 'size', id: s.id }, asset, on, by, { set_id: s.set_id, format: s.format, channel })
}

/** The rights a picture lands with: a provider made it for the agency, a person drew it, or it was uploaded
 *  and nobody has said yet. A mock and an edit say nothing (readers infer from origin). */
export function landingRights(origin: DocAsset['origin']): AssetRights | undefined {
  return origin === 'generated' ? 'generated' : origin === 'drawn' ? 'own' : origin === 'uploaded' ? 'unknown' : undefined
}

/** An upload still waiting for its rights: the canvas shows its small "Rights?" chip. */
export function asksRights(a: DocAsset | undefined): boolean {
  return a?.origin === 'uploaded' && a.rights === 'unknown'
}
