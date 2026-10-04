"""Web research in process (napkin/websearch.py): Tavily, Nova when it fails,
and the quote check. No network: Tavily and the pages are an httpx mock,
Nova and the model are fakes."""

import json
import unittest

import httpx

from napkin.model import ModelError
from napkin.research import ResearchError
from napkin.websearch import WebResearch, today

PAGE = ("# Population and Migration Estimates April 2026\n\nPublished: 24 August 2026\n\n"
        "The population of Ireland was estimated at **5,526,000** in April 2026, an increase of 66,900 "
        "(1.2%) on April 2025.\n\nNet migration was 59,700 in the year to April 2026.")


def tavily_body(results):
    return {"query": "q", "results": results, "usage": {"credits": 2}}


CSO = {"url": "https://www.cso.ie/en/pme2026/", "title": "Population and Migration Estimates April 2026",
       "content": "The population of Ireland was estimated at 5,526,000 in April 2026, an increase of 66,900 "
                  "(1.2%) on April 2025. [...] Net migration was 59,700 in the year to April 2026.",
       "raw_content": PAGE, "score": 0.9}
FORUM = {"url": "https://forum.example.com/t/1", "title": "Ireland population?", "content": "I think it's 6m",
         "raw_content": "I think it's 6m lol", "score": 0.4}


class FakeModel:
    def __init__(self, reply=None, error=None):
        self.reply, self.error, self.calls = reply, error, []

    def call(self, purpose, system, payload, schema, *, usage, attribution, **kw):
        self.calls.append((purpose, payload))
        if self.error:
            raise self.error
        usage.add(100, 20, model="fake-model")
        return self.reply(payload) if callable(self.reply) else self.reply


class FakeNova:
    def __init__(self, urls=(), error=None):
        self.urls, self.error, self.calls = list(urls), error, 0

    def converse(self, **kw):
        self.calls += 1
        assert kw["toolConfig"]["tools"][0]["systemTool"]["name"] == "nova_grounding"
        if self.error:
            raise self.error
        return {"output": {"message": {"content": [
            {"text": "Ireland has 5.5m people"},
            *({"citationsContent": {"citations": [{"location": {"web": {"url": u, "domain": "x"}}}]}}
              for u in self.urls)]}}}


def transport(tavily=None, tavily_status=200, pages=None, seen=None):
    pages = pages or {}

    def handle(req: httpx.Request):
        if seen is not None:
            seen.append(req)
        if req.url.host == "api.tavily.com":
            if tavily_status != 200:
                return httpx.Response(tavily_status, json={"detail": {"error": "Usage limit exceeded"}})
            return httpx.Response(200, json=tavily)
        body = pages.get(str(req.url))
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, text=body, headers={"content-type": "text/html; charset=utf-8"})
    return httpx.MockTransport(handle)


def research(port, **kw):
    return port.search("Ireland population 2026", "market_structure", "IE", max_sources=kw.get("max_sources", 6))


