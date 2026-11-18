// The Make room (board Make room): ask for footage. The player with each shot's window, the strip of every
// shot in story order (features/join-or-cut-shots.clan: a box is one generation; between every two shots a
// gap toggle joins them into one video or cuts them apart), each box's takes (in the Box tab, ticked two at a
// time for Compare), and the Direct panel's Shot, Box and Change tabs. Make sends one generation: the new take lands on its
// box's stack and in the Bin, never over an old one, and the Edit room's cut is not touched. Changing a shot
// changes the next take only: the takes there are never marked out of date.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useConfig, useDoc, useJobsTick, useServices, useUi } from '../app/context'
import { choiceToSend, clipRefCapacity, controlsFor, modelChoicesFor } from '../capabilities'
import { CAMERA_ANGLES, CAMERA_MOVEMENTS, type Camera, type CameraMovement, type ModelChoice, type Shot } from '../contracts/types'
import { updateDoc } from '../doc/store'
import { drawFrame, selectedFrame } from '../jobs/frames'
import { makeClip, videoQuality } from '../jobs/clips'
import { makeRuns } from '../jobs/runs'
import { separateSelection, setGap, splitBoxAt, takeShotOut, videoJoin } from '../jobs/runView'
import { isRunning, jobAt, shotRefSet } from '../jobs/select'
import { refName, refsList, shotNumber, shotsOf } from '../model/selectors'
import { boxModel, boxModelCant, boxModelLimit, boxModelNote, entryOf, takeLimits } from './boxModel'
import { boxHow, boxLimit, boxPictures, boxWords, flipWords, fromWords, guideLine, roomBoxModel, stripGaps, withPick, type BoxLimit, type Gap } from './joinCut'
import { CutIcon, GapButton, GapTip, JoinIcon, LimitPanel, StripShot, TakeStills } from './Strip'
import { StripPlayer } from './StripPlayer'
import { Mentions } from './Mentions'
import { roomEmpty } from './emptyState'
import { Float, MenuItem } from '../ui/Float'
import { useSending } from '../ui/hooks'
import { ChangeDrawer, type ChangeOpen } from './ChangeDrawer'
import { cameraWord } from './delta'
import { boxName, boxWindow, genTitle, inBox, makingLine, shotTitle, type Box, type Gen } from './model'
import { Compare } from './Players'
import { Poster } from './Poster'
import type { RoomData, Selection } from './Rooms'
import { appendTake } from './editOps'
import { FrontButtons } from '../stages/FrontsNeeded'
import { plainJobError } from '../jobs/errorWords'
import { ClipChoice } from '../stages/ClipChoice'
import { ShotEditor } from '../script/ShotEditor'
import { scriptMentionHooks } from '../script/mentionHooks'
import { planOrJoin } from '../jobs/plan'
import { addBox, addShotRef, addShotToBox, removeShotRef, setStartFrame, shotRefLinks, startPicture } from './newBox'
import { IMG_DRAG } from './Bin'

type Tab = 'shot' | 'box' | 'change'
const SIZES = ['close', 'medium', 'wide'] as const
const ANGLES = CAMERA_ANGLES.filter((a) => a === 'eye_level' || a === 'high_angle' || a === 'low_angle')
const MOVES: CameraMovement[] = CAMERA_MOVEMENTS.filter((m) => m !== 'crane_down')
const SPEEDS = [{ id: 'slow', label: 'Slow' }, { id: 'normal', label: 'Normal' }, { id: 'fast', label: 'Fast' }] as const


