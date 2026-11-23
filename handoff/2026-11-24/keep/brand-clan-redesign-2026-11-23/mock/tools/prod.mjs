import { browser, OUT, BC_CSS, CLANS } from './lib.mjs'
import { seed } from './psetup.mjs'
const PAL = { Original: ['#0B5D8A', '#E9F3F8', '#102A3A', '#F2B134'], Zero: ['#9AA7B1', '#7FD6BD', '#1C2630', '#F4F6F7'], 'Summer 26': ['#FF7A62', '#8FD0F0', '#2A2340', '#FFF3E8'] }
const NODE_JS = `
window.__bcNode = (o) => {
  const pal = o.pal, n = document.createElement('div'); n.className = 'bcn'; n.style.cssText = 'left:'+o.x+'px;top:'+o.y+'px'
  n.innerHTML = '<div class="bcn-tab">BRAND CLAN</div><div class="bcn-card">'
   + '<div class="bcn-h"><button class="bcn-pick" type="button"><b>Tidewell · '+o.name+'</b> ▾</button><span class="bcn-v">v'+o.v+'</span></div>'
   + '<div class="bcn-logo"><svg viewBox="0 0 200 64" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><rect width="200" height="64" fill="'+(o.dark?pal[2]:"#fff")+'"/><circle cx="62" cy="32" r="15" fill="'+pal[0]+'"/><path d="M52 33 q5 -7 10 0 t10 0" stroke="'+(o.dark?pal[2]:"#fff")+'" stroke-width="3" fill="none" stroke-linecap="round"/><text x="86" y="39" font-family="Georgia,serif" font-weight="700" font-size="20" fill="'+(o.dark?"#fff":pal[2])+'">Tidewell</text></svg></div>'
   + '<div class="bcn-sw">'+pal.map(c=>'<i style="background:'+c+'"></i>').join('')+'</div>'
   + '<div class="bcn-ty"><span style="font:700 17px Georgia,serif">Aa</span> <small>Tidewell Serif · Sans</small></div>'
   + '<div class="bcn-f">'+(o.link?'<span class="bcn-on">Linked to '+o.link+'</span>':'<span>Not linked · jobs do not use it yet</span>')+'</div></div><i class="bcn-port"></i>'
  document.body.appendChild(n); return n
}
const st = document.createElement('style'); st.textContent = \`
.devswitch{display:none!important}
.bcn{position:fixed;width:222px;z-index:30;font:12px/1.35 var(--font-ui,system-ui);color:#1d1c1a}
.bcn-tab{display:inline-block;margin-left:2px;padding:2px 9px;font:700 9.5px var(--font-mono,monospace);letter-spacing:.08em;background:#dfe6ef;color:#2c3b52;border:1px solid #b8c4d4;border-bottom:0;border-radius:6px 6px 0 0}
.bcn-card{background:#fbfaf6;border:1px solid #b8c4d4;border-radius:0 8px 8px 8px;padding:9px 10px;box-shadow:0 2px 8px #0002}
.bcn-h{display:flex;justify-content:space-between;align-items:center;gap:6px}
.bcn-pick{border:1px solid #cfc9bf;background:#fff;border-radius:999px;padding:3px 9px;font:600 12px system-ui;cursor:pointer}
.bcn-v{font:600 10.5px var(--font-mono,monospace);color:#6b655c}
.bcn-logo{height:52px;border:1px solid #e1dbd0;border-radius:6px;overflow:hidden;margin:8px 0}
.bcn-sw{display:flex;gap:5px}.bcn-sw i{flex:1;height:22px;border-radius:5px;border:1px solid #0002}
.bcn-ty{margin-top:7px;display:flex;gap:8px;align-items:baseline}.bcn-ty small{color:#6b655c}
.bcn-f{margin-top:8px;padding-top:7px;border-top:1px solid #e6e1d8;font-size:11px;color:#8a6a1f}.bcn-on{color:#1d7a4f}
.bcn-port{position:absolute;left:100%;top:60%;width:9px;height:9px;margin-left:-3px;border-radius:50%;background:#fff;border:1.5px solid #8a93a3}
.bcn.sel .bcn-card{outline:2px solid #5b5bf7}
.bcn-note{position:fixed;z-index:31;font:11px system-ui;color:#6b655c}
\`; document.head.appendChild(st)
window.__arrow = (x1,y1,x2,y2,label,dash) => {
  let s = document.getElementById('bcarrows'); if (!s) { s = document.createElementNS('http://www.w3.org/2000/svg','svg'); s.id='bcarrows'; s.setAttribute('style','position:fixed;inset:0;width:100vw;height:100vh;z-index:29;pointer-events:none'); s.innerHTML='<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8z" fill="#8a93a3"/></marker></defs>'; document.body.appendChild(s) }
  const p = document.createElementNS('http://www.w3.org/2000/svg','path'); const mx=(x1+x2)/2
  p.setAttribute('d','M'+x1+' '+y1+' C'+mx+' '+y1+' '+mx+' '+y2+' '+x2+' '+y2); p.setAttribute('stroke','#8a93a3'); p.setAttribute('fill','none'); p.setAttribute('stroke-width','1.6'); p.setAttribute('marker-end','url(#ah)'); if (dash) p.setAttribute('stroke-dasharray','5 4'); s.appendChild(p)
  if (label) { const t = document.createElement('div'); t.className='bcn-note'; t.style.cssText='left:'+(mx-26)+'px;top:'+((y1+y2)/2-8)+'px;background:#fff;border:1px solid #d9d4cc;border-radius:999px;padding:1px 8px'; t.textContent=label; document.body.appendChild(t) }
}
window.__rect = (sel, i=0) => { const e = document.querySelectorAll(sel)[i]; const r = e.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height } }
`
const b = await browser()
const only = process.argv[2]?.split(',')
for (const [w,h] of [[1280,800],[1024,768]]) for (const st of ['d1','d2','d3']) {
  if (only && !only.includes(st)) continue
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage()
  p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,200)))
  await seed(p); await p.waitForTimeout(2500)
  if (st === 'd3') {
    await p.evaluate(async () => {
      const env = window.__canvasEnv
      const { createNode, linkInput } = await import('/src/canvas/nodes/nodes.ts')
      const { bringIntoView } = await import('/src/canvas/boards/boards.ts')
      const kindOf = (e) => e.customData?.kind
      env.canvas.transact((els) => els.filter((e) => !e.isDeleted && kindOf(e) !== 'brief' && e.type !== 'image' && !(e.customData?.kind === 'ref')), { undoable: false })
      const by = (k) => env.canvas.elements().find((x) => !x.isDeleted && kindOf(x) === k)
      const S = by('script'), A = by('storyboard'), F = by('video')
      const sx = S.x, sy = S.y + S.height + 60
      const GAP = 90, y1 = S.y - 20, y2 = y1 + A.height + 330
      const mv = (id, x, y) => env.canvas.transact((els) => els.map((e) => (e.id === id ? { ...e, x, y } : e)), { undoable: false })
      mv(S.id, sx, (y1 + y2) / 2 - S.height / 2 + A.height / 2)
      mv(A.id, sx + S.width + GAP, y1); mv(F.id, sx + S.width + GAP * 2 + A.width, y1)
      const B = await createNode(env, 'storyboard', { x: sx + S.width + GAP + A.width / 2, y: y2 + A.height / 2 })
      const FB = await createNode(env, 'video', { x: sx + S.width + GAP * 2 + A.width + F.width / 2, y: y2 + F.height / 2 })
      mv(B.id, sx + S.width + GAP, y2); mv(FB.id, sx + S.width + GAP * 2 + A.width, y2)
      const d = () => env.doc.get()
      const sid = (e) => e.customData.id
      await linkInput(env.doc, d(), { kind: 'script', id: sid(S) }, { kind: 'storyboard', id: sid(B) })
      await linkInput(env.doc, d(), { kind: 'storyboard', id: sid(B) }, { kind: 'video', id: sid(FB) })
      env.canvas.select([])
      window.__ext = { minX: sx - 560, maxX: sx + S.width + GAP * 2 + A.width + F.width + 20, minY: y1 - 40, maxY: y2 + A.height + 520 }
      bringIntoView(env.canvas, window.__ext, 20, false)
    })
    await p.waitForTimeout(2500)
  }
  await p.evaluate(NODE_JS);
  if (st === 'd1' || st === 'd2') {
    const r = await p.evaluate(() => window.__rect('[data-node=script]'))
    const bx = w === 1280 ? 770 : 700, by = 72
    const n = await p.evaluate(({bx,by,pal}) => { const n = window.__bcNode({x:bx,y:by,name:'Zero',v:2,pal}); return null }, { bx, by, pal: PAL.Zero })
    if (st === 'd1') await p.evaluate(({bx,by,w}) => { const h = document.createElement('div'); h.className='bcn-card'; h.style.cssText='position:fixed;z-index:31;left:'+bx+'px;top:'+(by + 222)+'px;width:222px;border-radius:8px;font:12px/1.4 system-ui;color:#1d1c1a'; h.innerHTML='<b>Placed for you, not linked.</b><br><span style="color:#6b655c">Link it to the <b>Script</b> to use it for everything made from it, or to one <b>Storyboard</b> or <b>Film</b> to try a look there.</span>'; document.body.appendChild(h) }, { bx, by, w })
    if (st === 'd2') {
      await p.evaluate(() => { document.querySelector('.bcn .bcn-pick').closest('.bcn').classList.add('sel')
        const pop = document.createElement('div'); const r = document.querySelector('.bcn-pick').getBoundingClientRect()
        pop.style.cssText='position:fixed;z-index:40;left:'+(r.x + (innerWidth < 1100 ? -258 : 232))+'px;top:'+(r.y-2)+'px;width:250px;background:#fff;border:1px solid #d9d4cc;border-radius:12px;padding:8px 10px;font:12px system-ui;box-shadow:0 6px 22px #0003'
        const rows=[['Original','v3 · default',0],['Zero','v2',1],['Summer 26','v1 · experiment',0]]
        pop.innerHTML='<div style="color:#6b655c;padding:2px 4px 4px">Brand Clan for this project</div>'+rows.map(x=>'<div style="display:flex;gap:8px;padding:6px 4px;border-radius:8px"><span style="width:14px;color:#5b5bf7;font-weight:700">'+(x[2]?'✓':'')+'</span><span><b>'+x[0]+'</b> <span style="color:#6b655c">'+x[1]+'</span></span></div>').join('')+'<div style="border-top:1px solid #e6e1d8;margin-top:4px;padding:7px 4px 2px;color:#6b655c">Add a second Brand Clan to compare looks side by side.</div>'
        document.body.appendChild(pop) })
    }
  }
  if (st === 'd3') {
    const PALS = [{ sky: ['#E9F3F8', '#9CC7DE'], hill: '#0B5D8A', can: '#102A3A', pal: PAL.Original, name: 'Original', v: 3 }, { sky: ['#FFF3E8', '#8FD0F0'], hill: '#FF7A62', can: '#2A2340', pal: PAL['Summer 26'], name: 'Summer 26', v: 1 }]
    await p.evaluate(({ PALS }) => {
      const rects = (sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }).sort((a, b) => a.y - b.y)
      const tile = (P, i, w, h) => '<svg viewBox="0 0 160 90" width="' + w + '" height="' + h + '" style="display:block;border-radius:3px"><defs><linearGradient id="g' + P.name[0] + i + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + P.sky[0] + '"/><stop offset="1" stop-color="' + P.sky[1] + '"/></linearGradient></defs><rect width="160" height="90" fill="url(#g' + P.name[0] + i + ')"/><path d="M0 62 Q40 38 80 58 T160 50 V90 H0Z" fill="' + P.hill + '" opacity=".85"/><circle cx="' + (30 + i * 28) + '" cy="22" r="9" fill="' + P.pal[3] + '"/><rect x="' + (50 + i * 22) + '" y="34" width="26" height="42" rx="5" fill="' + P.can + '"/><circle cx="' + (63 + i * 22) + '" cy="52" r="7" fill="' + P.pal[0] + '"/></svg>'
      const cover = (r, P, n, k, label) => {
        const d = document.createElement('div'); d.style.cssText = 'position:fixed;z-index:25;left:' + (r.x + 8 * k) + 'px;top:' + (r.y + 32 * k) + 'px;display:flex;gap:' + 4 * k + 'px;background:#fbfaf6;padding:2px;border-radius:4px'
        for (let i = 0; i < n; i++) { const c = document.createElement('div'); c.innerHTML = tile(P, i, 80 * k, 45 * k) + '<div style="font:' + 7.5 * k + 'px monospace;color:#6b655c;margin-top:2px">' + (i + 1) + ' · ' + ['Wide', 'Medium', 'Close', 'Medium'][i] + '</div>'; d.appendChild(c) }
        document.body.appendChild(d)
      }
      const sbs = rects('[data-node=storyboard]'), vids = rects('[data-node=video]')
      sbs.forEach((r, j) => { const k = r.w / 518; const P = PALS[j]; const blank = document.createElement('div'); blank.style.cssText = 'position:fixed;z-index:24;background:#fbfaf6;left:' + (r.x + 2) + 'px;top:' + (r.y + 28 * k) + 'px;width:' + (r.w - 4) + 'px;height:' + (r.h - 56 * k) + 'px'; document.body.appendChild(blank); cover(r, P, 4, k) })
      vids.forEach((r, j) => { const k = r.w / 260; const P = PALS[j]; const bl = document.createElement('div'); bl.style.cssText = 'position:fixed;z-index:24;background:#fbfaf6;left:' + (r.x + 2) + 'px;top:' + (r.y + 28 * k) + 'px;width:' + (r.w - 4) + 'px;height:' + (r.h - 56 * k) + 'px'; document.body.appendChild(bl); const d = document.createElement('div'); d.style.cssText = 'position:fixed;z-index:25;left:' + (r.x + 6 * k) + 'px;top:' + (r.y + 32 * k) + 'px;background:#fbfaf6;padding:2px'; d.innerHTML = tile(P, 1, 96 * k, 54 * k); document.body.appendChild(d) })
    }, { PALS })
        const R = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }).sort((a, b) => a.y - b.y), sel)
    const sbs = await R('[data-node=storyboard]'), vids = await R('[data-node=video]'), sc = (await R('[data-node=script]'))[0]
    const pill = (r, text, c) => p.evaluate(({ r, text, c }) => { const d = document.createElement('div'); d.className = 'bcn-note'; d.style.cssText = 'position:fixed;z-index:32;left:' + r.x + 'px;top:' + (r.y - 22) + 'px;background:#fff;border:1px solid ' + c + ';color:#1d1c1a;border-radius:999px;padding:1px 9px;font:600 11px system-ui'; d.innerHTML = text; document.body.appendChild(d) }, { r, text, c })
    // Original on the Script: carries down to Storyboard A and Film A
    await p.evaluate(({ x, y, P }) => window.__bcNode({ x, y, name: P.name, v: P.v, pal: P.pal, link: 'the Script' }), { x: Math.max(70, sc.x - 262), y: sc.y + sc.h / 2 - 100, P: PALS[0] })
    await p.evaluate(({ x1, y1, x2, y2 }) => window.__arrow(x1, y1, x2, y2, ''), { x1: Math.max(70, sc.x - 262) + 222, y1: sc.y + sc.h / 2, x2: sc.x, y2: sc.y + sc.h / 2 })
    // Summer 26 on Storyboard B only
    const rb = sbs[1], bx = rb.x + (rb.w - 222) / 2, byy = rb.y + rb.h + 40
    await p.evaluate(({ bx, byy, P }) => window.__bcNode({ x: bx, y: byy, name: P.name, v: P.v, pal: P.pal, link: 'Storyboard B' }), { bx, byy, P: PALS[1] })
    await p.evaluate(({ x, y1, y2 }) => window.__arrow(x, y1, x, y2, ''), { x: bx + 111, y1: byy - 4, y2: rb.y + rb.h })
    await pill({ x: sbs[0].x + sbs[0].w - 200, y: sbs[0].y + sbs[0].h - 2, w: 0, h: 0 }, 'Original · from the Script', '#b8c4d4')
    await pill({ x: sbs[1].x + sbs[1].w - 200, y: sbs[1].y + sbs[1].h - 2, w: 0, h: 0 }, 'Summer 26 · linked here', '#ff7a62')
    await pill({ x: vids[0].x + 6, y: vids[0].y + vids[0].h + 28, w: 0, h: 0 }, 'Original', '#b8c4d4')
    await pill({ x: vids[1].x + 6, y: vids[1].y + vids[1].h + 28, w: 0, h: 0 }, 'Summer 26', '#ff7a62')
  }
  await p.mouse.move(640, 790); await p.waitForTimeout(500)
  await p.screenshot({ path: `${OUT}${st}-${w}.png` })
  await p.context().close()
}
await b.close()
