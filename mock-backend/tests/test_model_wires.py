"""The model family's Bedrock InvokeModel wire, Anthropic SSE streaming and the CLI schema shape:
translation units, then the server against the fake claude. No Claude spend.

    python3 -m unittest discover -s mock-backend/tests -p 'test_model_wires.py' -v
"""

from __future__ import annotations

import json
import unittest
import urllib.request

from harness import Server

import model_port as mp
from model_port import WireError, build_anthropic, build_bedrock, cli_schema, reply_text, resolve_model, sse_events, \
    to_anthropic

MSG = [{"role": "user", "content": "hi"}]
ENVELOPE = {"type": "result", "subtype": "success", "is_error": False, "num_turns": 1, "result": "hello there",
            "usage": {"input_tokens": 11, "cache_creation_input_tokens": 5, "cache_read_input_tokens": 7,
                      "output_tokens": 3}}


def breq(**kw):
    body = {"anthropic_version": "bedrock-2023-05-31", "max_tokens": 16, "messages": MSG}
    body.update(kw)
    return body


class BedrockIds(unittest.TestCase):
    def test_bedrock_ids_resolve_to_the_anthropic_ids_alias(self):
        cases = {
            "eu.anthropic.claude-sonnet-5-5": "claude-sonnet-5-5",
            "global.anthropic.claude-opus-5-5": "claude-opus-5-5",
            "global.anthropic.claude-haiku-4-5-20251001-v1:0": "haiku",
            "us.anthropic.claude-haiku-4-5-v1:0": "haiku",
            "apac.anthropic.claude-sonnet-5": "sonnet",
            "eu.anthropic.claude-opus-4-6-v1": "claude-opus-4-6",
            "anthropic.claude-opus-5": "opus",
            "claude-sonnet-5-5": "claude-sonnet-5-5",
        }
        for model, alias in cases.items():
            with self.subTest(model):
                self.assertEqual(resolve_model(model), alias)

    def test_unknown_ids_are_not_guessed(self):
        for model in ("eu.anthropic.claude-opus-4-8", "eu.meta.llama3-70b", "amazon.nova-pro-v1:0",
                      "xx.anthropic.claude-sonnet-5", "anthropic.claude-sonnet-5-extra-v1:0", ""):
            with self.subTest(model):
                self.assertIsNone(resolve_model(model))

    def test_anthropic_wire_takes_bedrock_ids_too(self):
        """The relay's config names Bedrock ids; locally it sends them on the Anthropic wire."""
        call = build_anthropic({"model": "eu.anthropic.claude-sonnet-5-5", "max_tokens": 16, "messages": MSG})
        self.assertEqual((call.model, call.alias), ("eu.anthropic.claude-sonnet-5-5", "claude-sonnet-5-5"))


class BedrockTranslate(unittest.TestCase):
    def err(self, model_id, op, body) -> WireError:
        with self.assertRaises(WireError) as cm:
            build_bedrock(model_id, op, body)
        return cm.exception

    def test_invoke_body_is_the_messages_body_without_model(self):
        call = build_bedrock("eu.anthropic.claude-sonnet-5-5", "invoke",
                             breq(anthropic_beta=["some-beta-2026-01-01"], system="sys",
                                  output_config={"format": {"type": "json_schema", "schema": {"type": "object"}}}))
        self.assertEqual((call.model, call.alias, call.system, call.stream),
                         ("eu.anthropic.claude-sonnet-5-5", "claude-sonnet-5-5", "sys", False))
        self.assertEqual(call.schema, {"type": "object"})

    def test_refusals(self):
        m = "eu.anthropic.claude-sonnet-5-5"
        cases = {
            "no anthropic_version": (m, "invoke", {"max_tokens": 16, "messages": MSG}, 400),
            "wrong anthropic_version": (m, "invoke", breq(anthropic_version="2023-06-01"), 400),
            "model in the body": (m, "invoke", breq(model=m), 400),
            "stream in the body": (m, "invoke", breq(stream=True), 400),
            "anthropic_beta not a list": (m, "invoke", breq(anthropic_beta="x"), 400),
            "tools": (m, "invoke", breq(tools=[{"name": "t", "input_schema": {"type": "object"}}]), 400),
            "response stream": (m, "invoke-with-response-stream", breq(), 400),
            "converse (Nova)": ("eu.amazon.nova-pro-v1:0", "converse", {"messages": []}, 404),
            "unknown model": ("eu.anthropic.claude-opus-4-8", "invoke", breq(), 404),
        }
        for name, (model_id, op, body, status) in cases.items():
            with self.subTest(name):
                self.assertEqual(self.err(model_id, op, body).status, status)

    def test_error_shape_is_bedrocks(self):
        for status, (want, name) in {400: (400, "ValidationException"), 401: (403, "AccessDeniedException"),
                                     404: (404, "ResourceNotFoundException"), 429: (429, "ThrottlingException"),
                                     500: (500, "InternalServerException"),
                                     504: (408, "ModelTimeoutException"),
                                     529: (503, "ServiceUnavailableException")}.items():
            with self.subTest(status):
                r = mp.bedrock_error(WireError(status, "x", "why"))
                self.assertEqual((r.status, r.body), (want, {"message": "why"}))
                self.assertTrue(r.headers["x-amzn-ErrorType"].startswith(name + ":"))


