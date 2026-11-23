// Paired before/after screenshots for features/pt-canvas-r5.clan: base (f29fc482, fix/pt-uat-loop) on :5501, branch
// (fix/pt-canvas-r5) on :5502. Both are the dev server with the in-browser MockRelay: nothing paid, nothing deployed.
//   node shots.mjs [scene]
import { createRequire } from 'node:module'
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-canvas-r5/production-tool/web/package.json')
const { chromium } = require('@playwright/test')

const OUT = '/home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/round-5/fixes-canvas'
const SERVERS = { before: 'http://127.0.0.1:5501', after: 'http://127.0.0.1:5502' }
const only = process.argv[2]

async function open(browser, base, { delayMain = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)))
  if (delayMain) await page.route('**/src/main.tsx*', async (r) => { await new Promise((x) => setTimeout(x, delayMain)); await r.continue() })
  await page.goto(`${base}/?engine=own`)
  if (delayMain) return { ctx, page }
  for (let i = 0; i < 4; i++) {
    try { await page.waitForFunction(() => !!window.__seed, null, { timeout: 30000 }); await page.evaluate(() => window.__seed.canvas()); break } catch (e) { if (i === 3) throw e; await page.waitForLoadState('load') }
  }
  await page.waitForFunction(() => !!window.__ctrl && !!window.__canvasEnv, null, { timeout: 30000 })
  await page.waitForTimeout(500)
  return { ctx, page }
}

/** Pictures on the canvas (gradient cards), each named when a name is given. */
async function pictures(page, specs) {
  return page.evaluate(async (specs) => {
    const { placePictures } = await import('/src/canvas/nodes/pictures.ts')
    const env = window.__canvasEnv
    const out = []
    for (const s of specs) {
      const c = document.createElement('canvas'); c.width = s.w ?? 1536; c.height = s.h ?? 864
      const g = c.getContext('2d')
      const grad = g.createLinearGradient(0, 0, 0, c.height); grad.addColorStop(0, s.top ?? '#f6a04d'); grad.addColorStop(1, s.bottom ?? '#3b5b8a')
      g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height)
      g.fillStyle = '#fff'; g.font = `${Math.round(c.height / 8)}px sans-serif`; g.fillText(s.label ?? '', 40, c.height / 2)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const [el] = await placePictures(env.canvas, env.doc, [blob], s.at)
      const id = el.customData.id
      if (s.name) window.__ctrl.name(id, s.name[0], s.name[1], s.name[2] ?? 'character', s.payload)
      out.push({ el: el.id, id })
    }
    await new Promise((r) => setTimeout(r, 300))
    return out
  }, specs)
}

/** A brief's storyboard on the canvas with a Harbour Brand board in the project (round 4's seed). Returns its id. */
async function briefStoryboard(page, plan) {
  return page.evaluate(async (plan) => {
    const { createNode } = await import('/src/canvas/nodes/nodes.ts')
    const { newBoard } = await import('/src/canvas/boards/boards.ts')
    const { updateDoc } = await import('/src/doc/store.ts')
    const { newId } = await import('/src/lib/ulid.ts')
    const env = window.__canvasEnv
    const s = window.__pt
    const sbEl = await createNode(env, 'storyboard', { x: 520, y: 380 })
    const sb = sbEl.customData.id
    const b = await window.__seed.brief({ proposition: 'The kettle that lets the house sleep.', tone: 'Warm, a little funny' }, 'Let Them Sleep (Quietboil)')
    const made = newBoard(env.canvas, s.doc.get(), { rect: { x: 1150, y: 80, w: 420, h: 240 }, title: 'Harbour', purpose: 'brand' })
    await updateDoc(s.doc, (d) => {
      d.boards[made.board.id] = made.board
      const id = newId('link'); d.links[id] = { id, v: 1, field_v: {}, from: { kind: 'brief', id: b.briefId }, to: { kind: 'storyboard', id: sb }, role: 'brief' }
    }, 'seed')
    if (plan) {
      const { planShots } = await import('/src/jobs/plan.ts')
      await planShots({ relay: s.relay, doc: s.doc, ui: s.ui, runner: s.runner }, { storyboardId: sb, text: plan })
    }
    window.__canvas.select([])
    return sb
  }, plan)
}

