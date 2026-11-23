import { chromium } from 'playwright'
import { seed } from './psetup.mjs'
const OUT = new URL('../build/', import.meta.url).pathname
const ROOT = '/home/batunii/Documents/Code/napkin-wt-t-toprod/production-tool/'
const R = {
  tide: { name: "Tide's In", line: 'Tidewell. The tide is in.', why: 'Cold fruit drinks feel heavy. The tide coming in is the lightest, calmest kind of cool.', pal: ['#0B5D8A', '#BFE0EA', '#F3E9C8', '#1C2630'], words: ['light', 'cool', 'calm', 'daylight', 'tide'], not: 'Loud beach party, sunburn, spring break.',
    pics: [['Harbour wall', 'Ours', 0], ['Rock pool', 'Ours', 1], ['Waterline', 'Licensed', 2], ['Low-tide rug', 'Rights?', 3]], sky: [['#BFE0EA', '#F3E9C8'], ['#CFE6EE', '#9CC7DE'], ['#F3E9C8', '#7FB6C9'], ['#DCEAF0', '#E9DDB8']], ground: '#0B5D8A' },
  salt: { name: 'Salt of the Earth', line: 'Tidewell. Plain good.', why: 'Honest, unfussy, for people who work and walk outdoors. The can is a quiet everyday thing.', pal: ['#7A5C3E', '#E8DFC9', '#3C5A3E', '#1C2630'], words: ['honest', 'plain', 'grounded', 'dry', 'earth'], not: 'Fancy, wellness-label, preachy.',
    pics: [['Stone wall', 'Ours', 0], ['Workbench', 'Ours', 1], ['Tall grass', 'Ours', 2], ['Gatepost', 'Rights?', 3]], sky: [['#E8DFC9', '#C9B48F'], ['#EFE6D2', '#B89A73'], ['#DDE5CF', '#7E9A6A'], ['#E6E0D2', '#A9A08C']], ground: '#3C5A3E' },
}

