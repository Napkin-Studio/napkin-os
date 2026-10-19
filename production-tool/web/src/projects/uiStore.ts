// The UiState the panels see, made of two stores (features/project-home.clan):
// the app's part (signed in, dev switch, view), one for the whole app, and the
// open project's part (job purposes, drafts, regions, undo steps, update runs),
// one per project. A write goes to whichever part it changed, so nothing the
// project keeps can land in another project.

import type { SnapshotStore } from '../doc/store'
import { splitUi, type AppUi, type ProjectUi, type UiState } from '../doc/ui'

/** What the panels, the runner and the chains use of a UI store. */
export type UiStore = Pick<SnapshotStore<UiState>, 'get' | 'subscribe' | 'update' | 'replace' | 'flush'>

export class ProjectUiStore implements UiStore {
  private readonly app: SnapshotStore<AppUi>
  private readonly part: SnapshotStore<ProjectUi>
  private merged: UiState | null = null
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: (() => void)[]
  private closed = false

  constructor(app: SnapshotStore<AppUi>, part: SnapshotStore<ProjectUi>) {
    this.app = app
    this.part = part
    const changed = () => {
      this.merged = null
      for (const fn of this.listeners) fn()
    }
    this.unsubscribe = [app.subscribe(changed), part.subscribe(changed)]
  }

  get = (): UiState => (this.merged ??= { ...this.part.get(), ...this.app.get() })

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  update(fn: (draft: UiState) => void, why?: string) {
    const draft = structuredClone(this.get())
    fn(draft)
    this.replace(draft, why)
  }

  replace(v: UiState, _why?: string) {
    const { app, project } = splitUi(v)
    const appNow = this.app.get()
    if (JSON.stringify(app) !== JSON.stringify(pick(appNow, Object.keys(app)))) this.app.replace({ ...appNow, ...app } as AppUi)
    // A project that was closed keeps what it had: a late write (a job's chain still unwinding) is dropped.
    if (this.closed) return
    if (JSON.stringify(project) !== JSON.stringify(this.part.get())) this.part.replace(project as ProjectUi)
  }

  async flush() {
    await this.part.flush()
    await this.app.flush()
  }

  /** The project is closed: write what it has, stop listening, take no more writes to its part. */
  async close() {
    await this.part.flush()
    this.closed = true
    for (const u of this.unsubscribe) u()
    this.listeners.clear()
  }
}

function pick(o: object, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = (o as Record<string, unknown>)[k]
  return out
}
