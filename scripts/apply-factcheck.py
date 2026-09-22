#!/usr/bin/env python3
"""Apply fact-check findings (must_fix + should_fix) to data/candidates.json. Prints anything it cannot apply automatically."""
import json, re, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(ROOT, "data", "candidates.json")
cands = json.load(open(path)); by = {c["name"]: c for c in cands}
items = []
for f in sys.argv[1:]: items += json.load(open(f))
items = [i for i in items if i.get("severity") in ("must_fix", "should_fix")]
deletions, manual, applied = [], [], 0
for it in items:
    c = by.get(it["candidate"]); field = it["field"]; val = it.get("suggested_value")
    if not c: manual.append(it); continue
    m = re.fullmatch(r"(supports|opposes)\[(\d+)\](?:\.(\w+))?", field)
    if m:
        lst, idx, sub = c[m[1]], int(m[2]), m[3]
        if idx >= len(lst): manual.append(it); continue
        if val is None and not sub: deletions.append((c, m[1], idx)); applied += 1
        elif isinstance(val, dict): lst[idx].update(val); applied += 1
        elif isinstance(val, str): lst[idx][sub or "text"] = val; applied += 1
        else: manual.append(it)
        continue
    m = re.fullmatch(r"quiz_answers\.(q\d+)", field)
    if m and (val is None or isinstance(val, int)): c["quiz_answers"][m[1]] = val; applied += 1; continue
    m = re.fullmatch(r"stances\.(\w+)\.(\w+)", field)
    if m and m[1] in c["stances"] and (val is None or isinstance(val, str)):
        if val is None: c["stances"][m[1]].pop(m[2], None)
        else: c["stances"][m[1]][m[2]] = val
        applied += 1; continue
    m = re.fullmatch(r"compass\.(\w+)", field)
    if m and val is not None: c["compass"][m[1]] = val; applied += 1; continue
    if field in ("occupation_background", "tagline") and isinstance(val, str): c[field] = val; applied += 1; continue
    manual.append(it)
for c, lst, idx in sorted(deletions, key=lambda d: -d[2]): del c[lst][idx]
json.dump(cands, open(path, "w"), indent=1, ensure_ascii=False)
print("applied", applied, "| manual", len(manual))
for it in manual: print("\nMANUAL:", json.dumps(it, ensure_ascii=False)[:900])