const PAINT = `
window.__R = ${JSON.stringify(R)}; { const st = document.createElement('style'); st.textContent = '.devswitch{display:none!important}'; document.head.appendChild(st) }
window.__paintRoute = (r, k) => { const [cap, chip, i] = r.pics[k]; const c = document.createElement('canvas'); c.width = 480; c.height = 270; const x = c.getContext('2d')
    const g = x.createLinearGradient(0, 0, 0, 270); g.addColorStop(0, r.sky[i][0]); g.addColorStop(1, r.sky[i][1]); x.fillStyle = g; x.fillRect(0, 0, 480, 270)
    x.fillStyle = r.ground; x.globalAlpha = .75; x.beginPath(); x.moveTo(0, 190 - i * 12); x.quadraticCurveTo(140, 150 + i * 10, 260, 188); x.quadraticCurveTo(380, 215, 480, 170 + i * 8); x.lineTo(480, 270); x.lineTo(0, 270); x.fill(); x.globalAlpha = 1
    const cx = 130 + i * 70, cy = 150, s = .62 + (i % 2) * .12, cw = 150 * s, ch = 300 * s
    x.fillStyle = '#E9ECEA'; x.fillRect(cx - cw / 2, cy - ch / 2, cw, 14 * s)
    x.fillStyle = '#1C2630'; x.beginPath(); x.roundRect(cx - cw / 2, cy - ch / 2 + 12 * s, cw, ch - 24 * s, 10 * s); x.fill()
    x.fillStyle = '#F4F1E4'; x.beginPath(); x.roundRect(cx - cw / 2 + 12 * s, cy - 40 * s, cw - 24 * s, 110 * s, 8 * s); x.fill()
    x.fillStyle = '#1C2630'; x.font = '700 ' + 30 * s + 'px sans-serif'; x.textAlign = 'center'; x.fillText('TIDE', cx, cy + 6 * s); x.font = '500 ' + 13 * s + 'px sans-serif'; x.fillText('WELL', cx, cy + 32 * s)
    x.fillStyle = '#E9ECEA'; x.fillRect(cx - cw / 2, cy + ch / 2 - 14 * s, cw, 14 * s)
    
  return c.toDataURL('image/png') }
`
const RIGHTS = { Ours: 'own', Licensed: 'licensed', 'Rights?': undefined }
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
const only = process.argv[2]?.split(',')
for (const [w, h] of [[1280, 800], [1024, 768]]) for (const st of ['t1', 't2', 't3']) {
  if (only && !only.includes(st)) continue
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage()
  p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)))
  await p.addInitScript((root) => { window.__root = root }, ROOT)
  await seed(p); await p.waitForTimeout(2000)
  await p.evaluate(PAINT)
  await p.evaluate(async ({ st, w, RIGHTS, R }) => {
    const env = window.__canvasEnv
    const kindOf = (e) => e.customData?.kind
    const { createNode } = await import('/src/canvas/nodes/nodes.ts')
    const { systemUpdate } = await import('/src/doc/store.ts')
    const { fitClear } = await import('/src/canvas/boards/boards.ts')
    const { mainScript } = await import('/src/model/selectors.ts')
    const { putBlob } = await import('/src/lib/blobs.ts')
    const { placeBrief, linkBrief } = await import('/src/brief/canvas.ts')
    const { ROUTE_CARD } = await import('/src/brief/routeNode.ts')
    const { newId } = await import('/src/lib/ulid.ts')
    // clear the seeded film (Scripts stay for t3)
    env.canvas.transact((els) => els.map((e) => (st === 't3' && kindOf(e) === 'script' ? e : { ...e, isDeleted: true })), { undoable: false })
    const mkNode = async (key) => {
      const r = R[key]
      const pictures = []
      for (let k = 0; k < r.pics.length; k++) {
        const blob = await (await fetch(window.__paintRoute(r, k))).blob()
        pictures.push({ sha256: await putBlob(blob), caption: r.pics[k][0], rights: RIGHTS[r.pics[k][1]] })
      }
      const node = { id: newId('brief'), v: 1, field_v: {}, title: 'Tidewell territories',
        source: { document_id: 'doc-tidewell-territories', app_id: 'ie.napkin.territories', data_sha256: 'sha256:' + 'a'.repeat(64), taken: 3, at: new Date().toISOString(), how: 'spinoff' },
        spine: { proposition: 'Tidewell is the lightest way to cool down.', mandatories: ['Show the can in the first three seconds'], donts: ["Don't show anyone drinking while driving"] },
        route: { id: key, name: r.name, thought: r.line, why: r.why, words: r.words, palette: r.pal, not: [r.not], pictures },
        carries: { brief: { title: 'Tidewell summer brief', v: 2 }, research: { title: 'Tidewell research' } } }
      await systemUpdate(env.doc, (d) => { d.briefs ??= {}; d.briefs[node.id] = node }, 'mock build')
      return node
    }
    const nodes = [await mkNode('tide'), await mkNode('salt')]
    const gap = w === 1280 ? 36 : 24
    const W = (w === 1280 ? 410 : 360), H = w === 1280 ? ROUTE_CARD.h : ROUTE_CARD.h
    const place = (n, x, y, ww, hh) => placeBrief(env, n.id, { x: x + ww / 2, y: y + hh / 2 }, { w: ww, h: hh })
    let els = []
    if (st === 't1') { els = [place(nodes[0], 0, 0, ROUTE_CARD.w, ROUTE_CARD.h), place(nodes[1], ROUTE_CARD.w + gap, 0, ROUTE_CARD.w, ROUTE_CARD.h)] }
    if (st === 't2') { const big = Math.round(ROUTE_CARD.w * 1.42); els = [place(nodes[0], 0, 0, big, ROUTE_CARD.h + 36), place(nodes[1], big + gap, 0, ROUTE_CARD.w, ROUTE_CARD.compactH)] }
    if (st === 't3') {
      const S = env.canvas.elements().find((x) => !x.isDeleted && kindOf(x) === 'script')
      const S2 = await createNode(env, 'script', { x: S.x + S.width / 2, y: S.y + S.height + 100 })
      const { newUlidId, ranksBetween } = await import('/@fs/' + window.__root + 'clan-store/src/index.ts')
      const T = [['A can on the harbour wall as the tide comes in', 'A rock pool at noon, the can cold in the shade', 'Cold can, calm water, the last light'], ['A can on a dry stone wall at the field edge', 'A can on a workbench by the open door', 'Cold can, tall grass, a gate beyond']]
      await systemUpdate(env.doc, (d) => {
        ;[mainScript(d).id, S2.customData.id].forEach((sid, j) => { const rk = ranksBetween(null, null, 3); T[j].forEach((t, i) => { const id = newUlidId('scene'); d.scenes[id] = { id, v: 1, field_v: {}, script_id: sid, rank: rk[i], heading: 'EXT. DAY', text: t } }) })
        d.scripts[S2.customData.id].title = 'TIDEWELL'
      }, 'mock')
      const mv = (id, x, y) => env.canvas.transact((els) => els.map((e) => (e.id === id ? { ...e, x, y } : e)), { undoable: false })
      mv(S.id, S.x, 0); mv(S2.id, S.x, S.height + 70)
      const sx = S.x - 190 - ROUTE_CARD.w
      els = [place(nodes[0], sx, -20, ROUTE_CARD.w, ROUTE_CARD.compactH), place(nodes[1], sx, S.height + 50, ROUTE_CARD.w, ROUTE_CARD.compactH)]
      await linkBrief(env, nodes[0].id, { kind: 'script', id: mainScript(env.doc.get()).id })
      await linkBrief(env, nodes[1].id, { kind: 'script', id: S2.customData.id })
    }
    window.__els = els.map((e) => e.id)
    env.canvas.select(st === 't2' ? [els[0].id] : [])
    const all = env.canvas.elements().filter((e) => !e.isDeleted)
    const bb = all.reduce((a, e) => ({ minX: Math.min(a.minX, e.x), minY: Math.min(a.minY, e.y), maxX: Math.max(a.maxX, e.x + e.width), maxY: Math.max(a.maxY, e.y + e.height) }), { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 })
    fitClear(env.canvas, all, { zoomFactor: st === 't3' ? 0.95 : 1 })
  }, { st, w, RIGHTS, R })
  await p.waitForTimeout(2500)
  if (st === 't2') { await p.getByText('Hide', { exact: true }).first().click({ timeout: 3000 }).catch((e) => console.log('hide failed')); await p.waitForTimeout(800) }
  await p.mouse.move(640, 790); await p.waitForTimeout(500)
  await p.screenshot({ path: `${OUT}build-${st}-${w}.png` })
  await p.context().close()
}
await b.close()
