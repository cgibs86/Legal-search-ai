#!/usr/bin/env python3
"""
One-off curation of demo fixtures from raw CourtListener v4 API responses captured on
2026-09-30. Output fixtures keep the real API response shape so they flow through the
same schemas and mappers as live data.

Privacy rules applied (see README "Demo fixtures"):
  * Records whose caption names an individual (not an organization or government body)
    are dropped entirely.
  * Individual names inside party lists of kept records are replaced with a visible
    redaction marker. Attorneys of record are kept (professional capacity).
  * Email addresses are stripped from any document text; document text is truncated.
  * Long arrays are truncated. Whitespace in snippets is normalized.
Nothing is invented: every kept value comes from the captured API response.
"""
import json, re, sys, pathlib

RAW = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])

ORG = re.compile(r"\b(inc|incorporated|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|l\.?p|llp|plc|p\.l\.c|ag|b\.v|n\.v|s\.a|gmbh|group|holdings|association|committee|institute|university|foundation|bank|trust|fund|services|systems|technologies|technology|entertainment|studios?|games|media|news|government|united states|usa|u\.s\.a|state of|commonwealth|county|city|department|agency|commission|board|office|district|authority|council|organizations?|press|reporters|software|platforms|electronics|interactive|pension|retirement|networks?|labs|ab|pty|partners|capital|ventures|enterprises|industries|international|coalition|union|center|centre|society|league|hospital|school|college|republic|tribe|litigation|in re|google|apple|amazon|microsoft|netflix|spotify|nvidia|roblox|samsung|valve|x corp|paypal|visa|lyft|match group|meta|nintendo|sony|mojang|tencent|elsevier|oracle|deutsche telekom|british american tobacco|intuitive surgical|phantomalert|kabam|gearbox|digital content next|staco link|pure sweat basketball)\b", re.I)
PLACEHOLDER = re.compile(r"\b(does?|john doe|jane doe|unknown)\b", re.I)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")

def is_org(name: str) -> bool:
    return bool(ORG.search(name or ""))

def caption_sides(case_name: str):
    parts = re.split(r"\s+v\.?\s+|\s+vs\.?\s+", case_name or "", flags=re.I)
    return [p for p in parts if p.strip()]

def caption_ok(case_name: str) -> bool:
    if re.match(r"^\s*(in re|in the matter of|usa v\.|united states v\.)", case_name or "", re.I):
        return True
    sides = caption_sides(case_name)
    return len(sides) >= 1 and all(is_org(s) for s in sides)

def redact_party(name: str) -> str:
    if is_org(name) or PLACEHOLDER.search(name or ""):
        return name
    return "[Individual party — name withheld in demo fixture]"

def ws(s):
    return re.sub(r"\s+", " ", s or "").strip()

def curate_docket_result(r, max_names=25):
    r = dict(r)
    r["party"] = [redact_party(p) for p in (r.get("party") or [])][:max_names]
    r["attorney"] = (r.get("attorney") or [])[:max_names]
    r["firm"] = (r.get("firm") or [])[:max_names]
    # id arrays are not guaranteed to be parallel to the name arrays once truncated
    r["party_id"], r["attorney_id"], r["firm_id"] = [], [], []
    docs = []
    for d in (r.get("recap_documents") or [])[:3]:
        d = dict(d)
        d["snippet"] = EMAIL.sub("[email removed]", ws(d.get("snippet")))[:500]
        docs.append(d)
    if "recap_documents" in r:
        r["recap_documents"] = docs
    r["caseName"] = re.sub(r"<[^>]+>.*$", "", r.get("caseName") or "").strip()
    return r

def load(name):
    return json.load(open(RAW / name))

def page(results, count=None):
    return {"count": count if count is not None else len(results), "next": None, "previous": None, "results": results}

hand = load("handwritten.json")
meta = {
    "captured_at": "2026-09-30",
    "source": "CourtListener REST API v4 (https://www.courtlistener.com/api/rest/v4/)",
    "notice": "DEMO FIXTURE — a curated snapshot of public court records. Not live data. Individual party names withheld; arrays truncated; whitespace normalized.",
}

# Dockets where "Epic Games" is a party, merged from the party search and the attorney search.
party_raw = load("search-r-party-epic.json")["results"]
atty_raw = load("search-d-atty-bornstein.json")["results"]
epic_dockets = [curate_docket_result(r) for r in party_raw if caption_ok(r.get("caseName"))]
bornstein = [curate_docket_result(r) for r in atty_raw if caption_ok(re.sub(r"<[^>]+>.*$", "", r.get("caseName") or ""))]

out = {
    "meta": meta,
    "search_r_party_epic": page(epic_dockets),
    "search_d_attorney_bornstein": page(bornstein),
    "search_d_docket_epic_v_apple": hand["search-d-docket-4-20-cv-05640"],
    "search_o_caption_epic": hand["search-o-caption-epic"],
    "search_o_mention_epic": hand["search-o-mention-epic"],
    "search_rd_mention_epic": hand["search-rd-mention-epic"],
    "docket_17442392": hand["docket-17442392"],
    "parties_17442392": hand["parties-17442392"],
}

entries = load("docket-entries-17442392.json")["results"]
clean_entries = []
for e in entries:
    e = dict(e)
    docs = []
    for d in e.get("recap_documents") or []:
        d = {k: d.get(k) for k in ["id", "absolute_url", "attachment_number", "date_created", "date_modified", "date_upload", "description", "document_number", "document_type", "filepath_local", "is_available", "is_sealed", "ocr_status", "pacer_doc_id", "page_count", "plain_text"]}
        d["plain_text"] = EMAIL.sub("[email removed]", ws(d.get("plain_text")))[:900]
        docs.append(d)
    e["recap_documents"] = docs
    clean_entries.append(e)
out["docket_entries_17442392"] = page(clean_entries)

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "courtlistener-snapshot.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
print("epic dockets kept:", len(epic_dockets), [r["caseName"] for r in epic_dockets])
print("bornstein dockets kept:", len(bornstein), [r["caseName"] for r in bornstein])
print("entries:", len(clean_entries))