class CliSchema(unittest.TestCase):
    def test_a_plain_object_goes_as_it_is_less_its_ids(self):
        s = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "x", "type": "object",
             "properties": {"a": {"$id": "y", "type": "string"}}}
        self.assertEqual(cli_schema(s), ({"type": "object", "properties": {"a": {"type": "string"}}}, False))

    def test_a_top_level_union_is_wrapped_and_unwrapped(self):
        s = {"$schema": "https://json-schema.org/draft/2020-12/schema",
             "oneOf": [{"$ref": "#/$defs/a"}, {"type": "object", "properties": {"q": {"type": "string"}}}],
             "$defs": {"a": {"type": "object", "properties": {"w": {"type": "string"}}}}}
        wrapped, was = cli_schema(s)
        self.assertTrue(was)
        self.assertEqual(wrapped["required"], ["answer"])
        self.assertEqual(wrapped["$defs"], s["$defs"])          # refs still resolve from the root
        self.assertNotIn("$defs", wrapped["properties"]["answer"])
        call = build_anthropic({"model": "claude-haiku-4-5", "max_tokens": 16, "messages": MSG,
                                "output_config": {"format": {"type": "json_schema", "schema": s}}})
        self.assertEqual(json.loads(reply_text({**ENVELOPE, "structured_output": {"answer": {"w": "1"}}}, call)),
                         {"w": "1"})


class Streaming(unittest.TestCase):
    def test_stream_and_tolerated_params(self):
        call = build_anthropic({"model": "claude-opus-5", "max_tokens": 16000, "messages": MSG, "stream": True,
                                "betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default",
                                "thinking": {"type": "adaptive"}, "output_config": {"effort": "high"},
                                "system": [{"type": "text", "text": "prefix", "cache_control": {"type": "ephemeral"}}]})
        self.assertTrue(call.stream)
        self.assertEqual((call.system, call.effort), ("prefix", "high"))
        self.assertEqual(call.ignored, ["betas", "fallbacks", "thinking"])

    def test_tools_are_still_refused_when_streaming(self):
        with self.assertRaises(WireError) as cm:
            build_anthropic({"model": "claude-opus-5", "max_tokens": 16, "messages": MSG, "stream": True,
                             "tools": [{"name": "t", "input_schema": {"type": "object"}}]})
        self.assertEqual(cm.exception.status, 400)
        self.assertIn("tools", cm.exception.message)

    def test_sse_sequence_is_the_messages_apis(self):
        call = build_anthropic({"model": "claude-haiku-4-5", "max_tokens": 16, "messages": MSG, "stream": True})
        msg = to_anthropic(ENVELOPE, call)
        events = sse_events(msg)
        self.assertEqual([e for e, _ in events],
                         ["message_start", "content_block_start", "ping", "content_block_delta", "content_block_stop",
                          "message_delta", "message_stop"])
        for name, data in events:
            self.assertEqual(data["type"], name)
        start = events[0][1]["message"]
        self.assertEqual((start["id"], start["role"], start["content"], start["stop_reason"]),
                         (msg["id"], "assistant", [], None))
        self.assertEqual(start["usage"]["input_tokens"], 23)
        self.assertEqual(events[3][1]["delta"], {"type": "text_delta", "text": "hello there"})
        delta = events[5][1]
        self.assertEqual(delta["delta"], {"stop_reason": "end_turn", "stop_sequence": None})
        self.assertEqual(delta["usage"]["output_tokens"], 3)


