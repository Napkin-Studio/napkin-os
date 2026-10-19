import { describe, expect, it } from 'vitest'
import { agentForDocument } from './runner'
import type { AgentBlock } from '../contracts/types'

describe('the director block in the document', () => {
  const block: AgentBlock = {
    model: 'claude-haiku-4-5', promptVersion: 'director.v4', output: {}, rationale: 'r', latencyMs: 900,
    cards: [{ tag: 'hero_front', sha256: `sha256:${'a'.repeat(64)}`, kind: 'character', card: 'A robot' }],
  }

  it('leaves the cards out: a .clan made before them refuses the field', () => {
    const doc = agentForDocument(block)
    expect(doc).toEqual({ model: 'claude-haiku-4-5', promptVersion: 'director.v4', output: {}, rationale: 'r', latencyMs: 900 })
    expect(block.cards).toHaveLength(1) // the relay's block is not changed
  })

  it('passes a block without cards as it is', () => {
    const { cards: _c, ...plain } = block
    expect(agentForDocument(plain)).toBe(plain)
  })
})