export function MakeRoom({ data, shots, sel, onSel, change, onChange, onCloseChange, onRoom, register, onDone, slot }: {
  data: RoomData
  shots: Shot[]
  sel: Selection
  onSel: (s: Selection) => void
  change: ChangeOpen | null
  onChange: (c: ChangeOpen) => void
  onCloseChange: () => void
  onRoom: (r: 'make' | 'edit') => void
  register: (close: () => void) => () => void
  /** A join or cut was made: Fin says so on the room, with Undo. */
  onDone?: (text: string) => void
  /** The Booth's slot for the Box | Shot | Change panel: there only while a box, shot or take is selected. */
  slot?: HTMLElement | null
}) {
  const { doc: docStore, ui: uiStore, runner, relay } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  const deps = { relay, doc: docStore, ui: uiStore, runner }
  const [tab, setTab] = useState<Tab>(change ? 'change' : 'shot')
  // A change opened from elsewhere (a take's menu, the Bin) shows the Change tab.
  const [seen, setSeen] = useState(change)
  if (seen !== change) {
    setSeen(change)
    if (change) setTab('change')
  }
  const box = data.boxes.find((b) => b.key === sel.boxKey) ?? data.boxes.find((b) => b.shotIds.includes(sel.shotId ?? '')) ?? data.boxes[0]
  const shot = (sel.shotId && box?.shotIds.includes(sel.shotId) ? doc.shots[sel.shotId] : undefined) ?? (box ? doc.shots[box.shotIds[0]] : undefined)
  const shown = data.gens.find((g) => g.id === sel.genId && g.state === 'ready' && inBox(g, box?.key)) ?? data.gens.find((g) => inBox(g, box?.key) && g.state === 'ready')
  const [ticked, setTicked] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [making, send] = useSending()
  // The model picked for a box, kept by shot: a joined box keeps the earlier box's model (joinCut pickedFor).
  const [models, setModels] = useState<Record<string, ModelChoice>>({})
  // The gap whose tip shows, and the gap to focus again after a keyboard flip (its button is drawn anew).
  const [tip, setTip] = useState<{ gap: Gap; el: HTMLElement } | null>(null)
  const refocus = useRef<string | null>(null)
  // Takes made since the room opened show their stills on the box ("Just made").
  const [openedAt] = useState(() => new Date().toISOString())
  useEffect(() => (comparing ? register(() => setComparing(false)) : undefined), [comparing, register])
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    const el = document.querySelector<HTMLButtonElement>(`.jc-gap[data-gap="${id}"]`)
    if (!el) return
    refocus.current = null
    el.focus()
  })

  const pickShot = (b: Box, id: string) => { onSel({ ...sel, boxKey: b.key, shotId: id }); setTab('shot') }
  const pickBox = (b: Box) => { onSel({ ...sel, boxKey: b.key, shotId: b.shotIds.includes(sel.shotId ?? '') ? sel.shotId : b.shotIds[0] }); setTab('box') }
  const pickTake = (g: Gen, b?: Box) => onSel({ ...sel, genId: g.id, boxKey: b && inBox(g, b.key) ? b.key : g.boxKey })
  const tick = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t.slice(-1), id]))
  const busy = (id: string) => isRunning(doc, jobAt(doc, ui, (c) => (c.for === 'clip' && c.shotId === id) || (c.for === 'run' && !!doc.videos[c.videoId]?.runs?.[c.runId]?.shot_ids.includes(id))))

  // The strip: a gap before every shot but the first; what each box sends and its limits on its model.
  const gaps = stripGaps(doc, data.boxes, data.videoId, config)
  const gapAt = new Map(gaps.map((g) => [g.shotId, g]))
  const declined = ui.declinedAdds ?? {}
  const facts = new Map(data.boxes.map((b) => {
    const pics = boxPictures(doc, b, declined)
    const model = roomBoxModel(doc, b, config, models)
    return [b.key, { pics, model, limit: boxLimit(doc, b, model, config, pics), words: boxWords(doc, b, pics) }] as const
  }))
  const tipWords = tip ? flipWords(doc, ui, data.videoId, config, tip.gap, models) : undefined
  // The boxes a flip would touch, drawn dashed while its tip shows.
  const preview = tip && !tip.gap.blocked ? new Map(data.boxes.filter((b) => {
    const i = shots.findIndex((s) => s.id === tip.gap.shotId)
    return b.shotIds.includes(tip.gap.shotId) || (i > 0 && b.shotIds.includes(shots[i - 1].id))
  }).map((b) => [b.key, tip.gap.joined ? 'cut' : 'join'] as const)) : undefined

  /** Flip a gap: a cut there joins the two shots into one video; a join there cuts them apart. One History
   *  entry, one undo step (jobs/runView joinHere / splitHere); Fin says so in the Booth with Undo. */
  const flip = async (g: Gap, keyboard: boolean) => {
    if (g.blocked) return
    setError(null)
    setNotice(null)
    try {
      await setGap(docStore, data.videoId, g.shotId, g.joined ? 'cut' : 'continue', data.boxes.map((b) => b.shotIds))
      onDone?.(g.joined ? `Cut between shots ${g.n - 1} and ${g.n}: two videos now.` : `Joined shots ${g.n - 1} and ${g.n}: one video now.`)
      if (keyboard) refocus.current = g.shotId
      else setTip(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }
  /** The limit panel's "Cut before shot N". */
  const cutBefore = async (shotId: string) => {
    const n = shotNumber(doc, shotId)
    try {
      await setGap(docStore, data.videoId, shotId, 'cut', data.boxes.map((b) => b.shotIds), `cut before shot ${n}`)
      onDone?.(`Cut before shot ${n}: two videos now.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  }

  /** One shot out of its box (Change tab's "Make shot N apart instead", the Shot tab), or the box split before a
   *  shot: the join changes, then the shot's new box is picked on the Box tab, where Make is (finding 10). */
  const reshape = (shotId: string, how: 'out' | 'split') => send(async () => {
    setError(null)
    try {
      if (how === 'out') await takeShotOut(docStore, data.videoId, shotId)
      else await splitBoxAt(docStore, data.videoId, shotId)
      onCloseChange()
      onSel({ shotId })
      setTab('box')
      const n = shotNumber(docStore.get(), shotId)
      setNotice(how === 'out' ? `Shot ${n} is a box of its own now. Make it from the Box tab; the takes you have stay.` : `The box now ends before shot ${n}. Each part is made on its own Make.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })

  /** Make on a box: one generation of its shots. It lands as a new take; the cut is not touched. A box past
   *  its model's limits is never sent (its Make is off; the box says why). */
  const make = (b: Box) => send(async () => {
    setError(null)
    setNotice(null)
    try {
      const f = facts.get(b.key)
      if (f?.limit?.hard) { setError(f.limit.why); return }
      const choice = choiceToSend('clip', config, roomBoxModel(doc, b, config, models))
      if (videoJoin(doc, data.videoId, config) === 'film') {
        const failed = await makeRuns(deps, { videoId: data.videoId, shotIds: [b.shotIds[0]], config, again: true, busy, ...(choice ? { modelChoice: choice } : {}), quality: videoQuality(doc, data.videoId) })
        if (failed.length) setError(failed.join(' '))
      } else {
        const shotId = b.shotIds[0]
        const shot = doc.shots[shotId]
        const hasFrame = !!selectedFrame(doc, shotId) || !!startPicture(doc, shotId)
        // A character can only reach a clip through a frame (a clip from words is text-to-video, which
        // drops every reference). So a character shot with no frame makes the FRAME first — image
        // generation DOES use the @on views, so the character appears — and the person animates that
        // frame next. Without this, Make quietly produced a character-less video (owner 2026-11-04).
        const hasCharacter = (() => { try { return !!shot && shotRefSet(doc, shot).some((x) => x.ref.role === 'character') } catch { return false } })()
        const idx = shot ? shotsOf(doc, shot.storyboard_id).findIndex((s) => s.id === shotId) : -1
        if (shot && !hasFrame && hasCharacter && idx >= 0) {
          await drawFrame(deps, idx, 'first', { storyboardId: shot.storyboard_id })
          setNotice('Making the picture of your character first — animate it once it lands (a clip can only show @names through a frame).')
        } else {
          // No frame and no character: the clip is made from the shot's words (a new box, or straight from the script).
          const fromWords = !hasFrame && !!shot?.action?.trim()
          await makeClip(deps, shotId, { videoId: data.videoId, ...(choice ? { modelChoice: choice } : {}), ...(fromWords ? { fromWords } : {}) })
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })

  // What to do when there is nothing here yet (owner, 2026-10-21): plan the shots, fix what stopped the
  // plan (a bare @key with no front: the same Choose Kapi's front as the Storyboard), or make a first take.
  const empty = roomEmpty(doc, docStore.get(), data.videoId, shots.length, data.gens.length)
  /** + New box: a shot of its own at the end, selected in the Shot tab to be written. */
  const newBox = () => send(async () => {
    setError(null)
    try {
      const id = await addBox(docStore, data.videoId)
      onSel({ shotId: id })
      setTab('shot')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })
  const tryPlan = () => send(async () => {
    setError(null)
    try {
      if (empty.storyboardId) await planOrJoin(deps, { storyboardId: empty.storyboardId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    }
  })
  const openStoryboard = () => uiStore.update((u) => {
    if (empty.storyboardId) u.openNode = { ...u.openNode, storyboard: empty.storyboardId }
    u.stage = 'storyboard'
  }, 'stage')

  const compareGens = ticked.map((id) => data.gens.find((g) => g.id === id)).filter((g): g is Gen => !!g && g.state === 'ready')
  const tipEnd = () => setTip(null)

  return (
    <div className="rm-make">
      <section className="rm-centre jc-centre" aria-label="Takes and boxes">
        <ClipChoice videoId={data.videoId} />
        {comparing && compareGens.length === 2 ? (
          <Compare a={{ sha: compareGens[1].asset, label: `${genTitle(compareGens[1], data.boxes)} · ${compareGens[1].label}` }}
            b={{ sha: compareGens[0].asset, label: `${genTitle(compareGens[0], data.boxes)} · ${compareGens[0].label}` }}
            onClose={() => setComparing(false)} />
        ) : (
          <StripPlayer key={`${shown?.id ?? 'none'}:${box?.key ?? ''}`} box={box?.endCard ? undefined : box} take={shown} shotId={sel.shotId} words={!!box && fromWords(doc, box)}>
            {compareGens.length === 2 && (
              <button type="button" className="btn sm" onClick={() => setComparing(true)} title="Play the two ticked takes side by side">Compare</button>
            )}
          </StripPlayer>
        )}
        {error && <div role="alert" className="rm-error">{error}<FrontButtons text={error} /></div>}
        {notice && <div role="status" className="rm-note">{notice}</div>}
        {empty.kind === 'no-shots' && (
          <div className="rm-emptystate" role="status">
            {empty.planning ? <p>The Director agent is planning the shots from the script…</p> : (
              <>
                <p>{empty.why ?? 'No shots yet. Make a box from words, or plan the shots in the Storyboard first.'}{empty.why && <FrontButtons text={empty.why} />}</p>
                <div className="btns">
                  <button type="button" className="btn primary" disabled={making} onClick={() => void newBox()}>+ New box</button>
                  {empty.canPlan && <button type="button" className="btn" disabled={making} onClick={() => void tryPlan()}>{empty.why ? 'Try again' : 'Plan shots'}</button>}
                  <button type="button" className="btn" onClick={openStoryboard}>Open the Storyboard</button>
                </div>
              </>
            )}
          </div>
        )}
        <div className="boxes-h jc-bh">
          <b>Boxes</b>
          <span>Shots in story order. <span className="jc-key"><JoinIcon /></span> joined: one video. <span className="jc-key cut"><CutIcon /></span> cut: a new video. Click a gap to switch it.</span>
        </div>
        <div className="jc-strip" role="group" aria-label="Shots in story order">
          {data.boxes.map((b, i) => {
            const before = i > 0 ? gapAt.get(b.shotIds[0]) : undefined
            const f = facts.get(b.key)!
            return (
              <div key={b.key} className="jc-unit">
                {before && <GapButton gap={before} onFlip={(g, k) => void flip(g, k)} onTip={(g, el) => setTip({ gap: g, el })} onTipEnd={tipEnd} />}
                {b.endCard ? <EndCardTile b={b} shot={doc.shots[b.shotIds[0]]} onEdit={() => onRoom('edit')} /> : (
                  <BoxCard b={b} sel={tab === 'shot' ? sel : { ...sel, shotId: undefined }} since={openedAt} selected={!!(sel.boxKey || sel.shotId) && b.key === box?.key} making={making || b.shotIds.some(busy)} words={f.words} limit={f.limit}
                    model={f.model} gaps={gapAt} preview={preview?.get(b.key)} takes={data.gens.filter((g) => inBox(g, b.key))}
                    onShot={(id) => pickShot(b, id)} onBox={() => pickBox(b)} onMake={() => void make(b)} onTake={(g) => pickTake(g, b)}
                    onFlip={(g, k) => void flip(g, k)} onTip={(g, el) => setTip({ gap: g, el })} onTipEnd={tipEnd}
                    onUse={f.limit?.alt ? () => setModels(withPick(models, b, f.limit!.alt!.choice)) : undefined}
                    onCut={f.limit?.cutBefore ? () => void cutBefore(f.limit!.cutBefore!) : undefined} />
                )}
              </div>
            )
          })}
        </div>
        <div className="jc-after">
          <button type="button" className="btn" disabled={making} onClick={() => void newBox()}
            title="A new box: a video made from your words and references, no storyboard frame needed">+ New box</button>
        </div>
        {tip && tipWords && <GapTip anchor={tip.el} words={tipWords} />}
      </section>
      {slot && createPortal(<div className="rm-direct" aria-label="Direct">
        <div className="rm-tabs" role="tablist" aria-label="Direct">
          {(['box', 'shot', 'change'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'shot' ? 'Shot' : t === 'box' ? 'Box' : 'Change'}</button>
          ))}
        </div>
        <div className="rm-directbody">
          {tab === 'shot' && !(shot && box) && <p className="rm-note rm-pad">{shots.length ? 'Select a shot in a box to direct it.' : 'No shots yet. Once the Storyboard has them, select one here to direct it.'}</p>}
          {tab === 'box' && !box && <p className="rm-note rm-pad">{shots.length ? 'Select a box to set how it is made.' : 'No boxes yet: each shot becomes a box once the Storyboard has shots.'}</p>}
          {tab === 'shot' && shot && box && <ShotTab key={shot.id} shot={shot} n={shotNumber(doc, shot.id)} box={box} data={data} onBox={() => setTab('box')}
            onOut={() => void reshape(shot.id, 'out')} onSplit={() => void reshape(shot.id, 'split')} busy={making}
            onAddShot={() => void send(async () => { const id = await addShotToBox(docStore, data.videoId, box.shotIds); onSel({ shotId: id }) })} />}
          {tab === 'box' && box && !box.endCard && <BoxTab key={box.key} box={box} data={data} sel={sel} facts={facts.get(box.key)!}
            onModel={(m) => setModels(withPick(models, box, m))} onMake={() => void make(box)} making={making || box.shotIds.some(busy)}
            ticked={ticked} onTick={tick} onTake={(g) => pickTake(g, box)}
            onChange={(g) => onChange({ parentId: g.id, ...(sel.shotId && g.shotIds.includes(sel.shotId) ? { shotId: sel.shotId } : {}) })}
            onAddToEdit={(g) => void appendTake(docStore, doc, data, g, box)}
            onSeparate={() => void separateSelection(docStore, data.videoId, box.shotIds).then(() => onDone?.(`${boxName(box)}’s shots are separate videos now.`))} />}
          {tab === 'change' && (() => {
            const parent = change ? data.gens.find((g) => g.id === change.parentId) : (shown && inBox(shown, box?.key) ? shown : data.gens.find((g) => inBox(g, box?.key) && g.state === 'ready'))
            if (!parent) return <p className="rm-note rm-pad">Make a take of this box first. Then change one thing and make it again.</p>
            const open: ChangeOpen = change ?? { parentId: parent.id, ...(shot && parent.shotIds.includes(shot.id) ? { shotId: shot.id } : {}) }
            return <ChangeDrawer key={`${open.parentId}:${open.shotId ?? ''}:${open.words ?? ''}`} data={data} open={open} variant="tab" onClose={() => { onCloseChange(); setTab('shot') }}
              onMade={(g) => { onCloseChange(); if (g) { onSel({ ...sel, genId: g }); } }} onApart={(shotId) => void reshape(shotId, 'out')} />
          })()}
        </div>
      </div>, slot)}
    </div>
  )
}

type BoxFacts = { pics: ReturnType<typeof boxPictures>; model: ModelChoice | undefined; limit: BoxLimit | undefined; words: { title: string; sub: string } }

/** A box of the strip (mock join-or-cut-v1): what Make will do (no prices), its shots with the joined gaps
 *  between them, its limits on its model, the stills of its newest take (one per shot window), and Make. */
function BoxCard({ b, selected, sel, since, making, takes, words, limit, model, gaps, preview, onShot, onBox, onMake, onTake, onFlip, onTip, onTipEnd, onUse, onCut }: {
  b: Box; selected: boolean; sel: Selection; since: string; making: boolean; takes: Gen[]
  words: { title: string; sub: string }; limit?: BoxLimit; model?: ModelChoice; gaps: Map<string, Gap>; preview?: 'join' | 'cut'
  onShot: (id: string) => void; onBox: () => void; onMake: () => void; onTake: (g: Gen) => void
  onFlip: (g: Gap, keyboard: boolean) => void; onTip: (g: Gap, el: HTMLElement) => void; onTipEnd: () => void
  onUse?: () => void; onCut?: () => void
}) {
  const doc = useDoc()
  const differs = useMemo(() => nextDiffers(doc, b, takes), [doc, b, takes])
  const top = takes.find((g) => g.state === 'ready')
  const has = !!top
  const over = !!limit?.hard
  // A Make the relay refused or that failed (no take for it): said on the box, never silent.
  const ui = useUi()
  const lastJob = jobAt(doc, ui, (c) => (c.for === 'clip' && b.shotIds.includes(c.shotId)) || (c.for === 'run' && !!doc.videos[c.videoId]?.runs?.[c.runId]?.shot_ids.some((id) => b.shotIds.includes(id))))
  const failedJob = lastJob ? doc.jobs[lastJob] : undefined
  // A take that landed after the failure answers it: the note goes (it stayed under a good take, full test 2026-11-04).
  const answered = !!failedJob?.created_at && takes.some((g) => g.state === 'ready' && !!g.createdAt && g.createdAt > failedJob.created_at!)
  const failedLine = !answered && failedJob?.state === 'failed' && failedJob.error ? plainJobError(failedJob.error, failedJob.op).message : undefined
  const makingNow = takes.find((g) => g.state === 'making')
  const fresh = !!top?.createdAt && top.createdAt > since
  const modelLabel = b.together && model && !fromWords(doc, b) ? entryOf(model)?.label : undefined
  const title = `${boxName(b)}: ${words.title}`
  return (
    <section className={`jc-box ${b.together ? 'multi' : 'one'} ${selected ? 'sel' : ''} ${over ? 'over' : ''} ${preview ? `pv pv-${preview}` : ''}`} aria-label={title}>
      <button type="button" className="jc-bhd" onClick={onBox} title={`${title}. Open the Box tab`}>
        <span className="jc-kick">{boxName(b)}</span>
        <b>{words.title}</b>
        <span className="jc-sub"><Mentions text={words.sub} /></span>
      </button>
      <div className="jc-row">
        {b.shotIds.map((id, i) => {
          const g = i > 0 ? gaps.get(id) : undefined
          return (
            <Fragment key={id}>
              {g && <GapButton gap={g} suggest={over && limit?.cutBefore === id} onFlip={onFlip} onTip={onTip} onTipEnd={onTipEnd} />}
              <StripShot id={id} picked={sel.shotId === id && selected} onPick={() => onShot(id)} />
            </Fragment>
          )
        })}
      </div>
      {limit && <LimitPanel limit={limit} onUse={onUse} onCut={onCut} cutN={limit.cutBefore ? shotNumber(doc, limit.cutBefore) : undefined} />}
      {differs && <div className="rm-differs rm-clamp2" title={`Next take differs: ${differs}`}>Next take differs: {differs}</div>}
      {failedLine && <div className="rm-error" role="alert">The last Make did not work: {failedLine}<FrontButtons text={failedLine} /></div>}
      {top && b.together && fresh && <TakeStills take={top} box={b} fresh={fresh} />}
      <footer className="jc-bft">
        <button type="button" className="btn primary sm" disabled={making || over} onClick={onMake}
          title={over ? limit!.why : differs ? `The next take differs: ${differs}` : has ? 'Make another take of this box' : 'Make this box'}>
          {making ? 'Making…' : differs || has ? 'Make new take' : 'Make'}
        </button>
        {makingNow && <span className="jc-tk making" title={makingNow.label}>v{makingNow.version}</span>}
        {top && !(b.together && fresh) && <button type="button" className="jc-tk" onClick={() => onTake(top)} title={`Play v${top.version} · ${top.label}`}>v{top.version}</button>}
        {modelLabel && <span className="jc-model" title={modelLabel}>{modelLabel}</span>}
      </footer>
    </section>
  )
}

function TakeRow({ g, data, atS, picked, ticked, onTick, onPlay, onChange, onAddToEdit }: {
  g: Gen; data: RoomData; atS?: number; picked: boolean; ticked: boolean; onTick: () => void; onPlay: () => void; onChange: () => void; onAddToEdit: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<false | 'menu' | 'lineage'>(false)
  const close = useCallback(() => setMenu(false), [])
  const ready = g.state === 'ready'
  // While it is being made, the runner says where it is (a landed take not yet downloaded: Checking, with why).
  const { runner } = useServices()
  const doc = useDoc()
  useJobsTick()
  const making = g.state === 'making' ? makingLine(g.jobId ? runner.liveInfo(g.jobId) : undefined, g.jobId ? doc.jobs[g.jobId]?.state : undefined) : undefined
  const parent = g.parentId ? data.gens.find((x) => x.id === g.parentId) : undefined
  const kids = data.gens.filter((x) => x.parentId === g.id)
  return (
    <div ref={ref} className={`rm-take ${picked ? 'sel' : ''} ${g.state}`} onContextMenu={(e) => { e.preventDefault(); if (ready) setMenu('menu') }}>
      <label className="rm-tick" title={ready ? 'Tick two to compare' : undefined}>
        <input type="checkbox" checked={ticked} disabled={!ready} onChange={onTick} aria-label={`Tick v${g.version} to compare`} />
      </label>
      <button type="button" className="rm-takebtn" onClick={onPlay} disabled={!ready} title={`v${g.version} · ${g.label}`}>
        <Poster sha={g.asset} atS={atS ?? g.segments[0]?.inS ?? 0} words={g.state === 'making' ? '' : 'v' + g.version} className="rm-takethumb" />
        {g.state === 'making' && <span className="rm-spin" aria-hidden="true" />}
        <span className="rm-takelabel rm-clamp2" title={making}><b>v{g.version}</b> · {making ?? g.label}</span>
      </button>
      <button type="button" className="rm-iconbtn ghost" aria-label={`More for v${g.version}`} aria-haspopup="menu" disabled={!ready} onClick={() => setMenu(menu ? false : 'menu')}>⋯</button>
      <Float anchor={ref} open={!!menu} onClose={close} align="end" role={menu === 'lineage' ? 'dialog' : 'menu'} label={`v${g.version}`} className="rm-lineage">
        {menu === 'lineage' ? (
          <div className="rm-lineagebody">
            <div className="rm-floathead">Lineage</div>
            {parent && <><div className="rm-linrow"><span className="pt-mono">v{parent.version}</span><span className="rm-clamp1" title={parent.label}>{parent.label}</span></div><div className="rm-linarrow" aria-hidden="true">↓</div></>}
            <div className="rm-linrow cur"><span className="pt-mono">v{g.version}</span><span className="rm-clamp1" title={g.label}>{g.label}</span></div>
            {kids.map((c) => <div key={c.id}><div className="rm-linarrow" aria-hidden="true">↓</div><div className="rm-linrow"><span className="pt-mono">v{c.version}</span><span className="rm-clamp1" title={c.label}>{c.label}</span></div></div>)}
            <button type="button" className="btn rm-wide" onClick={close}>Close</button>
          </div>
        ) : (
          <>
            <MenuItem icon="✎" onSelect={() => { close(); onChange() }}>New take with a change…</MenuItem>
            <MenuItem icon="＋" onSelect={() => { close(); onAddToEdit() }}>Add to edit</MenuItem>
            <MenuItem icon="⟲" onSelect={() => setMenu('lineage')}>Show lineage</MenuItem>
          </>
        )}
      </Float>
    </div>
  )
}

function EndCardTile({ b, shot, onEdit }: { b: Box; shot?: Shot; onEdit: () => void }) {
  return (
    <section className="rm-box endcard" aria-label="End card">
      <header className="rm-boxtop"><span className="rm-boxtitle rm-clamp2">End card · {Math.round(b.lengthS * 10) / 10} s</span></header>
      <div className="rm-cardtile" aria-hidden="true"><span className="rm-clamp2">{shot?.action?.trim() || 'Card'}</span></div>
      <p className="rm-note">Not made by a model. Its words, logo and colour are set in the Edit room.</p>
      <button type="button" className="btn rm-wide" onClick={onEdit}>Edit in the Edit room</button>
    </section>
  )
}

/** What the next take of a box differs in from its newest take: "shot 3 camera Handheld". */
function nextDiffers(d: ReturnType<typeof useDoc>, b: Box, takes: Gen[]): string | undefined {
  const top = takes.find((g) => g.state === 'ready')
  const sent = top ? d.generations?.[top.id]?.inputs?.camera : undefined
  if (!sent) return undefined
  for (const id of b.shotIds) {
    const now = d.shots[id]?.camera
    const was = sent[id]
    if (!now || !was) continue
    if ((now.movement ?? 'static') !== (was.movement ?? 'static')) return `shot ${shotNumber(d, id)} camera ${cameraWord('movement', now.movement)}`
    if (now.size !== was.size) return `shot ${shotNumber(d, id)} ${cameraWord('size', now.size).toLowerCase()}`
  }
  return undefined
}

/** The Shot tab: the shot's camera, its start and end frames, its cast and look, its length. Changes apply
 *  to the next take only. */
function ShotTab({ shot, n, box, data, onBox, onAddShot, onOut, onSplit, busy }: {
  shot: Shot; n: number; box: Box; data: RoomData; onBox: () => void; onAddShot: () => void; onOut: () => void; onSplit: () => void; busy: boolean
}) {
  const { doc: docStore, clan } = useServices()
  const mentions = useMemo(() => (clan ? scriptMentionHooks(clan, undefined) : undefined), [clan])
  const [over, setOver] = useState(false)
  const doc = useDoc()
  const { config } = useConfig()
  const set = (patch: Partial<Camera>, why: string) => void updateDoc(docStore, (d) => {
    const s = d.shots[shot.id]
    if (s) s.camera = { ...s.camera, ...patch }
  }, why)
  const setLength = (v: number) => void updateDoc(docStore, (d) => {
    const s = d.shots[shot.id]
    if (s) s.duration_s = Math.max(0.5, Math.min(15, Math.round(v * 10) / 10))
  }, `shot ${n} length`)
  const frame = selectedFrame(doc, shot.id)
  const start = frame ? undefined : startPicture(doc, shot.id)
  const i = box.shotIds.indexOf(shot.id)
  const nextFrame = i >= 0 && i < box.shotIds.length - 1 ? selectedFrame(doc, box.shotIds[i + 1]) : undefined
  // The references on a shot go onto its FRAME (image generation carries them into the clip via the
  // frame-first flow), so the ceiling is the frame/image character limit, not the clip model's video
  // ref capacity (which is 0 for Veo). controlsFor reads the generate op (owner 2026-11-04).
  const refsMax = controlsFor(config).generateCharacters || 4
  const differs = nextDiffers(doc, box, data.gens.filter((g) => inBox(g, box.key)))
  return (
    <div className="rm-tab">
      <div className="rm-tabhead">
        <span className="rm-kicker pt-mono">Shot {n} · {boxName(box)}</span>
        <b className="rm-clamp2" title={shotTitle(shot, n)}>{shotTitle(shot, n)}</b>
      </div>
      {differs && <div className="rm-banner info" role="status">Next take differs: {differs}. The takes you have stay as they are.</div>}
      <fieldset className="rm-field">
        <legend className="rm-label">What happens</legend>
        {clan ? <ShotEditor store={clan} shotId={shot.id} name={`Shot ${n}`} compact mentions={mentions} />
          : <p className="rm-note">{shot.action || 'No words yet.'}</p>}
        <p className="rm-note">Type @ to name a person or thing. A bare @name needs its front.</p>
      </fieldset>
      <fieldset className="rm-field">
        <legend className="rm-label">References</legend>
        <RefPicker shot={shot} max={refsMax} />
      </fieldset>
      <fieldset className="rm-field">
        <legend className="rm-label">Camera</legend>
        <div className="rm-row"><span className="rm-rowname">Size</span>
          <div className="rm-chiprow" role="radiogroup" aria-label="Size">
            {SIZES.map((s) => <button key={s} type="button" role="radio" aria-checked={shot.camera.size === s} className={`rm-chip ${shot.camera.size === s ? 'on' : ''}`} onClick={() => set({ size: s }, `shot ${n} size`)}>{cameraWord('size', s)}</button>)}
          </div>
        </div>
        <div className="rm-row"><span className="rm-rowname">Angle</span>
          <div className="rm-chiprow" role="radiogroup" aria-label="Angle">
            {ANGLES.map((a) => <button key={a} type="button" role="radio" aria-checked={(shot.camera.angle ?? 'eye_level') === a} className={`rm-chip ${(shot.camera.angle ?? 'eye_level') === a ? 'on' : ''}`} onClick={() => set({ angle: a }, `shot ${n} angle`)}>{cameraWord('angle', a)}</button>)}
          </div>
        </div>
        <div className="rm-rowname">Movement</div>
        <div className="rm-movegrid" role="radiogroup" aria-label="Movement">
          {MOVES.map((m) => <button key={m} type="button" role="radio" aria-checked={(shot.camera.movement ?? 'static') === m} className={`rm-chip ${(shot.camera.movement ?? 'static') === m ? 'on' : ''}`} onClick={() => set({ movement: m }, `shot ${n} camera movement`)}>{cameraWord('movement', m)}</button>)}
        </div>
        <div className="rm-row"><span className="rm-rowname">Speed</span>
          <div className="rm-chiprow" role="radiogroup" aria-label="Camera speed">
            {SPEEDS.map((s) => <button key={s.id} type="button" role="radio" aria-checked={(shot.camera.movement_speed ?? 'normal') === s.id} className={`rm-chip ${(shot.camera.movement_speed ?? 'normal') === s.id ? 'on' : ''}`} onClick={() => set({ movement_speed: s.id }, `shot ${n} camera speed`)}>{s.label}</button>)}
          </div>
        </div>
      </fieldset>
      <fieldset className="rm-field">
        <legend className="rm-label">Start and end frame</legend>
        <div className="rm-wells">
          <div className={`rm-well ${over ? 'over' : ''}`} aria-label="Start frame: drop a Bin picture here"
            onDragOver={(e) => { if (e.dataTransfer.types.includes(IMG_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true) } }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { const refId = e.dataTransfer.getData(IMG_DRAG); setOver(false); if (refId) { e.preventDefault(); void setStartFrame(docStore, shot.id, refId) } }}>
            <span className="rm-rowname">{box.together ? 'Guide' : 'Starts on'}</span><Poster sha={frame?.asset ?? start?.sha} words="Optional: drop a Bin picture" />
            {start?.refId && <button type="button" className="btn link" onClick={() => void setStartFrame(docStore, shot.id, null)}>Clear</button>}
          </div>
          <div className={`rm-well ${box.together ? 'off' : ''}`}><span className="rm-rowname">Ends on</span>
            {box.together ? <div className="rm-poster empty"><span className="rm-clamp2">Not when shots are made together</span></div> : <Poster sha={nextFrame?.asset} words="Nothing set" />}
          </div>
        </div>
        {box.together && (frame || start)
          ? <p className="rm-note">Image {box.shotIds.filter((id, k) => k <= i && (!!selectedFrame(doc, id) || !!startPicture(doc, id))).length} of {boxName(box)}’s guides. Shot {n} follows it; it is not pinned, and no shot made together ends on a set frame.</p>
          : box.together ? <p className="rm-note">No frame: shot {n} is made from its words, with the others as one video.</p>
            : frame || start ? <p className="rm-note">The video starts on this frame.</p> : null}
        {box.together && <button type="button" className="btn link rm-linkrow" onClick={onBox}>Box settings</button>}
      </fieldset>
      {box.together && (
        <fieldset className="rm-field">
          <legend className="rm-label">In this box</legend>
          <p className="rm-note">Shot {n} is made with {box.shotIds.length - 1 === 1 ? 'one other shot' : `${box.shotIds.length - 1} other shots`} as one video.</p>
          <div className="rm-row wrap">
            <button type="button" className="btn" disabled={busy} onClick={onOut} title={`Shot ${n} becomes a box of its own; the shots around it stay as they are`}>Make shot {n} on its own</button>
            {i > 0 && <button type="button" className="btn" disabled={busy} onClick={onSplit} title={`The box ends after shot ${n - 1}; shot ${n} and the shots after it are the next box`}>Split the box before shot {n}</button>}
          </div>
        </fieldset>
      )}
      <fieldset className="rm-field">
        <legend className="rm-label">Length</legend>
        <div className="rm-row">
          <button type="button" className="rm-iconbtn" aria-label="Shorter" onClick={() => setLength(shot.duration_s - 0.5)}>−</button>
          <span className="pt-mono rm-len">{shot.duration_s.toFixed(1)} s</span>
          <button type="button" className="rm-iconbtn" aria-label="Longer" onClick={() => setLength(shot.duration_s + 0.5)}>+</button>
        </div>
      </fieldset>
      {box.shotIds.at(-1) === shot.id && (
        <button type="button" className="btn rm-wide" onClick={onAddShot} title="Several shots in one video: add a shot made together with this one">+ Add a shot to this box</button>
      )}
      <p className="rm-note">Changes here make the next take. The takes you have stay as they are.</p>
    </div>
  )
}

/** A shot's references: ref→shot links, picked from the Bin's named pictures, at most the model's limit. */
function RefPicker({ shot, max }: { shot: Shot; max: number }) {
  const doc = useDoc()
  const { doc: docStore } = useServices()
  const [q, setQ] = useState('')
  const [why, setWhy] = useState<string | null>(null)
  const links = shotRefLinks(doc, shot.id)
  const chosen = new Set(links.map((l) => l.from.id))
  // References this shot inherits from the script/storyboard it belongs to (not chosen here): a
  // character linked to the Script reaches every shot its Video makes, so it shows as used, not lost
  // (owner 2026-11-04). Guarded: shotRefSet throws on an @name with no picture.
  const inherited = (() => { try { return shotRefSet(doc, shot).filter((x) => !chosen.has(x.ref.id)) } catch { return [] as ReturnType<typeof shotRefSet> } })()
  const all = refsList(doc).filter((r) => r.asset && !chosen.has(r.id))
  const typed = q.trim().replace(/^@/, '').toLowerCase()
  const offer = typed ? all.filter((r) => refName(r).includes(typed)).slice(0, 8) : []
  const full = links.length >= max
  const add = (id: string) => { setQ(''); setWhy(null); void addShotRef(docStore, shot.id, id, max).catch((e) => setWhy(e instanceof Error ? e.message : 'That did not work.')) }
  const label = (l: { from: { kind: string; id: string } }) => (l.from.kind === 'key' ? `@${doc.keys[l.from.id]?.key}` : doc.refs[l.from.id] ? `@${refName(doc.refs[l.from.id])}` : '@?')
  return (
    <div className="rm-refpick">
      <div className="rm-chiprow wrap">
        {links.map((l) => (
          <span key={l.id} className="rm-chip static">{label(l)}
            <button type="button" className="rm-chipx" aria-label={`Remove ${label(l)}`} onClick={() => void removeShotRef(docStore, l.id)}>×</button>
          </span>
        ))}
        {!links.length && !inherited.length && <span className="rm-faint">None chosen. Names typed with @ in the words go too.</span>}
      </div>
      {inherited.length > 0 && (
        <div className="rm-chiprow wrap rm-inherited">
          <span className="rm-faint">From the script:</span>
          {inherited.map((x) => <span key={x.ref.id} className="rm-chip static auto" title="Linked to the Script that drives this video">@{refName(x.ref)}</span>)}
        </div>
      )}
      <input className="input rm-refsearch" aria-label="Add a reference" placeholder={full ? `Up to ${max} for this model` : 'Add a reference: type @name'} disabled={full}
        value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && offer[0]) add(offer[0].id) }} />
      {offer.length > 0 && (
        <div className="rm-chiprow wrap" role="listbox" aria-label="References to add">
          {offer.map((r) => <button key={r.id} type="button" role="option" aria-selected={false} className="rm-chip" onClick={() => add(r.id)}>@{refName(r)}</button>)}
        </div>
      )}
      {why && <p className="rm-note" role="alert">{why}</p>}
      <p className="rm-note">Up to {max} for this model.</p>
    </div>
  )
}


/** The Box tab (mock join-or-cut-v1): what the box is, One video / Separate videos, what Fin sends (each frame
 *  as Image k → shot n, then the characters' pictures), the models (those that cannot make it greyed with why;
 *  the one it is on marked when it is past its limits), Make, and the box's takes, ticked two for Compare. */
function BoxTab({ box, data, sel, facts, onModel, onMake, making, ticked, onTick, onTake, onChange, onAddToEdit, onSeparate }: {
  box: Box; data: RoomData; sel: Selection; facts: BoxFacts; onModel: (m: ModelChoice) => void; onMake: () => void; making: boolean
  ticked: string[]; onTick: (id: string) => void; onTake: (g: Gen) => void; onChange: (g: Gen) => void; onAddToEdit: (g: Gen) => void; onSeparate: () => void
}) {
  const doc = useDoc()
  const { config } = useConfig()
  const [all, setAll] = useState(false)
  const options = modelChoicesFor('clip', config)
  const current = facts.model
  // The model the box is made on when none is picked for it: the one marked default.
  const fallback = boxModel(doc, box, config)
  const takes = data.gens.filter((g) => inBox(g, box.key))
  const shownTakes = all ? takes : takes.slice(0, 3)
  const over = !!facts.limit?.hard
  const guides = facts.pics.filter((p) => p.kind === 'frame')
  const cast = facts.pics.filter((p) => p.kind !== 'frame')
  const left = new Set(facts.limit?.leftOut ?? [])
  return (
    <div className="rm-tab jc-boxtab">
      <div className="rm-tabhead">
        <span className="rm-kicker pt-mono">{boxName(box)}</span>
        <b className="rm-clamp2">{facts.words.title}</b>
      </div>
      <fieldset className="rm-field">
        <legend className="rm-label">How it is made</legend>
        <div className="jc-seg" role="radiogroup" aria-label="How it is made">
          <button type="button" role="radio" aria-checked={box.together} className={box.together ? 'on' : ''} disabled={!box.together}
            title={box.together ? undefined : 'Join it to the shot beside it with the gap in the strip'}>One video</button>
          <button type="button" role="radio" aria-checked={!box.together} className={!box.together ? 'on' : ''} disabled={!box.together || making}
            onClick={box.together ? onSeparate : undefined}>Separate videos</button>
        </div>
        <p className="rm-note">{boxHow(doc, box, facts.pics)}</p>
      </fieldset>
      {box.together && facts.pics.length > 0 && (
        <fieldset className="rm-field">
          <legend className="rm-label">What the Camera agent sends</legend>
          <div className="jc-guides">
            {guides.map((p) => (
              <div key={p.id} className={`jc-gi ${p.shotId && left.has(p.shotId) ? 'out' : ''}`}>
                <Poster sha={p.sha} className="jc-giimg" />
                <span><b>{p.label}</b> → shot {shotNumber(doc, p.shotId!)}{p.shotId && left.has(p.shotId) ? ' · left out' : ''}</span>
              </div>
            ))}
            {cast.map((p) => (
              <div key={p.id} className="jc-gi">
                <Poster sha={p.sha} className="jc-giimg sq" />
                <span title={guideLine(doc, p)}>{p.label}</span>
              </div>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset className="rm-field">
        <legend className="rm-label">Model</legend>
        <div className="jc-models" role="radiogroup" aria-label="Model">
          {options.map((o) => {
            const cant = boxModelCant(doc, box, o)
            const lim = cant ? undefined : boxLimit(doc, box, o, config, facts.pics)
            const why = cant ?? (lim?.hard ? boxModelLimit(box, o) : undefined)
            const t = takeLimits(o)
            const pics = clipRefCapacity(o, false, config).max
            const cap = box.together && !cant && t ? `Up to ${t.maxS} s · ${t.maxShots} shots · ${pics} pictures${lim && !lim.hard && lim.leftOut.length ? ' · leaves a frame out' : ''}` : undefined
            const note = why ? undefined : cap ?? boxModelNote(doc, box, o)
            const on = current?.provider === o.provider && current.model === o.model
            const isDefault = !!fallback && fallback.provider === o.provider && fallback.model === o.model
            return (
              <button key={`${o.provider}:${o.model}`} type="button" role="radio" aria-checked={on} disabled={!!why && !on}
                className={`jc-mrow ${on ? 'on' : ''} ${why ? 'no' : ''} ${on && why ? 'bad' : ''}`} onClick={() => onModel({ provider: o.provider, model: o.model })}>
                <span className="rm-clamp1" title={o.label}>{o.label}{isDefault && <i>default</i>}</span>
                {(why ?? note) && <small className="rm-clamp2">{why ?? note}</small>}
              </button>
            )
          })}
        </div>
      </fieldset>
      <button type="button" className="btn primary rm-wide" disabled={making || over} onClick={onMake} title={over ? facts.limit!.why : undefined}>
        {making ? 'Making…' : takes.some((g) => g.state === 'ready') ? 'Make new take' : 'Make'}
      </button>
      <p className="rm-note">A new take lands on this box and in the Bin. Your cut stays as it is.</p>
      {takes.length > 0 && (
        <fieldset className="rm-field">
          <legend className="rm-label">Takes</legend>
          <div className="rm-stack jc-stack" aria-label={`Takes of ${boxName(box)}`}>
            {shownTakes.map((g) => <TakeRow key={g.id} g={g} data={data} atS={boxWindow(g, box)?.inS} picked={sel.genId === g.id} ticked={ticked.includes(g.id)} onTick={() => onTick(g.id)} onPlay={() => onTake(g)}
              onChange={() => onChange(g)} onAddToEdit={() => onAddToEdit(g)} />)}
            {takes.length > 3 && <button type="button" className="btn ghost rm-wide" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${takes.length} takes`}</button>}
          </div>
          <p className="rm-note">Tick two takes to compare them.</p>
        </fieldset>
      )}
    </div>
  )
}
