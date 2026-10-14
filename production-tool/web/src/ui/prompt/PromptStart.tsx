// Make from a prompt (features/prompt-start.clan; ui-behaviour 3.5, 3.10, 3.17; plan item 3 and
// decision 1). One component for every empty node, on its canvas card (CardChromeContext's
// PromptStart slot) and in its editor's empty state:
//
//   Script      "Paste a script, or write the idea in a line." Skye drafts in place, as a suggestion.
//   Storyboard  "Describe the ad in a line"; Dex's nudge "Write a script first?" (script Recommended).
//   Video       Dex's hard block "What should this video be?": Describe it / Link a script / Link a
//               storyboard, primary "15 s · Make it".
//   Image       "Describe the picture"; Wren makes it, then the role picker names it (3.6).
//
// No chat and no cost anywhere: each start is one box or one ask, and the job it starts is today's.

import { useContext, useId, useRef, useState, type ReactNode } from 'react'
import { RouterContext, useDoc, useJobsTick, useServices } from '../../app/context'
import { scriptRoute } from '../../app/route'
import type { Id, RefRole } from '../../contracts/types'
import {
  linkInto, nameMadePicture, pictureFromWords, pictureJob, ROLE_MORE, ROLE_PILLS, scriptFromLine, scriptOf, storyboardFromLine,
  suggestName, videoFromWords, videoSeconds, frameFromWords,
} from '../../jobs/prompt'
import { planOrJoin } from '../../jobs/plan'
import { isActive } from '../../jobs/runner'
import { nameOf } from '../../lib/names'
import { mainStoryboard, refsList } from '../../model/selectors'
import { AgentFigure } from '../agents/AgentFigure'
import { sayer, type CastKey } from '../agents/cast'
import { AskOptions } from '../AskCard'
import { useBlobUrl } from '../hooks'
import { NapkinLoader } from '../loader/NapkinLoader'
import {
  DESCRIBE, insertMention, LINK_SCRIPT, LINK_STORYBOARD, makeItLabel, mentionAt, PLAN_NOW, PROMPT_COPY, promptState, SCRIPT_FIRST,
  storyboardNudge, videoBlock, type PromptKind,
} from './promptStart'
import '../askcard.css'
import './prompt.css'

export interface PromptStartProps {
  kind: PromptKind
  nodeId: Id
  /** Where it sits: a node card on the canvas (default) or an editor's empty state. */
  place?: 'card' | 'editor'
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'That did not work.')
const ROLE_WORD = (r: RefRole) => (r === 'brand_rule' ? 'Brand rule' : r.charAt(0).toUpperCase() + r.slice(1))

/** The start an empty node shows; nothing once it has something. */
export function PromptStart({ kind, nodeId, place = 'card' }: PromptStartProps) {
  useJobsTick()
  const doc = useDoc()
  const state = promptState(doc, kind, nodeId)
  if (!state) return null
  // Keys and pointers stay in the start: the canvas below must not take them as tool keys or drags.
  const guard = { onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(), onPointerDown: (e: React.PointerEvent) => e.stopPropagation() }
  return (
    <div className={`pstart pstart-${place}`} data-prompt-start={kind} {...guard}>
      {state.show === 'script' && <ScriptStart scriptId={nodeId} place={place} />}
      {state.show === 'storyboard' && <StoryboardStart storyboardId={nodeId} fromScript={state.fromScript} place={place} />}
      {state.show === 'video-block' && <VideoBlock videoId={nodeId} />}
      {state.show === 'video-plan' && <StoryboardStart storyboardId={state.storyboardId} fromScript={false} place={place} scopeNode={nodeId} />}
      {state.show === 'image-frame' && <FrameStart shotId={nodeId} />}
      {state.show === 'image-picture' && <PictureStart nodeId={nodeId} />}
    </div>
  )
}

