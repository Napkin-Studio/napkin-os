// Paired before/after screenshots for features/pt-canvas-r3.clan: base (b60b21ed) on :5301, branch on :5302.
import { createRequire } from 'node:module'
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-canvas-r3/production-tool/web/package.json')
const { chromium } = require('@playwright/test')

const OUT = '/home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/round-3/fixes-canvas'
const SERVERS = { before: 'http://127.0.0.1:5301', after: 'http://127.0.0.1:5302' }
const only = process.argv[2]

async function open(browser, base, init) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)))
  if (init) await page.addInitScript(init)
  await page.goto(`${base}/?engine=own`)
  for (let i = 0; i < 4; i++) {
    try { await page.waitForFunction(() => !!window.__seed, null, { timeout: 30000 }); await page.evaluate(() => window.__seed.canvas()); break } catch (e) { if (i === 3) throw e; await page.waitForLoadState('load') }
  }
  await page.waitForFunction(() => !!window.__ctrl && !!window.__canvasEnv, null, { timeout: 30000 })
  await page.waitForTimeout(500)
  return { ctx, page }
}

/** Pictures on the canvas (coloured cards), each named when a name is given. */
async function pictures(page, specs) {
  return page.evaluate(async (specs) => {
    const { placePictures } = await import('/src/canvas/nodes/pictures.ts')
    const env = window.__canvasEnv
    const out = []
    for (const s of specs) {
      const c = document.createElement('canvas'); c.width = s.w ?? 1600; c.height = s.h ?? 900
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
  // R3-2: the Generate tray lists the brand with ticks; a plain photo gets the rule only.
  async 'r3-02-generate-tray'(page, which) {
    const p = await pictures(page, [
      { label: 'palette', name: ['harbour', 'palette', 'palette'], payload: { swatches: [{ hex: '#0A1F44', name: 'Navy' }, { hex: '#E8DCC4', name: 'Sand' }, { hex: '#FF6F59', name: 'Coral' }] }, at: { x: 200, y: 200 } },
      { label: 'type', name: ['harbourfont', 'headline', 'typography'], payload: { font: { family: 'DejaVu Serif', use: 'headlines' } }, at: { x: 600, y: 200 } },
      { label: 'rules', name: ['harbourrule', 'drinks', 'brand_rule'], payload: { rule: { kind: 'dont', text: 'No alcohol. No wine, no beer.' } }, at: { x: 1000, y: 200 } },
      { label: 'cottage', top: '#9fd3ff', bottom: '#5f8f4a', at: { x: 600, y: 600 } },
    ])
    await page.evaluate((id) => window.__canvas.select([id]), p[3].el)
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Generate', exact: true }).first().click()
    await page.waitForTimeout(400)
    await page.locator('.send-tray textarea').fill('A whitewashed fisherman’s cottage on a cliff, midday sun. Photo.')
    await page.locator('.send-tray .tray-fold').click()
    await page.waitForTimeout(400)
    await shot(page, 'r3-02-generate-tray', which)
  },
  // R3-3 and R3-4: the Image editor on a 3072 px frame with a change that came back the same.
  async 'r3-03-04-editor'(page, which) {
    await page.evaluate(() => window.__seed.frame({ w: 3072, h: 1728, ratio: '16:9' }))
    await page.evaluate(() => window.__seed.storyboard())
    await page.getByRole('button', { name: 'Open in image editor' }).first().click()
    await page.locator('.ie-frame').waitFor()
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Whole frame', exact: true }).click()
    await page.getByLabel('Describe the change to the whole frame').fill('[same] warmer light')
    await page.locator('.ie-action button', { hasText: 'Change' }).first().click()
    await page.waitForTimeout(400)
    const send = page.locator('[role=dialog] button, .edit-tray button, .send-tray button').filter({ hasText: /^Change$/ }).last()
    await send.click()
    await page.waitForTimeout(9000)
    await page.waitForTimeout(600)
    const up = page.getByRole('button', { name: /^Upscale/ }).first()
    if (await up.count()) { await up.click().catch(() => {}) }
    await page.waitForTimeout(500)
    await page.locator('.ie-elist').scrollIntoViewIfNeeded().catch(() => {})
    await shot(page, 'r3-03-04-editor', which)
  },
  // R3-5: a plan waiting on a question.
  async 'r3-05-plan-asks'(page, which) {
    await page.evaluate(async () => {
      const { storyboardFromLine } = await import('/src/jobs/prompt.ts')
      const { mainStoryboard } = await import('/src/model/selectors.ts')
      const s = window.__pt
      const d = s.doc.get()
      let sb = mainStoryboard(d)
      if (!sb) {
        const { createNode } = await import('/src/canvas/nodes/nodes.ts')
        await createNode(window.__canvasEnv, 'storyboard', { x: 500, y: 400 })
        sb = mainStoryboard(s.doc.get())
      }
      await storyboardFromLine({ relay: s.relay, doc: s.doc, ui: s.ui, runner: s.runner }, sb.id, 'Mia finds a puppy in the rain [ask]')
    })
    await page.waitForTimeout(6000)
    await page.evaluate(() => window.__canvas.select([]))
    await page.waitForTimeout(500)
    await shot(page, 'r3-05-plan-asks', which)
  },
  // R3-1: New storyboard from this text makes its own script.
  async 'r3-01-storyboard-from-note'(page, which) {
    await page.evaluate(async () => {
      const { createNode } = await import('/src/canvas/nodes/nodes.ts')
      const { wordsOnPage } = await import('/src/script/edits.ts')
      const el = await createNode(window.__canvasEnv, 'script', { x: 1100, y: 300 })
      await wordsOnPage(window.__pt.doc, el.customData.id, 'Three friends share an evening picnic on a harbour wall.')
      window.__canvas.select([])
    })
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /^Text \(/ }).first().click()
    await page.mouse.click(260, 250)
    await page.waitForTimeout(200)
    await page.keyboard.type('Mia finds a lost puppy in the rain. Four shots.')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /^Select \(/ }).first().click()
    await page.mouse.click(300, 258)
    await page.waitForTimeout(500)
    const port = page.locator('.nl-port').first()
    const b = await port.boundingBox()
    if (!b) throw new Error('no port on the note')
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(500, 560, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    await shot(page, 'r3-01-picker', which)
    await page.locator('.nl-picker').getByText('Storyboard', { exact: false }).first().click()
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: /^Zoom .*fit everything/ }).click().catch(() => {})
    await page.waitForTimeout(800)
    await shot(page, 'r3-01-storyboard-from-note', which)
  },
  // R2-11: names at 25 % zoom.
  async 'r2-11-low-zoom'(page, which) {
    await pictures(page, [
      { label: 'front', name: ['ruby', 'front'], at: { x: 300, y: 200 } },
      { label: 'side', name: ['ruby', 'side'], at: { x: 700, y: 200 } },
      { label: 'beach', at: { x: 300, y: 460 } },
      { label: 'beach2', at: { x: 700, y: 460 } },
    ])
    await page.evaluate(() => window.__canvas.select([]))
    const out = page.getByRole('button', { name: /Zoom out/ }).first()
    for (let i = 0; i < 4; i++) { await out.click().catch(() => {}); await page.waitForTimeout(150) }
    await page.waitForTimeout(500)
    await shot(page, 'r2-11-low-zoom', which)
  },
  // R3-8: Name… on a key that is a palette already.
  async 'r3-08-name-existing-key'(page, which) {
    const p = await pictures(page, [
      { label: 'palette', name: ['harbour', 'palette', 'palette'], payload: { swatches: [{ hex: '#0A1F44' }, { hex: '#FF6F59' }] }, at: { x: 300, y: 300 } },
      { label: 'Harbour font', top: '#ffffff', bottom: '#eeeeee', at: { x: 800, y: 300 } },
    ])
    await page.evaluate((id) => window.__canvas.select([id]), p[1].el)
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Name…' }).first().click()
    await page.waitForTimeout(300)
    await page.getByLabel('Character or object').fill('harbour')
    await page.getByLabel('What this one shows').fill('headline')
    await page.waitForTimeout(300)
    await shot(page, 'r3-08-name-existing-key', which)
  },
  // R3-7: an upload kept at 1536 px, picked.
  async 'r3-07-upload-caption'(page, which) {
    const p = await pictures(page, [{ label: '2048 x 1152', w: 2048, h: 1152, at: { x: 600, y: 350 } }])
    await page.evaluate((id) => window.__canvas.select([id]), p[0].el)
    await page.waitForTimeout(500)
    await shot(page, 'r3-07-upload-caption', which)
  },
  // R3-10: Make the other views with a back three-quarter already named.
  async 'r3-10-views'(page, which) {
    const p = await pictures(page, [
      { label: 'front', name: ['ruby', 'front'], top: '#dddddd', bottom: '#999999', w: 900, h: 1200, at: { x: 300, y: 350 } },
      { label: 'back 3/4', name: ['ruby', 'back-three-quarter'], top: '#dddddd', bottom: '#999999', w: 900, h: 1200, at: { x: 700, y: 350 } },
    ])
    await page.evaluate((id) => window.__canvas.select([id]), p[0].el)
    await page.waitForTimeout(400)
    const b = page.getByRole('button', { name: 'Make the other views' }).first()
    if (await b.count()) await b.click()
    await page.waitForTimeout(400)
    await shot(page, 'r3-10-views', which)
  },
  // R3-6: From Napkin › Link, while Napkin is slow to send the brief.
  async 'r3-06-brief-link'(page, which) {
    await page.evaluate(() => window.__pt.ui.update((u) => { u.configChoice = 'allon' }))
    await page.evaluate(async () => {
      const { createNode } = await import('/src/canvas/nodes/nodes.ts')
      await createNode(window.__canvasEnv, 'script', { x: 700, y: 400 })
    })
    await page.evaluate(() => window.__canvas.select([]))
    await page.getByRole('button', { name: '+ Node' }).click()
    await page.waitForTimeout(300)
    await page.getByText('A brief from Brief Maker…').click()
    await page.waitForTimeout(500)
    const tab = page.getByRole('tab', { name: 'From Napkin' })
    if (await tab.count()) await tab.click()
    await page.waitForTimeout(800)
    const link = page.getByRole('button', { name: 'Link', exact: true }).first()
    if (await link.count()) await link.click()
    await page.waitForTimeout(4500)
    await shot(page, 'r3-06-brief-link', which)
  },
}

