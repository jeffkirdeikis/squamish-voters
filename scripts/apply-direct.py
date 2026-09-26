# Applies candidate-supplied material (questionnaire answers, statements sent to us) to
# data/candidates.json. Usage: python3 scripts/apply-direct.py <responses.json>
# The candidate's own answer always replaces a score we inferred from the public record.
import json, re, sys
from datetime import datetime, timedelta

RESP = json.load(open(sys.argv[1]))['responses']
C = json.load(open('data/candidates.json'))
by = {c['name']: c for c in C}

# ---- Chris Ryan: press release he sent to Squamish Voters, Sept 18 2026 ----
PR = 'https://squamishvoters.com/docs/chris-ryan-2026-09-18.pdf'
r = by['Chris Ryan']
r['direct'] = {
    'kind': 'statement', 'date': '2026-09-18', 'url': PR,
    'title': 'Press release: “Meet Chris Ryan. A voice for Common Sense & Action in Squamish”',
    'how': 'Sent to Squamish Voters by the candidate.',
}
r['tagline'] = '“A voice for common sense & action in Squamish.”'
r['occupation_background'] = ('First came to the Sea to Sky to work in the summers of 1986–88 and moved back full-time in 1993. '
    'Studied marketing, retail management and ski racing at Sheridan College, then worked five years in real estate. '
    'For about 30 years he sold advertising to Sea to Sky small businesses (Whistler Question, Whistler This Week, Western phone directories) '
    'and ran a seasonal property-maintenance company for 20 years. Raised his partner’s two sons in Pemberton; moved to Squamish in 2018 '
    '(Garibaldi, then downtown). Now works in renewable energy solutions and landscapes one day a week in summer. '
    'Says he will miss the Oct 5 all-candidates debate for a family wedding out of province.')
r['top_priorities'] = [
    'Work with the Province and other governments instead of fighting them',
    'Parking, and a second road in and out of downtown',
    'Whistler-style housing for locals and seniors',
    'Get Woodfibre LNG to help pay for community projects',
    'Look after streets, curbs and drains to avoid big repair bills',
    'Safety downtown',
]
S = lambda t: {'text': t, 'source_url': PR}
r['supports'] = [S(t) for t in [
    'Working with the Province on its projects, so senior governments will help fund Squamish’s own projects',
    'Buying the Loggers Lane rail line to extend the Feather Park bike lane to Hunter Place Road, with angled parking that visitors pay for and residents and workers use with a permit',
    'Paving Bailey Street and opening it to the business park as a second route in and out of downtown, with paved parking for Bailey Street residents',
    'Adopting the Whistler Housing Authority model (rent covenants and caps on resale prices) and revisiting the Cheema land proposal for “high density, low sprawl” family housing',
    'Turning vacant office space that builders must include in residential buildings into affordable and seniors’ housing',
    'Working with Woodfibre LNG to help pay for Brennan Park, reopening the Bailey Street tennis courts, and a youth skate/bike/ball court in Garibaldi',
    'Renewable energy on municipal buildings, schools and new construction',
    'A winter bus to Darrell Bay (for example three times a day) and a transit link joining the Sea to Sky communities',
    'Regular weeding and maintenance of downtown curbs, sidewalks and storm drains to prevent costly damage',
    'Requiring builders to provide parking instead of paying cash-in-lieu, and to keep vacant lots tidy',
]]
r['opposes'] = [S(t) for t in [
    'The location of the safe injection site beside the public library, a Montessori daycare, a park and homes — says it “needs to be removed”',
    'The trailer-and-tent encampment on the vacant lot at Loggers Lane and Vancouver Street, and about 20 derelict boats nearby that he says are dumping sewage and fuel',
    'Hundreds of overweight trucks carrying port cargo through downtown instead of by rail',
    'Food trucks taking up to four downtown parking stalls and running generators, when a food-truck court with power already exists',
    'Council criticising LNG “but does nothing themselves except switch to LED lights”',
    'Campaign signs and political donations for his own campaign — says he accepts none',
]]
def st(pos, summ, quote, conf):
    return {'position': pos, 'summary': summ, 'quote': quote, 'source_url': PR, 'confidence': conf}
