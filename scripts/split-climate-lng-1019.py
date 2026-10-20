# One-off (Oct 19 2026, Jeff): split the combined "Climate, environment & the LNG plant" topic into
# climate (new key) and environment_lng (now the Woodfibre LNG plant only). Data files only.
import json, sys
D = 'data/'
def load(f):
    raw = open(D + f, encoding='utf-8').read()
    return json.loads(raw), raw
def save(f, obj, raw, indent):
    out = json.dumps(obj, indent=indent, ensure_ascii=False) + ('\n' if raw.endswith('\n') else '')
    open(D + f, 'w', encoding='utf-8').write(out)

# ---- questions: q9 and q24 are climate; q8 stays with the plant
q, raw = load('questions.json')
for x in q:
    if x['id'] in ('q9', 'q24'): x['issue'] = 'climate'; x['topic'] = 'Climate'
    if x['id'] == 'q8': x['topic'] = 'Woodfibre LNG'
save('questions.json', q, raw, 1)

# ---- promises: only Sarah Ellis's climate plan promise moves
p, raw = load('promises.json')
for x in p:
    if x['id'] == 'sarah-ellis-climate-plan': x['topic'] = 'climate'
save('promises.json', p, raw, 1)

# ---- council members' stances (the seven elected; other candidates' archived data is left as it was)
SAID_LITTLE = '{f} had said little in public about this before answering our questionnaire. {f}’s own answers are below.'
c, raw = load('candidates.json')
by = {x['slug']: x for x in c}
def setst(slug, lng=None, climate=None):
    s = by[slug]['stances']
    if lng: s['environment_lng'].update(lng)
    s['climate'] = climate
E = by['sean-easton']['stances']['environment_lng']
setst('sean-easton',
    {'position': 'Use every tool to protect health, air and water from Woodfibre LNG',
     'summary': E['summary'].replace(' He has not said he opposes the plant itself; no specific positions found on climate policy, the estuary or wildfire.', ' He has not said he opposes the plant itself.')},
    {'position': 'Climate a priority, but not at residents’ short-term cost', 'summary': SAID_LITTLE.format(f='Sean'),
     'quote': None, 'source_url': 'https://www.seaneaston.com', 'confidence': 'none'})
A = by['eric-andersen']['stances']['environment_lng']
setst('eric-andersen',
    {'position': 'Pro-permit on Woodfibre LNG',
     'summary': 'Has supported the permits for Woodfibre LNG’s floating worker housing, and voted for the proposed 10-year Woodfibre tax agreement, which council rejected 5–2 on Sept. 22, 2026.'},
    {'position': 'Climate action via local jobs, wood construction and adaptation',
     'summary': A['summary'].lstrip('. ').strip(), 'quote': None,
     'source_url': 'https://myseatosky.org/election-2022/district-of-squamish/', 'confidence': 'high'})
J = by['janice-desjardins']['stances']['environment_lng']
setst('janice-desjardins',
    {'summary': J['summary'].replace(' Past volunteer on the Squamish Estuary Management Plan. No climate-policy statement found.', '')},
    {'position': 'No public position found', 'summary': 'Past volunteer on the Squamish Estuary Management Plan. No climate policy statement found.',
     'quote': None, 'source_url': J['source_url'], 'confidence': 'low'})
setst('sarah-ellis',
    {'position': 'In the middle on Woodfibre LNG, wants a fair tax deal'},
    {'position': 'Climate a priority; supports the Community Climate Action Plan',
     'summary': 'Says she supports the six Big Moves in the District’s Community Climate Action Plan and would keep voting to carry it out.',
     'quote': 'I support the 6 big moves of the town’s existing Community Climate Action Plan and would continue to vote in support of its implementation.',
     'source_url': 'https://www.sarahellisforsquamish.ca/priorities', 'confidence': 'high'})
setst('luc-perreault',
    {'position': 'Strongly for the Woodfibre tax deal and against pressing the plant through permits'},
    {'position': 'Core infrastructure before climate action', 'summary': SAID_LITTLE.format(f='Luc'),
     'quote': None, 'source_url': 'https://www.lucperreault.ca/', 'confidence': 'none'})
