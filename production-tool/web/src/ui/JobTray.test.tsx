import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DocJob, JobState } from '../contracts/types'
import type { JobCtx } from '../doc/ui'
import { JobButton } from './JobTray'
import { chipText, jobLine, jobLook, trayGroups } from './tray'

// The agents' status in the bar (owner 2026-11-19: "a dot only works"; the sphere ran off its spot): Brief
// Maker's .tb-status dot, idle, working, needs you or error. The full line lives in its tooltip, its label, a
// separate live region and the popover's first row.

const job = (id: string, op: DocJob['op'], state: JobState) => ({ id, op, state, parent_ids: [], input_hashes: [], created_at: '2026-10-09T00:00:00Z' }) as unknown as DocJob
const ctx = (c: Partial<JobCtx>) => ({ request: {}, ...c }) as JobCtx
const groups = (jobs: DocJob[], failedCtx = true) => trayGroups(jobs, (id) => (failedCtx ? ctx({ for: 'frame', shotId: id }) : undefined), () => undefined)
const button = (jobs: DocJob[], lead?: string) => {
  const g = groups(jobs)
  const look = jobLook(g)
  return renderToStaticMarkup(createElement(JobButton, { look, line: look ? jobLine(g, lead) : 'No agent is working', open: false, onClick: () => {} }))
}
/** The button's visible text: everything outside its tags. */
const visibleText = (html: string) => html.replace(/<[^>]+>/g, '').trim()

describe('the status is a dot, as in Brief Maker', () => {
  it('3 running: working, no sphere; the line is in the tooltip and the label', () => {
    const html = button([job('a', 'frame', 'submitted'), job('b', 'clip', 'submitted'), job('c', 'clip', 'fetching')], 'The Camera agent is making frame 3')
    expect(html).toContain('class="tb-status pt-job "')
    expect(html).toContain('data-st="working"')
    expect(html).toContain('<i class="sdot" aria-hidden="true"></i>')
    expect(html).not.toContain('napkin-loader')
    expect(html).toContain('aria-label="The Camera agent is making frame 3 · 3 running"')
    expect(html).toContain('data-tip="The Camera agent is making frame 3 · 3 running"')
    expect(html).not.toContain('aria-live')
  })
  it('only a queued job: working', () => {
    expect(button([job('a', 'script_draft' as DocJob['op'], 'queued')], 'The Script agent is waiting to start a draft')).toContain('data-st="working"')
  })
  it('a question waiting for you: needs, even with one running', () => {
    expect(button([job('q', 'shot_list', 'needs_input')], 'The Director agent is waiting for you')).toContain('data-st="needs"')
    expect(button([job('a', 'frame', 'submitted'), job('q', 'shot_list', 'needs_input')], 'The Camera agent is making frame 1')).toContain('data-st="needs"')
  })
  it('a failure and nothing running: error, "1 failed" in its label', () => {
    const html = button([job('f', 'frame', 'failed')])
    expect(html).toContain('data-st="error"')
    expect(html).toContain('aria-label="1 failed"')
  })
  it('idle: the quiet dot alone', () => {
    expect(jobLook(groups([job('d', 'frame', 'completed')]))).toBeNull()
    const html = button([])
    expect(html).toContain('data-st="idle"')
    expect(visibleText(html)).toBe('')
  })
})

describe('the job tray keeps its words off the bar', () => {
  const src = readFileSync(new URL('./JobTray.tsx', import.meta.url), 'utf8')
  it('a separate polite live region carries the line, and the popover starts with it', () => {
    expect(src).toMatch(/className="pt-sr" role="status" aria-live="polite">\{empty \? '' : line\}/)
    expect(src).toMatch(/<div className="tray-lead">\{line\}<\/div>/)
    expect(src).not.toContain('pt-status-line')
  })
  it('the phone bar has the same button, without the ask dock or Show', () => {
    // The phone wears the shell bar's phone cut (mock phone), whose job button is the phone one.
    expect(readFileSync(new URL('../stages/PhoneReview.tsx', import.meta.url), 'utf8')).toContain('<CanvasBar phone />')
    expect(readFileSync(new URL('./chrome/TopBars.tsx', import.meta.url), 'utf8')).toContain('<JobTray phone />')
    expect(src).toContain('{!phone && <AskDock />}')
  })
})

describe('the job chip says what is running (features/production-new-ui.clan)', () => {
  it('"Your call" while a question waits, "Working · frame 3" while one runs, else the failures', () => {
    expect(chipText(1, 2, 0, 'frame 3')).toBe('Your call · 1')
    expect(chipText(0, 1, 0, 'frame 3')).toBe('Working · frame 3')
    expect(chipText(0, 3, 1, 'frame 3')).toBe('Working · frame 3 · 3 jobs')
    expect(chipText(0, 0, 2, undefined)).toBe('2 failed')
    expect(chipText(0, 0, 0, undefined)).toBe('')
  })
  it('the chip shows its words beside the dot', () => {
    const html = renderToStaticMarkup(createElement(JobButton, { look: { spin: 'run' }, line: 'The Camera agent is drawing frame 3', chip: 'Working · frame 3', open: false, onClick: () => {} }))
    expect(html).toContain('<span class="jb-text" aria-hidden="true">Working · frame 3</span>')
    expect(html).toContain('class="sdot"')
  })
})

describe('the job chip says what is happening (features/production-new-ui.clan)', () => {
  it('Your call while a question waits, Working with the lead job, else the failures', async () => {
    const { chipText } = await import('./tray')
    expect(chipText(1, 2, 0, 'frame 3')).toBe('Your call · 1')
    expect(chipText(0, 1, 0, 'frame 3')).toBe('Working · frame 3')
    expect(chipText(0, 3, 0, 'frame 3')).toBe('Working · frame 3 · 3 jobs')
    expect(chipText(0, 0, 2, undefined)).toBe('2 failed')
  })
})
