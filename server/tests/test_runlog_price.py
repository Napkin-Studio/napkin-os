"""The run log prices the models staging runs, and never stops a job it cannot write
(features/dogfood-log-quality.clan)."""

from napkin import runlog


def test_bedrock_model_ids_are_priced_by_the_model_name():
    plain = runlog.price("claude-opus-5-5", 1_000_000, 1_000_000)
    assert plain is not None
    for wire in ("bedrock/global.anthropic.claude-opus-5-5", "global.anthropic.claude-opus-5-5",
                 "eu.anthropic.claude-opus-5-5", "us.anthropic.claude-opus-5-5-v1:0",
                 "anthropic.claude-opus-5-5"):
        assert runlog.price(wire, 1_000_000, 1_000_000) == plain, wire
    # the longest key still wins: opus-4-1 is priced apart from opus
    assert runlog.price("bedrock/eu.anthropic.claude-opus-4-1", 1_000_000, 0) == 15.0
    assert runlog.price("bedrock/global.anthropic.claude-haiku-4-5", 1_000_000, 0) == 1.0
    assert runlog.price("bedrock/amazon.nova-2-lite", 1_000_000, 0) is None
    assert runlog.price(None, 1, 1) is None


def test_a_prices_key_written_whole_is_used_as_written():
    runlog.PRICES["bedrock/global.anthropic.claude-sonnet-x"] = (1.0, 1.0)
    try:
        assert runlog.price("bedrock/global.anthropic.claude-sonnet-x", 1_000_000, 0) == 1.0
    finally:
        del runlog.PRICES["bedrock/global.anthropic.claude-sonnet-x"]


def test_a_run_log_it_cannot_write_does_not_stop_the_job(tmp_path):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x")
    runlog.configure(str(blocker))
    try:
        log = runlog.open_log("job_00ff", "draft_brief@1")
        log.start("draft_brief", "doc-1", ["plan"], model="bedrock/global.anthropic.claude-opus-5-5")
        log.model(purpose="plan", model="bedrock/global.anthropic.claude-opus-5-5", secs=1.0,
                  tin=10, tout=10, attempts=1, ok=True)
        log.end("done", "ok", {}, [])
    finally:
        runlog.configure(None)


def test_sonnet_5_5_on_bedrock_is_priced_with_its_cache_reads_and_writes():
    m = "bedrock/global.anthropic.claude-sonnet-5-5"
    assert runlog.price(m, 1_000_000, 1_000_000) == 12.0              # $2 in, $10 out
    # of a million input tokens, 600k read from the cache (0.1x) and 100k written to it (1.25x)
    assert runlog.price(m, 1_000_000, 0, cache_read=600_000, cache_write=100_000) == round(
        0.3 * 2 + 0.6 * 2 * 0.1 + 0.1 * 2 * 1.25, 6)
    assert runlog.price("bedrock/eu.anthropic.claude-sonnet-4-6", 1_000_000, 0) == 3.0   # older Sonnets unchanged
