// @vitest-environment happy-dom
// A take Runway refused as one video (features/connected-video.clan, the samurai ad, 2026-10-19): the strip says
// "Runway refused this as one video" and offers Make as separate clips and Edit the words.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServicesContext, type Services } from '../app/context'
import type { ProductionDocument } from '../contracts/types'
import { SnapshotDocumentStore, SnapshotStore } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { modelEntry } from '../jobs/runs'
import { videoPlan, videoUnits } from '../jobs/runView'
import { mainVideo } from '../model/selectors'
import { MAYA, snapshotDoc } from '../test/jobFixtures'
import { SHA, addFrame, addShots, job } from '../test/model'
import { StripTrack } from './VideoStrips'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function refused() {
  const d = structuredClone(snapshotDoc(MAYA).get()) as ProductionDocument
  const shots = addShots(d, 3)
  shots.forEach((s, i) => { Object.assign(s, { duration_s: 3, action: `Action ${i + 1}.` }); addFrame(d, s, SHA(`${i}`), { pick: true }) })
  const videoId = mainVideo(d)!.id
  const runId = 'run_01K7A00000000000000000RUN1'
  d.videos[videoId].runs = { [runId]: { shot_ids: shots.map((s) => s.id), mode: 'take', model: 'wan3', state: 'failed', planned_by: 'crew' } }
  d.jobs.job_r = job(d, 'clip', [], null, {
    id: 'job_r', state: 'failed', purpose: `run ${runId}`, node: { kind: 'video', id: videoId },
    error: { code: 'moderated', message: 'Runway refused the words twice (INPUT_PREPROCESSING.SAFETY.TEXT).', retryable: false },
  })
  return { d, shots, videoId }
}

describe('a strip Runway refused as one video', () => {
  it('says so and offers Make as separate clips and Edit the words', () => {
    const { d, shots, videoId } = refused()
    const units = videoUnits(d, { jobs: {} }, videoId, videoPlan(d, videoId, modelEntry('runway', 'wan3')!))
    const doc = new SnapshotDocumentStore(d, null, 0)
    const ui = new SnapshotStore<UiState>({ ...initialUi(), configChoice: 'live', providerChoice: 'config' })
    const services = { doc, ui, relay: { kind: 'http' }, remoteConfig: null, runner: { subscribe: () => () => {}, getVersion: () => 0, liveInfo: () => undefined } }
    const separately = vi.fn()
    const edit = vi.fn()
    const make = vi.fn()
    const el = document.createElement('div')
    document.body.appendChild(el)
    act(() => {
      root = createRoot(el)
      root.render(createElement(ServicesContext.Provider, { value: services as unknown as Services },
        createElement(StripTrack, {
          videoId, shots, units, card: (s) => createElement('div', { key: s.id }, s.action),
          onMakeStrip: make, onPlayStrip: vi.fn(), onMakeSeparately: separately, onEditWords: edit,
        })))
    })
    const strip = el.querySelector('section.ve-strip')!
    expect(strip.classList.contains('refused')).toBe(true)
    expect(strip.textContent).toContain('Runway refused this as one video')
    const buttons = [...strip.querySelectorAll('header button')].map((b) => b.textContent)
    expect(buttons).toEqual(['Make as separate clips', 'Edit the words'])  // no Make as one video again
    const click = (label: string) => act(() => { [...strip.querySelectorAll('button')].find((b) => b.textContent === label)!.click() })
    click('Make as separate clips')
    expect(separately).toHaveBeenCalledWith(shots.map((s) => s.id))
    click('Edit the words')
    expect(edit).toHaveBeenCalledWith(shots[0].id)
    expect(make).not.toHaveBeenCalled()
  })
})
