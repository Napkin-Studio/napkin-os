// Paired before/after screenshots for the round-3 S3 film fixes, agent b (in-browser mock relay; nothing paid).
// usage: node shoot-b.mjs <baseUrl> <before|after> <outDir> [only]
import { createRequire } from 'node:module'
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-film-r3b/production-tool/web/package.json')
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

async function film(page) {
  await page.evaluate(async (pics) => {
    const shots = [
      { pic: pics[0], action: 'A dark kitchen, lit only by the kettle.', s: 2 },
      { pic: pics[1], action: 'Maya, in a dressing gown, pads in.', s: 2 },
      { pic: pics[2], action: 'The kettle glows blue and boils.', s: 2 },
    ]
    await window.__seed.market({ title: 'Quietboil', shots })
    await window.__seed.takes()
  }, await Promise.all(['#5a3b2e', '#2e4a5a', '#3b5a2e'].map((c) => page.evaluate(pic(c)))))
}

const change = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const U = (p) => `${p}_${Array.from({ length: 26 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('').replace(/^./, '0')}`
  window.__ids = window.__ids || {}
  const I = (name, p) => (window.__ids[name] ??= U(p))
  const f = new Function('d', 'a', 'I', src)
  await window.__pt.doc.change((d) => f(d, a, I), { action: 'screenshot seed', undo: false })
  await window.__pt.doc.flush?.()
}, [fn, arg])

const room = async (page, edit) => {
  await page.evaluate(() => window.__pt.ui.update((u) => { u.stage = 'video' }, 'screenshots'))
  await page.waitForTimeout(1500)
  if (edit) {
    const b = page.getByRole('button', { name: 'Go to Edit' })
    if (await b.count()) await b.first().click()
    await page.waitForTimeout(800)
  }
}

