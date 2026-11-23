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
return 1;
