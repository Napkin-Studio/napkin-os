# Phase 31 (2026-11-09): the brief is an A4 page (1:1.414). Screen and PDF show the same sheet; PDF adds page-break guides.
rep('\n</style>', r"""
/* ═══ Phase 31: A4 brief ═══ */
#brief-screen-output { --a4w: 860px; --a4m: 64px; }
#brief-screen-output .bm-wrap, #brief-screen-output .bm-wrap:has(.brief-page.pdf) { max-width: var(--a4w) !important; }
#brief-screen-output .brief-page, #brief-screen-output .brief-page.pdf { width: 100%; max-width: var(--a4w) !important; min-height: calc(var(--a4w) * 1.4142); border-radius: 2px; display: flex; flex-direction: column; }
#brief-screen-output .brief-page .b-grid { flex: 1; align-content: start; }
#brief-screen-output .brief-page:not(.phone) .b-cover { padding: 52px var(--a4m) 28px !important; }
#brief-screen-output .brief-page:not(.phone) .b-grid { padding: 10px var(--a4m) 36px !important; column-gap: 26px !important; }
#brief-screen-output .brief-page:not(.phone) .b-foot { padding: 18px var(--a4m) 26px !important; }
#brief-screen-output .brief-page:not(.phone).boxed .b-grid { margin: 10px var(--a4m) 36px !important; padding: 0 !important; column-gap: 0 !important; }
#brief-screen-output .brief-page.boxed .b-grid { column-gap: 0 !important; }
/* PDF: page-break guides every A4 page height */
#brief-screen-output .brief-page.pdf { background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--a4w) * 1.4142 - 1px), rgba(201,70,42,.45) calc(var(--a4w) * 1.4142 - 1px), rgba(201,70,42,.45) calc(var(--a4w) * 1.4142)) !important; }
/* phone stays its own narrow view */
#brief-screen-output .bm-wrap:has(.brief-page.phone) { max-width: 400px !important; }
#brief-screen-output .brief-page.phone { max-width: 400px !important; min-height: 0; }
@media (max-width: 1260px) { #brief-screen-output { --a4w: 720px; --a4m: 52px; } }
</style>""", 1)
rep('\n</style>', r"""
#brief-screen-output .brief-workspace { grid-template-columns: minmax(0, 1fr) 440px !important; gap: 24px !important; }
#brief-screen-output .bm-wrap { margin: 0 auto 0 0 !important; }
@media (max-width: 1100px) { #brief-screen-output .brief-workspace { grid-template-columns: minmax(0, 1fr) 380px !important; } }
</style>""", 1)
rep('\n</style>', r"""
/* page + gap + panel, centred as one unit */
#brief-screen-output { --bw: min(calc(var(--a4w) + 32px + 440px), calc(100vw - 48px)) !important; }
#brief-screen-output .brief-workspace { grid-template-columns: var(--a4w) 440px !important; gap: 32px !important; justify-content: center; }
@media (max-width: 1100px) { #brief-screen-output .brief-workspace { grid-template-columns: minmax(0, 1fr) 380px !important; } }
</style>""", 1)
