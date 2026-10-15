// "You can always switch later" (ui-behaviour 3.5, 3.17): the Video editor shows how its clips are
// made, as the person chose on Dex's "Plan a storyboard first?", with Change. Changing it is a new
// answer on the same ask (in History); it does not undo work already done.

import { useState } from 'react'
import { useDoc, useServices, useUi } from '../app/context'
import type { Id } from '../contracts/types'
import { LOCAL_PERSON } from '../jobs/runner'
import { answerScriptVideo, PLAN_FIRST, scriptOfVideo, scriptVideoAsk, scriptVideoQuestion, shotCount } from '../jobs/scriptVideo'
import { storyboardOfVideo } from '../model/selectors'
import { AgentFigure } from '../ui/agents/AgentFigure'
import { sayer } from '../ui/agents/cast'
import { AskOptions } from '../ui/AskCard'

export function ClipChoice({ videoId }: { videoId: Id }) {
  const services = useServices()
  const doc = useDoc()
  const ui = useUi()
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ask = scriptVideoAsk(doc, videoId)
  if (!ask) return null
  // The words as they are now (the shots Dex planned since), on the stored question's ids.
  const scriptId = scriptOfVideo(doc, videoId) ?? Object.values(doc.links).find((l) => l.role === 'drives' && l.from.kind === 'script' && l.to.id === storyboardOfVideo(doc, videoId)?.id)?.from.id
  const question = scriptId ? scriptVideoQuestion(shotCount(doc, scriptId), ask.question.id) : ask.question
  const last = ask.answers.at(-1)
  const chose = ask.question.options.find((o) => o.id === last?.option_id)?.label
  const me = ui.me?.participantId ? `human:${ui.me.participantId}` : LOCAL_PERSON
  const who = !last?.by ? 'Someone' : last.by === me ? 'You' : last.by.replace(/^human:/, '')
  const pick = async (optionId: string) => {
    setBusy(true)
    setError(null)
    try {
      const { storyboardId } = await answerScriptVideo(services, videoId, optionId, me)
      setChanging(false)
      // Frames first: the storyboard is where they are drawn and checked.
      if (optionId === PLAN_FIRST && optionId !== last?.option_id) {
        services.ui.update((u) => { u.openNode = { ...u.openNode, storyboard: storyboardId }; u.stage = 'storyboard' }, 'stage')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ve-choice" role="group" aria-label="How the clips are made">
      <AgentFigure agent="dex" size={22} decorative />
      {!changing ? (
        <>
          <span><span className="who">{sayer('dex')}:</span> {who} chose: {chose?.toLowerCase() ?? 'how to make the clips'} <span className="faint">· in History</span></span>
          <button type="button" className="btn xs" onClick={() => setChanging(true)}>Change</button>
        </>
      ) : (
        <div className="ve-choice-ask">
          <span><b>{question.text}</b> <span className="faint">{question.why}</span></span>
          <AskOptions q={question} disabled={busy} onPick={(id) => void pick(id)} />
          <button type="button" className="btn xs ghost" onClick={() => setChanging(false)}>Keep the answer</button>
        </div>
      )}
      {error && <span className="ve-choice-error" role="alert">{error}</span>}
    </div>
  )
}
