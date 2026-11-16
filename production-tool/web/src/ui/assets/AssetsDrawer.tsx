// The Assets drawer (ui-behaviour 3.18; mock Assets): it takes the board rail's place while open,
// ⌥1…⌥9 keep jumping and "Boards ⌥0" brings the rail back. Tabs: This project (the named
// references by role, Make views, Publish, Clean up), Team library (the agency's shelf, Import),
// Upload, and From Napkin (spin-ins from Brief Maker and Research, none until that lands).

import { useEffect, useState } from 'react'
import { useConfig, useDoc, useServices, useUi } from '../../app/context'
import { OTHER_VIEWS, type CanvasController } from '../../canvas/controller'
import { AGENCY_SHELF, REF_ROLES, type KeyEntry, type LibraryIndex, type NamedRef, type RefRole, type View } from '../../contracts/types'
import { systemUpdate } from '../../doc/store'
import { sweep, unused } from '../../doc/gc'
import { deleteBlob } from '../../lib/blobs'
import { nameOf } from '../../lib/names'
import { keyNamed, keysList, refsList } from '../../model/selectors'
import { RelayError } from '../../relay'
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

export function AssetsDrawer({ ctrl, onClose, onBoards, onPicture, onCanvas }: {
  ctrl: CanvasController | null
  onClose: () => void
  /** "Boards ⌥0": close the drawer and bring the rail back. */
  onBoards: () => void
  /** Upload: the canvas's picture tool. */
  onPicture: () => void
  /** The pictures on the canvas now (Clean up keeps them). */
  onCanvas: string[]
}) {
  const doc = useDoc()
  const ui = useUi()
  const [tab, setTab] = useState<Tab>('project')
  const [query, setQuery] = useState('')
  const [card, setCard] = useState<string | null>(null)
  const keys = keysList(doc)
  const q = query.trim().toLowerCase()
  const shown = keys.filter((k) => !q || k.key.includes(q))
  return (
    <aside className="assets-drawer pt-panel" aria-label="Assets">
      <div className="ad-head">
        <b>Assets</b>
        <span className="pt-grow" />
        <button type="button" className="btn sm" onClick={onBoards} title="Back to the boards (⌥0)">Boards <span className="pt-mono">⌥0</span></button>
        <button type="button" className="ad-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className="ad-tabs" role="tablist" aria-label="Where from">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'project' && (
        <div className="ad-body">
          <label className="ad-search">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M9.3 9.3 L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            <input aria-label="Search this project" placeholder="Search this project" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          {!keys.length && <p className="ad-empty">Name a picture on the canvas (select it, then Name…) to keep it here. Your script uses the names.</p>}
          {GROUPS.map((g) => {
            const mine = shown.filter((k) => (g.roles === 'other' ? !['character', 'location', 'product'].includes(k.role) : g.roles.includes(k.role)))
            if (!mine.length) return null
            return (
              <section key={g.title}>
                <div className="pt-label ad-section"><span>{g.title}</span><span>{mine.length}</span></div>
                {mine.map((k) => <KeyCard key={k.key} k={k} ctrl={ctrl} onCard={() => setCard(k.key)} />)}
              </section>
            )
          })}
          <CleanUp onCanvas={onCanvas} />
        </div>
      )}
      {tab === 'library' && ctrl && <Library ctrl={ctrl} />}
      {tab === 'upload' && (
        <div className="ad-body">
          <p className="ad-empty">Pick a picture to put on the canvas. On a board it takes the board's role; anywhere else you name it.</p>
          <button type="button" className="btn primary" onClick={onPicture}>Add a picture</button>
        </div>
      )}
      {tab === 'napkin' && (
        <div className="ad-body">
          <p className="ad-empty">Nothing from Brief Maker or Research yet. When a brief or research is sent here, it waits under this tab until you bring it in.</p>
        </div>
      )}
      {card && keys.find((k) => k.key === card) && <CharacterCard k={keys.find((k) => k.key === card)!} onClose={() => setCard(null)} />}
      <div className="ad-foot">{ui.me?.team ? `Shared with everyone at ${ui.me.team}` : 'Your library is yours until you sign in with your agency'}</div>
    </aside>
  )
}

function KeyCard({ k, ctrl, onCard }: { k: KeyEntry; ctrl: CanvasController | null; onCard: () => void }) {
  const doc = useDoc()
  const { controls } = useConfig()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refs = refsList(doc).filter((r) => r.key === k.key)
  const front = refs.find((r) => r.variant === 'front')
  const missingViews = OTHER_VIEWS.filter((v: View) => !refs.some((r) => r.variant === v))
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof RelayError && e.error.code === 'conflict' ? e.message : errText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="ad-key">
      <div className="ad-thumbs">{refs.slice(0, 3).map((r) => <Thumb key={r.id} r={r} onShow={() => r.node && ctrl?.scrollTo(r.node)} />)}</div>
      <div className="ad-keytext">
        <button type="button" className="pt-ref ad-name" onClick={onCard} title="Open its card: views, voice, wardrobe, where it is used">@{k.key}</button>
        <span className="ad-meta">
          <select className="ad-role" aria-label={`What ${k.key} is`} value={k.role} onChange={(e) => ctrl?.setRole(k.key, e.target.value as RefRole)}>
            {REF_ROLES.map((r) => <option key={r} value={r}>{roleWord(r)}</option>)}
          </select>
          · {refs.length} {refs.length === 1 ? 'view' : 'views'}
        </span>
        {k.library && <span className="ad-meta">v{k.library.ver} · in the library</span>}
        <span className="ad-actions">
          {controls.views && front && missingViews.length > 0 && <button type="button" className="btn xs" disabled={!!busy || !ctrl} onClick={() => run('views', () => ctrl!.makeViews(k.key, missingViews))}>{busy === 'views' ? 'Starting…' : 'Make views'}</button>}
          <button type="button" className="btn xs" disabled={!!busy || !ctrl || !refs.length} title="Keep it in the team library, for your other projects" onClick={() => run('publish', () => ctrl!.publish(k.key))}>
            {busy === 'publish' ? 'Publishing…' : k.library ? `Publish v${k.library.ver + 1}` : 'Publish'}
          </button>
        </span>
        {error && <span role="alert" className="ad-error">{error}</span>}
      </div>
    </div>
  )
}

function Thumb({ r, onShow }: { r: NamedRef; onShow: () => void }) {
  const url = useBlobUrl(r.asset)
  return (
    <button type="button" className="ad-thumb" onClick={onShow} title={`@${nameOf(r)}: show it on the canvas`}>
      {url && <img src={url} alt="" />}
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
    <div className="ad-clean">
      <button type="button" className="btn sm ghost" onClick={start} title="Remove pictures nothing uses any more">Clean up</button>
      {cleaning && <InlineConfirm text={`Remove ${cleaning.length} unused ${cleaning.length === 1 ? 'picture' : 'pictures'} from this browser? Named images and anything on the canvas or in the storyboard stay.`} yes="Remove" onYes={() => void clean(cleaning)} onNo={() => setCleaning(null)} />}
      {note && <span className="ad-meta">{note}</span>}
    </div>
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
