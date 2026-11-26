"""The passthrough director's shot list: each sentence once, and a re-plan keeps the shots already there."""

from contracts import Contracts
from director import PassthroughDirector, new_id

SCRIPT = "@maya_front walks into a sunny kitchen and smiles. She tastes the soup and nods."


def plan(script: str, target: int, shots: list | None = None) -> list[dict]:
    inp = {"script": script, "targetS": target, **({"shots": shots} if shots else {})}
    out = PassthroughDirector().direct({"jobId": new_id("job"), "op": "shot_list", "input": inp}, None)
    assert Contracts().errors("director.schema.json", out) == []
    return out["shots"]


def test_each_sentence_is_used_once_when_there_are_fewer_sentences_than_shots():
    shots = plan(SCRIPT, 15)  # 15 s would be three 5 s shots; two sentences make two
    actions = [s["action"] for s in shots]
    assert actions == ["@maya_front walks into a sunny kitchen and smiles.", "She tastes the soup and nods."]
    assert sum(s["duration_s"] for s in shots) == 15


def test_one_sentence_splits_at_a_clause_rather_than_repeating():
    shots = plan("She tastes the soup and nods.", 15)
    assert [s["action"] for s in shots] == ["She tastes the soup", "Nods."]
    assert len({s["action"] for s in shots}) == len(shots)


def test_more_sentences_than_shots_share_shots_and_none_is_lost():
    shots = plan("One. Two. Three. Four. Five.", 10)
    assert [s["action"] for s in shots] == ["One. Two. Three.", "Four. Five."]


def test_a_replan_keeps_the_shots_already_there_by_id_and_adds_the_new_words_after():
    first = plan(SCRIPT + " She tastes the soup and nods.", 15)
    assert len(first) == 3
    sent = [{"id": s["id"], "kind": "shot", "duration_s": s["duration_s"], "camera": s["camera"],
             "action": s["action"], "refs": ["maya"]} for s in first]
    script = "She waves goodbye at the door.\n" + "\n".join(s["action"] for s in first)
    again = plan(script, 15, sent)
    assert [s.get("id") for s in again[:3]] == [s["id"] for s in first]
    assert [s["action"] for s in again[:3]] == [s["action"] for s in first]
    assert [s["camera"] for s in again[:3]] == [s["camera"] for s in first]
    assert again[3]["action"] == "She waves goodbye at the door." and again[3]["id"] not in {s["id"] for s in first}
    assert sum(s["duration_s"] for s in again) == 15


def test_a_shot_whose_words_are_gone_is_left_out_and_an_empty_shot_takes_new_words():
    a = {"id": new_id("shot"), "kind": "shot", "duration_s": 5, "camera": {"size": "wide"}, "action": "Old words.", "refs": []}
    b = {"id": new_id("shot"), "kind": "shot", "duration_s": 5, "camera": {"size": "close"}, "action": "", "refs": []}
    again = plan("New words here.", 10, [a, b])
    assert again[0]["id"] == b["id"] and again[0]["action"] == "New words here."
    assert a["id"] not in {s.get("id") for s in again}
