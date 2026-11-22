// New deck from this project (features/production-spinoff.clan): the OS call, and the menu row that makes it.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DECK_APP_ID, SpinoffError, newDeckFromProject } from './spinoff'
import { osBriefSource } from '../brief/os'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A stand-in OS: /api/session names the tenant; the spin-off answers with `reply`. */
function os(reply: Response | (() => Response)) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url === '/api/session') return json(200, { tenant: 'ten-1' })
    return typeof reply === 'function' ? reply() : reply
  }
  return { calls, fetcher }
}

describe('a deck from the project', () => {
  it('asks the OS to spin the project off into Deck Maker, and says where the shell opens the new deck', async () => {
    const { calls, fetcher } = os(json(200, { ok: true, path: 'ie-napkin-deck-maker-1a2b3c4d', source_uri: 'production:prj_X@abc' }))
    const made = await newDeckFromProject('prj_01K7A000000000000000000012', { fetcher, src: osBriefSource('', fetcher) })
    expect(calls.map((c) => [c.init?.method ?? 'GET', c.url])).toEqual([
      ['GET', '/api/session'],
      ['POST', '/api/t/ten-1/production/prj_01K7A000000000000000000012/spinoff'],
    ])
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ target_app_id: DECK_APP_ID })
    expect(DECK_APP_ID).toBe('ie.napkin.deck-maker')
    expect(made).toEqual({ docId: 'ie-napkin-deck-maker-1a2b3c4d', url: '/?open=ie-napkin-deck-maker-1a2b3c4d', sourceUri: 'production:prj_X@abc' })
  })

  it('says why it could not, in the OS’s words or ours', async () => {
    await expect(newDeckFromProject('prj_x', { ...os(json(404, { error: 'x' })) })).rejects.toThrow(/Save it, then try again/)
    await expect(newDeckFromProject('prj_x', { ...os(json(404, { error: 'app not installed: ie.napkin.deck-maker' })) })).rejects.toThrow('Deck Maker is not installed here')
    await expect(newDeckFromProject('prj_x', { ...os(json(422, { ok: false, error: 'Deck Maker is not installed' })) })).rejects.toThrow('Deck Maker is not installed')
    await expect(newDeckFromProject('prj_x', { ...os(json(200, { ok: true })) })).rejects.toBeInstanceOf(SpinoffError)
    const signedOut = async () => json(401, { signin: true })
    await expect(newDeckFromProject('prj_x', { fetcher: signedOut })).rejects.toThrow(/not signed in/)
  })
})

describe('the document menu', () => {
  const menu = readFileSync(new URL('../ui/chrome/DocMenu.tsx', import.meta.url), 'utf8')
  it('offers New deck from this project only where Napkin serves the page and the project can be saved; the stub is gone', () => {
    expect(menu).toContain('New deck from this project')
    expect(menu).not.toContain('New deck from this film')
    expect(menu).toContain('deck={deckOn && saving.can}')
    expect(menu).toMatch(/\{deck && \(\s*<MenuItem[^>]*>[^]*?New deck from this project/)
    expect(menu).toContain('deckOffered()')
  })
  it('saves first, then calls the OS, then opens the new deck in the shell; a failed save makes no deck', () => {
    const row = menu.slice(menu.indexOf("run('deck'"), menu.indexOf("busy === 'deck'"))
    expect(row.indexOf('await save()')).toBeGreaterThan(-1)
    expect(row.indexOf('await save()')).toBeLessThan(row.indexOf('newDeckFromProject('))
    expect(row).toContain('window.location.assign(')
    expect(row).toMatch(/could not be saved, so the deck was not made/)
  })
})
