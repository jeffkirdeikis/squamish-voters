#!/usr/bin/env python3
"""Sept 21 2026: Anders Ourom's 13-point positions paper (posted publicly on his Facebook page about Sept 18, 2026;
Jeff supplied screenshots). Transcribed in data/pages/paper-anders-ourom.html and served at
/candidates/anders-ourom/positions/. NOT sent to us — so no "answered us" badge. Run once."""
import json, shutil
shutil.copy('data/candidates.json', 'data/candidates.pre-ourom-0921.json')
P = 'https://squamishvoters.com/candidates/anders-ourom/positions/'
C = json.load(open('data/candidates.json'))
o = next(c for c in C if c['slug'] == 'anders-ourom')
assert not o.get('paper'), 'already applied'
o['paper'] = {'date': '2026-09-18', 'url': '/candidates/anders-ourom/positions/', 'file': 'paper-anders-ourom.html',
              'title': 'Thoughts (“positions”) on current issues in Squamish', 'points': 13,
              'where': 'posted it publicly on his Facebook page', 'post_url': 'https://www.facebook.com/anders.ourom/posts/so-before-i-leave-for-ten-days-at-the-yosemite-facelift-pursuing-my-commitment-t/10164266194121226/'}
S = lambda t, n: {'text': t, 'source_url': f'{P}#p{n}'}
new_sup = [
 S('Not relaxing downtown parking requirements any further unless the District gets clear, greater benefits up front: “It’s time for some backbone”', 7),
 S('Building a central three- to four-storey parking garage downtown', 7),
 S('A temporary freeze on property tax increases, then increases in line with inflation', 3),
 S('Putting 100% of the money from Woodfibre LNG into renewing Brennan Park and other recreation, cultural and municipal facilities', 2),
 S('A new civic centre built in phases beside Brennan Park, and replacing town hall, partly paid for by selling the land town hall sits on', 2),
 S('The HEART and HEARTH outreach and transitional housing programs, the proposed supportive housing building, and the new Director of Public Safety with more downtown patrols', 4),
 S('Reluctantly, amending the growth boundary so planning for the Cheema Lands can go ahead, together with the neighbouring Holborn Lands', 5),
 S('A longer Woodfibre LNG agreement with built-in review and renewal; the District monitoring the plant’s air and water impacts from day one and publishing the results', 6),
 S('A permit system for people living in vehicles, if there is a defined parking area with fees, registration and basic services such as water, garbage and toilets', 1),
 S('A 30 km/h speed limit across downtown, repainted crosswalks, more frequent buses and more charging stations', 7),
 S('Lobbying for transit to Vancouver, Whistler and Pemberton: “Bus, train, ferry – whatever is practicable”', 9),
 S('Truly “green” buildings, and working toward most in-town trips being on foot, transit, bicycle or e-device', 9),
 S('An emergency plan that pre-stocks Brennan Park, churches and schools to shelter stranded travellers when the highway closes; FireSmart work', 10),
 S('Locked, bear-proof garbage and recycling sheds required for all new multi-unit buildings', 12),
 S('More camping in the region, including for “vanlife”; keeping trails on the Cheema Lands, Crumpit Woods and Cheekye Fan as they are developed; support for Search & Rescue', 11),
 S('“A strong, resilient economy that is business-friendly”', 13),
]
new_opp = [
 S('The proposed 10-year Woodfibre LNG agreement as it stands: he “question[s] the wisdom” of it and asks whether it allows for inflation, LNG prices, volumes shipped and timely review', 6),
 S('Parking fees for day-use recreation and trailhead parking, such as the Smoke Bluffs or Perth Drive, and commercial parking there (“There’s no room”)', 1),
 S('Making “vague promises” about reconciliation', 8),
]
# his own paper goes first; drop older lines it supersedes
drop = ('More and clearer trail signage', 'Granting parking variances unless', 'Pay parking at the Smoke Bluffs lot')
o['supports'] = new_sup + [s for s in o['supports'] if not s['text'].startswith(drop)]
o['opposes'] = new_opp + [s for s in o['opposes'] if not s['text'].startswith(drop)]
o['top_priorities'] = ['Economic development: “one of the most important”', 'A temporary property tax freeze', 'Renewing Brennan Park with 100% of the Woodfibre LNG money', 'Holding the line on downtown parking; a parking garage', 'Emergency preparedness and outdoor recreation']

