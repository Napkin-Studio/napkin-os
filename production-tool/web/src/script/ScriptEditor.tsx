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
import { newUlidId, type PMNode as PMNodeLike } from '../../../clan-store/src'
import type { Ask, CameraSize, ProductionDocument, Scene, Shot, WriteIntent, WriteTarget } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { deleteFrom, removeBeat, removeScene, removeShot, sceneContents, sceneDeleteText, shotDeleteText, shotNeedsConfirm, type Removal } from '../doc/remove'
import { InlineConfirm } from '../ui/Undo'
import { askedShot, planOrJoin, runningPlan } from '../jobs/plan'
import { LOCAL_PERSON } from '../jobs/runner'
import type { ModelStore } from '../model/store'
import { framesOf, openAsks, scriptText, staleList, takesOf } from '../model/selectors'
import { answerShotAsk } from '../stages/storyboardEdits'
import { AgentAvatar } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { Float, MenuItem } from '../ui/Float'
import { HistoryPanel, type HistoryFocus } from '../ui/History'
import { AskOptions } from '../ui/AskCard'
import { UndoButtons } from '../ui/UndoButtons'
import { Account, BackButton, BarSep, NodeIcon } from '../ui/chrome/Bar'
import { nodeTitle } from '../ui/chrome/panels'
import { useProjectName } from '../ui/useDownload'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { NapkinLoader } from '../ui/loader/NapkinLoader'
import { useBlobUrl } from '../ui/hooks'
import { CAST, type CastKey } from '../ui/agents/cast'
import { CaretChain, caretKey } from './caret'
import { composeScript, roughSeconds, storyboardsOf, type ComposedScript, type ScriptRow } from './compose'
import { addBeat, addScene, importFountain, insertShot, moveShotTo, setHeading, setShotSeconds, splitScene } from './edits'
import { refNames, TAB_NEXT, type KeyHooks } from './extensions'
import { FragmentEditor } from './FragmentEditor'
import { parseFountain } from './fountain'
import { useEditorTick } from './hooks'
import { Outline } from './Outline'
import { SkyeBar, SuggestionCard } from './SkyeUI'
import { draftFromLine, fitSeconds, handsOff, NOT_HERE, SKYE, skyeState, startWrite } from './skye'
import { answerLocalAsk, nameAsks, settleNameAsks } from './nameAsks'
import { linkForMention } from '../text/mention/source'
import { scopeOf, scopeRefs, type ScopeItem } from '../model/scope'
import { AVView } from './AVView'
import { TimePill } from './TimePill'
import { nextMomentTime, setBeatTime, UNPLANNED_MOMENT } from './moments'
import { scriptMentionHooks } from './mentionHooks'
import type { MentionHooks } from './mentions'
import { ShotEditor } from './ShotEditor'
import './script.css'
import './look.css'
import { PromptStart } from '../ui/prompt/PromptStart'

type Doc = ProductionDocument
type Focus = { key: string; editor: Editor | null } | null
/** How a delete was asked for: Backspace in an empty fragment, ⌘⇧⌫, or a visible Delete control. */
export type RemoveHow = 'empty' | 'command' | 'button'
export type RemoveItem = (kind: 'scene' | 'shot' | 'beat', id: string, how: RemoveHow) => boolean

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
  // Back to where the editor was opened from (ui-behaviour 2.3): the canvas, or the Storyboard editor.
  const [from] = useState(() => services.ui.get().stage)
  const backTo = from === 'storyboard' ? 'Storyboard' : from === 'video' ? 'Video' : 'Canvas'
  const back = useCallback(() => {
    services.ui.update((u) => { u.stage = from })
    router.leave()
  }, [router, services.ui, from])
  if (!clan) {
    return (
      <div className="se" data-script-page="">
        <header className="ptbar se-top"><BackButton label={backTo} onClick={back} /></header>
        <div className="se-empty" role="status">The Script editor needs this browser to keep the project's .clan, and it could not load here. Your script is safe; open it on another browser, or reload.</div>
      </div>
    )
  }
  return <ScriptPage store={clan} scriptId={scriptId} onBack={back} backTo={backTo} />
}

