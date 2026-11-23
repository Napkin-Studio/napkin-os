G.jobState = async (id) => { const r = await page.request.get(BASE + "/production/api/jobs/" + id); try { const j = await r.json(); return j.state || (j.job && j.job.state); } catch { return "?" + r.status(); } };
G.waitJobs = async (ids, maxS = 600) => { const t0 = Date.now(); const done = {}; for (let i = 0; i < maxS / 3; i++) { for (const id of ids) if (!done[id]) { const s = await G.jobState(id); if (/completed|failed|cancel/.test(s)) done[id] = { s, ms: Date.now() - t0 }; } if (Object.keys(done).length === ids.length) break; await page.waitForTimeout(3000); } return done; };
G.lastPosted = (n = 1) => G.jobsPosted().slice(-n).map(l => { const o = JSON.parse(l); const b = JSON.parse(o.body); return { t: o.t, jobId: b.jobId, op: b.op }; });
return 1;
