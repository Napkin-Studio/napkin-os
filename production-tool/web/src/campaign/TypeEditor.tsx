// Edit type on a tile (features/campaign-formats.clan, phase 3): the words every size lays out (the
// brand line, legal) and this size's own changes (its own words, hide a layer, bigger or smaller).
// Saving is one undo step; the sizes it changes are made again on the relay (free). The overlay shows
// the layout on the tile while it is being edited or before the relay's picture lands.

import { useState } from 'react'
import { useDoc } from '../app/context'
import type { FormatSet, PersonRef, Size, TypeLayerKind, TypeLayerOverride } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { useBlobUrl } from '../ui/hooks'
import type { TileBox } from './board'
import { checksFor } from './checks'
import { layoutInput, layoutType, OOH_WORDS } from './layout'
import { sendSize, sizesOf, type CampaignDeps } from './make'

/** The layout drawn over a tile in HTML: what the relay will draw. */
export function TypeOverlay({ size, set, box }: { size: Size; set: FormatSet; box: TileBox }) {
  const doc = useDoc()
  const laid = layoutType(layoutInput(doc, set, size))
  const brand = laid.find((l) => l.kind === 'logo')
  const logoUrl = useBlobUrl(brand?.logo)
  return (
    <div className="cb-type" aria-hidden="true">
      {laid.map((l, i) => {
        const style: React.CSSProperties = { left: l.box.x * box.w, top: l.box.y * box.h, width: l.box.w * box.w, height: l.box.h * box.h }
        if (l.kind === 'logo') return <span key={i} className="cb-tl logo" style={style}>{logoUrl && <img src={logoUrl} alt="" />}</span>
        const px = ((l.sizeFrac ?? 0.04) * box.h) / 0.72
        return (
          <span key={i} className={`cb-tl ${l.kind}`} style={{ ...style, fontSize: px, color: l.colour, textAlign: l.align === 'centre' ? 'center' : l.align, fontWeight: l.weight === 'bold' ? 700 : 400 }}>
            {l.text}
          </span>
        )
      })}
    </div>
  )
}

const KINDS: { kind: TypeLayerKind; label: string }[] = [{ kind: 'line', label: 'Line' }, { kind: 'logo', label: 'Logo' }, { kind: 'legal', label: 'Legal' }]

export function TypeEditor({ size, set, deps, by, zoom, onClose }: { size: Size; set: FormatSet; deps: CampaignDeps; by: PersonRef; zoom: number; onClose(): void }) {
  const [line, setLine] = useState(set.copy?.line ?? '')
  const [legal, setLegal] = useState(set.copy?.legal ?? '')
  const [own, setOwn] = useState(size.layers?.line?.text ?? '')
  const [layers, setLayers] = useState<Partial<Record<TypeLayerKind, TypeLayerOverride>>>(size.layers ?? {})
  const [busy, setBusy] = useState(false)
  const ooh = (own || line).trim().split(/\s+/).filter(Boolean).length
  const isOoh = layoutInput(deps.doc.get(), set, size).channel === 'ooh'

  const save = async () => {
    setBusy(true)
    const everyChanged = line.trim() !== (set.copy?.line ?? '') || legal.trim() !== (set.copy?.legal ?? '')
    const next = JSON.parse(JSON.stringify(layers)) as Partial<Record<TypeLayerKind, TypeLayerOverride>>
    if (own.trim() && own.trim() !== line.trim()) next.line = { ...next.line, text: own.trim() }
    else if (next.line) { const { text: _t, ...rest } = next.line; void _t; next.line = rest }
    for (const k of Object.keys(next) as TypeLayerKind[]) if (!Object.keys(next[k] ?? {}).length) delete next[k]
    await updateDoc(deps.doc, (x) => {
      const s0 = x.format_sets[set.id]
      const sz = x.sizes[size.id]
      if (!s0 || !sz) return
      const copy = { ...s0.copy }
      if (line.trim()) copy.line = line.trim()
      else delete copy.line
      if (legal.trim()) copy.legal = legal.trim()
      else delete copy.legal
      s0.copy = copy
      if (Object.keys(next).length) sz.layers = next
      else delete sz.layers
      for (const s of Object.values(x.sizes)) {
        if (s.set_id !== set.id || (s.id !== size.id && (!everyChanged || s.locked))) continue
        s.checks = checksFor(s, s0, x)
      }
    }, `edit the type of ${everyChanged ? `every size of format_sets[${set.id}]` : `sizes[${size.id}]`}`)
    const d = deps.doc.get()
    const again = sizesOf(d, set.id).filter((s) => s.media === 'image' && s.method === 'crop' && (s.id === size.id || (everyChanged && !s.locked)))
    for (const s of again) void sendSize(deps, set.id, s.id, by).catch((e) => console.warn('the size was not sent', e))
    setBusy(false)
    onClose()
  }

  return (
    <div className="cb-pop cb-typeedit pt-panel" style={{ transform: `scale(${1 / zoom})` }} role="dialog" aria-label="Edit type" onPointerDown={(e) => e.stopPropagation()}>
      <label className="cb-field">Line · every size
        <input value={line} maxLength={200} onChange={(e) => setLine(e.target.value)} placeholder="The brand line" />
      </label>
      <label className="cb-field">This size's line
        <input value={own} maxLength={200} onChange={(e) => setOwn(e.target.value)} placeholder={line || 'Same as every size'} />
      </label>
      {isOoh && ooh > OOH_WORDS && <p className="cb-warn">{ooh} words: a poster is read in 3 to 5 seconds. Jude suggests 7 or fewer here.</p>}
      <label className="cb-field">Legal · every size
        <input value={legal} maxLength={600} onChange={(e) => setLegal(e.target.value)} placeholder="Small print" />
      </label>
      <div className="cb-field">On this size
        <div className="cb-row">
          {KINDS.map(({ kind, label }) => (
            <label key={kind} className="cb-tick">
              <input type="checkbox" checked={!layers[kind]?.hidden} onChange={(e) => setLayers({ ...layers, [kind]: { ...layers[kind], hidden: !e.target.checked || undefined } })} /> {label}
            </label>
          ))}
        </div>
        <label className="cb-row">Line size
          <input type="range" min={0.5} max={2} step={0.1} value={layers.line?.scale ?? 1} aria-label="Line size on this size"
            onChange={(e) => setLayers({ ...layers, line: { ...layers.line, scale: Number(e.target.value) === 1 ? undefined : Number(e.target.value) } })} />
        </label>
      </div>
      <p className="cb-hint">The logo and the words are drawn on our server, never by a model. The logo comes from the Brand board.</p>
      <div className="cb-row">
        <span className="pt-grow" />
        <button type="button" className="btn xs ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn xs primary" disabled={busy} onClick={() => void save()}>Save</button>
      </div>
    </div>
  )
}
