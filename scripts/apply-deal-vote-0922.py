# Records the Sept 22, 2026 council vote on the Woodfibre LNG 10-year tax agreement (q23). Run once.
import json
SRC = 'https://www.squamishreporter.com/2026/09/23/squamish-council-rejects-woodfibre-lng-tax-deal/'
VOTE = 'On Sept. 22, 2026 council voted 5–2 not to give the proposed 10-year Woodfibre LNG tax agreement its first three readings'
REASON = {
 'jenna-stoner': (-2, 'opposes', f'The proposed 10-year Woodfibre LNG tax agreement: moved the motion to reject it ({VOTE}), saying the payments would not rise with inflation and the District had no projects ready to build, which exposed it to rising costs'),
 'andrew-hamilton': (-2, 'opposes', f'The proposed 10-year Woodfibre LNG tax agreement: voted to reject it ({VOTE}), saying fixing the company’s contribution would not make the community’s own future costs certain'),
 'chris-pettingill': (-2, 'opposes', f'The proposed 10-year Woodfibre LNG tax agreement: voted to reject it ({VOTE}), saying regular taxation gives a clearer public process through the annual budget'),
 'eric-andersen': (2, 'supports', f'The proposed 10-year Woodfibre LNG tax agreement: voted for it ({VOTE}; he was one of the two in favour), doubting a new council would get a better outcome and calling ordinary taxation unreliable because assessments change'),
 'john-french': (2, 'supports', f'The proposed 10-year Woodfibre LNG tax agreement: voted for it ({VOTE}; he was one of the two in favour), saying the negotiators brought back an offer he could support'),
}
C = json.load(open('data/candidates.json'))
for c in C:
    if c['slug'] not in REASON: continue
    v, side, text = REASON[c['slug']]
    assert c['quiz_answers'].get('q23') is None, c['slug']
    c['quiz_answers']['q23'] = v
    c[side].append({'text': text, 'source_url': SRC})
    c['research_notes'] = (c.get('research_notes') or '') + f' Sept 26 2026: q23 = {v:+d} from the Sept 22 council vote on the WLNG agreement (Squamish Reporter, Sept 23).'
    s = c['stances'].get('environment_lng')
    if s and 'not yet known' in s['summary']:
        s['summary'] = s['summary'].replace('Her vote on the proposed 10-year WLNG agreement (scheduled Sept 22, 2026) was not yet known at time of research.',
            'On Sept 22, 2026 she moved the motion to reject the proposed 10-year WLNG tax agreement, which council passed 5–2, saying the payments would not rise with inflation.')
json.dump(C, open('data/candidates.json', 'w'), indent=1, ensure_ascii=False); open('data/candidates.json', 'a').write('\n')

D = json.load(open('data/context.json'))
i = next(i for i in D['issues'] if i['key'] == 'environment_lng')
out = []
for f in i['key_facts']:
    if f['fact'].startswith('Timeline:'): continue
    if f['fact'].startswith('Process:'):
        f['fact'] = 'Process: council could only accept or reject the deal, not amend it. With the deal rejected, normal taxation continues in 2027 (not zero revenue), and a future council could still consider another agreement.'
        f['source_url'] = SRC
    if f['fact'].startswith('Among candidates'):
        f['fact'] = f['fact'].replace('Sitting councillors had not declared before the Sept. 22 vote.', 'At the Sept. 22 vote, sitting councillors Stoner, Hamilton and Pettingill voted to reject it; Andersen and French voted for it.')
    out.append(f)
out.insert(0, {'fact': 'Result: on Sept. 22, 2026 council voted 5–2 to reject the proposed 10-year agreement. Against: Mayor Armand Hurford and Couns. Jenna Stoner (who moved the motion), Lauren Greenlaw, Andrew Hamilton and Chris Pettingill. For: Couns. Eric Andersen and John French. A future council could still consider another agreement.', 'source_url': SRC})
i['key_facts'] = out
i['sources'] = [SRC] + [s for s in i['sources'] if s != SRC]
i['explainer'] = i['explainer'].replace('the current council plans to vote in early October, days before the election.', 'on Sept. 22, 2026 council rejected it 5–2, so the question for the next council is whether to go back for a new deal.')
json.dump(D, open('data/context.json', 'w'), indent=2, ensure_ascii=False); open('data/context.json', 'a').write('\n')
print('ok')