_keep = {k: v for k, v in r['stances'].items() if k == 'parking'}   # researched separately (apply-parking-0921.py)
r['stances'] = {
    'growth': st('Managed mix: family housing, “high density, low sprawl”',
        'Wants the town to grow beyond one- and two-bedroom downtown condos, with family housing on the Cheema lands, and says parking and road access (a second route into downtown) must keep up. No position on building heights.',
        'This will enable our town to grow beyond one- and two bedroom downtown condos.', 'low'),
    'housing_affordability': st('Whistler Housing Authority model for locals and seniors',
        'Would copy Whistler’s 30-year-old housing authority: homes with covenants on rents and caps on resale prices so locals can buy in and seniors can downsize without leaving town. Would convert vacant required office space in residential buildings to affordable and seniors’ housing, and lobby the Province and Ottawa for affordable and seniors’ housing.',
        'I will constantly and always advocate to the provincial and federal governments for affordable and senior housing.', 'medium'),
    'homelessness': st('Move the safe injection site; act on encampments',
        'Says the safe injection site must be moved away from the library, a daycare, a park and homes, and asks why a trailer-and-tent encampment on a private vacant lot is allowed and whether the owner is being fined. Does not say what should happen for the people living there.',
        'The safe injection site needs to be removed from its location beside our public library, Montessori daycare, park, and local residents.', 'medium'),
    'policing': st('Says downtown is unsafe; no policing plan stated',
        'Describes being attacked downtown with a wooden spear, a pipe, needles and rocks. Does not say whether he wants more RCMP, bylaw officers or other measures.',
        'We live in fear downtown.', 'low'),
    'taxes_spending': st('Prevent costly repairs; get senior-government and LNG money',
        'Argues that small maintenance spending now (weeds, curbs, drains) saves large repair bills later, that heavy trucks are wrecking downtown roads at taxpayers’ cost, and that Woodfibre LNG and senior governments should help fund local projects. No property-tax target stated.',
        'For a minor maintenance cost now, we will save the future tax base from the high costs of replacing our roads and streetscapes.', 'medium'),
    'environment_lng': st('Work with Woodfibre LNG; renewables on public buildings',
        'A renewable-energy advocate who nonetheless says Squamish should work with the LNG company to help fund community projects, and criticises council for complaining about LNG while doing little itself. Wants renewable energy on municipal buildings, schools and new construction.',
        'Contrary to my beliefs as a renewable energy advocate, we need to work with the LNG company, which can help financially support various projects in our community.', 'high'),
    'transportation': st('Second downtown route, permit parking, winter Darrell Bay bus',
        'Pave and open Bailey Street as a second route into downtown; buy the Loggers Lane rail line to extend the bike lane and add permit parking; run a winter bus to Darrell Bay; work with neighbouring towns on Sea to Sky transit; keep heavy port cargo on rail rather than downtown roads.',
        'One bad accident on Cleveland Avenue and traffic across the whole town grinds to a halt.', 'high'),
    'economy': st('No jobs plan stated',
        'No specific plan for jobs or business. Wants port cargo moved by rail instead of trucks through downtown, and food trucks moved to the food-truck court rather than taking street parking.',
        None, 'low'),
}
r['stances'].update(_keep)
r['growth_line'] = 'On growth: more family housing (“high density, low sprawl”), with parking and a second road into downtown.'
# His only clear statement on a quiz question: work with Woodfibre LNG rather than fight it.
# (Superseded by his own questionnaire answer, Sept 25: q8 +2.)
r['quiz_answers']['q8'] = -1
r['sources'] = [x for x in r['sources'] if x['url'] != PR]
r['sources'] = [{'title': 'Chris Ryan press release, Sept 18 2026 (sent to Squamish Voters)', 'url': PR}] + r['sources']
if not (r.get('research_notes') or '').startswith('Sept 20 2026'): r['research_notes'] = ('Sept 20 2026: platform added from the press release Chris Ryan sent to Squamish Voters (Sept 18). '
    'q8 = -1 from his explicit statement that Squamish should work with, not fight, the LNG company. '
    'No other quiz scores assigned — the release does not address the other statements directly. ' + (r.get('research_notes') or ''))


