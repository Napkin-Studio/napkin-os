// A size tile's second caption line must not run past its tile (Tidewell UAT, S4: "1440×2560 · Regenerate" overlapped the next tile's caption).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the Sizes overview caption', () => {
  const css = readFileSync(new URL('./campaign.css', import.meta.url), 'utf8')
  const rule = /\.ov-cap span \{([^}]*)\}/.exec(css)?.[1] ?? ''
  it('wraps inside its tile instead of running past it', () => {
    expect(rule).not.toMatch(/white-space:\s*nowrap/)
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
  })
})