P = by['laura-prosko']['stances']['environment_lng']
setst('laura-prosko',
    {'position': 'Wants the Woodfibre deal renegotiated for more money',
     'summary': P['summary'].replace(' also pledges stronger emergency and flood preparedness. No specific climate-action or floatel position found.', '').rstrip(';') + '.'},
    {'position': 'Climate action a top priority',
     'summary': 'Pledges stronger emergency and flood preparedness. We found no specific climate action position in her public statements before she answered our questionnaire; her own answers are below.',
     'quote': None, 'source_url': P['source_url'], 'confidence': 'low'})
V = by['shaun-veltkamp']['stances']['environment_lng']
setst('shaun-veltkamp',
    {'position': 'Wants a harder bargain with Woodfibre LNG (“not leave millions on the table”)', 'summary': SAID_LITTLE.format(f='Shaun'),
     'quote': None, 'confidence': 'none'},
    {'position': 'Climate a top priority', 'summary': V['summary'] if 'natural environment' in V['summary'] else sys.exit('veltkamp summary changed'),
     'quote': 'Our mountains, rivers, and trails are what make Squamish home.', 'source_url': 'https://shaunveltkamp.com/', 'confidence': 'low'})
save('candidates.json', c, raw, 1)

# ---- issue background: climate gets its own; the plant's loses its one climate sentence and fact
ctx, raw = load('context.json')
iss = ctx['issues']; i = next(n for n, x in enumerate(iss) if x['key'] == 'environment_lng'); L = iss[i]
L['title'] = 'The Woodfibre LNG plant'
for a, b in [('One is about the plant itself and the climate.', 'One is about the plant itself.'),
             (' Separately, the District has a goal of cutting community greenhouse gas emissions 45% by 2030.', '')]:
    assert a in L['explainer'], a
    L['explainer'] = L['explainer'].replace(a, b)
L['key_facts'] = [f for f in L['key_facts'] if 'GHG' not in f['fact']]
CCAP = 'https://squamish.ca/assets/e42d66502f/2020_04_28_CCAP_Executive_Summary.pdf'
SP = 'https://squamish.ca/government-and-administration/council/strategic-plan/'
iss.insert(i, {
    'key': 'climate',
    'title': 'Climate and the environment',
    'explainer': 'In 2019 the District of Squamish declared a climate emergency and set out to write a Community Climate Action Plan, which council adopted in 2020. Its goal is that by 2030 the town’s emissions will be at least 45% below 2010 levels, with Squamish on track for net zero by 2050. The plan is built around six “Big Moves” covering waste, getting around without a car, cleaner vehicles, existing buildings and new buildings, plus the District’s own work. By the District’s estimate, carrying out every action in the plan would cut about 38,300 tonnes of emissions a year by 2030, which is 38% below 2010 levels, short of the 45% goal. Council’s 2023 to 2026 Strategic Plan commits to the 45% goal. Council’s own tools are local: energy rules for new buildings, transportation spending, and waste and composting; most other levers sit with the Province and Ottawa. The debate on council is mostly about priority and cost: how much to spend on climate action, and how fast, compared with other needs such as roads, housing and taxes. Flood protection and the Woodfibre LNG plant each have their own page.',
    'key_facts': [
        {'fact': 'In 2019 the District declared a climate emergency and resolved to create a Community Climate Action Plan.', 'source_url': CCAP},
        {'fact': 'The plan’s goal: by 2030, emissions in Squamish at least 45% below 2010 levels, and on track to reach net zero by 2050.', 'source_url': CCAP},
        {'fact': 'The District estimates that the plan’s actions would cut emissions by 38,300 tonnes of CO2e a year by 2030, which is 38% below 2010 levels.', 'source_url': CCAP},
        {'fact': 'Council’s 2023 to 2026 Strategic Plan sets a goal of cutting community greenhouse gas emissions 45% by 2030 through the Community Climate Action Plan.', 'source_url': SP},
    ],
    'sources': [CCAP, SP],
    'teaser': 'Squamish declared a climate emergency in 2019 and has a plan to cut the town’s emissions at least 45% below 2010 levels by 2030.',
    'short_explainer': 'In 2019 the District declared a climate emergency, and in 2020 council adopted a Community Climate Action Plan: cut the town’s emissions at least 45% below 2010 levels by 2030, and be on track for net zero by 2050. Council’s tools are local, such as energy rules for new buildings, transportation and waste. The debate is about how much priority and money climate action should get compared with other needs.',
})
save('context.json', ctx, raw, 2)
print('ok')
