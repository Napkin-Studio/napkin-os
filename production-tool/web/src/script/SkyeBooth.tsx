// The Script agent in the Script editor's Booth (features/production-new-ui.clan; mock production-new-ui-v2
// script-agent, script-sp): the Booth earns its place only when the person asks the Script agent on purpose
// (the band's Ask the Script agent…), selects words, or puts the caret on a line of the page. Then: the crumb,
// the part or selection it applies to, the box with the verbs, and what the agent is doing. Her drafts and
// edits land on the page where they change things (DraftCard.tsx); her questions wait on the page too. The
// flows are skye.ts's (draft from a brief, revise, the free instruct); no relay or prompt change.

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import type { ProductionDocument, WriteIntent, WriteMode, WriteTarget } from '../contracts/types'
import { scriptText } from '../model/selectors'
import { Booth, type BoothState } from '../ui/booth/Booth'
import { BoothBox, ScopeChip, WorkingCard } from '../ui/booth/BoothParts'
import type { ComposedScript } from './compose'
import { fitSeconds, handsOff as isHandsOff, HANDS_OFF_LINE, NOT_HERE, QUOTA_OUT, SKYE_OPTIONS, WhichItem } from './skye'
import { shareSeconds, type SkyeScope, type Span } from './skyeBooth'

type Doc = ProductionDocument
type StartOpts = { selection?: Span; seconds?: number; explicit?: boolean; instruction?: string; mode?: WriteMode }

export const SKYE_PLACEHOLDER = 'Tell the Script agent what to write or change…'

