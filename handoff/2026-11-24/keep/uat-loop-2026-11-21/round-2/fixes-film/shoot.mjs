// Paired before/after screenshots for pt-film-r2 (in-browser mock relay; nothing paid).
// usage: node shoot.mjs <baseUrl> <before|after> <outDir> [only]
import { createRequire } from 'node:module'
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-film-r2/production-tool/web/package.json')
const { chromium } = require('@playwright/test')
const [base, tag, out, only] = process.argv.slice(2)

const pic = (colour) => `(() => { const c = document.createElement('canvas'); c.width = 1344; c.height = 756; const x = c.getContext('2d'); x.fillStyle = '${colour}'; x.fillRect(0,0,1344,756); x.fillStyle = '#fff'; x.beginPath(); x.arc(672,378,150,0,7); x.fill(); return c.toDataURL('image/jpeg', 0.8) })()`

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => console.log(`[${tag}] pageerror`, e.message))
  page.on('console', (m) => { if (/refused a write/.test(m.text())) console.log(`[${tag}] refused`, m.text().slice(0, 300)) })
  await page.goto(`${base}/?engine=own`)
  for (let i = 0; i < 4; i++) {
    try { await page.waitForFunction(() => !!window.__seed, null, { timeout: 30000 }); break } catch { await page.waitForLoadState('load') }
  }
  return page
}

async function film(page) {
  await page.evaluate(async (pics) => {
    const shots = [
      { pic: pics[0], action: 'A dark shared kitchen. A renter sock-skates in.', s: 2.5 },
      { pic: pics[1], action: 'Her finger presses the kettle switch.', s: 2.5 },
      { pic: pics[2], action: 'The kettle clicks off; she whispers to it.', s: 3 },
    ]
    await window.__seed.market({ title: 'Quietboil', shots })
    await window.__seed.takes()
  }, await Promise.all(['#5a3b2e', '#2e4a5a', '#3b5a2e'].map((c) => page.evaluate(pic(c)))))
}

