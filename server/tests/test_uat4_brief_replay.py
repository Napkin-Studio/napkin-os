"""UAT round 4, third re-test (develop 8d654dbf): the real Brief Maker document, replayed through "Draft it again".

The planner answered "Which line does the board prefer, and is 'Clean, without the plastic.' the recommendation?" with
"Refill. Not landfill. Use it word for word everywhere.": a new line, not among the question's options and not quoted.
After the redraft and the lock, mandatories had no end line. The fixture is that document as UAT held it."""

import gzip
import json
from pathlib import Path

from conftest import Server
from test_brief import Host, retrieval, run
from test_planned_brief import planned_model

from napkin.brief import checks

DOC = json.loads(gzip.decompress((Path(__file__).parent / "fixtures" / "uat4_copperell_brief.json.gz").read_bytes()))
LINE_Q = next(q for q in DOC["data"]["open_questions"] if q.startswith("Which line does the board prefer"))
END_LINE = "End line: 'Refill. Not landfill.' (word for word)"


def test_the_fixture_is_the_failing_document():
    assert LINE_Q == ("Which line does the board prefer, and is 'Clean, without the plastic.' the recommendation? — "
                      "Answer: Refill. Not landfill. Use it word for word everywhere.")
    assert not any("landfill" in m.lower() for m in DOC["data"]["mandatories"]), "as UAT held it: no end line"


def test_a_line_stated_before_an_instruction_is_the_fixed_line():
    assert checks.fixed_line(DOC["data"]["open_questions"]) == "Refill. Not landfill."


def test_draft_it_again_on_the_real_document_puts_the_end_line_first_in_mandatories(tmp_path):
    # the UI's "Draft it again": draft_brief with {prompt, attachments, intake: false, redraft: true} (brief-maker runJob)
    host = Host(data=DOC["data"], chain=DOC["chain"])
    host.facts = DOC["facts"]
    s = Server(tmp_path, model=planned_model({}), retrieval=retrieval(), settings_kw={"brief_flow": "planned"})
    try:
        replies = run(s, host, inp={"prompt": DOC["data"]["brief_input"], "attachments": [], "intake": False, "redraft": True},
                      timeout=120)
    finally:
        s.stop()
    assert replies[-1]["job"]["state"] == "done"
    props = {p["field"]: p["value"] for p in replies[-1]["result"]["proposals"]}
    mands = props.get("mandatories") or host.data["mandatories"]
    assert mands[0] == END_LINE
    assert sum(1 for m in mands if m.startswith("End line:")) == 1


def test_only_a_line_followed_by_an_instruction_counts_when_it_is_not_quoted_or_an_option():
    q = "Which line does the board prefer, and is 'Clean, without the plastic.' the recommendation?"
    ans = lambda a: checks.fixed_line([f"{q} — Answer: {a}"])  # noqa: E731
    assert ans("Refill. Not landfill. Use it word for word everywhere.") == "Refill. Not landfill."
    assert ans("Refill. Not landfill. Keep it exactly as written.") == "Refill. Not landfill."
    assert ans("The board has not decided yet.") == "", "a statement with no instruction is not a line"
    assert ans("Use the first one.") == "", "an instruction with no line before it fixes nothing"
    assert ans("No. Use it word for word.") == ""
    assert ans("Clean, without the plastic. Use it everywhere.") == "Clean, without the plastic."
    assert ans("We would like something along the lines of refill being easy, kind and premium for every home. Use it word for word.") == "", "too long to be a line"
    legal = "Which legal line must every piece carry? — Answer: Keep out of reach of children. Use it word for word."
    assert checks.fixed_line([legal]) == ""