const BRIEF_STUB = () => {
  const data = { spine: { proposition: 'Sleep without the noise.', tone: 'Calm, warm' } }
  window.__briefSource = {
    available: async () => true,
    list: async () => [{ documentId: 'doc-1', title: 'Let Them Sleep (Quietboil launch film)', updatedAt: new Date().toISOString(), client: { name: 'UAT PT Kettle' } }],
    read: async (id) => { await new Promise((r) => setTimeout(r, 9000)); return { documentId: id, title: 'Let Them Sleep (Quietboil launch film)', appId: 'ie.napkin.brief-maker', dataSha256: 'sha256:' + 'b'.repeat(64), data } },
    openUrl: (id) => `/?open=${id}`,
  }
}

const browser = await chromium.launch({ headless: true, executablePath: '/home/batunii/.local/bin/chromium' })
try {
  for (const [name, fn] of Object.entries(SCENES)) {
    if (only && !name.includes(only)) continue
    for (const [which, base] of Object.entries(SERVERS)) {
      const { ctx, page } = await open(browser, base, name.includes('brief') ? BRIEF_STUB : undefined)
      try { await fn(page, which); console.log('ok', name, which) } catch (e) { console.log('FAIL', name, which, String(e).slice(0, 300)); await shot(page, `fail-${name}`, which).catch(() => {}) }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
