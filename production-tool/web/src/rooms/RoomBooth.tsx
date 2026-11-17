// The Video rooms' Booth and their waiting line (features/production-new-ui.clan; mock production-new-ui-v2 make,
// make-box, edit, edit-clip; the Booth rule). The Booth comes in only on a selection: a box, a shot or a take in
// Make (its crumb, the Box | Shot | Change panel the Make room puts in it, the Camera agent's words for the next
// take, the offer to make a shot apart), a clip in Edit. What waits for the person is a line on the room, not
// a Booth: a job's question, a take or a render that failed and was not cleared, 'New take ready' on a clip in
// the cut, what was just joined or cut with Undo, and the agents' recent notes on this film.

import { useState, type ReactNode, type Ref } from 'react'
import { useDoc, useServices, useUi } from '../app/context'
import type { DocJob, Id } from '../contracts/types'
import { plainJobError } from '../jobs/errorWords'
import { jobCtx } from '../jobs/runner'
import { shotNumber } from '../model/selectors'
import type { CastKey } from '../ui/agents/cast'
import { Booth } from '../ui/booth/Booth'
import { BoothAsk, BoothBox, ChoiceCard, DoneCard, NoteCard, ScopeChip } from '../ui/booth/BoothParts'
import { ago, useChain, useLater } from '../ui/booth/hooks'
import { agentNotes, groupFailures, stageWaiting, triesWords, videoAddresses } from '../ui/booth/notes'
import { useBooth } from '../ui/booth/useBooth'
import type { ChangeOpen } from './ChangeDrawer'
import { boxName, type Gen } from './model'
import { Poster } from './Poster'
import type { RoomData, RoomName, Selection } from './Rooms'
import { dismissedTakes, newerTake, notNow, readCut } from './timeline'
import type { CutClip } from './cut'


/** A take is one of a box's takes: its own box, or a box made apart from it. */
const inBox = (g: Gen, key: string | undefined) => !!key && (g.boxKey === key || (g.boxKeys ?? []).includes(key))

export interface RoomProps {
  room: RoomName
  data: RoomData
  sel: Selection
  change: ChangeOpen | null
  /** The last join or cut in the Make room's strip (features/join-or-cut-shots.clan): said on the room, with Undo. */
  done?: { id: number; text: string } | null
  onUndo?: () => void
  /** Open the Change tab (Make) on a take, with words for its next take. */
  onChange: (c: ChangeOpen) => void
  /** 'Make shot N apart': the shot out into a box of its own (jobs/runView takeShotOut). */
  onApart: (shotId: Id) => void
  /** 'Use this take' on a clip's new take: the Edit room's New take sheet. */
  onReady: (clipId: Id, takeId: Id) => void
  /** The crumb's ← Film and ×: the selection goes, and the Booth with it. */
  onClose?: () => void
  /** Where the Make room puts its Box | Shot | Change panel (a portal into the Booth). */
  slot?: Ref<HTMLDivElement>
}

