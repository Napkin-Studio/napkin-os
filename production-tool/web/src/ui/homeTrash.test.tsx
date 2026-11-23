// @vitest-environment happy-dom
// Deleting a project, in one set of words (features/library-trash): Home's card and the project's own menu both say
// "Move to Trash…" and "You can restore it for 30 days", and Home links to the Trash (the client's, or the agency's).

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShellContext } from '../app/context'
import { deleteWords, TRASH_GO, TRASH_HINT, TRASH_LABEL, TRASH_SUB, trashHref, trashQuestion } from '../projects/deleteWords'
import type { ProjectEntry } from '../projects/projectIndex'
import type { Shell } from '../projects/shell'
import { ProjectCard, TrashLink } from './Home'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = '' })

const entry: ProjectEntry = {
  id: 'p1', name: 'Hollow Oak', naming: 'person', created: '2026-11-20T10:00:00Z', updated: '2026-11-22T10:00:00Z',
  summary: { stage: 'storyboard', pictures: 0, shots: 3, behind: 0, adSeconds: null, active: 0, shas: [] },
}

function card(menu = true) {
  const remove = vi.fn(async () => {})
  const shell = { remove, open: vi.fn(), duplicate: vi.fn(), rename: vi.fn(), exportProject: vi.fn() } as unknown as Shell
  const el = document.body.appendChild(document.createElement('div'))
  root = createRoot(el)
  act(() => root!.render(createElement(ShellContext.Provider, { value: shell }, createElement(ProjectCard, { p: entry, newerThere: false, menu, onMenu: () => {}, onError: () => {} }))))
  return { el, remove }
}

describe('the words', () => {
  it('say Trash and 30 days, never "from this browser"', () => {
    expect(TRASH_LABEL).toBe('Move to Trash…')
    expect(TRASH_HINT).toBe('You can restore it for 30 days')
    expect(trashQuestion('Hollow Oak')).toBe('Move “Hollow Oak” to Trash?')
    expect(TRASH_SUB).toBe('You can restore it for 30 days.')
    expect(deleteWords('Hollow Oak')).toBe('Move “Hollow Oak” to Trash? You can restore it for 30 days.')
  })
  it('no menu or card still carries the stale wording, and both import the one set', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)))
    const src: string[] = []
    const walk = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) src.push(p) })
    walk(dir)
    for (const f of src) expect(readFileSync(f, 'utf8'), f).not.toMatch(/server(’|')s copy is kept/)
    for (const f of ['Home.tsx', 'chrome/DocMenu.tsx']) expect(readFileSync(join(dir, f), 'utf8'), f).toMatch(/TRASH_LABEL/)
  })
})

describe('the project card', () => {
  it('offers Move to Trash… and asks with the same words, then moves it', () => {
    const { el, remove } = card()
    const item = [...el.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === TRASH_LABEL) as HTMLElement
    expect(item).toBeTruthy()
    expect(el.textContent).not.toContain('Delete')
    act(() => item.click())
    const ask = el.querySelector('[role="alertdialog"]')!
    expect(ask.getAttribute('aria-label')).toBe('Move “Hollow Oak” to Trash?')
    expect(ask.textContent).toContain('Move “Hollow Oak” to Trash? You can restore it for 30 days.')
    const buttons = [...ask.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).toEqual(['Cancel', TRASH_GO])
    act(() => (ask.querySelectorAll('button')[1] as HTMLElement).click())
    expect(remove).toHaveBeenCalledWith('p1')
  })
})

describe('Home\'s Trash link', () => {
  it('opens the client\'s Trash, or the agency\'s when there is no client', () => {
    expect(trashHref('cli_0a1b2c3d')).toBe('/#client-cli_0a1b2c3d-trash')
    expect(trashHref()).toBe('/#trash')
    const el = document.body.appendChild(document.createElement('div'))
    root = createRoot(el)
    act(() => root!.render(createElement(TrashLink, { clientId: 'cli_0a1b2c3d' })))
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/#client-cli_0a1b2c3d-trash')
    act(() => root!.render(createElement(TrashLink, {})))
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/#trash')
    expect(el.querySelector('a')!.textContent).toBe('Trash')
  })
})
