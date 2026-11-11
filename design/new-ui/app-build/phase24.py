# Phase 24 (2026-11-09): top-bar medallion a touch bigger and a touch higher.
rep("    const size = 48;\n    const uid = 'h1m';", "    const size = 54;\n    const uid = 'h1m';")
rep('\n</style>', r"""
.m1-medallion { width: 64px !important; height: 64px !important; top: 4px !important; }
</style>""", 1)