def read_sse(raw: str) -> list:
    out = []
    for frame in raw.split("\n\n"):
        if not frame.strip():
            continue
        lines = dict(line.split(": ", 1) for line in frame.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


class WireServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = Server(MOCK_FAKES="model")

    @classmethod
    def tearDownClass(cls):
        cls.s.close()

    def raw_post(self, path, body, headers=None):
        h = {"content-type": "application/json", **(headers or {})}
        r = urllib.request.Request(self.s.base + path, data=json.dumps(body).encode(), method="POST", headers=h)
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, dict(resp.headers.items()), resp.read().decode()

    def test_stream_true_answers_sse(self):
        body = {"model": "claude-haiku-4-5", "max_tokens": 16, "messages": MSG, "stream": True}
        for path in ("/v1/messages", "/v1/messages?beta=true", "/anthropic/v1/messages"):
            with self.subTest(path):
                st, headers, raw = self.raw_post(path, body)
                self.assertEqual(st, 200)
                self.assertTrue(headers["Content-Type"].startswith("text/event-stream"))
                events = read_sse(raw)
                self.assertEqual(events[0][0], "message_start")
                self.assertEqual(events[-1][0], "message_stop")
                text = "".join(d["delta"]["text"] for e, d in events if e == "content_block_delta")
                self.assertEqual(json.loads(text)["model"], "haiku")

    def test_a_refused_stream_is_a_json_error_before_any_event(self):
        st, r = self.s.post("/v1/messages", {"model": "claude-haiku-4-5", "max_tokens": 16, "messages": MSG,
                                             "stream": True, "tools": []})
        self.assertEqual((st, r["type"], r["error"]["type"]), (400, "error", "invalid_request_error"))

    def test_invoke_model_with_any_signature(self):
        sigv4 = {"Authorization": "AWS4-HMAC-SHA256 Credential=local/20261015/eu-west-1/bedrock/aws4_request, "
                                  "SignedHeaders=host;x-amz-date, Signature=00", "X-Amz-Date": "20261015T000000Z"}
        for headers in (sigv4, {"Authorization": "Bearer local"}, {}):
            with self.subTest(headers=list(headers)):
                st, r, _ = self.s.call("POST", "/model/eu.anthropic.claude-sonnet-5-5/invoke", breq(system="S"),
                                       headers=headers)
                self.assertEqual(st, 200, r)
                self.assertEqual((r["type"], r["role"], r["model"], r["stop_reason"]),
                                 ("message", "assistant", "eu.anthropic.claude-sonnet-5-5", "end_turn"))
                self.assertEqual(json.loads(r["content"][0]["text"])["model"], "claude-sonnet-5-5")
        st, r, _ = self.s.call("POST", "/model/global.anthropic.claude-haiku-4-5-20251001-v1%3A0/invoke", breq())
        self.assertEqual((st, json.loads(r["content"][0]["text"])["model"]), (200, "haiku"))

    def test_invoke_model_errors_in_bedrocks_shape(self):
        st, r, h = self.s.call("POST", "/model/eu.anthropic.claude-sonnet-5-5/invoke", {"messages": MSG})
        self.assertEqual((st, set(r)), (400, {"message"}))
        self.assertTrue(h["x-amzn-ErrorType"].startswith("ValidationException"))
        st, r, h = self.s.call("POST", "/model/eu.anthropic.claude-opus-4-8/invoke", breq())
        self.assertEqual(st, 404)
        self.assertTrue(h["x-amzn-ErrorType"].startswith("ResourceNotFoundException"))
        st, r, h = self.s.call("POST", "/model/x/nope", breq())
        self.assertEqual(st, 404)


class WireAuth(unittest.TestCase):
    def test_with_a_token_bedrock_needs_the_bearer(self):
        s = Server(MOCK_FAKES="model", MOCK_TOKEN="T")
        try:
            path = "/model/eu.anthropic.claude-sonnet-5-5/invoke"
            st, r, h = s.call("POST", path, breq(), headers={"Authorization": "AWS4-HMAC-SHA256 x"})
            self.assertEqual(st, 403)
            self.assertTrue(h["x-amzn-ErrorType"].startswith("AccessDeniedException"))
            self.assertEqual(s.call("POST", path, breq(), headers={"Authorization": "Bearer T"})[0], 200)
        finally:
            s.close()


if __name__ == "__main__":
    unittest.main()
