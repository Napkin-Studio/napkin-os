// Seeds a Ferncliff project in the real Production page (dev server of the copy in ../repo).
export const URL = process.env.MOCK_URL || 'http://127.0.0.1:5391/'

export const BRIEF = {
  insight: 'People who love a cold fruit drink resent how heavy and sweet most of it is.',
  single_minded_proposition: 'Ferncliff is the lightest way to cool down.',
  audience: 'Adults 25-40 who walk, swim and sit outside at lunch.',
  tone_and_world: 'Bright, calm, a little dry. Daylight, green, cold metal and water.',
  desired_response: { feel: 'Cooled down and lightly amused.' },
  mandatories: ['Show the can in the first three seconds', 'Legal: Please recycle. Contains 12% fruit juice.', "Don't show anyone drinking while driving"],
  media_roles: 'Film 30s and 15s; end card on every cut.',
}

/** In-page picture painters: the can, and shot frames with the can in a scene. */
export const painters = `
  window.__paint = (kind, i) => {
    const w = kind === 'can' ? 600 : 1344, h = kind === 'can' ? 800 : 756
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const x = c.getContext('2d')
    const can = (cx, cy, s) => {
      const cw = 150 * s, ch = 300 * s
      x.fillStyle = '#E9ECEA'; x.fillRect(cx - cw / 2, cy - ch / 2, cw, 14 * s)
      x.fillStyle = '#2F7D4F'; x.beginPath(); x.roundRect(cx - cw / 2, cy - ch / 2 + 12 * s, cw, ch - 24 * s, 10 * s); x.fill()
      x.fillStyle = '#F4F1E4'; x.beginPath(); x.roundRect(cx - cw / 2 + 12 * s, cy - 40 * s, cw - 24 * s, 110 * s, 8 * s); x.fill()
      x.fillStyle = '#2F7D4F'; x.font = '700 ' + 30 * s + 'px sans-serif'; x.textAlign = 'center'; x.fillText('FERN', cx, cy + 6 * s)
      x.font = '500 ' + 13 * s + 'px sans-serif'; x.fillText('CLIFF · SPARKLING', cx, cy + 32 * s)
      x.strokeStyle = '#2F7D4F'; x.lineWidth = 4 * s; x.beginPath(); x.moveTo(cx, cy - 60 * s); x.quadraticCurveTo(cx + 28 * s, cy - 90 * s, cx + 8 * s, cy - 120 * s); x.stroke()
      x.fillStyle = '#E9ECEA'; x.fillRect(cx - cw / 2, cy + ch / 2 - 14 * s - 0, cw, 14 * s)
    }
    if (kind === 'can') {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#DCE8DD'); g.addColorStop(1, '#B9CDBC'); x.fillStyle = g; x.fillRect(0, 0, w, h)
      can(w / 2, h / 2, 1.9)
    } else {
      const sky = [['#BFE0EA', '#F3E9C8'], ['#F2D9B3', '#7FB69A'], ['#CFE6D4', '#3C7F58'], ['#E8E2CF', '#2F7D4F']][i % 4]
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, sky[0]); g.addColorStop(1, sky[1]); x.fillStyle = g; x.fillRect(0, 0, w, h)
      x.fillStyle = 'rgba(30,70,50,.25)'; x.beginPath(); x.moveTo(0, h * 0.72); x.quadraticCurveTo(w * 0.3, h * 0.55, w * 0.6, h * 0.7); x.quadraticCurveTo(w * 0.85, h * 0.8, w, h * 0.62); x.lineTo(w, h); x.lineTo(0, h); x.fill()
      can(w * (0.3 + 0.13 * i), h * 0.62, 1.0 + 0.2 * (i % 2))
    }
    return c.toDataURL('image/png')
  }
`

