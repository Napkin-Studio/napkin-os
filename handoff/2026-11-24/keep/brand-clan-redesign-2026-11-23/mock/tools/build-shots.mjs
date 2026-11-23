import { browser, seed, openClient, shoot, settle } from './build-lib.mjs'
const b = await browser()
const only = process.argv[2]?.split(',')
const DARK2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 64" width="160" height="64"><rect width="160" height="64" fill="#1C2630"/><circle cx="30" cy="32" r="15" fill="#3FC9A0"/><path d="M20 33 q5 -7 10 0 t10 0" stroke="#1C2630" stroke-width="3" fill="none" stroke-linecap="round"/><text x="52" y="39" font-family="Georgia, serif" font-weight="700" font-size="20" fill="#fff">Tidewell</text></svg>`
async function draftVia(s) {
  const v = await s.api.j('GET', `/brand-clans/${s.zero}`)
  const c = JSON.parse(JSON.stringify(v.data)); delete c.kit
  c.visual.colours[1].hex = '#3FC9A0'
  c.voice.rules.push({ id: 'can-upright', text: 'Always show the can upright.', kind: 'do' })
  await s.api.j('PUT', `/brand-clans/${s.zero}/draft`, { candidate: c })
}
const STATES = {
  b1: async () => {},
  b2: async p => { await p.getByRole('button', { name: /Tidewell · Zero/ }).click() },
  b3: async p => { await p.getByRole('button', { name: /Tidewell · Original/ }).click() },
  f1: async p => { await p.getByRole('button', { name: /Tidewell · Zero/ }).click(); await p.getByTestId('brand-edit').click() },
  f2: async p => {
    await p.getByRole('button', { name: /Tidewell · Zero/ }).click(); await p.getByTestId('brand-edit').click()
    await p.getByLabel('Mint hex').fill('#3FC9A0')
    await p.locator('input[type=file][aria-label="Replace Wordmark, dark ground"]').setInputFiles({ name: 'logo-zero-dark-2.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(DARK2) })
    await p.waitForSelector('.bcm-logos img[src*="logo-zero-dark-2"]')
    await p.getByRole('button', { name: '+ Add a rule' }).click()
    await p.getByLabel('Rule', { exact: true }).last().fill('Always show the can upright.')
    await p.getByTestId('save-draft').click(); await p.waitForSelector('[data-screen=draft]')
  },
  f3: async p => { await STATES.f2(p); await p.getByTestId('publish').click(); await p.waitForSelector('[data-testid=publish-confirm]') },
  f3b: async p => { await STATES.f3(p); await p.getByTestId('publish-go').click(); await p.waitForSelector('[data-testid=published]') },
  f4: async (p, s) => { await draftVia(s); await p.reload(); await p.waitForSelector('[data-testid=brand-item]'); await p.getByRole('button', { name: /Tidewell · Zero/ }).click(); await p.getByRole('button', { name: 'History' }).click(); await p.waitForSelector('[data-testid=brand-history]') },
  f4b: async (p, s) => { await STATES.f4(p, s); await p.getByRole('button', { name: 'Open, read-only' }).last().click(); await p.waitForSelector('[data-screen=old]') },
}
for (const w of [1280, 1024]) for (const [st, run] of Object.entries(STATES)) {
  if (only && !only.includes(st)) continue
  const ctx = await b.newContext({ viewport: { width: w, height: ['b1'].includes(st) ? 900 : 1450 } })
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0, 300)))
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)) })
  const s = await seed(p)
  await openClient(p, s)
  await run(p, s)
  await shoot(p, st, w)
  await ctx.close()
}
await b.close()