def st(pos, summ, quote, n, conf='high'):
    return {'position': pos, 'summary': summ, 'quote': quote, 'source_url': f'{P}#p{n}', 'confidence': conf}
o['stances'].update({
 'growth': st('Reluctantly in favour of opening the Cheema Lands outside the growth boundary',
   'Says that, subject to staff advice, he would reluctantly support amending the growth management boundary so planning for the Cheema Lands can proceed, because the District’s pre-conditions have been or soon will be met and “it would be unwise to change the rules now”. He says build-out could take a decade or more, that road access and traffic in existing neighbourhoods are key questions, and that planning should be tied to the neighbouring Holborn Lands.',
   'I’d be reluctantly in favour of amending the “GMB” to allow planning for development of the Cheema Lands to proceed.', 5),
 'housing_affordability': st('New land should include social housing; nothing more specific',
   'His only statement on housing costs is that opening the Cheema and Holborn lands “should provide needed land for residential development, including elements of social housing of various kinds.” He would sell the town hall site, and if necessary part of the Brennan Park lands, to pay for new civic facilities rather than use them for housing.',
   'Opening up the Cheema Lands and Holborn Lands should provide needed land for residential development, including elements of social housing of various kinds.', 5, 'low'),
 'homelessness': st('Supports the HEART and HEARTH programs and the proposed supportive housing building',
   'Supports the HEART and HEARTH programs for encampment outreach and transitional housing, and the proposed supportive housing building. Says many complaints come from activity near Under One Roof, “although often not due to residents there”, and that Squamish can learn from similar facilities elsewhere when planning the new project. For people living in vehicles, he backs a permit system if there is a defined parking area with fees and basic services.',
   'I support the HEART and HEARTH programs, for encampment outreach and transitional housing, and the proposed supportive housing building.', 4),
 'policing': st('“Public safety is always a priority”; backs the Director of Public Safety and more downtown patrols',
   'Says rising violent crime is “unacceptable” and is “far from just in the downtown or linked to encampments”. Notes the District can raise its policing or bylaw budget but has limited ability to direct the RCMP; he does not say whether he would fund more officers. Supports the appointment of a Director of Public Safety and more downtown patrols, “which seems to be helping”.',
   'The District can increase its budget for policing or increase bylaw enforcement, but has limited ability to direct the RCMP.', 4, 'medium'),
 'taxes_spending': st('A temporary tax freeze, then inflation-level increases; Woodfibre money to Brennan Park',
   'Says property taxes “have risen much too quickly” and calls for a temporary freeze, with inflation-level increases after that, while accepting that bigger increases may be unavoidable if the alternative is cutting services. Wants 100% of Woodfibre LNG money spent on Brennan Park and other civic facilities, a new civic centre built in phases, and town hall replaced, partly funded by selling the land it sits on. He questions the proposed 10-year Woodfibre agreement and wants a longer one with review and renewal.',
   'There should now be a temporary freeze on further increases, so that they can be rebalanced, with inflationary changes resuming in due course.', 3),
 'environment_lng': st('Questions the 10-year Woodfibre deal; wants the plant’s impacts monitored and published',
   'Says the District has handled Woodfibre LNG poorly. He questions the proposed 10-year agreement (inflation, LNG prices, volumes, review) and wants a longer term with review and renewal. The District should monitor air and water impacts from the start, publish the results, and lobby senior governments and the regulator on enforcement. On climate he lists regional transit, truly green buildings, holding all developers to agreed standards, and more in-town trips without a car. A long-time parks advocate (Stawamus Chief, Smoke Bluffs, Skaha Bluffs).',
   'The developer agreed to various standards after a lot of informed discussion, and should be held to them.', 6),
 'transportation': st('Lobby for regional transit by “bus, train, ferry”; 30 km/h downtown; more frequent buses',
   'Wants the District to lobby for workable transit to Vancouver, Whistler and Pemberton, by whatever mode is practicable. Downtown: a 30 km/h limit, repainted crosswalks, more frequent buses, more charging stations, and safely fitting e-bikes and scooters into sidewalks, roads and trails. He does not say whether local tax dollars should pay for regional transit.',
   'Lobby for workable transit to and from Vancouver, and to Whistler and Pemberton. Bus, train, ferry – whatever is practicable.', 9),
 'economy': st('“A strong, resilient economy that is business-friendly”; outdoor recreation as a draw',
   'Calls economic development “one of the most important” issues but gives one sentence on it. His detail is in outdoor recreation: promote Squamish as the gateway to the Stawamus Chief and Garibaldi parks, expand camping (including vanlife camping) across the region, consistent trailheads and signage, keep trails as private lands are developed, and charge commercial users of the Smoke Bluffs lot.',
   'We have to have a strong, resilient economy that is business-friendly.', 13, 'medium'),
 'parking': st('No more parking relaxations downtown without greater benefits up front; build a parking garage; no fees at trailheads',
   'Would not allow further relaxation of downtown parking requirements unless the District gets “clear, transparent, and greater alternative benefits … delivered up front”, and would review the community plan if the requirements prove impracticable. Wants a central three- to four-storey parking garage. Open to pay parking downtown with residents-only and employees-only zones. Opposes parking fees for day-use recreation and trailheads such as the Smoke Bluffs and Perth Drive.',
   'Developers are large, sophisticated, and resourceful, and know exactly what they’re getting into when they propose a development. It’s time for some backbone.', 7),
})
o['growth_group'] = 'out'
o['growth_line'] = 'On growth: reluctantly in favour of letting planning for the Cheema Lands go ahead, outside today’s growth boundary.'

