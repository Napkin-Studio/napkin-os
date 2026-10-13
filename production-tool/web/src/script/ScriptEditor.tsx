// The Script editor (ui-behaviour 3.10, artboards 6 and 7; features/script-editor.clan).
//
// Full screen at /production/p/:project/script/:scriptId?shot=<shotId>, over the stages: the
// canvas stays mounted underneath, so jobs keep landing. '← Storyboard', browser Back and
// ⌘[ return; Esc never leaves. One row model (compose.ts) under both views; the current shot
// and any focused fragment mount an editor bound to its own fragment, the rest render static.
// Typing is LocalUndo steps (typing.ts); every structural change is one step (edits.ts).
// No chat anywhere (principle 10).

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useDoc, useJobsTick, useRoute, useRouter, useServices, useUi } from '../app/context'
import { formatRoute, scriptRoute } from '../app/route'
import type { PMNode as PMNodeLike } from '../../../clan-store/src'
import type { Ask, CameraSize, ProductionDocument, Scene, Shot } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { deleteFrom, removeShot } from '../doc/remove'
import { askedShot, planOrJoin, runningPlan } from '../jobs/plan'
import { editShot } from '../jobs/stale'
import { LOCAL_PERSON } from '../jobs/runner'
import type { ModelStore } from '../model/store'
import { openAsks, scriptText, staleList } from '../model/selectors'
import { answerShotAsk } from '../stages/storyboardEdits'
import { AgentAvatar } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { Float, MenuItem } from '../ui/Float'
import { HistoryPanel } from '../ui/History'
import { JobSlot } from '../ui/JobSlot'
import { UndoButtons } from '../ui/UndoButtons'
import { CaretChain, caretKey } from './caret'
import { composeScript, roughSeconds, storyboardsOf, type ComposedScript, type ScriptRow } from './compose'
import { addBeat, addScene, importFountain, insertShot, moveShotTo, setHeading, splitScene } from './edits'
import { refNames, TAB_NEXT, type KeyHooks } from './extensions'
import { FragmentEditor } from './FragmentEditor'
import { parseFountain } from './fountain'
import { useEditorTick } from './hooks'
import { Outline } from './Outline'
import { ShotEditor } from './ShotEditor'
import './script.css'

type Doc = ProductionDocument
type Focus = { key: string; editor: Editor | null } | null

