// @vitest-environment happy-dom
// The conflict box shows at once when a save is refused (Tidewell UAT: the second of two tabs got a 409 and no box until a reopen).
// jsdom, the real ServerCopy and the real box.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ServicesContext, ShellContext } from '../app/context'
import type { ProductionDocument } from '../contracts/types'
import { SaveConflict } from '../projects/server'
import { ServerCopy } from '../projects/serverCopy'
import { memoryStorage } from '../projects/storage'
import { SaveConflictBox } from './SaveConflict'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('a refused save', () => {
  it('shows the choice at once, in the open page', async () => {
    const server = {
      signedIn: true,
      save: vi.fn(async () => { throw new SaveConflict('This project was saved from somewhere else since you opened it.', 'sha256:theirs') }),
      version: vi.fn(async () => null),
    }
    const copy = new ServerCopy({
      id: 'p1', server: server as never, index: { get: () => ({ id: 'p1', name: 'Ad' }), setServer: vi.fn(async () => {}) } as never, storage: memoryStorage(),
      doc: () => ({ assets: {} }) as unknown as ProductionDocument, upload: async () => undefined,
      base: { mark: { etag: 'e0', savedAt: '2026-11-23T12:00:00Z' }, unsaved: true },
    })
    ;(copy as unknown as { base: unknown }).base = { etag: 'e0', savedAt: '2026-11-23T12:00:00Z' }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <ShellContext.Provider value={{} as never}>
          <ServicesContext.Provider value={{ serverCopy: copy, clan: null } as never}><SaveConflictBox /></ServicesContext.Provider>
        </ShellContext.Provider>,
      )
    })
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    await act(async () => { await copy.post(new Uint8Array([1, 2, 3]), { reason: 'interval' }).catch(() => {}) })
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('saved from another browser or tab')
    root.unmount()
  })
})
