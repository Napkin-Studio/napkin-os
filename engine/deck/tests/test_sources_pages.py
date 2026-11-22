"""The Sources appendix in pages (assemble.paginate_sources): a table too long for one slide goes on, numbered as the footnotes are.
Invented sources only."""
from deck import assemble


def _deck(n_rows, chars=200):
    rows = [["#", "Source"]] + [[f"[{i}]", f"Invented Survey {i}, " + "x" * chars] for i in range(1, n_rows + 1)]
    return {"meta": {}, "order": ["s01", "s02", "s03"],
            "slides": {"s01": {"type": "title", "title": "T", "blocks": []},
                       "s02": {"type": "appendix_sources", "title": "Sources", "blocks": [{"kind": "table", "rows": rows, "small": True, "basis": "meta"}]},
                       "s03": {"type": "requirement_trace", "title": "Trace", "blocks": []}}}


def test_a_short_sources_table_stays_on_one_slide():
    d = _deck(4)
    assert assemble.paginate_sources(d) == 0 and d["order"] == ["s01", "s02", "s03"]


def test_a_long_sources_table_goes_on_in_order_with_its_numbering():
    d = _deck(13, chars=180)          # 13 rows of three lines each: past one page
    added = assemble.paginate_sources(d)
    assert added >= 1
    pages = [d["slides"][x] for x in d["order"] if d["slides"][x]["type"] == "appendix_sources"]
    assert pages[0]["title"] == "Sources" and all(p["title"] == assemble.SOURCES_MORE for p in pages[1:])
    assert d["order"][0] == "s01" and d["order"][-1] == "s03"          # the pages sit together where Sources was
    nums = [r[0] for p in pages for r in p["blocks"][0]["rows"][1:]]
    assert nums == [f"[{i}]" for i in range(1, 14)]                     # every source once, in footnote order
    assert all(p["blocks"][0]["rows"][0] == ["#", "Source"] for p in pages)
    assert assemble.paginate_sources(d) == 0                            # split once only
