import { describe, expect, it } from 'vitest'
import type { AssetRef, JobInput, JobInputRef } from '../contracts/types'
import { onePictureOnce } from './onePicture'

const pic = (c: string): AssetRef => ({ sha256: `sha256:${c.repeat(64)}`, url: `https://cdn.test/${c}`, mime: 'image/png' })
const ref = (id: string, c: string, extra: Partial<JobInputRef> = {}): JobInputRef => ({ id, name: `${id}_front`, role: 'character', kind: 'picture', asset: pic(c), ...extra })

describe('one picture is sent once (UAT round 4, R4-F5)', () => {
  it('round 4 repro: frame 2 with frame 1 as anchor and as previous sends it once, as the anchor', () => {
    const input: JobInput = { refs: [ref('maya', 'a'), ref('maya_full', 'b')], anchorFrame: pic('1'), previousFrame: pic('1') }
    const out = onePictureOnce(input)
    expect(out.anchorFrame).toEqual(pic('1'))
    expect(out.previousFrame).toBeUndefined()
    expect(out.refs).toHaveLength(2)
  })
  it('a continuity frame equal to a reference goes; the reference (it has a name) stays', () => {
    const out = onePictureOnce({ refs: [ref('mia', '1')], anchorFrame: pic('1'), previousFrame: pic('2') })
    expect(out.anchorFrame).toBeUndefined()
    expect(out.previousFrame).toEqual(pic('2'))
    expect(out.refs).toEqual([ref('mia', '1')])
  })
  it('two references of one picture keep the first; a last frame equal to the first frame goes', () => {
    const out = onePictureOnce({ image: pic('9'), refs: [ref('a', '3'), ref('b', '3')], lastFrame: { asset: pic('9'), atS: 2 } })
    expect(out.refs?.map((r) => r.id)).toEqual(['a'])
    expect(out.lastFrame).toBeUndefined()
    expect(out.image).toEqual(pic('9'))
  })
  it('an input with nothing repeated is the same', () => {
    const input: JobInput = { image: pic('1'), refs: [ref('a', '2')], anchorFrame: pic('3'), previousFrame: pic('4') }
    expect(onePictureOnce(input)).toEqual(input)
  })
})
