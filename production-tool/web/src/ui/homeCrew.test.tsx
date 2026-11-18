// Home shows the whole crew (owner, 2026-10-15: "We have more agents right?"; ui-behaviour 5.1, mock
// Crew.dc.html): all seven figures, each named with the work they do, and Dex's line names the rest.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CAST, CREW_ORDER } from './agents/cast'
import { CrewLine, CrewRow } from './HomeCrew'
import { FIRST_AD } from './homeWords'

const SEVEN = ['dex', 'skye', 'wren', 'rhea', 'edie', 'ellis', 'jude']

describe("Home's crew", () => {
  it('is all seven, in the crew sheet\'s order', () => {
    expect(CREW_ORDER).toEqual(SEVEN)
  })

  it('the first-visit row draws each one, named with the work they do', () => {
    const html = renderToStaticMarkup(<CrewRow />)
    expect(html.match(/<svg/g)?.length).toBe(7)
    for (const k of SEVEN) {
      expect(html).toContain(`<b>${CAST[k as keyof typeof CAST].given}</b>`)
      expect(html).toContain(`<span>${CAST[k as keyof typeof CAST].job}</span>`)
    }
  })

  it('draws every name the same way: none is highlighted (owner, 2026-10-15)', () => {
    const html = renderToStaticMarkup(<CrewRow />)
    const classes = [...html.matchAll(/<li class="([^"]*)"/g)].map((m) => m[1])
    expect(classes).toHaveLength(7)
    for (const c of classes) expect(c).toMatch(/^hm-mate( house)?$/)
    expect(html.match(/<b>[^<]+<\/b>/g)).toHaveLength(7)
  })

  it('the New project card shows the same seven', () => {
    expect(renderToStaticMarkup(<CrewLine />).match(/<svg/g)?.length).toBe(7)
  })

  it("Dex's line names everyone else", () => {
    for (const k of SEVEN.filter((x) => x !== 'dex')) expect(FIRST_AD).toContain(CAST[k as keyof typeof CAST].given)
  })
})
