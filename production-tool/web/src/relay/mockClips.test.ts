// The local stand-in records its test clips as MP4 only (owner 2026-11-18): the .clan keeps clips as mp4.
import { describe, expect, it } from 'vitest'
import { CLIP_RECORD_TYPES } from './mockRender'

describe('the mock’s clips', () => {
  it('are recorded as MP4, never webm', () => {
    expect(CLIP_RECORD_TYPES.length).toBeGreaterThan(0)
    for (const t of CLIP_RECORD_TYPES) expect(t.startsWith('video/mp4')).toBe(true)
  })
})
