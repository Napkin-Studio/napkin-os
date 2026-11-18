import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentFigure } from './AgentFigure'
import { ROLE_OF, sayer, whoIsWorking, workOf } from './cast'

// The crew are role spheres in the shell's one agent engine (features/production-new-ui.clan): each crew key
// draws its role's sphere, with the role's name, and nothing of the October figures.
const crew = ['dex', 'skye', 'wren', 'rhea', 'edie', 'ellis', 'jude'] as const

describe('the crew are role spheres', () => {
  it('each crew key draws its role in the shared engine', () => {
    expect(crew.map((k) => ROLE_OF[k])).toEqual(['director', 'script', 'camera', 'retouch', 'edit', 'knowledge', 'review'])
    for (const agent of crew) {
      const html = renderToStaticMarkup(createElement(AgentFigure, { agent, state: 'working' }))
      expect(html).toContain(`data-agent="${ROLE_OF[agent]}"`)
      expect(html).toContain('class="nk-ag"')
      expect(html).not.toContain('af-leg')
    }
  })
  it('needs-you is the sphere\'s needs state, and a decorative one says nothing', () => {
    expect(renderToStaticMarkup(createElement(AgentFigure, { agent: 'dex', state: 'needs-you' }))).toContain('data-state="needs"')
    expect(renderToStaticMarkup(createElement(AgentFigure, { agent: 'dex', decorative: true }))).toContain('aria-hidden="true"')
  })
  it('the production roles are registered by their role names', () => {
    const roles = (globalThis as unknown as { NapkinRoles: { name: (r: string) => string } }).NapkinRoles
    expect(['director', 'script', 'camera', 'retouch', 'edit', 'review', 'knowledge'].map((r) => roles.name(r)))
      .toEqual(['Director agent', 'Script agent', 'Camera agent', 'Retouch agent', 'Edit agent', 'Review agent', 'Knowledge agent'])
  })
  it('signs every member by role name', () => {
    expect(crew.map(sayer)).toEqual(['Director agent', 'Script agent', 'Camera agent', 'Retouch agent', 'Edit agent', 'Knowledge agent', 'Review agent'])
  })
})

describe('who is shown for a job (ui-behaviour 5.1)', () => {
  const frame = { op: 'frame' as const }
  const ctx = { for: 'frame' as const, shotId: 's2' }
  it('The Camera agent films, the Review agent judges, the Review agent needs you when it failed', () => {
    expect(whoIsWorking(frame, 'submitted', ctx, 2)).toEqual({ agent: 'wren', state: 'working', line: 'The Camera agent is drawing frame 2' })
    expect(whoIsWorking(frame, 'queued', ctx, 2).line).toBe('The Camera agent is waiting to start frame 2')
    expect(whoIsWorking(frame, 'validating', ctx, 2)).toEqual({ agent: 'jude', state: 'working', line: 'The Review agent is checking frame 2' })
    expect(whoIsWorking(frame, 'failed', ctx, 2)).toEqual({ agent: 'jude', state: 'needs-you', line: 'Frame 2 did not come back' })
    expect(whoIsWorking(frame, 'cancelled', ctx, 2).line).toBe('Frame 2 was stopped')
  })
  it('The Director agent plans, the Script agent writes, the Retouch agent retouches, the Edit agent puts the ad together', () => {
    expect(whoIsWorking({ op: 'clip' }, 'fetching', { for: 'clip', shotId: 's3' }, 3).line).toBe('The Camera agent is making the clip for shot 3')
    expect(whoIsWorking({ op: 'shot_list' }, 'submitted', { for: 'shot_list' }).line).toBe('The Director agent is planning the shots')
    expect(whoIsWorking({ op: 'stitch' }, 'submitted', { for: 'stitch' }).line).toBe('The Edit agent is putting together the ad')
    expect(whoIsWorking({ op: 'write' }, 'submitted', undefined).agent).toBe('skye')
    expect(whoIsWorking({ op: 'region_edit' }, 'submitted', undefined).agent).toBe('rhea')
  })
  it('shows the job\'s crew member when it names one, the Director agent for planning', () => {
    expect(whoIsWorking({ op: 'check', crew: 'jude' }, 'submitted', undefined)).toMatchObject({ agent: 'jude', state: 'working' })
    expect(whoIsWorking({ op: 'read', crew: 'ellis' }, 'completed', undefined)).toEqual({ agent: 'ellis', state: 'idle', line: 'The Knowledge agent made a picture' })
    expect(whoIsWorking({ op: 'frame', crew: 'wren' }, 'submitted', ctx, 2).agent).toBe('wren')
    expect(whoIsWorking({ op: 'shot_list', crew: 'jude' }, 'submitted', { for: 'shot_list' }).agent).toBe('dex')
  })
  it('a job waiting for an answer waits for you, with no loader', () => {
    expect(whoIsWorking({ op: 'shot_list', crew: 'dex' }, 'needs_input', { for: 'shot_list' }))
      .toEqual({ agent: 'dex', state: 'needs-you', line: 'Waiting for you: the Director agent has a question about the shots' })
  })
  it('says when a job was made on Runway because its pick could not (features/runway-fallback.clan)', () => {
    const ctx = { for: 'clip' as const, shotId: 's3', fallbackFrom: { provider: 'mock' as const, model: 'mock-hq' } }
    expect(whoIsWorking({ op: 'clip', provider: 'runway' }, 'submitted', ctx, 3).line)
      .toBe('The Camera agent is making the clip for shot 3 · Made on Runway: Mock could not')
    expect(whoIsWorking({ op: 'clip', provider: 'runway' }, 'completed', ctx, 3).line)
      .toBe('The Camera agent made the clip for shot 3 · Made on Runway: Mock could not')
    expect(whoIsWorking({ op: 'clip', provider: 'mock' }, 'submitted', ctx, 3).line).toBe('The Camera agent is making the clip for shot 3')
    expect(whoIsWorking({ op: 'clip', provider: 'runway' }, 'failed', ctx, 3).line).toBe('The clip for shot 3 did not come back')
    // Refused at submit: says so, and why (live test 2026-11-16).
    const refused = { op: 'clip' as const, provider: 'runway', error: { code: 'invalid_input' as const, message: '@mira is not one of the images this step was given.', retryable: false } }
    expect(whoIsWorking(refused, 'failed', ctx, 3).line).toBe('The clip for shot 3 was refused: @mira is not one of the images this step was given.')
    expect(whoIsWorking({ ...refused, error: { code: 'provider_failed' as const, message: 'x', retryable: true } }, 'failed', ctx, 3).line).toBe('The clip for shot 3 did not come back')
  })
})

describe('the loader follows the department of the work (ui-behaviour 6.3)', () => {
  it('plan, create, learn, produce', () => {
    expect(workOf('shot_list')).toBe('plan')
    expect(workOf('write')).toBe('plan')
    expect(workOf('frame')).toBe('create')
    expect(workOf('region_edit')).toBe('create')
    expect(workOf('read')).toBe('learn')
    expect(workOf('frame', 'validating')).toBe('learn')
    expect(workOf('stitch')).toBe('produce')
    expect(workOf('clip_patch')).toBe('produce')
  })
})
