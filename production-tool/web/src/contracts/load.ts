// The contract files, bundled in at build time. Capability sheets are read-only
// here (the harness lane writes them); configs are the examples until the relay
// serves GET /config. The tables contract 3 keeps in common.schema.json (the
// role lines, the link rule, each op's quota class) are read from it, never
// copied, so the UI, the prompt and the checks cannot differ.
import mock from '../../../contracts/capabilities/mock.json'
import runway from '../../../contracts/capabilities/runway.json'
import testing from '../../../contracts/examples/config.testing.json'
import live from '../../../contracts/examples/config.live.json'
import common from '../../../contracts/common.schema.json'
import type { CameraWords, CapabilitySheet, Config, LinkRule, Op, Provider, QuotaClass, RefRole, RefRoleLine } from './types'

export const SHEETS: Record<Provider, CapabilitySheet> = {
  mock: mock as CapabilitySheet,
  runway: runway as CapabilitySheet,
}

export const CONFIGS = {
  testing: testing as Config,
  live: live as Config,
}

/** What Dex takes from each role: the picker's line and the prompt's, one table (common refRoleTable). */
export const REF_ROLE_TABLE = common.$defs.refRoleTable.const as Record<RefRole, RefRoleLine>
/** How each camera value is said: the chip label and the words that mean it (common cameraWords,
 *  features/frame-change-edit.clan). director.v7's camera lines and the passthrough read the same table. */
export const CAMERA_WORDS = common.$defs.cameraWords.const as CameraWords
/** Every link that may exist (common linkRule). */
export const LINK_RULE = common.$defs.linkRule.const as LinkRule
const OP_QUOTA = common.$defs.opQuotaClass.const as Record<Op, QuotaClass>

export function quotaClassOf(op: Op): QuotaClass {
  return OP_QUOTA[op]
}
