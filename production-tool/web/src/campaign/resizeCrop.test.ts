// Resize… crops (UAT round 2 R2-9, IMG-4): a crop comes back at its own size; what must stay is remembered for the
// picture's next Resize; a crop moved by hand survives new boxes that it still keeps in.
import { describe, expect, it } from 'vitest'
import { cropDelivery, cropKeeps, rememberedProtect, rememberProtect, resizeInput, type Planned } from './resizeSelection'
import type { ProtectBox } from '../contracts/types'

const src = { elId: 'e', nodeId: 'n', asset: 'sha256:' + 'a'.repeat(64), w: 1365, h: 768, kind: 'picture' as const }
const box: ProtectBox = { role: 'subject', label: 'subject', x: 488, y: 299, w: 293, h: 317 }

function memory() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('Resize crops', () => {
  it('a 4:5 crop of a 1365 x 768 picture comes back 614 x 768, not 1638 x 2048', () => {
    const p = { source: src, shape: { id: '4:5', w: 4, h: 5 }, method: 'crop' } as unknown as Planned
    expect(cropDelivery(p)).toEqual({ width: 614, height: 768 })
    const input = resizeInput(p, { sha256: src.asset, url: 'https://x/a.png', mime: 'image/png' })
    expect(input.delivery).toEqual({ width: 614, height: 768 })
    // A custom pixel size is made at that size: the person asked for it.
    const px = { ...p, shape: { id: '1200×1500', w: 1200, h: 1500, px: true } } as unknown as Planned
    expect(resizeInput(px, { sha256: src.asset, url: 'https://x/a.png', mime: 'image/png' }).delivery).toEqual({ width: 1200, height: 1500 })
  })

  it('what must stay is remembered per picture, scaled to its size; a moved crop that keeps the boxes stays', () => {
    const store = memory()
    expect(rememberedProtect(src.asset, src, store)).toBeUndefined()
    rememberProtect(src.asset, src, [box], store)
    expect(rememberedProtect(src.asset, src, store)).toEqual([box])
    expect(rememberedProtect(src.asset, { w: 2730, h: 1536 }, store)![0]).toMatchObject({ x: 976, w: 586 })
    expect(cropKeeps({ x: 400, y: 0, w: 614, h: 768 }, [box])).toBe(true)
    expect(cropKeeps({ x: 0, y: 0, w: 614, h: 768 }, [box])).toBe(false)
  })
})
