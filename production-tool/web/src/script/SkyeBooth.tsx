// Skye's Booth in the Script editor (features/script-freeform.clan; mock script-freeform-v1 states draft,
// selection, asks, part). A box to tell her what to write or change, scoped to the whole script, a part of
// the page (¶N, or a shot) or the person's selection; her drafts and edits as cards with Keep, Discard and
// Why, landing on the page only on Keep (with Undo); her questions waiting; 'This script' at the foot.
// The flows are skye.ts's (draft from a brief, revise, the free instruct); no relay or prompt change.

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { proseHash, StaleSuggestion } from '../../../clan-store/src'
import type { Ask, Id, ProductionDocument, Suggestion, WriteIntent, WriteMode, WriteTarget } from '../contracts/types'
import { askedShot } from '../jobs/plan'
import type { ModelStore } from '../model/store'
import { openAsks, scriptText } from '../model/selectors'
import { Booth, type BoothState } from '../ui/booth/Booth'
import { BoothAgent, BoothAsk, BoothBox, BoothSection, CardHead, ChoiceCard, DoneCard, NoteCard, ScopeChip, WorkingCard } from '../ui/booth/BoothParts'
import { ago, useLater, useWhy } from '../ui/booth/hooks'
import type { HistoryFocus } from '../ui/History'
import type { ComposedScript } from './compose'
import { nameAsks } from './nameAsks'
import { discardDraft, fitSeconds, handsOff as isHandsOff, HANDS_OFF_LINE, keep, linesOf, NEW_SCENE_LINE, NOT_HERE, QUOTA_OUT, SKYE_OPTIONS, wordDiff } from './skye'
import { askedWords, draftLines, landsWhere, scriptSuggestions, shareSeconds, trimDiff, type SkyeScope, type Span } from './skyeBooth'
import { ScriptFacts } from './ScriptFacts'

type Doc = ProductionDocument
type StartOpts = { selection?: Span; seconds?: number; explicit?: boolean; instruction?: string; mode?: WriteMode }

export const SKYE_LINE = 'Tell me what to write or change. It waits here until you keep it.'
export const SKYE_PLACEHOLDER = 'Tell the Script agent what to write or change…'

export interface SkyeBoothProps {
  booth: BoothState
  store: ModelStore
  doc: Doc
  composed: ComposedScript
  person: string
  current?: string
  /** The page's focused item and its editor, for the selection. */
  editor: Editor | null
  focusTarget: WriteTarget | null
  /** A part of the page the Booth came back on (a click while it was hidden), or null. */
  part: Extract<SkyeScope, { kind: 'part' }> | null
  onClearPart: () => void
  whole: Extract<SkyeScope, { kind: 'whole' }>
  /** Skye's state on this script (skye.ts skyeState). */
  skye: { working?: string; waiting?: { jobId: string; ask?: Ask }; newScene?: Id; off: boolean; quota: boolean }
  /** Her waiting questions on this script (skye.ts skyeAsks). */
  questions: { ask: Ask; jobId: string }[]
  planning?: string
  /** The request this browser sent for a write job (ui.jobs). */
  requestOf: (jobId: string) => import('../contracts/types').WriteInput | undefined
  empty: boolean
  /** Start a write on an item (skye.ts startWrite). */
  onWrite: (target: WriteTarget, intent: WriteIntent, opts: StartOpts) => Promise<unknown>
  /** A draft for an empty script from a line, or a pasted screenplay (jobs/prompt.ts scriptFromLine). */
  onDraftScript: (words: string) => Promise<unknown>
  onNameAnswer: (askId: string, option: 'character' | 'extra' | 'cut') => void
  onShotAsk: (a: Ask, shotId: string, option: 'keep' | 'remove') => void
  onWhy: (f: HistoryFocus) => void
  onError: (m: string | null) => void
  say: (m: string, undo?: boolean) => void
}

