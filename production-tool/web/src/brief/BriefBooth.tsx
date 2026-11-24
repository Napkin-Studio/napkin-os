// The Booth on a selected Brief node (features/brief-node.clan; mock production-new-ui-v2 brief-node and
// brief-diff): the source card with Open in Brief Maker, the whole spine read-only with where each line came
// from (ⓘ), what the brief feeds, and the person's calls: Check for a newer version (then Update to vN or
// Keep vN, with what changed), and Unlink. Nothing re-runs by itself.

import { useState } from 'react'
import { useDoc, useServices } from '../app/context'
import { feedLabel } from './feedWords'
import { updateDoc } from '../doc/store'
import { briefFeeds, briefNotice, keepVersion, takeNewer, type BriefNotice } from './model'
import { osBriefSource, type BriefSource } from './os'
import { projectSpine, spineLines } from './spine'

const OS = osBriefSource()

export function BriefBooth({ briefId, onClose, src = OS }: { briefId: string; onClose: () => void; src?: BriefSource }) {
  const doc = useDoc()
  const { doc: store } = useServices()
  const [notice, setNotice] = useState<BriefNotice | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const b = doc.briefs?.[briefId]
  if (!b) return null
  const v = b.source.version
  const route = b.route
  const lines = spineLines(b.spine, b.confidential)
  const feeds = briefFeeds(doc, briefId)
  const after = notice ? projectSpine(notice.read.data).spine : null
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setSaid(null)
    try { await fn() } catch (e) { setSaid(e instanceof Error ? e.message : 'That did not work. Try again.') } finally { setBusy(false) }
  }
  const check = () => run(async () => {
    const now = await src.read(b.source.document_id)
    const n = briefNotice(b, now)
    setNotice(n)
    if (!n) setSaid(b.source.kept === now.dataSha256 ? `Brief Maker still has the version you kept v${v} over.` : `This is the newest version: v${v}.`)
  })
  const unlink = () => run(() => updateDoc(store, (d) => {
    for (const [id, l] of Object.entries(d.links ?? {})) if (l.from.kind === 'brief' && l.from.id === briefId) delete d.links[id]
  }, `unlink the brief ${b.title}`, 'The person unlinked it: what it fed no longer gets the brief'))
  const show = (text: string | undefined, items: string[] | undefined) =>
    items ? <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span>{text}</span>
  return (
    <div className="bb" data-brief-booth={briefId}>
      <div className="sp-crumb"><button type="button" onClick={onClose}>← Canvas</button><span>›</span><b>{route ? 'Territories' : 'Brief'}</b>{notice && <><span>›</span><b>v{v} → v{notice.read.version}</b></>}
        <button type="button" className="x" onClick={onClose} title="Back (Esc)" aria-label="Close the brief">×</button></div>
      <div className="bb-src"><span className="tab" aria-hidden="true">{route ? 'TERRITORIES' : 'BRIEF'}</span>
        <span className="t"><b>{route ? `${route.name}` : b.title || 'Brief'}</b><small>{route ? `Territories · ${b.title} · v${route.version ?? 1} · frozen here` : `Brief Maker · v${v} · frozen here`}</small></span>
        <a className="sp-btn" href={src.openUrl(b.source.document_id)} target="_blank" rel="noreferrer">{route ? 'Open in Territories ↗' : 'Open in Brief Maker ↗'}</a></div>
      {notice && after ? (
        <div className="bb-sec">
          <div className="bb-changed" role="status"><b>{notice.text}</b><span className="bb-hint">{notice.detail}</span></div>
          <h4>Changed · {notice.changes.length}</h4>
          {notice.changes.map((part) => {
            const was = lines.find((l) => l.part === part)
            const now = spineLines(after).find((l) => l.part === part)
            return (
              <div key={part} className="spine-row"><span className="lbl">{was?.label ?? now?.label ?? part}</span>
                <span>{was && <del>{was.text ?? was.items?.join(' · ')}</del>}{was && now && <br />}{now && <ins>{now.text ?? now.items?.join(' · ')}</ins>}</span><span /></div>
            )
          })}
          <p className="bb-hint">If you update, what this brief feeds is marked to update; the Director agent proposes the changes. Nothing re-runs by itself.</p>
          <div className="bb-acts">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => { await takeNewer(store, briefId, notice.read); setNotice(null); setSaid(`Updated to v${notice.read.version}. What it feeds is marked to update.`) })}>Update to v{notice.read.version}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => { await keepVersion(store, briefId, notice.read); setNotice(null); setSaid(`Kept v${v}; recorded in Decisions.`) })}>Keep v{v}</button>
          </div>
        </div>
      ) : (
        <div className="bb-sec">
          <h4>{route ? 'The brief it carries' : 'The spine'} <span className="r">read-only · ⓘ shows where a line came from</span></h4>
          {lines.map((l) => (
            <div key={l.part} className="spine-row"><span className="lbl">{l.label}</span>
              {l.confidential ? <span className="faint">Confidential: kept out of Napkin’s own records</span> : show(l.text, l.items)}
              <button type="button" className="src-mini" aria-label={`Where ${l.label} came from`} title={`${l.label} · ${b.title} v${v} · Brief Maker, taken ${b.source.at.slice(0, 10)}`}>ⓘ</button></div>
          ))}
        </div>
      )}
      <div className="bb-sec">
        <h4>Feeds</h4>
        {feeds.length ? feeds.map((f) => {
          const w = feedLabel(f.kind)
          return <div key={`${f.kind}:${f.id}`} className="brow"><span className="t"><b>{w.title}</b><small>{w.sub}</small></span></div>
        }) : <p className="bb-hint">Not linked yet: link it into a Script (drag from its port), and the script, its storyboard and film read it.</p>}
        <p className="bb-hint">The Director agent gets this spine with every job it plans. The Review agent only flags a broken mandatory or don’t in Decisions, with an amber mark on the cut or size; it never blocks or asks.</p>
      </div>
      {said && <p className="bb-hint" role="status">{said}</p>}
      <div className="bb-acts">
        {!route && <button type="button" className="sp-btn" disabled={busy} onClick={() => void check()}>Check for a newer version</button>}
        {feeds.length > 0 && <button type="button" className="sp-btn" disabled={busy} onClick={() => void unlink()}>Unlink</button>}
      </div>
    </div>
  )
}
