// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brand Bible, rendered like the boards (mocks b2, f1 to f4b): logos,
// colour board, type board, rules and tone, imagery style, the source file.
// One component for reading, editing in place, a draft with its "changed"
// marks, and an old version (read-only). The four provisions have no UI.

import { Fragment, useRef } from 'react'
import type { BrandBible, BrandClanData } from '../../../host/types'
import { colours, examples, faces, logos, marks, rules, sourceVersion, when, who } from './model'

export type BibleMode = 'view' | 'edit' | 'draft' | 'old'

export interface Edits {
  setLogoNote(t: string): void
  setColour(id: string, patch: { name?: string; hex?: string }): void
  addColour(): void
  removeColour(id: string): void
  setFace(id: string, patch: { family?: string; use?: string; weight?: string }): void
  addFace(): void
  removeFace(id: string): void
  setTone(t: string): void
  setRule(id: string, t: string): void
  addRule(): void
  removeRule(id: string): void
  setStyle(t: string): void
  setBans(bans: string[]): void
  /** A picture chosen for a logo (`id` given: replace it) or an example. */
  pick(kind: 'logo' | 'example', file: File, id?: string): void
  removeExample(id: string): void
}

interface Props {
  /** The bible shown: the draft's candidate while drafting or editing, else the published data. */
  bible: BrandBible
  /** The published data, for the source card's version and who/when. */
  data: BrandClanData
  mode: BibleMode
  /** The draft's changes (by id), to mark. */
  changes?: readonly { id: string; kind: 'added' | 'changed' | 'removed' }[]
  /** `human/assets/<name>` → an address for `<img>`. */
  src: (asset: string | undefined) => string | undefined
  edits?: Edits
}

const Mark = ({ kind }: { kind: 'changed' | 'new' | 'removed' | undefined }) => (kind ? <span className="bbm-mark">{kind}</span> : null)

function Pic({ src, label, className }: { src: string | undefined; label: string; className?: string }) {
  return src ? <img className={className ?? 'bcm-pic'} src={src} alt={label} /> : <span className="bcm-pic" role="img" aria-label={label} />
}

function PickFile({ label, onFile, className = 'bcm-sm' }: { label: string; onFile: (f: File) => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()}>{label}</button>
      <input ref={ref} type="file" accept="image/*" hidden aria-label={label}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
    </>
  )
}

