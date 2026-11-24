// The Brand Clan node's card on the canvas (Brand Clan phase 2; mocks d1, d2, d3). The client's look as a node: the picker
// ("Tidewell · Zero ▾") and its version, the logo, the colours, the type, and what it reaches: "Not linked · jobs do not use
// it yet" or "Linked to the Script". Placed for the client's default, a tip says how to link it. A newer published version
// offers Update (the person's decision); the picker swaps the look or adds a second card beside it to compare.

import { useEffect, useState } from 'react'
import type { ProductionDocument } from '../contracts/types'
import type { NodeEnv } from '../canvas/nodes/nodes'
import { freshness, keepBrandClan, linkedLabel, takeBrandClan } from './model'
import { addBrandClanBeside } from './canvas'
import { pageBrandClanSource, type OsBrandClanItem } from './os'
import './brandClan.css'

export function BrandClanCard({ doc, id, env }: { doc: ProductionDocument; id: string; env: NodeEnv | null }) {
  const n = doc.brand_clans?.[id]
  const [items, setItems] = useState<OsBrandClanItem[] | null>(null)
  const [logo, setLogo] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState('')
  const src = pageBrandClanSource()
  const client = n?.client?.id ?? doc.project?.client_id
  useEffect(() => {
    let live = true
    if (client) src.list(client).then((l) => { if (live) setItems(l) }, () => { if (live) setItems([]) })
    return () => { live = false }
  }, [client, src, n?.source.version, n?.source.document_id])
  const logoAsset = n?.bible.visual?.logos?.find((l) => l.variant === 'light')?.asset ?? n?.bible.visual?.logos?.[0]?.asset
  useEffect(() => {
    let live = true
    if (n && logoAsset) src.assetUrl(n.source.path, logoAsset).then((u) => { if (live) setLogo(u) }, () => { if (live) setLogo(null) })
    return () => { live = false }
  }, [n?.source.path, logoAsset, src, n])
  const shownLogo = logoAsset ? logo : null
  if (!n) return null
  const clientName = n.client?.name
  const now = items?.find((i) => i.documentId === n.source.document_id)
  const fresh = now ? freshness(n, now) : 'same'
  const linked = linkedLabel(doc, id)
  const cols = (n.bible.visual?.colours ?? []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex)).slice(0, 4)
  const type = (n.bible.visual?.typography ?? []).map((t) => t.family).filter(Boolean)
  const typeLine = type.length > 1 && type[1].startsWith(type[0].split(' ')[0]) ? `${type[0]} · ${type[1].split(' ').slice(1).join(' ') || type[1]}` : type.join(' · ')
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  const act = async (label: string, fn: () => Promise<unknown>) => {
    if (busy || !env) return
    setBusy(true); setOpen(false); setSay('')
    try { await fn() } catch (e) { setSay(`${label} did not work: ${e instanceof Error ? e.message : String(e)}. Nothing changed.`) }
    setBusy(false)
  }
  const pick = (it: OsBrandClanItem) => act('Changing the Brand Clan', async () => { if (env) await takeBrandClan(env.doc, id, await src.read(it.path)) })
  const beside = (it: OsBrandClanItem) => act('Adding a Brand Clan', async () => { if (env) await addBrandClanBeside(env, id, it.path) })
  const update = () => now && act('Updating', async () => { if (env) await takeBrandClan(env.doc, id, await src.read(now.path)) })
  const keep = () => now && act('Keeping this version', async () => { if (env) await keepBrandClan(env.doc, id, now.version) })
  return (
    <div className="bc-card" data-brand-clan={id}>
      <span className="bc-tab" aria-hidden="true">BRAND CLAN</span>
      <div className="bc-head">
        <button type="button" className="bc-pick" onPointerDown={stop} aria-haspopup="menu" aria-expanded={open} disabled={busy || !env} onClick={() => setOpen((o) => !o)}>
          {clientName ? `${clientName} · ` : ''}{n.title} ▾
        </button>
        <span className="bc-v">v{n.source.version}</span>
      </div>
      {open && (
        <div className="bc-menu" role="menu" onPointerDown={stop}>
          <p className="bc-menu-h">Brand Clan for this node</p>
          {(items ?? []).map((it) => (
            <button key={it.documentId} type="button" role="menuitemradio" aria-checked={it.documentId === n.source.document_id} className="bc-item" onClick={() => pick(it)}>
              <span className="bc-ck">{it.documentId === n.source.document_id ? '✓' : ''}</span>
              <span className="bc-nm">{it.name}{it.default ? <small> · default</small> : null}</span>
              <span className="bc-sub">v{it.version}{it.note ? ` · ${it.note}` : ''}</span>
            </button>
          ))}
          {items && items.length > 1 && (
            <div className="bc-cmp">
              <p className="bc-menu-h">Compare: add another beside it</p>
              {items.filter((it) => it.documentId !== n.source.document_id).map((it) => (
                <button key={`b-${it.documentId}`} type="button" className="bc-item" onClick={() => beside(it)}><span className="bc-ck">+</span><span className="bc-nm">{it.name}</span></button>
              ))}
            </div>
          )}
          {items === null && <p className="bc-menu-h">Reading the client’s Brand Clans…</p>}
        </div>
      )}
      <div className="bc-logo">{shownLogo ? <img src={shownLogo} alt={`${n.title} logo`} onError={() => setLogo(null)} /> : <span>{clientName ?? n.title}</span>}</div>
      {!!cols.length && <div className="bc-sw">{cols.map((c) => <i key={c.id} title={`${c.name ?? c.id} ${c.hex}`} style={{ background: c.hex }} />)}</div>}
      {typeLine && <div className="bc-type"><b>Aa</b> <span>{typeLine}</span></div>}
      {fresh === 'newer' && now && (
        <div className="bc-new" onPointerDown={stop}>{n.title} v{now.version} published · <button type="button" onClick={update} disabled={busy}>Update</button> <button type="button" className="bc-quiet" onClick={keep} disabled={busy}>Keep v{n.source.version}</button></div>
      )}
      <div className={`bc-foot ${linked ? 'on' : 'off'}`}>{linked || 'Not linked · jobs do not use it yet'}</div>
      {say && <div className="bc-say" role="status">{say}</div>}
    </div>
  )
}

/** The tip beside a default Brand Clan that is not linked yet (mock d1). */
export function BrandClanTip() {
  return (
    <div className="bc-tip" role="note">
      <b>Placed for you, not linked.</b> Link it to the <b>Script</b> to use it for everything made from it, or to one <b>Storyboard</b> or <b>Film</b> to try a look there.
    </div>
  )
}
