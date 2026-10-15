import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DocJob, JobState } from '../contracts/types'
import type { JobCtx } from '../doc/ui'
import { JobButton } from './JobTray'
import { jobLine, jobLook, trayGroups } from './tray'

// The job button (features/topbar-declutter.clan; owner 2026-10-15: "The button which shows agent
// working can be just the icon rotating"): the Napkin logo alone in the bar, no words and no count.
// The words live in its tooltip, its label, a separate live region and the popover's first row.

const job = (id: string, op: DocJob['op'], state: JobState) => ({ id, op, state, parent_ids: [], input_hashes: [], created_at: '2026-10-09T00:00:00Z' }) as unknown as DocJob
const ctx = (c: Partial<JobCtx>) => ({ request: {}, ...c }) as JobCtx
const groups = (jobs: DocJob[], failedCtx = true) => trayGroups(jobs, (id) => (failedCtx ? ctx({ for: 'frame', shotId: id }) : undefined), () => undefined)
const button = (jobs: DocJob[], lead?: string) => {
  const g = groups(jobs)
  const look = jobLook(g)
  return look ? renderToStaticMarkup(createElement(JobButton, { look, line: jobLine(g, lead), open: false, work: 'create', onClick: () => {} })) : ''
}
/** The button's visible text: everything outside its tags. */
const visibleText = (html: string) => html.replace(/<[^>]+>/g, '').trim()

describe('the job button is the Napkin logo alone', () => {
  it('3 running: the turning logo, no visible words or count; the line is in the tooltip and the label', () => {
    const html = button([job('a', 'frame', 'submitted'), job('b', 'clip', 'submitted'), job('c', 'clip', 'fetching')], 'Wren is making frame 3')
    expect(html).toContain('class="napkin-loader"')
    expect(html).toContain('data-state="run"')
    expect(html).toContain('data-spin="run"')
    expect(visibleText(html)).toBe('')
    expect(html).toContain('aria-label="Wren is making frame 3 · 3 running"')
    expect(html).toContain('data-tip="Wren is making frame 3 · 3 running"')
    expect(html).not.toContain('aria-live')
    expect(html).not.toContain('jb-mark')
  })
  it('only a queued job (the screenshot\'s "Skye is waiting to start a draft"): the still logo, no words', () => {
    const html = button([job('a', 'script_draft' as DocJob['op'], 'queued')], 'Skye is waiting to start a draft')
    expect(html).toContain('data-state="queued"')
    expect(visibleText(html)).toBe('')
    expect(html).toContain('aria-label="Skye is waiting to start a draft"')
  })
  it('a question waiting for you, nothing running: the still logo with the brand-orange needs-you mark', () => {
    const html = button([job('q', 'shot_list', 'needs_input')], 'Dex is waiting for you')
    expect(html).toContain('napkin-loader nl-flat')
    expect(html).toContain('data-mark="ask"')
    expect(html).toContain('class="jb-mark"')
    expect(visibleText(html)).toBe('')
  })
  it('running with a question waiting: the turning logo keeps the orange mark', () => {
    const html = button([job('a', 'frame', 'submitted'), job('q', 'shot_list', 'needs_input')], 'Wren is making frame 1')
    expect(html).toContain('data-spin="run"')
    expect(html).toContain('data-mark="ask"')
    expect(html).toContain('aria-label="Wren is making frame 1 · 1 running · Waiting for you"')
  })
  it('a failure and nothing running: the still logo with the red mark, "1 failed" in words', () => {
    const html = button([job('f', 'frame', 'failed')])
    expect(html).toContain('data-mark="failed"')
    expect(html).toContain('aria-label="1 failed"')
    expect(html).not.toContain('agent-figure')
  })
  it('idle: no button at all', () => {
    expect(jobLook(groups([job('d', 'frame', 'completed')]))).toBeNull()
    expect(button([])).toBe('')
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
    expect(readFileSync(new URL('../stages/PhoneReview.tsx', import.meta.url), 'utf8')).toContain('<JobTray phone />')
    expect(src).toContain('{!phone && <AskDock />}')
  })
})
