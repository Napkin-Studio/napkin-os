const rows = page.locator('[aria-label="Inputs to send"] > *');
const n = await rows.count();
const info = [];
for (let i = 0; i < n; i++) {
  const r = rows.nth(i);
  const img = await r.locator("img").first().getAttribute("src").catch(() => null);
  info.push([i, (await r.innerText()).replace(/\n/g, " "), img ? img.slice(-30) : null]);
}
return info;