export async function seed(page, { noFrames = false, endCard = true } = {}) {
  await page.goto(URL)
  await page.waitForFunction(() => !!window.__seed, null, { timeout: 30000 })
  await page.getByText('+ New film').click()
  await page.waitForFunction(() => !!window.__canvasEnv, null, { timeout: 30000 })
  await page.addScriptTag({ content: painters })
  const names = ['A can on a rock in the sun', 'A walker stops by a stream', 'Cold can, cold hands', 'Ferncliff on the picnic rug']
  await page.evaluate(async ({ BRIEF, names, noFrames, endCard }) => {
    await window.__seed.market({ title: 'Ferncliff', noFrames, shots: names.map((a, i) => ({ pic: window.__paint('shot', i), action: a, s: 5 })) })
    await window.__seed.scene()
    if (endCard) await window.__seed.endcard()
    if (!noFrames) await window.__seed.takes()
    await window.__seed.nodes()
    const b = await window.__seed.brief(BRIEF, 'Ferncliff summer brief')
    // the can: a named picture on the canvas
    const { placePictures } = await import('/src/canvas/nodes/pictures.ts')
    const { nameAsset } = await import('/src/jobs/prompt.ts')
    const env = window.__canvasEnv
    const blob = await (await fetch(window.__paint('can', 0))).blob()
    const [el] = await placePictures(env.canvas, env.doc, [blob])
    const d = env.doc.get()
    const sha = Object.values(d.assets).filter(a => a.origin === 'uploaded').at(-1).sha256
    await nameAsset(env.doc, sha, { key: 'ferncan', variant: 'front', role: 'product' }, el.customData.id)
    const move = (id, x, y, w, h) => env.canvas.transact((els) => els.map((e) => (e.id === id ? { ...e, x, y, ...(w ? { width: w, height: h } : {}) } : e)), { undoable: false })
    move(b.elementId, 440, 40)
    move(el.id, 440, 250, 150, 200)
    const { bringIntoView } = await import('/src/canvas/boards/boards.ts')
    env.canvas.select([])
    window.__fit = () => bringIntoView(env.canvas, { minX: 0, minY: -215, maxX: 1160, maxY: 720 }, 80, false)
    window.__fit()
    window.__seeded = { b, canEl: el.id, sha }
  }, { BRIEF, names, noFrames, endCard })
}

export const select = (page, kind) => page.evaluate((kind) => {
  const c = window.__canvasEnv.canvas
  const e = c.elements().find((x) => !x.isDeleted && x.customData?.kind === kind)
  c.select([e.id])
}, kind)

export const unlinkBrief = (page) => page.evaluate(async () => {
  const { systemUpdate } = await import('/src/doc/store.ts')
  await systemUpdate(window.__canvasEnv.doc, (d) => { for (const [id, l] of Object.entries(d.links)) if (l.from.kind === 'brief') delete d.links[id] }, 'mock')
  await new Promise((r) => setTimeout(r, 500))
})

export const linkCanToScript = (page) => page.evaluate(async () => {
  const { linkInput } = await import('/src/canvas/nodes/nodes.ts')
  const { refsList, mainScript } = await import('/src/model/selectors.ts')
  const env = window.__canvasEnv
  const d = env.doc.get()
  await linkInput(env.doc, d, { kind: 'ref', id: refsList(d)[0].id }, { kind: 'script', id: mainScript(d).id })
  await new Promise((r) => setTimeout(r, 500))
})

export async function openNode(page, kind) {
  await select(page, kind)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.waitForTimeout(1200)
}

export async function endCardScreen(page) {
  await openNode(page, 'video')
  await page.getByText('Edit', { exact: true }).first().click()
  await page.waitForTimeout(1000)
  await page.getByText('Add an end card').click()
  await page.waitForTimeout(800)
  if (await page.locator('.booth-col[data-booth-open="false"]').count()) { await page.locator('.booth-edge').click(); await page.waitForTimeout(600) }
  const cta = page.getByLabel('Call to action').or(page.locator('label:has-text("Call to action") input')).first()
  await cta.fill('Find Ferncliff near you')
  await cta.press('Enter')
  await page.waitForTimeout(500)
  // the playhead on the end card (a click on the ruler inside it)
  const chip = await page.locator('.rm-tlwrap').getByText('F…').first().boundingBox().catch(() => null)
  await page.locator('.rm-tlwrap').getByText('0:21').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const ruler = await page.locator('.rm-tlwrap').getByText('0:21').first().boundingBox()
  await page.mouse.click(ruler.x + 8, ruler.y + 6)
  await page.waitForTimeout(600)
}