const openStoryboard = (page, sb) => page.evaluate((sb) => window.__pt.ui.update((u) => { u.openNode = { ...u.openNode, storyboard: sb }; u.stage = 'storyboard' }), sb)
const shot = (page, name, which) => page.screenshot({ path: `${OUT}/${name}-${which}.png` })

const SCENES = {
  // S3-1: the Pen after a round trip through the picture editor: its options in the top bar (after) or beside the
  // rail over the canvas (before); a stroke that starts where the flyout sits.
  async 's3-1-pen-after-editor'(page, which) {
    const p = await pictures(page, [{ label: 'sunset', at: { x: 700, y: 300 } }])
    await page.evaluate((id) => window.__canvas.select([id]), p[0].el)
    await page.waitForTimeout(300)
    const at = await page.evaluate((el) => { const e = window.__canvas.elements().find((x) => x.id === el); const v = window.__canvas.view(); return [(e.x + e.width / 2 + v.scrollX) * v.zoom + (v.offsetLeft ?? 0), (e.y + e.height / 2 + v.scrollY) * v.zoom + (v.offsetTop ?? 0)] }, p[0].el)
    await page.mouse.dblclick(at[0], at[1])
    await page.waitForTimeout(1500)
    // Back to the canvas from the editor.
    await page.getByRole('button', { name: /Canvas|Back|Done|Close/ }).first().click().catch(() => page.keyboard.press('Escape'))
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.__canvas.select([]))
    await page.mouse.click(1000, 700)
    await page.keyboard.press('p')
    await page.waitForTimeout(600)
    await page.mouse.move(110, 430); await page.mouse.down(); await page.mouse.move(420, 560, { steps: 14 }); await page.mouse.up()
    await page.waitForTimeout(400)
    await shot(page, 's3-1-pen-after-editor', which)
  },
  // S2-B: the brief storyboard's "Use a brand?": click Harbour. Before: refused by the store and undone (still asked);
  // after: the board is linked and the question goes.
  async 's2-b-brand-answer'(page, which) {
    await briefStoryboard(page, null)
    await page.waitForTimeout(1500)
    await shot(page, 's2-b-brand-ask', which)
    await page.locator('.bl-brandask button', { hasText: 'Harbour' }).first().click()
    await page.waitForTimeout(1500)
    await shot(page, 's2-b-brand-answered', which)
  },
  // S3-6b: the brief storyboard opened before planning: "plans the shots from the brief" (the main script has words).
  async 's3-6b-brief-storyboard-open'(page, which) {
    // The project's main script has words (the round's other tests), as in the live project.
    await page.evaluate(() => window.__seed.script())
    await page.waitForTimeout(1500)
    await page.evaluate(async () => {
      const { updateDoc } = await import('/src/doc/store.ts')
      const { addScene } = await import('/src/script/edits.ts')
      const { mainScript, scenesOf } = await import('/src/model/selectors.ts')
      const s = window.__pt
      const sc = mainScript(s.doc.get())
      const scene = scenesOf(s.doc.get(), sc.id)[0]?.id ?? await addScene(s.doc, sc.id)
      await updateDoc(s.doc, (d) => { d.scenes[scene].text = 'Leo cycles to work through the city at dawn.' }, 'seed')
      history.back()
    })
    await page.waitForTimeout(1500)
    await page.waitForFunction(() => !!window.__canvasEnv, null, { timeout: 20000 })
    const sb = await briefStoryboard(page, null)
    await openStoryboard(page, sb)
    await page.waitForTimeout(1500)
    await shot(page, 's3-6b-brief-storyboard-open', which)
  },
  // S3-3: an opened storyboard whose plan asks (the mock asks on "[ask]"): the question once, not twice.
  async 's3-3-storyboard-ask-once'(page, which) {
    const sb = await briefStoryboard(page, '[ask] A young renter makes tea at midnight without waking anyone.')
    await page.waitForTimeout(4000)
    await openStoryboard(page, sb)
    await page.waitForTimeout(1500)
    await shot(page, 's3-3-storyboard-ask-once', which)
  },
  // S3-5: @leo kept from frame 1: Used in and Show it on the canvas.
  async 's3-5-leo-card'(page, which) {
    page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 300)) })
    await page.evaluate(() => window.__seed.script())
    await page.waitForTimeout(1200)
    await page.evaluate(() => history.back())
    await page.waitForTimeout(1200)
    await page.evaluate(async () => {
      const pic = (label) => { const c = document.createElement('canvas'); c.width = 672; c.height = 378; const g = c.getContext('2d'); g.fillStyle = '#6b7f94'; g.fillRect(0, 0, 672, 378); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText(label, 30, 200); return c.toDataURL('image/png') }
      await window.__seed.market({ title: 'Leo cycles', shots: [
        { pic: pic('Leo at the bakery'), action: 'Leo unlocks his bike outside a bakery at dawn.', s: 4 },
        { pic: pic('canal'), action: 'He rides along a misty canal path.', s: 4 },
        { pic: pic('bridge'), action: 'Leo stops on a stone bridge to watch rowers pass below.', s: 4 },
      ] })
      const { keepCharacter } = await import('/src/jobs/cast.ts')
      const { shotsOf, currentFrame } = await import('/src/model/selectors.ts')
      await new Promise((r) => setTimeout(r, 800))
      const s = window.__pt
      const d = s.doc.get()
      const shots = Object.values(d.shots).sort((a, b) => (a.rank < b.rank ? -1 : 1))
      const f1 = currentFrame(d, shots[0].id)
      await keepCharacter(s.doc, f1.asset, 'leo')
    })
    await page.waitForTimeout(800)
    await page.locator('.tb-node').first().click()
    await page.waitForTimeout(300)
    await page.getByText('Assets and characters…').first().click()
    await page.waitForTimeout(800)
    await page.locator('.assets-lib button.a').first().click()
    await page.waitForTimeout(600)
    await page.getByRole('tab', { name: /Used in/ }).click().catch(() => {})
    await page.waitForTimeout(400)
    await shot(page, 's3-5-leo-card', which)
  },
  // Rough: the group label of a character whose second view sits up and to the right of the first.
  async 'rough-group-label'(page, which) {
    await pictures(page, [
      { label: '4:5 sunset', w: 1080, h: 1350, at: { x: 330, y: 60 } },
      { label: 'ruby front', name: ['ruby', 'front'], at: { x: 470, y: 520 }, top: '#c9c3b8', bottom: '#8a8378' },
      { label: 'ruby side', name: ['ruby', 'side'], at: { x: 760, y: 330 }, top: '#c9c3b8', bottom: '#8a8378' },
    ])
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.__canvas.select([]))
    await page.waitForTimeout(300)
    await shot(page, 'rough-group-label', which)
  },
}

const browser = await chromium.launch({ executablePath: '/home/batunii/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell' })
try {
  // Rough: a fresh load, the main script held back 4 s (as a slow link holds the bundle): blank before, a loader after.
  if (!only || only === 'rough-fresh-load') {
    for (const [which, base] of Object.entries(SERVERS)) {
      const { ctx, page } = await open(browser, base, { delayMain: 4000 })
      await page.waitForTimeout(1500)
      await shot(page, 'rough-fresh-load', which)
      await ctx.close()
    }
  }
  for (const [name, run] of Object.entries(SCENES)) {
    if (only && only !== name) continue
    for (const [which, base] of Object.entries(SERVERS)) {
      const { ctx, page } = await open(browser, base)
      try { await run(page, which) } catch (e) { console.log(name, which, 'failed:', String(e).slice(0, 300)); await shot(page, name + '-error', which).catch(() => {}) }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
