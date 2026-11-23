// Paired before/after screenshots for features/pt-canvas-r4.clan: base (df0ca1a7) on :5401, branch on :5402.
//   node shots.mjs [scene]
import { createRequire } from 'node:module'
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-canvas-r4/production-tool/web/package.json')
const { chromium } = require('@playwright/test')

const OUT = '/home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/round-4/fixes-canvas'
const SERVERS = { before: 'http://127.0.0.1:5401', after: 'http://127.0.0.1:5402' }
const only = process.argv[2]

async function open(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)))
  await page.goto(`${base}/?engine=own`)
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

const shot = (page, name, which) => page.screenshot({ path: `${OUT}/${name}-${which}.png` })

const SCENES = {
  // S1-1 + S2-4: Resize a 16:9 picture to 9:16 and 21:9 with Extend: 9:16 is redrawn, said plainly; no cost words.
  async 's1-1-resize-extend'(page, which) {
    const p = await pictures(page, [{ label: 'sunset beach', at: { x: 400, y: 300 } }])
    await page.evaluate((id) => window.__canvas.select([id]), p[0].el)
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /^Resize/ }).first().click()
    await page.waitForTimeout(600)
    for (const s of ['9:16', '21:9']) await page.locator('.rs-chip', { hasText: s }).first().click()
    await page.locator('.rs-panel button', { hasText: /^Extend$/ }).first().click().catch(() => {})
    await page.getByRole('button', { name: /^Extend/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    await shot(page, 's1-1-resize-pick', which)
    await page.locator('.rs-panel .cf-foot .btn.primary').click()
    await page.waitForTimeout(400)
    await shot(page, 's1-1-resize-tray', which)
  },
  // R2-11: the key group label at 25 % zoom.
  async 'r2-11-group-label-zoom'(page, which) {
    await pictures(page, [
      { label: 'front', name: ['ruby', 'front'], at: { x: 300, y: 300 } },
      { label: 'side', name: ['ruby', 'side'], at: { x: 800, y: 300 } },
      { label: 'back', name: ['ruby', 'back'], at: { x: 1300, y: 300 } },
    ])
    await page.waitForTimeout(800)
    await page.evaluate(() => window.__canvas.setViewport({ zoom: 0.25, scrollX: 400, scrollY: 400 }))
    await page.waitForTimeout(600)
    await shot(page, 'r2-11-group-label-zoom', which)
  },
  // S3-2: the Pen in hand: its options over the canvas (before) or in the top bar (after).
  async 's3-2-pen-options'(page, which) {
    await page.keyboard.press('Escape')
    await page.locator('.canvas-toolbar [aria-label^="Pen"], .canvas-toolbar [data-tip^="Pen"], .canvas-toolbar button[title^="Pen"]').first().click().catch(async () => { await page.mouse.click(700, 450); await page.keyboard.press('p') })
    await page.waitForTimeout(500)
    // A stroke that starts where the flyout was (x 90-190).
    await page.mouse.move(110, 420); await page.mouse.down(); await page.mouse.move(400, 520, { steps: 12 }); await page.mouse.up()
    await page.waitForTimeout(400)
    await shot(page, 's3-2-pen-options', which)
  },
  // S2-5: "+ > A brief from Brief Maker..." while the Booth shows a character's card.
  async 's2-5-brief-from-card'(page, which) {
    await pictures(page, [{ label: 'ruby', name: ['ruby', 'front'], at: { x: 400, y: 300 } }])
    await page.locator('.tb-node').first().click()
    await page.waitForTimeout(300)
    await page.getByText('Assets and characters…').first().click()
    await page.waitForTimeout(600)
    await page.locator('.assets-lib button.a').first().click()
    await page.waitForTimeout(600)
    await shot(page, 's2-5-character-card-open', which)
    await page.locator('.tb-node').first().click()
    await page.waitForTimeout(300)
    await page.getByRole('menuitem', { name: /A brief from Brief Maker/ }).first().click().catch(async () => { await page.getByText('A brief from Brief Maker…').first().click() })
    await page.waitForTimeout(700)
    await shot(page, 's2-5-brief-from-card', which)
  },
  // S3-4: the picture editor opens with its tools shown, one Booth tab.
  async 's3-4-editor-booth'(page, which) {
    const p = await pictures(page, [{ label: 'sunset', at: { x: 400, y: 300 } }])
    // The person had hidden the canvas's Booth.
    await page.evaluate(async () => {
      const { boothKey } = await import('/src/ui/booth/state.ts')
      const ui = window.__pt.ui
      const key = boothKey(ui.get().me?.participantId)
      ui.update((u) => { u.booth = { ...(u.booth ?? {}), [key]: 'hidden' } })
    })
    await page.waitForTimeout(300)
    await page.evaluate((id) => window.__canvas.select([id]), p[0].el)
    await page.waitForTimeout(300)
    await page.mouse.dblclick(...(await page.evaluate((el) => { const e = window.__canvas.elements().find((x) => x.id === el); const v = window.__canvas.view(); return [(e.x + e.width / 2 + v.scrollX) * v.zoom + (v.offsetLeft ?? 0), (e.y + e.height / 2 + v.scrollY) * v.zoom + (v.offsetTop ?? 0)] }, p[0].el)))
    await page.waitForTimeout(1500)
    await shot(page, 's3-4-editor-booth', which)
  },
  // S2-6 + S3-6: a brief's storyboard with a Brand board in the project: it asks which brand; planned "from the brief".
  async 's2-6-brief-brand'(page, which) {
    await page.evaluate(async () => {
      const { createNode } = await import('/src/canvas/nodes/nodes.ts')
      const { newBoard } = await import('/src/canvas/boards/boards.ts')
      const { rankBetween } = await import('/src/lib/rank.ts').catch(() => ({ rankBetween: null }))
      const { updateDoc } = await import('/src/doc/store.ts')
      const { newId } = await import('/src/lib/ulid.ts')
      const { planShots } = await import('/src/jobs/plan.ts')
      const env = window.__canvasEnv
      const s = window.__pt
      const sbEl = await createNode(env, 'storyboard', { x: 420, y: 420 })
      const sb = sbEl.customData.id
      const b = await window.__seed.brief({ proposition: 'The kettle that lets the house sleep.', tone: 'Warm, a little funny' }, 'Let Them Sleep (Quietboil)')
      const made = newBoard(env.canvas, s.doc.get(), { rect: { x: 1200, y: 100, w: 500, h: 300 }, title: 'Harbour', purpose: 'brand' })
      await updateDoc(s.doc, (d) => {
        d.boards[made.board.id] = made.board
        const id = newId('link'); d.links[id] = { id, v: 1, field_v: {}, from: { kind: 'brief', id: b.briefId }, to: { kind: 'storyboard', id: sb }, role: 'brief' }
      }, 'seed')
      await planShots({ relay: s.relay, doc: s.doc, ui: s.ui, runner: s.runner }, { storyboardId: sb, text: 'A young renter makes tea at midnight without waking anyone.' })
      window.__canvas.select([])
    }).catch((e) => console.log('seed failed', String(e).slice(0, 300)))
    await page.waitForTimeout(9000)
    await page.evaluate(() => window.__canvas.select([]))
    await page.waitForTimeout(500)
    await shot(page, 's2-6-brief-brand', which)
  },
}

const browser = await chromium.launch({ executablePath: '/home/batunii/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell' })
try {
  for (const [name, scene] of Object.entries(SCENES)) {
    if (only && only !== name) continue
    for (const which of ['before', 'after']) {
      const { ctx, page } = await open(browser, SERVERS[which])
      try { await scene(page, which) } catch (e) { console.log(name, which, 'failed', String(e).slice(0, 300)); await shot(page, `${name}-failed`, which).catch(() => {}) }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
