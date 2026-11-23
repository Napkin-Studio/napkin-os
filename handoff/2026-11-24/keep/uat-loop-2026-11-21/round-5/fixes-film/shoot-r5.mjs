// Paired before/after screenshots for pt-film-r5 (in-browser mock relay; nothing paid).
// usage: node shoot-r5.mjs <baseUrl> <before|after> <outDir> [only]
import { createRequire } from 'node:module'
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-film-r5/production-tool/web/package.json')
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

// Round 5's 7-shot Quietboil film (job_01M7Y84Y6B5T1VTZTV30BYZ07Z).
const ROUND5 = [
  { action: '1:04 a.m. @maya, a young renter, tiptoes into the dark kitchen in socks.', s: 1.5 },
  { action: '@maya fills the kettle, wincing at every gurgle from the tap.', s: 1.5 },
  { action: '@maya flicks the switch and braces, shoulders up, eyes squeezed shut.', s: 1.5 },
  { action: 'The kettle glows soft blue, murmurs, then clicks off. No roar at all.', s: 1.5 },
  { action: '@maya whispers to the kettle.', s: 1 },
  { action: "Down the hall, a flatmate's snoring carries on, undisturbed.", s: 1 },
  { action: '@maya grins and raises a steaming mug to the snoring door.', s: 2 },
]
async function film(page, shots = ROUND5) {
  const colours = ['#5a3b2e', '#2e4a5a', '#3b5a2e', '#4a2e5a', '#5a5a2e', '#2e5a4a', '#5a2e3b']
  const pics = await Promise.all(shots.map((_, i) => page.evaluate(pic(colours[i % colours.length]))))
  await page.evaluate(async (list) => { await window.__seed.market({ title: 'Quietboil', shots: list }) }, shots.map((s, i) => ({ ...s, pic: pics[i] })))
}

const change = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const U = (p) => `${p}_${Array.from({ length: 26 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('').replace(/^./, '0')}`
  window.__ids = window.__ids || {}
  const I = (name, p) => (window.__ids[name] ??= U(p))
  const f = new Function('d', 'a', 'I', src)
  await window.__pt.doc.change((d) => f(d, a, I), { action: 'screenshot seed', undo: false })
  await window.__pt.doc.flush?.()
}, [fn, arg])

const SHOTS = `const shots = Object.values(d.shots).sort((x, y) => (x.rank < y.rank ? -1 : 1))`
const MAYA = `${SHOTS}
  const asset = Object.values(d.frames)[0].asset
  d.keys[I('key_maya','key')] = { id: I('key_maya','key'), v: 1, field_v: {}, key: 'maya', role: 'character' }
  d.refs[I('ref_mf','ref')] = { id: I('ref_mf','ref'), v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset }
  const beat = (n, s, kind, at, text, extra) => { d.beats[I(n,'beat')] = { id: I(n,'beat'), v: 1, field_v: {}, shot_id: shots[s].id, kind, at_s: at, text, rank: 'a' + n.length, ...(extra || {}) } }
  beat('b2', 1, 'sound', 0.5, 'Tap gurgles')
  beat('b4a', 3, 'sound', 0, 'Soft murmur of the kettle')
  beat('b4bb', 3, 'sound', 1, 'Click as it switches off')
  beat('b5', 4, 'line', 0, 'Good boy.', { speaker: 'MAYA', parenthetical: 'whispering, to the kettle' })
  beat('b6', 5, 'sound', 0, 'Flatmate snoring behind the door')
  beat('b7', 6, 'vo', 0.5, 'Quietboil. Let them sleep.', { speaker: 'NARRATOR' })
  const sc = Object.values(d.scripts)[0]
  d.scenes[I('scene_1','scene')] = { id: I('scene_1','scene'), v: 1, field_v: {}, script_id: sc.id, rank: 'a0', heading: 'INT. SHARED FLAT KITCHEN - NIGHT' }
  for (const s of shots) s.scene_id = I('scene_1','scene')`

const shoot = async (page, name, clip) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}-${tag}.png`, ...(clip ? { clip } : {}) }); console.log('shot', name) }

async function tie(page) {
  await film(page)
  await change(page, MAYA)
  await page.evaluate(() => window.__seed.script())
  await page.waitForTimeout(1800)
  const ask = page.getByRole('button', { name: /^Ask/ })
  if (await ask.count()) { await ask.first().click(); await page.waitForTimeout(700) } else console.log(`[${tag}] no band ask`)
  const box = page.getByPlaceholder(/Tell the Script agent/)
  if (!(await box.count())) { console.log(`[${tag}] no box`); return false }
  await box.first().fill('Make Maya funnier')
  await box.first().press('Enter')
  await page.waitForTimeout(1500)
  return true
}

const scenes = {
  // R5-F4: a tie between shots: the choice panel says what was asked (before: only "These fit what you asked").
  async which(browser) {
    const page = await open(browser)
    await tie(page)
    await shoot(page, 'f4-which-shot')
    await page.close()
  },
  // R5-F5: the draft card of a shot ask (picked from the tie): headed by the shot, not "The whole script, from".
  async shotdraft(browser) {
    const page = await open(browser)
    if (await tie(page)) {
      const pick = page.locator('.bt-which button', { hasText: 'Shot 5' })
      if (await pick.count()) { await pick.first().click(); await page.waitForTimeout(9000) } else console.log(`[${tag}] no Shot 5 choice`)
      const card = page.locator('.dh').first()
      if (await card.count()) { await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(500) } else console.log(`[${tag}] no draft card`)
      console.log(`[${tag}] jobs:`, await page.evaluate(() => JSON.stringify(Object.values(window.__pt.doc.get().jobs).filter((j) => j.op === 'write').map((j) => [j.state, j.error?.message]))), await page.evaluate(() => JSON.stringify(Object.values(window.__pt.doc.get().suggestions ?? {}).map((x) => [x.state, x.target.kind]))))
      console.log(`[${tag}] card heads:`, JSON.stringify(await page.$$eval('.dh', (xs) => xs.map((x) => x.textContent.slice(0, 160)))))
    }
    await shoot(page, 'f5-shot-draft-card')
    await page.close()
  },
}

const browser = await chromium.launch({ executablePath: '/home/batunii/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell' })
try {
  for (const [name, fn] of Object.entries(scenes)) {
    if (only && only !== name) continue
    try { await fn(browser) } catch (e) { console.log(`[${tag}] ${name} failed`, e.message.split('\n')[0]) }
  }
} finally {
  await browser.close()
}
