// The Bin (features/make-and-edit.clan; boards Make room and Edit room, left column): every take, render and
// picture of the film exists here once, and the timeline's clips point at it. Newest first, each take with
// its one-line change label. Hover scrubs, a click picks, a double click plays it, and a take can be dragged
// onto the timeline. "Show lineage" lists parent → this take → its children. The canvas's Assets drawer
// shows the same tiles as its Footage tab (ui/assets/AssetsDrawer.tsx).

import { useCallback, useMemo, useRef, useState } from 'react'
import { useDoc } from '../app/context'
import { refsList, rendersOf } from '../model/selectors'
import { Float, MenuItem } from '../ui/Float'
import type { RoomData, RoomName, Selection } from './Rooms'
import { boxName, genTitle, type Gen } from './model'
import { Poster } from './Poster'
import { readCut, readyTakes } from './timeline'

type Filter = 'film' | 'takes' | 'renders' | 'images' | 'unused' | 'uploads'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'film', label: 'In this film' }, { id: 'takes', label: 'Takes' }, { id: 'renders', label: 'Renders' },
  { id: 'images', label: 'Images' }, { id: 'unused', label: 'Unused' }, { id: 'uploads', label: 'Uploads' },
]

/** The drag type a take carries onto the timeline. */
export const GEN_DRAG = 'application/x-napkin-take'

