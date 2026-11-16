// The Script editor (ui-behaviour 3.10, artboards 6 and 7; features/script-editor.clan).
//
// Full screen at /production/p/:project/script/:scriptId?shot=<shotId>, over the stages: the
// canvas stays mounted underneath, so jobs keep landing. '← Storyboard', browser Back and
// ⌘[ return; Esc never leaves. One row model (compose.ts) under both views; the current shot
// and any focused fragment mount an editor bound to its own fragment, the rest render static.
// Typing is LocalUndo steps (typing.ts); every structural change is one step (edits.ts).
// No chat anywhere (principle 10).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import { useDoc, useJobsTick, useRoute, useRouter, useServices, useUi } from '../app/context'
import { formatRoute, scriptRoute } from '../app/route'
import { type PMNode as PMNodeLike } from '../../../clan-store/src'
import type { CameraSize, ProductionDocument, Scene, Shot, WriteTarget } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { deleteFrom, removeBeat, removeScene, removeShot, sceneContents, sceneDeleteText, shotDeleteText, shotNeedsConfirm, type Removal } from '../doc/remove'
import { InlineConfirm } from '../ui/Undo'
import { planOrJoin, runningPlan } from '../jobs/plan'
import { LOCAL_PERSON } from '../jobs/runner'
import type { ModelStore } from '../model/store'
import { framesOf, shotsOf, staleList, takesOf } from '../model/selectors'
import { answerShotAsk } from '../stages/storyboardEdits'
import { sayer } from '../ui/agents/cast'
import { MenuItem } from '../ui/Float'
import { HistoryPanel, type HistoryFocus } from '../ui/History'
import { BackButton } from '../ui/chrome/Bar'
import { EditorBar } from '../ui/chrome/TopBars'
import { LinkIcon } from '../ui/chrome/MoreMenu'
import { nodeTitle } from '../ui/chrome/panels'
import { useProjectName } from '../ui/useDownload'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { CAST, type CastKey } from '../ui/agents/cast'
import { CaretChain, caretKey } from './caret'
import { composeScript, storyboardsOf, type ComposedScript, type ScriptRow } from './compose'
import { addBeat, addScene, importFountain, insertShot, moveShotTo, setHeading, setShotSeconds, splitScene } from './edits'
import { refNames, TAB_NEXT, type KeyHooks } from './extensions'
import { FragmentEditor } from './FragmentEditor'
import { parseFountain } from './fountain'
import { fountainOut, screenplayHtml } from './fountainOut'
import { useEditorTick } from './hooks'
import { Outline } from './Outline'
import { draftFromLine, NOT_HERE, pickedIdea, skyeAsks, skyeState, startWrite } from './skye'
import { answerLocalAsk, settleNameAsks } from './nameAsks'
import { SkyeBooth } from './SkyeBooth'
import { partAt, wholeScope, type SkyeScope } from './skyeBooth'
import { useBooth } from '../ui/booth/useBooth'
import { scriptFromLine } from '../jobs/prompt'
import { AVView } from './AVView'
import { TimePill } from './TimePill'
import { nextMomentTime, setBeatTime, UNPLANNED_MOMENT } from './moments'
import { scriptMentionHooks } from './mentionHooks'
import { typedSpans, type MentionHooks } from './mentions'
import { ShotEditor } from './ShotEditor'
import './script.css'
import './look.css'
import { PromptStart, ScriptWritePrompt } from '../ui/prompt/PromptStart'
import { canvasActions } from '../canvas/chrome/actions'
import { planFromScript, planShotsBlocked } from '../jobs/scriptVideo'
import { nextStep, videoOfScript as nextVideo, type NextAction } from './nextStep'
import { FrontButtons } from '../stages/FrontsNeeded'

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
  const [writing, setWriting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [chain] = useState(() => new CaretChain())
  const person = ui.me ? `human:${ui.me.participantId}` : LOCAL_PERSON

  const say = useCallback((m: string, undo = false) => {
    const n = { text: m, undo }
    setNotice(n)
    setTimeout(() => setNotice((x) => (x === n ? null : x)), 8000)
  }, [])
  const mentions = useMemo(() => scriptMentionHooks(store, scriptId, (item, words) => say(words === `@${item.name}` ? `Linked @${item.name} to this script.` : `Linked ${words} to this script so @${item.name} can be used.`, true)), [store, scriptId, say])
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
  const liveState = (id: string) => runner.liveInfo(id)?.state
  const skye = skyeState(doc, scriptId, liveState)
  // Skye's waiting questions: on the item the draft was for, else at the top of the page (owner 2026-10-15).
  // Skye's questions, drafts and edits wait in her Booth (features/script-freeform.clan), not on the page.
  const skyeQs = skyeAsks(doc, scriptId, (id) => ui.jobs[id]?.request?.input.write?.target, liveState)
  const skyeDeps = { relay, doc: docStore, ui: uiStore, runner }
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
  // Skye's drafts are cards in her Booth now (SkyeBooth.tsx): nothing of hers sits on the items.
  const drafts = (_kind: WriteTarget['kind'], _id: string): ReactNode => null

  // The Booth (ui/booth): hidden or shown, and the part of the page it came back on.
  const booth = useBooth('script')
  const [part, setPart] = useState<Extract<SkyeScope, { kind: 'part' }> | null>(null)
  const pagePoint = useRef<{ block: number; at: number } | null>(null)
  const focusNow = useRef(focus)
  useLayoutEffect(() => { focusNow.current = focus })
  const proseOf = useCallback((kind: 'scene' | 'shot' | 'beat', id: string) => store.text.prose(kind, id), [store])
  const resolvePart = useCallback(() => {
    const want = pagePoint.current
    const [k, id] = (focusNow.current?.key ?? ':').split(':')
    if (!want || !id || Date.now() - want.at > 1500) return
    const target: WriteTarget | null = k === 'scene' || k === 'heading' ? { kind: 'scene', id } : k === 'shot' || k === 'beat' ? { kind: k, id } : null
    const c = composeScript(store.get(), scriptId, pickedBoard && store.get().storyboards[pickedBoard] ? pickedBoard : undefined)
    if (!target || !c) return
    pagePoint.current = null
    setPart(partAt(store.get(), c, target, k === 'heading' ? 0 : want.block, proseOf))
  }, [store, scriptId, pickedBoard, proseOf])
  useEffect(() => { resolvePart() }, [focus?.key, resolvePart])
  // A click on the page while the Booth is hidden brings it back on that part (booth.clan B · Full).
  const onPagePoint = (e: React.MouseEvent) => {
    if (booth.shown || phone) return
    pagePoint.current = { block: blockIndexAt(e.target as Element), at: Date.now() }
    booth.setOpen(true)
    setTimeout(resolvePart, 0)
    setTimeout(resolvePart, 250)
  }
  // Hidden again: the part goes with it.
  if (!booth.shown && part) setPart(null)
  const behind = !!sb && (staleList(doc).some((m) => m.target.kind === ('storyboard' as string) && m.target.id === sb.id)
    || (composed!.shots.length > 0 && Object.values(doc.scenes).some((s) => s.script_id === scriptId && !!s.text?.trim())))
  // Plan shots needs words; with none it is off and says so (ui-behaviour 3.10).
  const blocked = planShotsBlocked(doc, scriptId)
  const plan = () => attempt(async () => {
    if (blocked) throw new Error('Write the script first: Plan shots reads its words.')
    // The storyboard this script drives (more than one per project; features/canvas-nodes.clan); with
    // none, Dex plans on a new one, made beside the script on the canvas with its drives link.
    if (sb) {
      const r = await planOrJoin(deps, { storyboardId: sb.id })
      if (r.joined) say('Dex is already planning these shots.')
      return
    }
    const r = await planFromScript(deps, scriptId)
    if (r.made) say('Dex is planning the shots on a new storyboard, beside this script on the canvas.')
  })
  // Out of the editor to the canvas, or to an editor over it (ui-behaviour 2.2).
  const goTo = (stage: 'character' | 'storyboard' | 'video', id?: string) => {
    uiStore.update((u) => {
      if (id && stage !== 'character') u.openNode = { ...u.openNode, [stage]: id }
      u.stage = stage
    })
    router.leave()
  }
  // Make video from the script (3.5): with the storyboard when Dex has planned it, else from the script
  // alone, and Dex asks on the new Video node how to make its clips. Then the canvas, where the node is.
  const makeVideo = () => attempt(async () => {
    const d = docStore.get()
    const withBoard = sb && shotsOf(d, sb.id).length ? sb.id : undefined
    const made = canvasActions.makeVideo({ scriptId, ...(withBoard ? { storyboardId: withBoard } : {}) })
    if (!made) throw new Error('Make video from the canvas: select this script there.')
    await made
    goTo('character')
  })
  const next = nextStep(doc, scriptId, sb?.id, behind)
  const onNext = (a: NextAction) => {
    if (a === 'plan' || a === 'update') return void plan()
    if (a === 'make-video') return void makeVideo()
    if (a === 'open-storyboard' && next && sb) return goTo('storyboard', sb.id)
    if (a === 'open-video') {
      const v = Object.values(doc.videos).find((x) => x.id === nextVideo(doc, scriptId, sb?.id))
      if (v) goTo('video', v.id)
    }
  }

  const doImport = (file: File) => attempt(async () => {
    const parsed = parseFountain(await file.text())
    const r = await importFountain(store, scriptId, parsed)
    say([`Imported ${r.scenes} ${r.scenes === 1 ? 'scene' : 'scenes'}.`, r.dropped].filter(Boolean).join(' '))
  })
  const fileName = () => (title || 'script').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'script'
  const exportFountain = () => attempt(async () => {
    const text = fountainOut(doc, scriptId)
    if (!text.trim()) throw new Error('There is nothing to export yet.')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName()}.fountain`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    say('Exported the Fountain file.')
  })
  const exportPdf = () => attempt(async () => {
    const html = screenplayHtml(doc, scriptId)
    const w = window.open('', '_blank')
    if (!w) throw new Error('Allow pop-ups to export a PDF, or use Import ▸ Export Fountain.')
    w.document.write(html)
    w.document.close()
    // Let the page lay out, then open the print dialog (Save as PDF).
    w.setTimeout(() => w.print(), 250)
    say('Opened the print view — choose “Save as PDF”.')
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
    escape: () => false,
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
  // 'Write with Skye' is always reachable: the empty-only PromptStart is gone once the script has content.
  const writePanel = !phone && writing && <ScriptWritePrompt scriptId={scriptId} seed={pickedIdea(doc, scriptId)} onClose={() => setWriting(false)} />

  // Skye's questions wait in her Booth now (SkyeBooth.tsx), not on the page.
  const waitingHere = null
  const page = (
    <main className="se-page" aria-label={view === 'av' ? 'Video and audio' : 'Screenplay'} onClickCapture={onPagePoint}
      onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault() }}
      onDrop={(e) => {
        const f = [...e.dataTransfer.files].find((x) => /\.(fountain|spmd|txt)$/i.test(x.name))
        if (!f) return
        e.preventDefault()
        void doImport(f)
      }}>
      {writePanel}
      {!phone && view === 'screenplay' && <ElementBar focus={focus} composed={composed} store={store} chain={chain} onError={setError} say={say} />}
      {(view === 'av' && !phone) && waitingHere}
      {view === 'av' && !phone ? (
        <AVView composed={composed} doc={doc} store={store} chain={chain} current={current} setCurrent={(id) => setCurrent(id)}
          mentions={mentions} say={say} onError={setError} disabled={!!planning} onRemove={removeItem} />
      ) : <div className="sp-rows">
        {waitingHere}
        {empty && !phone && <PromptStart kind="script" nodeId={scriptId} place="editor" />}
        {composed.rows.map((r) => (
          <Row key={`${r.kind}:${r.id}`} row={r} doc={doc} store={store} chain={chain} readOnly={phone}
            current={current} active={active} setCurrent={setCurrent} setActive={setActive} mentions={mentions} drafts={drafts} whyOf={whyOf}
            onDraft={empty ? (sceneId) => void attempt(() => draftFromLine(skyeDeps, store, scriptId, sceneId)) : undefined}
            hooksFor={hooksFor} focusOn={focusOn} say={say} onError={setError} onRemove={removeItem} />
        ))}
      </div>}
      {part && <PartMark part={part} focus={focus} />}
    </main>
  )

  return (
    <div className={`se ${sheet ? `sheet-${sheet}` : ''}`} data-script-page="" data-view={view}>
      {/* The shared editor bar (features/topbar-declutter.clan): the view switch, Undo, History, More
          (Import Fountain, Copy link to this, Shots from) and Plan shots, fitted like every editor's. */}
      <EditorBar className="se-top" back={backTo} onBack={onBack} icon="script" title={`Script · ${title}`}
        meta={<span className={`pt-mono se-saved ${saved === 'Saved' ? '' : 'busy'}`} role="status">{saved}</span>}
        view={phone ? undefined : {
          label: 'Script view', value: view,
          onPick: (v) => uiStore.update((u) => { u.script = { ...u.script, [scriptId]: { ...u.script?.[scriptId], view: v as typeof view } } }),
          options: [{ id: 'screenplay', label: 'Screenplay' }, { id: 'av', label: 'Video · Audio' }],
        }}
        undo={!phone}
        history={{ on: history, toggle: () => { setHistoryFocus(undefined); setHistory((h) => !h) } }}
        moreTip={phone ? 'More: copy link' : 'More: import and export Fountain, export PDF, copy link'}
        moreHead={storyboardsOf(doc, scriptId).length > 1 && (
          <label className="se-from">Shots from
            <select className="select xs" value={sb?.id ?? ''} onChange={(e) => uiStore.update((u) => { u.script = { ...u.script, [scriptId]: { view, ...u.script?.[scriptId], storyboard: e.target.value } } })}>
              {storyboardsOf(doc, scriptId).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
        )}
        more={(close) => (
          <>
            {!phone && <MenuItem icon="⇪" onSelect={() => { close(); fileRef.current?.click() }}>Import Fountain…</MenuItem>}
            <MenuItem icon="⬇" onSelect={() => { close(); void exportFountain() }}>Export Fountain…</MenuItem>
            <MenuItem icon="🖨" onSelect={() => { close(); void exportPdf() }}>Export PDF…</MenuItem>
            <MenuItem icon={<LinkIcon />} onSelect={() => {
              close()
              const url = new URL(formatRoute(route), location.origin).href
              void navigator.clipboard?.writeText(url).then(() => say('Link copied.'), () => say(url))
            }}>Copy link to this</MenuItem>
          </>
        )}
        primary={!phone && (
          <>
            {/* Always reachable: ask Skye to write a script from an idea, empty or not. */}
            <button className="btn se-write" aria-expanded={writing} aria-pressed={writing} disabled={skye.off}
              data-tip={skye.off ? NOT_HERE : 'Ask Skye to draft a script'} onClick={() => setWriting((w) => !w)}>
              <AgentFigure agent="skye" size={18} decorative /> Write with Skye
            </button>
            {/* Why Plan shots is off: its tooltip, and read with it (a disabled button never says why). */}
            {blocked && !planning && <span className="pt-sr se-why" id="se-plan-why">{blocked}</span>}
            <button className="btn primary" disabled={!!blocked || !!planning} aria-describedby={blocked && !planning ? 'se-plan-why' : undefined}
              data-tip={blocked && !planning ? blocked : undefined} onClick={() => void plan()}>
              {planning ? 'Planning…' : behind ? 'Update storyboard' : 'Plan shots'}
            </button>
          </>
        )} />
      <input ref={fileRef} type="file" accept=".fountain,.spmd,.txt,text/plain" hidden onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) void doImport(f)
      }} />
      {phone && <div className="banner" role="status">You can watch and leave notes here. Open on a laptop or iPad to edit.</div>}
      {!phone && next && (
        <div className="se-next" role="status" aria-label="What comes next" data-next={next.step}>
          <AgentFigure agent="dex" size={22} decorative />
          <span><span className="who">{sayer('dex')}:</span> {next.line}</span>
          <span className="pt-grow" />
          {/* Plan shots and Update storyboard are the bar's primary: the line does not repeat them. */}
          {next.actions.filter((a) => a !== 'plan' && a !== 'update').map((a) => <button key={a} type="button" className="btn sm" onClick={() => onNext(a)}>{NEXT_LABEL[a]}</button>)}
        </div>
      )}
      {confirm && (
        <div className="se-line se-confirm">
          <InlineConfirm text={confirm.text} yes={confirm.yes} onNo={() => setConfirm(null)} onYes={confirm.go} />
        </div>
      )}
      {(notice || error) && (
        <div className={`se-line ${error ? 'bad' : ''}`} role={error ? 'alert' : 'status'}>
          {error ?? notice?.text}
          <FrontButtons text={error} />
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
          <SkyeBooth booth={booth} store={store} doc={doc} composed={composed} person={person} current={current}
            editor={focus?.editor ?? null} focusTarget={focusTarget} part={part} onClearPart={() => setPart(null)}
            whole={wholeScope(doc, composed, (k, id) => store.text.prose(k, id), focusTarget?.kind === 'scene' ? focusTarget.id : undefined)}
            skye={skye} questions={skyeQs} planning={planning} empty={empty}
            requestOf={(jobId) => ui.jobs[jobId]?.request?.input.write}
            onWrite={(target, intent, opts) => startWrite(skyeDeps, store, scriptId, target, intent, opts)}
            onDraftScript={async (words) => {
              const r = await scriptFromLine(skyeDeps, store, scriptId, words)
              if ('pasted' in r) say([`Pasted ${r.pasted} ${r.pasted === 1 ? 'scene' : 'scenes'}.`, r.dropped].filter(Boolean).join(' '))
            }}
            onNameAnswer={(askId, option) => void attempt(() => answerLocalAsk(store, askId, option, person, (shotId, name) => startWrite(skyeDeps, store, scriptId, { kind: 'shot', id: shotId }, 'cut_name', { name })))}
            onShotAsk={(a, shotId, option) => void attempt(async () => {
              if (option === 'keep') return updateDoc(docStore, (d) => answerShotAsk(d, a.id, 'keep', person), `answer ${a.question.text}`)
              return deleteFrom(docStore, (d) => { answerShotAsk(d, a.id, 'remove', person); return removeShot(d, shotId) })
            })}
            onWhy={openWhy} onError={setError} say={say} />
        )}
        {history && <HistoryPanel key={historyFocus?.addresses.join() ?? 'all'} store={store} focus={historyFocus} onClose={() => { setHistory(false); setHistoryFocus(undefined) }} />}
      </div>
    </div>
  )
}

const NEXT_LABEL: Record<NextAction, string> = {
  plan: 'Plan shots', update: 'Update storyboard', 'make-video': 'Make video', 'open-storyboard': 'Open the storyboard', 'open-video': 'Open the video',
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
              <StaticProse prose={scene.prose as { content?: PMNodeLike[] } | undefined} doc={doc} mentions={mentions} />
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

/**
 * A fragment's prose as static screenplay, mentions under their current names, marked as the editor
 * marks them (mentions.ts): in scope only when linked to this script (owner, 2026-10-15: tags count
 * once linked), a typed @name underlined until what it names is linked here.
 */
function StaticProse({ prose, doc, mentions }: { prose?: { content?: PMNodeLike[] }; doc: Doc; mentions?: MentionHooks }) {
  const names = refNames(doc)
  const inScope = mentions?.names() ?? null
  const inline = (nodes?: PMNodeLike[]): ReactNode[] => (nodes ?? []).map((n, i) => {
    if (n.type === 'text') return <span key={i}>{typedNames(n.text ?? '', inScope)}</span>
    if (n.type === 'hardBreak') return <br key={i} />
    if (n.type === 'mention') {
      const id = String(n.attrs?.id ?? '')
      const r = names[id]
      const known = mentions ? !!mentions.resolve(id)?.known : !!r
      const label = r ? `@${r.variant ? `${r.key}_${r.variant}` : r.key}` : `@${String(n.attrs?.label ?? '')}`
      return <span key={i} className={known ? 'mention' : 'mention unknown'}>{label}</span>
    }
    return null
  })
  return <>{(prose?.content ?? []).map((b, i) => <p key={i} data-type={b.type}>{inline(b.content)}</p>)}</>
}

/** Plain text with its typed @names marked: in scope (`names`) or underlined; null names marks nothing. */
function typedNames(text: string, names: string[] | null): ReactNode {
  if (!names) return text
  return typedSpans(text, names).map((p, i) => (p.name ? <span key={i} className={p.known ? 'mention-typed' : 'mention-typed unknown'}>{p.text}</span> : p.text))
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
    // Transition and centred text live in the unplanned scene text; the bar sets them, Tab steps on.
    ...(kind === 'scene' ? [
      { t: 'transition', label: 'Transition', act: () => setType('transition') },
      { t: 'centered', label: 'Centred', act: () => setType('centered') },
    ] : []),
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

/** The top-level block a click landed in: its index among the blocks of its fragment (the editor's or the
 *  static page's), for the Booth's part. */
function blockIndexAt(el: Element | null): number {
  let at: Element | null = el
  while (at && at.parentElement && !at.parentElement.matches('.ProseMirror, .sp-static')) at = at.parentElement
  if (!at?.parentElement) return 0
  return Math.max(0, [...at.parentElement.children].indexOf(at))
}

/** The part the Booth is on, marked on the page: a tint and a line over its block (the mock's part state). */
function PartMark({ part, focus }: { part: Extract<SkyeScope, { kind: 'part' }>; focus: Focus }) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const editor = focus?.editor && !focus.editor.isDestroyed ? focus.editor : null
      const [k, id] = (focus?.key ?? ':').split(':')
      const same = part.target.kind === 'scene' ? (k === 'scene' && id === part.target.id) : (k === 'shot' || k === 'beat')
      const host = editor?.view.dom
      const block = same && host ? (part.target.kind === 'scene' ? host.children[part.block] : host) : null
      const page = block?.closest('.se-page') as HTMLElement | null
      if (!block || !page) return setBox(null)
      const r = block.getBoundingClientRect()
      const p = page.getBoundingClientRect()
      setBox({ top: r.top - p.top + page.scrollTop - 4, left: r.left - p.left + page.scrollLeft - 8, width: r.width + 16, height: r.height + 8 })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  })
  return box ? <span className="se-partmark" aria-hidden="true" style={box} /> : null
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