function ScriptPage({ store, scriptId, onBack, backTo }: { store: ModelStore; scriptId: string; onBack: () => void; backTo: string }) {
  const projectName = useProjectName()
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
  const [historyFocus, setHistoryFocus] = useState<HistoryFocus | undefined>(undefined)
  const [sheet, setSheet] = useState<'outline' | 'facts' | null>(null)
  const [notice, setNotice] = useState<{ text: string; undo?: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ text: string; yes: string; go: () => void } | null>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [chain] = useState(() => new CaretChain())
  const person = ui.me ? `human:${ui.me.participantId}` : LOCAL_PERSON

  const say = useCallback((m: string, undo = false) => {
    const n = { text: m, undo }
    setNotice(n)
    setTimeout(() => setNotice((x) => (x === n ? null : x)), 8000)
  }, [])
  const mentions = useMemo(() => scriptMentionHooks(store, scriptId, (item) => say(`Linked @${item.name} to this script.`, true)), [store, scriptId, say])
  const attempt = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }, [])

  // Delete in the editor (ui-behaviour 3.10, 3.3 Delete; item 4): through the document's removal cascade
  // (doc/remove.ts), one undo step each, said with Undo. A shot with frames or clips, or a scene with shots,
  // asks first; Backspace in an empty fragment never deletes made work.
  const removeItem = useCallback<RemoveItem>((kind, id, how) => {
    const d = store.get()
    const c = composeScript(d, scriptId, pickedBoard && d.storyboards[pickedBoard] ? pickedBoard : undefined)
    const numberOf = (k: string) => c?.rows.find((r) => r.id === id && (r.kind === k || (k === 'shot' && r.kind === 'end_card')))
    const run = (fn: (x: Doc) => Removal, label: string) => {
      setConfirm(null)
      void attempt(async () => {
        await deleteFrom(docStore, fn)
        say(`Deleted ${label}.`, true)
      })
    }
    if (kind === 'beat') {
      const b = d.beats[id]
      if (!b) return false
      run((x) => removeBeat(x, id), b.kind === 'line' ? 'the line' : b.kind === 'vo' ? 'the voice-over line' : `the ${b.kind}`)
      return true
    }
    if (kind === 'shot') {
      if (!d.shots[id]) return false
      const row = numberOf('shot')
      const n = row && 'number' in row ? row.number : 0
      const label = d.shots[id].kind === 'end_card' ? 'the end card' : `shot ${n}`
      if (shotNeedsConfirm(d, id)) {
        if (how === 'empty') return false
        setConfirm({ text: shotDeleteText(n, framesOf(d, id).length, takesOf(d, id).length), yes: 'Delete shot', go: () => run((x) => removeShot(x, id), label) })
        return true
      }
      run((x) => removeShot(x, id), label)
      return true
    }
    const scene = d.scenes[id]
    if (!scene) return false
    const row = numberOf('scene')
    const n = row && 'number' in row ? row.number : 0
    const text = sceneDeleteText(n, sceneContents(d, id))
    if (how === 'empty' && (text || scene.heading.trim())) return false
    if (text) setConfirm({ text, yes: 'Delete scene', go: () => run((x) => removeScene(x, id), `scene ${n}`) })
    else run((x) => removeScene(x, id), `scene ${n}`)
    return true
  }, [store, scriptId, pickedBoard, docStore, attempt, say])

  // The caret's shot is the URL's focus (?shot=), so a link opens on it.
  useEffect(() => {
    if (route.kind !== 'script') return
    if ((route.shot ?? undefined) !== current) router.replace(scriptRoute(route.projectId, route.scriptId, current))
  }, [current, route, router])

  // An unknown @name becomes Skye's ask once the caret has left its shot, or after 3 s idle.
  const left = useRef<string | undefined>(undefined)
  useEffect(() => {
    const prev = left.current
    left.current = current
    if (prev && prev !== current) void settleNameAsks(store, scriptId, prev).catch(() => {})
  }, [current, store, scriptId])
  useEffect(() => {
    if (!current) return
    const t = setTimeout(() => void settleNameAsks(store, scriptId, current).catch(() => {}), 3000)
    return () => clearTimeout(t)
  }, [doc, current, store, scriptId])

  // Switching views keeps the caret's shot, and brings it into view.
  useEffect(() => {
    if (!current) return
    document.querySelector(`[data-shot="${current}"]`)?.scrollIntoView?.({ block: 'center' })
  }, [view, current])

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
  const planning = sb ? runningPlan(doc, sb.id) : undefined
  const skye = skyeState(doc, scriptId)
  const skyeDeps = { relay, doc: docStore, ui: uiStore, runner }
  const ask = (target: WriteTarget, intent: WriteIntent, opts: Parameters<typeof startWrite>[5] = {}) =>
    attempt(() => startWrite(skyeDeps, store, scriptId, target, intent, opts))
  const openWhy = useCallback((f: HistoryFocus) => {
    setHistoryFocus(f)
    setHistory(true)
  }, [])
  const docId = (() => {
    try {
      return store.documentId()
    } catch {
      return ''
    }
  })()
  const whyOf = (kind: 'scene' | 'shot', id: string, label: string) => () => openWhy({ label, addresses: [`${docId}#${kind}s[${id}]`] })
  // Skye's drafts on each item, for the person they are for (others see her figure).
  const drafts = (kind: WriteTarget['kind'], id: string) => Object.values(doc.suggestions)
    .filter((x) => x.target.kind === kind && x.target.id === id && (x.state === 'open' || x.state === 'stale'))
    .map((x) => (
      <SuggestionCard key={x.id} sug={x} store={store} me={person} currentProse={() => store.text.prose(kind, id)} onWhy={openWhy} say={say}
        askAgain={() => void ask(x.target, ui.jobs[x.job_id]?.request?.input.write?.intent ?? 'tighten')} />
    ))
  const behind = !!sb && (staleList(doc).some((m) => m.target.kind === ('storyboard' as string) && m.target.id === sb.id)
    || (composed!.shots.length > 0 && Object.values(doc.scenes).some((s) => s.script_id === scriptId && !!s.text?.trim())))
  const plan = () => attempt(async () => {
    if (!scriptText(doc, scriptId).trim()) throw new Error('Write a line or two first.')
    // The storyboard this script drives (more than one per project; features/canvas-nodes.clan).
    if (!sb) throw new Error('Link this script to a storyboard on the canvas first.')
    const r = await planOrJoin(deps, { storyboardId: sb.id })
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
        <header className="ptbar se-top"><BackButton label={backTo} onClick={onBack} /></header>
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

  const focusTarget: WriteTarget | null = (() => {
    const [k, id] = (focus?.key ?? ':').split(':')
    return k === 'scene' || k === 'shot' || k === 'beat' ? { kind: k, id } : null
  })()
  const empty = !composed.shots.length && Object.values(doc.scenes).every((s) => s.script_id !== scriptId || (!s.heading.trim() && !s.text?.trim()))
  const title = nodeTitle(composed.script.title, 'Script', projectName)

  const page = (
    <main className="se-page" aria-label={view === 'av' ? 'Video and audio' : 'Screenplay'}
      onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault() }}
      onDrop={(e) => {
        const f = [...e.dataTransfer.files].find((x) => /\.(fountain|spmd|txt)$/i.test(x.name))
        if (!f) return
        e.preventDefault()
        void doImport(f)
      }}>
      {!phone && view === 'screenplay' && <ElementBar focus={focus} composed={composed} store={store} chain={chain} onError={setError} say={say} />}
      {view === 'av' && !phone ? (
        <AVView composed={composed} doc={doc} store={store} chain={chain} current={current} setCurrent={(id) => setCurrent(id)}
          mentions={mentions} say={say} onError={setError} disabled={!!planning} onRemove={removeItem} />
      ) : <div className="sp-rows">
        {empty && !phone && <PromptStart kind="script" nodeId={scriptId} place="editor" />}
        {composed.rows.map((r) => (
          <Row key={`${r.kind}:${r.id}`} row={r} doc={doc} store={store} chain={chain} readOnly={phone}
            current={current} active={active} setCurrent={setCurrent} setActive={setActive} mentions={mentions} drafts={drafts} whyOf={whyOf}
            onDraft={empty ? (sceneId) => void attempt(() => draftFromLine(skyeDeps, store, scriptId, sceneId)) : undefined}
            hooksFor={hooksFor} focusOn={focusOn} say={say} onError={setError} onRemove={removeItem} />
        ))}
      </div>}
      {!phone && (
        <SkyeBar editor={focus?.editor ?? null} target={focusTarget} seconds={focusTarget ? fitSeconds(doc, scriptId, focusTarget) : 0}
          handsOff={!!focusTarget && handsOff(doc, focusTarget)} off={skye.off} quota={skye.quota} working={!!skye.working}
          onStart={(intent, opts) => focusTarget && void ask(focusTarget, intent, opts)} />
      )}
    </main>
  )

  return (
    <div className={`se ${sheet ? `sheet-${sheet}` : ''}`} data-script-page="" data-view={view}>
      <header className="ptbar se-top">
        <BackButton label={backTo} onClick={onBack} />
        <BarSep />
        <NodeIcon kind="script" />
        <h1 className="pt-title">Script · {title}</h1>
        <span className={`pt-mono se-saved ${saved === 'Saved' ? '' : 'busy'}`} role="status">{saved}</span>
        {!phone && (
          <span className="pt-seg se-switch" role="group" aria-label="Script view">
            <button aria-pressed={view === 'screenplay'} onClick={() => uiStore.update((u) => { u.script = { ...u.script, [scriptId]: { ...u.script?.[scriptId], view: 'screenplay' } } })}>Screenplay</button>
            <button aria-pressed={view === 'av'} onClick={() => uiStore.update((u) => { u.script = { ...u.script, [scriptId]: { ...u.script?.[scriptId], view: 'av' } } })}>Video · Audio</button>
          </span>
        )}
        <span className="pt-grow" />
        {storyboardsOf(doc, scriptId).length > 1 && (
          <label className="se-from">Shots from
            <select className="select xs" value={sb?.id ?? ''} onChange={(e) => uiStore.update((u) => { u.script = { ...u.script, [scriptId]: { view, ...u.script?.[scriptId], storyboard: e.target.value } } })}>
              {storyboardsOf(doc, scriptId).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
        )}
        {!phone && <UndoButtons />}
        <button className={`btn ${history ? 'on' : ''}`} aria-pressed={history} onClick={() => { setHistoryFocus(undefined); setHistory((h) => !h) }} title="Every decision, who made it and why">History</button>
        <button ref={menuRef} className={`btn icon ${menu ? 'on' : ''}`} aria-label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
        <Float anchor={menuRef} open={menu} onClose={() => setMenu(false)} align="end" label="More">
          {!phone && <MenuItem icon="⇪" onSelect={() => { setMenu(false); fileRef.current?.click() }}>Import Fountain…</MenuItem>}
          <MenuItem icon="🔗" onSelect={() => {
            setMenu(false)
            const url = new URL(formatRoute(route), location.origin).href
            void navigator.clipboard?.writeText(url).then(() => say('Link copied.'), () => say(url))
          }}>Copy link to this</MenuItem>
        </Float>
        {!phone && (
          <button className="btn primary" disabled={!sb || !!planning} onClick={() => void plan()}>
            {planning ? 'Planning…' : behind ? 'Update storyboard' : 'Plan shots'}
          </button>
        )}
        <Account />
        <input ref={fileRef} type="file" accept=".fountain,.spmd,.txt,text/plain" hidden onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void doImport(f)
        }} />
      </header>
      {phone && <div className="banner" role="status">You can watch and leave notes here. Open on a laptop or iPad to edit.</div>}
      {confirm && (
        <div className="se-line se-confirm">
          <InlineConfirm text={confirm.text} yes={confirm.yes} onNo={() => setConfirm(null)} onYes={confirm.go} />
        </div>
      )}
      {(notice || error) && (
        <div className={`se-line ${error ? 'bad' : ''}`} role={error ? 'alert' : 'status'}>
          {error ?? notice?.text}
          {!error && notice?.undo && <button className="btn xs" onClick={() => { setNotice(null); void store.undo() }}>Undo</button>}
          <button className="btn xs ghost" onClick={() => { setError(null); setNotice(null) }}>OK</button>
        </div>
      )}
      <div className="se-body">
        {!phone && (
          <>
            <button className="se-handle left" aria-expanded={sheet === 'outline'} onClick={() => setSheet(sheet === 'outline' ? null : 'outline')}>Outline</button>
            <Outline rows={composed.rows} current={current} disabled={!!planning}
              onAddScene={() => void attempt(() => addScene(store, scriptId).then((id) => chain.focus(caretKey('heading', id), 'end')))}
              onShot={(id) => { setCurrent(id); setSheet(null); chain.focus(caretKey('shot', id), 'end') }}
              onScene={(id) => { setSheet(null); chain.focus(caretKey('heading', id), 'end') }}
              onMove={(id, place) => void attempt(() => moveShotTo(store, id, place))}
              writer={(w, item) => <WriterMark writer={w} person={person} onWhy={whyOf(item.kind, item.id, item.label)} />}
              footer={<KeysLegend compact />} />
          </>
        )}
        {page}
        {!phone && (
          <>
            <button className="se-handle right" aria-expanded={sheet === 'facts'} onClick={() => setSheet(sheet === 'facts' ? null : 'facts')}>Facts</button>
            <Facts composed={composed} doc={doc} current={current} planning={planning} person={person} onError={setError}
              skyeWorking={skye.working} skyeOff={skye.off}
              onLink={(refId) => {
                const link = linkForMention(doc, { id: refId, kind: 'ref' }, { kind: 'script', id: scriptId }, () => newUlidId('link'))
                if (link) void attempt(() => store.change((x) => { x.links[link.id] = link }, { action: `link refs[${refId}] to scripts[${scriptId}]` }).then(() => say(`Linked @${doc.refs[refId].key}_${doc.refs[refId].variant} to this script.`, true)))
              }}
              onNameAnswer={(askId, option) => void attempt(() => answerLocalAsk(store, askId, option, person, (shotId, name) => startWrite(skyeDeps, store, scriptId, { kind: 'shot', id: shotId }, 'cut_name', { name })))} />
          </>
        )}
        {history && <HistoryPanel key={historyFocus?.addresses.join() ?? 'all'} store={store} focus={historyFocus} onClose={() => { setHistory(false); setHistoryFocus(undefined) }} />}
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
  mentions: MentionHooks
  drafts(kind: WriteTarget['kind'], id: string): ReactNode
  whyOf(kind: 'scene' | 'shot', id: string, label: string): () => void
  onDraft?: (sceneId: string) => void
  onRemove: RemoveItem
}

