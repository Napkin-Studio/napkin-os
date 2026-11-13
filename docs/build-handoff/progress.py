#!/usr/bin/env python3
"""Recompute the live numbers on napkin-os-build-progress.html. Read-only on the repo (one `git fetch`).
Usage: python3 napkin-os-build-progress.py ["running: <what>" | "paused"]
Narrative parts (plan, notes, PR table) are edited by hand; values between <!--a:key--> and <!--/a--> are owned by this script.
A record's pill can be pinned by hand in OVERRIDE below."""
import glob, os, re, subprocess, sys, datetime, zipfile
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, 'napkin-fabletest')
PAGE = os.path.join(HERE, 'napkin-os-build-progress.html')
ALIGN = ['align-confidential-prices','align-landing-look','align-needs-lock-people','align-booth']
PHASE2 = ['j001-phase2-suite','job-page','remaining-homes','approval-route','needs-you-full','client-review-full','judge',
          'one-bar-search','agency-setup','idea-room','script-editor','first-day','ask-nap','napkin-brain','sso','timesheet-signals','voice']
OVERRIDE = {  # hand-set states that the record's status alone cannot tell
    'agency-setup': ('warn', 'Part built'), 'idea-room': ('warn', 'Part built'), 'script-editor': ('warn', 'Part built'),
    'sso': ('stop', 'Held'), 'timesheet-signals': ('stop', 'Held'), 'voice': ('stop', 'Held'),
}
def sh(*a, cwd=REPO):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True).stdout.strip()
def node():
    d = os.path.expanduser('~/.nvm/versions/node'); v = sorted(os.listdir(d))[-1]
    return os.path.join(d, v, 'bin', 'node')
def status(slug):
    try:
        y = zipfile.ZipFile(os.path.join(REPO, 'features', slug + '.clan')).read('shared/data.yaml').decode()
        m = re.search(r'^status:\s*(\S+)', y, re.M); return m.group(1) if m else '?'
    except Exception: return '?'
def counter(script):
    m = re.search(r'(\d+) fixme of (\d+) \((\d+) run now\)', sh(node(), script))
    return (int(m.group(3)), int(m.group(2))) if m else (0, 0)

sh('git', 'fetch', '-q', 'origin', 'develop', 'spike/fabletest')
branch = sh('git', 'rev-parse', '--abbrev-ref', 'HEAD')
dev = sh('git', 'rev-list', '--count', 'HEAD..origin/develop')
mt = subprocess.run(['git', 'merge-tree', '--write-tree', '--name-only', 'HEAD', 'origin/develop'], cwd=REPO, capture_output=True, text=True).stdout
conf = len([l for l in mt.split('\n\n')[0].splitlines()[1:] if l.strip()]) if 'CONFLICT' in mt else 0
unpushed = sh('git', 'rev-list', '--count', 'origin/spike/fabletest..HEAD')
remote = sh('git', 'rev-parse', '--short=8', 'origin/spike/fabletest')
p1 = counter('app/e2e/phase1-fixme.mjs'); p2 = counter('app/e2e/phase2-fixme.mjs')
st = {s: status(s) for s in PHASE2}
PILL = {'done': ('ok', 'Built'), 'verifying': ('ok', 'Built'), 'building': ('ok', 'Built'), 'designed': ('idle', 'Designed'), 'exploring': ('idle', 'Designed')}
pills = {s: OVERRIDE.get(s, PILL.get(st[s], ('idle', st[s]))) for s in PHASE2}
built = sum(1 for s in PHASE2 if pills[s][1] in ('Built', 'Part built'))
arg = sys.argv[1] if len(sys.argv) > 1 else 'paused'
run = ('<span class="pill ok">Running · %s</span>' % arg[8:].strip()) if arg.startswith('running') else '<span class="pill warn">Paused · nothing running</span>'
vals = {
    'asof': 'As of %s.' % datetime.datetime.now().strftime('%-d %b %Y, %H:%M'),
    'run': run,
    'p1t': '<div class="n">%d<small> / %d</small></div>' % p1,
    'p2t': '<div class="n">%d<small> / %d</small></div>' % p2,
    'p2tbar': '<div class="bar"><i style="width:%d%%"></i></div>' % (100 * p2[0] // max(p2[1], 1)),
    'p2rec': '<div class="n">%d<small> / %d</small></div>' % (built, len(PHASE2)),
    'p2recbar': '<div class="bar"><i style="width:%d%%"></i></div>' % (100 * built // len(PHASE2)),
    'dev': '<div class="n">%s</div>' % dev,
    'devl': 'commits on develop not yet in this branch (%s)' % ('%d files conflict' % conf if conf else 'merges cleanly'),
    'unpushed': '<div class="n">%s</div>' % unpushed,
    'unpl': 'local commits not pushed (GitHub copy is at %s)' % remote,
}
for s in PHASE2: vals['rec.' + s] = '<span class="pill %s">%s</span>' % pills[s]
html = open(PAGE).read()
for k, v in vals.items():
    html, n = re.subn(r'(<!--a:%s-->).*?(<!--/a-->)' % re.escape(k), lambda m: m.group(1) + v + m.group(2), html, flags=re.S)
    if not n: print('no slot for', k)
open(PAGE, 'w').write(html)
print('branch', branch, '| p1', p1, '| p2', p2, '| records', built, '| develop ahead', dev, 'conflicts', conf, '| unpushed', unpushed)