export function Bin({ data, sel, room, onPick }: { data: RoomData; sel: Selection; room: RoomName; onPick: (g: Gen) => void }) {
  const doc = useDoc()
  const [filter, setFilter] = useState<Filter>('film')
  const [q, setQ] = useState('')
  const cut = useMemo(() => readCut(doc, data.videoId), [doc, data.videoId])
  const inCut = useMemo(() => new Set([...cut.v1, ...cut.v2].map((c) => c.genId)), [cut])
  const ready = useMemo(() => readyTakes(cut, data.gens), [cut, data.gens])
  const renders = rendersOf(doc, data.videoId).slice().reverse()
  const images = refsList(doc).filter((r) => r.asset)
  const query = q.trim().toLowerCase()
  const takes = data.gens.filter((g) => !query || `${genTitle(g, data.boxes)} ${g.label}`.toLowerCase().includes(query))
  const showTakes = filter === 'film' || filter === 'takes' || filter === 'unused'
  const shownTakes = filter === 'unused' ? takes.filter((g) => !inCut.has(g.id)) : takes
  const shownImages = (filter === 'film' || filter === 'images') ? images.filter((r) => !query || `${r.key} ${r.variant}`.toLowerCase().includes(query)) : []
  const shownRenders = (filter === 'film' || filter === 'renders') ? renders : []
  const empty = !(showTakes && shownTakes.length) && !shownImages.length && !shownRenders.length
  return (
    <aside className="rm-bin" aria-label="Bin">
      <div className="rm-binhead"><b>Bin</b><span className="rm-faint">{data.gens.filter((g) => g.state !== 'making').length} takes</span></div>
      <label className="rm-search">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M9.3 9.3 L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        <input aria-label="Search the Bin" placeholder="Search the Bin" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="rm-chips" role="radiogroup" aria-label="Show">
        {FILTERS.map((f) => <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} className={`rm-chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
      <div className="rm-bingrid" role="list">
        {showTakes && shownTakes.map((g) => (
          <TakeTile key={g.id} g={g} data={data} picked={sel.genId === g.id} inCut={inCut.has(g.id)} ready={ready.has(g.id)} draggable={room === 'edit'} onPick={() => onPick(g)} />
        ))}
        {shownRenders.map((r) => (
          <div key={r.id} className="rm-tile" role="listitem">
            <Poster sha={r.asset} atS={0.5} words="Render" scrub />
            <div className="rm-tilename rm-clamp2" title={`Render v${r.version}`}>Render v{r.version}{doc.assets[r.asset]?.duration_s ? ` · ${Math.round(doc.assets[r.asset].duration_s! * 10) / 10} s` : ''}</div>
          </div>
        ))}
        {shownImages.map((r) => (
          <div key={r.id} className="rm-tile" role="listitem">
            <Poster sha={r.asset} words={`@${r.key}`} />
            <div className="rm-tilename rm-clamp2" title={`@${r.key}_${r.variant}`}>@{r.key} · {r.variant}</div>
          </div>
        ))}
        {empty && <p className="rm-note rm-binempty">{filter === 'renders' ? 'No renders yet. Render ad in the Edit room.' : filter === 'uploads' ? 'No uploads yet.' : filter === 'unused' ? 'Every take is in the cut.' : 'Nothing here yet. Make a box to fill the Bin.'}</p>}
      </div>
      <div className="rm-binfoot">
        <button type="button" className="btn rm-wide" disabled title="Uploading your own footage comes next">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 10V2.5M3.8 5.5 7 2.3l3.2 3.2M2.5 11.5h9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          Upload footage
        </button>
      </div>
    </aside>
  )
}

function TakeTile({ g, data, picked, inCut, ready, draggable, onPick }: { g: Gen; data: RoomData; picked: boolean; inCut: boolean; ready: boolean; draggable: boolean; onPick: () => void }) {
  const title = genTitle(g, data.boxes)
  const ref = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<false | 'menu' | 'lineage'>(false)
  const close = useCallback(() => setMenu(false), [])
  const parent = g.parentId ? data.gens.find((x) => x.id === g.parentId) : undefined
  const children = data.gens.filter((x) => x.parentId === g.id)
  const box = data.boxes.find((b) => b.key === g.boxKey)
  return (
    <div ref={ref} role="listitem" className={`rm-tile take ${picked ? 'sel' : ''} ${g.state}`} tabIndex={0} aria-label={`${title}. ${g.label}`}
      draggable={draggable && g.state === 'ready'}
      onDragStart={(e) => { e.dataTransfer.setData(GEN_DRAG, g.id); e.dataTransfer.effectAllowed = 'copy' }}
      onClick={onPick} onDoubleClick={onPick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick() } }}
      onContextMenu={(e) => { e.preventDefault(); setMenu('menu') }}>
      <Poster sha={g.asset} atS={g.segments[0]?.inS ?? 0} words={g.state === 'making' ? 'Making…' : box ? boxName(box) : ''} scrub />
      {g.state === 'making' && <span className="rm-spin" aria-label="Making" />}
      <div className="rm-tilename rm-clamp2" title={`${title} · ${g.label}`}>{title}</div>
      <div className="rm-tilelabel rm-clamp2" title={g.label}>{g.label}</div>
      {(inCut || ready) && (
        <div className="rm-badges">
          {ready && <span className="rm-pill accent">New take ready</span>}
          {inCut && <span className="rm-pill ok">In the cut</span>}
        </div>
      )}
      <Float anchor={ref} open={!!menu} onClose={close} label={title} role={menu === 'lineage' ? 'dialog' : 'menu'} className="rm-lineage">
        {menu === 'lineage' ? (
          <div className="rm-lineagebody">
            <div className="rm-floathead">Lineage</div>
            {parent && <div className="rm-linrow"><span className="pt-mono">v{parent.version}</span><span className="rm-clamp1" title={parent.label}>{parent.label}</span></div>}
            {parent && <div className="rm-linarrow" aria-hidden="true">↓</div>}
            <div className="rm-linrow cur"><span className="pt-mono">v{g.version}</span><span className="rm-clamp1" title={g.label}>{g.label}</span></div>
            {children.map((c) => (
              <div key={c.id}><div className="rm-linarrow" aria-hidden="true">↓</div><div className="rm-linrow"><span className="pt-mono">v{c.version}</span><span className="rm-clamp1" title={c.label}>{c.label}</span></div></div>
            ))}
            <button type="button" className="btn rm-wide" onClick={close}>Close</button>
          </div>
        ) : (
          <MenuItem icon="⟲" onSelect={() => setMenu('lineage')}>Show lineage</MenuItem>
        )}
      </Float>
    </div>
  )
}
