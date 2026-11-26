// "What the X agent will send" lists the brief (features/production-new-ui.clan; brief/model.ts briefSendRow).
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../contracts/types'
import { makeClipsRows, sendRows } from './sendRows'
import * as model from '../brief/model'
import { vi } from 'vitest'

describe('What the agent will send', () => {
  it('lists what the action names, then the brief when one reaches the node, then that nothing goes yet', () => {
    const spy = vi.spyOn(model, 'briefSendRow').mockReturnValue({ key: 'brief:b1', briefId: 'b1', label: 'Brief · Colour of the market · v2', detail: 'proposition, audience · linked', via: 'link' })
    const rows = sendRows({} as ProductionDocument, 'sb1', [{ key: 'shots', label: '5 frames, their words and camera' }], 'Make clips')
    expect(rows.map((r) => r.label)).toEqual(['5 frames, their words and camera', 'Brief · Colour of the market · v2', 'Nothing goes until you press Make clips.'])
    expect(rows[1].detail).toBe('proposition, audience · linked')
    spy.mockReturnValue(undefined)
    expect(sendRows({} as ProductionDocument, 'sb1', [], 'Plan shots').map((r) => r.key)).toEqual(['promise'])
  })

  it('Make clips counts the frames, not the type end card, and says it opens the Film room (UAT round 3, R3-F10)', () => {
    const { what, promise } = makeClipsRows(5, 1, 2)
    expect(what.map((r) => r.label)).toEqual(['5 frames, their words and camera', '2 named pictures'])
    expect(what[0].detail).toBe('the end card is typeset from its words, no clip')
    expect(promise).toBe('Make clips opens the Film room. Nothing goes until you press Make on a box there.')
    expect(makeClipsRows(1, 0, 1).what.map((r) => r.label)).toEqual(['1 frame, their words and camera', '1 named picture'])
    expect(makeClipsRows(1, 0, 1).what[0].detail).toBeUndefined()
    vi.spyOn(model, 'briefSendRow').mockReturnValue(undefined)
    expect(sendRows({} as ProductionDocument, 'sb1', what, 'Make clips', 'clip', promise).at(-1)!.label).toBe(promise)
  })
})
