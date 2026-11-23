import { chromium } from 'playwright'
import { seed } from './psetup.mjs'
const OUT = new URL('../', import.meta.url).pathname
const R = {
  tide: { name: "Tide's In", line: 'Tidewell. The tide is in.', why: 'Cold fruit drinks feel heavy. The tide coming in is the lightest, calmest kind of cool.', pal: ['#0B5D8A', '#BFE0EA', '#F3E9C8', '#1C2630'], words: ['light', 'cool', 'calm', 'daylight', 'tide'], not: 'Loud beach party, sunburn, spring break.',
    pics: [['Harbour wall', 'Ours', 0], ['Rock pool', 'Ours', 1], ['Waterline', 'Licensed', 2], ['Low-tide rug', 'Rights?', 3]], sky: [['#BFE0EA', '#F3E9C8'], ['#CFE6EE', '#9CC7DE'], ['#F3E9C8', '#7FB6C9'], ['#DCEAF0', '#E9DDB8']], ground: '#0B5D8A' },
  salt: { name: 'Salt of the Earth', line: 'Tidewell. Plain good.', why: 'Honest, unfussy, for people who work and walk outdoors. The can is a quiet everyday thing.', pal: ['#7A5C3E', '#E8DFC9', '#3C5A3E', '#1C2630'], words: ['honest', 'plain', 'grounded', 'dry', 'earth'], not: 'Fancy, wellness-label, preachy.',
    pics: [['Stone wall', 'Ours', 0], ['Workbench', 'Ours', 1], ['Tall grass', 'Ours', 2], ['Gatepost', 'Rights?', 3]], sky: [['#E8DFC9', '#C9B48F'], ['#EFE6D2', '#B89A73'], ['#DDE5CF', '#7E9A6A'], ['#E6E0D2', '#A9A08C']], ground: '#3C5A3E' },
}
const NODE_JS = `
window.__R = ${JSON.stringify(R)}
const st = document.createElement('style'); st.textContent = \`
.devswitch{display:none!important}
.tn{position:fixed;z-index:30;font:12px/1.4 var(--font-ui,system-ui);color:#141413}
.tn-card{position:relative;box-sizing:border-box;background:#E6EEE9;border:1px solid #9DB3A6;border-radius:3px 6px 6px 6px;box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 6px 18px -8px rgba(30,50,40,.3)}
.tn.sel .tn-card{box-shadow:0 0 0 2px #141413,0 6px 18px -8px rgba(30,50,40,.3)}
.tn-tab{position:absolute;top:-17px;left:-1px;height:17px;padding:0 9px;font:600 9.5px/17px var(--font-mono,monospace);letter-spacing:.1em;background:#CFDDD4;border:1px solid #9DB3A6;border-bottom:0;border-radius:3px 3px 0 0;color:#243b2f}
.tn-head{display:flex;align-items:baseline;gap:8px;padding:10px 12px 6px}
.tn-head b{font:600 15px var(--font-serif,Georgia,serif);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tn-head b::after{content:".";color:#C9462A}
.tn-head span{font:500 10px var(--font-mono,monospace);color:#5d6a62;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.tn-tabs{display:flex;gap:4px;padding:0 12px;border-bottom:1px solid rgba(157,179,166,.8)}
.tn-tabs button{font:600 12px var(--font-ui,system-ui);padding:6px 12px;border:1px solid transparent;border-bottom:0;border-radius:5px 5px 0 0;background:transparent;color:#5d6a62;cursor:pointer;margin-bottom:-1px}
.tn-tabs button.on{background:#F4F8F5;border-color:#9DB3A6;color:#141413}
.tn-body{background:#F4F8F5;padding:10px 12px 8px}
.tn-nm{font:600 17px var(--font-serif,Georgia,serif)}
.tn-ln{font:italic 13px var(--font-serif,Georgia,serif);color:#3b4a41;margin:1px 0 6px}
.tn-r{display:grid;grid-template-columns:76px 1fr;gap:8px;padding:4px 0;border-bottom:1px solid rgba(157,179,166,.35);font:400 11.5px/1.35 var(--font-ui,system-ui);align-items:center}
.tn-r>span:first-child{font:600 8.5px/1.6 var(--font-mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:#4e7260}
.tn-sw{display:flex;gap:5px}.tn-sw i{width:34px;height:16px;border-radius:4px;border:1px solid #0002}
.tn-wd{display:flex;gap:5px;flex-wrap:wrap}.tn-wd i{font-style:normal;border:1px solid #9DB3A6;background:#fff;border-radius:999px;padding:0 8px}
.tn-pics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:9px}
.tn-pic{min-width:0}.tn-pic img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:3px;border:1px solid #0002}
.tn-pic small{display:block;font:500 9.5px var(--font-ui,system-ui);color:#4a574f;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tn-ch{display:inline-block;margin-top:2px;font:600 9px var(--font-mono,monospace);padding:0 6px;border-radius:999px;border:1px solid #9DB3A6;background:#fff;color:#2f6b4a}
.tn-ch.q{border-color:#d3a24c;background:#fdf3dc;color:#8a5a0b}.tn-ch.l{color:#2c5d8f;border-color:#9db9d6}
.tn-foot{display:flex;justify-content:space-between;gap:8px;padding:6px 12px 8px;border-top:1px solid rgba(157,179,166,.8);font:500 10px var(--font-mono,monospace);color:#5d6a62}
.tn-foot a{color:#141413;text-decoration:underline;cursor:pointer}
.tn-port{position:absolute;left:100%;top:50%;width:9px;height:9px;margin:-4px 0 0 -4px;border-radius:50%;background:#fff;border:1.5px solid #8a93a3}
.tn-pill{position:fixed;z-index:32;font:600 11px system-ui;background:#fff;border:1px solid #9DB3A6;border-radius:999px;padding:1px 9px;color:#141413;white-space:nowrap}
\`; document.head.appendChild(st)
window.__tn = (o) => {
  const pic = (r, k) => { const [cap, chip, i] = r.pics[k]; const c = document.createElement('canvas'); c.width = 480; c.height = 270; const x = c.getContext('2d')
    const g = x.createLinearGradient(0, 0, 0, 270); g.addColorStop(0, r.sky[i][0]); g.addColorStop(1, r.sky[i][1]); x.fillStyle = g; x.fillRect(0, 0, 480, 270)
    x.fillStyle = r.ground; x.globalAlpha = .75; x.beginPath(); x.moveTo(0, 190 - i * 12); x.quadraticCurveTo(140, 150 + i * 10, 260, 188); x.quadraticCurveTo(380, 215, 480, 170 + i * 8); x.lineTo(480, 270); x.lineTo(0, 270); x.fill(); x.globalAlpha = 1
    const cx = 130 + i * 70, cy = 150, s = .62 + (i % 2) * .12, cw = 150 * s, ch = 300 * s
    x.fillStyle = '#E9ECEA'; x.fillRect(cx - cw / 2, cy - ch / 2, cw, 14 * s)
    x.fillStyle = '#1C2630'; x.beginPath(); x.roundRect(cx - cw / 2, cy - ch / 2 + 12 * s, cw, ch - 24 * s, 10 * s); x.fill()
    x.fillStyle = '#F4F1E4'; x.beginPath(); x.roundRect(cx - cw / 2 + 12 * s, cy - 40 * s, cw - 24 * s, 110 * s, 8 * s); x.fill()
    x.fillStyle = '#1C2630'; x.font = '700 ' + 30 * s + 'px sans-serif'; x.textAlign = 'center'; x.fillText('TIDE', cx, cy + 6 * s); x.font = '500 ' + 13 * s + 'px sans-serif'; x.fillText('WELL', cx, cy + 32 * s)
    x.fillStyle = '#E9ECEA'; x.fillRect(cx - cw / 2, cy + ch / 2 - 14 * s, cw, 14 * s)
    return '<div class="tn-pic"><img src="' + c.toDataURL() + '"><small>' + cap + '</small><span class="tn-ch ' + (chip === 'Rights?' ? 'q' : chip === 'Licensed' ? 'l' : '') + '">' + chip + '</span></div>' }
  const n = document.createElement('div'); n.className = 'tn' + (o.sel ? ' sel' : ''); n.style.cssText = 'left:' + o.x + 'px;top:' + o.y + 'px;width:' + o.w + 'px'
  const r = window.__R[o.open]
  const rows = o.compact ? '' : '<div class="tn-r"><span>Why</span><span>' + r.why + '</span></div><div class="tn-r"><span>Words</span><span class="tn-wd">' + r.words.map(w => '<i>' + w + '</i>').join('') + '</span></div><div class="tn-r"><span>Must not be</span><span>' + r.not + '</span></div>'
  n.innerHTML = '<div class="tn-card"><span class="tn-tab">TERRITORIES</span>'
    + '<div class="tn-head"><b>Territories · ' + r.name + ' · v3</b><span>frozen copy</span></div>'
    + '<div class="tn-body" style="border-top:1px solid rgba(157,179,166,.8)"><div class="tn-ln" style="margin-top:0">' + r.line + '</div>'
    + '<div class="tn-r"><span>Palette</span><span class="tn-sw">' + r.pal.map(c => '<i style="background:' + c + '"></i>').join('') + '</span></div>' + rows
    + '<div class="tn-pics" style="' + (o.compact ? 'grid-template-columns:repeat(4,minmax(0,1fr))' : '') + '">' + r.pics.map((_, k) => pic(r, k)).join('') + '</div></div>'
    + '<div class="tn-foot"><span>Carries: Brief v2 · Research</span><a>Open in Territories ↗</a></div></div><i class="tn-port"></i>'
  document.body.appendChild(n); return n
}
window.__pill = (x, y, t) => { const d = document.createElement('div'); d.className = 'tn-pill'; d.style.cssText = 'left:' + x + 'px;top:' + y + 'px'; d.textContent = t; document.body.appendChild(d) }
window.__arrow = (x1, y1, x2, y2) => {
  let s = document.getElementById('tnarrows'); if (!s) { s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.id = 'tnarrows'; s.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;z-index:29;pointer-events:none'); s.innerHTML = '<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8z" fill="#8a93a3"/></marker></defs>'; document.body.appendChild(s) }
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'), mx = (x1 + x2) / 2
  p.setAttribute('d', 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2); p.setAttribute('stroke', '#8a93a3'); p.setAttribute('fill', 'none'); p.setAttribute('stroke-width', '1.6'); p.setAttribute('marker-end', 'url(#ah)'); s.appendChild(p)
}
window.__rects = (sel) => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }).sort((a, b) => a.y - b.y)
`
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
const only = process.argv[2]?.split(',')
for (const [w, h] of [[1280, 800], [1024, 768]]) for (const st of ['t1', 't2', 't3']) {
  if (only && !only.includes(st)) continue
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage()
  p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0, 200)))
  await p.addInitScript(() => { window.__root = '/home/batunii/Documents/napkin-local-keep/territories-node-mock/repo/production-tool/' }); await seed(p); await p.waitForTimeout(2000)
  await p.evaluate(async (t3) => {
    const env = window.__canvasEnv
    const kindOf = (e) => e.customData?.kind
    if (!t3) { env.canvas.transact((els) => els.filter((e) => !e.isDeleted && false), { undoable: false }); env.canvas.transact((els) => els.map((e) => ({ ...e, isDeleted: true })), { undoable: false }); return }
    const { createNode } = await import('/src/canvas/nodes/nodes.ts')
    const { systemUpdate } = await import('/src/doc/store.ts')
    const { bringIntoView } = await import('/src/canvas/boards/boards.ts')
    const { mainScript } = await import('/src/model/selectors.ts')
    env.canvas.transact((els) => els.map((e) => (kindOf(e) === 'script' ? e : { ...e, isDeleted: true })), { undoable: false })
    const S = env.canvas.elements().find((x) => !x.isDeleted && kindOf(x) === 'script')
    const S2 = await createNode(env, 'script', { x: S.x + S.width / 2, y: S.y + S.height + 100 })
    const mv = (id, x, y) => env.canvas.transact((els) => els.map((e) => (e.id === id ? { ...e, x, y } : e)), { undoable: false })
    mv(S.id, S.x, 0); mv(S2.id, S.x, S.height + 70)
    const { newUlidId, ranksBetween } = await import('/@fs/' + window.__root + 'clan-store/src/index.ts')
    const T = [['A can on the harbour wall as the tide comes in', 'A rock pool at noon, the can cold in the shade', 'Cold can, calm water, the last light'], ['A can on a dry stone wall at the field edge', 'A can on a workbench by the open door', 'Cold can, tall grass, a gate beyond']]
    await systemUpdate(env.doc, (d) => {
      ;[mainScript(d).id, S2.customData.id].forEach((sid, j) => { const rk = ranksBetween(null, null, 3); T[j].forEach((t, i) => { const id = newUlidId('scene'); d.scenes[id] = { id, v: 1, field_v: {}, script_id: sid, rank: rk[i], heading: 'EXT. DAY', text: t } }) })
      d.scripts[S2.customData.id].title = 'TIDEWELL'
    }, 'mock')
    env.canvas.select([])
    bringIntoView(env.canvas, { minX: S.x - 1000, maxX: S.x + S.width + 40, minY: -40, maxY: S.height * 2 + 130 }, 20, false)
  }, st === 't3')
  await p.waitForTimeout(2500)
  await p.evaluate(NODE_JS)
  if (st === 't1' || st === 't2') {
    const big = st === 't2', gap = w === 1280 ? 36 : 24
    const nw = [w === 1280 ? 410 : 360, w === 1280 ? 410 : 360]; if (big) { nw[0] = w === 1280 ? 580 : 480; nw[1] = 390 }
    const tot = nw[0] + nw[1] + gap, x0 = Math.round((w - tot) / 2 + 24)
    await p.evaluate(({ x0, nw, gap, big }) => { window.__tn({ x: x0, y: 110, w: nw[0], open: 'tide', sel: big, compact: false }); window.__tn({ x: x0 + nw[0] + gap, y: 110, w: nw[1], open: 'salt', sel: false, compact: big }) }, { x0, nw, gap, big })
  } else {
    const sc = await p.evaluate(() => window.__rects('[data-node=script]'))
    const nw = w === 1280 ? 400 : 360, nx = Math.max(84, sc[0].x - nw - 190)
    await p.evaluate(({ x, y, w }) => { window.__tn({ x, y: y[0], w, open: 'tide', compact: true }); window.__tn({ x, y: y[1], w, open: 'salt', compact: true }) }, { x: nx, y: [sc[0].y - 20, sc[1].y - 20], w: nw })
    const nr = await p.evaluate(() => window.__rects('.tn-card'))
    for (const [i, s] of sc.entries()) {
      const px = nr[i].x + nr[i].w, py = nr[i].y + nr[i].h / 2
      await p.evaluate(({ x1, y1, x2, y2 }) => window.__arrow(x1, y1, x2, y2), { x1: px, y1: py, x2: s.x, y2: s.y + s.h / 2 })
      await p.evaluate(({ x, y, t }) => window.__pill(x, y, t), { x: px + 18, y: py - 11, t: 'route: ' + (i ? 'Salt of the Earth' : "Tide's In") })
    }
  }
  await p.mouse.move(640, 790); await p.waitForTimeout(500)
  await p.screenshot({ path: `${OUT}${st}-${w}.png` })
  await p.context().close()
}
await b.close()