const go = async (page, path) => {
  await page.evaluate(() => window.__pt.ui.update((u) => { u.stage = 'video' }, 'screenshots'))
  await page.waitForTimeout(1500)
  if (path.endsWith('/edit')) {
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

const scenes = {
  // F7, F3, F10, F22: the Make room's boxes say frame-first, sound, its model's own.
  async make(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `
      const shots = Object.values(d.shots).sort((x, y) => (x.rank < y.rank ? -1 : 1))
      const sb = shots[0].storyboard_id
      const asset = Object.values(d.frames)[0].asset
      d.keys[I('key_maya','key')] = { id: I('key_maya','key'), v: 1, field_v: {}, key: 'maya', role: 'character' }
      d.refs[I('ref_mf','ref')] = { id: I('ref_mf','ref'), v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset }
      d.shots[I('shot_new','shot')] = { id: I('shot_new','shot'), v: 1, field_v: {}, storyboard_id: sb, rank: shots.at(-1).rank + 'V', kind: 'shot', duration_s: 3, action: '@maya_front leans over the kettle.', camera: { size: 'medium' }, status: 'locked' }
      d.beats[I('beat_l','beat')] = { id: I('beat_l','beat'), v: 1, field_v: {}, shot_id: shots[2].id, kind: 'line', at_s: 1, text: 'Good boy.', speaker: 'MAYA', rank: 'a0' }
      d.beats[I('beat_s','beat')] = { id: I('beat_s','beat'), v: 1, field_v: {}, shot_id: shots[0].id, kind: 'sound', at_s: 1, text: 'one soft snore', rank: 'a0' }
      const gens = Object.values(d.generations)
      const g3 = gens.find((g) => g.shot_ids[0] === shots[2].id); g3.provider = 'runway'; g3.inputs = { ...g3.inputs, model: 'veo3.1' }; delete g3.mock
      const g1 = gens.find((g) => g.shot_ids[0] === shots[0].id); g1.provider = 'runway'; g1.inputs = { ...g1.inputs, model: 'gemini_omni_flash_1.1' }; delete g1.mock
          `)
    await page.evaluate(() => window.__pt.ui.update((u) => { u.configChoice = 'live'; u.providerChoice = 'runway' }, 'shots'))
    await go(page, '/video/make')
    await shoot(page, '01-make-boxes')
    const last = page.locator('.jc-box').last()
    await last.click({ position: { x: 60, y: 20 } }).catch(() => {})
    await shoot(page, '01b-make-box4-tab')
    await page.locator('.jc-box').nth(2).click({ position: { x: 60, y: 20 } }).catch(() => {})
    await shoot(page, '01c-make-box3-tab')
    await page.close()
  },
  // F19, S3 mute, F8 render checks, F8 Sound view.
  async edit(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `
      const shots = Object.values(d.shots).sort((x, y) => (x.rank < y.rank ? -1 : 1))
      const v = Object.values(d.videos)[0]
      const g = Object.values(d.generations)[0]
      d.renders[I('render_1','render')] = { id: I('render_1','render'), v: 1, field_v: {}, video_id: v.id, version: 1, asset: g.asset, job_id: I('job_r1','job') }
      d.beats[I('beat_l','beat')] = { id: I('beat_l','beat'), v: 1, field_v: {}, shot_id: shots[2].id, kind: 'line', at_s: 1, text: 'Good boy.', speaker: 'MAYA', rank: 'a0' }
      d.shots[I('shot_end','shot')] = { id: I('shot_end','shot'), v: 1, field_v: {}, storyboard_id: shots[0].storyboard_id, rank: shots.at(-1).rank + 'V', kind: 'end_card', duration_s: 1.5, action: 'Quietboil. Let them sleep.', camera: { size: 'wide' }, status: 'locked' }
      d.beats[I('beat_v','beat')] = { id: I('beat_v','beat'), v: 1, field_v: {}, shot_id: I('shot_end','shot'), kind: 'vo', at_s: 0, text: 'Quietboil. Let them sleep.', speaker: 'NARRATOR', rank: 'a0' }
      const g3 = Object.values(d.generations).find((x) => x.shot_ids[0] === shots[2].id); g3.provider = 'runway'; g3.inputs = { ...g3.inputs, model: 'veo3.1' }; delete g3.mock
      v.timeline[I('text_1', 'item')] = { track: 'text', words: '1:04 a.m.', style: 'super', from_s: 5.6, to_s: 8 }
    `)
    await go(page, '/video/edit')
    const cap = page.getByRole('button', { name: /^Captions/ })
    if (await cap.count()) { await cap.first().click(); await page.waitForTimeout(800); await shoot(page, '02b-edit-captions') }
    await page.waitForTimeout(1200)
    await shoot(page, '02-edit-preview')
    const r = page.getByRole('button', { name: /^Rendered/ })
    if (await r.count()) { await r.first().click(); await shoot(page, '03-edit-rendered') }
    await page.getByRole('button', { name: /^Preview$/ }).first().click().catch(() => {})
    const render = page.getByRole('button', { name: /Render ad/ })
    if (await render.count()) { await render.first().click(); await shoot(page, '04-render-checks'); await page.keyboard.press('Escape') }
    await page.getByRole('button', { name: 'Open Sound' }).first().click()
    await shoot(page, '05-sound-view')
    await page.close()
  },
  // F2, F13: a joined take cut apart, each shot made again: Use this take changes only its own shot.
  async swap(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `
      const shots = Object.values(d.shots).sort((x, y) => (x.rank < y.rank ? -1 : 1))
      const v = Object.values(d.videos)[0]
      const frames = Object.values(d.frames)
      const base = { v: 1, field_v: {}, state: 'ready', provider: 'mock', crew: 'wren', mock: true, by: d.project.created_by }
      const a0 = frames[0].asset, a1 = frames[1].asset
      d.generations[I('gen_join','gen')] = { ...base, id: I('gen_join','gen'), kind: 'together', shot_ids: [shots[0].id, shots[1].id], segments: [{ shot_id: shots[0].id, in_s: 0, out_s: 2.5, by: 'detected' }, { shot_id: shots[1].id, in_s: 2.5, out_s: 5, by: 'detected' }], asset: a0, duration_s: 5, job_id: I('job_join','job'), inputs: { model: 'mock', length_s: 5 }, created_at: '2030-01-01T10:00:00Z' }
      d.generations[I('gen_a','gen')] = { ...base, id: I('gen_a','gen'), kind: 'clip', shot_ids: [shots[0].id], asset: a0, duration_s: 2.5, job_id: I('job_a','job'), inputs: { model: 'mock', length_s: 2.5 }, created_at: '2030-01-01T11:00:00Z' }
      d.generations[I('gen_b','gen')] = { ...base, id: I('gen_b','gen'), kind: 'clip', shot_ids: [shots[1].id], asset: a1, duration_s: 2.5, job_id: I('job_b','job'), inputs: { model: 'mock', length_s: 2.5 }, created_at: '2030-01-01T11:01:00Z' }
      const tl = v.timeline
      for (const [id, it] of Object.entries(tl)) {
        if (it.track !== 'V1') continue
        if (it.follows?.shot_id === shots[0].id) tl[id] = { ...it, source: { generation_id: I('gen_join','gen'), in_s: 0, out_s: 2.5 } }
        if (it.follows?.shot_id === shots[1].id) tl[id] = { ...it, source: { generation_id: I('gen_join','gen'), in_s: 2.5, out_s: 5 } }
      }
    `)
    await go(page, '/video/edit')
    await page.waitForTimeout(1500)
    await shoot(page, '06-edit-new-takes')
    const use = page.getByRole('button', { name: 'Use this take' })
    if (await use.count()) { await use.first().click(); await shoot(page, '07-use-this-take-sheet') }
    else console.log('no Use this take')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const clip = page.locator('.tl-clip, [data-clip]').first()
    await page.mouse.click(400, 720)
    await page.waitForTimeout(500)
    const swap = page.getByRole('button', { name: 'Swap take' })
    if (await swap.count()) { await swap.first().click().catch(() => {}); await shoot(page, '07b-swap-take-list') }
    await page.close()
  },
  // F17: the front, said before Plan shots; the chooser.
  async fronts(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `
      const asset = Object.values(d.frames)[0].asset
      const sc = Object.values(d.scripts)[0]
      d.keys[I('key_maya','key')] = { id: I('key_maya','key'), v: 1, field_v: {}, key: 'maya', role: 'character' }
      d.refs[I('ref_ms','ref')] = { id: I('ref_ms','ref'), v: 1, field_v: {}, key: 'maya', variant: 'side', role: 'character', asset }
      d.scenes[I('scene_1','scene')] = { id: I('scene_1','scene'), v: 1, field_v: {}, script_id: sc.id, rank: 'a0', heading: 'INT. SHARED KITCHEN - NIGHT', text: '@maya sock-skates in, grim-faced. The kettle boils in a faint hush.' }
    `)
    await page.evaluate(() => window.__seed.script())
    await page.waitForTimeout(1500)
    await shoot(page, '08-script-fronts')
    const btn = page.getByRole('button', { name: /Choose Maya's front/ })
    if (await btn.count()) {
      await btn.first().click()
      await page.waitForTimeout(1200)
      await shoot(page, '09-front-chooser')
      const pickB = page.getByRole('button', { name: /Make @maya_side the front/ })
      if (await pickB.count()) {
        await pickB.first().click(); await page.waitForTimeout(800); await shoot(page, '10-front-chosen')
        const done = page.getByRole('button', { name: /^Done/ })
        if (await done.count()) { await done.first().click(); await page.waitForTimeout(1200); await shoot(page, '10b-front-done') }
      }
    } else console.log('no front button before click; pressing Plan shots')
    await page.close()
  },
  // Script UX 1, 3: an edit card in screenplay layout with seconds.
  async card(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `
      const sc = Object.values(d.scripts)[0]
      d.scenes[I('scene_1','scene')] = { id: I('scene_1','scene'), v: 1, field_v: {}, script_id: sc.id, rank: 'a0', heading: 'INT. SHARED KITCHEN - NIGHT', text: 'The kettle boils.' }
    `)
    await page.evaluate(() => window.__seed.script())
    await page.waitForTimeout(1200)
    await change(page, `
      const t = (s) => [{ type: 'text', text: s }]
      const content = [
        { type: 'action', content: t('The kettle boils in a faint hush.') },
        { type: 'character', content: t('MAYA') },
        { type: 'parenthetical', content: t('(whispering)') },
        { type: 'dialogue', content: t('Good boy.') },
      ]
      d.suggestions[I('sug_1','sug')] = { id: I('sug_1','sug'), v: 1, field_v: {}, target: { kind: 'scene', id: I('scene_1','scene') }, crew: 'skye', job_id: I('job_w','job'), for: d.project.created_by, base_hash: 'sha256:' + '0'.repeat(64), mode: 'revise', proposed: { prose: { type: 'doc', content }, text: 'The kettle boils in a faint hush.\\nMAYA\\n(whispering)\\nGood boy.' }, note: 'I added her line.', state: 'open' }
    `)
    await page.waitForTimeout(1200)
    const card = page.locator('.se-draft')
    if (await card.count()) await card.first().scrollIntoViewIfNeeded()
    await shoot(page, '11-script-edit-card')
    await page.close()
  },
}

const browser = await chromium.launch({ executablePath: '/home/batunii/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
for (const [name, fn] of Object.entries(scenes)) {
  if (only && !only.split(',').includes(name)) continue
  try { await fn(browser) } catch (e) { console.log(`[${tag}] ${name} failed:`, e.message.split('\n')[0]) }
}
await browser.close()
