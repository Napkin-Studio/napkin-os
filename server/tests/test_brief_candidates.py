"""Phase 0 of features/brief-proposition-candidates.clan: the pure generate / rank / choose of napkin/brief/candidates.py
(the port fix is tested in test_drafters_port.py). No model call: `call` is a fake."""

from napkin.brief import candidates as cd
from napkin.brief import drafters


# ---------------------------------------------------------------------------------------- the pure parts

def _pool(*specs):
    """specs: (value, source). A pool entry as build_pool makes it."""
    return [{"value": v, "source": s, "words": cd.words(v), "and_flag": cd.standalone_and(v),
             "gate_ok": cd.auto_gate("smp", v)[0], "gate_fails": []} for v, s in specs]


def test_standalone_and_is_the_flag_jude_is_told():
    assert cd.standalone_and("Fast and fair")
    assert cd.standalone_and("Save & share")
    assert not cd.standalone_and("Marks & Spencer for less")      # a name with an ampersand is one thing
    assert not cd.standalone_and("Handsome, sandy islands")
    assert cd.unmarked("To confirm: Keep it simple.") == "Keep it simple."
    assert cd.unmarked(["To confirm: a", "b"]) == "a; b"


def test_shuffle_is_fixed_by_the_job_id_and_a_permutation():
    a, b = cd.shuffled(5, "c01-off"), cd.shuffled(5, "c01-off")
    assert a == b and sorted(a) == [0, 1, 2, 3, 4]
    assert any(cd.shuffled(5, f"job{i}") != list(range(5)) for i in range(10))     # not always the given order
    assert len({tuple(cd.shuffled(5, f"job{i}")) for i in range(30)}) > 3           # and it varies with the id
    assert cd.shuffled(5, "x")[0] != cd.shuffled(5, "y")[0] or cd.shuffled(5, "x") != cd.shuffled(5, "y")


def test_build_pool_drops_exact_duplicates_and_puts_the_first_draft_last():
    new = [{"value": "One two three", "seed": 0}, {"value": "One two three", "seed": 1}, {"value": "First draft line here", "seed": 2},
           {"value": "Two two three", "seed": 3}]
    pool = cd.build_pool("To confirm: First draft line here", new)
    assert [p["value"] for p in pool] == ["One two three", "Two two three", "First draft line here"]
    assert [p["source"] for p in pool] == ["seed:0", "seed:3", "first_draft"]
    assert all({"words", "and_flag", "gate_ok", "gate_fails"} <= set(p) for p in pool)


def test_the_gate_reads_the_unmarked_words():
    pool = cd.build_pool("x y z", [{"value": "w " * 21, "seed": 0}, {"value": "Fine line. Another sentence.", "seed": 1}])
    gate = {p["source"]: p["gate_ok"] for p in pool}
    assert gate == {"seed:0": False, "seed:1": False, "first_draft": True}   # 21 words; two sentences


def test_choose_takes_the_best_ranked_that_clears_the_gate():
    pool = _pool(("w " * 25, "seed:0"), ("Plain honest thought", "seed:1"), ("Another honest thought", "first_draft"))
    assert cd.choose(pool, [0, 1, 2]) == 1                  # the best-ranked one fails the gate
    assert cd.choose(pool, [2, 1, 0]) == 2
    assert cd.choose(_pool(("w " * 25, "seed:0"), ("x. y.", "seed:1")), [0, 1]) is None   # none clears


def test_choose_prefers_an_unflagged_candidate_directly_below_a_flagged_winner():
    """U13: the one tie-break, and nothing else is dropped for the flag."""
    flagged, plain, plain2 = ("Fast and fair", "seed:0"), ("Fair play always", "seed:1"), ("Fast play always", "seed:2")
    p = _pool(flagged, plain, plain2)
    assert cd.choose(p, [0, 1, 2]) == 1                     # flagged on top, unflagged next: the unflagged one
    p = _pool(flagged, ("Fast and loose play", "seed:1"), plain2)
    assert cd.choose(p, [0, 1, 2]) == 0                     # unflagged only two places down: the flagged one stands
    assert cd.choose(_pool(flagged, ("Also and so on", "seed:1")), [0, 1]) == 0   # none unflagged: keeps it
    p = _pool(flagged, ("w " * 25, "seed:1"), plain2)
    assert cd.choose(p, [0, 1, 2]) == 2                     # a gate failure below is not 'the next candidate'
    assert cd.choose(_pool(plain, flagged), [0, 1]) == 0    # an unflagged winner is never swapped


