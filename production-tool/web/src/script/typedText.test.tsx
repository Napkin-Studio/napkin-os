import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TypedText } from './TypedText'

describe('a closed Video · Audio row marks @names as Screenplay does', () => {
  it('a name in scope as a mention, another underlined, in .sp-static', () => {
    const html = renderToStaticMarkup(<TypedText text="@mira meets @ghost in the rain." names={['mira']} />)
    expect(html).toBe('<span class="sp-static"><span class="mention-typed">@mira</span> meets <span class="mention-typed unknown">@ghost</span> in the rain.</span>')
  })
})
