// Paired before/after screenshots for pt-film-r4 (in-browser mock relay; nothing paid).
// usage: node shoot-r4.mjs <baseUrl> <before|after> <outDir> [only]
import { createRequire } from 'node:module'
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-film-r4/production-tool/web/package.json')
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

const ROUND4 = [
  { action: '1 a.m. @maya, hoodied, tiptoes into the dark kitchen, filling the kettle.', s: 3 },
  { action: 'Insert on the kettle on the counter: the switch goes down.', s: 2 },
  { action: '@maya whispers to the kettle.', s: 1.5 },
  { action: 'Behind the thin wall, a flatmate keeps snoring, undisturbed.', s: 1.5 },
  { action: '@maya raises her mug to the snoring wall, grinning.', s: 2 },
]
async function film(page, shots = ROUND4) {
  const colours = ['#5a3b2e', '#2e4a5a', '#3b5a2e', '#4a2e5a', '#5a5a2e']
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
  d.beats[I('beat_l','beat')] = { id: I('beat_l','beat'), v: 1, field_v: {}, shot_id: shots[2].id, kind: 'line', at_s: 0.5, text: 'Good boy.', speaker: 'MAYA', rank: 'a0' }
  d.beats[I('beat_s','beat')] = { id: I('beat_s','beat'), v: 1, field_v: {}, shot_id: shots[3].id, kind: 'sound', at_s: 0, text: 'Steady snoring through the wall.', rank: 'a0' }
  d.beats[I('beat_vo','beat')] = { id: I('beat_vo','beat'), v: 1, field_v: {}, shot_id: shots[4].id, kind: 'vo', at_s: 0.5, text: 'Quietboil. Let them sleep.', speaker: 'NARRATOR', rank: 'a0' }
  d.beats[I('beat_s5','beat')] = { id: I('beat_s5','beat'), v: 1, field_v: {}, shot_id: shots[4].id, kind: 'sound', at_s: 1, text: 'A soft click.', rank: 'a1' }`

const room = async (page, which) => {
  await page.evaluate(() => window.__pt.ui.update((u) => { u.stage = 'video' }, 'screenshots'))
  await page.waitForTimeout(1500)
  if (which === 'edit') {
    const b = page.getByRole('button', { name: 'Go to Edit' })
    if (await b.count()) await b.first().click()
    await page.waitForTimeout(800)
  }
}
const shoot = async (page, name, clip) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}-${tag}.png`, ...(clip ? { clip } : {}) }); console.log('shot', name) }

const BRIEF = {
  project_name: 'Let Them Sleep', single_minded_proposition: 'The kettle that lets the house sleep.',
  audience: 'Young renters in shared flats.', tone_and_world: ['Warm, a little funny'],
  mandatories: ['End line must be "Quietboil. Let them sleep."', 'Deliver in 16:9, 9:16 and 1:1'],
}

