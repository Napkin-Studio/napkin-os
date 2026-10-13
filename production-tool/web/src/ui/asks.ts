// The ask card's logic (ui/AskCard.tsx, ui/JobSlot.tsx), apart from the components so it can be tested:
// which ask a job has, whether the job waits on it, and sending a person's answer through the runner.

import type { Ask, Id, ProductionDocument } from '../contracts/types'
import type { AnswerChoice, JobRunner } from '../jobs/runner'

/** The ask on a job, if it has one. */
export function askOfJob(asks: Record<Id, Ask>, jobId: Id): Ask | undefined {
  return Object.values(asks).find((a) => a.job_id === jobId)
}

/** The question a job waits on: its ask while the job needs input or the ask is open. */
export function waitingAsk(d: ProductionDocument, jobId: string | undefined): Ask | undefined {
  if (!jobId) return undefined
  const ask = askOfJob(d.asks, jobId)
  if (!ask) return undefined
  return d.jobs[jobId]?.state === 'needs_input' || ask.state === 'open' ? ask : undefined
}

/** Send an answer (or, when changing, a changed one) for the job that asked. What to tell the person
 *  afterwards, or null: someone else answering first is said, with whose answer stands. */
export async function sendAnswer(runner: Pick<JobRunner, 'answer' | 'change'>, ask: Ask, answer: AnswerChoice, changing: boolean, byWords: (by?: string) => string): Promise<string | null> {
  if (!ask.job_id) return null
  if (changing) {
    await runner.change(ask.job_id, answer)
    return null
  }
  const r = await runner.answer(ask.job_id, answer)
  return 'conflict' in r ? `${byWords(r.conflict.answeredBy)} answered first. Their answer stands; use Change to choose again.` : null
}
