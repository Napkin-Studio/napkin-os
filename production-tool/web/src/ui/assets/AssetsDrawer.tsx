// Assets and characters (ui-behaviour 3.18; mock production-new-ui-v2 "assets" and "character"): a library
// opened on purpose from the bar's Assets button, so it lives in the canvas's Booth (the Booth rule, Shrey
// 2026-11-17). Tabs: This project (the named references as tiles by role, Unused pictures with Clean up),
// Team library (the agency's shelf, Bring in / Update), Upload, and From Napkin. A tile opens its character
// in the Booth (Assets › @name): views, Make the other views, its role, Use it, Publish.

import { useEffect, useState } from 'react'
import { useDoc, useServices, useUi } from '../../app/context'
import type { CanvasController } from '../../canvas/controller'
import { AGENCY_SHELF, type KeyEntry, type LibraryIndex, type RefRole } from '../../contracts/types'
import { systemUpdate } from '../../doc/store'
import { sweep, unused } from '../../doc/gc'
import { deleteBlob } from '../../lib/blobs'
import { keyNamed, keysList, refsList } from '../../model/selectors'
import { useBlobUrl } from '../hooks'
import { InlineConfirm } from '../Undo'
import { CharacterCard } from './CharacterCard'
import './assets.css'

type Tab = 'project' | 'library' | 'upload' | 'napkin'
const TABS: { id: Tab; label: string }[] = [
  { id: 'project', label: 'This project' }, { id: 'library', label: 'Team library' }, { id: 'upload', label: 'Upload' }, { id: 'napkin', label: 'From Napkin' },
]
const errText = (e: unknown) => (e instanceof Error ? e.message : 'That did not work. Try again.')
const roleWord = (r: RefRole) => (r === 'brand_rule' ? 'brand rule' : r)
const GROUPS: { title: string; roles: RefRole[] | 'other' }[] = [
  { title: 'Characters', roles: ['character'] }, { title: 'Locations', roles: ['location'] }, { title: 'Products', roles: ['product'] }, { title: 'References', roles: 'other' },
]

export function AssetsLibrary({ ctrl, onClose, onPicture, onCanvas, onScript }: {
  ctrl: CanvasController | null
  /** "← Canvas" and ×: the library closes, the Booth with it. */
  onClose: () => void
  /** Upload: the canvas's picture tool. */
  onPicture: () => void
  /** The pictures on the canvas now (Clean up keeps them). */
  onCanvas: string[]
  /** "Type @name in the script": opens the Script editor. */
  onScript: () => void
}) {
  const doc = useDoc()
  const ui = useUi()
  const [tab, setTab] = useState<Tab>('project')
  const [query, setQuery] = useState('')
  const [card, setCard] = useState<string | null>(null)
  const keys = keysList(doc)
  const q = query.trim().toLowerCase()
  const shown = keys.filter((k) => !q || k.key.includes(q))
  const open = card ? keys.find((k) => k.key === card) : undefined
  if (open) return <CharacterCard k={open} ctrl={ctrl} onBack={() => setCard(null)} onClose={onClose} onScript={onScript} />
  return (
    <div className="assets-lib" aria-label="Assets">
      <div className="sp-crumb"><button type="button" onClick={onClose}>← Canvas</button><span>›</span><b>Assets</b>
        <button type="button" className="x" aria-label="Close the assets" title="Close (Esc)" onClick={onClose}>×</button></div>
      <div className="seg-row ad-tabs" role="tablist" aria-label="Where from">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} title={t.label} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'project' && (
        <>
          <label className="ad-search">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M9.3 9.3 L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            <input aria-label="Search pictures, characters, places" placeholder="Search pictures, characters, places" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          {!keys.length && <p className="hint">Name a picture on the canvas (select it, then Name…) to keep it here. Your script uses the names.</p>}
          {GROUPS.map((g) => {
            const mine = shown.filter((k) => (g.roles === 'other' ? !['character', 'location', 'product'].includes(k.role) : g.roles.includes(k.role)))
            if (!mine.length) return null
            return (
              <section key={g.title} className="bsec">
                <h4>{g.title} · {mine.length}{g.roles !== 'other' && g.roles.includes('character') && <span className="r"><button type="button" className="side-link" onClick={() => setCard(mine[0].key)}>Open @{mine[0].key}</button></span>}</h4>
                <div className="agrid">{mine.map((k) => <KeyTile key={k.key} k={k} onOpen={() => setCard(k.key)} />)}</div>
              </section>
            )
          })}
          <CleanUp onCanvas={onCanvas} />
          <p className="hint">Drag a picture onto the canvas, or type @ in the script or a shot to use it. Click one to open it.</p>
        </>
      )}
      {tab === 'library' && ctrl && <Library ctrl={ctrl} />}
      {tab === 'upload' && (
        <>
          <div className="drop">Pick a picture to put on the canvas. On a board it takes the board's role; anywhere else you name it.</div>
          <button type="button" className="btn-rect wide" onClick={onPicture}>Choose files…</button>
        </>
      )}
      {tab === 'napkin' && <p className="hint">Nothing from Brief Maker or Research yet. When a brief or research is sent here, it waits under this tab until you bring it in.</p>}
      <div className="ad-foot">{ui.me?.team ? `Shared with everyone at ${ui.me.team}` : 'Your library is yours until you sign in with your agency'}</div>
    </div>
  )
}

