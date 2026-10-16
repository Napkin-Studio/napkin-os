// The agency's allowlist, the upload checksum and the Data sharing sheet (features/tenant-limits.clan).
// Caps and daily quotas are off and never shown (owner, 2026-10-13): nothing here formats money.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { controlsFor, effectiveConfig, makerOn, modelChoicesFor, withAllow, type Sheets } from './capabilities'
import { SHEETS, SPEND_POLICY, SUBPROCESSORS } from './contracts/load'
import type { Allow, Config } from './contracts/types'
import { HttpRelay } from './relay/http'
import { MockRelay } from './relay/mock'
import { failedActions } from './ui/jobActions'
import { ASK_NAPKIN, sharingRows } from './ui/sharing'

const RUNWAY_ONLY: Allow = { claude: true, makers: ['runway'] }
const live = (): Config => effectiveConfig('live', 'config', SHEETS)

describe('the allowlist in the menus and controls', () => {
  it("lists every maker's models by default, as the relay allows them", () => {
    // Owner, 2026-10-15 (features/runway-video-models.clan): every maker is on by default; a client
    // narrows its own list later. Google only still gives Veo and Omni Flash.
    const all = modelChoicesFor('clip', live())
    expect(modelChoicesFor('clip', withAllow(live(), SPEND_POLICY.allow))).toEqual(all)
    expect(modelChoicesFor('clip', withAllow(live(), { claude: true, makers: ['runway', 'google'] })).map((o) => o.model)).toEqual(
      ['veo3.1', 'veo3.1_fast', 'gemini_omni_flash_1.1'])
    expect(all.map((o) => o.model)).toEqual(['veo3.1', 'veo3.1_fast', 'klingO3_pro', 'klingO3_standard', 'kling3.0_pro',
      'kling3.0_standard', 'hailuo3', 'gemini_omni_flash_1.1', 'wan3', 'seedance2_5', 'seedance2_fast'])
    const every: Allow = { claude: true, makers: ['runway', 'google', 'kuaishou', 'minimax', 'alibaba', 'bytedance'] }
    expect(modelChoicesFor('clip', withAllow(live(), every))).toEqual(all)
  })

  it('with Google off, hides every image and clip step and keeps the Runway-made edit', () => {
    const config = withAllow(live(), RUNWAY_ONLY)
    for (const op of ['generate', 'view', 'frame', 'region_edit', 'clip'] as const) {
      expect(config.routing[op]).toEqual([])
      expect(modelChoicesFor(op, config)).toEqual([])
    }
    expect(config.routing.clip_edit).toEqual(['runway'])
    const on = controlsFor(live())
    const off = controlsFor(config)
    expect([on.generate, on.storyboard, on.video]).toEqual([true, true, true])
    expect([off.generate, off.storyboard, off.video]).toEqual([false, false, false])
  })

  it('offers an allowed alternate when the default model is off', () => {
    const sheets = structuredClone(SHEETS) as Sheets
    sheets.runway!.models['veo3.1_fast'].maker = 'runway'
    const config = withAllow(live(), RUNWAY_ONLY, sheets)
    expect(modelChoicesFor('clip', config, sheets).map((o) => o.model)).toEqual(['veo3.1_fast'])
  })

  it("keeps Napkin's own maker on and treats an unknown maker as off", () => {
    expect(makerOn('napkin', RUNWAY_ONLY)).toBe(true)
    expect(makerOn('google', RUNWAY_ONLY)).toBe(false)
    expect(makerOn(undefined, SPEND_POLICY.allow)).toBe(false)
    expect(Object.values(SHEETS.runway.models).every((m) => typeof m.maker === 'string')).toBe(true)
  })
})

describe('refusals for the agency', () => {
  it.each(['limit_reached', 'not_allowed'] as const)('%s offers no other model and no report', (code) => {
    expect(failedActions({ code })).toEqual({ otherModel: false, report: false })
  })
})

describe('the upload is bound to its hash', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the headers the relay names with the presigned PUT', async () => {
    const calls: [string, RequestInit | undefined][] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      if (url.endsWith('/uploads')) {
        return new Response(JSON.stringify({ exists: false, putUrl: 'https://bucket.test/in/x?sig', url: 'https://cdn.test/in/x',
          putHeaders: { 'x-amz-checksum-sha256': 'LXEWQrcmsEQBYnyp+6wy9chTD7GQPMTbAiWHF5IaSIE=' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('', { status: 200 })
    }))
    const blob = new Blob([new TextEncoder().encode('x')], { type: 'image/png' })
    await new HttpRelay('http://relay.test').upload(blob, 'image/png')
    const put = calls.find(([url]) => url.startsWith('https://bucket.test'))!
    expect((put[1]?.headers as Record<string, string>)['x-amz-checksum-sha256']).toBe('LXEWQrcmsEQBYnyp+6wy9chTD7GQPMTbAiWHF5IaSIE=')
  })
})

describe('the mock relay answers as the relay does with no limits set', () => {
  it('has the default allowlist and no daily quotas', async () => {
    const me = await new MockRelay({
      renderer: { render: async () => [] },
      persistKey: null,
      putOutput: async () => 'sha256:' + '0'.repeat(64),
      getInput: async () => undefined,
    }).me()
    expect(me.allow).toEqual(SPEND_POLICY.allow)
    expect(me.quotas).toBeNull()
  })
})

describe('the Data sharing sheet', () => {
  it('lists every company in the notice, on or off for the agency', () => {
    const rows = sharingRows(RUNWAY_ONLY)
    expect(rows.map((r) => r.id)).toEqual(SUBPROCESSORS.map((e) => e.id))
    const on = Object.fromEntries(rows.map((r) => [r.id, r.on]))
    expect(on).toEqual({ aws: true, runway: true, google: false, ideogram: false, magnific: false, kuaishou: false, minimax: false,
      alibaba: false, bytedance: false, anthropic: true })
    expect(rows.find((r) => r.id === 'google')!.through).toBe('Through Runway')
    expect(rows.find((r) => r.id === 'google')!.where).toBe('Where it is processed is not yet confirmed')
  })

  it('says when Claude is off and how to change anything', () => {
    const rows = sharingRows({ claude: false, makers: ['runway', 'google'] })
    expect(rows.find((r) => r.id === 'anthropic')).toMatchObject({ on: false })
    expect(ASK_NAPKIN).toContain('ask Napkin')
    expect(JSON.stringify(rows)).not.toMatch(/\$\d/)
  })
})
