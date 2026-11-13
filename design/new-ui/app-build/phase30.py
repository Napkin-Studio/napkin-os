# Phase 30 (2026-11-09): Brief gets the same wide workspace as Research; the sheet breathes.
rep('\n</style>', r"""
#brief-screen-output { --bw: min(1440px, calc(100vw - 48px)); width: var(--bw); margin-left: calc((100% - var(--bw)) / 2); }
#brief-screen-output .brief-workspace { grid-template-columns: minmax(0, 1fr) 380px; gap: 32px; }
#brief-screen-output .brief-page { max-width: 1040px; }
#brief-screen-output .brief-page.pdf { max-width: 760px; }
#brief-screen-output .brief-page.phone { max-width: 400px; }
#brief-screen-output .b-cover { padding: 44px 60px 30px; }
#brief-screen-output .b-grid { padding: 14px 60px 40px; column-gap: 32px; }
#brief-screen-output .gi { padding: 20px 10px 18px; }
#brief-screen-output .b-foot { padding: 18px 60px; }
#brief-screen-output .bm-wrap { display: flex; flex-direction: column; align-items: center; }
#brief-screen-output .bm-wrap .bm-tab { left: max(24px, calc((100% - 1040px) / 2 + 24px)); }
@media (max-width: 1100px) { #brief-screen-output { width: auto; margin-left: 0; } #brief-screen-output .brief-workspace { grid-template-columns: minmax(0, 1fr) 320px; } #brief-screen-output .b-cover, #brief-screen-output .b-grid, #brief-screen-output .b-foot { padding-left: 40px; padding-right: 40px; } }
</style>""", 1)
rep('\n</style>', r"""
#brief-screen-output .brief-page.boxed .b-grid { column-gap: 0; padding: 0; margin: 8px 60px 36px; border: 1px solid color-mix(in srgb, var(--b-text) 70%, transparent); }
#brief-screen-output .brief-page.boxed .gi { outline: 0; border-radius: 0; border-top: 0; box-shadow: inset -1px -1px 0 color-mix(in srgb, var(--b-text) 70%, transparent); padding: 18px 20px; }
#brief-screen-output .brief-page.boxed .gi.sel { box-shadow: inset -1px -1px 0 color-mix(in srgb, var(--b-text) 70%, transparent), inset 0 0 0 2px color-mix(in srgb, var(--b-accent) 50%, transparent); }
@media (max-width: 1100px) { #brief-screen-output .brief-page.boxed .b-grid { margin-left: 40px; margin-right: 40px; } }
</style>""", 1)
rep('\n</style>', r"""
/* the tab sits on the sheet whatever its width */
#brief-screen-output .bm-wrap { width: 100%; max-width: 1040px; margin: 0 auto; align-items: stretch; }
#brief-screen-output .bm-wrap:has(.brief-page.pdf) { max-width: 760px; }
#brief-screen-output .bm-wrap:has(.brief-page.phone) { max-width: 400px; }
#brief-screen-output .bm-wrap .bm-tab { left: 24px !important; }
/* phone: phone-sized margins, one column, stacked meta */
#brief-screen-output .brief-page.phone .b-cover { padding: 28px 22px 20px; }
#brief-screen-output .brief-page.phone .b-grid { padding: 8px 22px 24px; column-gap: 0; }
#brief-screen-output .brief-page.phone.boxed .b-grid { margin: 8px 16px 24px; padding: 0; }
#brief-screen-output .brief-page.phone .gi { padding: 16px 6px 14px; grid-column: span 12 !important; }
#brief-screen-output .brief-page.phone.boxed .gi { padding: 14px 14px; }
#brief-screen-output .brief-page.phone .b-foot { padding: 14px 22px; }
#brief-screen-output .brief-page.phone .eyebrow-row { flex-direction: column; align-items: flex-start; gap: 4px; }
#brief-screen-output .brief-page.phone .b-cover h2 { font-size: 30px; }
#brief-screen-output .brief-page.phone .lay-statement .stmt { font-size: 23px; }
#brief-screen-output .brief-page.phone .b-ident { flex-wrap: wrap; }
#brief-screen-output .brief-page.pdf .b-cover { padding: 38px 44px 26px; }
#brief-screen-output .brief-page.pdf .b-grid { padding: 8px 44px 32px; column-gap: 22px; }
#brief-screen-output .brief-page.pdf.boxed .b-grid { margin: 8px 44px 28px; padding: 0; }
</style>""", 1)
