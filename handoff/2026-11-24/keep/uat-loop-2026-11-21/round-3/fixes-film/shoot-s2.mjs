// Paired before/after screenshots for pt-film-r3 S2 fixes (in-browser mock relay; nothing paid).
// usage: node shoot-s2.mjs <baseUrl> <before|after> <outDir> [only]
import { createRequire } from 'node:module'
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-film-r3/production-tool/web/package.json')
const { chromium } = require('@playwright/test')
const [base, tag, out, only] = process.argv.slice(2)

const pic = (colour) => `(() => { const c = document.createElement('canvas'); c.width = 1344; c.height = 756; const x = c.getContext('2d'); x.fillStyle = '${colour}'; x.fillRect(0,0,1344,756); x.fillStyle = '#fff'; x.beginPath(); x.arc(672,378,150,0,7); x.fill(); return c.toDataURL('image/jpeg', 0.8) })()`

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => console.log(`[${tag}] pageerror`, e.message))
  await page.goto(`${base}/?engine=own`)
  for (let i = 0; i < 4; i++) {
    try { await page.waitForFunction(() => !!window.__seed, null, { timeout: 30000 }); break } catch { await page.waitForLoadState('load') }
  }
  return page
}

async function film(page, takes = true) {
  await page.evaluate(async ([pics, takes]) => {
    const shots = [
      { pic: pics[0], action: '1 a.m. A dark kitchen, lit only by the open fridge.', s: 1.5 },
      { pic: pics[1], action: 'The kettle glows blue and boils without a sound.', s: 2 },
      { pic: pics[2], action: 'She whispers to the kettle, relieved.', s: 1.5 },
    ]
    await window.__seed.market({ title: 'Quietboil', shots })
    if (takes) await window.__seed.takes()
  }, [await Promise.all(['#5a3b2e', '#2e4a5a', '#3b5a2e'].map((c) => page.evaluate(pic(c)))), takes])
}

const room = async (page, which) => {
  await page.evaluate(() => window.__pt.ui.update((u) => { u.stage = 'video' }, 'screenshots'))
  await page.waitForTimeout(1500)
  if (which === 'edit') {
    const b = page.getByRole('button', { name: 'Go to Edit' })
    if (await b.count()) await b.first().click()
    await page.waitForTimeout(800)
  }
}

const change = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const U = (p) => `${p}_${Array.from({ length: 26 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('').replace(/^./, '0')}`
  window.__ids = window.__ids || {}
  const I = (name, p) => (window.__ids[name] ??= U(p))
  const f = new Function('d', 'a', 'I', src)
  await window.__pt.doc.change((d) => f(d, a, I), { action: 'screenshot seed', undo: false })
  await window.__pt.doc.flush?.()
}, [fn, arg])