# Only real, verified submissions. A curl test entry under Sean Goodwin's name (Sept 20) is skipped by its user agent.
USE = {'Sarah Ellis', 'Shaun Veltkamp', 'Sean Goodwin', 'Daniel Deal', 'Laura Prosko', 'Sean Easton', 'Chris Ryan'}
# Submissions whose email didn't match the District filing but that Jeff confirmed with the candidate.
# Chris Ryan (Sept 25): typed "…@gmail.comom" — a typo of his filed address.
VOUCHED = {'Chris Ryan': 'The email address on the form had a typo, so Squamish Voters confirmed with Chris that the answers are his.'}
seen = set()
for r in sorted(RESP, key=lambda r: r['received'], reverse=True):   # newest first: a re-submission replaces the earlier one
    if r['who'] not in USE or not (r.get('verified') or r['who'] in VOUCHED) or (r.get('ua') or '').startswith('curl') or r['who'] in seen:
        continue
    seen.add(r['who'])
    c = by[r['who']]
    qa = dict(c.get('quiz_answers') or {})
    qa.update({k: v for k, v in r['answers'].items() if isinstance(v, int)})
    c['quiz_answers'] = qa
    c['answer_notes'] = {k: v.strip() for k, v in (r.get('notes') or {}).items() if v.strip()}
    c['own_words'] = {k: v.strip() for k, v in (r.get('writing') or {}).items() if v.strip() and k != 'corrections'}
    # A platform statement sent earlier (e.g. Prosko, Sept 22) keeps its own page alongside the questionnaire.
    if (c.get('direct') or {}).get('kind') == 'statement':
        c['statement'] = c['direct']
    c['direct'] = {
        'kind': 'questionnaire',
        # Timestamps are stored in UTC; show the Squamish (Pacific, UTC-7 in September/October) calendar date.
        'date': (datetime.fromisoformat(r['received'].replace('Z', '+00:00')) - timedelta(hours=7)).date().isoformat(),
        'how': 'Sent from the email address the candidate filed with the District of Squamish.',
        # which statements the candidate answered themselves (other scores on file are our reading of the record)
        'answered': sorted(k for k, v in r['answers'].items() if isinstance(v, int)),
    }
    if r['who'] in VOUCHED: c['direct']['checked'] = c['direct']['how'] = VOUCHED[r['who']]


