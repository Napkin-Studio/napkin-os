G.click = async (re, opts = {}) => {
  const rx = typeof re === 'string' ? new RegExp('^' + re.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : re;
  const loc = page.locator(opts.sel || 'button,[role=button],[role=menuitem],[role=tab],a,label');
  const n = await loc.count();
  const hits = [];
  for (let i = 0; i < n; i++) { const el = loc.nth(i); if (!(await el.isVisible().catch(() => false))) continue; const t = ((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label')) || (await el.getAttribute('title')) || '').replace(/\s+/g, ' ').trim(); if (rx.test(t)) hits.push({ el, t }); }
  if (!hits.length) throw new Error('no visible match for ' + rx);
  const h = hits[opts.last ? hits.length - 1 : (opts.nth || 0)];
  await h.el.click({ timeout: 5000 });
  return h.t;
};
return 1;
