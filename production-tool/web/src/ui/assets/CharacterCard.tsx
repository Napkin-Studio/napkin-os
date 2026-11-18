// A character's card (ui-behaviour 3.22; mock production-new-ui-v2 "character"), in the Booth on one
// character (Assets › @name): Views (its named pictures; Make the other views), Voice, Wardrobe and Used in
// (the shots that name it), then Use it and Publish. Voice and Wardrobe are shells until the audio and
// wardrobe features land: what is not there yet is said plainly, and nothing pretends to work.

import { useState } from 'react'
import { useDoc } from '../../app/context'
import type { CanvasController } from '../../canvas/controller'
import type { KeyEntry } from '../../contracts/types'
import { refsList, shotsOf } from '../../model/selectors'
import { nameOf } from '../../lib/names'
import { useBlobUrl } from '../hooks'
import { useKeyActions } from './keyActions'

type Tab = 'views' | 'voice' | 'wardrobe' | 'used'

export function CharacterCard({ k, ctrl, onBack, onClose, onScript }: {
  k: KeyEntry
  ctrl: CanvasController | null
  /** "← Assets": back to the library. */
  onBack: () => void
  /** ×: the library closes. */
  onClose: () => void
  /** "Type @name in the script". */
  onScript: () => void
}) {
  const doc = useDoc()
  const [tab, setTab] = useState<Tab>('views')
  const act = useKeyActions(k, ctrl)
  const refs = refsList(doc).filter((r) => r.key === k.key)
  const front = refs.find((r) => r.variant === 'front') ?? refs[0]
  const ids = new Set([k.id, ...refs.map((r) => r.id)])
  const used = shotsOf(doc).map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => (s.refs ?? []).some((r) => ids.has(r)))
  const tabs: { id: Tab; label: string }[] = [{ id: 'views', label: 'Views' }, { id: 'voice', label: 'Voice' }, { id: 'wardrobe', label: 'Wardrobe' }, { id: 'used', label: `Used in · ${used.length}` }]
  const name = k.key[0].toUpperCase() + k.key.slice(1)
  return (
    <section className="cc" aria-label={`@${k.key}`}>
      <div className="sp-crumb"><button type="button" onClick={onBack}>← Assets</button><span>›</span><b>@{k.key}</b>
        <button type="button" className="x" aria-label="Close the assets" title="Close (Esc)" onClick={onClose}>×</button></div>
      <div className="btitle">
        <Pic sha={front?.asset} round />
        <b className="pt-ref">@{k.key}</b>
        <span className="cc-role">{act.role}</span>
        <span className="meta">{k.library ? `v${k.library.ver}` : `${refs.length} ${refs.length === 1 ? 'view' : 'views'}`}</span>
      </div>
      <div className="seg-row" role="tablist">
        {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-pressed={tab === t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === 'views' && (
        <>
          <div className="agrid">
            {refs.map((r) => (
              <button key={r.id} type="button" className="a" title={`@${nameOf(r)}: show it on the canvas`} onClick={() => r.node && ctrl?.scrollTo(r.node)}>
                <PicImg sha={r.asset} /><span>{r.variant ? r.variant[0].toUpperCase() + r.variant.slice(1).replace('_', '-') : `@${nameOf(r)}`}</span><small>@{nameOf(r)}</small>
              </button>
            ))}
          </div>
          {!refs.length && <p className="hint">No views named yet.</p>}
          {act.views}
        </>
      )}
      {tab === 'voice' && (
        <>
          <p className="hint" style={{ margin: 0 }}>{name}'s voice comes with sound (ElevenLabs): pick one, design one from a description, or clone one from a sample. Not in this version yet.</p>
          <div className="cc-acts"><button type="button" className="sp-btn" disabled>Pick a voice</button><button type="button" className="sp-btn" disabled>Say brand names right</button></div>
          <p className="hint" style={{ margin: 0 }}>Everywhere {k.key} speaks: no lines yet. Lines and voice-over are written in the Script editor's Video · Audio view.</p>
        </>
      )}
      {tab === 'wardrobe' && <p className="hint" style={{ margin: 0 }}>No wardrobe yet. Name a picture with the wardrobe role to keep it here.</p>}
      {tab === 'used' && (
        <ul className="cc-used">
          {used.map(({ s, n }) => <li key={s.id}><span className="pt-mono">Shot {n}</span><span>{(s.action ?? '').split('\n')[0]}</span></li>)}
          {!used.length && <li className="hint">No shot names @{k.key} yet.</li>}
        </ul>
      )}
      <div className="bsec">
        <h4>Use it</h4>
        <div className="cc-acts">
          <button type="button" className="sp-btn" onClick={onScript}>Type @{k.key} in the script</button>
          <button type="button" className="sp-btn" disabled={!front?.node} onClick={() => front?.node && ctrl?.scrollTo(front.node)}>Show it on the canvas</button>
        </div>
        <p className="hint" style={{ margin: 0 }}>{k.library ? `In the team library, v${k.library.ver}.` : 'This project only.'} {act.publish}</p>
        {act.error}
      </div>
    </section>
  )
}

function PicImg({ sha }: { sha?: string }) {
  const url = useBlobUrl(sha)
  return url ? <img src={url} alt="" /> : <span className="a-empty" />
}

function Pic({ sha, round = false }: { sha?: string; round?: boolean }) {
  const url = useBlobUrl(sha)
  return <span className={round ? 'cc-pic round' : 'cc-pic'}>{url && <img src={url} alt="" />}</span>
}