export interface SkyeBoothProps {
  booth: BoothState
  doc: Doc
  composed: ComposedScript
  /** The page's focused item and its editor, for the selection. */
  editor: Editor | null
  focusTarget: WriteTarget | null
  /** The line or part of the page the caret is on (a click on the page), or null. Cleared (×): the whole script. */
  part: Extract<SkyeScope, { kind: 'part' }> | null
  onClearPart: () => void
  whole: Extract<SkyeScope, { kind: 'whole' }>
  /** Asked on purpose from the band (Ask the Script agent…): the whole script. */
  asked: boolean
  /** The crumb's ← Script and ×: the Booth goes. */
  onClose: () => void
  /** Skye's state on this script (skye.ts skyeState). */
  skye: { working?: string; waiting?: { jobId: string }; off: boolean; quota: boolean }
  planning?: string
  empty: boolean
  /** Start a write on an item (skye.ts startWrite). */
  onWrite: (target: WriteTarget, intent: WriteIntent, opts: StartOpts) => Promise<unknown>
  /** A draft for an empty script from a line, or a pasted screenplay (jobs/prompt.ts scriptFromLine). */
  onDraftScript: (words: string) => Promise<unknown>
  /** An empty script with a linked brief: "Draft from the brief" (jobs/prompt scriptFromBrief; UAT 2026-11-21: it had no button). */
  onDraftFromBrief?: () => Promise<unknown>
  /** The linked brief's title, when the script has one. */
  briefTitle?: string
  onError: (m: string | null) => void
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
  const { booth, doc, composed, part, whole, skye } = p
  const [sel, clearSel] = useSelection(p.editor, p.focusTarget)
  const [asking, setAsking] = useState(false)
  const [anyway, setAnyway] = useState(false)
  // An ask two shots fit as well: which one (R4-F3, UX 3), with the words kept to send on the pick.
  const [which, setWhich] = useState<{ words: string; choices: WhichItem['choices'] } | null>(null)
  // The selection wins over a part; a part over the whole script.
  const scope: SkyeScope = sel ?? part ?? whole
  const scoped = scope.kind !== 'whole'
  // The Booth rule: asked on purpose, words selected, or a line of the page. Nothing else brings it.
  const earned = p.asked || !!sel || !!part
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
    setWhich(null)
    if (p.empty || !target) return p.onDraftScript(words)
    const selection = spanOf()
    try {
      return await p.onWrite(target, 'instruct', { instruction: words, mode: 'revise', ...(selection ? { selection } : {}), ...explicit })
    } catch (e) {
      if (!(e instanceof WhichItem)) throw e
      setWhich({ words, choices: e.choices })
    }
  })
  const pickWhich = (t: WriteTarget) => {
    const words = which?.words
    setWhich(null)
    if (words) void run(() => p.onWrite(t, 'instruct', { instruction: words, mode: 'revise', ...explicit }))
  }
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
      {list.map((o) => <button key={o.intent} type="button" disabled={busy || asking || handsOff || skye.off || skye.quota || !target} onClick={() => void verb(o.intent)}>{o.label(seconds)}</button>)}
    </div>
  )
  const chip = scope.kind === 'selection'
    ? <ScopeChip on label="Your selection" quote={scope.span.text.length > 60 ? `${scope.span.text.slice(0, 60)}…` : scope.span.text} onClear={clearScope} clearLabel="Apply to the whole script" />
    : scope.kind === 'part' ? <ScopeChip on label={`This part · ${scope.label}`} onClear={clearScope} clearLabel="Apply to the whole script" />
      : <ScopeChip label={scope.label} />
  const placeholder = scope.kind === 'selection' ? 'Tell the Script agent what to change in your selection…' : scope.kind === 'part' ? 'Tell the Script agent what to change in this part…' : SKYE_PLACEHOLDER
  const hint: ReactNode = skye.off ? NOT_HERE : skye.quota ? QUOTA_OUT
    : handsOff ? <>{HANDS_OFF_LINE} <button type="button" className="btn sm link" onClick={() => setAnyway(true)}>Ask it anyway</button></> : null
  const where = scope.kind === 'selection' ? 'Your selection' : scope.kind === 'part' ? scope.label : 'Ask the Script agent'

  return (
    <Booth state={booth} earned={earned} scoped={scoped}>
      {scope.kind === 'selection' && <SelectionMark editor={p.editor} span={scope.span} />}
      <div className="sp-crumb"><button type="button" onClick={p.onClose}>← Script</button><span>›</span><b>{where}</b>
        <button type="button" className="x" onClick={p.onClose} title="Back (Esc)" aria-label="Close the Booth">×</button></div>
      {scope.kind === 'part' && (
        <article className="bc" aria-label="This part">
          <header className="bc-hd"><span className="bc-who">This part · {scope.label}</span></header>
          <div className="bc-text quiet">{scope.text}</div>
          <p className="bc-note">{scope.target.kind === 'shot'
            ? `Planned: ${scope.label.toLowerCase()} runs ${doc.shots[scope.target.id]?.duration_s ?? 0} s. What you tell the Script agent below applies to this shot only.`
            : (() => {
              // A scene part is planned once shots come from its scene (UAT 2026-11-21: "Not planned yet" after Plan shots).
              const id = scope.target.id
              const n = Object.values(doc.shots ?? {}).filter((s) => s.scene_id === id && s.kind !== 'end_card').length
              return n ? `Planned: ${n} ${n === 1 ? 'shot' : 'shots'} from this part. What you tell the Script agent below applies to this part only.`
                : 'Not planned yet. What you tell the Script agent below applies to this part only.'
            })()}</p>
        </article>
      )}
      <div className="bsec">
        <h4>{scope.kind === 'whole' ? 'Ask the Script agent' : scope.kind === 'part' ? 'Change this line' : 'Change your selection'}</h4>
        <BoothBox key={scope.kind === 'whole' ? 'whole' : scope.kind === 'part' ? `part:${scope.label}` : 'sel'} placeholder={placeholder} button="Ask the Script agent" scope={chip}
          onSend={send} busy={asking} disabled={skye.off || skye.quota || busy || handsOff} hint={hint} />
        {which && (
          <div className="bt-which" role="group" aria-label="Which shot is it about?">
            {/* What was asked stays in view while the person picks (UAT round 5, R5-F4: the box cleared and the panel did not say). */}
            <p className="bt-quiet">You asked: <q>{which.words}</q></p>
            <p className="bt-quiet">{which.choices.length === 2 ? 'Both of these fit it. Which one is it about?' : 'These fit it. Which one is it about?'}</p>
            <div className="bt-verbs">
              {which.choices.map((c) => <button key={c.target.id} type="button" onClick={() => pickWhich(c.target)}>{c.label}</button>)}
            </div>
          </div>
        )}
        {!p.empty && verbs(scope.kind === 'part' ? SKYE_OPTIONS.filter((o) => o.intent !== 'write_vo') : SKYE_OPTIONS)}
        {p.empty && p.onDraftFromBrief && (
          <button type="button" className="btn" disabled={skye.off || skye.quota || busy || handsOff || asking} onClick={() => void run(() => p.onDraftFromBrief!())}
            title="The Script agent drafts the film from the linked brief alone, in place on the first scene">
            Draft from the brief{p.briefTitle ? ` “${p.briefTitle}”` : ''}
          </button>
        )}
      </div>
      {p.planning && <WorkingCard agent="dex" text="The Director agent is planning the shots from the script." />}
      {skye.working && <WorkingCard agent="skye" text="The Script agent is writing…" />}
      <p className="bt-quiet">Drafts land on the page where they change things, with Keep, Discard and Why. Nothing changes until you choose.</p>
    </Booth>
  )
}
