# Phase 32 (2026-11-09): no Format switch (Screen = PDF, no phone); Layout (Frame + Headings) takes its place; More goes.
_a = s.index('          <div>\n            <h4>Format</h4>\n            <div class="seg-row" id="b-view-seg">')
_b = s.index('          </div>', s.index('id="b-view-seg"', _a)) 
_b = s.index('          </div>', _b + 1) + len('          </div>')
s = s[:_a] + '''          <div class="lay-row">
            <h4>Layout</h4>
            <div class="lay-2">
              <div><small>Frame</small><div class="seg-row" id="b-frame-seg"><button type="button" data-frame="open" aria-pressed="true">Open</button><button type="button" data-frame="boxed" aria-pressed="false">Boxed</button></div></div>
              <div><small>Headings</small><div class="seg-row" id="b-heads-seg"><button type="button" data-heads="label" aria-pressed="true">Label</button><button type="button" data-heads="tab" aria-pressed="false">Tab</button></div></div>
            </div>
            <div hidden><div class="seg-row" id="b-view-seg"><button type="button" data-view="screen" aria-pressed="true">Screen</button><button type="button" data-view="pdf" aria-pressed="false">PDF</button><button type="button" data-view="phone" aria-pressed="false">Phone</button></div></div>
          </div>''' + s[_b:]
_a = s.index('          <details class="side-more">')
_b = s.index('          </details>', _a) + len('          </details>')
s = s[:_a] + '          <button type="button" class="side-link reset-look" id="b-reset-layout">Reset look</button>' + s[_b:]
rep('\n</style>', r"""
.lay-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.lay-2 small { display: block; font: 600 10.5px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 5px; }
.lay-2 .seg-row button { padding-left: 4px; padding-right: 4px; }
.reset-look { font-size: 12px !important; color: var(--muted) !important; justify-self: start; }
/* page-break guides always (screen is the printed page) */
#brief-screen-output .brief-page:not(.phone) { background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--a4w) * 1.4142 - 1px), rgba(201,70,42,.28) calc(var(--a4w) * 1.4142 - 1px), rgba(201,70,42,.28) calc(var(--a4w) * 1.4142)) !important; }
</style>""", 1)
