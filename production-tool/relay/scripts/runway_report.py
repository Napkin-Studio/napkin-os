"""The test pack's results page: runway-testpack.json in, a self-contained index.html out.

The saved files are linked by the relative paths the results file holds, so the page sits in the
same folder as the results file. No script, no external asset.
"""

from __future__ import annotations

from html import escape as e

CSS = """
:root { --bg:#fafaf8; --fg:#1d1d1b; --muted:#6b6b66; --card:#fff; --line:#dcdcd6; --ok:#1a7f45; --bad:#b3261e; --warn:#8a5a00; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#161615; --fg:#ececea; --muted:#9a9a94; --card:#1f1f1d; --line:#35352f; --ok:#5fcf8c; --bad:#f2837b; --warn:#e0b050; }
}
* { box-sizing: border-box; }
body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:15px/1.45 system-ui, sans-serif; max-width:1100px; margin-inline:auto; }
h1 { font-size:1.3rem; margin:0 0 4px; } h2 { font-size:1.1rem; margin:0 0 6px; }
section { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px; margin:14px 0; }
.muted { color:var(--muted); font-size:.9rem; } .ok { color:var(--ok); } .bad { color:var(--bad); } .warn { color:var(--warn); }
.grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin:8px 0; }
.row3 { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:6px; margin:6px 0; }
figure { margin:0; } figcaption { font-size:.8rem; color:var(--muted); word-break:break-word; }
img, video { max-width:100%; height:auto; display:block; border-radius:4px; background:var(--line); }
.edit { border-top:1px solid var(--line); padding-top:8px; margin-top:8px; }
"""


def media(path: str, caption: str = "") -> str:
    src = e(path, quote=True)
    tag = (f'<video controls preload="metadata" src="{src}"></video>' if path.endswith(".mp4")
           else f'<a href="{src}"><img loading="lazy" src="{src}" alt="{e(caption)}"></a>')
    return f"<figure>{tag}<figcaption>{e(caption)}</figcaption></figure>"


def pct(x) -> str:
    return "?" if x is None else f"{x * 100:.1f}%"


def money(x) -> str:
    return "$?" if x is None else f"${x:.2f}"


def job_card(rec: dict) -> str:
    state = rec["state"]
    cls = "ok" if state == "done" else "bad" if state == "failed" else "warn"
    line = (f'<b>{e(rec["label"])}</b> <span class="{cls}">{e(state)}</span> '
            f'<span class="muted">{e(rec.get("model", ""))} · {rec.get("latency_s", 0)} s · {money(rec.get("cost_usd"))}</span>')
    err = rec.get("error")
    note = f'<div class="bad">{e(err["message"])}</div>' if err else ""
    if rec.get("reason"):
        note += f'<div class="warn">{e(rec["reason"])}</div>'
    note += "".join(f'<div class="bad">download failed: {e(m)}</div>' for m in rec.get("download_errors", []))
    files = "".join(media(f, rec["label"]) for f in rec.get("files", []))
    return f"<div>{line}{note}{files}</div>"


def jobs_grid(recs: list[dict]) -> str:
    return '<div class="grid">' + "".join(job_card(r) for r in recs) + "</div>"


def section_a(it: dict) -> str:
    return ('<p><b>Verdict: needs eyes.</b> Was the reference honoured with the @tag, and without it? '
            "Compare the two.</p>" + jobs_grid(it.get("jobs", [])))


def section_b(it: dict) -> str:
    head = it.get("head") or {}
    return f'<p>HEAD: <code>{e(str(head))}</code>. Job passed: {e(str(it.get("passed")))}</p>' + jobs_grid(it.get("jobs", []))


def section_c(it: dict) -> str:
    gate = it.get("gate")
    out = ""
    if gate:
        out += (f'<p>{gate["count"]} of {gate["of"]} inside the box, need {gate["need"]}: '
                f'<b class="{"ok" if gate["passed"] else "bad"}">{"PASS" if gate["passed"] else "FAIL"}</b> '
                f'<span class="muted">({e(it.get("gate_note", ""))})</span></p>')
    for row in it.get("edits", []):
        m, files = row.get("metrics"), row.get("files") or {}
        head = (f'<b>edit {row["index"] + 1}</b> <span class="{"ok" if row.get("ok") else "bad"}">'
                f'{"inside the box" if row.get("ok") else "gate: no"}</span>')
        if m:
            head += (f' <span class="muted">outside changed {pct(m["outside_changed_fraction"])} · mean diff '
                     f'{m["mean_abs_diff"]:.1f} · inside changed {pct(m["inside_changed_fraction"])}</span>')
        note = (row.get("reason") or row.get("skipped") or (row.get("error") or {}).get("message")
                or row.get("save_error") or "")
        shots = "".join(media(files[k], c) for k, c in (("original", "original"), ("raw_edit", "model output"),
                                                         ("final", "final (ungated paste-back)" if row.get("final_ungated")
                                                          else "final (pasted back)")) if k in files)
        out += (f'<div class="edit">{head}<div class="muted">{e(note)}</div><div class="row3">{shots}</div></div>')
    return out


def section_d(it: dict) -> str:
    jobs = it.get("jobs", [])
    sheet = [r for r in jobs if r["label"] == "sheet"]
    views = [r for r in jobs if r["label"] != "sheet"]
    cost = it.get("cost_usd") or {}
    return (f'<p><b>Verdict: needs eyes.</b> Does the sheet keep one character across the four views, and do the '
            f'separate views match it? Cost: sheet {money(cost.get("sheet"))}, per view {money(cost.get("per_view"))}.</p>'
            "<h3>One sheet</h3>" + jobs_grid(sheet) + "<h3>One call per view</h3>" + jobs_grid(views))


def section_e(it: dict) -> str:
    return "<p><b>Verdict: needs eyes.</b> Which clip is best?</p>" + jobs_grid(it.get("jobs", []))


def section_f(it: dict) -> str:
    stats = (f'<p>{it.get("done")} done of {it.get("submitted")} submitted. p50 {it.get("p50_s")} s, p95 {it.get("p95_s")} s; '
             f'throttled {it.get("throttled_s_total")} s over {it.get("throttled_jobs")} jobs.</p>')
    return stats + jobs_grid(it.get("jobs", []))


def section_g(it: dict) -> str:
    return f'<p>Concurrency: <code>{e(str(it.get("concurrency")))}</code></p>'


SECTIONS = {"a": section_a, "b": section_b, "c": section_c, "d": section_d, "e": section_e, "f": section_f,
            "g": section_g}


def build_report(res: dict, titles: dict) -> str:
    parts = []
    for name, it in res["items"].items():
        status = it["status"]
        body = ""
        if status in ("blocked", "error", "skipped", "incomplete"):
            reason = it.get("reason") or it.get("error") or ""
            body += f'<p class="bad"><b>{e(status)}</b>{": " + e(str(reason)) if reason else ""}</p>'
        if status != "blocked" and status != "error":
            body += SECTIONS[name](it)
        parts.append(f'<section id="{e(name)}"><h2>{e(name)}  {e(titles.get(name, ""))} '
                     f'<span class="muted">({e(status)})</span></h2>{body}</section>')
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1"><title>Runway test pack</title>'
            f"<style>{CSS}</style></head><body><h1>Runway test pack</h1>"
            f'<p class="muted">{e(res["generated_at"])} · ${res["spent_usd"]:.2f} spent of ${res["max_usd"]:.2f} cap</p>'
            + "".join(parts) + "</body></html>\n")
