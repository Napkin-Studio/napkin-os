// Clean up: pictures nothing uses any more leave the document and this browser.
//
// No counters are kept (they drift with undo, reloads and two tabs). What stays
// is worked out at the moment of the clean-up, from roots:
//   - solid references: every named image (refs[]), which also covers keys
//     imported from the library;
//   - the canvas: every image node still on it;
//   - the storyboard and the ad: frames, clips, shots' frames and exports.
// Everything else (unnamed images deleted from the canvas, drawings re-exported
// since, outputs of jobs whose node is gone) is weak and goes. Jobs stay: they
// are the record of what was made and paid for, and their hashes are history.

import type { ProductionDocument, Sha256 } from '../contracts/types'

export function roots(d: ProductionDocument, onCanvas: Iterable<Sha256>): Set<Sha256> {
  const keep = new Set<Sha256>(onCanvas)
  for (const r of d.refs) keep.add(r.asset)
  for (const f of d.frames ?? []) keep.add(f.asset)
  for (const t of d.takes ?? []) keep.add(t.asset)
  for (const s of d.shots ?? []) if (s.storyboard_frame) keep.add(s.storyboard_frame)
  for (const e of d.exports ?? []) keep.add(e.asset)
  return keep
}

/** The assets a clean-up would remove, given what is on the canvas now. */
export function unused(d: ProductionDocument, onCanvas: Iterable<Sha256>): Sha256[] {
  const keep = roots(d, onCanvas)
  return d.assets.filter((a) => !keep.has(a.sha256)).map((a) => a.sha256)
}

/** Take `gone` out of the document's assets (the caller deletes their bytes). */
export function sweep(d: ProductionDocument, gone: readonly Sha256[]) {
  const out = new Set(gone)
  d.assets = d.assets.filter((a) => !out.has(a.sha256))
}
