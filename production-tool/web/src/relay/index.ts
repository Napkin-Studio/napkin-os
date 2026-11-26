import { parseRoute } from '../app/route'
import { HttpRelay } from './http'
import { MockRelay } from './mock'
import { browserRenderer } from './mockRender'
import type { Relay } from './types'

/** Dev only: ?mockDelay=<ms> holds the in-browser mock's jobs that long (the e2e harness's running jobs). */
function mockDelay(): number | undefined {
  try {
    const v = Number(new URLSearchParams(window.location.search).get('mockDelay'))
    return Number.isFinite(v) && v > 0 ? v : undefined
  } catch {
    return undefined
  }
}

/** The library document the page's route names (/production/d/<doc>), or null on Home. */
function routeDoc(): string | null {
  const r = parseRoute(window.location)
  return r.kind === 'none' ? null : r.projectId
}

/** VITE_RELAY_URL set → the real relay, through napkin-web's own routes (the value only says "not the mock"); otherwise
 *  the in-browser mock. */
export function createRelay(): Relay {
  const url = import.meta.env.VITE_RELAY_URL as string | undefined
  if (url) return new HttpRelay({ doc: routeDoc })
  return new MockRelay({ renderer: browserRenderer, ...(import.meta.env.DEV ? { delayMs: mockDelay() } : {}) })
}

export type { AnswerResult, InboxEntry, Relay } from './types'
export { RelayError, asContractError } from './types'