SC = {'q3': 1, 'q5': 1, 'q7': 1, 'q23': -1, 'q36': 2, 'q37': 1, 'q25': 0, 'q17': 1, 'q24': 1, 'q15': -1}
o['quiz_answers'].update(SC)
o['research_notes'] = ('Sept 21 2026: rebuilt from his own 13-point positions paper (public Facebook post, ~Sept 18 2026; screenshots from Jeff; FB link still needed). '
  'Scores: q3 +1 (reluctantly for amending the GMB for Cheema Lands, #5); q5 +1 (supports the proposed supportive housing building, #4); q7 +1 (temporary freeze then inflation, but would accept more if the alternative is cuts, #3); '
  'q23 -1 (“I question the wisdom of the proposed ten year agreement”, #6); q36 +2 (central 3–4 storey parking garage, #7); q37 +1 (no further relaxation unless greater benefits, #7 — conditional, so not +2); '
  'q25 0 (“open to the ideas of pay parking”, #7); q17 +1 (permit system if a defined, serviced parking area, #1); q24 +1 (“truly green” buildings, #9; cost not addressed); q15 -1 (would sell the town hall land and if necessary Brennan Park land, #2). '
  'NOT scored: q6/q19 (describes what the District can do, no ask), q8 (monitor/lobby, not permit powers), q11 (lobby, no local money), q12 (no word on borrowing), q9, q10, q29, q38. ' + (o.get('research_notes') or ''))
o['sources'] = [{'title': 'Anders Ourom: positions paper, Sept 2026 (his public Facebook post; our transcription)', 'url': P}] + [s for s in o['sources'] if s.get('url') != P]
json.dump(C, open('data/candidates.json', 'w'), indent=1, ensure_ascii=False)
print('ok', {k: v for k, v in o['quiz_answers'].items() if v is not None})
