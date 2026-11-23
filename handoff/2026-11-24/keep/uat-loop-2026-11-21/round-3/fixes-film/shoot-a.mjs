// Paired before/after screenshots for pt-film-r3 part a (in-browser mock relay; nothing paid).
// usage: node shoot-a.mjs <baseUrl> <before|after> <outDir> [only]
import { createRequire } from 'node:module'
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-film-r3a/production-tool/web/package.json')
const { chromium } = require('@playwright/test')
const [base, tag, out, only] = process.argv.slice(2)

const pic = (colour, w = 1344, h = 756) => `(() => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}; const x = c.getContext('2d'); x.fillStyle = '${colour}'; x.fillRect(0,0,${w},${h}); x.fillStyle = '#fff'; x.beginPath(); x.arc(${w / 2},${h / 2},150,0,7); x.fill(); return c.toDataURL('image/jpeg', 0.8) })()`

async function open(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => console.log(`[${tag}] pageerror`, e.message))
  await page.goto(`${base}/?engine=own`)
  for (let i = 0; i < 4; i++) {
    try { await page.waitForFunction(() => !!window.__seed, null, { timeout: 30000 }); break } catch { await page.waitForLoadState('load') }
  }
  return page
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

async function film(page, shots) {
  const pics = await Promise.all(['#5a3b2e', '#2e4a5a', '#3b5a2e', '#4a2e5a', '#5a5a2e'].slice(0, shots.length).map((c) => page.evaluate(pic(c))))
  await page.evaluate(async ([shots, pics]) => {
    await window.__seed.market({ title: 'Quietboil', shots: shots.map((s, i) => ({ ...s, pic: pics[i] })) })
  }, [shots, pics])
}

const UAT_LINES = [
  ['action', '1 a.m. A dark kitchen, lit only by the open fridge.'],
  ['action', 'A flatmate in socks and dressing gown creeps in, bracing for noise.'],
  ['action', 'She sets the Quietboil on its base and flips the switch, wincing.'],
  ['action', 'The kettle glows blue and boils without a sound.'],
  ['character', 'WOMAN'],
  ['parenthetical', 'whispering, to the kettle'],
  ['dialogue', 'Good boy.'],
  ['action', "Through the thin wall, a flatmate's snoring carries on, undisturbed."],
  ['action', 'She pours her tea and raises the mug to the wall in a silent toast.'],
  ['character', 'NARRATOR (V.O.)'],
  ['dialogue', 'Quietboil. Let them sleep.'],
]

/** A script page with the UAT's scene as its prose. */
async function scriptPage(browser) {
  const page = await open(browser)
  await film(page, [{ action: 'The kettle boils.', s: 3 }])
  await change(page, `
    const sc = Object.values(d.scripts)[0]
    d.scenes[I('scene_1','scene')] = { id: I('scene_1','scene'), v: 1, field_v: {}, script_id: sc.id, rank: 'a0', heading: 'INT. SHARED FLAT KITCHEN - NIGHT', text: '' }
  `)
  // No shots: the scene's own words are the page.
  await change(page, `for (const id of Object.keys(d.shots)) delete d.shots[id]; for (const id of Object.keys(d.frames)) delete d.frames[id]`)
  await page.evaluate(async (lines) => {
    const sceneId = window.__ids.scene_1
    const prose = { type: 'doc', content: lines.map(([type, text]) => ({ type, content: [{ type: 'text', text }] })) }
    const store = window.__pt.clan ?? window.__pt.doc
    await store.text.replace('scene', sceneId, prose, store.clan.personClaim(), { label: 'seed' })
    await store.flush?.()
  }, UAT_LINES).catch((e) => console.log('prose seed failed', e.message))
  await page.evaluate(() => window.__seed.script())
  await page.waitForTimeout(1500)
  return page
}

