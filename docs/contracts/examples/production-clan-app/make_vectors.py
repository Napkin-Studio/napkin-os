#!/usr/bin/env python3
"""Writes the vectors beside it. Deterministic: `python3 make_vectors.py` twice gives the same bytes.

Each vector: {vector, covers, description, tenant, session_cookie, documents, steps[]}.
A step: {name, request{method,path,headers,body_base64|body_size}, response{status,headers,body|body_base64|body_subset}}.
Archives are tiny zips holding only manifest.yaml (fixed timestamps); a version is "sha256:" + sha256(bytes).
"""
import base64, hashlib, io, json, pathlib, zipfile

HERE = pathlib.Path(__file__).parent
TENANT = "5b6f3c1e-9d2a-5c4b-8e7f-0a1b2c3d4e5f"
OTHER_TENANT = "7a1d2c3b-4e5f-5a6b-9c8d-0e1f2a3b4c5d"
COOKIE = "napkin_session=vector-session"
APP = "ie.napkin.production"
DOC = "doc-hollow-oak-still"
IDENT = "11111111-2222-4333-8444-555555555555"
NOW = "2026-11-23T10:00:00Z"


def archive(identity, rev, title="Hollow Oak Still", extra=""):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        zi = zipfile.ZipInfo("manifest.yaml", (2026, 11, 23, 10, 0, 0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, f"clan_version: 1\nid: {rev}\ndocument_id: {identity}\ntitle: {title}\n{extra}")
    return buf.getvalue()


def ver(b):
    return "sha256:" + hashlib.sha256(b).hexdigest()


b64 = lambda b: base64.b64encode(b).decode()
B0 = archive(IDENT, "00000000-0000-4000-8000-000000000000")
B1 = archive(IDENT, "00000000-0000-4000-8000-000000000001", extra="rev: one\n")
B2 = archive(IDENT, "00000000-0000-4000-8000-000000000002", extra="rev: two\n")
V0, V1, V2 = ver(B0), ver(B1), ver(B2)
ZIP = "application/vnd.clan+zip"
SAVE = f"/api/t/{TENANT}/d/{DOC}/save"
DOWN = f"/api/t/{TENANT}/d/{DOC}/download"
CONFLICT = {"error": {"code": "conflict", "message": "This project was saved from somewhere else since you opened it."}}


def put(body, if_match, reason=None, cookie=COOKIE, path=SAVE, tenant_path=None):
    h = {"Content-Type": ZIP}
    if if_match is not None:
        h["If-Match"] = f'"{if_match}"'
    if reason:
        h["X-Clan-Reason"] = reason
    if cookie:
        h["Cookie"] = cookie
    r = {"method": "PUT", "path": path, "headers": h}
    if isinstance(body, int):
        r["body_size"] = body
    else:
        r["body_base64"] = b64(body)
    return r


def get(path, cookie=COOKIE):
    return {"method": "GET", "path": path, "headers": {"Cookie": cookie} if cookie else {}}


def doc(app=APP, ident=IDENT, data=B0, template=False, tenant=TENANT, did=DOC):
    return {"tenant": tenant, "id": did, "app_id": app, "identity": ident, "template": template, "title": "Hollow Oak Still", "bytes_base64": b64(data), "version": ver(data), "saved_at": "2026-11-23T09:00:00Z"}


def step(name, request, status, headers=None, body=None, **kw):
    resp = {"status": status, "headers": headers or {}}
    if body is not None:
        resp["body"] = body
    resp.update(kw)
    return {"name": name, "request": request, "response": resp}


def err(code_text):
    return {"error": code_text}


vectors = {}
vectors["save-ok"] = dict(covers=["S0-2", "S1-9", "S1-11"], description="Save over the version the tab opened; the new version is the sha256 of the bytes sent; download returns the same bytes.",
    documents=[doc()], steps=[
        step("save", put(B1, V0, "accept"), 200, {"ETag": f'"{V1}"'}, {"version": V1, "saved_at": NOW, "snapshot": True}),
        step("download", get(DOWN), 200, {"ETag": f'"{V1}"', "X-Saved-At": NOW, "Content-Type": ZIP}, body_base64=b64(B1)),
        step("save again from the new version", put(B2, V1, "interval"), 200, {"ETag": f'"{V2}"'}, {"version": V2, "saved_at": NOW, "snapshot": False}),
    ])
vectors["save-conflict"] = dict(covers=["S0-3", "S1-10"], description="Two saves from V0: the second is refused with the winner's version and nothing is overwritten.",
    documents=[doc()], steps=[
        step("first save wins", put(B1, V0, "manual"), 200, {"ETag": f'"{V1}"'}, {"version": V1, "saved_at": NOW, "snapshot": True}),
        step("second save from V0 loses", put(B2, V0, "interval"), 409, {}, dict(CONFLICT, latest=V1)),
        step("download is the winner", get(DOWN), 200, {"ETag": f'"{V1}"'}, body_base64=b64(B1)),
    ])
OTHER_ID = "99999999-8888-4777-8666-555555555555"
TMPL = "app-production"
vectors["save-refusals"] = dict(covers=["S0-4"], description="Everything the save route refuses; the store is untouched by every step.",
    documents=[doc(), doc(app="ie.napkin.research", did="doc-research", ident=IDENT), doc(template=True, did=TMPL), doc(tenant=OTHER_TENANT, did="doc-elsewhere")], steps=[
        step("no If-Match", put(B1, None), 428, body=err("If-Match is required")),
        step("another app's document", put(B1, V0, path=f"/api/t/{TENANT}/d/doc-research/save"), 422, body=err("not a Production document")),
        step("a template, not an instance", put(B1, V0, path=f"/api/t/{TENANT}/d/{TMPL}/save"), 422, body=err("not a Production document")),
        step("archive of another document identity", put(archive(OTHER_ID, "00000000-0000-4000-8000-0000000000aa"), V0), 422, body=err("archive is not this document")),
        step("unreadable bytes", dict(put(b"not a zip", V0)), 400, body=err("unreadable archive")),
        step("body over 32 MiB", put(32 * 1024 * 1024 + 1, V0), 413, body=err("too large")),
        step("no session", put(B1, V0, cookie=None), 401, body=err("sign in")),
        step("another tenant's document", put(B1, V0, path=f"/api/t/{OTHER_TENANT}/d/doc-elsewhere/save"), 404, body=err("not found")),
        step("missing document", put(B1, V0, path=f"/api/t/{TENANT}/d/doc-missing/save"), 404, body=err("not found")),
        step("still the original", get(DOWN), 200, {"ETag": f'"{V0}"'}, body_base64=b64(B0)),
    ])
vectors["session"] = dict(covers=["S0-9", "S1-16"], description="/api/session carries media_base (a string when configured, null when not) and never a secret. Only the listed fields are asserted (body_subset).",
    documents=[], variants=[
        {"media_base": "https://media.example.test/napkin", "steps": [step("session", get("/api/session"), 200, body_subset={"tenant": TENANT, "media_base": "https://media.example.test/napkin"})]},
        {"media_base": None, "steps": [step("session", get("/api/session"), 200, body_subset={"tenant": TENANT, "media_base": None})]},
    ])
vectors["library-item"] = dict(covers=["S1-1", "S1-13"], description="A Production document in the library is a plain LibraryItem with its client.",
    documents=[dict(doc(), client={"id": "client-hollow-oak", "name": "Hollow Oak"})], steps=[
        step("library", get(f"/api/t/{TENANT}/library"), 200, body_subset={"items": [{"path": DOC, "title": "Hollow Oak Still", "app_id": APP, "client": {"id": "client-hollow-oak", "name": "Hollow Oak"}}]}),
    ])
SP = f"/api/t/{TENANT}/d/doc-brief/spinoff"
brief = dict(doc(app="ie.napkin.brief-maker", did="doc-brief"), client={"id": "client-hollow-oak", "name": "Hollow Oak"})
vectors["spinoff-ok"] = dict(covers=["S1-2", "S1-3"], description="Brief to Production: OpenView whose path is the new doc id; source_uri is doc:<source>@<version>; the client is carried.",
    documents=[brief], installed_apps=[APP], steps=[
        {"name": "spin off", "request": {"method": "POST", "path": SP, "headers": {"Content-Type": "application/json", "Cookie": COOKIE}, "body": {"app_id": APP, "title": "Hollow Oak Still"}},
         "response": {"status": 200, "headers": {}, "body_subset": {"manifest": {"title": "Hollow Oak Still", "source_uri": f"doc:doc-brief@{brief['version']}"}}, "new_document": {"app_id": APP, "client": {"id": "client-hollow-oak", "name": "Hollow Oak"}}}},
    ])
vectors["spinoff-not-installed"] = dict(covers=["S1-3"], description="Target app not installed: 422 with the app id, nothing created.",
    documents=[brief], installed_apps=[], steps=[
        {"name": "spin off", "request": {"method": "POST", "path": SP, "headers": {"Content-Type": "application/json", "Cookie": COOKIE}, "body": {"app_id": "ie.napkin.deck", "title": "x"}},
         "response": {"status": 422, "headers": {}, "body": {"error": "app not installed: ie.napkin.deck"}}},
    ])

ADMIN = "napkin_session=vector-admin"
TR = f"/api/t/{TENANT}"
def req(method, path, body=None, cookie=COOKIE):
    r = {"method": method, "path": path, "headers": {"Cookie": cookie} if cookie else {}}
    if body is not None:
        r["headers"]["Content-Type"] = "application/json"
        r["body"] = body
    return r
UNTIL = "2026-12-23T10:00:00Z"
old = dict(doc(did="doc-old"), trashed_at="2026-10-01T08:00:00Z", restorable_until="2026-10-31T08:00:00Z")
dup = dict(doc(did="doc-dup"), trashed_at="2026-11-01T08:00:00Z", restorable_until="2026-12-01T08:00:00Z")
vectors["trash"] = dict(covers=["S1-8"], description="Delete goes to the agency's Trash, restorable for 30 days; trashed documents leave the library. Purge is admin only and dry by default.",
    admin_cookie=ADMIN, documents=[doc(), doc(did="doc-dup")], trashed=[old, dup], steps=[
        step("delete", req("DELETE", f"{TR}/d/{DOC}"), 200, body={"trashed": True, "restorable_until": UNTIL}),
        step("delete again", req("DELETE", f"{TR}/d/{DOC}"), 404, body=err("not found")),
        step("a template is never deleted", req("DELETE", f"{TR}/d/{TMPL}"), 400, body=err("not a document id")),
        step("trash lists newest first", req("GET", f"{TR}/trash"), 200, body=[
            {"path": DOC, "trashed_at": NOW, "restorable_until": UNTIL},
            {"path": "doc-dup", "trashed_at": "2026-11-01T08:00:00Z", "restorable_until": "2026-12-01T08:00:00Z"},
            {"path": "doc-old", "trashed_at": "2026-10-01T08:00:00Z", "restorable_until": "2026-10-31T08:00:00Z"}]),
        step("library no longer lists it", req("GET", f"{TR}/library"), 200, body_subset={"items": [{"path": "doc-dup"}]}),
        step("restore", req("POST", f"{TR}/d/{DOC}/restore"), 200, body={"restored": True, "path": DOC}),
        step("restore again", req("POST", f"{TR}/d/{DOC}/restore"), 404, body=err("not found")),
        step("restore over an id already in the library", req("POST", f"{TR}/d/doc-dup/restore"), 409, body=err("already in the library")),
        step("another agency's path", req("DELETE", f"/api/t/{OTHER_TENANT}/d/{DOC}"), 404, body=err("not found")),
        step("purge needs an admin", req("POST", f"{TR}/trash/purge", {"dry_run": False}), 403, body=err("admins only")),
        step("dry run lists and removes nothing", req("POST", f"{TR}/trash/purge", {"dry_run": True}, ADMIN), 200, body={"dry_run": True, "older_than_days": 30, "purged": ["doc-old"]}),
        step("an empty body is a dry run", req("POST", f"{TR}/trash/purge", None, ADMIN), 200, body={"dry_run": True, "older_than_days": 30, "purged": ["doc-old"]}),
        step("purge", req("POST", f"{TR}/trash/purge", {"dry_run": False}, ADMIN), 200, body={"dry_run": False, "older_than_days": 30, "purged": ["doc-old"]}),
        step("purged is gone", req("POST", f"{TR}/d/doc-old/restore"), 404, body=err("not found")),
    ])

for name, v in vectors.items():
    out = {"vector": name, "tenant": TENANT, "now": NOW, "session_cookie": COOKIE, **v}
    (HERE / f"{name}.json").write_text(json.dumps(out, indent=2, sort_keys=False) + "\n")
print("wrote", len(vectors))
