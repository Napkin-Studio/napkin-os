// @vitest-environment happy-dom
// The Film node while Dex plans its shots straight from the script (live test 2026-11-16): it went blank
// and its title became "Video · Video" (its implicit shot list named it).
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ServicesContext, ShellContext, type Services } from '../../app/context'
import { SnapshotStore, systemUpdate } from '../../doc/store'
import { initialUi, type UiState } from '../../doc/ui'
import { mainStoryboard, mainVideo } from '../../model/selectors'
import type { ModelStore } from '../../model/store'
import { job, MAYA, modelStore } from '../../test/model'
import { VideoCard } from './cards'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let store: ModelStore | null = null
afterEach(async () => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  await store?.close()
  store = null
})

describe('the Film node while the Director agent plans straight from the script', () => {
  it('keeps its title and says the Director agent is planning', async () => {
    const s = modelStore()
    store = s
    await s.create(MAYA, 'EXT. CITY STREET - DUSK')
    let videoId = ''
    await systemUpdate(s, (d) => {
      const sb = mainStoryboard(d)!
      Object.assign(sb, { implicit: true, title: 'Video' })
      videoId = mainVideo(d)!.id
      const j = job(d, 'shot_list', [], null, { state: 'submitted', crew: 'dex', node: { kind: 'storyboard', id: sb.id } })
      d.jobs[j.id] = j
    }, 'test')
    const ui = new SnapshotStore<UiState>(initialUi())
    const runner = { subscribe: () => () => {}, getVersion: () => 0, liveInfo: () => undefined }
    const el = document.createElement('div')
    document.body.appendChild(el)
    act(() => {
      root = createRoot(el)
      const shell = { index: { get: () => ({ name: 'EXT. CITY STREET - DUSK' }), subscribe: () => () => {} } }
      root.render(createElement(ShellContext.Provider, { value: shell as never },
        createElement(ServicesContext.Provider, { value: { doc: s, ui, runner, project: { id: 'p1' } } as unknown as Services },
          createElement(VideoCard, { id: videoId, onOpen: () => {} }))))
    })
    expect(el.querySelector('.bl-cardhead b')?.textContent).not.toBe('Video · Video')
    expect(el.textContent).toContain('The Director agent is planning the shots from the script')
  })
})