const scenes = {
  // R3-F7: the edit card of a length rewrite, by line.
  async card(browser) {
    const page = await scriptPage(browser)
    await change(page, `
      const t = (s) => [{ type: 'text', text: s }]
      const lines = [
        ['action', '1 a.m. A dark kitchen, lit only by the open fridge.'],
        ['action', "A flatmate in a dressing gown flips the Quietboil's switch, wincing."],
        ['action', 'The kettle glows blue and boils without a sound.'],
        ['action', 'Through the thin wall, the snoring carries on, undisturbed.'],
        ['character', 'NARRATOR (V.O.)'],
        ['dialogue', 'Quietboil. Let them sleep.'],
      ]
      d.suggestions[I('sug_1','sug')] = { id: I('sug_1','sug'), v: 1, field_v: {}, target: { kind: 'scene', id: I('scene_1','scene') }, crew: 'skye', job_id: I('job_w','job'), for: d.project.created_by, base_hash: 'sha256:' + '0'.repeat(64), mode: 'revise', proposed: { prose: { type: 'doc', content: lines.map(([type, s]) => ({ type, content: t(s) })) }, text: lines.map((l) => l[1]).join('\\n') }, note: 'I cut it to 10 s.', state: 'open' }
    `)
    await page.waitForTimeout(1200)
    const card = page.locator('.se-draft')
    if (await card.count()) await card.first().scrollIntoViewIfNeeded()
    await page.mouse.wheel(0, 300)
    await shoot(page, 'a01-edit-card-diff')
    await page.close()
  },
  // R3-F8: the target offer after a length ask.
  async offer(browser) {
    const page = await scriptPage(browser)
    const ask = page.getByRole('button', { name: /^Ask/ }).first()
    await ask.click()
    await page.waitForTimeout(600)
    const box = page.locator('textarea').first()
    await box.fill('Make it 10 seconds.')
    await page.getByRole('button', { name: 'Ask the Script agent' }).first().click()
    await page.waitForTimeout(500)
    await shoot(page, 'a02-target-offer')
    await page.close()
  },
  // R3-F9: a name picked into the words, then a comma and a second word typed.
  async mention(browser) {
    const page = await open(browser)
    await film(page, [{ action: 'The kettle boils.', s: 3 }])
    await change(page, `
      const asset = Object.values(d.frames)[0].asset
      const sc = Object.values(d.scripts)[0]
      d.keys[I('key_maya','key')] = { id: I('key_maya','key'), v: 1, field_v: {}, key: 'maya', role: 'character' }
      d.refs[I('ref_mf','ref')] = { id: I('ref_mf','ref'), v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset }
      d.links[I('link_m','link')] = { id: I('link_m','link'), v: 1, field_v: {}, from: { kind: 'key', id: I('key_maya','key') }, to: { kind: 'script', id: sc.id }, role: 'character' }
      d.scenes[I('scene_1','scene')] = { id: I('scene_1','scene'), v: 1, field_v: {}, script_id: sc.id, rank: 'a0', heading: 'INT. SHARED FLAT KITCHEN - NIGHT', text: 'The kettle boils. ' }
      for (const id of Object.keys(d.shots)) delete d.shots[id]
      for (const id of Object.keys(d.frames)) delete d.frames[id]
    `)
    await page.evaluate(async () => {
      const store = window.__pt.clan
      await store.text.replace('scene', window.__ids.scene_1, { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'The kettle boils.' }] }, { type: 'action', content: [{ type: 'text', text: 'X pours.' }] }] }, store.clan.personClaim(), { label: 'seed' })
      await store.flush?.()
    })
    await page.evaluate(() => window.__seed.script())
    await page.waitForTimeout(1500)
    // Line 1: a name, then a comma typed straight after it. Line 2: a name typed over "X" in "X pours.".
    const line1 = page.getByText('The kettle boils.', { exact: true }).last()
    await line1.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Then @maya', { delay: 30 })
    await page.waitForTimeout(600)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    await page.keyboard.type(', in a dressing gown, sets it down.', { delay: 10 })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.type('@maya', { delay: 30 })
    await page.waitForTimeout(600)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)
    console.log(`[${tag}] words:`, JSON.stringify(await page.locator('.ProseMirror, [contenteditable]').first().innerText().catch(() => '')))
    await shoot(page, 'a03-mention-space')
    await page.close()
  },
  // R3-F10 and the shot title: the storyboard's Make clips disclosure with 5 frames and a type end card.
  async storyboard(browser) {
    const page = await open(browser)
    await film(page, [
      { action: '1 a.m. A dark kitchen, lit only by the open fridge.', s: 2 },
      { action: "@maya, in a dressing gown, flips the Quietboil's switch.", s: 2 },
      { action: 'The kettle glows blue and boils without a sound.', s: 2 },
      { action: '@maya whispers to the kettle.', s: 1.5 },
      { action: 'Through the wall, the snoring carries on.', s: 1.5 },
    ])
    await change(page, `
      const shots = Object.values(d.shots).sort((x, y) => (x.rank < y.rank ? -1 : 1))
      d.shots[I('shot_end','shot')] = { id: I('shot_end','shot'), v: 1, field_v: {}, storyboard_id: shots[0].storyboard_id, rank: shots.at(-1).rank + 'V', kind: 'end_card', duration_s: 1, action: 'Quietboil. Let them sleep.', camera: { size: 'wide' }, status: 'locked' }
    `)
    await page.evaluate(() => window.__seed.storyboard())
    await page.waitForTimeout(1500)
    await shoot(page, 'a04-storyboard-titles')
    const disc = page.getByRole('button', { name: /What the Camera agent will send/ })
    if (await disc.count()) { await disc.first().click(); await shoot(page, 'a05-make-clips-send') } else console.log(`[${tag}] no disclosure`)
    await page.close()
  },
  // R3-F14: the Name dialog of a tall picture low on the left, under the zoom bar.
  async name(browser) {
    const page = await open(browser)
    await page.evaluate(() => window.__seed.canvas())
    await page.waitForFunction(() => !!window.__canvas)
    await page.waitForTimeout(800)
    await page.evaluate(async ({ x, y }) => {
      const dt = new DataTransfer()
      const o = new OffscreenCanvas(400, 760)
      const g = o.getContext('2d'); g.fillStyle = '#7a5a4a'; g.fillRect(0, 0, 400, 760); g.fillStyle = '#fff'; g.fillRect(150, 300, 100, 100)
      dt.items.add(new File([await o.convertToBlob({ type: 'image/png' })], 'maya.png', { type: 'image/png' }))
      const t = document.elementFromPoint(x, y)
      t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
      t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
    }, { x: 260, y: 560 })
    await page.waitForTimeout(2500)
    const box = await page.evaluate(() => {
      const c = window.__canvas; const v = c.view()
      const e = c.elements().find((x) => x.customData?.kind === 'pic')
      if (!e) return null
      const a = c.sceneToViewport({ x: e.x, y: e.y }, v); const b = c.sceneToViewport({ x: e.x + e.width, y: e.y + e.height }, v)
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, top: a.y, bottom: b.y, left: a.x }
    })
    console.log(`[${tag}] picture`, JSON.stringify(box))
    if (!box) return page.close()
    await page.mouse.click(box.x, box.y)
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Name…' }).first().click()
    await page.waitForTimeout(800)
    const r = await page.evaluate(() => {
      const pill = document.querySelector('.zoom-pill')?.getBoundingClientRect()
      const inputs = [...document.querySelectorAll('.popover input')].map((i) => i.getBoundingClientRect())
      const over = inputs.some((i) => pill && i.left < pill.right && i.right > pill.left && i.top < pill.bottom && i.bottom > pill.top)
      const pop = document.querySelector('.popover')?.getBoundingClientRect()
      return { over, pop: pop && [pop.left, pop.top, pop.right, pop.bottom].map(Math.round), pill: pill && [pill.left, pill.top, pill.right, pill.bottom].map(Math.round) }
    })
    console.log(`[${tag}] name dialog`, JSON.stringify(r))
    await shoot(page, 'a06-name-dialog')
    await page.close()
  },
  // R3-F15: Back from the front chooser.
  async fronts(browser) {
    const page = await open(browser)
    await film(page, [{ action: 'The kettle boils.', s: 3 }])
    await change(page, `
      const asset = Object.values(d.frames)[0].asset
      const sc = Object.values(d.scripts)[0]
      d.keys[I('key_maya','key')] = { id: I('key_maya','key'), v: 1, field_v: {}, key: 'maya', role: 'character' }
      d.refs[I('ref_ms','ref')] = { id: I('ref_ms','ref'), v: 1, field_v: {}, key: 'maya', variant: 'side', role: 'character', asset }
      d.scenes[I('scene_1','scene')] = { id: I('scene_1','scene'), v: 1, field_v: {}, script_id: sc.id, rank: 'a0', heading: 'INT. SHARED KITCHEN - NIGHT', text: '@maya sock-skates in, grim-faced. The kettle boils in a faint hush.' }
    `)
    // As a person gets there: the canvas, then Open script (a pushed entry).
    await page.evaluate(() => window.__seed.script())
    await page.waitForTimeout(1500)
    const btn = page.getByRole('button', { name: /Choose Maya.s front/ })
    if (!(await btn.count())) { console.log(`[${tag}] no front button`); return page.close() }
    await btn.first().click()
    await page.waitForTimeout(1200)
    console.log(`[${tag}] chooser at`, new URL(page.url()).pathname)
    await page.goBack()
    await page.waitForTimeout(1500)
    console.log(`[${tag}] after Back`, new URL(page.url()).pathname)
    await shoot(page, 'a07-back-from-chooser')
    await page.close()
  },
}

const browser = await chromium.launch({ executablePath: '/home/batunii/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
for (const [name, fn] of Object.entries(scenes)) {
  if (only && !only.split(',').includes(name)) continue
  try { await fn(browser) } catch (e) { console.log(`[${tag}] ${name} failed:`, e.message.split("\n").slice(0, 12).join(" | ")) }
}
await browser.close()
