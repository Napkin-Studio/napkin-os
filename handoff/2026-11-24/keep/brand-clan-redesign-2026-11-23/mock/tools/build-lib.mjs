// Seeds the build stack (port 5450) through the real API, then drives the real client page for each mock state.
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
export const B = 'http://127.0.0.1:5450'
export const OUT = new URL('../build/', import.meta.url).pathname
export const browser = () => chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })

const logo = (c, bg, ink, word = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 64" width="160" height="64" role="img" aria-label="Tidewell logo"><rect width="160" height="64" fill="${bg}"/><circle cx="${word ? 30 : 80}" cy="32" r="15" fill="${c}"/><path d="${word ? 'M20 33 q5 -7 10 0 t10 0' : 'M70 33 q5 -7 10 0 t10 0'}" stroke="${bg}" stroke-width="3" fill="none" stroke-linecap="round"/>${word ? `<text x="52" y="39" font-family="Georgia, serif" font-weight="700" font-size="20" fill="${ink}">Tidewell</text>` : ''}</svg>`
const img = (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 64" width="160" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="64" fill="url(#g)"/></svg>`
const sha10 = s => createHash('sha256').update(s).digest('hex').slice(0, 10)
// A file the build uploads: its stored name is content-prefixed (contract section 5).
const file = (name, body) => ({ name, body, stored: `human/assets/${sha10(body)}-${name}` })

const L = (c, k) => ({ light: file(`logo-${k}-light.svg`, logo(c, '#FFFFFF', '#1C2630')), dark: file(`logo-${k}-dark.svg`, logo('#7FD6BD', '#1C2630', '#FFFFFF')), mark: file(`logo-${k}-mark.svg`, logo('#9AA7B1', '#FFFFFF', '#1C2630', false)) })
const imgs = [img('#d7efe7', '#9AA7B1'), img('#f4f6f7', '#7FD6BD'), img('#1C2630', '#5a7480')].map((b, i) => file(`img-${i + 1}.svg`, b))

function bible({ k, c, pal, serif = '700', tone, rules, style, note }) {
  const lg = L(c, k)
  return {
    files: [lg.light, lg.dark, lg.mark, ...imgs],
    note,
    visual: {
      logos: [
        { id: 'wordmark-light', label: 'Wordmark, light ground', variant: 'light', asset: lg.light.stored },
        { id: 'wordmark-dark', label: 'Wordmark, dark ground', variant: 'dark', asset: lg.dark.stored },
        { id: 'mark', label: 'Mark', variant: 'mark', asset: lg.mark.stored },
      ],
      logo_note: 'Keep a clear space the height of the “T” on every side.',
      colours: pal.map(([id, name, hex, role]) => ({ id, name, hex, role })),
      typography: [
        { id: 'serif', family: 'Tidewell Serif', weight: serif, use: 'headlines', role: 'head' },
        { id: 'sans', family: 'Tidewell Sans', weight: '400 / 600', use: 'body copy', role: 'body' },
      ],
    },
    voice: { tone, rules: rules.map(([id, text, kind]) => ({ id, text, kind })) },
    imagery: { style, bans: [], examples: imgs.map((f, i) => ({ id: `ex${i + 1}`, asset: f.stored })) },
  }
}

export const BIBLES = {
  original: bible({ k: 'orig', c: '#0B5D8A', note: 'The core look', pal: [['tide', 'Tide blue', '#0B5D8A', 'accent'], ['mist', 'Mist', '#E9F3F8', 'paper'], ['deep', 'Deep', '#102A3A', 'ink'], ['sun', 'Sun', '#F2B134', 'other']], tone: 'Warm and chatty', rules: [['r1', 'Blue leads; yellow only as a spark.', 'do']], style: 'Open water and morning light.' }),
  zero: bible({ k: 'zero', c: '#1C2630', note: 'Zero Sugar: silver and mint', pal: [['silver', 'Silver', '#9AA7B1', 'other'], ['mint', 'Mint', '#8FE0C8', 'accent'], ['ink', 'Ink', '#1C2630', 'ink']], tone: 'Clear, cool, a little dry. Never shouty; one idea per line.', rules: [['mint-accent', 'Mint only as an accent, never behind body text.', 'dont'], ['busy', 'Logo never on a busy picture.', 'dont'], ['diet', 'No “diet” wording; say “zero sugar”.', 'dont']], style: 'Daylight, cold metal and water. No people drinking in cars.' }),
  s26: bible({ k: 's26', c: '#FF7A62', note: 'Experiment: coral and sky', pal: [['coral', 'Coral', '#FF7A62', 'accent'], ['sky', 'Sky', '#8FD0F0', 'other'], ['night', 'Night', '#2A2340', 'ink'], ['cream', 'Cream', '#FFF3E8', 'paper']], tone: 'Playful and bright.', rules: [['r1', 'Coral for the hero, sky for support.', 'do']], style: 'Sunset beaches and long shadows.' }),
}

export class Api {
  constructor(page, tenant) { this.p = page.request; this.t = `${B}/api/t/${tenant}` }
  async j(method, path, data) {
    const r = await this.p.fetch(`${this.t}${path}`, { method, ...(data !== undefined ? { data } : {}) })
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`)
    return r.json()
  }
  async put(path, f) {
    const r = await this.p.fetch(`${this.t}/brand-clans/${path}/assets?name=${encodeURIComponent(f.name)}`, { method: 'POST', data: Buffer.from(f.body), headers: { 'content-type': 'application/octet-stream' } })
    if (!r.ok()) throw new Error(`asset ${f.name}: ${r.status()} ${await r.text()}`)
    const out = await r.json()
    if (out.path !== f.stored) throw new Error(`stored name ${out.path} != ${f.stored}`)
  }
}

/** One brand clan: v1 built from the book, then the later versions the caller asks for. */
export async function makeClan(api, client, name, key, extra = {}) {
  const { files, note, ...bib } = BIBLES[key]
  const v = await api.j('POST', `/clients/${client}/brand-clans`, {
    name, note, candidate: { ...bib, ...(extra.v1 ?? {}) }, source: { file: 'Tidewell-brand-book-2026.pdf', kind: 'pdf', pages: 48 }, from: { kind: 'build', file: 'Tidewell-brand-book-2026.pdf' },
  })
  for (const f of files) await api.put(v.path, f)
  return v
}

export async function seed(page) {
  const who = 'aoife@napkin'
  await page.goto(B + '/')
  const si = await page.request.post(`${B}/api/auth/sign-in`, { data: { username: who } })
  if (!si.ok()) throw new Error(`sign-in ${si.status()}`)
  await page.goto(B + '/')
  const { tenant } = await (await page.request.get(`${B}/api/session`)).json()
  const api = new Api(page, tenant)
  // One agency serves every state: an earlier Tidewell is renamed out of the way.
  for (const old of await api.j('GET', '/clients')) await api.j('PATCH', `/clients/${old.id}`, { name: `Earlier ${old.id.slice(4)}` })
  const c = await api.j('POST', '/clients', { name: 'Tidewell' })
  const mk = async (app, title) => (await api.j('POST', '/documents', { app_id: app, title, client_id: c.id })).path
  const brief = await mk('ie.napkin.brief-maker', 'Tidewell Zero: summer brief')
  await mk('ie.napkin.campaign-research', 'Sparkling water: category research')
  await mk('ie.napkin.deck-maker', 'Summer Zero pitch')
  // Original (the default): v1 built, v2 edited, a new version waiting.
  const o = await makeClan(api, c.id, 'Original', 'original')
  const od = JSON.parse(JSON.stringify((await api.j('GET', `/brand-clans/${o.path}`)).data)); delete od.kit
  od.voice.rules.push({ id: 'r2', text: 'Never stack two headlines.', kind: 'dont' })
  await api.j('PUT', `/brand-clans/${o.path}/draft`, { candidate: od })
  await api.j('POST', `/brand-clans/${o.path}/publish`, { expect_version: 1 })
  const waiting = JSON.parse(JSON.stringify(od))
  waiting.visual.colours[0].hex = '#0A6BA0'
  waiting.visual.typography[0].weight = '800'
  waiting.voice.rules.push({ id: 'clear-space', text: 'Clear space the height of the “T”', kind: 'do' })
  waiting.voice.tone = 'Clear, cool, a little dry'
  await api.j('POST', `/brand-clans/${o.path}/proposal`, { candidate: waiting, source: { file: 'Tidewell-brand-book-2026.pdf', kind: 'pdf', pages: 48 }, from: { kind: 'upload', file: 'Tidewell-brand-book-2026.pdf' } })
  // Zero: v1 built, v2 from an upload.
  const z = await makeClan(api, c.id, 'Zero', 'zero')
  const zd = JSON.parse(JSON.stringify((await api.j('GET', `/brand-clans/${z.path}`)).data)); delete zd.kit
  zd.visual.colours[1].hex = '#7FD6BD'
  zd.visual.colours.push({ id: 'foam', name: 'Foam', hex: '#F4F6F7', role: 'paper' })
  zd.imagery.bans = ['people drinking in cars']
  await api.j('POST', `/brand-clans/${z.path}/proposal`, { candidate: zd, source: { file: 'Tidewell-brand-book-2026.pdf', kind: 'pdf', pages: 48 }, from: { kind: 'upload', file: 'Zero-pack-update.pdf' } })
  await api.j('POST', `/brand-clans/${z.path}/proposal/accept`, { take: 'all', expect_version: 1 })
  // Summer 26: v1.
  await makeClan(api, c.id, 'Summer 26', 's26')
  // The brief takes Zero v2 (attach, as it is), so an Update chip has something to say after a publish.
  const open = await (await page.request.get(`${B}/api/t/${tenant}/d/${brief}`)).json()
  const zv = await api.j('GET', `/brand-clans/${z.path}`)
  const at = await page.request.post(`${B}/s/${open.token}/attach`, { data: { document_id: zv.document_id } })
  if (!at.ok()) throw new Error(`attach: ${at.status()} ${await at.text()}`)
  return { tenant, client: c.id, api, zero: z.path, original: o.path }
}

export async function openClient(page, s) {
  await page.goto(`${B}/#client-${s.client}`)
  await page.waitForSelector('[data-testid=client-page]')
  await page.waitForSelector('[data-testid=brand-item]')
  await page.waitForTimeout(700)
}

export async function settle(page, ms = 600) {
  await page.waitForTimeout(ms)
  await page.mouse.move(2, 500)
}

export async function shoot(page, name, w) {
  await page.evaluate(() => { const e = document.getElementById('bcm'); if (e) window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 90) })
  await settle(page, 700)
  await page.screenshot({ path: `${OUT}build-${name}-${w}.png` })
}
