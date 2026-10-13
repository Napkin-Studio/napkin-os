import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentFigure } from './AgentFigure'
import { sayer, whoIsWorking } from './cast'

// The house sheet as the templates get it (generated from app/src/studio by app/scripts/agent-figures.mjs).
const SHEET = readFileSync(new URL('../../../../../app/templates/shared/agent-figures.html', import.meta.url), 'utf8')

/** Every path's d, in order, from one of the sheet's figures. */
function sheetPaths(key: string): string[] {
  const m = SHEET.match(new RegExp(`\\b${key}:"(<svg.*?<\\\\/svg>)"`))
  if (!m) throw new Error(`no ${key} in the sheet`)
  return [...m[1].matchAll(/ d=\\"([^\\"]*)\\"/g)].map((x) => x[1])
}
const ourPaths = (agent: 'ellis' | 'jude' | 'dex', state: 'idle' | 'needs-you' = 'idle') =>
  [...renderToStaticMarkup(createElement(AgentFigure, { agent, state })).matchAll(/ d="([^"]*)"/g)].map((x) => x[1])

describe('the cast draws as the house sheet does', () => {
  it('Ellis is the sheet\'s Extract, Jude its Judge', () => {
    expect(ourPaths('ellis')).toEqual(sheetPaths('extract'))
    expect(ourPaths('jude')).toEqual(sheetPaths('judge'))
  })
  it('Dex is a figure of his own', () => {
    expect(ourPaths('dex')).not.toEqual(sheetPaths('codes'))
    expect(renderToStaticMarkup(createElement(AgentFigure, { agent: 'dex', decorative: true }))).toContain('aria-hidden="true"')
  })
  it('signs as name · job', () => {
    expect(sayer('dex')).toBe('Dex · directs')
    expect(sayer('ellis')).toBe('Ellis · reads')
  })
})

describe('who is shown for a job', () => {
  const frame = { op: 'frame' as const }
  const ctx = { for: 'frame' as const, shotId: 's2' }
  it('Dex makes it, Jude checks it, Jude needs you when it failed', () => {
    expect(whoIsWorking(frame, 'submitted', ctx, 2)).toEqual({ agent: 'dex', state: 'working', line: 'Dex is drawing frame 2' })
    expect(whoIsWorking(frame, 'queued', ctx, 2).line).toBe('Dex is waiting to start frame 2')
    expect(whoIsWorking(frame, 'validating', ctx, 2)).toEqual({ agent: 'jude', state: 'working', line: 'Jude is checking frame 2' })
    expect(whoIsWorking(frame, 'failed', ctx, 2)).toEqual({ agent: 'jude', state: 'needs-you', line: 'Frame 2 did not come back' })
    expect(whoIsWorking(frame, 'cancelled', ctx, 2).line).toBe('Frame 2 was stopped')
  })
  it('names clips, plans and the ad', () => {
    expect(whoIsWorking({ op: 'clip' }, 'fetching', { for: 'clip', shotId: 's3' }, 3).line).toBe('Dex is making the clip for shot 3')
    expect(whoIsWorking({ op: 'shot_list' }, 'submitted', { for: 'shot_list' }).line).toBe('Dex is planning the shots')
    expect(whoIsWorking({ op: 'stitch' }, 'submitted', { for: 'stitch' }).line).toBe('Dex is putting together the ad')
  })
  it('shows the job\'s crew member where the cast has a figure, Dex for planning and the rest', () => {
    expect(whoIsWorking({ op: 'check', crew: 'jude' }, 'submitted', undefined)).toMatchObject({ agent: 'jude', state: 'working' })
    expect(whoIsWorking({ op: 'read', crew: 'ellis' }, 'completed', undefined)).toEqual({ agent: 'ellis', state: 'idle', line: 'Ellis made a picture' })
    expect(whoIsWorking({ op: 'frame', crew: 'wren' }, 'submitted', ctx, 2).agent).toBe('dex')
    expect(whoIsWorking({ op: 'shot_list', crew: 'jude' }, 'submitted', { for: 'shot_list' }).agent).toBe('dex')
  })
  it('a job waiting for an answer waits for you, with no loader', () => {
    expect(whoIsWorking({ op: 'shot_list', crew: 'dex' }, 'needs_input', { for: 'shot_list' }))
      .toEqual({ agent: 'dex', state: 'needs-you', line: 'Waiting for you: Dex has a question about the shots' })
  })
  it('says when a job was made on Runway because its pick could not (features/runway-fallback.clan)', () => {
    const ctx = { for: 'clip' as const, shotId: 's3', fallbackFrom: { provider: 'mock' as const, model: 'mock-hq' } }
    expect(whoIsWorking({ op: 'clip', provider: 'runway' }, 'submitted', ctx, 3).line)
      .toBe('Dex is making the clip for shot 3 · Made on Runway: Mock could not')
    expect(whoIsWorking({ op: 'clip', provider: 'runway' }, 'completed', ctx, 3).line)
      .toBe('Dex made the clip for shot 3 · Made on Runway: Mock could not')
    expect(whoIsWorking({ op: 'clip', provider: 'mock' }, 'submitted', ctx, 3).line).toBe('Dex is making the clip for shot 3')
    expect(whoIsWorking({ op: 'clip', provider: 'runway' }, 'failed', ctx, 3).line).toBe('The clip for shot 3 did not come back')
  })
})