const scenes = {
  // R4-F8: the box's sound line on Omni Flash for a voice-over and a sound ("so the voice-over, the sound will not be voiced").
  async boxsound(browser) {
    const page = await open(browser)
    await film(page)
    await page.evaluate(() => window.__seed.takes())
    await change(page, `${MAYA}
      for (const g of Object.values(d.generations)) { g.provider = 'runway'; g.inputs = { ...g.inputs, model: 'gemini_omni_flash_1.1' }; delete g.mock }`)
    await page.evaluate(() => window.__pt.ui.update((u) => { u.configChoice = 'live'; u.providerChoice = 'runway' }, 'shots'))
    await room(page, 'make')
    await page.locator('.jc-box').nth(4).click({ position: { x: 60, y: 20 } }).catch((e) => console.log(`[${tag}] box`, e.message.split('\n')[0]))
    await page.waitForTimeout(800)
    // The box's sound line in full (the card clamps it to two lines; its title holds it all).
    console.log(`[${tag}] sound lines:`, JSON.stringify(await page.$$eval('.jc-sound', (xs) => xs.map((x) => x.getAttribute('title')))))
    await page.addStyleTag({ content: '.jc-sound { -webkit-line-clamp: unset !important; display: block !important; overflow: visible !important; }' })
    await shoot(page, 'f8a-box-sound-omni')
    await page.close()
  },
  // R4-F8: Make clips' preview names the brief "from the Script", not "from Script · Script".
  async preview(browser) {
    const page = await open(browser)
    await film(page)
    await page.evaluate(() => window.__seed.canvas())
    await page.waitForFunction(() => !!window.__canvasEnv, null, { timeout: 20000 }).catch(() => {})
    await page.evaluate(async (data) => { try { await window.__seed.brief(data, 'Let Them Sleep') } catch (e) { console.log('brief', e.message) } }, BRIEF)
    await page.waitForTimeout(800)
    await page.evaluate(() => window.__seed.storyboard())
    await page.waitForTimeout(1500)
    const disc = page.getByRole('button', { name: /What the Camera agent will send/ })
    if (await disc.count()) { await disc.first().click(); await shoot(page, 'f8b-make-clips-preview') } else { console.log(`[${tag}] no disclosure`); await shoot(page, 'f8b-storyboard') }
    await page.close()
  },
  // R4-F3: a free ask that fits two shots as well: the Booth asks which one (before: it went to the whole scene).
  async which(browser) {
    const page = await open(browser)
    await film(page)
    await change(page, `${MAYA}
      const sc = Object.values(d.scripts)[0]
      d.scenes[I('scene_1','scene')] = { id: I('scene_1','scene'), v: 1, field_v: {}, script_id: sc.id, rank: 'a0', heading: '' }
      for (const s of shots) s.scene_id = I('scene_1','scene')`)
    await page.evaluate(() => window.__seed.script())
    await page.waitForTimeout(1800)
    const ask = page.getByRole('button', { name: /^Ask/ })
    if (await ask.count()) { await ask.first().click(); await page.waitForTimeout(700) } else console.log(`[${tag}] no band ask`)
    const box = page.getByPlaceholder(/Tell the Script agent/)
    if (await box.count()) {
      await box.first().fill('Make the kettle bit funnier')
      await box.first().press('Enter')
      await page.waitForTimeout(1500)
    } else console.log(`[${tag}] no box`)
    await shoot(page, 'f3a-which-shot')
    await page.close()
  },
  // R4-F6: the brief's end line, unvoiced: Review says it shows as a super over the last shot.
  async endline(browser) {
    const page = await open(browser)
    await film(page)
    await page.evaluate(() => window.__seed.takes())
    // The round-4 cut: shot 5 on Omni Flash, which voices no VO.
    await change(page, `${MAYA}
      for (const g of Object.values(d.generations)) { g.provider = 'runway'; g.inputs = { ...g.inputs, model: 'gemini_omni_flash_1.1' }; delete g.mock }`)
    await page.evaluate(() => window.__seed.canvas())
    await page.waitForFunction(() => !!window.__canvasEnv, null, { timeout: 20000 }).catch(() => {})
    await page.evaluate(async (data) => { try { await window.__seed.brief(data, 'Let Them Sleep') } catch (e) { console.log('brief', e.message) } }, BRIEF)
    await page.waitForTimeout(800)
    console.log(`[${tag}] doc:`, await page.evaluate(() => { const d = window.__pt.doc.get(); return JSON.stringify({ beats: Object.keys(d.beats).length, briefs: Object.keys(d.briefs ?? {}).length, links: Object.values(d.links).filter((l) => l.role === 'brief').map((l) => l.to.kind) }) }))
    console.log(`[${tag}] endLine:`, await page.evaluate(async () => {
      try {
        const m = await import('/src/rooms/endLine.ts'); const sf = await import('/src/stages/soundFacts.ts'); const sel = await import('/src/model/selectors.ts'); const bm = await import('/src/brief/model.ts')
        const d = window.__pt.doc.get(); const v = Object.values(d.videos)[0]
        const sb = sel.storyboardOfVideo(d, v.id)
        return JSON.stringify({ end: m.compileWithEndLine(d, v.id).endLine, brief: bm.briefForJob(d, { kind: 'video', id: v.id })?.brief?.spine?.mandatories, lines: sf.lineFacts(d, v.id, sel.shotsOf(d, sb.id).map((s) => s.id)).length })
      } catch (e) { return 'err ' + e.message }
    }))
    await room(page, 'edit')
    const render = page.getByRole('button', { name: /^Render ad/ })
    if (await render.count()) { await render.first().click(); await page.waitForTimeout(800) } else console.log(`[${tag}] no render button`)
    await shoot(page, 'f6a-review-end-line')
    await page.keyboard.press('Escape')
    // The preview at the last shot's end: the super over it.
    // The playhead at 0:09 (the timeline ruler), inside the last shot.
    await page.mouse.click(955, 617)
    await page.waitForTimeout(800)
    await shoot(page, 'f6b-preview-last-shot')
    await page.close()
  },
}

const browser = await chromium.launch({ executablePath: '/home/batunii/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
for (const [name, fn] of Object.entries(scenes)) {
  if (only && !only.split(',').includes(name)) continue
  try { await fn(browser) } catch (e) { console.log(`[${tag}] ${name} failed:`, e.message.split('\n').slice(0, 6).join(' | ')) }
}
await browser.close()