const shoot = async (page, name, clip) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}-${tag}.png`, ...(clip ? { clip } : {}) }); console.log('shot', name) }

const scenes = {
  // R3-F12: the sizes sheet with one version ticked ("1 versions").
  async sizes(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `
      const v = Object.values(d.videos)[0]
      const g = Object.values(d.generations)[0]
      d.assets[g.asset] = { ...d.assets[g.asset] }
      d.renders[I('render_1','render')] = { id: I('render_1','render'), v: 1, field_v: {}, video_id: v.id, version: 1, asset: g.asset, job_id: I('job_r1','job') }
      v.pick = { current: I('render_1','render') }
    `)
    await page.waitForTimeout(1500)
    const picked = await page.evaluate(() => {
      const env = window.__canvasEnv
      if (!env) return false
      let el = env.canvas.elements().find((e) => !e.isDeleted && e.customData?.kind === 'video')
      if (!el) {
        // The seeded film is not drawn on the canvas: put its Film node there.
        const v = Object.values(window.__pt.doc.get().videos)[0]
        el = env.canvas.node({ x: 100, y: 100, width: 320, height: 240, customData: { kind: 'video', id: v.id } })
        env.canvas.transact((all) => [...all, el], { undoable: false })
      }
      env.canvas.select([el.id])
      return true
    })
    if (!picked) { console.log(`[${tag}] no Film node`); await page.close(); return }
    await page.waitForTimeout(800)
    const make = page.getByRole('button', { name: /Make all sizes/ })
    if (!(await make.count())) { console.log(`[${tag}] no Make all sizes`); await shoot(page, 'b00-canvas'); await page.close(); return }
    await make.first().click()
    await page.waitForTimeout(1200)
    // One version: the 6 s at 9:16 only.
    const sheet = page.getByRole('dialog').last()
    for (const name of [/^16:9/, /^15 s$/]) {
      const box = sheet.getByRole('checkbox', { name })
      if (await box.count() && await box.first().isChecked()) await box.first().click()
      else {
        const btn = sheet.getByRole('button', { name, pressed: true })
        if (await btn.count()) await btn.first().click()
      }
    }
    await page.waitForTimeout(600)
    await shoot(page, 'b01-sizes-one-version')
    // Plan the cuts needs the relay's cutter: the in-browser mock sends no plan, so the tray's "Make 1 version" is unit-tested only.
    await page.close()
  },
  // F15: a joined take in the cut, then shot 1 made on its own: the Use this take sheet names both.
  async swap(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `
      const shots = Object.values(d.shots).sort((x, y) => (x.rank < y.rank ? -1 : 1))
      const v = Object.values(d.videos)[0]
      const frames = Object.values(d.frames)
      for (const [id, g] of Object.entries(d.generations)) if (g.shot_ids[0] === shots[0].id || g.shot_ids[0] === shots[1].id) delete d.generations[id]
      const base = { v: 1, field_v: {}, state: 'ready', provider: 'mock', crew: 'wren', mock: true, by: d.project.created_by }
      const a0 = frames[0].asset, a1 = frames[1].asset
      d.generations[I('gen_join','gen')] = { ...base, id: I('gen_join','gen'), kind: 'together', shot_ids: [shots[0].id, shots[1].id], segments: [{ shot_id: shots[0].id, in_s: 0, out_s: 2, by: 'detected' }, { shot_id: shots[1].id, in_s: 2, out_s: 4, by: 'detected' }], asset: a0, duration_s: 4, job_id: I('job_join','job'), inputs: { model: 'mock', length_s: 4 }, created_at: '2030-01-01T10:00:00Z' }
      d.generations[I('gen_a','gen')] = { ...base, id: I('gen_a','gen'), kind: 'clip', shot_ids: [shots[0].id], asset: a1, duration_s: 2, job_id: I('job_a','job'), inputs: { model: 'mock', length_s: 2 }, created_at: '2030-01-01T11:00:00Z' }
      const tl = v.timeline
      for (const [id, it] of Object.entries(tl)) {
        if (it.track !== 'V1') continue
        if (it.follows?.shot_id === shots[0].id) tl[id] = { ...it, source: { generation_id: I('gen_join','gen'), in_s: 0, out_s: 2 } }
        if (it.follows?.shot_id === shots[1].id) tl[id] = { ...it, source: { generation_id: I('gen_join','gen'), in_s: 2, out_s: 4 } }
      }
    `)
    await room(page, true)
    await page.waitForTimeout(1500)
    const use = page.getByRole('button', { name: 'Use this take' })
    if (await use.count()) { await use.first().click(); await shoot(page, 'b02-use-this-take-sheet') }
    else { console.log(`[${tag}] no Use this take`); await shoot(page, 'b02-edit') }
    await page.close()
  },
  // R3-F13: a box from words whose frame Make draws first: the Box tab and the Make note agree.
  async words(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `
      const shots = Object.values(d.shots).sort((x, y) => (x.rank < y.rank ? -1 : 1))
      const sb = shots[0].storyboard_id
      const asset = Object.values(d.frames)[0].asset
      d.keys[I('key_maya','key')] = { id: I('key_maya','key'), v: 1, field_v: {}, key: 'maya', role: 'character' }
      d.refs[I('ref_mf','ref')] = { id: I('ref_mf','ref'), v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset }
      d.shots[I('shot_end','shot')] = { id: I('shot_end','shot'), v: 1, field_v: {}, storyboard_id: sb, rank: shots.at(-1).rank + 'V', kind: 'end_card', duration_s: 1.5, action: 'Quietboil. Let them sleep.', camera: { size: 'wide' }, status: 'locked' }
      d.shots[I('shot_new','shot')] = { id: I('shot_new','shot'), v: 1, field_v: {}, storyboard_id: sb, rank: shots.at(-1).rank + 'M', kind: 'shot', duration_s: 4, action: '@maya_front pours her tea and raises the mug to the wall.', camera: { size: 'medium' }, status: 'planned' }
    `)
    await room(page, false)
    // The new box: the one made from its words, before the end card.
    await page.locator('.jc-box').filter({ hasText: 'its words' }).first().click({ position: { x: 60, y: 20 } }).catch((e) => console.log(`[${tag}] box click`, e.message.split('\n')[0]))
    await page.waitForTimeout(600)
    const tab = page.getByRole('button', { name: /^Box$/ }).or(page.getByRole('tab', { name: /^Box$/ }))
    if (await tab.count()) await tab.first().click().catch(() => {})
    await page.waitForTimeout(600)
    await shoot(page, 'b03-box-tab-frame-first')
    await page.close()
  },
}

const browser = await chromium.launch({ executablePath: '/home/batunii/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
for (const [name, fn] of Object.entries(scenes)) {
  if (only && !only.split(',').includes(name)) continue
  try { await fn(browser) } catch (e) { console.log(`[${tag}] ${name} failed:`, e.message.split('\n')[0]) }
}
await browser.close()
