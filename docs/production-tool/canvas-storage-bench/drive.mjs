import { createRequire } from 'node:module';
const require = createRequire('/home/batunii/Documents/Windows/Code/worldlabs/tools/node_modules/');
const pw = require('playwright-core');
const which = process.argv[2] || 'chromium';
const cases = [
  ['top (first-party page, like /production)', 'http://localhost:8811/top.html'],
  ['web: sandboxed frame by URL (napkin-web today)', 'http://localhost:8811/host.html?mode=web'],
  ['device: srcdoc + FRAME_CSP (wasm/viewer)', 'http://localhost:8811/host.html?mode=device'],
  ['proposed: own-origin frame, allow-same-origin + allow=', 'http://localhost:8811/host.html?mode=proposed'],
  ['top + COOP/COEP', 'http://localhost:8811/top.html?coi=1'],
  ['web frame under COOP/COEP parent', 'http://localhost:8811/host.html?mode=web&coi=1'],
  ['proposed frame under COOP/COEP parent', 'http://localhost:8811/host.html?mode=proposed&coi=1'],
];
let browser;
if (which === 'chromium') browser = await pw.chromium.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
else if (which === 'firefox') browser = await pw.firefox.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/firefox-1543/firefox/firefox', headless: true });
else browser = await pw.webkit.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/webkit-2359/pw_run.sh', headless: true });
const out = {};
for (const [name, url] of cases) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, acceptDownloads: true });
  if (which === 'chromium') await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8811' }).catch(() => {});
  const page = await ctx.newPage();
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.type()); d.dismiss(); });
  const downloads = []; page.on('download', d => downloads.push(d.suggestedFilename()));
  const cons = []; page.on('console', m => { if (m.type() === 'error') cons.push(m.text().slice(0, 200)); });
  await page.goto(url);
  await page.waitForFunction(() => window.__result, null, { timeout: 60000 }).catch(e => null);
  const res = await page.evaluate(() => window.__result);
  // gesture + pointer tests, on the frame (or page)
  const frame = url.includes('host.html') ? page.frames().find(f => f !== page.mainFrame()) : page.mainFrame();
  let G = null;
  try {
    await page.mouse.click(70, 30);
    // pen-like drag that starts in the pad (200..500, 100..300) and leaves the frame (640x420)
    await page.mouse.move(300, 200); await page.mouse.down();
    for (let i = 1; i <= 40; i++) await page.mouse.move(300 + i * 15, 200 + i * 8);
    await page.mouse.up();
    await page.waitForTimeout(800);
    G = await frame.evaluate(() => window.__gesture);
  } catch (e) { G = 'error ' + e.message; }
  out[name] = { ...(res ? res.results : { error: 'no result' }), gesture: G, dialogs, downloads, console_errors: cons.slice(0, 6) };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
