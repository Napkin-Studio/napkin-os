// The contract files, bundled in at build time. Capability sheets are read-only
// here (the harness lane writes them); configs are the examples until the relay
// serves GET /config.
import mock from '../../../contracts/capabilities/mock.json'
import runway from '../../../contracts/capabilities/runway.json'
import fal from '../../../contracts/capabilities/fal.json'
import heygen from '../../../contracts/capabilities/heygen.json'
import testing from '../../../contracts/examples/config.testing.json'
import event from '../../../contracts/examples/config.event.json'
import type { CapabilitySheet, Config, Provider } from './types'

export const SHEETS: Record<Provider, CapabilitySheet> = {
  mock: mock as CapabilitySheet,
  runway: runway as CapabilitySheet,
  fal: fal as CapabilitySheet,
  heygen: heygen as CapabilitySheet,
}

export const CONFIGS = {
  testing: testing as Config,
  event: event as Config,
}
