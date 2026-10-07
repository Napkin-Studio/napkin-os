import { describe, expect, it } from 'vitest'
import { normalisePromptVersion } from './runner'
import type { Job } from '../contracts/types'

describe('renamed prompts', () => {
  it('records director.v2.1 as director.v3, its new name', () => {
    const job = { director: { model: 'm', promptVersion: 'director.v2.1', output: {}, rationale: 'r' } } as unknown as Job
    normalisePromptVersion(job)
    expect(job.director?.promptVersion).toBe('director.v3')
  })
  it('leaves other versions alone', () => {
    const job = { director: { model: 'm', promptVersion: 'director.v2', output: {}, rationale: 'r' } } as unknown as Job
    normalisePromptVersion(job)
    expect(job.director?.promptVersion).toBe('director.v2')
  })
})
