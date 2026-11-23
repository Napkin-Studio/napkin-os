// wait until no "Making it" / "drawing" / "waiting" progress texts; record landed time from G.t0
const re = /Almost there|· 0:\d|Making it|is drawing|waiting to start|Sending…|planning the shots|Extending|Uploading/;
let last = '';
for (let i = 0; i < 300; i++) {
  const t = await page.locator('body').innerText();
  if (!re.test(t)) { G.landedMs = Date.now() - G.t0; await page.waitForTimeout(1500); await S((G.fireTag || 'job') + '-landed'); return { landedMs: G.landedMs, text: t.slice(0, 900) }; }
  last = t; await page.waitForTimeout(1000);
}
return { timeout: true, last: last.slice(0, 900) };
