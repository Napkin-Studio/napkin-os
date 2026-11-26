import { afterEach, describe, expect, it } from 'vitest'
import { forgetMedia, setWorkspace, workspacePictureUrl } from './media'

describe('a Territories frame in the workspace store (owner, 2026-11-26)', () => {
  afterEach(() => forgetMedia())
  it('is addressed by its hash under the session tenant, and not at all without one', () => {
    const sha = 'ab'.repeat(32)
    expect(workspacePictureUrl(sha)).toBeNull()
    setWorkspace('f283da90-07cd-59ec-b370-b23704a2bc91')
    expect(workspacePictureUrl(sha)).toBe(`/api/t/f283da90-07cd-59ec-b370-b23704a2bc91/blobs/sha256:${sha}`)
    expect(workspacePictureUrl(`sha256:${sha}`)).toBe(`/api/t/f283da90-07cd-59ec-b370-b23704a2bc91/blobs/sha256:${sha}`)
    setWorkspace('../evil')
    expect(workspacePictureUrl(sha)).toBeNull()
  })
})
