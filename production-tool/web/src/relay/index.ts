import { HttpRelay } from './http'
import { MockRelay } from './mock'
import { browserRenderer } from './mockRender'
import type { Relay } from './types'

/** VITE_RELAY_URL set → the real relay; otherwise the in-browser mock. */
export function createRelay(): Relay {
  const url = import.meta.env.VITE_RELAY_URL as string | undefined
  if (url) return new HttpRelay(url)
  return new MockRelay({ renderer: browserRenderer })
}

/** Which server a saved session belongs to: the relay URL, or 'mock'. */
export function relayId(): string {
  return (import.meta.env.VITE_RELAY_URL as string | undefined) || 'mock'
}

export type { Relay } from './types'
export { RelayError, asContractError } from './types'
