"""Draw the end card's pieces as transparent PNGs, one folder per version.

    uv run --no-project --with playwright==1.49.1 python production-tool/stitch/endcard/render_assets.py

Needs Chromium (CHROMIUM, default /usr/bin/chromium) and the network (Geist
from Google Fonts). Run it again when the copy, the mark or the agents change;
the PNGs are checked in and shipped in the stitch zip, so the Lambda never
needs a browser or a font.

Every piece is drawn for a frame whose short side is REF_SHORT (stitch.py),
at the sizes stitch.py lays it out at, so ffmpeg only ever scales down:
  mark.png   the studio mark (app/src/brand/StudioMark.tsx), 9.6 % of the short side
  made.png   "Made with", Geist 500, 2.6 %, line-height normal (its box, as in the examples)
  word.png   "Napkin Studio", Geist 600, 7.6 %, -0.035em; the line box (line-height 1)
             with 0.3em above and below, so the PNG's centre is the line box's centre
  fig-<agent>.png  the agent figures (app/templates/shared/agent-figures.html), 8.2 % tall
"""
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import stitch  # noqa: E402  (REF_SHORT, CREW, the sizes)

REPO = HERE.parents[2]
FIGS = (REPO / "app/templates/shared/agent-figures.html").read_text()
V = stitch.REF_SHORT / 100  # px per vmin at the reference size

THEMES = {
    "roll-up": "--ink:#14161B;--ink3:#737987;--plan:#14161B;--plan-eye:#FFFFFF;--create:#FF4F2E;--produce:#8B919E;--learn:#DADDE3;--paper:#FFFFFF;--soft:#F5F6F8",
    "roll-up-ink": "--ink:#F2F3F5;--ink3:#7A808C;--plan:#F2F3F5;--plan-eye:#0F1114;--create:#FF4F2E;--produce:#8B919E;--learn:#3A3F48;--paper:#0F1114;--soft:#1B1F25",
}

MARK_SVG = ('<svg id="mark" viewBox="0 0 22 22" style="display:block;width:{s}px;height:{s}px">'
            '<clipPath id="c"><circle cx="11" cy="11" r="11"/></clipPath>'
            '<g clip-path="url(#c)" transform="rotate(-45 11 11)">'
            '<rect x="0" y="0" width="11" height="11" fill="var(--plan)"/>'
            '<rect x="11" y="0" width="11" height="11" fill="var(--create)"/>'
            '<rect x="0" y="11" width="11" height="11" fill="var(--learn)"/>'
            '<rect x="11" y="11" width="11" height="11" fill="var(--produce)"/></g></svg>')


def html(theme: str) -> str:
    fig_h = stitch.FIG_H * stitch.REF_SHORT
    return f"""<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@500;600&display=block">
<style>
:root{{{THEMES[theme]}}}
*{{margin:0;padding:0;animation:none!important}}
html,body{{background:transparent}}
body{{font-family:Geist,sans-serif;-webkit-font-smoothing:antialiased;padding:40px}}
.piece{{display:inline-block;margin:0 40px 40px 0;vertical-align:top}}
#made{{font-weight:500;font-size:{2.6 * V}px;color:var(--ink3);white-space:nowrap}}
#word{{padding:.3em 0;font-weight:600;font-size:{7.6 * V}px;letter-spacing:-.035em;white-space:nowrap;color:var(--ink)}}
#word span{{display:block;line-height:1}}
.fig svg{{display:block;width:auto;height:{fig_h}px}}
</style></head><body>
{FIGS}
<div class="piece">{MARK_SVG.format(s=stitch.MARK * stitch.REF_SHORT)}</div>
<div class="piece" id="made">Made with</div>
<div class="piece" id="word"><span>Napkin Studio</span></div>
<div id="crew"></div>
<script>
{list(stitch.CREW)!r}.forEach(k => {{
  const d = document.createElement('div'); d.className = 'piece fig'; d.id = 'fig-' + k;
  d.innerHTML = agentFigure(k, {{decorative: true}}); document.getElementById('crew').appendChild(d);
}});
document.fonts.ready.then(() => {{ window.READY = document.fonts.check('600 20px Geist') }});
</script></body></html>"""


def main() -> None:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/usr/bin/chromium"))
        for theme in THEMES:
            out = HERE / theme
            out.mkdir(exist_ok=True)
            pg = b.new_page(viewport={"width": 2400, "height": 1600})
            pg.set_content(html(theme), wait_until="networkidle")
            pg.wait_for_function("window.READY !== undefined")
            if not pg.evaluate("window.READY"):
                raise SystemExit("Geist did not load (network?)")
            pg.locator("#mark").screenshot(path=str(out / "mark.png"), omit_background=True)
            pg.locator("#made").screenshot(path=str(out / "made.png"), omit_background=True)
            pg.locator("#word").screenshot(path=str(out / "word.png"), omit_background=True)
            for k in stitch.CREW:
                pg.locator(f"#fig-{k} svg").screenshot(path=str(out / f"fig-{k}.png"), omit_background=True)
            pg.close()
            print(out)
        b.close()


if __name__ == "__main__":
    main()
