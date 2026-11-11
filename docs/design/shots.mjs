import { chromium } from '/Users/saieeshwar/Projects/Work/work/napkin/napkin-discovery/app/node_modules/@playwright/test/index.mjs';
import { readdirSync } from 'node:fs';
const dir = '/Users/saieeshwar/Projects/Work/work/napkin/napkin-discovery/docs/design';
const pages = readdirSync(dir).filter(f => f.endsWith('.html'));
let bad = 0;
const b = await chromium.launch({ channel: 'chrome' });
for (const w of [390, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  for (const f of pages) {
    await p.goto('file://' + dir + '/' + f);
    const m = await p.evaluate(() => {
      const sizes = new Set(); let small = 0;
      for (const el of document.querySelectorAll('body *')) {
        if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
        const cs = getComputedStyle(el); sizes.add(cs.fontSize);
      }
      for (const el of document.querySelectorAll('a.btn, button, a.door, .chip, .more a, .others a, a.mark, .tile .n, .day a, .index a')) {
        const r = el.getBoundingClientRect(); if (r.height < 44) small++;
      }
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
               sizes: [...sizes].sort(), primaries: document.querySelectorAll('.btn.primary, .btn.dashed').length, small };
    });
    await p.screenshot({ path: `${dir}/shots/${f.replace('.html','')}-${w}.png`, fullPage: true });
    if (m.overflow > 0 || m.small > 0 || m.primaries > 1 || m.sizes.some(x => !['12px','13px','21px','34px','55px'].includes(x))) bad++;
    console.log(w, f.padEnd(34), 'overflow', m.overflow, 'primary', m.primaries, 'under44', m.small, 'sizes', m.sizes.join(' '));
  }
  await ctx.close();
}
await b.close();
if (bad) { console.error('FAILED', bad); process.exit(1); }