/** One named reference as a tile: its front (or first) picture, @name, what it is and how many views. */
function KeyTile({ k, onOpen }: { k: KeyEntry; onOpen: () => void }) {
  const doc = useDoc()
  const refs = refsList(doc).filter((r) => r.key === k.key)
  const pic = refs.find((r) => r.variant === 'front') ?? refs[0]
  const url = useBlobUrl(pic?.asset)
  return (
    <button type="button" className="a" onClick={onOpen} title={`@${k.key}: open its card (views, voice, wardrobe, where it is used)`}>
      {url ? <img src={url} alt="" /> : <span className="a-empty" />}
      <span>@{k.key}</span>
      <small>{roleWord(k.role)} · {refs.length} {refs.length === 1 ? 'view' : 'views'}{k.library ? ` · v${k.library.ver}` : ''}</small>
    </button>
  )
}

function CleanUp({ onCanvas }: { onCanvas: string[] }) {
  const { doc: docStore, project } = useServices()
  const [cleaning, setCleaning] = useState<string[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const start = () => {
    setNote(null)
    const gone = unused(docStore.get(), onCanvas)
    if (!gone.length) return setNote('Nothing to clean up: every picture is still in use.')
    setCleaning(gone)
  }
  const clean = async (gone: string[]) => {
    setCleaning(null)
    await systemUpdate(docStore, (d) => sweep(d, gone), 'clean up')
    // Blobs are shared by every project: a picture another project still uses keeps its bytes.
    await Promise.all(gone.filter((sha) => !project.usedElsewhere(sha)).map((sha) => deleteBlob(sha)))
    setNote(`Removed ${gone.length} unused ${gone.length === 1 ? 'picture' : 'pictures'}.`)
  }
  return (
    <section className="ad-clean bsec" aria-label="Unused pictures">
      {/* Its own labelled place, not a lone button under the last group (live test 2026-11-16). */}
      <h4>Unused pictures<span className="r"><button type="button" className="side-link" onClick={start} title="Remove pictures nothing uses any more">Clean up</button></span></h4>
      <p className="hint">Pictures nothing uses any more stay in this browser until you clean them up.</p>
      {cleaning && <InlineConfirm text={`Remove ${cleaning.length} unused ${cleaning.length === 1 ? 'picture' : 'pictures'} from this browser? Named images and anything on the canvas or in the storyboard stay.`} yes="Remove" onYes={() => void clean(cleaning)} onNo={() => setCleaning(null)} />}
      {note && <span className="ad-meta">{note}</span>}
    </section>
  )
}

function Library({ ctrl }: { ctrl: CanvasController }) {
  const { relay } = useServices()
  const doc = useDoc()
  const [index, setIndex] = useState<LibraryIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    relay.library(AGENCY_SHELF).then(setIndex, (e) => setError(errText(e)))
  }, [relay])
  const importKey = async (key: string) => {
    setBusy(key)
    setError(null)
    try {
      await ctrl.importEntry(await relay.libraryEntry(key, undefined, AGENCY_SHELF))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="ad-body">
      {error && <div role="alert" className="ad-error">{error}</div>}
      {!index && !error && <p className="ad-empty">Loading…</p>}
      {index && !index.keys.length && <p className="ad-empty">Nothing yet. Publish a reference from This project to use it in your other projects.</p>}
      {index?.keys.map((k) => {
        const mine = keyNamed(doc, k.key)
        const newer = mine?.library && mine.library.ver < k.ver
        return (
          <div key={k.key} className="ad-key">
            <div className="ad-thumbs"><LibraryCover url={k.cover?.url} sha={k.cover?.sha256} /></div>
            <div className="ad-keytext">
              <span className="pt-ref">@{k.key}</span>
              <span className="ad-meta">v{k.ver} · published by @{k.by}{k.variants?.length ? ` · ${k.variants.length} views` : ''}</span>
              <span className="ad-actions">
                <button type="button" className="btn xs" disabled={!!busy || (!!mine?.library && !newer)} onClick={() => void importKey(k.key)}>
                  {busy === k.key ? 'Bringing in…' : mine?.library ? (newer ? `Update to v${k.ver}` : 'Up to date') : mine ? 'Bring in (replaces yours)' : 'Bring in'}
                </button>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LibraryCover({ url, sha }: { url?: string; sha?: string }) {
  const local = useBlobUrl(sha)
  return <span className="ad-thumb">{(local ?? url) && <img src={local ?? url} alt="" />}</span>
}