def _parts():
    return {"job": "Move them", "audience": "Adults", "competitor_context": "Rival X", "reasons_to_believe": ["R1", "To confirm: R2"],
            "background": "Bg", "barrier": "Bar", "objectives.commercial": "Sell", "objectives.behavioural": "Buy",
            "objectives.attitudinal": "Like"}


class Fake:
    """A model that answers each purpose from a script and records what it was sent."""

    def __init__(self, gen=None, ranking=None, fail=()):
        self.gen, self.ranking, self.fail, self.calls = gen, ranking, fail, []

    def __call__(self, purpose, system, payload, schema):
        self.calls.append((purpose, system, payload, schema))
        if purpose in self.fail:
            raise RuntimeError(f"{purpose} broke")
        if purpose == "candidates_smp":
            return {"candidates": [{"value": v, "angle": "a", "rests_on": "r", "cites": ["f_1", 3]} for v in self.gen]}
        n = len(payload["candidates"])
        return {"ranking": self.ranking if self.ranking is not None else list(range(n)), "why_winner": "w", "losers": []}


def pick(call, job="c01-off", first="To confirm: The first line here."):
    return cd.pick(call, job, insight="To confirm: The insight.", first_value=first, parts=_parts(), strategy="S",
                   facts=[{"id": "f_1"}], findings=[], client_words=[{"id": "cap_1"}], library=[{"id": "psg_1"}])


def test_generate_payload_shows_what_the_draft_saw_but_not_the_first_proposition():
    f = Fake(gen=["A", "B", "C", "D"])
    pick(f)
    purpose, system, payload, schema = f.calls[0]
    assert purpose == "candidates_smp"
    assert payload["insight"] == "The insight."                       # mark off
    assert payload["angles"] == list(drafters.SMP_ANGLE_SEEDS) and payload["write"] == 4
    assert payload["drafted"]["reasons_to_believe"] == "R1; R2"
    assert payload["facts"] == [{"id": "f_1"}] and payload["library"] == [{"id": "psg_1"}] and payload["client_words"]
    assert "The first line here" not in str(payload)                       # the new ones are not rewordings of it
    assert "Too low (a feature)" in system and "carries its own grounds" not in system and "working brief" not in system
    assert schema["properties"]["candidates"]["maxItems"] == 4


def test_pick_chooses_a_new_candidate_and_reports_where_it_came_from():
    f = Fake(gen=["Alpha line here", "Beta line here", "Gamma line here", "Delta line here"])
    res = pick(f)
    assert res["outcome"] == "chosen_new" and len(res["pool"]) == 5
    assert [c[0] for c in f.calls] == ["candidates_smp", "rank_smp"]
    assert sorted(res["shown"]) == [0, 1, 2, 3, 4] and res["order"] == res["shown"]   # the fake keeps the order shown
    assert res["pool"][res["winner"]]["source"] == res["winner_source"] != "first_draft"
    ranked = f.calls[1][2]["candidates"]
    assert all({"words", "and_flag"} <= set(c) for c in ranked)       # the flag is in the ranker's payload
    assert f.calls[1][2]["context"]["insight"] == "The insight."


def test_pick_first_draft_wins_when_the_ranker_puts_it_first():
    f = Fake(gen=["Alpha line here", "Beta line here", "Gamma line here", "Delta line here"])
    shown = cd.shuffled(5, "c01-off")
    f.ranking = [shown.index(4)] + [i for i in range(5) if i != shown.index(4)]   # shown place of pool index 4, the first draft
    res = pick(f)
    assert res["outcome"] == "first_draft_won" and res["winner_source"] == "first_draft"


def test_pick_ways_out_leave_nothing_chosen():
    long = "w " * 25
    assert pick(Fake(gen=[long] * 4, ranking=None), first=long + "x")["outcome"] == "no_gate"
    r = pick(Fake(gen=[], ))
    assert r["outcome"] == "generate_failed" and r["error"] == "no usable candidate"
    r = pick(Fake(gen=["x"], fail=("candidates_smp",)))
    assert r["outcome"] == "generate_failed" and "candidates_smp broke" in r["error"]
    f = Fake(gen=["Alpha line here", "Beta line here"], fail=("rank_smp",))
    r = pick(f)
    assert r["outcome"] == "rank_failed" and [c[0] for c in f.calls] == ["candidates_smp", "rank_smp"] and r["winner"] is None
    assert pick(Fake(gen=["The first line here."]))["outcome"] == "pool_small"   # a copy of the first draft: nothing to choose from


def test_ranker_may_return_a_partial_order():
    r = pick(Fake(gen=["Alpha line here", "Beta line here", "Gamma line here", "Delta line here"], ranking=[3]))
    assert sorted(r["order"]) == [0, 1, 2, 3, 4] and r["order"][0] == cd.shuffled(5, "c01-off")[3]
