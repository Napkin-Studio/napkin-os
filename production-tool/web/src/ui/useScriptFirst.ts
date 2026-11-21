// An answer that says "write the script first" on a plan's ask is done here, in the browser, instead of going back
// to the Director agent (UAT round 5, S3-4; jobs/scriptFirst.ts). The ask card and the Booth's ask both use it.

import { useContext } from 'react'
import { RouterContext, useDoc, useServices, useUi } from '../app/context'
import { scriptRoute } from '../app/route'
import type { Ask } from '../contracts/types'
import { scriptFirst, scriptFirstPick } from '../jobs/scriptFirst'
import { LOCAL_PERSON, type AnswerChoice } from '../jobs/runner'

/** (ask, answer) => true when the answer was a script first, drafted and opened; false: send it as usual. */
export function useScriptFirst(): (ask: Ask, answer: AnswerChoice) => Promise<boolean> {
  const services = useServices()
  const router = useContext(RouterContext)
  const doc = useDoc()
  const ui = useUi()
  return async (ask, answer) => {
    const first = scriptFirstPick(doc, ask, answer)
    if (!first) return false
    if (!services.clan) throw new Error('The Script editor could not load here.')
    const me = ui.me?.participantId ? `human:${ui.me.participantId}` : LOCAL_PERSON
    const r = await scriptFirst({ relay: services.relay, doc: services.doc, ui: services.ui, runner: services.runner }, services.clan, ask, answer, me, first.storyboardId)
    router?.push(scriptRoute(services.project.id, r.scriptId))
    return true
  }
}
