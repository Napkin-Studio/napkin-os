#!/usr/bin/env python3
"""A Markdown table of scripts/bench-store.mjs results (features/store-scan-under-lock.clan).

    python3 scripts/bench-store.py <label>=<out.json> [<label>=<out.json> ...]

One row per op, one column per label and N; each cell is "one-client median / six-client p95", in ms unless
marked s.
"""
import json
import sys

OPS = ['upstream (brief)', 'upstream (room)', 'decisions', 'related', 'judge (room)', 'judge (script)',
       'ideas/room', 'attach-targets', 'capabilities', 'edit-mode', 'open (GET /d)', 'needs']


def f(ms):
    return f"{ms / 1000:.1f} s" if ms >= 1000 else f"{ms:.0f}" if ms >= 10 else f"{ms:.1f}"


def main(args):
    runs = []
    for a in args:
        label, path = a.split('=', 1)
        results = sorted(json.load(open(path))['results'], key=lambda r: r['N'])
        runs.extend((label, r) for r in results)
    print('| op | ' + ' | '.join(f"{label} N={r['N']}" for label, r in runs) + ' |')
    print('|---' * (1 + len(runs)) + '|')
    for op in OPS:
        cells = []
        for _, r in runs:
            one, six = r['one'].get(op), r['six'].get(op)
            cells.append(f"{f(one['median'])} / {f(six['p95'])}" if one and six else '')
        print(f"| `{op}` | " + ' | '.join(cells) + ' |')


if __name__ == '__main__':
    main(sys.argv[1:])