export function Bible({ bible, data, mode, changes = [], src, edits }: Props) {
  const edit = mode === 'edit' && !!edits
  const m = mode === 'draft' ? marks(changes) : new Map<string, 'changed' | 'new' | 'removed'>()
  const mk = (id: string) => m.get(id)
  const logoList = logos(bible), colourList = colours(bible), faceList = faces(bible), ruleList = rules(bible), exampleList = examples(bible)
  const tone = bible.voice?.tone ?? ''
  const cut = tone.search(/[.!?](\s|$)/)
  const [lead, rest] = cut < 0 ? [tone, ''] : [tone.slice(0, cut + 1), tone.slice(cut + 1)]
  const style = bible.imagery?.style ?? ''
  const bans = (bible.imagery?.bans ?? []).filter(b => !style.toLowerCase().includes(b.toLowerCase()))
  const logoMarked = logoList.some(l => mk(`logo:${l.id}`)) || !!mk('logo_note')
  const source = bible.source ?? data.source
  const kind = (source?.kind ?? source?.file.split('.').pop() ?? '').toUpperCase().slice(0, 4)

  return (
    <div className="bcm-b">
      <div className="bcm-card"><h3>Logos <em>{edit ? 'replace or add a file' : mode === 'old' ? '' : 'click to replace'}{logoMarked && <Mark kind="changed" />}</em></h3>
        <div className="bcm-logos">
          {logoList.map(l => (
            <div key={l.id} className={mk(`logo:${l.id}`) ? 'bbm-chg' : ''} title={l.label}>
              <Pic src={src(l.asset)} label={l.label} />
            </div>
          ))}
        </div>
        {edit && (
          <div className="bcm-top" style={{ marginTop: 8 }}>
            {logoList.map(l => <PickFile key={l.id} label={`Replace ${l.label}`} onFile={f => edits.pick('logo', f, l.id)} />)}
            <PickFile label="+ Add logo" onFile={f => edits.pick('logo', f)} />
          </div>
        )}
        {edit
          ? <input className="bbm-in" style={{ marginTop: 8, font: '12px var(--font-ui)' }} value={bible.visual?.logo_note ?? ''} aria-label="Logo note" onChange={e => edits.setLogoNote(e.target.value)} />
          : bible.visual?.logo_note ? <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{bible.visual.logo_note}</p> : null}
      </div>

      <div className="bcm-card"><h3>Colour <em>{edit ? 'click a swatch' : colourList.length}</em></h3>
        <div className="bcm-cols">
          {colourList.map(c => (
            <div className={`bcm-col ${mk(`colour:${c.id}`) ? 'bbm-chg' : ''}`} key={c.id}>
              <i style={{ background: c.hex }}>{edit && <button type="button" className="bbm-x" style={{ float: 'right', margin: 4 }} aria-label={`Remove ${c.name}`} onClick={() => edits.removeColour(c.id)}>×</button>}</i>
              <span>
                {edit ? (
                  <Fragment>
                    <input className="bbm-in" value={c.name} aria-label={`${c.name} name`} style={{ font: '600 12px var(--font-ui)' }} onChange={e => edits.setColour(c.id, { name: e.target.value })} />
                    <input className="bbm-in" value={c.hex} aria-label={`${c.name} hex`} style={{ marginTop: 3 }} onChange={e => edits.setColour(c.id, { hex: e.target.value })} />
                  </Fragment>
                ) : (
                  <Fragment><b className="bcm-ed">{c.name}</b>{c.hex}<Mark kind={mk(`colour:${c.id}`)} /></Fragment>
                )}
              </span>
            </div>
          ))}
        </div>
        {edit && <div className="bcm-top" style={{ marginTop: 8 }}><button type="button" className="bcm-sm" onClick={edits.addColour}>+ Add colour</button></div>}
      </div>

      <div className="bcm-card"><h3>Typography <em>{faceList.length === 1 ? '1 face' : `${faceList.length} faces`}</em></h3>
        {edit ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {faceList.map(f => (
              <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 0.8fr auto', gap: 6 }}>
                <input className="bbm-in" value={f.family} aria-label="Face" onChange={e => edits.setFace(f.id, { family: e.target.value })} />
                <input className="bbm-in" value={f.use ?? ''} aria-label="Use" onChange={e => edits.setFace(f.id, { use: e.target.value })} />
                <input className="bbm-in" value={f.weight ?? ''} aria-label="Weights" onChange={e => edits.setFace(f.id, { weight: e.target.value })} />
                <button type="button" className="bbm-x" style={{ background: 'var(--muted)' }} aria-label={`Remove ${f.family}`} onClick={() => edits.removeFace(f.id)}>×</button>
              </div>
            ))}
            <div><button type="button" className="bcm-sm" onClick={edits.addFace}>+ Add face</button></div>
          </div>
        ) : faceList.map((f, i) => {
          const weight = parseInt(f.weight ?? '', 10) || (i === 0 ? 700 : 400)
          const stack = `'${f.family}', ${f.role === 'head' || i === 0 ? 'Georgia, serif' : 'var(--font-ui)'}`
          return i === 0
            ? <div key={f.id} className={mk(`typography:${f.id}`) ? 'bbm-chg' : ''} style={{ font: `${weight} 26px ${stack}`, color: 'var(--ink)' }}>{f.family} {f.use && <span style={{ font: '12px var(--font-mono)', color: 'var(--muted)' }}>{f.use}</span>}<Mark kind={mk(`typography:${f.id}`)} /></div>
            : <div key={f.id} className={mk(`typography:${f.id}`) ? 'bbm-chg' : ''} style={{ font: `400 15px ${stack}`, marginTop: 6 }}>{f.family}{f.use ? ` for ${f.use}.` : ''} {f.weight && <span style={{ font: '12px var(--font-mono)', color: 'var(--muted)' }}>{f.weight}</span>}<Mark kind={mk(`typography:${f.id}`)} /></div>
        })}
      </div>

      <div className="bcm-card"><h3>Rules and tone</h3>
        {edit ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <input className="bbm-in" style={{ font: '13px var(--font-ui)' }} value={tone} aria-label="Tone" onChange={e => edits.setTone(e.target.value)} />
            {ruleList.map(r => (
              <div key={r.id} style={{ display: 'flex', gap: 6 }}>
                <input className="bbm-in" style={{ font: '12.5px var(--font-ui)' }} value={r.text} aria-label="Rule" onChange={e => edits.setRule(r.id, e.target.value)} />
                <button type="button" className="bbm-x" style={{ background: 'var(--muted)', flex: '0 0 18px' }} aria-label="Remove rule" onClick={() => edits.removeRule(r.id)}>×</button>
              </div>
            ))}
            <div><button type="button" className="bcm-sm" onClick={edits.addRule}>+ Add a rule</button></div>
          </div>
        ) : (
          <>
            {tone && <p className={mk('tone') ? 'bbm-chg' : ''} style={{ fontSize: 13, margin: '0 0 6px' }}><b className="bcm-ed">{lead}</b>{rest}<Mark kind={mk('tone')} /></p>}
            <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 18, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
              {ruleList.map(r => <li key={r.id} className={mk(`rule:${r.id}`) ? 'bbm-chg' : ''} style={{ listStylePosition: 'outside' }}>{r.text}<Mark kind={mk(`rule:${r.id}`)} /></li>)}
            </ul>
          </>
        )}
      </div>

      <div className="bcm-card"><h3>Imagery style</h3>
        <div className="bcm-img">
          {exampleList.map(x => (
            <i key={x.id} className={mk(`example:${x.id}`) ? 'bbm-chg' : ''}>
              <Pic src={src(x.asset)} label={x.note ?? 'Example picture'} className="" />
              {edit && <button type="button" className="bbm-x" style={{ position: 'absolute', top: 4, right: 4 }} aria-label="Remove example" onClick={() => edits.removeExample(x.id)}>×</button>}
            </i>
          ))}
          {edit && <PickFile label="+ Add example" className="bbm-add" onFile={f => edits.pick('example', f)} />}
        </div>
        {edit ? (
          <>
            <input className="bbm-in" style={{ marginTop: 8, font: '12px var(--font-ui)' }} value={style} aria-label="Imagery style" onChange={e => edits.setStyle(e.target.value)} />
            <input className="bbm-in" style={{ marginTop: 6, font: '12px var(--font-ui)' }} value={(bible.imagery?.bans ?? []).join(', ')} aria-label="Banned imagery, comma separated"
              placeholder="Banned imagery, comma separated" onChange={e => edits.setBans(e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
          </>
        ) : (
          <p className={mk('imagery_style') ? 'bbm-chg' : ''} style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{style}{bans.length > 0 && ` Never: ${bans.join('; ')}.`}<Mark kind={mk('imagery_style')} /></p>
        )}
      </div>

      <div className="bcm-card"><h3>Source</h3>
        {source ? (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ font: '700 10px var(--font-mono)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 6px' }}>{kind || 'FILE'}</span>
              <div>
                <b style={{ fontSize: 13 }}>{source.file}</b>
                <div style={{ font: '12px var(--font-mono)', color: 'var(--muted)' }}>{[source.pages ? `${source.pages} pages` : '', source.at ? `added ${when(source.at)}${source.by ? ` by ${who(source.by)}` : ''}` : ''].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>The original file stays as the source of v{sourceVersion(data)}.</p>
          </>
        ) : <p style={{ fontSize: 12, color: 'var(--muted)' }}>No source file yet. A brand book added in a Brief, Research or Production can build this Brand Clan.</p>}
        {bible.gaps && bible.gaps.length > 0 && (
          <p className="bcm-hint">Not found in the book: {bible.gaps.map(g => `${g.area} (${g.note})`).join('; ')}.</p>
        )}
      </div>
    </div>
  )
}
