"""The brief's look (features/brief-new-ui.clan): layout, logos and theme are appearance keys only a person
writes, and so is confidential_fields (who may read a part). Redrafting one part, and drafting the whole brief
again, leave them exactly as they were."""

import copy

from test_brief import run
from test_fix_parts import drafted
from test_planned_brief import THIN

LOOK = {
    "layout": {"frame": "boxed", "headings": "tab",
               "parts": {"insight": {"col": 1, "row": 9, "w": 12, "h": 1, "order": 9},
                         "objectives.commercial": {"col": 1, "row": 7, "w": 4, "h": 1, "order": 5}}},
    "logos": [{"slot": "client", "ref": {"asset": "logo-1.png"}, "label": "brewline.png"},
              {"slot": "agency", "ref": {"brand": "brand-wk", "asset": "logo-primary"}}],
    "theme": {"accent": "#1F3FBF"},
    "confidential_fields": ["budget_and_scope", "objectives.commercial"],
}


def look(host):
    return {k: host.data.get(k) for k in LOOK}


def test_a_redraft_of_one_part_and_a_whole_new_draft_keep_the_look(tmp_path):
    seen = {}
    s, host = drafted(tmp_path, seen)
    try:
        host.data.update(copy.deepcopy(LOOK))
        before = len(host.changes)
        last = run(s, host, task="regenerate_field", inp={"field": "insight", "guidance": "make it sharper"})[-1]
        assert last["job"]["state"] == "done", last
        assert look(host) == LOOK
        run(s, host, inp={"prompt": THIN, "attachments": []})  # Draft it again
        assert look(host) == LOOK
        assert len(host.changes) > before, "both jobs wrote the brief"
    finally:
        s.stop()
    # No change the crew made names a look key at all.
    for ch in host.changes:
        assert not set(ch["data_patch"] or {}) & set(LOOK), ch["data_patch"]