function Row(p: RowProps) {
  const { row } = p
  if (row.kind === 'scene') return <SceneRow {...p} scene={row.scene} number={row.number} />
  if (row.kind === 'shot' || row.kind === 'end_card') return <ShotRow {...p} shot={row.shot} number={row.number} start={row.start_s} end={row.kind === 'end_card'} />
  if (row.kind === 'beat' && row.shotId === p.current) return <BeatRow {...p} beatId={row.id} />
  return null
}

/** A scene: its heading (one line, a field) and the text no shot owns yet (live text). */
function SceneRow({ scene, number, doc, store, chain, readOnly, active, setActive, hooksFor, focusOn, say, onError, mentions, drafts, onDraft, onRemove }: RowProps & { scene: Scene; number: number }) {
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
    enter: (editor) => {
      // An empty script's one line: Enter asks Skye for a draft from it, in place.
      if (!onDraft) return false
      const blocks = editor.state.doc.childCount
      const atEnd = editor.state.selection.$from.parentOffset === editor.state.selection.$from.parent.content.size
      if (blocks !== 1 || !atEnd || !editor.state.doc.textContent.trim()) return false
      void store.checkpointText().then(() => onDraft(scene.id))
      return true
    },
    moment: () => {
      say(UNPLANNED_MOMENT)
      return true
    },
    remove: (how) => {
      // An empty scene's text: back to its heading, or the scene goes when that is empty too.
      if (how === 'empty' && scene.heading.trim()) return chain.move(key, 'up')
      const took = onRemove('scene', scene.id, how)
      if (took) chain.move(headingKey, 'up')
      return took
    },
  })
  return (
    <section className="sp-scene" aria-label={`Scene ${number}`}>
      {!readOnly && <button type="button" className="sp-del" aria-label={`Delete scene ${number}`} title="Delete this scene (⌘⇧⌫)" onClick={() => onRemove('scene', scene.id, 'button')}>×</button>}
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
          } else if (e.key === 'Backspace' && !readOnly && (((e.metaKey || e.ctrlKey) && e.shiftKey) || (!el.value && !hasText))) {
            e.preventDefault()
            if (onRemove('scene', scene.id, e.shiftKey ? 'command' : 'empty')) chain.move(headingKey, 'up')
          }
        }} />
      {editing && !readOnly ? (
        <FragmentEditor store={store} kind="scene" id={scene.id} label={`Scene ${number}: unplanned script`} className="sp-text"
          chain={chain} chainKey={key} keys={sceneHooks} onEditor={focusOn(key)} mentions={mentions}
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
      {drafts('scene', scene.id)}
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
function ShotRow({ shot, number, start, end, store, chain, readOnly, current, setCurrent, hooksFor, focusOn, onError, mentions, drafts, onRemove }: RowProps & { shot: Shot; number: number; start: number; end: boolean }) {
  const key = caretKey('shot', shot.id)
  const open = current === shot.id
  const docStore = useServices().doc
  if (!open || readOnly) {
    return (
      <div className={`sp-shot collapsed ${end ? 'end' : ''}`} data-shot={shot.id}>
        {!readOnly && <MountOnFocus chain={chain} chainKey={key} />}
        <button className="sp-shotline" onClick={() => { if (!readOnly) { setCurrent(shot.id); chain.focus(key, 'end') } }} aria-label={`Shot ${number}: open`}>
          <span className="sp-shotno">{end ? 'END CARD' : `SHOT ${number}`}</span>
          <span className="sp-chip">{cameraWords(shot)}</span>
          <span className="sp-oneline">{(shot.action ?? '').split('\n')[0] || <i className="faint">No action yet</i>}</span>
          <span className="sp-len">{secs(shot.duration_s)}</span>
        </button>
        {readOnly && (shot.direction || shot.action) && <div className="sp-static"><p data-type="action">{shot.action}</p>{shot.direction && <p data-type="direction">{shot.direction}</p>}</div>}
        {!readOnly && drafts('shot', shot.id)}
      </div>
    )
  }
  const addMoment = () => void addBeat(store, shot.id, 'moment', { at_s: nextMomentTime(store.get(), shot.id) })
    .then((id) => chain.focus(caretKey('beat', id), 'start'), (e) => onError(e instanceof Error ? e.message : 'That moment could not be added.'))
  const shotHooks = hooksFor(key, {
    moment: () => {
      addMoment()
      return true
    },
    lineBeat: () => {
      void addBeat(store, shot.id, 'line', { at_s: 0 }).then((id) => chain.focus(caretKey('beat', id), 'start'), (e) => onError(e instanceof Error ? e.message : 'That line could not be added.'))
      return true
    },
    remove: (how) => {
      if (how === 'empty' && shotNeedsConfirm(store.get(), shot.id)) return false
      const took = onRemove('shot', shot.id, how)
      if (took) chain.move(key, 'up')
      return took
    },
  })
  return (
    <div className={`sp-shot open ${end ? 'end' : ''}`} data-shot={shot.id}>
      <div className="sp-shothead">
        <span className="sp-shotno">{end ? 'END CARD' : `SHOT ${number}`}</span>
        <span className="sp-chip" title="Camera: change it in the storyboard">{cameraWords(shot)}</span>
        <span className="faint">at {secs(start)}</span>
        <span className="spacer" />
        <label className="sp-dur">
          <input className="input xs" type="number" min={1} max={10} step={0.5} aria-label={`Shot ${number} seconds`} value={shot.duration_s}
            onChange={(e) => void setShotSeconds(docStore, shot.id, Number(e.target.value) || 1)} />
          <span className="faint">s</span>
        </label>
        <button type="button" className="btn xs ghost sp-delshot" aria-label={`Delete ${end ? 'the end card' : `shot ${number}`}`} title="Delete this shot (⌘⇧⌫)" onClick={() => onRemove('shot', shot.id, 'button')}>Delete shot</button>
      </div>
      <ShotEditor store={store} shotId={shot.id} name={`Shot ${number}`} chain={chain} chainKey={key} keys={shotHooks}
        onEditor={focusOn(key)} mentions={mentions} />
      {drafts('shot', shot.id)}
      <div className="sp-beatadd">
        <button className="linkbtn" onClick={addMoment}>+ Moment <kbd>⌥M</kbd></button>
        <button className="linkbtn" onClick={() => void addBeat(store, shot.id, 'line', { at_s: 0 }).then((id) => chain.focus(caretKey('beat', id), 'start'), (e) => onError(e instanceof Error ? e.message : 'That line could not be added.'))}>+ Line</button>
      </div>
    </div>
  )
}

/** A beat of the current shot: a line (speaker, then the words) or another kind, with its time. */
function BeatRow({ beatId, doc, store, chain, readOnly, hooksFor, focusOn, say, mentions, drafts, onRemove }: RowProps & { beatId: string }) {
  const beat = doc.beats[beatId]
  const docStore = useServices().doc
  const [speaker, setSpeaker] = useState<string | null>(null)
  if (!beat) return null
  const key = caretKey('beat', beatId)
  const shot = doc.shots[beat.shot_id]
  return (
    <div className={`sp-beat kind-${beat.kind}`}>
      <TimePill at={beat.at_s} duration={shot?.duration_s ?? 0} readOnly={readOnly}
        onSet={(t) => void Promise.resolve().then(() => updateDoc(docStore, (d) => setBeatTime(d, beatId, t), `move beats[${beatId}]`)).catch((e) => say(e instanceof Error ? e.message : 'That time could not be kept.'))} />
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
        chain={chain} chainKey={key} keys={hooksFor(key, { remove: (how) => { const took = onRemove('beat', beatId, how); if (took) chain.move(key, 'up'); return took } })} onEditor={focusOn(key)} onNotice={say} readOnly={readOnly} mentions={mentions}
        placeholder={beat.kind === 'line' ? 'What they say…' : 'What happens…'} />
      {!readOnly && <button type="button" className="sp-del" aria-label={beat.kind === 'line' ? 'Delete this line' : `Delete this ${beat.kind}`} title="Delete (⌘⇧⌫)" onClick={() => onRemove('beat', beatId, 'button')}>×</button>}
      {drafts('beat', beatId)}
    </div>
  )
}

/** The element bar (Trelby's): Scene, Action, Character, Dialogue, Shot, with a hint for the next one. */
function ElementBar({ focus, composed, store, chain, onError, say }: { focus: Focus; composed: ComposedScript; store: ModelStore; chain: CaretChain; onError: (m: string | null) => void; say: (m: string) => void }) {
  useEditorTick(focus?.editor ?? null)
  const editor = focus?.editor && !focus.editor.isDestroyed ? focus.editor : null
  const [kind, id] = (focus?.key ?? ':').split(':')
  const block = editor?.state.selection.$from.parent.type.name
  const blockIndex = editor ? editor.state.selection.$from.index(0) : 0
  const now = kind === 'scene' ? block : kind === 'shot' ? (block === 'direction' ? 'direction' : 'action') : kind === 'beat' ? 'dialogue' : undefined
  const next = kind === 'scene' && block ? TAB_NEXT[block] : kind === 'shot' && block === 'action' ? 'direction' : undefined
  const run = (fn: () => Promise<unknown>) => {
    onError(null)
    Promise.resolve().then(fn).catch((e) => onError(e instanceof Error ? e.message : 'That did not work.'))
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
    { t: 'moment', label: 'Moment', act: () => {
      const shotId = kind === 'shot' ? id : kind === 'beat' ? store.get().beats[id]?.shot_id : undefined
      if (!shotId) return say(UNPLANNED_MOMENT)
      run(() => addBeat(store, shotId, 'moment', { at_s: nextMomentTime(store.get(), shotId) }).then((b) => chain.focus(caretKey('beat', b), 'start')))
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

/** Who last wrote an item: You, a person's initials, or a crew figure. */
function WriterMark({ writer, person, onWhy }: { writer?: string; person: string; onWhy: () => void }) {
  if (!writer) return null
  const why = <span role="link" tabIndex={0} className="wmark-why" onClick={(e) => { e.stopPropagation(); onWhy() }}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onWhy() } }}>why?</span>
  let mark: ReactNode
  if (writer === person) mark = <span className="wmark you" title="You wrote this last">You</span>
  else if (writer in CAST) mark = <span className="wmark crew" title={`${sayer(writer as CastKey)} wrote this last`}><AgentFigure agent={writer as CastKey} size={16} decorative /><span className="name">{CAST[writer as CastKey].given}</span></span>
  else if (!writer.startsWith('human:')) mark = <span className="wmark crew" title={`${writer[0].toUpperCase()}${writer.slice(1)} wrote this last`}>{writer[0].toUpperCase()}</span>
  else mark = <span className="wmark person" title="Someone else wrote this last">{writer.slice('human:'.length).replace(/^p_/, '').slice(0, 2).toUpperCase()}</span>
  return <span className="wmarks">{mark}{why}</span>
}

/** The right-hand area: only facts about the script. */
function Facts({ composed, doc, current, planning, person, onError, skyeWorking, skyeOff, onNameAnswer, onLink }: {
  composed: ComposedScript; doc: Doc; current?: string; planning?: string; person: string; onError: (m: string | null) => void
  skyeWorking?: string; skyeOff: boolean; onNameAnswer: (askId: string, option: 'character' | 'extra' | 'cut') => void
  onLink: (refId: string) => void
}) {
  const { doc: docStore } = useServices()
  const sb = composed.storyboard
  const shots = composed.shots
  const target = sb?.target_s ?? composed.script.target_s
  const total = composed.total_s
  const rough = !shots.length ? roughSeconds(scriptText(doc, composed.script.id)) : null
  const est = rough ?? total
  const maxS = Math.max(0, ...shots.map((s) => s.duration_s))
  // The longest shot is named only when one shot is longer than every other.
  const longest = shots.filter((s) => s.duration_s === maxS).length === 1 ? shots.find((s) => s.duration_s === maxS) ?? null : null
  const diff = Math.round((target - est) * 10) / 10
  const asks = openAsks(doc).filter((a) => !!askedShot(a) && shots.some((s) => s.id === askedShot(a)))
  const answer = (a: Ask, shotId: string, option: 'keep' | 'remove') => {
    onError(null)
    const go = option === 'keep'
      ? updateDoc(docStore, (d) => answerShotAsk(d, a.id, 'keep', person), `answer ${a.question.text}`)
      : deleteFrom(docStore, (d) => { answerShotAsk(d, a.id, 'remove', person); return removeShot(d, shotId) })
    void Promise.resolve(go).catch((e) => onError(e instanceof Error ? e.message : 'That did not work.'))
  }
  // Everything linked into the script, and what its words name (model/scope.ts, ui-behaviour 3.16): the
  // same list the node's inputs strip and the send tray read, so a link made anywhere shows here at once.
  const scope = scopeOf(doc, composed.script.id)
  const refs = scopeRefs(scope)
  const inputs = scope.filter((i) => i.via !== 'mention' && i.kind !== 'ref' && i.kind !== 'key' && !(i.kind === 'storyboard' && i.via === 'upstream'))
  const numbers = (it: ScopeItem) => it.usedBy.map((id) => shots.findIndex((s) => s.id === id) + 1).filter((n) => n > 0)
  const inScope = new Set(refs.filter((i) => i.kind === 'ref' && i.via !== 'mention').map((i) => i.id))
  const unlinked = Object.values(doc.refs).filter((r) => !inScope.has(r.id))
  return (
    <aside className="se-facts" aria-label="This script">
      <section className="se-facthead">
        <b>This script</b>
        <span className="pt-mono">{shots.length} {shots.length === 1 ? 'shot' : 'shots'} · {sb?.ratio ?? '16:9'}</span>
      </section>
      <section aria-label="Length" className="se-lengthcard">
        <div className="se-meterline"><span className="pt-label">Length</span><span>{target} s target · {secs(est)} estimated</span></div>
        <div className="se-meter" role="img" aria-label={`${secs(est)} of ${target} s`}>
          {shots.map((s) => (
            <span key={s.id} className={`seg ${s.id === current ? 'cur' : ''} ${longest && s.id === longest.id && shots.length > 2 ? 'long' : ''}`} style={{ flexGrow: s.duration_s }} title={`${secs(s.duration_s)}`} />
          ))}
          {!shots.length && est > 0 && <span className="seg rough" style={{ flexGrow: est }} title="Rough, from the words" />}
          <span className="seg rest" style={{ flexGrow: Math.max(0, target - est) }} />
          <span className="target" style={{ left: `${Math.min(100, (target / Math.max(target, est || target)) * 100)}%` }} />
        </div>
        <div className="se-meterlabels"><span>0 s</span>{longest && shots.length > 2 ? <span>shot {shots.indexOf(longest) + 1} · {secs(longest.duration_s)}</span> : rough !== null && est > 0 ? <span>rough, from the words</span> : <span />}<span>{target} s</span></div>
        {est > 0 && <span className={`pt-pill ${diff >= 0 ? 'ok' : 'warn'}`}>{diff >= 0 ? `${secs(diff)} to spare` : `${secs(-diff)} over`}</span>}
      </section>
      {planning && (
        <section aria-label="Dex at work" className="se-atwork">
          <NapkinLoader work="plan" size={20} />
          <AgentFigure agent="dex" state="working" size={20} decorative />
          <span><span className="who">{sayer('dex')}:</span> I'm planning the shots from the script.</span>
        </section>
      )}
      {skyeWorking && (
        <section aria-label="Skye at work" className="se-atwork">
          <NapkinLoader work="plan" size={20} />
          <AgentFigure agent="skye" state="working" size={20} decorative />
          <span><span className="who">{SKYE}:</span> I'm writing that now.</span>
        </section>
      )}
      {skyeOff && <section className="faint" role="status">{NOT_HERE}</section>}
      {nameAsks(doc, composed.script.id).filter((a) => a.state === 'open').map((a) => (
        <section key={a.id} className="askcard open" role="group" aria-label={`${SKYE} asks: ${a.question.text}`} data-ask={a.id}>
          <div className="askcard-head"><AgentAvatar agent="skye" size={22} decorative /><span className="askcard-who">{SKYE}</span></div>
          <div className="askcard-q">{a.question.text}</div>
          {a.question.why && <div className="askcard-why faint">{a.question.why}</div>}
          <AskOptions q={a.question} disabled={false} onPick={(o) => onNameAnswer(a.id, o as 'character' | 'extra' | 'cut')} />
        </section>
      ))}
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
      {inputs.length > 0 && (
        <section aria-label="Inputs" className="se-inputs">
          <div className="pt-label">Inputs · {inputs.length}</div>
          <div className="se-inputchips">
            {inputs.map((i) => <span key={`${i.kind}:${i.id}`} className="se-inputchip" title={i.via === 'upstream' ? 'Linked to what drives this script' : undefined}>{i.label}</span>)}
          </div>
        </section>
      )}
      <section aria-label="References" className="se-refs">
        <div className="pt-label se-refhead"><span>References · {refs.length}</span><span>Shots</span></div>
        {refs.map((it) => {
          const nums = numbers(it)
          if (it.kind === 'unknown') {
            return (
              <div key={`unknown:${it.id}`} className="se-ref">
                <span className="se-refthumb missing" />
                <span className="pt-ref unknown">@{it.name}</span>
                <span className="pt-pill warn">no ref yet</span>
                <span className="se-refshots">{nums.join(' ')}</span>
              </div>
            )
          }
          const ref = it.kind === 'ref' ? doc.refs[it.id] : undefined
          const role = ref?.role ?? doc.keys[it.id]?.role
          return (
            <div key={`${it.kind}:${it.id}`} className={`se-ref ${it.via === 'mention' ? 'unlinked' : ''}`} data-via={it.via}>
              <RefThumb sha={it.asset} />
              <span className="pt-ref">@{it.name}</span>
              {role && <span className="pt-pill">{it.role !== role && it.via === 'link' ? it.role : role}</span>}
              {it.via === 'mention' && ref && <button type="button" className="linkbtn se-reflink" title="Named in the script but not linked to it" onClick={() => onLink(ref.id)}>Link</button>}
              {it.via === 'board' && <span className="faint se-refvia" title="On a board linked to this script">board</span>}
              <span className="se-refshots">{nums.join(' ')}</span>
            </div>
          )
        })}
        {!refs.length && <div className="faint">Name a picture on the canvas, then type @ in a shot.</div>}
        {unlinked.length > 0 && (
          <label className="se-link">
            <span className="linkbtn">+ Link a reference</span>
            <select className="select xs" aria-label="Link a reference to this script" value="" onChange={(e) => e.target.value && onLink(e.target.value)}>
              <option value="">Pick one…</option>
              {unlinked.map((r) => <option key={r.id} value={r.id}>@{r.key}_{r.variant} · {r.role}</option>)}
            </select>
          </label>
        )}
      </section>
    </aside>
  )
}

/** A reference's picture in the facts list. */
function RefThumb({ sha }: { sha?: string }) {
  const url = useBlobUrl(sha)
  return <span className="se-refthumb">{url && <img src={url} alt="" />}</span>
}

function KeysLegend({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="se-keycard" aria-label="Keys">
        <div className="pt-label">Keys</div>
        <div><span>Next element</span><kbd>Tab</kbd></div>
        <div><span>Mention a ref</span><kbd>@</kbd></div>
        <div><span>Add a moment</span><kbd>⌥M</kbd></div>
      </div>
    )
  }
  return (
    <div className="se-keys" aria-label="Keys">
      <span><kbd>Tab</kbd> next element</span>
      <span><kbd>@</kbd> a reference</span>
      <span><kbd>⌥M</kbd> a moment</span>
    </div>
  )
}
