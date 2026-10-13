// The ask card (ui-behaviour 3.17): it shows the agent's question with its options and the recommended
// one marked, and an option clicked answers the job through the runner (POST /jobs/{id}/answer).

import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// Server rendering has no store subscriptions: the hooks read the services' stores as they are.
vi.mock('../app/context', async (importOriginal) => {
  const real = await importOriginal<typeof import('../app/context')>()
  return { ...real, useDoc: () => real.useServices().doc.get(), useUi: () => real.useServices().ui.get() }
})

import { ServicesContext, type Services } from '../app/context'
import type { Ask, AnswerConflict } from '../contracts/types'
import { initialUi } from '../doc/ui'
import type { AnswerChoice } from '../jobs/runner'
import { snapshotDoc } from '../test/jobFixtures'
import { AskCard, AskOptions } from './AskCard'
import { sendAnswer } from './asks'

const ASK: Ask = {
  id: 'q_01', v: 1, field_v: {}, crew: 'dex', state: 'open', answers: [], job_id: 'job_01',
  node: { kind: 'storyboard', id: 'sb_01' },
  question: {
    id: 'q_01', kind: 'ambiguity', text: 'Is the umbrella red or yellow?', why: 'The script says both.', allow_text: true,
    recommended_option_id: 'o_red',
    options: [
      { id: 'o_red', label: 'Red', value: 'red' },
      { id: 'o_yellow', label: 'Yellow', value: 'yellow', detail: 'Matches the logo' },
    ],
  },
}

/** A runner that records what it was asked to send. */
function fakeRunner(conflict?: AnswerConflict) {
  const answered: [string, AnswerChoice][] = []
  const changed: [string, AnswerChoice][] = []
  return {
    answered, changed,
    async answer(jobId: string, choice: AnswerChoice) {
      answered.push([jobId, choice])
      return conflict ? { conflict } : { ok: true as const }
    },
    async change(jobId: string, choice: AnswerChoice) {
      changed.push([jobId, choice])
      return 'job_02'
    },
  }
}

function services(runner: ReturnType<typeof fakeRunner>): Services {
  const doc = snapshotDoc()
  const ui = initialUi()
  return { doc, runner, ui: { get: () => ui, subscribe: () => () => {} } } as unknown as Services
}

/** Every element in a tree, depth first. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  const el = node as ReactElement<Record<string, unknown>>
  return [el, ...elements(el.props.children as ReactNode)]
}

describe('the ask card', () => {
  it('shows the question, why, its options and the Recommended mark', () => {
    const runner = fakeRunner()
    const html = renderToStaticMarkup(createElement(ServicesContext.Provider, { value: services(runner) }, createElement(AskCard, { ask: ASK })))
    expect(html).toContain('Dex asks')
    expect(html).toContain('Is the umbrella red or yellow?')
    expect(html).toContain('The script says both.')
    expect(html).toContain('Red')
    expect(html).toContain('Yellow')
    expect(html).toContain('Matches the logo')
    expect(html.match(/Recommended/g)).toHaveLength(1)
    expect(html).toMatch(/Red<span class="askcard-rec"> · Recommended/)
    expect(html).toContain('aria-label="Your answer"') // allow_text: the box for own words
  })

  it('marks the recommended option with the readable tint, not the orange primary button', () => {
    const html = renderToStaticMarkup(createElement(AskOptions, { q: ASK.question, disabled: false, onPick: () => {} }))
    expect(html).not.toContain('primary') // white or orange text on --create fails WCAG AA
    expect(html).toMatch(/class="btn sm askcard-opt rec"[^>]*>Red/)
    expect(html).toMatch(/class="btn sm askcard-opt"[^>]*>Yellow/)
    expect(html).toContain('<span class="askcard-detail"> · Matches the logo</span>')
  })

  it('an option clicked answers the job through the runner', async () => {
    const runner = fakeRunner()
    const sent: Promise<string | null>[] = []
    const tree = AskOptions({ q: ASK.question, disabled: false, onPick: (optionId) => { sent.push(sendAnswer(runner, ASK, { optionId }, false, (b) => b ?? 'Someone')) } })
    const yellow = elements(tree).find((e) => e.type === 'button' && JSON.stringify(e.props.children).includes('Yellow'))
    expect(yellow).toBeDefined()
    ;(yellow!.props.onClick as () => void)()
    expect(await sent[0]).toBeNull()
    expect(runner.answered).toEqual([['job_01', { optionId: 'o_yellow' }]])
    expect(runner.changed).toEqual([])
  })

  it('says who answered first when someone did; Change sends a changed answer instead', async () => {
    const runner = fakeRunner({ error: { code: 'conflict', message: 'answered', retryable: false }, answeredBy: 'human:p_jo', answer: { option_id: 'o_red' } })
    expect(await sendAnswer(runner, ASK, { optionId: 'o_yellow' }, false, (b) => (b ?? '').replace('human:', '')))
      .toBe('p_jo answered first. Their answer stands; use Change to choose again.')
    expect(await sendAnswer(runner, ASK, { text: 'Blue, actually' }, true, (b) => b ?? '')).toBeNull()
    expect(runner.changed).toEqual([['job_01', { text: 'Blue, actually' }]])
  })
})
