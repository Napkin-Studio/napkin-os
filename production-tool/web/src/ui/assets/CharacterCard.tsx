// A character's card (ui-behaviour 3.22; mock Voices.dc.html), over the canvas beside the Assets
// drawer: Views (its named pictures), Voice, Wardrobe and Used in (the shots that name it). Voice and
// Wardrobe are shells until the audio and wardrobe features land: their layout, with what is not
// there yet said plainly, and nothing that pretends to work.

import { useState } from 'react'
import { useDoc } from '../../app/context'
import type { KeyEntry } from '../../contracts/types'
import { refsList, shotsOf } from '../../model/selectors'
import { nameOf } from '../../lib/names'
import { useBlobUrl } from '../hooks'

type Tab = 'views' | 'voice' | 'wardrobe' | 'used'

export function CharacterCard({ k, onClose }: { k: KeyEntry; onClose: () => void }) {
  const doc = useDoc()
  const [tab, setTab] = useState<Tab>('views')
  const refs = refsList(doc).filter((r) => r.key === k.key)
  const ids = new Set([k.id, ...refs.map((r) => r.id)])
  const used = shotsOf(doc).map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => (s.refs ?? []).some((r) => ids.has(r)))
  const tabs: { id: Tab; label: string }[] = [{ id: 'views', label: 'Views' }, { id: 'voice', label: 'Voice' }, { id: 'wardrobe', label: 'Wardrobe' }, { id: 'used', label: `Used in · ${used.length}` }]
  return (
    <section className="cc pt-panel" role="dialog" aria-label={`@${k.key}`}>
      <header className="cc-head">
        <span className="cc-thumbs">{refs.slice(0, 3).map((r) => <Pic key={r.id} sha={r.asset} />)}</span>
        <span className="cc-title"><span className="pt-ref">@{k.key}</span><span>{k.role[0].toUpperCase() + k.role.slice(1)} · {refs.length} {refs.length === 1 ? 'view' : 'views'}{k.library ? ` · v${k.library.ver}` : ''}</span></span>
        <span className="pt-grow" />
        <span className="pt-seg" role="tablist">
          {tabs.map((t) => <button key={t.id} role="tab" aria-pressed={tab === t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </span>
        <button className="cc-x" aria-label="Close" onClick={onClose}>×</button>
      </header>
      {tab === 'views' && (
        <div className="cc-views">
          {refs.map((r) => <figure key={r.id}><Pic sha={r.asset} big /><figcaption className="pt-ref">@{nameOf(r)}</figcaption></figure>)}
          {!refs.length && <p className="cc-empty">No views named yet.</p>}
        </div>
      )}
      {tab === 'voice' && (
        <>
          <div className="cc-voicebar"><span className="cc-play" aria-hidden="true">▶</span><span><b>No voice yet</b><br /><span className="faint">{k.key[0].toUpperCase() + k.key.slice(1)}'s voice comes with sound.</span></span></div>
          <div className="pt-label cc-change">Change {k.key}'s voice · pick one, design one, or clone one</div>
          <div className="cc-cols">
            {['Pick from the library', 'Design one from a description', 'Clone from a sample'].map((t) => (
              <div key={t} className="cc-col pt-card"><b>{t}</b><p className="cc-empty">Not in this version yet. Voices come with sound (ElevenLabs).</p></div>
            ))}
          </div>
          <div className="cc-cols">
            <div className="cc-col pt-card"><b>Everywhere {k.key} speaks</b><p className="cc-empty">No lines yet. Lines and voice-over are written in the Script editor's Video · Audio view.</p></div>
            <div className="cc-col pt-card"><b>Say brand names right</b><p className="cc-empty">Not in this version yet.</p></div>
            <div className="cc-col pt-card"><b>Who it belongs to</b><p className="cc-empty">{k.library ? `In the team library, v${k.library.ver}.` : 'This project only.'}</p></div>
          </div>
        </>
      )}
      {tab === 'wardrobe' && <p className="cc-empty cc-pad">No wardrobe yet. Name a picture with the wardrobe role to keep it here.</p>}
      {tab === 'used' && (
        <ul className="cc-used">
          {used.map(({ s, n }) => <li key={s.id}><span className="pt-mono">Shot {n}</span><span>{(s.action ?? '').split('\n')[0]}</span></li>)}
          {!used.length && <li className="cc-empty">No shot names @{k.key} yet.</li>}
        </ul>
      )}
    </section>
  )
}

function Pic({ sha, big = false }: { sha?: string; big?: boolean }) {
  const url = useBlobUrl(sha)
  return <span className={big ? 'cc-pic big' : 'cc-pic'}>{url && <img src={url} alt="" />}</span>
}
