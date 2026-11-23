import { chromium } from 'playwright'
import fs from 'node:fs'
export const OUT = new URL('../shots/', import.meta.url).pathname
export const SIZES = [[1280, 800], [1024, 768]]
export const browser = () => chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
export const read = (p) => fs.readFileSync(new URL('../repo/app/templates/' + p, import.meta.url), 'utf8')
export async function openPage(b, w, h, html, init) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage()
  p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0, 200)))
  await p.addInitScript(init)
  await p.route('**/*', r => { const u = r.request().url(); if (u.startsWith('http://page.local/')) return r.fulfill({ contentType: 'text/html', body: html }); return r.abort() })
  await p.goto('http://page.local/index.html'); await p.waitForTimeout(1200)
  return p
}
export const CLANS = [
  { id: 'bc_orig', name: 'Original', v: 3, def: true, note: 'The core look. Updated 12 Nov.' },
  { id: 'bc_zero', name: 'Zero', v: 2, note: 'Zero Sugar: silver and mint.' },
  { id: 'bc_s26', name: 'Summer 26', v: 1, note: 'Experiment: coral and sky.' },
]
// Shared mock styling: uses the page's own variables where they exist.
export const BC_CSS = `
.bc-card{background:#fff;border:1px solid #d9d4cc;border-radius:12px;padding:12px 14px;font:13px/1.4 system-ui,sans-serif;color:#1d1c1a;box-shadow:0 6px 22px #0002}
.bc-card b{font-weight:600}.bc-card small{color:#6b655c}
.bc-btn{font:600 12px system-ui;border:1px solid #cfc9bf;background:#fff;border-radius:999px;padding:6px 12px;cursor:pointer;color:#1d1c1a}
.bc-btn.pri{background:#5b5bf7;border-color:#5b5bf7;color:#fff}
.bc-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.bc-sw{display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:4px;border:1px solid #0002}
.bc-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #cfc9bf;background:#fff;border-radius:999px;padding:4px 10px;font:600 12px system-ui;color:#1d1c1a;cursor:pointer}
.bc-pop{position:absolute;z-index:50;min-width:250px}
.bc-pop .it{display:flex;gap:8px;align-items:flex-start;padding:8px 6px;border-radius:8px}
.bc-pop .it:hover{background:#f3f1ec}
.bc-pop .it .ck{width:16px;color:#5b5bf7;font-weight:700}
.bc-dot{width:7px;height:7px;border-radius:50%;background:#2f9b6e;display:inline-block;margin-right:6px}
@keyframes bcs{to{transform:rotate(360deg)}}
.bc-spin{display:inline-block;width:11px;height:11px;border:2px solid #cfc9bf;border-top-color:#5b5bf7;border-radius:50%;animation:bcs 1s linear infinite;vertical-align:-1px;margin-right:6px}
`