function Signed({ agent, state = 'idle', children }: { agent: CastKey; state?: 'idle' | 'working' | 'needs-you'; children?: ReactNode }) {
  return (
    <div className="pstart-head">
      <AgentFigure agent={agent} size={24} state={state} decorative />
      <span className="askcard-who">{sayer(agent)}</span>
      {children}
    </div>
  )
}

/** The box: Enter sends (Shift+Enter a new line), @ lists the references to pull in. */
function PromptBox({ placeholder, hint, submit, busy, label, autoFocus = false, multiline = false }: {
  placeholder: string
  hint?: string
  submit: (words: string) => Promise<void> | void
  busy: boolean
  label: string
  autoFocus?: boolean
  multiline?: boolean
}) {
  const doc = useDoc()
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  const at = mentionAt(text, caret)
  const names = at ? refsList(doc).map(nameOf).filter((n) => n.includes(at.query)).slice(0, 6) : []
  const send = () => { if (text.trim() && !busy) void submit(text) }
  const insert = (name: string) => {
    if (!at) return
    const r = insertMention(text, at.from, caret, name)
    setText(r.text)
    setCaret(r.caret)
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(r.caret, r.caret) })
  }
  return (
    <div className="pstart-box">
      <label className="pstart-sr" htmlFor={id}>{placeholder}</label>
      <textarea ref={area} id={id} className="input pstart-input" rows={multiline ? 3 : 2} value={text} placeholder={placeholder} title={label}
        autoFocus={autoFocus} disabled={busy}
        onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setPick(0) }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={(e) => {
          if (names.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : names.length - 1)) % names.length); return }
          if (names.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); insert(names[pick] ?? names[0]); return }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
        }} />
      {names.length > 0 && (
        <ul className="pstart-mentions" role="listbox" aria-label="References">
          {names.map((n, i) => <li key={n} role="option" aria-selected={i === pick}><button type="button" onMouseDown={(e) => { e.preventDefault(); insert(n) }}>@{n}</button></li>)}
        </ul>
      )}
      {hint && <span className="pstart-hint faint">{hint}</span>}
    </div>
  )
}

function AtWork({ agent, line }: { agent: CastKey; line: string }) {
  return (
    <div className="pstart-work" role="status">
      <AgentFigure agent={agent} size={24} state="working" decorative />
      <NapkinLoader work={agent === 'wren' ? 'create' : 'plan'} size={16} />
      <span>{line}</span>
    </div>
  )
}

// ── script ──────────────────────────────────────────────────────────────────

