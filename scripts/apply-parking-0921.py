#!/usr/bin/env python3
"""Sept 21 2026: PARKING becomes its own topic.
Adds q36-q38, moves q25 to the parking issue, writes each candidate's parking stance and
scores from research/parking-0921.json, and adds the Parking explainer to data/context.json.
Editor's calls (different from the researcher's proposals) are noted inline. Run once."""
import json, shutil
R = json.load(open('research/parking-0921.json'))
shutil.copy('data/candidates.json', 'data/candidates.pre-parking-0921.json')

# ---- questions ----
Q = json.load(open('data/questions.json'))
assert not any(q['id'] == 'q37' for q in Q), 'already applied'
for q in Q:
    if q['id'] == 'q25':
        q.update(issue='parking', topic='Parking',
                 why='The District’s 2023 study recommended paid parking on Cleveland and Second avenues. Charging frees up spaces and raises money; some worry it pushes shoppers away. Council has put it off until at least 2027.')
new = [
 {"id": "q37", "issue": "parking", "topic": "Parking", "short": "Parking in new buildings",
  "text": "New buildings should have to provide enough parking for the people who live there, instead of being approved with less.",
  "why": "Council decides how much parking a new building needs. It can cut that number for one project (a “variance”), let the builder pay cash instead of building stalls (“cash-in-lieu”), or drop the requirement altogether, as it has near future frequent bus routes. Less parking makes homes cheaper to build and suits people without cars. Critics say the cars end up on the street.",
  "core": True},
 {"id": "q36", "issue": "parking", "topic": "Parking", "short": "More public parking",
  "text": "Downtown Squamish needs more public parking, and the District should get it built.",
  "why": "A 2020 study priced a downtown parkade at $10 million to $25 million. Supporters say visitor fees or developers’ money could pay for it. Others say downtown has enough spaces and the real problem is how they are managed.",
  "core": False},
 {"id": "q38", "issue": "parking", "topic": "Parking", "short": "Locals park free",
  "text": "If Squamish brings in paid parking, residents should park free and only visitors should pay.",
  "why": "In 2025 council voted 5–2 to drop the resident pass from the Darrell Bay paid-parking pilot, so locals pay there too. Some candidates want free permits for residents; others say exempting locals defeats the purpose of managing demand.",
  "core": False},
]
i25 = next(i for i, q in enumerate(Q) if q['id'] == 'q25')
q25 = Q.pop(i25)
i11 = next(i for i, q in enumerate(Q) if q['id'] == 'q11')
Q.insert(i11 + 1, new[0])                     # core: sits after regional transit in the quiz
iq = next(i for i, q in enumerate(Q) if q['id'] == 'q26')
Q[iq:iq] = [q25, new[1], new[2]]              # non-core parking statements stay together
json.dump(Q, open('data/questions.json', 'w'), indent=1, ensure_ascii=False)

# ---- candidates ----
SCORES = {k: dict(v['scores']) for k, v in R['candidates'].items()}
# Editor's calls:
SCORES['daniel-deal']['q25'] = None       # "visitors pay, locals free" is q38, not a yes/no on paid parking
SCORES['sean-goodwin']['q36'] = None      # reporter's paraphrase; no location, no who-pays
Q38 = {'daniel-deal': 2, 'chris-ryan': 1, 'andrew-hamilton': -1, 'chris-pettingill': -1}
Q38_NOTE = {
 'daniel-deal': 'q38 +2: Chief, Sept 2026 — paid parking "but not for locals", free permit for residents.',
 'chris-ryan': 'q38 +1: press release — Loggers Lane parking "paid for by visitors but available to our residents and employees with a permit" (one site, so +1).',
 'andrew-hamilton': 'q38 -1: moved the Mar 11 2025 amendment deleting the resident pass from the Darrell Bay pilot (minutes: squamish.civicweb.net/document/251515/).',
 'chris-pettingill': 'q38 -1: seconded that amendment; Dec 2024 warned against expecting that "it\'s just tourists that should pay".',
}
DIRECT = {'sarah-ellis', 'shaun-veltkamp'}    # their q25 is their own answer — never overwrite
C = json.load(open('data/candidates.json'))
L = C if isinstance(C, list) else C['candidates']
for c in L:
    r = R['candidates'][c['slug']]
    none = r['position'].lower().startswith('no public position')
    thin = c['slug'] in ('ian-brown', 'luc-perreault')
    c.setdefault('stances', {})['parking'] = {
        'position': r['position'], 'summary': r['summary'], 'quote': r.get('quote') or None,
        'source_url': r.get('source_url'), 'confidence': 'none' if none else ('low' if thin else r['confidence']),
    }
    qa = c.setdefault('quiz_answers', {})
    for qid in ('q25', 'q36', 'q37'):
        if qid == 'q25' and c['slug'] in DIRECT: continue
        qa[qid] = SCORES[c['slug']].get(qid)
    qa['q38'] = Q38.get(c['slug'])
    notes = []
    for qid, e in (r.get('score_evidence') or {}).items():
        if not isinstance(qa.get(qid), int) or (qid == 'q25' and c['slug'] in DIRECT): continue
        notes.append(f"{qid} {qa[qid]:+d}: {e.get('quote', '')[:220]} ({e.get('source_url')})")
    if c['slug'] in Q38_NOTE: notes.append(Q38_NOTE[c['slug']])
    if notes:
        c['research_notes'] = (c.get('research_notes') or '') + ' PARKING (Sept 21 2026, research/parking-0921.json): ' + ' | '.join(notes)
    have = {x.get('url') if isinstance(x, dict) else x for x in (c.get('sources') or [])}
    for u in [r.get('source_url')] + (r.get('other_sources') or []):
        if u and u not in have and 'squamishvoters.com' not in u:
            c.setdefault('sources', []).append({'title': 'On parking', 'url': u}); have.add(u)
json.dump(C, open('data/candidates.json', 'w'), indent=1, ensure_ascii=False)
print('scores:', {c['slug']: {k: c['quiz_answers'].get(k) for k in ('q25', 'q36', 'q37', 'q38')} for c in L if any(isinstance(c['quiz_answers'].get(k), int) for k in ('q25', 'q36', 'q37', 'q38'))})