/** Everything the rooms have waiting, and the agents' notes, worked out once (the line and the Booth share it). */
function useRoomWaits({ room, data, change, onApart, onReady }: RoomProps) {
  const { clan, runner, ui: uiStore } = useServices()
  const doc = useDoc()
  const ui = useUi()
  const chain = useChain(clan)
  const { later, order } = useLater()
  const [, rerender] = useState(0)
  const [keptTogether, setKeptTogether] = useState<string[]>([])
  const agent: CastKey = room === 'make' ? 'wren' : 'edie'
  const shotIds = data.boxes.flatMap((b) => b.shotIds)
  const ids = new Set(shotIds)
  const docId = (() => { try { return clan?.documentId() ?? '' } catch { return '' } })()
  const genOf = (id: string | undefined) => data.gens.find((g) => g.id === id)

  const waiting = stageWaiting(doc, 'video', (id) => jobCtx(doc, ui, id), (id) => runner.liveInfo(id), (job, ctx) => {
    if (ctx?.for === 'clip') return ids.has(ctx.shotId)
    if (ctx?.for === 'run' || ctx?.for === 'remake' || ctx?.for === 'film_plan') return ctx.videoId === data.videoId
    if (ctx?.for === 'stitch') return (ctx.videoId ?? data.videoId) === data.videoId
    return (job.node.kind === 'video' && job.node.id === data.videoId) || (job.node.kind === 'shot' && ids.has(job.node.id))
  })
  const clear = (jobIds: string[]) => uiStore.update((u) => { for (const id of jobIds) u.jobs[id] = { ...u.jobs[id], dismissed: true } })
  const failedWords = (j: DocJob) => {
    const ctx = jobCtx(doc, ui, j.id)
    const g = data.gens.find((x) => x.jobId === j.id)
    const box = g ? data.boxes.find((b) => b.key === g.boxKey) : undefined
    const shotsOfJob = ctx?.for === 'clip' ? [ctx.shotId] : ctx?.for === 'run' ? doc.videos[ctx.videoId]?.runs?.[ctx.runId]?.shot_ids ?? [] : ctx?.for === 'remake' ? genOf(ctx.parentId)?.shotIds ?? [] : []
    const ns = shotsOfJob.map((id) => shotNumber(doc, id)).filter((n) => n > 0)
    const which = ns.length > 1 ? `shots ${ns[0]} to ${ns.at(-1)}` : ns.length ? `shot ${ns[0]}` : ''
    const q = j.op === 'stitch' ? 'The render did not work.' : box ? `The last Make of ${boxName(box)} did not work.`
      : which ? `${ctx?.for === 'remake' ? 'The new take of' : 'The take of'} ${which} did not work.` : 'That did not work.'
    return { q, body: j.error ? plainJobError(j.error, j.op).message : undefined }
  }

  type Item = { id: string; node: ReactNode; ask?: boolean }
  const items: Item[] = [
    ...waiting.asks.map(({ job, ask }): Item => ({ id: ask.id, ask: true, node: <BoothAsk key={ask.id} ask={ask} onLater={() => later(ask.id)} time={ago(job.created_at)} /> })),
    ...groupFailures(waiting.failed.filter((j) => (room === 'edit') === (j.op === 'stitch')), failedWords).map((g): Item => ({ id: g.id, node: <ChoiceCard key={g.id} id={g.id} agent={agent} label="stopped" q={g.q}
        body={g.jobs.length > 1 ? <>{g.body}{g.body ? ' ' : ''}<span className="bc-tries">{triesWords(g.jobs.length)}</span></> : g.body}
        time={ago(g.at)} onLater={() => later(g.id)} choices={[{ label: 'Clear', primary: true, run: () => clear(g.jobs.map((j) => j.id)) }]} /> })),
  ]

  // Make: the Change tab offers to make a shot filmed with others on its own; the offer waits here too.
  const parent = change ? genOf(change.parentId) : undefined
  if (room === 'make' && parent && change?.shotId && parent.shotIds.length > 1 && !keptTogether.includes(`${parent.id}:${change.shotId}`)) {
    const shotId = change.shotId
    const n = shotNumber(doc, shotId)
    const others = parent.shotIds.filter((x) => x !== shotId).map((x) => `shot ${shotNumber(doc, x)}`).join(' and ')
    const box = data.boxes.find((b) => b.key === parent.boxKey)
    const key = `${parent.id}:${shotId}`
    items.push({ id: `apart:${key}`, ask: true, node: (
      <ChoiceCard key={`apart:${key}`} id={`apart:${key}`} agent="wren" q={`Make shot ${n} apart?`}
        thumb={<Poster sha={parent.asset} atS={parent.segments.find((s) => s.shotId === shotId)?.inS ?? 0} className="poster" />}
        meta={`Shot ${n} · in ${box ? boxName(box) : 'its box'} with ${others}`}
        body={`Shot ${n} was filmed with ${others}, so changing it remakes all ${parent.shotIds.length}. Made on its own, only shot ${n} is made again.`}
        onLater={() => later(`apart:${key}`)}
        choices={[{ label: `Make shot ${n} apart`, primary: true, run: () => onApart(shotId) }, { label: `Keep it in ${box ? boxName(box) : 'its box'}`, run: () => setKeptTogether((k) => [...k, key]) }]} />
    ) })
  }

  // Edit: a newer take of a clip's box is ready ("New take ready" on the timeline).
  if (room === 'edit') {
    const cut = readCut(doc, data.videoId)
    const gone = dismissedTakes()
    for (const c of cut.v1 as CutClip[]) {
      const take = newerTake(c, data.gens)
      if (!take || gone.has(`${c.genId}>${take.id}`)) continue
      const box = data.boxes.find((b) => b.key === take.boxKey)
      const n = c.follows?.shotId ? shotNumber(doc, c.follows.shotId) : 0
      items.push({ id: `ready:${c.id}`, node: (
        <ChoiceCard key={`ready:${c.id}`} id={`ready:${c.id}`} agent="edie" q={`New take ready${box ? ` for ${boxName(box)}` : ''}.`}
          thumb={<Poster sha={take.asset} atS={take.segments[0]?.inS ?? 0} className="poster" />}
          meta={`${box ? boxName(box) : 'Take'} · v${take.version}${n ? ` · shot ${n}` : ''} · ${take.label}`}
          body="Use it in the same place in the cut, keeping its trims and fades, or keep the take you have."
          time={ago(take.createdAt)} onLater={() => later(`ready:${c.id}`)}
          choices={[{ label: 'Use this take', primary: true, run: () => onReady(c.id, take.id) }, { label: 'Not now', run: () => { notNow(c, take); rerender((x) => x + 1) } }]} />
      ) })
    }
  }

  const crew: CastKey[] = room === 'edit' ? ['wren'] : []
  const notes = [agent, ...crew].flatMap((a) => agentNotes(chain, a, videoAddresses(doc, docId, data.videoId, shotIds), doc).map((n) => ({ ...n, agent: a })))
    .sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 3)

  return { items: order(items, (x) => x.id), notes, apart: items.filter((x) => x.id.startsWith('apart:')), later }
}

