const p = G.page;
return await p.evaluate(() => {
  const out = [];
  document.querySelectorAll("[class*=clip], [class*=tl-]").forEach(e => { const r = e.getBoundingClientRect(); const t = (e.getAttribute("title") || e.getAttribute("aria-label") || "").slice(0, 120); if (t && r.width > 10 && r.y > 600) out.push({ x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y), t }); });
  return out;
});