function ScriptStart({ scriptId, place }: { scriptId: Id; place: 'card' | 'editor' }) {
  const services = useServices()
  const router = useContext(RouterContext)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const store = services.clan
  const submit = async (words: string) => {
    if (!store) { setError('The Script editor needs this browser to keep the project, and it could not load here.'); return }
    setBusy(true)
    setError(null)
    try {
      const r = await scriptFromLine(services, store, scriptId, words)
      if ('pasted' in r) setNote(`Pasted ${r.pasted} ${r.pasted === 1 ? 'scene' : 'scenes'}.${r.dropped ? ` ${r.dropped}` : ''}`)
      // On the canvas the draft is read and kept in the Script editor, where it lands.
      if (place === 'card') router?.push(scriptRoute(services.project.id, scriptId))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="pstart-card" aria-label="Start the script">
      <Signed agent="skye" />
      <PromptBox placeholder={PROMPT_COPY.script.placeholder} hint={PROMPT_COPY.script.hint} label="The script, or the idea in a line"
        submit={submit} busy={busy} autoFocus={place === 'editor'} multiline={place === 'editor'} />
      {busy && <AtWork agent="skye" line={PROMPT_COPY.script.busy} />}
      {note && <div className="pstart-note" role="status">{note}</div>}
      {error && <div className="pstart-error" role="alert">{error}</div>}
    </section>
  )
}

// ── storyboard (and a linked video's empty storyboard) ──────────────────────

function StoryboardStart({ storyboardId, fromScript, place, scopeNode }: { storyboardId: Id; fromScript: boolean; place: 'card' | 'editor'; scopeNode?: Id }) {
  const services = useServices()
  const router = useContext(RouterContext)
  const doc = useDoc()
  const [line, setLine] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const attempt = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const plan = (words: string) => attempt(() => storyboardFromLine(services, storyboardId, words, scopeNode))
  const scriptFirst = (words: string) => attempt(async () => {
    const scriptId = scriptOf(doc, storyboardId)
    if (!scriptId) throw new Error('This project has no script.')
    if (!services.clan) throw new Error('The Script editor could not load here.')
    await scriptFromLine(services, services.clan, scriptId, words)
    router?.push(scriptRoute(services.project.id, scriptId))
  })

  if (fromScript) {
    return (
      <section className="pstart-card" aria-label="Plan the shots">
        <Signed agent="dex" />
        <p className="pstart-line">{PROMPT_COPY.storyboard.fromScript}</p>
        <div className="pstart-actions">
          <button className="btn sm primary" disabled={busy} onClick={() => void attempt(() => planOrJoin(services, { storyboardId }))}>Plan shots</button>
        </div>
        {busy && <AtWork agent="dex" line={PROMPT_COPY.storyboard.busy} />}
        {error && <div className="pstart-error" role="alert">{error}</div>}
      </section>
    )
  }
  if (line !== null) {
    const q = storyboardNudge(storyboardId)
    return (
      <section className="askcard open pstart-ask" role="group" aria-label={`dex asks: ${q.text}`}>
        <div className="askcard-head">
          <AgentFigure agent="dex" size={28} state="needs-you" decorative />
          <span className="askcard-who">{sayer('dex')}</span>
          <span className="askcard-sp" />
          <button className="askcard-latr" onClick={() => setLine(null)}>Back</button>
        </div>
        <div className="askcard-q">{q.text}</div>
        {q.why && <div className="askcard-why faint">{q.why}</div>}
        <div className="pstart-quote">“{line}”</div>
        <AskOptions q={q} disabled={busy} onPick={(id) => void (id === SCRIPT_FIRST ? scriptFirst(line) : id === PLAN_NOW ? plan(line) : undefined)} />
        <div className="askcard-why faint">{PROMPT_COPY.later}</div>
        {busy && <AtWork agent="dex" line={PROMPT_COPY.storyboard.busy} />}
        {error && <div className="askcard-note" role="alert">{error}</div>}
      </section>
    )
  }
  return (
    <section className="pstart-card" aria-label="Start the storyboard">
      <Signed agent="dex" />
      <PromptBox placeholder={PROMPT_COPY.storyboard.placeholder} hint={PROMPT_COPY.storyboard.hint} label="The ad in a line"
        submit={(w) => setLine(w.trim())} busy={busy} autoFocus={place === 'editor'} />
      {error && <div className="pstart-error" role="alert">{error}</div>}
    </section>
  )
}

// ── video ───────────────────────────────────────────────────────────────────

function VideoBlock({ videoId }: { videoId: Id }) {
  const services = useServices()
  const doc = useDoc()
  const [open, setOpen] = useState<null | typeof DESCRIBE | typeof LINK_SCRIPT | typeof LINK_STORYBOARD>(null)
  const [later, setLater] = useState(false)
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const q = videoBlock(videoId)
  const seconds = videoSeconds(doc, videoId)
  const attempt = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const link = (kind: 'script' | 'storyboard', id: Id) => attempt(() => linkInto(services.doc, { kind, id }, { kind: 'video', id: videoId }))
  const pick = (id: string) => {
    if (id === DESCRIBE) { setOpen(DESCRIBE); return }
    const kind = id === LINK_SCRIPT ? 'script' : 'storyboard'
    const list = Object.values(kind === 'script' ? doc.scripts : doc.storyboards)
    if (list.length === 1) { void link(kind, list[0].id); return }
    if (!list.length) { setError(kind === 'script' ? 'There is no script yet. Make one with + Node.' : 'There is no storyboard yet. Make one with + Node.'); return }
    setOpen(id as typeof LINK_SCRIPT)
  }
  if (later) {
    return (
      <button className="askcard-later" onClick={() => setLater(false)} aria-label={`Waiting for you: ${q.text}`}>
        <AgentFigure agent="dex" size={20} state="needs-you" decorative /><b>Waiting for you</b><span>· {q.text}</span>
      </button>
    )
  }
  const choices = open === LINK_SCRIPT ? Object.values(doc.scripts) : open === LINK_STORYBOARD ? Object.values(doc.storyboards) : []
  return (
    <section className="askcard open pstart-ask" role="group" aria-label={`dex asks: ${q.text}`} data-ask={q.id}>
      <div className="askcard-head">
        <AgentFigure agent="dex" size={28} state="needs-you" decorative />
        <span className="askcard-who">{sayer('dex')}</span>
        <span className="askcard-sp" />
        <button className="askcard-latr" onClick={() => setLater(true)}>Later</button>
      </div>
      <div className="askcard-q">{q.text}</div>
      <div className="askcard-why faint">{q.why}</div>
      <AskOptions q={q} disabled={busy} onPick={pick} />
      {open === DESCRIBE && (
        <form className="pstart-describe" onSubmit={(e) => { e.preventDefault(); void attempt(() => videoFromWords(services, videoId, words)) }}>
          <DescribeBox value={words} onChange={setWords} disabled={busy} onSubmit={() => void attempt(() => videoFromWords(services, videoId, words))} />
          <div className="pstart-actions">
            <button className="btn sm primary" type="submit" disabled={busy || !words.trim()}>{makeItLabel(seconds)}</button>
          </div>
        </form>
      )}
      {choices.length > 1 && (
        <div className="pstart-choices" role="group" aria-label={open === LINK_SCRIPT ? 'Scripts' : 'Storyboards'}>
          {choices.map((c) => (
            <button key={c.id} className="btn sm" disabled={busy} onClick={() => void link(open === LINK_SCRIPT ? 'script' : 'storyboard', c.id)}>
              {c.title?.trim() || (open === LINK_SCRIPT ? 'Script' : 'Storyboard')}
            </button>
          ))}
        </div>
      )}
      {busy && <AtWork agent="dex" line={PROMPT_COPY.video.busy} />}
      {error && <div className="askcard-note" role="alert">{error}</div>}
    </section>
  )
}

/** The Describe it box: a controlled PromptBox ("Type @ to pull in…"). */
function DescribeBox({ value, onChange, disabled, onSubmit }: { value: string; onChange: (v: string) => void; disabled: boolean; onSubmit: () => void }) {
  const doc = useDoc()
  const [caret, setCaret] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const at = mentionAt(value, caret)
  const names = at ? refsList(doc).map(nameOf).filter((n) => n.includes(at.query)).slice(0, 6) : []
  const insert = (name: string) => {
    if (!at) return
    const r = insertMention(value, at.from, caret, name)
    onChange(r.text)
    setCaret(r.caret)
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(r.caret, r.caret) })
  }
  return (
    <div className="pstart-box">
      <textarea ref={area} className="input pstart-input" rows={2} autoFocus value={value} disabled={disabled} placeholder={PROMPT_COPY.video.placeholder}
        aria-label="Describe the video"
        onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart) }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={(e) => {
          if (names.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); insert(names[0]); return }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (value.trim()) onSubmit() }
        }} />
      {names.length > 0 && (
        <ul className="pstart-mentions" role="listbox" aria-label="References">
          {names.map((n) => <li key={n} role="option" aria-selected={false}><button type="button" onMouseDown={(e) => { e.preventDefault(); insert(n) }}>@{n}</button></li>)}
        </ul>
      )}
    </div>
  )
}

