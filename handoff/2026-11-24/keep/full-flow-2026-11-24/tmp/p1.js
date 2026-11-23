const txt = fs.readFileSync(OUT + '/bad-brief-ferncliff.md', 'utf8');
const ta = G.F().locator('textarea').first();
await G.go(ta);
await ta.fill(txt);
await G.page.waitForTimeout(500);
await G.S('brief-pasted');
return [await G.fbody(0,300)];
