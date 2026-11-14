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

/** VITE_RELAY_URL set → the real relay; otherwise the in-browser mock. */
export function createRelay(): Relay {
  const url = import.meta.env.VITE_RELAY_URL as string | undefined
  if (url) return new HttpRelay(url)
  return new MockRelay({ renderer: browserRenderer, ...(import.meta.env.DEV ? { delayMs: mockDelay() } : {}) })
}

export type { AnswerResult, Relay } from './types'
export { RelayError, asContractError } from './types'
