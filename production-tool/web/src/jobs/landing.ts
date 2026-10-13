// The why of a job's landing (contracts/collab.md §8): one decision by the crew
// member who worked the job, citing it, with the director's and the provider's
// account as its rationale. Never an undo step of anyone's (doc/store.ts landUpdate).

import { jobRationale, opVerb, type JobEntry } from '../../../clan-store/src'
import type { DirectorCard } from '../contracts/types'
import type { DocumentStore, WriteWhy } from '../doc/types'

/** The named refs a job sent (its inputs rows of kind ref), so "why does @maya look like this" finds it. */
export function refsUsed(store: DocumentStore, jobId: string): string[] {
  const d = store.get()
  const j = d.jobs[jobId]
  return [...new Set((j?.inputs ?? []).filter((r) => r.kind === 'ref' && r.ref && d.refs[r.ref]).map((r) => r.ref!))]
}

/** `<verb of its op> <what>`, agent the job's crew, citing <doc>#jobs[<jobId>] when the store has a
 *  document id, with clan-store jobRationale (and the cards the director was given) as the rationale. */
export function landingWhy(store: DocumentStore, jobId: string, what: string, cards?: DirectorCard[]): WriteWhy {
  const j = store.get().jobs[jobId]
  const docId = store.documentId?.()
  return {
    action: `${opVerb(j?.op ?? 'frame')} ${what}`.slice(0, 300),
    agent: j?.crew ?? 'wren',
    ...(j ? { rationale: jobRationale(j as unknown as JobEntry, cards) } : {}),
    ...(docId ? { cites: [`${docId}#jobs[${jobId}]`, ...refsUsed(store, jobId).map((r) => `${docId}#refs[${r}]`)].slice(0, 32) } : {}),
  }
}
