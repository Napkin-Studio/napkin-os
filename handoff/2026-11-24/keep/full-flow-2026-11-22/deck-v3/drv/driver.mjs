// Walkthrough recorder: holds one Chromium; each stage is its own context (own video).
// POST JS bodies to http://127.0.0.1:9771/ ; helpers on G.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-prod-spinoff/app/package.json');
const { chromium } = require('@playwright/test');
const OUT = '/home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/deck-v3';
const BASE = 'http://127.0.0.1:18090';
const G = globalThis;
const ap = (f, o) => fs.appendFileSync(`${OUT}/drv/${f}`, JSON.stringify(o) + '\n');
const browser = await chromium.launch({ headless: true });
G.browser = browser;

// visible cursor + click ripple, drawn in the page so the video shows it
const CURSOR = `(() => {
  if (window.__cur) return; window.__cur = 1;
  if (window !== window.top) {
    // inside a frame: forward to the top frame's cursor, offset by our frame's place
    const off = () => { let x = 0, y = 0, w = window; try { while (w !== w.top && w.frameElement) { const r = w.frameElement.getBoundingClientRect(); x += r.left; y += r.top; w = w.parent; } } catch {} return [x, y]; };
    document.addEventListener('mousemove', e => { try { const [x, y] = off(); window.top.__curMove && window.top.__curMove(e.clientX + x, e.clientY + y); } catch {} }, true);
    document.addEventListener('mousedown', e => { try { const [x, y] = off(); window.top.__curDown && window.top.__curDown(e.clientX + x, e.clientY + y); } catch {} }, true);
    return;
  }
  const mk = () => {
    if (!document.body) return setTimeout(mk, 50);
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:none';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.3 L10 13 L16 13 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const x0 = sessionStorage.getItem('__cx'), y0 = sessionStorage.getItem('__cy');
    if (x0) { c.style.left = x0 + 'px'; c.style.top = y0 + 'px'; }
    window.__curMove = (x, y) => { c.style.left = x + 'px'; c.style.top = y + 'px'; try { sessionStorage.setItem('__cx', x); sessionStorage.setItem('__cy', y); } catch {} };
    window.__curDown = (x, y) => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;border:3px solid rgba(255,120,40,.9);background:rgba(255,120,40,.25);width:14px;height:14px;left:' + (x - 7) + 'px;top:' + (y - 7) + 'px;transition:all .45s ease-out;opacity:1';
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.width = '46px'; r.style.height = '46px'; r.style.left = (x - 23) + 'px'; r.style.top = (y - 23) + 'px'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    };
    document.addEventListener('mousemove', e => window.__curMove(e.clientX, e.clientY), true);
    document.addEventListener('mousedown', e => window.__curDown(e.clientX, e.clientY), true);
  };
  mk();
})();`;

const wire = (page) => {
  page.on('console', (m) => { if (['error'].includes(m.type())) ap('console.jsonl', { t: new Date().toISOString(), type: m.type(), text: m.text().slice(0, 1500), url: page.url() }); });
  page.on('pageerror', (e) => ap('console.jsonl', { t: new Date().toISOString(), type: 'pageerror', text: String(e).slice(0, 1500) }));
  page.on('dialog', async (d) => { ap('console.jsonl', { t: new Date().toISOString(), type: 'dialog', text: d.message() }); G.lastDialog = d.message(); try { await d.accept(); } catch {} });
  page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url())) ap('requests.jsonl', { t: new Date().toISOString(), clip: G.clip, m: r.method(), u: r.url(), body: (r.postData() || '').slice(0, 200000) }); });
  page.on('response', async (r) => {
    const u = r.url();
    if (r.status() >= 400) ap('failed.jsonl', { t: new Date().toISOString(), s: r.status(), u, m: r.request().method() });
    if (r.request().method() !== 'GET' && /\/api\//.test(u)) { let b = ''; try { b = (await r.text()).slice(0, 20000); } catch {} ap('responses.jsonl', { t: new Date().toISOString(), s: r.status(), u, body: b }); }
  });
};

