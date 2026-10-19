// The contract files, bundled in at build time. Capability sheets are read-only
// here (the harness lane writes them); configs are the examples until the relay
// serves GET /config.
import mock from '../../../contracts/capabilities/mock.json'
import runway from '../../../contracts/capabilities/runway.json'
import testing from '../../../contracts/examples/config.testing.json'
import live from '../../../contracts/examples/config.live.json'
import type { CapabilitySheet, Config, Provider } from './types'

export const SHEETS: Record<Provider, CapabilitySheet> = {
  mock: mock as CapabilitySheet,
  runway: runway as CapabilitySheet,
}

export const CONFIGS = {
  testing: testing as Config,
  live: live as Config,
}
