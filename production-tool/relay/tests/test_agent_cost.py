"""Agents' Claude calls priced on the job and in the ledger (relay/agent_cost.py; UAT 2026-11-21, F21)."""
import agent_cost


def test_a_bedrock_id_finds_its_list_price():
    assert agent_cost.price("eu.anthropic.claude-sonnet-5-5") == {"inputPerMTok": 2.0, "outputPerMTok": 10.0}
    # The UAT's 22 calls: 498k in, 31k out.
    assert agent_cost.usd({"input_tokens": 498_000, "output_tokens": 31_000}, "eu.anthropic.claude-sonnet-5-5") == 1.306


def test_config_prices_win_and_unknown_models_cost_nothing():
    prices = {"claude-sonnet-5-5": {"inputPerMTok": 3.0, "outputPerMTok": 15.0}}
    assert agent_cost.usd({"input_tokens": 1_000_000, "output_tokens": 0}, "eu.anthropic.claude-sonnet-5-5", prices) == 3.0
    assert agent_cost.usd({"input_tokens": 10, "output_tokens": 10}, "mock") == 0.0
    assert agent_cost.usd(None, "claude-sonnet-5-5") == 0.0
