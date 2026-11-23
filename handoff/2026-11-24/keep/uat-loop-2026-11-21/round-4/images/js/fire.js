// G.fireName = button name; returns jobId(s) from POST responses
const t0 = Date.now();
const jobs = [];
const h = async (r) => { if (r.request().method() === 'POST' && /\/api\/jobs/.test(r.url())) { try { const b = await r.json(); jobs.push({ t: Date.now() - t0, s: r.status(), id: b.jobId || b.id || (b.job && b.job.jobId), body: JSON.stringify(b).slice(0, 400) }); } catch { jobs.push({ t: Date.now() - t0, s: r.status() }); } } };
page.on('response', h);
G.t0 = t0; G.clickAt = new Date().toISOString();
await G.fireLoc.click();
for (let i = 0; i < 120 && !jobs.length; i++) await page.waitForTimeout(500);
await page.waitForTimeout(1500);
page.off('response', h);
await S((G.fireTag || 'fire') + '-after');
return { clickAt: G.clickAt, jobs, text: (await page.locator('body').innerText()).slice(0, 600) };
