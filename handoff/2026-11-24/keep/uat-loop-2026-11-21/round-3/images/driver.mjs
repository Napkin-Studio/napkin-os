// UAT round 3 images driver: holds one headless Chromium page; POST JS to /eval.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-pt-uat/app/package.json');
const { chromium } = require('@playwright/test');
const OUT = '/home/batunii/Documents/napkin-local-keep/uat-loop-2026-11-21/round-3/images';
const BASE = 'http://napkin-uat-web-126391466.eu-west-1.elb.amazonaws.com';
const ap = (f, o) => fs.appendFileSync(`${OUT}/${f}`, JSON.stringify(o) + '\n');
let n = 0;
for (const f of fs.readdirSync(`${OUT}/shots`)) { const m = /^(\d+)-/.exec(f); if (m) n = Math.max(n, +m[1]); }
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const wire = (page) => {
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) ap('browser-log.jsonl', { t: new Date().toISOString(), type: m.type(), text: m.text().slice(0, 2000), url: page.url() }); });
  page.on('pageerror', (e) => ap('browser-log.jsonl', { t: new Date().toISOString(), type: 'pageerror', text: String(e).slice(0, 2000) }));
  page.on('dialog', async (d) => { ap('browser-log.jsonl', { t: new Date().toISOString(), type: 'dialog', text: d.message() }); globalThis.lastDialog = d.message(); try { await d.accept(); } catch {} });
  page.on('request', (r) => { if (r.method() !== 'GET') ap('requests.jsonl', { t: new Date().toISOString(), m: r.method(), u: r.url(), body: (r.postData() || '').slice(0, 200000) }); });
  page.on('response', async (r) => {
    const u = r.url();
    if (r.status() >= 400) ap('failed.jsonl', { t: new Date().toISOString(), s: r.status(), u, m: r.request().method() });
    if (r.request().method() !== 'GET' && /\/api\//.test(u)) { let b = ''; try { b = (await r.text()).slice(0, 20000); } catch {} ap('responses.jsonl', { t: new Date().toISOString(), s: r.status(), u, body: b }); }
  });
};
ctx.on('page', wire);
let page = await ctx.newPage();
globalThis.page = page;
const S = async (name, opts = {}) => { n += 1; const p = `${OUT}/shots/${String(n).padStart(3, '0')}-${name}.png`; await (opts.page || globalThis.page).screenshot({ path: p, fullPage: false, ...opts }); return p; };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  try {
    const fn = new AsyncFunction('page', 'ctx', 'S', 'BASE', 'OUT', 'fs', 'G', body);
    const r = await fn(globalThis.page, ctx, S, BASE, OUT, fs, globalThis);
    res.end(JSON.stringify(r === undefined ? null : r, null, 1));
  } catch (e) { res.statusCode = 500; res.end(String(e && e.stack || e).slice(0, 4000)); }
}).listen(9347, '127.0.0.1', () => console.log('driver on 9347'));