const shoot = async (page, name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}-${tag}.png` }); console.log('shot', name) }

const SHOTS = `const shots = Object.values(d.shots).sort((x, y) => (x.rank < y.rank ? -1 : 1))`

const scenes = {
  // R3-F2: Assemble at the planned lengths; F4 leftover: Out past the take is clamped and said.
  async assemble(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `${SHOTS}
      const g = Object.values(d.generations).find((x) => x.shot_ids[0] === shots[0].id)
      g.duration_s = 4.011; d.assets[g.asset].duration_s = 4.011
      const v = Object.values(d.videos)[0]
      for (const [id, it] of Object.entries(v.timeline)) if (it.track === 'V1') delete v.timeline[id]`)
    await room(page, 'edit')
    const a = page.getByRole('button', { name: 'Assemble first cut' })
    if (await a.count()) await a.first().click(); else console.log('no Assemble')
    await page.waitForTimeout(1200)
    await shoot(page, 's01-assemble-planned-lengths')
    await page.locator('.rm-clip').first().click()
    await page.waitForTimeout(600)
    const outField = page.getByRole('textbox', { name: 'Out', exact: true })
    if (await outField.count()) {
      await outField.first().fill('4.5')
      await outField.first().press('Enter')
      await page.waitForTimeout(600)
    } else console.log('no Out field')
    await shoot(page, 's02-out-past-the-take')
    await page.close()
  },
  // R3-F4: a box's first take, landed while a cut exists, goes into the cut with an Undo note.
  async firsttake(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `${SHOTS}
      const g = Object.values(d.generations).find((x) => x.shot_ids[0] === shots[1].id)
      const v = Object.values(d.videos)[0]
      for (const [id, it] of Object.entries(v.timeline)) if (it.source?.generation_id === g.id) delete v.timeline[id]
      delete d.generations[g.id]`)
    await room(page, 'make')
    await page.locator('.jc-box').nth(1).click({ position: { x: 60, y: 20 } }).catch(() => {})
    await page.waitForTimeout(600)
    await shoot(page, 's03a-first-take-box')
    const make = page.locator('.jc-box').nth(1).getByRole('button', { name: 'Make', exact: true })
    if (await make.count()) await make.first().click(); else console.log('no Make')
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1000)
      const n = await page.evaluate(() => Object.values(window.__pt.doc.get().generations).length)
      if (n >= 3) break
    }
    console.log('takes', await page.evaluate(() => Object.values(window.__pt.doc.get().generations).length))
    await page.waitForTimeout(1500)
    await room(page, 'edit')
    await shoot(page, 's03-first-take-into-the-cut')
    await page.close()
  },
  // R3-F5: Tell the Camera agent opens an ask, not the shot's words.
  async ask(browser) {
    const page = await open(browser)
    await film(page)
    await room(page, 'make')
    await page.locator('.jc-box').first().click({ position: { x: 60, y: 20 } }).catch(() => {})
    await page.waitForTimeout(600)
    const box = page.getByPlaceholder('Tell the Camera agent what to make or make again…')
    if (await box.count()) {
      await box.first().fill("Send both of Maya's pictures, the front and the full-length one.")
      await page.getByRole('button', { name: 'Ask the Camera agent' }).first().click()
      await page.waitForTimeout(1000)
    } else console.log('no camera box')
    await shoot(page, 's04-tell-the-camera-agent')
    await page.close()
  },
  // F3 leftover and F22/R3-F6: boxes with no takes take their own default; a silence beat turns no sound on.
  async models(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `${SHOTS}
      for (const g of Object.values(d.generations)) if (g.shot_ids[0] !== shots[0].id) delete d.generations[g.id]
      const g1 = Object.values(d.generations)[0]; g1.provider = 'runway'; g1.inputs = { ...g1.inputs, model: 'wan3' }; delete g1.mock
      const sb = shots[0].storyboard_id
      d.jobs[I('job_wan','job')] = { id: I('job_wan','job'), v: 1, field_v: {}, op: 'clip', state: 'completed', node: { kind: 'storyboard', id: sb }, started_by: d.project.created_by, tenant_id: d.project.tenant_id, nonce: I('n_wan','n'), crew: 'wren', parent_ids: [], input_hashes: [], outputs: [], provider: 'runway', model: 'wan3', created_at: '2030-01-01T10:00:00.000Z' }
      d.beats[I('beat_s','beat')] = { id: I('beat_s','beat'), v: 1, field_v: {}, shot_id: shots[1].id, kind: 'sound', at_s: 0, text: 'Silence: the kettle boils with no noise at all.', rank: 'a0' }
      d.beats[I('beat_l','beat')] = { id: I('beat_l','beat'), v: 1, field_v: {}, shot_id: shots[2].id, kind: 'line', at_s: 0.5, text: 'Good boy.', speaker: 'MAYA', rank: 'a0' }`)
    await page.evaluate(() => window.__pt.ui.update((u) => { u.configChoice = 'live'; u.providerChoice = 'runway' }, 'shots'))
    console.log('clip jobs', await page.evaluate(() => JSON.stringify(Object.values(window.__pt.doc.get().jobs).map((j) => [j.op, j.model]))))
    await room(page, 'make')
    await shoot(page, 's05-boxes-own-models')
    await page.locator('.jc-box').nth(1).click({ position: { x: 60, y: 20 } }).catch(() => {})
    await shoot(page, 's06-silence-box')
    await page.locator('.jc-box').nth(2).click({ position: { x: 60, y: 20 } }).catch(() => {})
    await shoot(page, 's07-spoken-line-box')
    await page.close()
  },
  // R3-F11: the Use-this-take sheet says one window.
  async sheet(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `${SHOTS}
      const g = Object.values(d.generations).find((x) => x.shot_ids[0] === shots[0].id)
      d.generations[I('gen_new','gen')] = { ...structuredClone(g), id: I('gen_new','gen'), parent_id: g.id, kind: 'change', duration_s: 4.011, job_id: I('job_new','job'), created_at: '2030-01-01T11:00:00Z', label: 'New take' }`)
    await room(page, 'edit')
    const use = page.getByRole('button', { name: 'Use this take' })
    if (await use.count()) { await use.first().click(); await page.waitForTimeout(800) } else console.log('no Use this take')
    await shoot(page, 's08-use-this-take-sheet')
    await page.close()
  },
}

const browser = await chromium.launch({ executablePath: '/home/batunii/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
for (const [name, fn] of Object.entries(scenes)) {
  if (only && !only.split(',').includes(name)) continue
  try { await fn(browser) } catch (e) { console.log(`[${tag}] ${name} failed:`, e.message.split('\n')[0]) }
}
await browser.close()
