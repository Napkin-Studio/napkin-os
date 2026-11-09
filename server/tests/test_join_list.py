"""Items said in one line lose their closing punctuation before the join (N6):
"this spring; Reach 3%…", never "this spring.; Reach"."""

from napkin.brief.capture import working_brief
from napkin.util import join_list


def test_join_list_strips_each_items_closing_punctuation_but_the_last():
    assert join_list(["Launch in the UK this spring.", "Reach 3% share."]) == "Launch in the UK this spring; Reach 3% share."
    assert join_list(["a;", " b, ", "", None, "c"]) == "a; b; c"
    assert join_list([]) == ""


def test_two_captured_objectives_read_as_one_line():
    items = {
        "cap_1": {"key": "objective", "objective_type": "commercial", "material_id": "mat_1",
                  "value": "Launch the new dry cider in the UK this spring."},
        "cap_2": {"key": "objective", "objective_type": "commercial", "material_id": "mat_1",
                  "value": "Reach 3% share of UK no/low cider within 12 months."},
    }
    got = working_brief(items, {})["objectives.commercial"]["value"]
    assert ".;" not in got
    assert got == "Launch the new dry cider in the UK this spring; Reach 3% share of UK no/low cider within 12 months."