// ── image ───────────────────────────────────────────────────────────────────

/** A shot with no frame yet (its Image editor): Wren draws the shot's frame from the words. */
function FrameStart({ shotId }: { shotId: Id }) {
  const services = useServices()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (words: string) => {
    setBusy(true)
    setError(null)
    try {
      await frameFromWords(services, shotId, words)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="pstart-card" aria-label="Start the picture">
      <Signed agent="wren" />
      <PromptBox placeholder={PROMPT_COPY.image.placeholder} hint="Wren draws this shot's frame from it" label="Describe the picture" submit={submit} busy={busy} />
      {error && <div className="pstart-error" role="alert">{error}</div>}
    </section>
  )
}

/** A picture node: Wren makes it from the words, then the role picker says what it is (3.6). */
function PictureStart({ nodeId }: { nodeId: Id }) {
  const services = useServices()
  const doc = useDoc()
  const job = pictureJob(doc, nodeId)
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (w: string) => {
    setBusy(true)
    setError(null)
    setWords(w)
    try {
      await pictureFromWords(services, nodeId, w, mainStoryboard(doc)?.ratio)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  if (job && isActive(job.state)) return <section className="pstart-card"><AtWork agent="wren" line={PROMPT_COPY.image.busy} /></section>
  const made = job?.state === 'completed' ? job.outputs?.[0] : undefined
  if (made && job) return <RolePicker jobId={job.id} nodeId={nodeId} asset={made} words={words || job.text || ''} />
  return (
    <section className="pstart-card" aria-label="Start the picture">
      <Signed agent="wren" />
      <PromptBox placeholder={PROMPT_COPY.image.placeholder} hint={PROMPT_COPY.image.hint} label="Describe the picture" submit={submit} busy={busy} />
      {job?.state === 'failed' && !error && <div className="pstart-error" role="alert">{job.error?.message ?? 'Wren could not make it. Try again.'}</div>}
      {error && <div className="pstart-error" role="alert">{error}</div>}
    </section>
  )
}

/** "What is this picture?": the role pills (and More…), the @name, Save. */
function RolePicker({ jobId, nodeId, asset, words }: { jobId: Id; nodeId: Id; asset: string; words: string }) {
  const services = useServices()
  const doc = useDoc()
  const url = useBlobUrl(asset)
  const [role, setRole] = useState<RefRole>('character')
  const [more, setMore] = useState(false)
  const [name, setName] = useState(() => suggestName(doc, words, 'character'))
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const choose = (r: RefRole) => {
    setRole(r)
    if (!touched) setName(suggestName(doc, words, r))
  }
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await nameMadePicture(services.doc, jobId, { ...name, role }, nodeId)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const roles = more ? [...ROLE_PILLS, ...ROLE_MORE] : ROLE_PILLS
  return (
    <section className="pstart-card pstart-roles" aria-label="Name this picture">
      <Signed agent="wren"><span className="faint">· made it</span></Signed>
      {url && <img className="pstart-pic" src={url} alt={words || 'The picture Wren made'} />}
      <div className="pstart-q">What is it for?</div>
      <div className="pstart-pills" role="radiogroup" aria-label="What it is for">
        {roles.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={role === r} className={`pstart-pill ${role === r ? 'on' : ''}`} onClick={() => choose(r)}>{ROLE_WORD(r)}</button>
        ))}
        {!more && <button type="button" className="pstart-pill ghost" onClick={() => setMore(true)}>More…</button>}
      </div>
      <div className="pstart-name">
        <span className="pt-mono">@</span>
        <input className="input" aria-label="Who or what" value={name.key} onChange={(e) => { setTouched(true); setName({ ...name, key: e.target.value.toLowerCase() }) }} />
        <span className="pt-mono">_</span>
        <input className="input" aria-label="This view" value={name.variant} onChange={(e) => { setTouched(true); setName({ ...name, variant: e.target.value.toLowerCase() }) }} />
      </div>
      <div className="pstart-actions">
        <button className="btn sm primary" disabled={busy} onClick={() => void save()}>Save</button>
      </div>
      {error && <div className="pstart-error" role="alert">{error}</div>}
    </section>
  )
}
