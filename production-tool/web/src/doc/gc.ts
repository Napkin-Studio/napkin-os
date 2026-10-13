// Clean up: pictures nothing uses any more leave the document and this browser.
//
// No counters are kept (they drift with undo, reloads and two tabs). What stays
// is worked out at the moment of the clean-up, from roots: every asset an
// entity of the document names (contract 3), and every image node still on the
// canvas:
//   - named references (refs: their picture, a typography ref's font file);
//   - frames, takes, ad renders, read documents, format sizes, a note's still,
//     exports;
//   - jobs' outputs (the record of what was made and paid for).
// Everything else (drawings re-exported since, pictures dropped and taken off
// the canvas, a job's inputs) goes. Jobs stay.

import type { ProductionDocument, Sha256 } from '../contracts/types'

export function roots(d: ProductionDocument, onCanvas: Iterable<Sha256>): Set<Sha256> {
  const keep = new Set<Sha256>(onCanvas)
  const add = (sha: Sha256 | undefined) => { if (sha) keep.add(sha) }
  for (const r of Object.values(d.refs)) {
    add(r.asset)
    add(r.font?.file)
  }
  for (const f of Object.values(d.frames)) add(f.asset)
  for (const t of Object.values(d.takes)) add(t.asset)
  for (const r of Object.values(d.renders)) add(r.asset)
  for (const x of Object.values(d.documents)) add(x.asset)
  for (const s of Object.values(d.sizes)) add(s.asset)
  for (const r of Object.values(d.reviews)) add(r.still)
  for (const e of Object.values(d.exports)) add(e.asset)
  for (const j of Object.values(d.jobs)) for (const o of j.outputs ?? []) add(o)
  return keep
}

/** The assets a clean-up would remove, given what is on the canvas now. */
export function unused(d: ProductionDocument, onCanvas: Iterable<Sha256>): Sha256[] {
  const keep = roots(d, onCanvas)
  return Object.keys(d.assets).filter((sha) => !keep.has(sha))
}

/** Take `gone` out of the document's assets (the caller deletes their bytes). */
export function sweep(d: ProductionDocument, gone: readonly Sha256[]) {
  for (const sha of gone) delete d.assets[sha]
}
