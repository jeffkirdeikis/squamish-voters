#!/usr/bin/env python3
"""One-time merge of research/*.json into data/candidates.json (the editable source of truth).
WARNING: data/candidates.json has since been hand-corrected by two fact-check passes (research/factcheck*.json).
Re-running this DISCARDS those corrections. Re-running overwrites data/candidates.json — after hand edits, edit candidates.json directly instead."""
import json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = []
# Short display taglines where the researcher's field carried editorial notes. Quotes are the candidate's own words.
TAGLINE = {
 "eric-andersen": "“A vote for good jobs close to home.”",
 "john-french": "“Experienced. Dedicated to Squamish.”",
 "andrew-hamilton": "“Squamish is amazing.” Open consultation, respectful debate, transparent decisions.",
 "chris-pettingill": "“Focus on what matters.” Independent; accepts no campaign donations.",
 "ian-brown": "Seniors and arts advocate focused on housing Squamish can afford, long-term care, arts and recreation.",
 "sean-goodwin": "Lifelong resident who wants decisions that serve “the community as a whole”.",
 "a-john-lowe": "No platform published yet.",
 "chris-ryan": "No platform published yet.",
 "anders-ourom": "“I have a record of actually accomplishing things.”",
 "laura-prosko": "“A Strong Sense of Community” — headlined by a 2027–28 property tax freeze.",
 "shaun-veltkamp": "“Prepared to do the hard work — we have to make good decisions.”",
 "sarah-ellis": "Community leader and affordable-housing expert who “knows how to bring people together to get things done”.",
}
# Editorial grouping for the "stop / up / out" chart where the researcher's label was the catch-all "Managed mix"
# but the record shows a clear lean. Evidence is in each candidate's growth summary.
GROWTH_GROUP = {"eric-andersen": "slow", "john-french": "up", "andrew-hamilton": "up", "chris-pettingill": "up"}
for f in ["mayor", "incumbents", "groupA", "groupB", "groupC"]:
    p = os.path.join(ROOT, "research", f + ".json")
    if not os.path.exists(p):
        print("missing", p, file=sys.stderr); continue
    for c in json.load(open(p)):
        c["slug"] = re.sub(r"[^a-z0-9]+", "-", c["name"].lower()).strip("-")
        role = c.pop("current_role", None)
        inc = c.get("incumbent")
        if isinstance(inc, dict): role = role or inc.get("role") or inc.get("current_role"); inc = inc.get("value", True)
        if isinstance(inc, str): role = role or inc; inc = not inc.lower().startswith(("false", "no"))
        c["incumbent"] = bool(inc)
        if c["incumbent"]:
            c["incumbent_label"] = "Current councillor"
        photo = "img/%s.jpg" % c["slug"]
        c["photo"] = photo if os.path.exists(os.path.join(ROOT, "public", photo)) else None
        c["tagline"] = TAGLINE.get(c["slug"], c["tagline"])
        if c["slug"] in GROWTH_GROUP: c["growth_group"] = GROWTH_GROUP[c["slug"]]
        out.append(c)
json.dump(out, open(os.path.join(ROOT, "data", "candidates.json"), "w"), indent=1, ensure_ascii=False)
print(len(out), "candidates")