G.CURSOR_SRC = CURSOR; G.wire = wire;
G.state = fs.existsSync(`${OUT}/drv/state.json`) ? `${OUT}/drv/state.json` : undefined;
// start a new recorded clip (closes the previous one so its video is written)
G.newClip = async (name, url) => {
  await G.endClip();
  const dir = `${OUT}/raw/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  G.ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, storageState: G.state });
  await G.ctx.addInitScript(CURSOR);
  G.ctx.on('page', wire);
  G.page = await G.ctx.newPage();
  G.clip = name; G.clipT0 = Date.now();
  ap('markers.jsonl', { clip: name, t: 0, at: new Date().toISOString(), label: 'clip-start' });
  if (url) await G.page.goto(url, { waitUntil: 'domcontentloaded' });
  return name;
};
G.endClip = async () => {
  if (!G.ctx) return null;
  try { await G.ctx.storageState({ path: `${OUT}/drv/state.json` }); G.state = `${OUT}/drv/state.json`; } catch {}
  const name = G.clip;
  ap('markers.jsonl', { clip: name, t: Date.now() - G.clipT0, at: new Date().toISOString(), label: 'clip-end' });
  const v = G.page && G.page.video();
  await G.ctx.close();
  G.ctx = null;
  if (v) { const p = await v.path(); fs.renameSync(p, `${OUT}/raw/${name}/${name}.webm`); }
  return name;
};
// marker: what happens at this moment of the clip (seconds from clip start)
G.mark = (label, extra = {}) => { const t = Date.now() - G.clipT0; ap('markers.jsonl', { clip: G.clip, t, at: new Date().toISOString(), label, ...extra }); return t; };
let shotN = Math.max(0, ...fs.readdirSync(`${OUT}/shots`).map(f => parseInt(f) || 0));
G.S = async (name) => { shotN += 1; const p = `${OUT}/shots/${String(shotN).padStart(3, '0')}-${name}.png`; await G.page.screenshot({ path: p }); return p; };
// move the mouse smoothly to a locator (or [x,y]) and click
G.cur = { x: 720, y: 450 };
G.moveTo = async (x, y, steps = 22) => { await G.page.mouse.move(x, y, { steps }); G.cur = { x, y }; };
G.go = async (loc, opts = {}) => {
  let x, y;
  if (Array.isArray(loc)) [x, y] = loc;
  else { await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {}); const b = await loc.boundingBox({ timeout: 8000 }); if (!b) throw new Error('no box'); x = b.x + b.width / 2 + (opts.dx || 0); y = b.y + b.height / 2 + (opts.dy || 0); }
  await G.moveTo(x, y, opts.steps || 22);
  await G.page.waitForTimeout(opts.pause ?? 250);
  if (opts.hover) return [x, y];
  if (opts.dbl) await G.page.mouse.dblclick(x, y); else await G.page.mouse.click(x, y);
  await G.page.waitForTimeout(opts.after ?? 400);
  return [x, y];
};
G.type = async (text, delay = 28) => { await G.page.keyboard.type(text, { delay }); };
G.btn = (re) => G.page.locator('button,[role=button],[role=menuitem],[role=tab],a').filter({ hasText: re }).locator('visible=true').first();
G.F = () => G.page.frames().slice(1).find(f => /\/s\/[0-9a-f]+\/document/.test(f.url())) || G.page.mainFrame();
G.fbtn = (re) => G.F().locator('button,[role=button],[role=menuitem],[role=tab],a').filter({ hasText: re }).locator('visible=true').first();
G.fbody = async (a = 0, b = 3000) => (await G.F().locator('body').innerText()).slice(a, b);
G.fbtns = async () => (await G.F().evaluate(() => [...document.querySelectorAll('button,[role=button],a,[role=menuitem],[role=tab]')].filter(b => b.offsetParent).map(b => (b.innerText || b.getAttribute('aria-label') || b.title || '').replace(/\n/g, ' ').slice(0, 60)).filter(Boolean)));
G.btns = async () => (await G.page.evaluate(() => [...document.querySelectorAll('button,[role=button],a,[role=menuitem],[role=tab]')].filter(b => b.offsetParent).map(b => (b.innerText || b.getAttribute('aria-label') || b.title || '').replace(/\n/g, ' ').slice(0, 60)).filter(Boolean)));
G.body = async (a = 0, b = 3000) => (await G.page.locator('body').innerText()).slice(a, b);
G.jobsPosted = () => { try { return fs.readFileSync(`${OUT}/drv/requests.jsonl`, 'utf8').split('\n').filter(l => /\/production\/api\/jobs"/.test(l)); } catch { return []; } };
G.lastJobs = (n = 3) => G.jobsPosted().slice(-n).map(l => { const o = JSON.parse(l); let b = {}; try { b = JSON.parse(o.body); } catch {} return { t: o.t, jobId: b.jobId, op: b.op, model: b.input && b.input.modelChoice }; });
// wait until a regex no longer matches body text (busy) - returns seconds
G.waitIdle = async (re, maxS = 600, settle = 3) => { const t0 = Date.now(); let quiet = 0; for (let i = 0; i < maxS; i++) { const t = await G.page.locator('body').innerText().catch(() => ''); if (!re.test(t)) { quiet++; if (quiet >= settle) break; } else quiet = 0; await G.page.waitForTimeout(1000); } return (Date.now() - t0) / 1000; };
G.waitFor = async (re, maxS = 600) => { const t0 = Date.now(); for (let i = 0; i < maxS; i++) { const t = await G.page.locator('body').innerText().catch(() => ''); if (re.test(t)) return (Date.now() - t0) / 1000; await G.page.waitForTimeout(1000); } return -1; };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  try {
    const fn = new AsyncFunction('page', 'G', 'BASE', 'OUT', 'fs', body);
    const r = await fn(G.page, G, BASE, OUT, fs);
    res.end(JSON.stringify(r === undefined ? null : r, null, 1));
  } catch (e) { res.statusCode = 500; res.end(String(e && e.stack || e).slice(0, 4000)); }
}).listen(19772, '127.0.0.1', () => console.log('driver on 9771'));
G.curSet = async (x, y, down) => { try { await G.page.evaluate(([x, y, d]) => { window.__curMove && window.__curMove(x, y); if (d) window.__curDown && window.__curDown(x, y); }, [x, y, !!down]); } catch {} };
G.moveTo = async (x, y, steps = 22) => {
  const x0 = G.cur.x, y0 = G.cur.y;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const xi = x0 + (x - x0) * e, yi = y0 + (y - y0) * e;
    await G.page.mouse.move(xi, yi);
    await G.curSet(xi, yi);
    await G.page.waitForTimeout(12);
  }
  G.cur = { x, y };
};
G.go = async (loc, opts = {}) => {
  let x, y;
  if (Array.isArray(loc)) [x, y] = loc;
  else { await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {}); const b = await loc.boundingBox({ timeout: 8000 }); if (!b) throw new Error('no box'); x = b.x + b.width / 2 + (opts.dx || 0); y = b.y + b.height / 2 + (opts.dy || 0); }
  await G.moveTo(x, y, opts.steps || 22);
  await G.page.waitForTimeout(opts.pause ?? 250);
  if (opts.hover) return [x, y];
  await G.curSet(x, y, true);
  if (opts.dbl) await G.page.mouse.dblclick(x, y); else await G.page.mouse.click(x, y);
  await G.page.waitForTimeout(opts.after ?? 400);
  return [x, y];
};
