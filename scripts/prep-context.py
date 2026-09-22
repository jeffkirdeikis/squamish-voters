#!/usr/bin/env python3
"""Shape research/context.json into data/context.json for the site build."""
import json, os, re, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
c = json.load(open(os.path.join(ROOT, "research", "context.json")))
KEYMAP = {"growth_development": "growth", "policing_safety": "policing", "woodfibre_lng_climate": "environment_lng",
          "transportation_transit": "transportation", "economy_jobs_downtown_tourism": "economy"}
issues = []
for i in c["issues"]:
    i["key"] = KEYMAP.get(i["key"], i["key"])
    sentences = re.split(r"(?<=[.!?])\s+", i["explainer"])
    i["teaser"] = sentences[0]
    i["short_explainer"] = " ".join(sentences[:2])
    issues.append(i)
out = {
    "updated": datetime.date.today().strftime("%B %-d, %Y"),
    "contact_email": "squamishvoters@gmail.com",
    "key_dates": [
        {"date": "Oct 7, 8, 10 & 15", "label": "Advance voting days"},
        {"date": "Saturday, Oct 17", "label": "Election day · 8 a.m. to 8 p.m. · Brennan Park"},
        {"date": "Anyone can vote by mail", "label": "Ballots must arrive by 8 p.m. on Oct 17"},
    ],
    "trustees": ["April Lowe", "Leanne Roderick", "Dalia Shehata", "Lisa Turpin", "Robyn Walters"],
    "voting": c["voting"], "events": c["events"], "coverage_hubs": c["coverage_hubs"], "issues": issues,
}
json.dump(out, open(os.path.join(ROOT, "data", "context.json"), "w"), indent=1, ensure_ascii=False)
print("context ok:", len(issues), "issues")
