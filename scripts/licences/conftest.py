"""The licence tests build their own fixture repos and run git and check.py in them.

Inside a git hook (the pre-push hook runs these tests through scripts/check.sh), git exports
GIT_DIR, GIT_INDEX_FILE and friends pointing at the real repository. Left in place, every git
call in a fixture repo acts on the real one: commits land on the branch being pushed, and
check.py's `git ls-files` reads the wrong tree. Drop them once, before any test runs; a test
that needs its own git environment passes it explicitly.
"""

import os

for _name in [k for k in os.environ if k.startswith("GIT_")]:
    del os.environ[_name]