# Topic headlines for candidates who answered us: written from their own answers, so a headline can never
# contradict the answers shown under it (e.g. an old "no LNG position found" above a "strongly agree").
HEAD = {
 'Sarah Ellis': {
  'growth': 'Stay open to growth; taller buildings downtown, cautious about opening new land',
  'homelessness': 'More shelter space; against moving Under One Roof or clearing camps with nowhere to go',
  'policing': 'Strongly backs a mental-health crisis team; in the middle on more police',
  'taxes_spending': 'In the middle on holding taxes down; open to borrowing for Brennan Park',
  'environment_lng': 'Climate a priority; in the middle on Woodfibre LNG, wants a fair tax deal',
  'transportation': 'Strongly for regional transit, bike lanes and sidewalks',
 },
 'Shaun Veltkamp': {
  'growth': 'In the middle on pace; hold building heights and the growth boundary for now',
  'homelessness': 'More shelter space, and move Under One Roof out of downtown',
  'policing': 'More RCMP and bylaw officers',
  'taxes_spending': 'Build a new community centre, borrowing if needed; chase senior-government money',
  'environment_lng': "Wants a harder bargain with Woodfibre LNG (“not leave millions on the table”); climate a top priority",
  'transportation': 'For bike lanes and sidewalks; lukewarm on paid parking downtown',
 },
 'Daniel Deal': {
  'growth': 'Don’t slow approvals; fill in existing neighbourhoods first, expand the growth boundary later',
  'housing_affordability': 'Strongly for more public money and land for below-market homes, and a required share in big projects',
  'homelessness': 'Against clearing camps with nowhere to go; points to supportive housing on Government Road; wants the Province to pay',
  'policing': 'Against funding more RCMP; strongly for mental-health crisis teams; a community task force to free up bylaw staff',
  'taxes_spending': 'Strongly for holding taxes to inflation; against the Woodfibre tax deal; referendums on big projects',
  'environment_lng': 'Against the 10-year Woodfibre tax deal; against pressing the plant through permits',
  'transportation': 'Against spending local money on bike lanes ahead of recreation; in the middle on regional transit',
  'economy': 'Strongly for cutting red tape; protect industrial land; bring back business incentives',
  'parking': 'Build more downtown parking; against paid parking — if it comes, locals park free',
 },
 'Laura Prosko': {
  'growth': 'Growing too fast: infrastructure and Brennan Park first; against taller buildings downtown and new neighbourhoods for now',
  'housing_affordability': 'Big projects should include below-market homes; “housing security”; keep Airbnb legal and regulated',
  'homelessness': 'Bring everyone to the table; in the middle on shelters, moving Under One Roof and clearing camps',
  'policing': 'Strongly for more RCMP, a mental-health car and bylaws against open drug use',
  'taxes_spending': 'Two-year tax freeze without cutting services; against borrowing for Brennan Park now; against the Woodfibre deal',
  'environment_lng': 'Climate action a top priority; wants the Woodfibre deal renegotiated for more money',
  'transportation': 'Strongly for regional transit, bike lanes and sidewalks — “but we need fiscal responsibility”',
  'economy': 'Strongly for cutting red tape for small business',
  'parking': 'More public parking downtown; would vote no on parking variances; against paid parking',
 },
 'Sean Easton': {
  'growth': 'Growing too fast: slow approvals until infrastructure catches up; judge each project on what it delivers',
  'housing_affordability': 'Strongly for more public money and land, and a bigger required share of below-market homes; resident-restricted ownership',
  'homelessness': 'Build the Pioneer Way and Hearth and Home supportive housing; against clearing camps with nowhere to go',
  'policing': 'In the middle on more RCMP and bylaw officers; strongly for crisis teams; hold everyone to the law, with services',
  'taxes_spending': 'Freeze property taxes for 2027; against the Woodfibre tax deal as written; pay for Brennan Park through industry, not debt',
  'environment_lng': 'Use every tool to protect health, air and water from Woodfibre LNG; climate a priority, but not at residents’ short-term cost',
  'transportation': 'For regional transit if senior governments pay their share; pause new bike-lane spending until residents are consulted',
  'economy': 'Strongly for cutting red tape, with a common-sense approach',
  'parking': 'Build a parkade; paid parking for visitors, free for locals; a moratorium on parking variances',
 },
 'Chris Ryan': {
  'growth': 'In the middle on pace; strongly against taller buildings downtown; “high density, low sprawl” family housing',
  'housing_affordability': 'Whistler-style housing authority; against requiring a below-market share in big projects; keep District land for housing',
  'homelessness': 'Keep Under One Roof where it is, but clear the encampments and move the injection site; against more shelters near homes',
  'policing': 'More foot patrols and bylaw officers downtown; bylaws against open drug use — “a strong arm”',
  'taxes_spending': 'Take the Woodfibre tax deal and put it toward Brennan Park; borrow to renew Brennan Park; in the middle on holding taxes down',
  'environment_lng': 'Take the Woodfibre tax deal, but press the plant on local impacts; climate a top priority — solar on public buildings',
  'transportation': 'Against local tax dollars for regional transit (wants a local gas tax instead); for bike lanes and sidewalks',
  'economy': 'Referendums on big projects; in the middle on cutting red tape',
  'parking': 'New buildings must supply parking; against paid parking — visitors only, locals free, once Loggers Lane parking exists',
 },
 'Sean Goodwin': {
  'growth': 'Keep growing, but stop densifying downtown: open new land and link neighbourhoods with new roads',
  'housing_affordability': 'Prefers “attainable” homes sold to set income brackets; keep District land for housing',
  'homelessness': 'One shelter-and-services complex in the business park; move Under One Roof out of downtown',
  'policing': 'More policing and bylaw officers; work with traffic-focused road safety units',
  'taxes_spending': 'A tax freeze to “catch our breath”; referendums on big projects; get on with Brennan Park',
  'environment_lng': 'Backed taking the Woodfibre tax deal, with pros and cons; against pressing the plant through permits',
  'economy': 'Strongly for cutting red tape; industry and development as revenue sources',
  'parking': 'A day lot where residents park free and visitors pay; tall buildings need “more than adequate” parking',
 },
}
STALE = re.compile(r"(?:^|(?<=[.!?”'\"]\s))[^.]*\b(?:[Nn]o (?:public |campaign |stated )?(?:statement|position|detail)s?\b[^.]*found|[Nn]o (?:stated )?position (?:found )?on|gives no position|[Nn]o position found)[^.]*\.\s*")
for name, heads in HEAD.items():
    c = by[name]; first = name.split(' ')[0]
    for key, st_ in c['stances'].items():
        was_none = st_.get('confidence') == 'none' or 'no public position' in (st_.get('position') or '').lower()
        if key in heads: st_['position'] = heads[key]
        st_['summary'] = STALE.sub('', st_.get('summary') or '').strip()
        if was_none or not st_['summary']:
            st_['summary'] = f"{first} had said little in public about this before answering our questionnaire. {first}’s own answers are below."
            st_['confidence'] = 'none'; st_['quote'] = None