class TavilyTest(unittest.TestCase):
    def test_keeps_chosen_passages_checked_against_the_page(self):
        seen = []
        model = FakeModel({"sources": [{"n": 1, "publisher": "Central Statistics Office", "lines": [1, 2],
                                        "published_at": "2026-08-24"}]})
        port = WebResearch(model, "tvly-test", nova=False, transport=transport(tavily_body([CSO, FORUM]), seen=seen))
        out = research(port)
        [src] = out["sources"]
        self.assertEqual(src["url"], "https://www.cso.ie/en/pme2026")
        self.assertEqual(src["publisher"], "Central Statistics Office")
        self.assertEqual(src["published_at"], "2026-08-24")
        self.assertEqual(src["retrieved_at"], today())
        self.assertEqual(len(src["excerpts"]), 2)
        self.assertTrue(src["id"].startswith("src_"))
        self.assertEqual(out["trace"]["backend"], "tavily")
        self.assertEqual(out["trace"]["cost_usd"], 0.016)
        self.assertEqual(out["trace"]["dropped"]["not_chosen"], 1)
        # the request: advanced depth, the page text, the market's country
        body = json.loads(seen[0].content)
        self.assertEqual((body["search_depth"], body["include_raw_content"], body["country"]),
                         ("advanced", "markdown", "ireland"))
        self.assertEqual(seen[0].headers["authorization"], "Bearer tvly-test")
        # the model saw passages and the top of the page, not the whole page
        payload = model.calls[0][1]
        self.assertEqual(len(payload["candidates"][0]["lines"]), 2)
        self.assertNotIn("page_text", payload["candidates"][0])

    def test_a_quote_not_on_the_page_is_dropped(self):
        bad = dict(CSO, content="The population of Ireland was 7 million.")
        model = FakeModel({"sources": [{"n": 1, "publisher": "CSO", "lines": [1]}]})
        port = WebResearch(model, "k", nova=False, transport=transport(tavily_body([bad])))
        out = research(port)
        self.assertEqual(out["sources"], [])
        # the sentence was never offered: it is not on the page
        self.assertEqual(model.calls[0][1]["candidates"][0]["lines"], [])

    def test_formatting_does_not_count_but_every_word_does(self):
        # Tavily's passage drops the page's markdown; the words and figures are the same
        page = ("## New car registrations\n\nThe Society of the Irish Motor Industry (**SIMI**) released "
                "![logo](https://x/y.png) its figures: | Electric | **23.67%** |\n|---|---|\n")
        same = dict(CSO, url="https://www.simi.ie/a", raw_content=page,
                    content="## The Society of the Irish Motor Industry (SIMI) released its figures: Electric 23.67%")
        changed = dict(same, url="https://www.simi.ie/b", content="The Society of the Irish Motor Industry (SIMI) "
                                                                   "released its figures: Electric 32.67%")
        model = FakeModel({"sources": [{"n": 1, "publisher": "SIMI", "lines": [1]},
                                       {"n": 2, "publisher": "SIMI", "lines": [1]}]})
        port = WebResearch(model, "k", nova=False, transport=transport(tavily_body([same, changed])))
        out = research(port)
        [src] = out["sources"]
        self.assertEqual(src["excerpts"], ["The Society of the Irish Motor Industry (SIMI) released its figures: "
                                           "Electric 23.67%"])
        self.assertEqual(model.calls[0][1]["candidates"][1]["lines"], [])  # 32.67% is not what the page says

    def test_a_long_passage_is_cut_at_a_sentence_not_dropped(self):
        long = " ".join(f"Sentence {i} says the share was {i}.{i}% in 2026." for i in range(60))
        src = dict(CSO, url="https://www.cso.ie/long", content=long, raw_content=long)
        model = FakeModel({"sources": [{"n": 1, "publisher": "CSO", "lines": list(range(1, 61))}]})
        port = WebResearch(model, "k", nova=False, transport=transport(tavily_body([src])))
        quote = research(port)["sources"][0]["excerpts"][0]
        self.assertLessEqual(len(quote), 1500)
        self.assertTrue(quote.endswith("in 2026."))
        self.assertTrue(long.startswith(quote))

    def test_social_posts_are_not_searched(self):
        seen = []
        port = WebResearch(FakeModel({"sources": []}), "k", nova=False, transport=transport(tavily_body([]), seen=seen))
        research(port)
        self.assertIn("facebook.com", json.loads(seen[0].content)["exclude_domains"])

    def test_a_date_the_page_does_not_show_is_left_out(self):
        model = FakeModel({"sources": [{"n": 1, "publisher": "CSO", "lines": [1], "published_at": "2024-01-01"}]})
        port = WebResearch(model, "k", nova=False, transport=transport(tavily_body([CSO])))
        self.assertIsNone(research(port)["sources"][0]["published_at"])

    def test_nothing_found_is_an_honest_empty_answer(self):
        model = FakeModel({"sources": []})
        port = WebResearch(model, "k", nova=False, transport=transport(tavily_body([])))
        self.assertEqual(research(port)["sources"], [])
        self.assertEqual(model.calls, [])  # no candidates, no model call

    def test_the_cap_holds(self):
        many = [dict(CSO, url=f"https://www.cso.ie/p{i}") for i in range(5)]
        model = FakeModel({"sources": [{"n": i, "publisher": "CSO", "lines": [1]} for i in range(1, 6)]})
        port = WebResearch(model, "k", nova=False, transport=transport(tavily_body(many)))
        self.assertEqual(len(research(port, max_sources=2)["sources"]), 2)

    def test_tavily_failing_without_nova_is_an_error(self):
        port = WebResearch(FakeModel({"sources": []}), "k", nova=False, transport=transport(tavily_status=432))
        with self.assertRaisesRegex(ResearchError, "432: Usage limit exceeded"):
            research(port)

    def test_the_model_failing_is_an_error_not_an_empty_answer(self):
        port = WebResearch(FakeModel(error=ModelError("no", "server")), "k", nova=False,
                           transport=transport(tavily_body([CSO])))
        with self.assertRaises(ResearchError):
            research(port)


class NovaTest(unittest.TestCase):
    HTML = ("<html><head><title>PME 2026</title><script>var x='5 billion'</script></head><body><nav>Menu</nav>"
            "<p>Published 24 August 2026</p><p>The population of Ireland was estimated at 5,526,000 in April "
            "2026.</p><p>This release presents estimates of the population classified by age, sex and region, "
            "and of the components of population change: births, deaths and migration.</p></body></html>")

    def test_tavily_failing_falls_over_to_nova_and_reads_the_pages(self):
        nova = FakeNova(["https://www.cso.ie/pme", "https://gone.example.com/x"])
        model = FakeModel({"sources": [{"n": 1, "publisher": "CSO", "published_at": "2026-08-24", "quotes": [
            "The population of Ireland was estimated at 5,526,000 in April 2026.",
            "Ireland's population is 9 million."]}]})
        port = WebResearch(model, "k", nova_client=nova,
                           transport=transport(tavily_status=500, pages={"https://www.cso.ie/pme": self.HTML}))
        out = research(port)
        self.assertEqual(out["trace"]["backend"], "nova-grounding")
        self.assertIn("Tavily returned 500", out["trace"]["failover"])
        [src] = out["sources"]
        self.assertEqual(src["title"], "PME 2026")
        self.assertEqual(src["excerpts"], ["The population of Ireland was estimated at 5,526,000 in April 2026."])
        self.assertEqual(out["trace"]["dropped"]["quote_not_on_page"], 1)
        # the model read the page text (script and nav left out), the gone page was skipped
        cand = model.calls[0][1]["candidates"]
        self.assertEqual(len(cand), 1)
        self.assertNotIn("5 billion", cand[0]["page_text"])
        self.assertNotIn("Menu", cand[0]["page_text"])

    def test_nova_only_needs_no_tavily_key(self):
        nova = FakeNova([])
        port = WebResearch(FakeModel({"sources": []}), None, nova_client=nova, transport=transport())
        self.assertEqual(research(port)["sources"], [])
        self.assertEqual(nova.calls, 1)

    def test_both_failing_says_both(self):
        port = WebResearch(FakeModel({"sources": []}), "k", nova_client=FakeNova(error=RuntimeError("denied")),
                           transport=transport(tavily_status=503))
        with self.assertRaisesRegex(ResearchError, "Tavily returned 503.*Nova grounding failed"):
            research(port)


if __name__ == "__main__":
    unittest.main()