const cameraWords = (s: Shot) => [s.camera.size, s.camera.movement ?? 'static'].map((x) => (x as CameraSize | string).replace(/_/g, ' ')).map((x, i) => (i === 0 ? x[0].toUpperCase() + x.slice(1) : x)).join(' · ')
const secs = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)} s`

function useMedia(query: string): boolean {
  const subscribe = useCallback((fn: () => void) => {
    if (typeof matchMedia !== 'function') return () => {}
    const m = matchMedia(query)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [query])
  return useSyncExternalStore(subscribe, () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false))
}

/** 'Saved', 'Saving…', or 'Offline, saved on this device'. */
function useSaved(store: ModelStore): string {
  const subscribe = useCallback((fn: () => void) => {
    const offs = [store.onSaving(fn), store.onChange(() => fn())]
    window.addEventListener('online', fn)
    window.addEventListener('offline', fn)
    return () => {
      for (const off of offs) off()
      window.removeEventListener('online', fn)
      window.removeEventListener('offline', fn)
    }
  }, [store])
  const get = () => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'Offline, saved on this device' : store.saving() ? 'Saving…' : 'Saved')
  return useSyncExternalStore(subscribe, get)
}

export function ScriptEditor({ scriptId }: { scriptId: string }) {
  const services = useServices()
  const { clan } = services
  const router = useRouter()
  const back = useCallback(() => {
    services.ui.update((u) => { u.stage = 'storyboard' })
    router.leave()
  }, [router, services.ui])
  if (!clan) {
    return (
      <div className="se" data-script-page="">
        <header className="se-top"><button className="btn sm ghost" onClick={back}>← Storyboard</button></header>
        <div className="se-empty" role="status">The Script editor needs this browser to keep the project's .clan, and it could not load here. Your script is safe; open it on another browser, or reload.</div>
      </div>
    )
  }
  return <ScriptPage store={clan} scriptId={scriptId} onBack={back} />
}

function ScriptPage({ store, scriptId, onBack }: { store: ModelStore; scriptId: string; onBack: () => void }) {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  useJobsTick()
  const route = useRoute()
  const router = useRouter()
  const phone = useMedia('(max-width: 599px)')
  const saved = useSaved(store)
  const view = ui.script?.[scriptId]?.view ?? 'screenplay'
  const pickedBoard = ui.script?.[scriptId]?.storyboard
  const composed = useMemo(() => composeScript(doc, scriptId, pickedBoard && doc.storyboards[pickedBoard] ? pickedBoard : undefined), [doc, scriptId, pickedBoard])
  const [current, setCurrent] = useState<string | undefined>(route.kind === 'script' ? route.shot : undefined)
  const [active, setActive] = useState<string | null>(null)
  const [focus, setFocus] = useState<Focus>(null)
  const [history, setHistory] = useState(false)
  const [sheet, setSheet] = useState<'outline' | 'facts' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [chain] = useState(() => new CaretChain())
  const person = ui.me ? `human:${ui.me.participantId}` : LOCAL_PERSON

  const say = useCallback((m: string) => {
    setNotice(m)
    setTimeout(() => setNotice((x) => (x === m ? null : x)), 6000)
  }, [])
  const attempt = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }, [])

  // The caret's shot is the URL's focus (?shot=), so a link opens on it.
  useEffect(() => {
    if (route.kind !== 'script') return
    if ((route.shot ?? undefined) !== current) router.replace(scriptRoute(route.projectId, route.scriptId, current))
  }, [current, route, router])

  // ⌘[ / Ctrl+[ goes back; Esc never leaves (ui-behaviour 2.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === '[') {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  // The caret chain, in script order; asking for a shot that is not mounted expands it.
  const keys = useMemo(() => chainKeys(composed, current), [composed, current])
  useEffect(() => {
    chain.setOrder(keys)
    chain.setWant((key) => {
      const [kind, id] = key.split(':')
      if (kind === 'shot' || kind === 'beat') {
        const shotId = kind === 'beat' ? doc.beats[id]?.shot_id : id
        if (shotId) setCurrent(shotId)
      } else if (kind === 'scene') setActive(key)
    })
  }, [chain, keys, doc])

  const sb = composed?.storyboard
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  const planning = runningPlan(doc)
  const behind = !!sb && (staleList(doc).some((m) => m.target.kind === ('storyboard' as string) && m.target.id === sb.id)
    || (composed!.shots.length > 0 && Object.values(doc.scenes).some((s) => s.script_id === scriptId && !!s.text?.trim())))
  const plan = () => attempt(async () => {
    if (!scriptText(doc, scriptId).trim()) throw new Error('Write a line or two first.')
    const r = await planOrJoin(deps)
    if (r.joined) say('Dex is already planning these shots.')
  })

  const doImport = (file: File) => attempt(async () => {
    const parsed = parseFountain(await file.text())
    const r = await importFountain(store, scriptId, parsed)
    say([`Imported ${r.scenes} ${r.scenes === 1 ? 'scene' : 'scenes'}.`, r.dropped].filter(Boolean).join(' '))
  })

  if (!composed) {
    return (
      <div className="se" data-script-page="">
        <header className="se-top"><button className="btn sm ghost" onClick={onBack}>← Storyboard</button></header>
        <div className="se-empty" role="status">That script is not in this project any more.</div>
      </div>
    )
  }

  const hooksFor = (key: string, extra: Partial<KeyHooks> = {}): KeyHooks => ({
    out: (dir) => chain.move(key, dir),
    escape: () => {
      if (menu) {
        setMenu(false)
        return true
      }
      return false
    },
    ...extra,
  })
  const focusOn = (key: string) => (e: Editor | null) => {
    if (e) setFocus({ key, editor: e })
  }

  const empty = !composed.shots.length && Object.values(doc.scenes).every((s) => s.script_id !== scriptId || (!s.heading.trim() && !s.text?.trim()))
  const title = composed.script.title || 'Untitled script'

  const page = (
    <main className="se-page" aria-label={view === 'av' ? 'Video and audio' : 'Screenplay'}
      onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault() }}
      onDrop={(e) => {
        const f = [...e.dataTransfer.files].find((x) => /\.(fountain|spmd|txt)$/i.test(x.name))
        if (!f) return
        e.preventDefault()
        void doImport(f)
      }}>
      {!phone && <ElementBar focus={focus} composed={composed} store={store} chain={chain} onError={setError} />}
      {empty && !phone && <EmptyScript store={store} scriptId={scriptId} chain={chain} setActive={setActive} />}
      <div className="sp-rows">
        {composed.rows.map((r) => (
          <Row key={`${r.kind}:${r.id}`} row={r} doc={doc} store={store} chain={chain} readOnly={phone}
            current={current} active={active} setCurrent={setCurrent} setActive={setActive}
            hooksFor={hooksFor} focusOn={focusOn} say={say} onError={setError} />
        ))}
      </div>
      {!phone && <KeysLegend />}
    </main>
  )

  return (
    <div className={`se ${sheet ? `sheet-${sheet}` : ''}`} data-script-page="" data-view={view}>
      <header className="se-top">
        <button className="btn sm ghost" onClick={onBack} title="Back to the storyboard (⌘[)">← Storyboard</button>
        <span className="se-title"><b>Script</b> · {title}</span>
        <span className={`se-saved ${saved === 'Saved' ? '' : 'busy'}`} role="status">{saved}</span>
        <span className="spacer" />
        {!phone && (
          <span className="se-switch" role="group" aria-label="View">
            <button className={`chip ${view === 'screenplay' ? 'on' : ''}`} aria-pressed={view === 'screenplay'} onClick={() => uiStore.update((u) => { u.script = { ...u.script, [scriptId]: { ...u.script?.[scriptId], view: 'screenplay' } } })}>Screenplay</button>
            <button className={`chip ${view === 'av' ? 'on' : ''}`} aria-pressed={view === 'av'} disabled title="Video · Audio comes next" onClick={() => uiStore.update((u) => { u.script = { ...u.script, [scriptId]: { ...u.script?.[scriptId], view: 'av' } } })}>Video · Audio</button>
          </span>
        )}
        {storyboardsOf(doc, scriptId).length > 1 && (
          <label className="se-from">Shots from
            <select className="select xs" value={sb?.id ?? ''} onChange={(e) => uiStore.update((u) => { u.script = { ...u.script, [scriptId]: { view, ...u.script?.[scriptId], storyboard: e.target.value } } })}>
              {storyboardsOf(doc, scriptId).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
        )}
        {!phone && <UndoButtons />}
        <button className={`btn sm ${history ? 'on' : ''}`} aria-pressed={history} onClick={() => setHistory((h) => !h)} title="Every step, who made it and why">History</button>
        <button ref={menuRef} className={`btn sm icon ${menu ? 'on' : ''}`} aria-label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
        <Float anchor={menuRef} open={menu} onClose={() => setMenu(false)} align="end" label="More">
          {!phone && <MenuItem icon="⇪" onSelect={() => { setMenu(false); fileRef.current?.click() }}>Import Fountain…</MenuItem>}
          <MenuItem icon="🔗" onSelect={() => {
            setMenu(false)
            const url = new URL(formatRoute(route), location.origin).href
            void navigator.clipboard?.writeText(url).then(() => say('Link copied.'), () => say(url))
          }}>Copy link to this</MenuItem>
        </Float>
        {!phone && (
          <button className="btn sm primary" disabled={!sb || !!planning} onClick={() => void plan()}>
            {planning ? 'Planning…' : behind ? 'Update storyboard' : 'Plan shots'}
          </button>
        )}
        <input ref={fileRef} type="file" accept=".fountain,.spmd,.txt,text/plain" hidden onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void doImport(f)
        }} />
      </header>
      {phone && <div className="banner" role="status">You can watch and leave notes here. Open on a laptop or iPad to edit.</div>}
      {(notice || error) && (
        <div className={`se-line ${error ? 'bad' : ''}`} role={error ? 'alert' : 'status'}>
          {error ?? notice}
          <button className="btn xs ghost" onClick={() => { setError(null); setNotice(null) }}>OK</button>
        </div>
      )}
      <div className="se-body">
        {!phone && (
          <>
            <button className="se-handle left" aria-expanded={sheet === 'outline'} onClick={() => setSheet(sheet === 'outline' ? null : 'outline')}>Outline</button>
            <Outline rows={composed.rows} current={current} disabled={!!planning}
              onShot={(id) => { setCurrent(id); setSheet(null); chain.focus(caretKey('shot', id), 'end') }}
              onScene={(id) => { setSheet(null); chain.focus(caretKey('heading', id), 'end') }}
              onMove={(id, place) => void attempt(() => moveShotTo(store, id, place))}
              writer={(w) => <WriterMark writer={w} person={person} />}
              footer={<KeysLegend compact />} />
          </>
        )}
        {page}
        {!phone && (
          <>
            <button className="se-handle right" aria-expanded={sheet === 'facts'} onClick={() => setSheet(sheet === 'facts' ? null : 'facts')}>Facts</button>
            <Facts composed={composed} doc={doc} current={current} planning={planning} person={person} onError={setError} />
          </>
        )}
        {history && <HistoryPanel store={store} onClose={() => setHistory(false)} />}
      </div>
    </div>
  )
}

/** The chain's keys in script order: a scene's heading and text, a shot, the current shot's beats. */
function chainKeys(c: ComposedScript | null, current?: string): string[] {
  if (!c) return []
  const out: string[] = []
  for (const r of c.rows) {
    if (r.kind === 'scene') out.push(caretKey('heading', r.id), caretKey('scene', r.id))
    else if (r.kind === 'shot' || r.kind === 'end_card') out.push(caretKey('shot', r.id))
    else if (r.kind === 'beat' && r.shotId === current) out.push(caretKey('beat', r.id))
  }
  return out
}

interface RowProps {
  row: ScriptRow
  doc: Doc
  store: ModelStore
  chain: CaretChain
  readOnly: boolean
  current?: string
  active: string | null
  setCurrent(id: string | undefined): void
  setActive(key: string | null): void
  hooksFor(key: string, extra?: Partial<KeyHooks>): KeyHooks
  focusOn(key: string): (e: Editor | null) => void
  say(m: string): void
  onError(m: string | null): void
}

function Row(p: RowProps) {
  const { row } = p
  if (row.kind === 'scene') return <SceneRow {...p} scene={row.scene} number={row.number} />
  if (row.kind === 'shot' || row.kind === 'end_card') return <ShotRow {...p} shot={row.shot} number={row.number} start={row.start_s} end={row.kind === 'end_card'} />
  if (row.kind === 'beat' && row.shotId === p.current) return <BeatRow {...p} beatId={row.id} />
  return null
}

/** A scene: its heading (one line, a field) and the text no shot owns yet (live text). */
function SceneRow({ scene, number, doc, store, chain, readOnly, active, setActive, hooksFor, focusOn, say, onError }: RowProps & { scene: Scene; number: number }) {
  const key = caretKey('scene', scene.id)
  const headingKey = caretKey('heading', scene.id)
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => chain.register(headingKey, {
    focus: (where) => {
      const el = input.current
      if (!el) return
      el.focus()
      const at = where === 'start' ? 0 : el.value.length
      el.setSelectionRange(at, at)
    },
  }), [chain, headingKey])
  const editing = active === key
  const hasText = !!(scene.prose?.content?.length || scene.text?.trim())
  const sceneHooks = hooksFor(key, {
    sceneHeading: (heading, blockIndex) => {
      void splitScene(store, scene.id, blockIndex, heading).then((id) => {
        setActive(caretKey('scene', id))
        chain.focus(caretKey('scene', id), 'start')
      }, (e) => onError(e instanceof Error ? e.message : 'That scene could not be made.'))
      return true
    },
    pasteScript: (text) => {
      const parsed = parseFountain(text)
      if (!parsed.scenes.some((s) => s.heading)) return false
      void importFountain(store, scene.script_id, parsed).then((r) => say(`Pasted ${r.scenes} ${r.scenes === 1 ? 'scene' : 'scenes'}.${r.dropped ? ` ${r.dropped}` : ''}`), (e) => onError(e instanceof Error ? e.message : 'That paste could not be kept.'))
      return true
    },
    lineBeat: () => false,
  })
  return (
    <section className="sp-scene" aria-label={`Scene ${number}`}>
      <input ref={input} className="sp-heading" aria-label={`Scene ${number} heading`} placeholder="INT. PLACE - DAY" readOnly={readOnly}
        value={draft ?? scene.heading}
        onFocus={() => setDraft(scene.heading)}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value)
          void setHeading(store, scene.id, e.target.value)
        }}
        onKeyDown={(e) => {
          const el = e.currentTarget
          if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey) || (e.key === 'ArrowDown')) {
            e.preventDefault()
            setActive(key)
            chain.focus(key, 'start')
          } else if ((e.key === 'ArrowUp' && el.selectionStart === 0) || (e.key === 'Tab' && e.shiftKey)) {
            if (chain.move(headingKey, 'up')) e.preventDefault()
          }
        }} />
      {editing && !readOnly ? (
        <FragmentEditor store={store} kind="scene" id={scene.id} label={`Scene ${number}: unplanned script`} className="sp-text"
          chain={chain} chainKey={key} keys={sceneHooks} onEditor={focusOn(key)}
          placeholder={(type, i) => (i === 0 && type === 'action' ? 'Write what happens. INT. or EXT. starts a scene; Tab for Character.' : '')}
          onNotice={say} />
      ) : (
        <>
          {!readOnly && <MountOnFocus chain={chain} chainKey={key} />}
          {hasText && (
            <div className="sp-static" role="button" tabIndex={-1} aria-label={`Edit scene ${number}`}
              onClick={() => { if (!readOnly) { setActive(key); chain.focus(key, 'end') } }}>
              <StaticProse prose={scene.prose as { content?: PMNodeLike[] } | undefined} doc={doc} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** A placeholder in the chain for a fragment that is not mounted: focusing it asks the page to mount it
 *  (CaretChain's want), and the real editor takes the caret when it registers. */
function MountOnFocus({ chain, chainKey }: { chain: CaretChain; chainKey: string }) {
  useEffect(() => chain.register(chainKey, {}), [chain, chainKey])
  return null
}

/** A fragment's prose as static screenplay, mentions under their current names. */
function StaticProse({ prose, doc }: { prose?: { content?: PMNodeLike[] }; doc: Doc }) {
  const names = refNames(doc)
  const inline = (nodes?: PMNodeLike[]): ReactNode[] => (nodes ?? []).map((n, i) => {
    if (n.type === 'text') return <span key={i}>{n.text}</span>
    if (n.type === 'hardBreak') return <br key={i} />
    if (n.type === 'mention') {
      const r = names[String(n.attrs?.id ?? '')]
      return r ? <span key={i} className="mention">@{r.variant ? `${r.key}_${r.variant}` : r.key}</span> : <span key={i} className="mention unknown">@{String(n.attrs?.label ?? '')}</span>
    }
    return null
  })
  return <>{(prose?.content ?? []).map((b, i) => <p key={i} data-type={b.type}>{inline(b.content)}</p>)}</>
}

/** A shot: one line when collapsed; the current shot expands to its action and Direction, then its beats. */
function ShotRow({ shot, number, start, end, store, chain, readOnly, current, setCurrent, hooksFor, focusOn, onError }: RowProps & { shot: Shot; number: number; start: number; end: boolean }) {
  const key = caretKey('shot', shot.id)
  const open = current === shot.id
  const docStore = useServices().doc
  if (!open || readOnly) {
    return (
      <div className={`sp-shot collapsed ${end ? 'end' : ''}`}>
        {!readOnly && <MountOnFocus chain={chain} chainKey={key} />}
        <button className="sp-shotline" onClick={() => { if (!readOnly) { setCurrent(shot.id); chain.focus(key, 'end') } }} aria-label={`Shot ${number}: open`}>
          <span className="sp-shotno">{end ? 'END CARD' : `SHOT ${number}`}</span>
          <span className="sp-chip">{cameraWords(shot)}</span>
          <span className="sp-oneline">{(shot.action ?? '').split('\n')[0] || <i className="faint">No action yet</i>}</span>
          <span className="sp-len">{secs(shot.duration_s)}</span>
        </button>
        {readOnly && (shot.direction || shot.action) && <div className="sp-static"><p data-type="action">{shot.action}</p>{shot.direction && <p data-type="direction">{shot.direction}</p>}</div>}
      </div>
    )
  }
  const shotHooks = hooksFor(key, {
    lineBeat: () => {
      void addBeat(store, shot.id, 'line', { at_s: 0 }).then((id) => chain.focus(caretKey('beat', id), 'start'), (e) => onError(e instanceof Error ? e.message : 'That line could not be added.'))
      return true
    },
  })
  return (
    <div className={`sp-shot open ${end ? 'end' : ''}`}>
      <div className="sp-shothead">
        <span className="sp-shotno">{end ? 'END CARD' : `SHOT ${number}`}</span>
        <span className="sp-chip" title="Camera: change it in the storyboard">{cameraWords(shot)}</span>
        <span className="faint">at {secs(start)}</span>
        <span className="spacer" />
        <label className="sp-dur">
          <input className="input xs" type="number" min={1} max={10} step={0.5} aria-label={`Shot ${number} seconds`} value={shot.duration_s}
            onChange={(e) => void updateDoc(docStore, (d) => editShot(d, shot.id, { duration_s: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }), 'edit shot')} />
          <span className="faint">s</span>
        </label>
      </div>
      <ShotEditor store={store} shotId={shot.id} name={`Shot ${number}`} chain={chain} chainKey={key} keys={shotHooks}
        onEditor={focusOn(key)} />
      <div className="sp-beatadd">
        <button className="linkbtn" onClick={() => void addBeat(store, shot.id, 'line', { at_s: 0 }).then((id) => chain.focus(caretKey('beat', id), 'start'), (e) => onError(e instanceof Error ? e.message : 'That line could not be added.'))}>+ Line</button>
      </div>
    </div>
  )
}

/** A beat of the current shot: a line (speaker, then the words) or another kind, with its time. */
function BeatRow({ beatId, doc, store, chain, readOnly, hooksFor, focusOn, say }: RowProps & { beatId: string }) {
  const beat = doc.beats[beatId]
  const docStore = useServices().doc
  const [speaker, setSpeaker] = useState<string | null>(null)
  if (!beat) return null
  const key = caretKey('beat', beatId)
  const at = `at 0:${String(Math.floor(beat.at_s)).padStart(2, '0')}${beat.at_s % 1 ? '.5' : ''}`
  return (
    <div className={`sp-beat kind-${beat.kind}`}>
      <span className="sp-pill" title="When it happens, in the shot">{at}</span>
      {beat.kind === 'line' && (
        <input className="sp-speaker" aria-label="Who speaks" placeholder="WHO" readOnly={readOnly}
          value={speaker ?? beat.speaker ?? ''}
          onFocus={() => setSpeaker(beat.speaker ?? '')}
          onBlur={() => setSpeaker(null)}
          onChange={(e) => {
            setSpeaker(e.target.value.toUpperCase())
            void docStore.change((d) => { if (d.beats[beatId]) d.beats[beatId].speaker = e.target.value.toUpperCase().slice(0, 60) || undefined }, { action: `set beats[${beatId}] speaker`, coalesce: `speaker:${beatId}` })
          }} />
      )}
      <FragmentEditor store={store} kind="beat" id={beatId} label={beat.kind === 'line' ? 'Line' : `${beat.kind} beat`} className="sp-beattext"
        chain={chain} chainKey={key} keys={hooksFor(key)} onEditor={focusOn(key)} onNotice={say} readOnly={readOnly}
        placeholder={beat.kind === 'line' ? 'What they say…' : 'What happens…'} />
    </div>
  )
}

/** The element bar (Trelby's): Scene, Action, Character, Dialogue, Shot, with a hint for the next one. */
function ElementBar({ focus, composed, store, chain, onError }: { focus: Focus; composed: ComposedScript; store: ModelStore; chain: CaretChain; onError: (m: string | null) => void }) {
  useEditorTick(focus?.editor ?? null)
  const editor = focus?.editor && !focus.editor.isDestroyed ? focus.editor : null
  const [kind, id] = (focus?.key ?? ':').split(':')
  const block = editor?.state.selection.$from.parent.type.name
  const blockIndex = editor ? editor.state.selection.$from.index(0) : 0
  const now = kind === 'scene' ? block : kind === 'shot' ? (block === 'direction' ? 'direction' : 'action') : kind === 'beat' ? 'dialogue' : undefined
  const next = kind === 'scene' && block ? TAB_NEXT[block] : kind === 'shot' && block === 'action' ? 'direction' : undefined
  const run = (fn: () => Promise<unknown>) => {
    onError(null)
    fn().catch((e) => onError(e instanceof Error ? e.message : 'That did not work.'))
  }
  const sceneOf = () => (kind === 'scene' ? id : kind === 'shot' ? store.get().shots[id]?.scene_id : undefined)
  const setType = (t: string) => {
    if (kind === 'scene' && editor) editor.chain().focus().setNode(t).run()
    else if (kind === 'shot' && t !== 'action') run(() => addBeat(store, id, 'line', { at_s: 0 }).then((b) => chain.focus(caretKey('beat', b), 'start')))
    else if (kind === 'shot' && editor) editor.commands.focus()
  }
  const items: { t: string; label: string; act: () => void }[] = [
    { t: 'scene', label: 'Scene', act: () => {
      if (kind === 'scene' && editor) {
        const line = editor.state.selection.$from.parent.textContent.trim()
        run(() => splitScene(store, id, blockIndex, line.toUpperCase()).then((sid) => chain.focus(caretKey('heading', sid), 'end')))
      } else run(() => addScene(store, composed.script.id, sceneOf()).then((sid) => chain.focus(caretKey('heading', sid), 'end')))
    } },
    { t: 'action', label: 'Action', act: () => setType('action') },
    { t: 'character', label: 'Character', act: () => setType('character') },
    { t: 'dialogue', label: 'Dialogue', act: () => setType('dialogue') },
    { t: 'shot', label: 'Shot', act: () => {
      const sb = composed.storyboard
      if (!sb) return onError('This script drives no storyboard yet.')
      if (kind === 'scene') run(() => insertShot(store, { sceneId: id, blockIndex, storyboardId: sb.id }).then((sid) => chain.focus(caretKey('shot', sid), 'end')))
      else if (kind === 'shot') run(() => insertShot(store, { afterShotId: id }).then((sid) => chain.focus(caretKey('shot', sid), 'start')))
      else {
        const last = composed.shots.filter((s) => s.kind !== 'end_card').at(-1)
        if (last) run(() => insertShot(store, { afterShotId: last.id }).then((sid) => chain.focus(caretKey('shot', sid), 'start')))
      }
    } },
  ]
  return (
    <div className="se-elements" role="toolbar" aria-label="Element">
      {items.map((x) => (
        <button key={x.t} className={`chip ${now === x.t ? 'on' : ''}`} aria-pressed={now === x.t}
          onMouseDown={(e) => e.preventDefault()} onClick={x.act}>{x.label}</button>
      ))}
      {next && <span className="faint se-hint">Tab for {next === 'direction' ? 'Direction' : next[0].toUpperCase() + next.slice(1)}</span>}
    </div>
  )
}

/** An empty script: one line to write the idea in, or a script to paste. */
function EmptyScript({ store, scriptId, chain, setActive }: { store: ModelStore; scriptId: string; chain: CaretChain; setActive: (k: string | null) => void }) {
  const doc = useDoc()
  const first = Object.values(doc.scenes).filter((s) => s.script_id === scriptId).sort((a, b) => (a.rank < b.rank ? -1 : 1))[0]
  return (
    <div className="se-emptyline">
      <button className="sp-placeholder" onClick={() => {
        if (first) {
          setActive(caretKey('scene', first.id))
          chain.focus(caretKey('scene', first.id), 'start')
          return
        }
        void addScene(store, scriptId).then((id) => {
          setActive(caretKey('scene', id))
          chain.focus(caretKey('scene', id), 'start')
        })
      }}>Paste a script, or write the idea in a line.</button>
    </div>
  )
}

/** Who last wrote an item: You, a person's initials, or a crew figure. */
function WriterMark({ writer, person }: { writer?: string; person: string }) {
  if (!writer) return null
  if (writer === person) return <span className="wmark you" title="You wrote this last">You</span>
  if (writer === 'dex') return <span className="wmark" title={`${sayer('dex')} wrote this last`}><AgentAvatar agent="dex" size={20} decorative /></span>
  if (!writer.startsWith('human:')) return <span className="wmark crew" title={`${writer[0].toUpperCase()}${writer.slice(1)} wrote this last`}>{writer[0].toUpperCase()}</span>
  const who = writer.slice('human:'.length).replace(/^p_/, '')
  return <span className="wmark person" title="Someone else wrote this last">{who.slice(0, 2).toUpperCase()}</span>
}

/** The right-hand area: only facts about the script. */
function Facts({ composed, doc, current, planning, person, onError }: { composed: ComposedScript; doc: Doc; current?: string; planning?: string; person: string; onError: (m: string | null) => void }) {
  const { doc: docStore } = useServices()
  const sb = composed.storyboard
  const shots = composed.shots
  const target = sb?.target_s ?? composed.script.target_s
  const total = composed.total_s
  const rough = !shots.length ? roughSeconds(scriptText(doc, composed.script.id)) : null
  const est = rough ?? total
  const longest = shots.reduce<Shot | null>((m, s) => (!m || s.duration_s > m.duration_s ? s : m), null)
  const diff = Math.round((target - est) * 10) / 10
  const asks = openAsks(doc).filter((a) => !!askedShot(a) && shots.some((s) => s.id === askedShot(a)))
  const answer = (a: Ask, shotId: string, option: 'keep' | 'remove') => {
    onError(null)
    const go = option === 'keep'
      ? updateDoc(docStore, (d) => answerShotAsk(d, a.id, 'keep', person), `answer ${a.question.text}`)
      : deleteFrom(docStore, (d) => { answerShotAsk(d, a.id, 'remove', person); return removeShot(d, shotId) })
    void Promise.resolve(go).catch((e) => onError(e instanceof Error ? e.message : 'That did not work.'))
  }
  const names = refNames(doc)
  const used = new Map<string, number[]>()
  shots.forEach((s, i) => {
    for (const r of s.refs ?? []) used.set(r, [...(used.get(r) ?? []), i + 1])
  })
  return (
    <aside className="se-facts" aria-label="This script">
      <section>
        <div className="eyebrow">This script</div>
        <div>{shots.length} {shots.length === 1 ? 'shot' : 'shots'} · {sb?.ratio ?? '16:9'}</div>
      </section>
      <section aria-label="Length">
        <div className="se-meterline">{target} s target · {secs(est)} estimated{rough !== null ? ' (rough, from the words)' : ''}</div>
        {shots.length > 0 && (
          <div className="se-meter" role="img" aria-label={`${secs(total)} of ${target} s`}>
            {shots.map((s) => (
              <span key={s.id} className={`seg ${s.id === current ? 'cur' : ''}`} style={{ flexGrow: s.duration_s }} title={`${secs(s.duration_s)}`} />
            ))}
            <span className="target" style={{ left: `${Math.min(100, (target / Math.max(target, total)) * 100)}%` }} />
          </div>
        )}
        <div className="row" style={{ gap: 6 }}>
          {longest && shots.length > 2 && <span className="faint">longest: shot {shots.indexOf(longest) + 1} · {secs(longest.duration_s)}</span>}
          <span className="spacer" />
          {est > 0 && <span className={`pill ${diff >= 0 ? 'ok' : 'warn'}`}>{diff >= 0 ? `${secs(diff)} to spare` : `${secs(-diff)} over`}</span>}
        </div>
      </section>
      {planning && (
        <section aria-label="Dex at work">
          <div className="eyebrow">{sayer('dex')}</div>
          <div style={{ minHeight: 96, borderRadius: 12, overflow: 'hidden' }}><JobSlot jobId={planning} compact /></div>
        </section>
      )}
      {asks.length > 0 && (
        <section aria-label="Open asks">
          <div className="eyebrow">Open asks</div>
          {asks.map((a) => {
            const shotId = askedShot(a)!
            return (
              <div key={a.id} className="shotask" role="group">
                <AgentAvatar agent="dex" size={22} decorative />
                <span><b>{a.question.text}</b></span>
                <button className="btn xs" onClick={() => answer(a, shotId, 'keep')}>Keep</button>
                <button className="btn xs ghost" onClick={() => answer(a, shotId, 'remove')}>Remove</button>
              </div>
            )
          })}
        </section>
      )}
      <section aria-label="References">
        <div className="eyebrow">References · {used.size}</div>
        {[...used.entries()].map(([id, nums]) => {
          const n = names[id]
          const role = doc.refs[id]?.role ?? doc.keys[id]?.role
          return <div key={id} className="se-ref">@{n ? (n.variant ? `${n.key}_${n.variant}` : n.key) : 'gone'} · {role ?? ''} · <span className="faint">{nums.join(' ')}</span></div>
        })}
        {!used.size && <div className="faint">Name a picture on the canvas, then type @ in a shot.</div>}
      </section>
    </aside>
  )
}

function KeysLegend({ compact }: { compact?: boolean }) {
  return (
    <div className={`se-keys ${compact ? 'compact' : ''}`} aria-label="Keys">
      <span><kbd>Tab</kbd> next element</span>
      <span><kbd>@</kbd> a reference</span>
    </div>
  )
}
