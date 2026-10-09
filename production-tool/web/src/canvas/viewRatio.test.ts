import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// "view needs a ratio" stopped Make the other views (2026-10-07): the view request must carry the
// front view's ratio, as Generate does.
describe('Make the other views', () => {
  it('sends the same 4:5 ratio as the front view', () => {
    const src = readFileSync(new URL('./controller.ts', import.meta.url), 'utf8')
    const call = src.split('\n').find((l) => l.includes("runner.submit('view'"))
    expect(call).toBeDefined()
    expect(call).toContain("ratio: '4:5'")
  })
})
