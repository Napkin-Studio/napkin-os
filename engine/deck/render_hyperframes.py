"""Render deck.json as a HyperFrames slideshow project (a navigable deck, not a video). No model.

Writes a project directory: ``index.html`` (a ``deck`` root composition with one scene per slide,
one paused GSAP timeline, and the ``application/hyperframes-slideshow+json`` island with notes and fragment hold-points),
``hyperframes.json`` and ``package.json``. Present it with::

    npx hyperframes present <dir>        # presenter view, audience tab, editable notes

Slide markup and choreography come from render_web.slide_views, so the two web outputs agree:
the same reveal order and delays, here placed on the HyperFrames timeline (scene start + intro +
delay). Each slide gets a fragment where its last reveal has settled; with ``builds=True`` it gets
one per block, so each click shows the next block. Needs Node and network access to the GSAP CDN.
"""
from __future__ import annotations

import json
from pathlib import Path

from .render_web import CSS_LAYOUT, _e, slide_views, theme_css

INTRO = 0.35     # s before the first reveal of a slide
SETTLE = 1.3     # s for the last reveal of a step to finish (bars and counters are the longest)
HOLD = 0.6       # s of rest after a slide's final fragment
GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"
# Loaded explicitly: `present` serves the file as is, and the runtime is what reports the scenes
# (every composition under the root) that the slideshow controller resolves sceneIds against.
RUNTIME = "https://cdn.jsdelivr.net/npm/@hyperframes/core@0.8.114/dist/hyperframe.runtime.iife.js"

HF_CSS = """
html,body{width:1920px;height:1080px;overflow:hidden;background:#INK}
#deck{position:relative;width:100%;height:100%;overflow:hidden}
.scene{position:absolute;inset:0;overflow:hidden}
.scene>.clip{position:absolute;inset:0}
.w{display:inline-block}
"""

TIMELINES = r"""
(()=>{
window.__timelines=window.__timelines||{};   // present mode loads before the engine creates it
// Pick the largest type step at which each slide's body fits (same rule as deck.html), before any tween.
document.querySelectorAll('.slide').forEach(s=>{const b=s.querySelector('.body');if(!b)return;
  for(const k of [1.16,1.08,1,.93,.86,.8,.74,.68,.62]){s.style.setProperty('--s',k);if(b.scrollHeight<=b.clientHeight+2&&b.scrollWidth<=b.clientWidth+2)break;}});
const tl=gsap.timeline({paused:true});   // one timeline for the deck, absolute times
document.querySelectorAll('.scene').forEach(scene=>{
  const t0=+scene.dataset.start+INTRO;
  const slide=scene.querySelector('.slide');
  tl.fromTo(slide,{opacity:0},{opacity:1,duration:0.4,ease:'power1.out'},+scene.dataset.start);
  scene.querySelectorAll('[data-d]').forEach(el=>{const at=t0+(+el.dataset.d)/1000;
    if(el.classList.contains('w'))tl.fromTo(el,{opacity:0,y:22},{opacity:1,y:0,duration:0.6,ease:'power3.out'},at);
    else if(el.tagName==='BLOCKQUOTE')tl.fromTo(el,{opacity:0,scale:0.96},{opacity:1,scale:1,duration:0.75,ease:'power3.out'},at);
    else tl.fromTo(el,{opacity:0,y:26},{opacity:1,y:0,duration:0.75,ease:'power3.out'},at);
    const bar=el.querySelector('.track i');
    if(bar)tl.fromTo(bar,{scaleX:0},{scaleX:1,duration:1.1,ease:'power3.out'},at+0.12);
    const arrow=el.querySelector('.ft-arrow path')||(el.classList.contains('ft-arrow')&&el.querySelector('path'));
    if(arrow)tl.fromTo(arrow,{strokeDashoffset:120},{strokeDashoffset:0,duration:0.8,ease:'power2.out'},at+0.1);
    const val=el.querySelector('.val[data-v]');
    if(val){const v=parseFloat(val.dataset.v),sfx=val.dataset.sfx||'',dec=(val.dataset.v.split('.')[1]||'').length,o={n:0};
      tl.to(o,{n:v,duration:1.1,ease:'power3.out',onUpdate:()=>{val.textContent=o.n.toFixed(dec)+sfx}},at+0.12);}});});
window.__timelines.deck=tl;
})();
"""


