// A paid job is written down before it is sent (re-test N1, 2026-11-18): a reload 0.7 s after a Fill lost
// job_01M7PW4R0B9WS5SRBNSASF7RMA, because the row and the job sat in the stores' 250 ms debounce while the
// relay was already paid.

import { describe, expect, it, vi } from 'vitest'
import { emptyDocument, memoryPersister, SnapshotDocumentStore, SnapshotStore } from '../doc/store'
import type { Doc } from '../doc/types'
import { initialUi, type UiState } from '../doc/ui'
import { MAYA } from '../test/jobFixtures'
import { JobRunner } from './runner'

const JOB = 'job_01K6XA7Q3M9V2D4R8T0B5C1E6F'

describe('a job before it is sent', () => {
  it('is in the stored document and UI state, with the row the caller put in first', async () => {
    const docSaved = memoryPersister<Doc>()
    const uiSaved = memoryPersister<UiState>()
    const doc = new SnapshotDocumentStore(emptyDocument(MAYA, 'Test ad'), docSaved as never, 250)
    const ui = new SnapshotStore<UiState>(initialUi(), uiSaved, 250)
    let seen: { doc?: Doc; ui?: UiState } = {}
    const relay = {
      kind: 'http',
      createJob: vi.fn(async (req: { jobId: string }) => {
        seen = { doc: docSaved.value, ui: uiSaved.value }
        return { jobId: req.jobId, state: 'submitted', projectId: doc.get().project.id, nextPollS: 600 }
      }),
      getJob: vi.fn(),
      cancelJob: vi.fn(),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = new JobRunner(relay as any, doc, ui)
    // The image editor's row, written just before the send (edits.ts sendWithRow).
    ui.update((u) => { u.imageEdits = { frame_1: { row: JOB } as never } })
    await runner.submit('region_edit', { text: 'a red cup' }, [], { for: 'canvas' }, JOB)
    expect(relay.createJob).toHaveBeenCalledOnce()
    expect(seen.doc?.jobs[JOB]).toMatchObject({ op: 'region_edit', state: 'queued' })
    expect(seen.ui?.jobs[JOB]?.request?.jobId).toBe(JOB)
    expect(seen.ui?.imageEdits?.frame_1).toEqual({ row: JOB })
    runner.stop()
  })
})
