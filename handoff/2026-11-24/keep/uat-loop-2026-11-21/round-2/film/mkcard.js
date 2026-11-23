// G.cardIdx: which box card's Make/Make new take (by box order, left->right, top->bottom)
G.clickMake = async (p) => {
  await p.locator("button:visible", { hasText: /^Make$/ }).first().click();
  await p.waitForTimeout(1500);
  const b = p.locator("button:visible", { hasText: /^(Make|Make new take)$/ });
  const all = await b.evaluateAll(els => els.map((e, k) => { const r = e.getBoundingClientRect(); let c = e; for (let i = 0; i < 8 && c && !/Box \d|Separate vid|One video/.test(c.innerText.slice(0, 40)); i++) c = c.parentElement; return { k, x: r.x, y: r.y, head: c ? c.innerText.slice(0, 60).replace(/\n/g, " | ") : "" }; }));
  const cards = all.filter(a => a.x < 1060 && a.y > 120).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  G.cards = cards;
  const pick = cards.find(c => c.head.includes(G.cardText));
  if (!pick) throw new Error("no card " + G.cardText + " " + JSON.stringify(cards));
  await b.nth(pick.k).scrollIntoViewIfNeeded();
  await b.nth(pick.k).click();
};
return 1;