def build(deck, inp, findings: list | None = None, builds: bool = False):
    """(scenes markup, island, total seconds): scene times, notes and fragment hold-points."""
    views = slide_views(deck, inp, findings)
    cs = lambda sec: round(sec * 100)   # times in hundredths of a second
    t, scenes, slides = 0, [], []
    for v in views:
        stops = [t + cs(INTRO + SETTLE) + round(ms / 10) for ms in v["last"]]
        frags = stops if builds else stops[-1:]
        dur = frags[-1] - t + cs(HOLD)
        cls = f'slide t-{v["type"]}{" dark" if v["dark"] else ""}'
        st, du = f"{t / 100:g}", f"{dur / 100:g}"
        scenes.append(
            f'<div class="scene" id="scene-{v["id"]}" data-composition-id="{v["id"]}" data-start="{st}" data-duration="{du}" '
            f'data-label="{v["n"]}. {_e(v["title"][:60])}" data-width="1920" data-height="1080">'
            f'<section class="clip" id="clip-{v["id"]}" data-start="0" data-duration="{du}" data-track-index="1">'   # relative to its scene
            f'<div class="{cls}" data-steps="{v["steps"]}">{v["html"]}</div></section></div>')
        slides.append({"sceneId": v["id"], "notes": v["notes"], "fragments": [f / 100 for f in frags]})
        t += dur + 1   # a hundredth of a second between slides: float sums never touch
    cut = next((i for i, v in enumerate(views) if v["type"] == "appendix"), len(views))
    island = {"slides": slides[:cut], "slideSequences": []}
    if cut < len(slides):   # the appendix is a branch, opened from the last presented slide
        island["slideSequences"] = [{"id": "appendix", "label": "Appendix", "slides": slides[cut:]}]
        slides[cut - 1]["hotspots"] = [{"id": "to-appendix", "label": "Appendix", "target": "appendix", "region": {"x": 86, "y": 90, "w": 11, "h": 7}}]
    return "\n".join(scenes), island, (t - 1) / 100


def render(deck, inp, out: Path, findings: list | None = None, builds: bool = False) -> Path:
    """Write the HyperFrames slideshow project to the directory ``out``; returns ``out``."""
    out.mkdir(parents=True, exist_ok=True)
    scenes, island, total = build(deck, inp, findings, builds)
    m = deck["meta"]
    css = theme_css(CSS_LAYOUT + HF_CSS, head="serif", body="system-ui, sans-serif")
    (out / "index.html").write_text(f"""<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<title>{_e(m["client"])}: {_e(m["project"])}</title>
<script src="{GSAP}"></script>
<script src="{RUNTIME}"></script>
<style>{css}</style></head>
<body>
<script type="application/hyperframes-slideshow+json">
{json.dumps(island, indent=1, ensure_ascii=False).replace("</", "<\\/")}
</script>
<div id="deck" data-composition-id="deck" data-start="0" data-duration="{total:g}" data-width="1920" data-height="1080">
{scenes}
</div>
<script>{TIMELINES.replace("INTRO", str(INTRO))}</script>
</body></html>
""", encoding="utf-8")
    (out / "hyperframes.json").write_text(json.dumps({
        "$schema": "https://hyperframes.heygen.com/schema/hyperframes.json",
        "registry": "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
        "paths": {"blocks": "compositions", "components": "compositions/components", "assets": "assets"},
        "authoringSkill": "slideshow"}, indent=2) + "\n")
    (out / "package.json").write_text(json.dumps({
        "name": "napkin-deck", "private": True, "type": "module",
        "scripts": {"dev": "npx --yes hyperframes@0.8.114 present .",
                    "studio": "npx --yes hyperframes@0.8.114 preview . --background",
                    "check": "npx --yes hyperframes@0.8.114 check"}}, indent=2) + "\n")
    return out