/** The person's selection in the page's focused item, kept while they type in the Booth. */
function useSelection(editor: Editor | null, target: WriteTarget | null): [Extract<SkyeScope, { kind: 'selection' }> | null, () => void] {
  const [sel, setSel] = useState<Extract<SkyeScope, { kind: 'selection' }> | null>(null)
  useEffect(() => {
    if (!editor || !target) return
    const read = () => {
      if (editor.isDestroyed || !editor.isFocused) return
      const { from, to, empty } = editor.state.selection
      if (empty) setSel(null)
      else setSel({ kind: 'selection', target, span: { from, to, text: editor.state.doc.textBetween(from, to, '\n').slice(0, 4000) } })
    }
    editor.on('selectionUpdate', read)
    editor.on('focus', read)
    return () => {
      editor.off('selectionUpdate', read)
      editor.off('focus', read)
    }
  }, [editor, target?.kind, target?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return [sel, () => setSel(null)]
}

/** The person's selection, still marked on the page while they type in the Booth (the editor's own
 *  selection hides when it loses the focus). Drawn over the page, under nothing that takes a click. */
function SelectionMark({ editor, span }: { editor: Editor | null; span: Span }) {
  const [rects, setRects] = useState<{ top: number; left: number; width: number; height: number }[]>([])
  const page = editor && !editor.isDestroyed ? editor.view.dom.closest('.se-page') as HTMLElement | null : null
  useLayoutEffect(() => {
    const place = () => {
      if (!editor || editor.isDestroyed || !page || editor.isFocused) return setRects((was) => (was.length ? [] : was))
      try {
        const a = editor.view.domAtPos(span.from)
        const b = editor.view.domAtPos(span.to)
        const r = document.createRange()
        r.setStart(a.node, a.offset)
        r.setEnd(b.node, b.offset)
        const p = page.getBoundingClientRect()
        const next = [...r.getClientRects()].filter((x) => x.width > 1).map((x) => ({ top: Math.round(x.top - p.top + page.scrollTop), left: Math.round(x.left - p.left + page.scrollLeft), width: Math.round(x.width), height: Math.round(x.height) }))
        setRects((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next))
      } catch {
        setRects((was) => (was.length ? [] : was))
      }
    }
    place()
    const t = setInterval(place, 400)
    window.addEventListener('resize', place)
    return () => {
      clearInterval(t)
      window.removeEventListener('resize', place)
    }
  }, [editor, page, span.from, span.to])
  if (!page || !rects.length) return null
  return createPortal(<>{rects.map((r, i) => <span key={i} className="se-selmark" aria-hidden="true" style={r} />)}</>, page)
}

export function SkyeBooth(p: SkyeBoothProps) {
  const { booth, store, doc, composed, person, part, whole, skye } = p
  const [sel, clearSel] = useSelection(p.editor, p.focusTarget)
  const [done, setDone] = useState<{ id: string; text: string; undo?: boolean }[]>([])
  const [asking, setAsking] = useState(false)
  const [anyway, setAnyway] = useState(false)
  const { later, order } = useLater()
  // The selection wins over a part; a part over the whole script.
  const scope: SkyeScope = sel ?? part ?? whole
  const scoped = scope.kind !== 'whole'
  const target = scope.target
  const handsOff = !!target && isHandsOff(doc, target) && !anyway
  const busy = !!skye.working || !!skye.waiting
  const targetS = composed.storyboard?.target_s ?? composed.script.target_s
  const allText = scriptText(doc, composed.script.id)
  const seconds = scope.kind === 'part' && scope.target.kind === 'scene' ? shareSeconds(targetS, scope.text, allText)
    : target ? fitSeconds(doc, composed.script.id, target) : targetS

  const run = async (fn: () => Promise<unknown>) => {
    p.onError(null)
    setAsking(true)
    try {
      await fn()
      return true
    } catch (e) {
      p.onError(e instanceof Error ? e.message : 'That did not work.')
      return false
    } finally {
      setAsking(false)
    }
  }
  const spanOf = (): Span | undefined => (scope.kind === 'selection' || scope.kind === 'part' ? scope.span : undefined)
  const explicit = anyway ? { explicit: true } : {}
  // What is typed in the box: a draft on an empty script, else Skye's free instruct on the scope.
  const send = (words: string) => run(async () => {
    if (p.empty || !target) return p.onDraftScript(words)
    const selection = spanOf()
    return p.onWrite(target, 'instruct', { instruction: words, mode: 'revise', ...(selection ? { selection } : {}), ...explicit })
  })
  const verb = (intent: WriteIntent) => target && run(() => {
    const selection = spanOf()
    return p.onWrite(target, intent, { ...(selection ? { selection } : {}), ...(intent === 'fit_seconds' ? { seconds } : {}), ...explicit })
  })
  const clearScope = () => {
    clearSel()
    p.onClearPart()
  }

  const verbs = (list: typeof SKYE_OPTIONS) => (
    <div className="bt-verbs" role="toolbar" aria-label="Ask the Script agent to">
      {list.map((o) => <button key={o.intent} type="button" disabled={busy || asking || handsOff || skye.off || skye.quota} onClick={() => void verb(o.intent)}>{o.label(seconds)}</button>)}
    </div>
  )
  const chip = scope.kind === 'selection'
    ? <ScopeChip on label="Your selection" quote={scope.span.text.length > 60 ? `${scope.span.text.slice(0, 60)}…` : scope.span.text} onClear={clearScope} clearLabel="Apply to the whole script" />
    : scope.kind === 'part' ? <ScopeChip on label={`This part · ${scope.label}`} onClear={clearScope} clearLabel="Apply to the whole script" />
      : <ScopeChip label={scope.label} />
  const placeholder = scope.kind === 'selection' ? 'Tell the Script agent what to change in your selection…' : scope.kind === 'part' ? 'Tell the Script agent what to change in this part…' : SKYE_PLACEHOLDER
  const hint: ReactNode = skye.off ? NOT_HERE : skye.quota ? QUOTA_OUT
    : handsOff ? <>{HANDS_OFF_LINE} <button type="button" className="btn sm link" onClick={() => setAnyway(true)}>Ask it anyway</button></> : null

  // What waits for the person: Skye's questions on drafts, her questions on names, Dex's on shots a re-plan left out.
  const shotAsks = openAsks(doc).filter((a) => !!askedShot(a) && composed.shots.some((s) => s.id === askedShot(a)))
  const names = nameAsks(doc, composed.script.id).filter((a) => a.state === 'open')
  type Wait = { id: string; node: ReactNode }
  const waits: Wait[] = order([
    ...p.questions.map((q): Wait => ({ id: q.ask.id, node: <BoothAsk key={q.ask.id} ask={q.ask} onLater={() => later(q.ask.id)} time={ago(doc.jobs[q.jobId]?.created_at)} /> })),
    ...names.map((a): Wait => ({ id: a.id, node: (
      <ChoiceCard key={a.id} id={a.id} agent="skye" q={a.question.text} body={a.question.why} onLater={() => later(a.id)}
        choices={a.question.options.filter((o) => o.value !== undefined || ['character', 'extra', 'cut'].includes(o.id)).map((o, i) => ({ label: o.label, primary: i === 0, run: () => p.onNameAnswer(a.id, o.id as 'character' | 'extra' | 'cut') }))} />
    ) })),
    ...shotAsks.map((a): Wait => {
      const shotId = askedShot(a)!
      const n = composed.shots.findIndex((s) => s.id === shotId) + 1
      return { id: a.id, node: (
        <ChoiceCard key={a.id} id={a.id} agent="dex" q={a.question.text || `Shot ${n} no longer has a scene.`} body="Keep it, or remove it with its frames and clips?" onLater={() => later(a.id)}
          choices={[{ label: 'Keep', primary: true, run: () => p.onShotAsk(a, shotId, 'keep') }, { label: 'Remove', run: () => p.onShotAsk(a, shotId, 'remove') }]} />
      ) }
    }),
  ], (w) => w.id)

  const sugs = scriptSuggestions(doc, composed)
  const mine = sugs.filter((s) => s.for === person)
  const others = sugs.filter((s) => s.for !== person)
  const decided = (id: string, text: string, undo = false) => setDone((d) => [{ id, text, undo }, ...d.filter((x) => x.id !== id)].slice(0, 3))
  const fromSkye = mine.length > 0 || others.length > 0 || done.length > 0 || !!skye.working || !!skye.newScene || !!p.planning
  const count = waits.length

  return (
    <Booth state={booth} scoped={scoped} count={count} asks={count}
      footer={<ScriptFacts composed={composed} doc={doc} store={store} current={p.current} onError={p.onError} say={p.say} />}>
      {scope.kind === 'selection' && <SelectionMark editor={p.editor} span={scope.span} />}
      <BoothAgent agent="skye" line={SKYE_LINE} needsYou={count > 0} />
      {scope.kind === 'part' && (
        <article className="bc" aria-label="This part">
          <header className="bc-hd"><span className="bc-who">This part · {scope.label}</span></header>
          <div className="bc-text quiet">{scope.text}</div>
          <p className="bc-note">{scope.target.kind === 'shot'
            ? `Planned: ${scope.label.toLowerCase()} runs ${doc.shots[scope.target.id]?.duration_s ?? 0} s. What you tell the Script agent below applies to this shot only.`
            : 'Not planned yet. What you tell the Script agent below applies to this part only.'}</p>
          {verbs(SKYE_OPTIONS.filter((o) => o.intent !== 'write_vo'))}
        </article>
      )}
      <BoothBox key={scope.kind === 'whole' ? 'whole' : scope.kind === 'part' ? `part:${scope.label}` : 'sel'} placeholder={placeholder} button="Ask the Script agent" scope={chip}
        onSend={send} busy={asking} disabled={skye.off || skye.quota || busy || handsOff} hint={hint} />
      {scope.kind === 'selection' && verbs(SKYE_OPTIONS)}
      {waits.length > 0 && <BoothSection label="Waiting for you" count={waits.length} />}
      {waits.map((w) => w.node)}
      {fromSkye && <BoothSection label="From the Script agent" />}
      {p.planning && <WorkingCard agent="dex" text="The Director agent is planning the shots from the script." />}
      {skye.working && <WorkingCard agent="skye" text="The Script agent is writing…" />}
      {mine.map((s) => <SkyeCard key={s.id} sug={s} {...p} decided={decided} />)}
      {others.map((s) => <NoteCard key={s.id} agent="skye" label="drafting" body={`The Script agent is drafting for ${s.for.replace(/^human:/, '')}.`} />)}
      {skye.newScene && !skye.working && !skye.waiting && <NoteCard agent="skye" label="note" body={NEW_SCENE_LINE} />}
      {done.map((d) => <DoneCard key={d.id} agent="skye" text={d.text} onUndo={d.undo ? () => { setDone((x) => x.filter((y) => y.id !== d.id)); void store.undo() } : undefined} />)}
      {!waits.length && !fromSkye && (
        <p className="bt-quiet">Nothing waiting. {p.empty ? 'Ask for a draft, or just start writing.' : 'Select words on the page to ask about just those.'}</p>
      )}
    </Booth>
  )
}

/** One of Skye's drafts or edits: what she was asked, her words (a draft) or the change (an edit, word by
 *  word), Keep, Discard, Why. Nothing changes on the page until Keep. */
function SkyeCard({ sug, store, doc, composed, requestOf, empty, onWrite, onWhy, decided }: SkyeBoothProps & { sug: Suggestion; decided: (id: string, text: string, undo?: boolean) => void }) {
  const [stale, setStale] = useState(sug.state === 'stale')
  const [busy, setBusy] = useState(false)
  const [showWhy, toggleWhy] = useWhy()
  const kind = sug.target.kind
  const current = () => store.text.prose(kind, sug.target.id)
  useEffect(() => {
    let alive = true
    if (sug.state === 'open') void proseHash(current()).then((h) => alive && setStale(h !== sug.base_hash))
    return () => {
      alive = false
    }
  })
  const write = requestOf(sug.job_id)
  const isDraft = sug.mode === 'draft'
  const asked = askedWords(write, sug)
  const sceneNo = (id: Id) => composed.rows.filter((r) => r.kind === 'scene').findIndex((r) => r.id === id) + 1
  const shotNo = (id: Id) => composed.shots.findIndex((s) => s.id === id) + 1
  const where = landsWhere(sug, write, empty, sceneNo, shotNo)
  const docId = (() => {
    try {
      return store.documentId()
    } catch {
      return ''
    }
  })()
  const act = async (fn: () => Promise<{ line: string }>, text: string, undo: boolean) => {
    setBusy(true)
    try {
      await fn()
      decided(sug.id, text, undo)
    } catch (e) {
      if (e instanceof StaleSuggestion) setStale(true)
      else decided(sug.id, e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }
  const askAgain = () => void onWrite(sug.target, write?.intent ?? 'tighten', { ...(write?.mode ? { mode: write.mode } : {}), ...(write?.instruction ? { instruction: write.instruction } : {}) })
  const before = linesOf(doc, current()).map((l) => l.text).join('\n')
  const lines = isDraft ? draftLines(doc, sug) : null
  const diff = isDraft ? [] : trimDiff(wordDiff(before, sug.proposed.text))
  return (
    <article className={`bc ${stale ? 'stale' : ''}`} role="group" aria-label={`The Script agent's ${isDraft ? 'draft' : 'edit'}`} data-suggestion={sug.id}>
      <CardHead agent="skye" label={isDraft ? 'draft' : 'edit'} time={ago(doc.jobs[sug.job_id]?.updated_at ?? doc.jobs[sug.job_id]?.created_at)} />
      <p className="bc-note">{asked.lead}{asked.quote ? <>: <q>{asked.quote}</q></> : null}</p>
      {lines ? (
        <div className="bc-text">
          {lines.lines.map((l, i) => <div key={i} className={`l ${lines.screenplay ? 'sp' : ''} k-${l.kind}`}>{l.text}</div>)}
        </div>
      ) : (
        <div className="bc-diff">
          {diff.map((x, i) => (x.kind === 'same' ? <span key={i}>{x.text}</span> : x.kind === 'gone' ? <del key={i}>{x.text}</del> : <ins key={i}>{x.text}</ins>))}
        </div>
      )}
      {(sug.proposed.duration_s !== undefined || (sug.proposed.new_beats ?? []).length > 0) && (
        <p className="bc-note">{sug.proposed.duration_s !== undefined ? `${sug.proposed.duration_s} s` : ''}{(sug.proposed.new_beats ?? []).map((b) => ` + ${b.kind} at ${b.at_s} s`).join('')}</p>
      )}
      <div className="bc-act">
        {stale ? (
          <>
            <button type="button" className="btn sm dark" onClick={askAgain}>Ask again</button>
            <button type="button" className="btn sm" disabled={busy} onClick={() => void act(() => discardDraft(store, sug.id), 'Discarded. The page is as it was.', false)}>Discard</button>
          </>
        ) : (
          <>
            <button type="button" className="btn sm dark" disabled={busy} onClick={() => void act(() => keep(store, sug.id), isDraft ? 'Kept. The Script agent’s draft is on the page.' : 'Kept. The change is on the page.', true)}>Keep</button>
            <button type="button" className="btn sm" disabled={busy} onClick={() => void act(() => discardDraft(store, sug.id), 'Discarded. The page is as it was.', false)}>Discard</button>
          </>
        )}
        <button type="button" className="btn sm why" aria-expanded={showWhy} onClick={toggleWhy}>Why</button>
        <span className="where">{stale ? new StaleSuggestion().message : where}</span>
      </div>
      {showWhy && (
        <div className="bc-why">
          {sug.note}{' '}
          <button type="button" className="btn sm link" onClick={() => onWhy({ label: 'The Script agent\'s draft', addresses: [`${docId}#suggestions[${sug.id}]`, `${docId}#jobs[${sug.job_id}]`, `${docId}#${sug.target.kind}s[${sug.target.id}]`] })}>In History</button>
        </div>
      )}
    </article>
  )
}