/** What waits in a room, as a line over its work (no Booth for it). */
export function RoomWaits(p: RoomProps) {
  const { items, notes } = useRoomWaits(p)
  const waits = items.filter((x) => !x.id.startsWith('apart:'))
  if (!waits.length && !notes.length && !p.done) return null
  return (
    <div className="rm-waits" role="region" aria-label="Waiting for you" data-count={waits.length}>
      {waits.length > 0 && <div className="rm-waits-hd"><span className="tagcall">Needs your call · {waits.length}</span></div>}
      <div className="rm-waits-row">
        {waits.map((x) => x.node)}
        {p.done && <DoneCard key={p.done.id} agent="wren" text={`${p.done.text} Nothing is sent until you press Make.`} onUndo={p.onUndo} />}
        {notes.map((n) => <NoteCard key={`${n.agent}:${n.id}`} agent={n.agent} label={n.label} body={n.body} time={ago(n.at)} />)}
      </div>
    </div>
  )
}

/** The Booth on a selected box, shot or take (Make) or clip (Edit). */
export function RoomBooth({ slot, ...p }: RoomProps) {
  const { room, data, sel, onClose, onChange } = p
  const doc = useDoc()
  const booth = useBooth('room')
  const { apart } = useRoomWaits(p)
  const genOf = (id: string | undefined) => data.gens.find((g) => g.id === id)
  // The Camera agent's box: words for the selected shot's next take, through Change → Words.
  const box = data.boxes.find((b) => b.key === sel.boxKey) ?? data.boxes.find((b) => b.shotIds.includes(sel.shotId ?? ''))
  const shotId = sel.shotId && box?.shotIds.includes(sel.shotId) ? sel.shotId : box?.shotIds[0]
  const take = (sel.genId && genOf(sel.genId)?.state === 'ready' && inBox(genOf(sel.genId)!, box?.key) ? genOf(sel.genId) : undefined)
    ?? data.gens.find((g) => inBox(g, box?.key) && g.state === 'ready')
  const ns = box ? box.shotIds.map((id) => shotNumber(doc, id)).filter((n) => n > 0) : []
  const where = box ? `${boxName(box)}${ns.length > 1 ? ` · shots ${ns[0]}-${ns.at(-1)}` : ns.length ? ` · shot ${ns[0]}` : ''}` : ''
  return (
    <Booth state={booth} earned={!!box}>
      <div className="sp-crumb"><button type="button" onClick={onClose}>← Film</button><span>›</span><b>{where}</b>
        <button type="button" className="x" onClick={onClose} title="Back (Esc)" aria-label="Close the selection">×</button></div>
      {room === 'make' && <div className="rm-boothslot" ref={slot} />}
      {apart.map((x) => x.node)}
      {room === 'make' && box && !box.endCard && (
        <div className="bsec">
          <h4>Tell the Camera agent</h4>
          <BoothBox key={`${box.key}:${shotId ?? ''}`} placeholder="Tell the Camera agent what to make or make again…" button="Ask the Camera agent"
            scope={<ScopeChip label={`${shotId ? `Shot ${shotNumber(doc, shotId)} · ` : ''}${boxName(box)}`} />}
            disabled={!take}
            hint={!take ? 'Make a take of this box first. Then tell the Camera agent what changes in the next one.' : undefined}
            onSend={(words) => { if (take) onChange({ parentId: take.id, ...(shotId && take.shotIds.includes(shotId) ? { shotId } : {}), verb: 'words', words }) }} />
        </div>
      )}
    </Booth>
  )
}