# Researched summaries that her questionnaire now answers (q6 +2 more RCMP, q19, q35).
_pp = by['Laura Prosko']['stances']['policing']
_pp['summary'] = _pp['summary'].replace(' No specific position found on officer counts, RCMP budget or bylaw enforcement.', '')
# Ryan's press-release summaries that his questionnaire now answers (q19/q35 policing, q31 note on camps).
_rs = by['Chris Ryan']['stances']
_rs['policing']['summary'] = _rs['policing']['summary'].replace(' Does not say whether he wants more RCMP, bylaw officers or other measures.', '')
_rs['homelessness']['summary'] = _rs['homelessness']['summary'].replace(' Does not say what should happen for the people living there.', '')
if 'Sept 25 2026' not in (by['Chris Ryan'].get('research_notes') or ''):
    by['Chris Ryan']['research_notes'] = ('Sept 25 2026: questionnaire answered (form email had a typo, .comom; Jeff confirmed it is genuine). '
        'His own q8 +2 replaces our press-release reading of -1. ' + by['Chris Ryan']['research_notes'])
# Not an "against": move it to what he supports.
v = by['Shaun Veltkamp']
moved = [o for o in v['opposes'] if 'realign' in o['text']]
v['opposes'] = [o for o in v['opposes'] if 'realign' not in o['text']]
if moved and not any('qualified experts' in x['text'] for x in v['supports']):
    v['supports'].append({'text': 'Council listening to qualified experts, using reliable data and weighing costs and benefits before major decisions', 'source_url': moved[0]['source_url']})

# The growth chart reads the start of the growth headline; rewritten headlines need the group set by hand.
by['Sarah Ellis']['growth_group'] = 'up'        # her answers: taller buildings downtown +1, new land -1
by['Shaun Veltkamp']['growth_group'] = 'mix'    # in the middle on all three growth statements
by['Daniel Deal']['growth_group'] = 'mix'       # "fill in first; expand the boundary later" (as grouped before his headline was reworded)
by['Daniel Deal']['growth_line'] = 'On growth: don’t slow approvals — fill in existing neighbourhoods first, and expand the growth boundary later.'
by['Laura Prosko']['growth_group'] = 'slow'     # her answers: growing too fast +2, taller buildings -2, new land -2
by['Laura Prosko']['growth_line'] = 'On growth: growing too fast — get infrastructure and Brennan Park right before more growth.'

# Goodwin: strongly for opening new land (q3 +2), against taller buildings downtown (q2 -1) — "build out", in his own words.
g = by['Sean Goodwin']
g['growth_group'] = 'out'
g['growth_line'] = 'On growth: keep growing, but stop densifying downtown — open new land and link neighbourhoods with new roads.'

by['Sean Easton']['growth_group'] = 'slow'     # q1 +2 growing too fast; q2 0, q3 -1
# His answers now take positions on approvals (q1 +2), height (q2 0) and new land (q3 -1).
_eg = by['Sean Easton']['stances']['growth']
_eg['summary'] = _eg['summary'].replace(' He has not called for a pause on approvals, nor taken a position on tall buildings or new greenfield neighbourhoods.', '')
by['Sean Easton']['growth_line'] = 'On growth: slow down and let infrastructure catch up — stop approving development just to hit provincial housing numbers.'
by['Chris Ryan']['growth_group'] = 'mix'       # q1 0; q2 -2 against taller buildings; wants family housing and a second road first
by['Chris Ryan']['growth_line'] = 'On growth: more family housing (“high density, low sprawl”), but no towers downtown — with parking and a second road into downtown.'

# Veltkamp flagged our one-line growth summary as misleading; use his own answers instead.
by['Shaun Veltkamp']['growth_line'] = 'On growth: cap building heights downtown for now, and finish existing neighbourhoods before opening new land.'

json.dump(C, open('data/candidates.json', 'w'), indent=1, ensure_ascii=False)
print('updated', sorted(seen | {'Chris Ryan'}))

