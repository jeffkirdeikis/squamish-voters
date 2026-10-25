// Static site generator for Squamish Voters 2026. No dependencies.
//   node build.mjs   ->  dist/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const RES = read('results.json'); // 2026 from the District's election-night feed; 2022 and 2018 from the District's final determinations
// The 2026 election is decided, so the site follows the 7 people who won. Everyone else stays in candidates.json as the record.
const WON = new Set(['mayor', 'council'].flatMap((k) => (RES['2026'][k] || []).filter((r) => r.elected).map((r) => r.name)));
const candidates = read('candidates.json').filter((c) => WON.has(c.name));
// Council meetings (one file each, written by scripts/pipeline) and the campaign promises we track.
const MEET_DIR = path.join(ROOT, 'data', 'meetings');
const MEETINGS = fs.existsSync(MEET_DIR) ? fs.readdirSync(MEET_DIR).filter((f) => f.endsWith('.json')).filter((f) => !f.startsWith('TEST-')).map((f) => JSON.parse(fs.readFileSync(path.join(MEET_DIR, f), 'utf8'))).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))) : [];
const PROMISES = fs.existsSync(path.join(ROOT, 'data', 'promises.json')) ? read('promises.json') : [];
// Long-running issues we follow across meetings, and how residents can take part (both researched, with sources).
const TRACKED = fs.existsSync(path.join(ROOT, 'data', 'tracked-issues.json')) ? read('tracked-issues.json').issues || [] : [];
const PART = fs.existsSync(path.join(ROOT, 'data', 'participate.json')) ? read('participate.json') : {};
const HOODS = PART.neighbourhoods || [];
// Squamish news: short stories from public sources, newest first (a side section; council stays the focus).
const NEWS = fs.existsSync(path.join(ROOT, 'data', 'news.json')) ? read('news.json') : { sections: [], coming: [], stories: [] };
const ctx = read('context.json');
const TR = read('trustees.json');
// The voter quiz and the comparison pages use only the 12 core statements, so they stay quick.
// The rest are asked of candidates and shown on their profile once they answer.
const ALL_QUESTIONS = read('questions.json');
const QUESTIONS = ALL_QUESTIONS.filter((q) => q.core !== false);
const EXTRA_QUESTIONS = ALL_QUESTIONS.filter((q) => q.core === false);
const GLOSSARY = read('glossary.json');
const ORIGIN = 'https://squamishvoters.com';
const REPO = 'https://github.com/jeffkirdeikis/squamish-voters';
const SITE = { name: 'Squamish Voters', updated: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver', month: 'long', day: 'numeric', year: 'numeric' }), contact: ctx.contact_email || null };

fs.rmSync(DIST, { recursive: true, force: true });

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isUrl = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
const src = (u, label = 'source') => (isUrl(u) ? ` <a class="src" href="${esc(u)}" target="_blank" rel="noopener">[${label}]</a>` : '');
const lastName = (c) => c.sort_name || c.name.split(' ').slice(-1)[0];
const initials = (c) => c.name.replace(/\b[A-Z]\.\s*/g, '').split(' ').map((w) => w[0]).slice(0, 2).join('');
const byName = (a, b) => lastName(a).localeCompare(lastName(b));
const mayors = candidates.filter((c) => c.office === 'mayor').sort(byName);
const council = candidates.filter((c) => c.office === 'council').sort(byName);
const all = [...mayors, ...council];
const hasPhoto = (c) => c.photo && fs.existsSync(path.join(ROOT, 'public', c.photo));
const avatar = (c, size = '') => hasPhoto(c)
  ? `<img class="avatar ${size}" src="/${esc(c.photo)}" alt="Photo of ${esc(c.name)}" loading="lazy">`
  : `<span class="avatar ${size}" aria-hidden="true">${esc(initials(c))}</span>`;
const officeLabel = (c) => (c.office === 'mayor' ? 'Mayor of Squamish' : 'Squamish councillor');

// Jargon help: wrap the FIRST occurrence of each known term in tappable text that reveals a plain definition.
// Runs on already-escaped plain text only (never on markup), so it can't break tags.
const GL_TERMS = GLOSSARY.flatMap((g) => [g.term, ...(g.also || [])].map((t) => ({ t, g }))).sort((a, b) => b.t.length - a.t.length);
const glEsc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
function gl(text) {
  let out = String(text), used = new Set();
  for (const { t, g } of GL_TERMS) {
    if (used.has(g.term)) continue;
    const re = new RegExp(`(^|[^\\w-])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w-])`, 'i');
    if (!re.test(out)) continue;
    used.add(g.term);
    out = out.replace(re, (m, pre, word) => `${pre}<button type="button" class="gl" data-term="${glEsc(g.term)}" data-def="${glEsc(g.def)}">${word}</button>`);
  }
  return out;
}
const escGl = (s) => gl(esc(s));

const GROWTH = {
  slow: { label: 'Slow down / rebalance', blurb: 'Says growth is outpacing jobs, services and amenities, and is cautious about adding more density to existing neighbourhoods.' },
  up: { label: 'Build up and fill in', blurb: 'Prefers growth inside today’s town boundary — infill and more density near downtown and transit — rather than spreading onto new land. Some still vote against individual projects.' },
  out: { label: 'Build out', blurb: 'Open to new neighbourhoods and expanding the growth boundary onto new land, rather than densifying existing streets.' },
  mix: { label: 'Grow, but infrastructure first', blurb: 'Supports continued growth as long as roads, services and amenities keep pace. Has not picked a side on building up versus building out.' },
  unknown: { label: 'No clear public position', blurb: 'We could not find a clear public statement on how Squamish should grow.' },
};
const growthKey = (c) => {
  if (c.growth_group) return c.growth_group;
  const p = (c.stances?.growth?.position || '').toLowerCase();
  if (p.startsWith('slow')) return 'slow';
  if (p.startsWith('build up')) return 'up';
  if (p.startsWith('build out')) return 'out';
  if (p.startsWith('managed')) return 'mix';
  return 'unknown';
};
// One plain sentence instead of a colour-coded badge.
const GROWTH_SENTENCE = {
  slow: 'On growth: wants to slow down and let jobs and services catch up.',
  up: 'On growth: build inside the town we have — more homes downtown and near transit.',
  out: 'On growth: open new land and new neighbourhoods.',
  mix: 'On growth: keep building, but get the roads, pipes and services in place first.',
  unknown: 'On growth: hasn’t said publicly yet.',
};
const first = (c) => c.name.split(' ')[0].replace(/\.$/, '') === 'A' ? c.name.split(' ')[1] : c.name.split(' ')[0];
const fmtLong = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
const isDirectQ = (c) => c.direct?.kind === 'questionnaire';
// Did the candidate answer this statement themselves? (Other scores on file are our reading of the public record.)
const selfAnswered = (c, q) => isDirectQ(c) && typeof c.quiz_answers?.[q.id] === 'number' && (!c.direct.answered || c.direct.answered.includes(q.id));
// A comment the candidate wrote on a statement — shown even where they chose not to pick an answer.
const wrote = (c, q) => (isDirectQ(c) && c.answer_notes?.[q.id]) || '';
const ansWord = (c, q) => selfAnswered(c, q) || !isDirectQ(c) ? ANSWER_WORD[String(c.quiz_answers[q.id])] : 'Didn’t pick an answer';
// A platform statement sent to us as text keeps its own page, even after the candidate also answers the questionnaire.
const stmtOf = (c) => c.statement || (c.direct?.kind === 'statement' ? c.direct : null);
// The visible "read more" label inside a <summary>; CSS swaps the two halves when the row is open.
const moreBtn = (label) => `<span class="more-btn" aria-hidden="true"><span class="c">${label} ▾</span><span class="o">Show less ▴</span></span>`;
// Candidate-supplied material is flagged everywhere it appears, so readers can tell it from our reading of the record.
const directBadge = (c) => !c.direct ? '' : `<span class="badge direct" title="${esc(c.direct.how)}">✓ ${isDirectQ(c) ? 'Answered us directly' : c.direct.kind === 'email' ? 'Answered us by email' : 'Sent us their platform'}</span>`;
const growthSentence = (c) => esc(c.growth_line || GROWTH_SENTENCE[growthKey(c)]);
const growthBadge = (c) => { const k = growthKey(c); return `<span class="badge growth-${k}">Growth: ${esc(GROWTH[k].label)}</span>`; };
const answered = (c) => QUESTIONS.filter((q) => typeof c.quiz_answers?.[q.id] === 'number').length;
// 'Limited public info' means we found little to report at all — not merely few quiz-scorable statements.
const thinRecord = (c) => (c.supports || []).length + (c.opposes || []).length < 5;

// ---------- Compass axes ----------
// Every placement is computed from the fact-checked quiz scores (-2..+2); nothing here is a judgment call.
// sign +1 means agreeing with the statement pushes toward the `hi` end of the axis.
const AXES = {
  // Only the three statements about where shelters and camps go (q5 more shelters even near homes, q18 move Under One Roof
  // out of downtown, q31 clear camps). Policing, bylaw and drug-use statements are a different question and stay off this line.
  street: { title: 'Homelessness', icon: '🏘️', short: 'Homelessness', ask: 'Keep shelters and camps where they are, or move shelters out and clear camps?', lo: 'More shelters, even near homes · let camps stay', hi: 'Move shelters out of downtown · clear camps', q: { q5: -1, q18: 1, q31: 1 } },
  money: { title: 'Money', icon: '💵', ask: 'Hold taxes down, or invest in services?', lo: 'Invest in services', hi: 'Hold taxes down', q: { q7: 1, q4: -1, q12: -1, q11: -1 } },
  growth: { title: 'Growth', icon: '🏗️', ask: 'Build more, faster — or slow down?', lo: 'Slow down, be cautious', hi: 'Build more, faster', q: { q1: -1, q2: 1, q10: 1 } },
  deal: { title: 'The Woodfibre tax deal', icon: '🤝', short: 'Tax deal', ask: 'Sign the 10-year tax deal with Woodfibre LNG, or not?', lo: 'Reject or renegotiate it', hi: 'Sign it', q: { q23: 1 } },
  env: { title: 'Climate & environment', icon: '🌲', short: 'Climate', ask: 'Should climate come first, even when it costs more?', lo: 'Keep costs down', hi: 'Climate first', q: { q9: 1, q24: 1 } },
};
const axisScore = (c, key) => {
  const vals = Object.entries(AXES[key].q).map(([q, sign]) => (typeof c.quiz_answers?.[q] === 'number' ? c.quiz_answers[q] * sign : null)).filter((v) => v !== null);
  return vals.length ? { v: vals.reduce((a, x) => a + x, 0) / vals.length, n: vals.length } : null;
};
const axisFull = (key) => Math.min(3, Object.keys(AXES[key].q).length); // statements needed before we say "clearly"
const lc = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const axisWords = (key, s) => {
  if (!s) return 'no public record';
  const A = AXES[key], side = s.v < 0 ? A.lo : A.hi, m = Math.abs(s.v);
  return m < 0.34 ? 'in the middle' : `${m >= 1.2 && s.n >= axisFull(key) ? 'clearly' : 'leans'} “${lc(side)}”`;
};
// The 2D chart needs both axes; a dot is hollow when it rests on 3 or fewer statements in total.
// The classic two-axis compass, translated to what a town council actually decides.
// X: left (spend more on public services) .. right (hold taxes and spending down).
// Y: up (more government rules and enforcement) .. down (fewer rules, leave people and builders alone).
const CLASSIC = {
  x: { q7: 1, q21: 1, q4: -1, q5: -1, q11: -1, q12: -1, q22: -1, q26: -1, q30: -1, q34: -1, q15: -1 },
};
// The homelessness compass splits that one line in two, because wanting more shelter and wanting encampments
// cleared are not opposites. Left = more homeless shelters & outreach. Down = clear the camps and move the shelter.
const SUPPORT_Q = { q5: -1, q20: -1 };
const CAMPS_Q = { q31: -1, q18: -1 };
// More two-line maps people can swipe through on /compass/ and the small compass cards. Each is worked out the
// same way as the classic one: the average of a candidate's sourced scores on each list of statements.
const neg = (qs) => Object.fromEntries(Object.entries(qs).map(([q, w]) => [q, -w]));
const PROJECTS_Q = { q12: 1, q22: 1, q28: 1, q21: -1 };
const PARKING_Q = { q36: 1, q37: 1, q38: 1, q25: -1, q26: -1, q11: -1 };
const CMAPS = {
  classic: {
    title: 'Homelessness: support and enforcement', ask: 'More homeless shelters or fewer? Clear the camps, or let them stay?',
    x: SUPPORT_Q, y: CAMPS_Q,
    L: { up: '▲ LET THE CAMPS STAY', down: '▼ CLEAR CAMPS · MOVE THE SHELTER', left: '◀ MORE HOMELESS SHELTERS', right: 'FEWER HOMELESS SHELTERS ▶' },
    Lm: { up: '▲ LET CAMPS STAY', down: '▼ CLEAR CAMPS', left: '◀ MORE SHELTERS', right: 'FEWER SHELTERS ▶' },
    xt: 'Homeless shelters', xw: ['more homeless shelters and outreach', 'fewer homeless shelters'], yt: 'Camps', yw: ['clear the camps and move the shelter', 'let the camps stay'],
    desc: 'Left to right runs from more homeless shelters and outreach to fewer homeless shelters. Bottom to top runs from clear encampments and move the shelter out of downtown, to let the camps stay.',
  },
  growpay: {
    // Both lines run backwards from the other maps so spend-more / build-more sits top-left, like the classic compass.
    title: 'How should we grow — and pay for it?', ask: 'Build more or slow down? Spend on services or hold taxes down?',
    x: neg(AXES.growth.q), y: neg(CLASSIC.x),
    L: { up: '▲ SPEND MORE ON SERVICES', down: '▼ HOLD TAXES DOWN', left: '◀ BUILD MORE, FASTER', right: 'SLOW DOWN, BE CAUTIOUS ▶' },
    Lm: { up: '▲ SPEND MORE', down: '▼ HOLD TAXES DOWN', left: '◀ BUILD MORE', right: 'SLOW DOWN ▶' },
    xt: 'Growth', xw: ['build more, faster', 'slow down, be cautious'], yt: 'Money', yw: ['hold taxes and spending down', 'spend more on public services'],
    desc: 'Left to right runs from build more, faster to slow down and be cautious. Bottom to top runs from hold taxes and spending down to spend more on public services.',
    explain: '<b>Up–down</b> is money: spend more on housing, shelters, transit, recreation, bike lanes and childcare (up), or hold taxes and spending down (down). <b>Left–right</b> is growth: allow taller buildings and cut red tape for builders (left), or slow the pace of approvals (right).',
  },
  cars: {
    // Both lines reversed, like growpay, so transit / build-more sits top-left.
    title: 'Cars or bikes — and how much growth?', ask: 'Transit and bikes first, or parking and roads first? Build more or slow down?',
    x: neg(AXES.growth.q), y: neg(PARKING_Q),
    L: { up: '▲ TRANSIT &amp; BIKES FIRST', down: '▼ CARS &amp; PARKING FIRST', left: '◀ BUILD MORE, FASTER', right: 'SLOW DOWN, BE CAUTIOUS ▶' },
    Lm: { up: '▲ TRANSIT &amp; BIKES', down: '▼ CARS &amp; PARKING', left: '◀ BUILD MORE', right: 'SLOW DOWN ▶' },
    xt: 'Growth', xw: ['build more, faster', 'slow down, be cautious'], yt: 'Getting around', yw: ['cars and parking first', 'transit and bikes first'],
    desc: 'Left to right runs from build more, faster to slow down and be cautious. Bottom to top runs from cars and parking first to transit and bikes first.',
    explain: '<b>Up–down</b> is how people should get around: paid parking is fair, and spend local money on bike lanes, sidewalks and regional transit (up), or more public parking, parking required in new buildings and free parking for residents (down). <b>Left–right</b> is growth: allow taller buildings and cut red tape for builders (left), or slow the pace of approvals (right).',
  },
  projects: {
    // Same orientation rule as the other maps: more public investment up, build more left.
    title: 'Big projects — invest now or hold off?', ask: 'Borrow and build now, or wait and ask voters first? Build more or slow down?',
    x: neg(AXES.growth.q), y: PROJECTS_Q,
    L: { up: '▲ BORROW &amp; INVEST NOW', down: '▼ WAIT, OR ASK VOTERS FIRST', left: '◀ BUILD MORE, FASTER', right: 'SLOW DOWN, BE CAUTIOUS ▶' },
    Lm: { up: '▲ INVEST NOW', down: '▼ WAIT / ASK VOTERS', left: '◀ BUILD MORE', right: 'SLOW DOWN ▶' },
    xt: 'Growth', xw: ['build more, faster', 'slow down, be cautious'], yt: 'Big projects', yw: ['wait, or put big projects to a referendum', 'borrow and invest now'],
    desc: 'Left to right runs from build more, faster to slow down and be cautious. Bottom to top runs from wait or ask voters first to borrow and invest now.',
    explain: '<b>Up–down</b> is big projects: renew Brennan Park even if it means borrowing, borrow now rather than save up, and spend more on dikes and flood protection even with higher taxes (up), or send big capital projects to a public referendum first (down). <b>Left–right</b> is growth: allow taller buildings and cut red tape for builders (left), or slow the pace of approvals (right).',
  },
};
const qScore = (c, qs) => {
  const vals = Object.entries(qs).map(([q, sign]) => (typeof c.quiz_answers?.[q] === 'number' ? c.quiz_answers[q] * sign : null)).filter((v) => v !== null);
  return vals.length ? { v: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length } : null;
};
const cmapPos = (c, key) => {
  const M = CMAPS[key], x = qScore(c, M.x), y = qScore(c, M.y);
  return x && y ? { x, y, est: false, thin: x.n < 2 || y.n < 2 } : null;
};
const placedOn = (key) => all.filter((c) => cmapPos(c, key));
const isPlaced = (c) => !!cmapPos(c, 'classic');
const placed = all.filter(isPlaced), unplaced = all.filter((c) => !isPlaced(c));

// Plain answer to the question everyone asks about the Woodfibre deal. Facts from the District's own FAQ and staff report.
const DEAL_SRC = 'https://squamish.ca/projects-plans-and-initiatives/projects-in-our-community/wlng-agreement/';
const DEAL_IF_NO = `<div class="ifno"><h3>The Woodfibre tax deal: what each choice means</h3>
<p class="deal-update"><b>Update, Sept. 22:</b> council said no, 5–2 (Stoner, Hamilton and Pettingill against; Andersen and French for). A future council could still negotiate a new deal, so where candidates stand still matters. <a href="https://www.squamishreporter.com/2026/09/23/squamish-council-rejects-woodfibre-lng-tax-deal/" target="_blank" rel="noopener">Squamish Reporter</a></p>
<p>This is a question about money. It is not a vote for or against the plant, which is already being built, and candidates who support the plant are on both sides of it.</p>
<div class="grid cols-2">
<div><h4>If council says yes</h4><ul>
<li><b>At least $142 million over 10 years</b>, fixed in advance — about $14.2 million a year on average, with the biggest payments in the first five years.</li>
<li><b>The court cases end.</b> Woodfibre drops its three legal actions over the 2025 and 2026 tax rates, with no refunds.</li>
<li><b>No risk from the Province or appeals.</b> The amount holds even if the Province caps tax rates or the plant’s assessed value drops.</li>
<li><b>But it can’t go up.</b> Most of the money doesn’t rise with inflation, it can only be spent on building projects, and it stays the same if the plant expands.</li>
</ul></div>
<div><h4>If council says no</h4><ul>
<li><b>Squamish still gets paid.</b> Woodfibre keeps paying normal property tax every year. It paid $7.7 million in 2026 with the plant only part-built.</li>
<li><b>How much is unknown.</b> Staff estimate <b>$9 million to $29 million a year</b> once the plant is finished, depending on the tax rate council sets. Today’s rate is about four times the B.C. average, and the District says keeping it that high for 10 years “would be unusual”.</li>
<li><b>The court cases go ahead,</b> and the Province could cap the tax rate (as it does for ports and utilities) or change how LNG plants are valued.</li>
<li><b>A new council could try for a better deal.</b> Nothing guarantees a new offer, and one could not start before 2028.</li>
</ul></div></div>
<p class="small">District staff say normal taxes “could be either higher or lower” than the deal and make no recommendation. <a href="${DEAL_SRC}" target="_blank" rel="noopener">District of Squamish: questions and answers on the deal</a>.</p></div>`;
const ISSUES = [
  { key: 'growth', title: 'Growth & development', icon: '🏗️' },
  { key: 'housing_affordability', title: 'Housing affordability', icon: '🏠' },
  { key: 'homelessness', title: 'Homelessness & supportive housing', icon: '🤝' },
  { key: 'policing', title: 'Policing & community safety', icon: '🚓' },
  { key: 'taxes_spending', title: 'Taxes & spending', icon: '💵' },
  // Climate and the Woodfibre plant were one topic until Oct 19, 2026; split so neither implies a view on the other.
  // The key environment_lng now means the plant only (kept so old links and data still line up).
  { key: 'climate', title: 'Climate & environment', icon: '🌲' },
  { key: 'environment_lng', title: 'Woodfibre LNG plant', icon: '⚡' },
  { key: 'transportation', title: 'Transportation & transit', icon: '🚌' },
  // allq: Compare shows every parking statement, not just the one in the quiz
  { key: 'parking', title: 'Parking', icon: '🅿️', allq: true },
  { key: 'economy', title: 'Jobs & local economy', icon: '💼' },
].filter((i) => !i.allq || ALL_QUESTIONS.some((q) => q.issue === i.key)); // a topic with no statements yet stays hidden
// Issues people can pick after confirming the weekly email (/welcome/), and the two sides of each.
const SIGNUP_ISSUES = [
  ...ISSUES,
  { key: 'recreation_facilities', title: 'Brennan Park & recreation', icon: '🏊' },
  { key: 'flood_hazards_climate_resilience', title: 'Flood protection', icon: '🌊' },
  { key: 'childcare', title: 'Childcare', icon: '🧸' },
];
const SIDES = {
  growth: ['How fast should Squamish grow?', ['faster', 'Speed it up: approve more homes and projects'], ['slower', 'Slow it down: let roads and services catch up']],
  housing_affordability: ['What would help housing most?', ['more_homes', 'More homes of every kind, built faster'], ['below_market', 'More below market homes, using District land and money']],
  homelessness: ['What should come first?', ['support', 'More shelter, supportive housing and services'], ['enforcement', 'Safety and enforcement in public spaces']],
  policing: ['Where should safety money go?', ['police', 'More RCMP and bylaw officers'], ['outreach', 'More mental health and outreach teams']],
  taxes_spending: ['Taxes or services?', ['low_taxes', 'Keep tax increases low, even if some services are cut'], ['keep_services', 'Keep services and projects, even if taxes rise more']],
  climate: ['How much should climate and the environment drive council’s decisions?', ['climate_first', 'Make them a top priority, even when it adds cost'], ['cost_first', 'Keep costs down, even if climate action moves slower']],
  environment_lng: ['How should the District deal with Woodfibre LNG?', ['press', 'Press harder on local impacts, even if it means delays or legal fights'], ['work_with', 'Work with the plant and focus on the jobs and taxes it brings']],
  transportation: ['Where should transportation money go?', ['transit', 'Buses, bike lanes and sidewalks'], ['roads', 'Roads and getting around by car']],
  parking: ['Should new buildings have to include parking?', ['more_parking', 'Yes, enough for everyone who lives there, so streets don’t fill up'], ['less_parking', 'Not always: less parking keeps new homes cheaper']],
  economy: ['Land set aside for jobs: what should happen to it?', ['protect_jobs', 'Protect it for industry and jobs'], ['allow_housing', 'Let some of it become housing']],
  recreation_facilities: ['Brennan Park needs renewing. When?', ['now', 'Now, even if the District has to borrow'], ['save_first', 'Later, once there are savings to pay for it']],
  flood_hazards_climate_resilience: ['Should Squamish spend more on dikes and flood protection?', ['spend_more', 'Yes, even if taxes go up'], ['hold', 'No, keep spending where it is and hold taxes down']],
  childcare: ['Should the District help with childcare?', ['district_help', 'Yes, actively expand subsidized spaces'], ['leave_it', 'No, leave it to the Province and private operators']],
};
// The same labels for every page that shows them: { key: { t: title, i: icon, q: question, o: [[value, side], [value, side]] } }
const SIDE_LABELS = Object.fromEntries(SIGNUP_ISSUES.filter((i) => SIDES[i.key]).map((i) => [i.key, { t: i.title, i: i.icon, q: SIDES[i.key][0], o: [SIDES[i.key][1], SIDES[i.key][2]] }]));
// Each topic's own page at /issues/<slug>/, named the way people search for it.
const TOPIC_SLUG = { growth: 'growth-and-development', housing_affordability: 'housing', homelessness: 'homelessness', policing: 'policing-and-safety', taxes_spending: 'property-taxes', climate: 'climate-and-environment', environment_lng: 'woodfibre-lng-and-climate', transportation: 'transit-and-highway-99', parking: 'parking', economy: 'jobs-and-economy', recreation_facilities: 'brennan-park-and-recreation', flood_hazards_climate_resilience: 'flood-protection', other_campaign_topics: 'childcare-rentals-and-vanlife' };
const TOPIC_NAME = { growth: 'growth and development', housing_affordability: 'housing', homelessness: 'homelessness and supportive housing', policing: 'policing and community safety', taxes_spending: 'property taxes and spending', climate: 'climate and the environment', environment_lng: 'the Woodfibre LNG plant', transportation: 'transit and Highway 99', parking: 'parking', economy: 'jobs and the local economy', recreation_facilities: 'Brennan Park and recreation', flood_hazards_climate_resilience: 'flood protection', other_campaign_topics: 'childcare, short-term rentals and vanlife' };
const issueCtx = (key) => (ctx.issues || []).find((i) => i.key === key) || {};

// ---------- layout ----------
const NAV = [
  ['/council/', 'Council'], ['/meetings/', 'Meetings'], ['/promises/', 'Promises'], ['/said-vs-did/', 'Said vs did'], ['/quiz/', 'Quiz'], ['/compare/', 'Compare'], ['/news/', 'News'],
];
// The Menu lists everything; the top bar only has room for the essentials.
const MENU = [...NAV, ['/this-week/', 'This week at council'], ['/track/', 'Issues we’re following'], ['/compass/', 'Where they lean'], ['/issues/', 'The issues explained'], ['/priorities/', 'Readers’ top issues'], ['/faq/', 'Quick answers'], ['/results/', '2026 election results']];
const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10.5L12 4l8.5 6.5V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M9.5 21v-6h5v6"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.5.2 4 1.8 4.5 4.5"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  quiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.300a2.8 2.8 0 1 1 3.9 2.600c-.8.4-1.2 1-1.2 1.9"/><path d="M12 17.200v.1"/></svg>',
  vote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13h16v7.500H4z"/><path d="M8 13l1.5-8.500h5L16 13"/><path d="M10 8.500l1.5 1.5 2.5-3"/></svg>',
  compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
  meet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L6.8 5M3.5 12l1.2 1.2 2.1-2.2M3.5 18h3"/></svg>',
  promise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8l7.5 3v5.6c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V5.8z"/><path d="M8.6 12.2l2.4 2.4 4.6-5"/></svg>',
  news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h10A1.5 1.5 0 0 1 17 5.5V19a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9h2.5a.5.5 0 0 1 .5.5V19a2 2 0 0 1-2 2"/><path d="M7.5 8h6M7.5 12h6M7.5 16h4"/></svg>',
  ballot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8.500l1.2 1.2 2-2.400M8.5 14.500l1.2 1.2 2-2.400M14 9h2M14 15h2"/></svg>',
};
// Five tabs with News raised in the centre (Jeff, Oct 25). "Said vs did" lives in the Menu and the desktop top bar.
const TABS = [['/', 'Home', 'home'], ['/council/', 'Council', 'people'], ['/news/', 'News', 'news'], ['/meetings/', 'Meetings', 'meet'], ['/promises/', 'Promises', 'promise']];
// The phone Menu: every page, one per row, with How to vote near the top since it left the bottom bar.
const MENU_ICON = {
  issues: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>',
  about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.1"/></svg>',
};
const MOBILE_MENU = [
  ['/', 'Home', 'home'], ['/council/', 'Your mayor and council', 'people'], ['/meetings/', 'Council meetings: what’s next and what they decided', 'meet'],
  ['/this-week/', 'This week at council', 'meet'], ['/track/', 'Issues we’re following', 'issues'], ['/promises/', 'Promise tracker', 'promise'], ['/said-vs-did/', 'Do they vote the way they said?', 'compare'], ['/quiz/', 'Who on council thinks like you?', 'quiz'], ['/compare/', 'Compare them, issue by issue', 'compare'],
  ['/compass/', 'Where they lean', 'compass'], ['/issues/', 'The issues explained', 'issues'], ['/priorities/', 'Readers’ top issues', 'compare'], ['/news/', 'Squamish news', 'news'], ['/faq/', 'Quick answers', 'about'], ['/results/', '2026 election results', 'vote'],
  ['/about/', 'About this site &amp; sources', 'about'],
];

function page({ url, title, desc, body, hero = '', scripts = '', noindex = false, jsonld = null, image = null }) {
  const img = image || 'https://squamishvoters.com/og.png?v=4';
  const cur = (href) => ((href === '/' ? url === '/' : url.startsWith(href)) ? ' aria-current="page"' : '');
  const full = title ? `${title} — ${SITE.name}` : 'Squamish Voters: what Squamish council is deciding, how each member votes, and whether they keep their promises';
  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc || 'Squamish council in plain words: upcoming meetings, what was decided, how the mayor and each councillor voted, and which campaign promises they have kept.')}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(desc || 'What Squamish council decided, who voted for what, and which promises they kept. In plain words.')}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Squamish Voters">
<meta property="og:url" content="https://squamishvoters.com__PATH__">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Squamish Voters: an independent, plain-language guide to Squamish council">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${img}">
<link rel="canonical" href="https://squamishvoters.com__PATH__">
<meta name="theme-color" content="#0f4c3a">${noindex ? '\n<meta name="robots" content="noindex, nofollow">' : ''}${jsonld ? `\n<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<header class="site-header">
  <div class="wrap">
    <a class="logo" href="/" aria-label="${SITE.name} — home">
      <svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#ffb703"/><path d="M5 30 L15 12 L21 22 L26 15 L35 30 Z" fill="#0f4c3a"/><path d="M12.5 25l3.5 3.5 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Squamish Voters<small>Stay up to date, easily</small></span>
    </a>
    <nav class="top-nav" aria-label="Main">
      ${NAV.map(([h, l]) => `<a href="${h}"${cur(h)}>${l}</a>`).join('')}
    </nav>
    <button class="hdr-btn menu-btn" type="button" aria-expanded="false" aria-controls="menu-panel"><span>Menu</span></button>
  </div>
  <div class="menu-panel" id="menu-panel">
    <nav class="wrap" aria-label="All pages">
      ${MOBILE_MENU.map(([h, l, i]) => `<a href="${h}"${cur(h)}>${MENU_ICON[i] || ICON[i] || ''}<span>${l}</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>`).join('')}
    </nav>
  </div>
</header>
${hero}
<main id="main"><div class="wrap">
${body}
</div></main>
<footer class="site-footer"><div class="wrap">
  <div class="cols">
    <div><h2>${SITE.name}</h2><p>An independent, non-partisan guide to Squamish council made by <a href="/about/#who">Jeff Kirdeikis</a>, a Squamish resident. Not affiliated with the District of Squamish, any council member, or any party.</p><p>Last updated ${esc(SITE.updated)}.</p><p data-visits hidden><b>0</b> page views so far.</p></div>
    <div><h2>Pages</h2><ul>${[['/', 'Home'], ...MENU, ['/about/', 'About, method &amp; corrections']].map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ul></div>
    <div><h2>Official information</h2><ul><li><a href="https://squamish.ca/government-and-administration/council/" target="_blank" rel="noopener">District of Squamish: council</a></li><li><a href="https://squamish.civicweb.net/Portal/MeetingSchedule.aspx" target="_blank" rel="noopener">Official agendas and minutes</a></li><li><a href="https://www.youtube.com/@DistrictofSquamish/streams" target="_blank" rel="noopener">Meeting videos (YouTube)</a></li><li><a href="https://www.facebook.com/groups/1090076830319905" target="_blank" rel="noopener">Squamish Voters &amp; Politics on Facebook</a></li></ul>
    </div>
    <div><h2>Spot a mistake?</h2><p>Are you on council, or did we get something wrong? Email <a href="mailto:${SITE.contact}">${SITE.contact}</a> and we’ll fix it.</p></div>
  </div>
</div></footer>
<nav class="tabbar" aria-label="Quick navigation">
  ${TABS.map(([h, l, i]) => `<a href="${h}"${cur(h)}${i === 'news' ? ' class="tab-feature"' : ''}>${ICON[i] || MENU_ICON[i]}<span>${l}</span></a>`).join('')}
</nav>
<a class="totop no-print" href="#main" id="totop" hidden>↑ Top</a>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="/site.js"></script>
${scripts}${noindex ? '' : '\n<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)}</script><script defer src="/_vercel/insights/script.js"></script>'}
</body></html>`;
}

const SITEMAP = []; // every indexable page, built into sitemap.xml at the end
function write(url, html) {
  if (!/name="robots" content="noindex/.test(html) && url !== '/404/') SITEMAP.push(url);
  const out = path.join(DIST, url, 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html.replaceAll('__PATH__', url)); // each page's own address, for sharing and search engines
}

// ---------- components ----------
const pickBtn = () => ''; // "My ballot" ended with the election
const candCard = (c) => `<li class="crow" data-incumbent="${!!c.incumbent}">
  <a class="crow-hit" href="/council/${c.slug}/">${avatar(c)}
    <span class="crow-txt"><b>${esc(c.name)}</b><span class="crow-role">${c.office === 'mayor' ? 'Mayor' : 'Councillor'}${c.incumbent && c.office === 'council' ? ' · re-elected' : ''}</span>
    <span class="crow-sub">${esc(c.tagline)}</span>
    <span class="crow-growth">${growthSentence(c)}</span></span>
    <span class="go" aria-hidden="true">›</span></a>
  ${pickBtn(c, 'btn secondary add no-print')}
</li>`;
const faceTile = (c) => `<a class="face" href="/council/${c.slug}/">${avatar(c)}<b>${esc(c.name)}</b><span class="small">${c.office === 'mayor' ? 'Mayor' : 'Councillor'}</span></a>`;
const nameChip = (c) => `<li><a href="/council/${c.slug}/"${c.office === 'mayor' ? ' class="m"' : ''}>${avatar(c, 'xs')}${esc(c.name)}${c.office === 'mayor' ? ' <span class="small">(mayor)</span>' : ''}</a></li>`;


// ---------- MEETINGS, VOTES & PROMISES ----------
const crumbLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, u], n) => ({ '@type': 'ListItem', position: n + 1, name, item: ORIGIN + u })) });
// Each meeting type gets one colour everywhere it appears, so people can tell them apart at a glance.
const MTYPE = {
  regular: { label: 'Council meeting', cls: 'mt-regular', plain: 'The main meeting where council makes official decisions and votes.' },
  cow: { label: 'Committee of the Whole', cls: 'mt-cow', plain: 'The whole council talking an issue through before it comes to a vote. Usually no final decisions.' },
  hearing: { label: 'Public hearing', cls: 'mt-hearing', plain: 'Residents can speak to council about a rezoning or bylaw before council decides. Held as part of a council meeting.' },
  special: { label: 'Special meeting', cls: 'mt-special', plain: 'An extra meeting called for a few items. Often short, and sometimes only to go behind closed doors.' },
  inaugural: { label: 'Swearing-in meeting', cls: 'mt-special', plain: 'The new mayor and councillors take their oath of office.' },
};
const mType = (m) => MTYPE[m.type] || MTYPE.regular;
const mBadge = (m) => `<span class="mtype ${mType(m).cls}">${esc(mType(m).label)}</span>`;
const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtTime = (t) => { if (!t) return ''; const [h, mi] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}${mi ? ':' + String(mi).padStart(2, '0') : ''} ${h < 12 ? 'a.m.' : 'p.m.'}`; };
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
const upcoming = MEETINGS.filter((m) => m.date >= TODAY && !m.summary && m.status !== 'cancelled');
const past = MEETINGS.filter((m) => !upcoming.includes(m) && m.status !== 'cancelled').reverse();
const mUrl = (m) => `/meetings/${m.id}/`;
const VOTE_WORD = { yes: 'Voted yes', no: 'Voted no', absent: 'Not there', recused: 'Stepped out (conflict of interest)', unknown: 'Not clear yet' };
const RESULT_WORD = { passed: 'Passed', failed: 'Failed', referred: 'Sent back for more work', info: 'No vote' };
const bySlug = Object.fromEntries(all.map((c) => [c.slug, c]));
// Every recorded vote, newest first, for profiles and the said-vs-did table.
const DECISIONS = past.flatMap((m) => (m.decisions || []).map((d) => ({ ...d, m })));
const votesOf = (c) => DECISIONS.filter((d) => d.votes && d.votes[c.slug] && d.votes[c.slug] !== 'unknown');
// A promise's status is set by the pipeline from the votes; "not_yet" until council acts on it.
const PSTATUS = {
  kept: { label: 'Kept', cls: 'ps-kept', icon: '✓' },
  broken: { label: 'Broken', cls: 'ps-broken', icon: '✕' },
  progress: { label: 'In progress', cls: 'ps-progress', icon: '…' },
  not_yet: { label: 'Not tested yet', cls: 'ps-notyet', icon: '○' },
};
const pStatus = (p) => PSTATUS[p.status] || PSTATUS.not_yet;
const promisesOf = (c) => PROMISES.filter((p) => p.slug === c.slug);
const pCounts = (list) => Object.fromEntries(Object.keys(PSTATUS).map((k) => [k, list.filter((p) => (p.status || 'not_yet') === k).length]));
const pBadge = (p) => `<span class="pstatus ${pStatus(p).cls}"><span aria-hidden="true">${pStatus(p).icon}</span> ${pStatus(p).label}</span>`;
function promiseRow(p, { who = false } = {}) {
  const c = bySlug[p.slug];
  const ev = (p.evidence || []);
  return `<details class="promise" id="p-${esc(p.id)}"><summary>${pBadge(p)}<span class="ptxt">${who && c ? `<b class="pwho">${esc(c.name)}:</b> ` : ''}${escGl(p.promise)}</span></summary>
  <div class="pbody">
    <p class="small"><b>What ${c ? esc(first(c)) : 'they'} said:</b></p><blockquote>“${esc(p.quote)}”</blockquote>${src(p.source_url)}
    <p class="small"><b>How we’ll know:</b> ${esc(p.how_to_check)}</p>
    ${ev.length ? `<p class="small"><b>What has happened so far:</b></p><ul class="small">${ev.map((e) => { const m = MEETINGS.find((x) => x.id === e.meeting); return `<li>${m ? `<a href="${mUrl(m)}">${esc(fmtLong(m.date))}</a>: ` : ''}${esc(e.note)}</li>`; }).join('')}</ul>` : '<p class="small muted">Council hasn’t voted on anything that tests this yet.</p>'}
    ${p.updated ? `<p class="small muted">Status worked out automatically from council votes on ${esc(fmtLong(p.updated))}. <a href="/promises/#how">How we judge promises</a>.</p>` : ''}
  </div></details>`;
}
function voteChips(d) {
  const groups = ['yes', 'no', 'recused', 'absent', 'unknown'].map((k) => [k, all.filter((c) => d.votes?.[c.slug] === k)]).filter(([, l]) => l.length);
  const how = d.votes_source === 'minutes' ? 'Checked against the official minutes.' : 'From the meeting video. We check it against the official minutes when they come out, usually a few weeks later.';
  return `<div class="vchips">${groups.map(([k, l]) => `<div class="vgroup v-${k}"><span class="vlab">${{ yes: '✓ Yes', no: '✕ No', recused: 'Stepped out', absent: 'Not there', unknown: 'Not clear' }[k]}</span>${l.map((c) => `<a href="/council/${c.slug}/" class="vface">${avatar(c, 'xs')}${esc(lastName(c))}</a>`).join('')}</div>`).join('')}<p class="small muted">${how}</p></div>`;
}
function decisionCard(d, m, { open = false } = {}) {
  const yes = Object.values(d.votes || {}).filter((v) => v === 'yes').length, no = Object.values(d.votes || {}).filter((v) => v === 'no').length;
  return `<details class="decision r-${esc(d.result || 'info')}"${open ? ' open' : ''}><summary><span class="dres">${esc(RESULT_WORD[d.result] || 'Decided')}${d.result === 'passed' || d.result === 'failed' ? ` <span class="small">${no === 0 && yes > 1 ? 'all agreed' : `${yes}–${no}`}</span>` : ''}</span><span class="dtitle">${escGl(d.title)}</span></summary>
  <div class="dbody">${d.for_you ? `<p class="foryou"><b>What it means for you:</b> ${escGl(d.for_you)}</p>` : ''}<p>${escGl(d.what)}</p>${d.votes ? voteChips(d) : ''}
  ${areaTags(d.areas)}${(d.issues || []).map((sl) => TRACKED.find((t) => t.slug === sl)).filter(Boolean).map((t) => `<p class="small">Part of: <a href="/track/${t.slug}/">${esc(t.title)}</a></p>`).join('')}
  ${d.why_it_matters ? `<p class="small"><b>Why it matters:</b> ${escGl(d.why_it_matters)}</p>` : ''}
  ${isUrl(d.video_url) ? `<p class="small"><a href="${esc(d.video_url)}" target="_blank" rel="noopener">▶ Watch this part of the meeting</a></p>` : ''}</div></details>`;
}
function meetingRow(m) {
  const done = !!m.summary;
  return `<li class="mrow ${mType(m).cls}${done ? ' done' : ''}"><a href="${mUrl(m)}"><span class="mcheck" aria-hidden="true">${done ? '✓' : ''}</span>
  <span class="mtxt"><span class="mwhen"><b>${esc(fmtDay(m.date))}</b>${m.time ? ` · ${esc(fmtTime(m.time))}` : ''}</span><span class="mtags">${mBadge(m)}${m.has_public_hearing ? `<span class="mtype ${MTYPE.hearing.cls}">Includes a public hearing</span>` : ''}${m.closed_only ? '<span class="mtype mt-special">Mostly behind closed doors</span>' : ''}</span>
  <span class="mhead">${esc(done ? m.summary.headline : (m.preview || mType(m).plain))}</span>
  ${done && (m.decisions || []).length ? `<span class="small">${m.decisions.filter((d) => d.votes).length} vote${m.decisions.filter((d) => d.votes).length === 1 ? '' : 's'} · tap to read</span>` : m.date >= TODAY ? '<span class="small">Coming up · tap for what’s on the agenda</span>' : '<span class="small">Summary coming soon</span>'}</span>
  <span class="go" aria-hidden="true">›</span></a></li>`;
}
// Positions: everything a member said they stand for during the campaign, checked against how they vote.
// Two kinds: their agree/disagree answers (quiz statements) and each line of their "supports" and "against" lists.
// A decision links to them with related_q: [{ q, yes_is }] and positions: [{ id, yes_is }], where yes_is 1 means a
// yes vote goes the same way as the statement or position. The pipeline writes both links (scripts/pipeline/summarize.mjs).
const posId = (c, kind, text) => `${c.slug}-${kind}-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 6)}`;
const POS_WORD = { 2: 'Strongly agreed', 1: 'Agreed', '-1': 'Disagreed', '-2': 'Strongly disagreed' };
function positionsOf(c) {
  const quiz = ALL_QUESTIONS.filter((q) => typeof c.quiz_answers?.[q.id] === 'number' && c.quiz_answers[q.id] !== 0)
    .map((q) => ({ id: `${c.slug}-${q.id}`, kind: 'quiz', q, said: c.quiz_answers[q.id], label: `${POS_WORD[c.quiz_answers[q.id]]}: “${q.text}”`, src: `/council/${c.slug}/#questionnaire` }));
  const list = (key, kind, word) => (c[key] || []).map((x) => ({ id: posId(c, kind, x.text), kind, label: `${word}: ${x.text}`, src: x.source_url }));
  return [...quiz, ...list('supports', 's', 'Said they support'), ...list('opposes', 'o', 'Said they’re against')];
}
function checksFor(c, pos) {
  return votesOf(c).filter((d) => ['yes', 'no'].includes(d.votes[c.slug])).flatMap((d) => {
    const v = d.votes[c.slug] === 'yes' ? 1 : -1;
    const link = pos.kind === 'quiz' ? (d.related_q || []).find((r) => r.q === pos.q.id) : (d.positions || []).find((r) => r.id === pos.id);
    if (!link) return [];
    const dir = v * (link.yes_is || 1);
    return [{ d, inLine: pos.kind === 'quiz' ? Math.sign(dir) === Math.sign(pos.said) : dir > 0 }];
  });
}
// What a member's votes say about each quiz statement, on the same -2..+2 scale as their campaign answer:
// every vote that tests the statement counts +1 (went the statement's way) or -1, averaged, times 2.
function votedAnswers(c) {
  const out = {};
  for (const q of ALL_QUESTIONS) {
    const dirs = votesOf(c).filter((d) => ['yes', 'no'].includes(d.votes[c.slug])).flatMap((d) => (d.related_q || []).filter((r) => r.q === q.id).map((r) => (d.votes[c.slug] === 'yes' ? 1 : -1) * (r.yes_is || 1)));
    if (dirs.length) out[q.id] = { v: Math.round((dirs.reduce((a, b) => a + b, 0) / dirs.length) * 2), n: dirs.length };
  }
  return out;
}
const ANY_VOTES = DECISIONS.some((d) => d.votes);
const FIRST_VOTES = (upcoming.find((m) => m.type !== 'inaugural') || {}).date;
// One member's track record as a card: replaces wide tables that fell apart on phones.
function scoreCard(c, { promises = true, positions = true } = {}) {
  const ps = promisesOf(c), pc = pCounts(ps), pr = positionReport(c);
  const bar = (parts, total) => `<span class="sbar" aria-hidden="true">${parts.filter(([n]) => n).map(([n, cls]) => `<i class="${cls}" style="flex:${n}"></i>`).join('')}${total - parts.reduce((a, [n]) => a + n, 0) > 0 ? `<i class="ps-notyet" style="flex:${total - parts.reduce((a, [n]) => a + n, 0)}"></i>` : ''}</span>`;
  const line = (label, parts, total, untested) => `<div class="sline"><p><b>${label}</b></p>${bar(parts, total)}<p class="small">${parts.map(([n, , w]) => `${n} ${w}`).join(' · ')} · ${untested} not tested yet</p></div>`;
  // Before any votes there is nothing to score: one quiet line instead of rows of zeros.
  if (!ANY_VOTES) return `<a class="scard" href="/council/${c.slug}/#record">${avatar(c, 'sm')}<span class="sbody"><span class="sname"><b>${esc(c.name)}</b><span class="small">${[promises && `${ps.length} promises`, positions && `${pr.rows.length} positions`].filter(Boolean).join(' · ')} tracked</span></span></span><span class="go" aria-hidden="true">›</span></a>`;
  return `<a class="scard" href="/council/${c.slug}/#record">${avatar(c, 'sm')}<span class="sbody"><span class="sname"><b>${esc(c.name)}</b><span class="small">${c.office === 'mayor' ? 'Mayor' : 'Councillor'}</span></span>
  ${promises ? line('Promises', [[pc.kept, 'ps-kept', 'kept'], [pc.broken, 'ps-broken', 'broken'], [pc.progress, 'ps-progress', 'in progress']], ps.length, pc.not_yet) : ''}
  ${positions ? line('Positions', [[pr.inLine, 'ps-kept', 'voted the way they said'], [pr.against, 'ps-broken', 'voted against'], [pr.mixed, 'ps-progress', 'mixed']], pr.rows.length, pr.untested) : ''}</span></a>`;
}
const noVotesNote = () => ANY_VOTES ? '' : `<div class="notice info"><b>No votes yet.</b> The new council is sworn in on November 3${FIRST_VOTES ? ` and its first regular meeting is ${esc(fmtLong(FIRST_VOTES))}` : ''}. Every vote after that is checked here automatically.</div>`;
const posStatus = (checks) => (!checks.length ? 'untested' : checks.every((x) => x.inLine) ? 'in_line' : checks.every((x) => !x.inLine) ? 'against' : 'mixed');
const POS_STATUS = { in_line: ['✓', 'Voted the way they said', 'ps-kept'], against: ['✕', 'Voted against what they said', 'ps-broken'], mixed: ['~', 'Mixed', 'ps-progress'], untested: ['○', 'Not tested yet', 'ps-notyet'] };
const posBadge = (st) => `<span class="pstatus ${POS_STATUS[st][2]}"><span aria-hidden="true">${POS_STATUS[st][0]}</span> ${POS_STATUS[st][1]}</span>`;
function positionReport(c) {
  const rows = positionsOf(c).map((p) => { const ch = checksFor(c, p); return { p, ch, st: posStatus(ch) }; });
  const count = (k) => rows.filter((r) => r.st === k).length;
  return { rows, tested: rows.filter((r) => r.st !== 'untested'), inLine: count('in_line'), against: count('against'), mixed: count('mixed'), untested: count('untested') };
}
const posRow = (c, r) => `<details class="promise"><summary>${posBadge(r.st)}<span class="ptxt">${escGl(r.p.label)}</span></summary><div class="pbody">
  ${r.ch.length ? `<ul class="small">${r.ch.map((x) => `<li>${x.inLine ? '✓' : '✕'} ${esc(VOTE_WORD[x.d.votes[c.slug]])} on <a href="${mUrl(x.d.m)}">${escGl(x.d.title)}</a> (${esc(fmtLong(x.d.m.date))})</li>`).join('')}</ul>` : '<p class="small muted">Council hasn’t voted on anything that tests this yet.</p>'}
  ${isUrl(r.p.src) || r.p.src?.startsWith('/') ? `<p class="small"><a href="${esc(r.p.src)}">Where they said it</a></p>` : ''}</div></details>`;
function profileRecord(c) {
  const f = esc(first(c)), ps = promisesOf(c), pc = pCounts(ps), vs = votesOf(c), pr = positionReport(c);
  const next = upcoming[0];
  const pSum = ps.length ? `${pc.kept} kept · ${pc.broken} broken · ${pc.progress} in progress · ${pc.not_yet} not tested yet` : '';
  if (!ANY_VOTES) return `<section class="card record" id="record"><h2>${f}’s record on council</h2>
  <p>Council hasn’t voted yet. We’re tracking <a href="#promises"><b>${ps.length} promises</b></a> and <a href="#said-did"><b>${pr.rows.length} positions</b></a> ${f} took during the campaign.${next ? ` First meeting: <a href="${mUrl(next)}">${esc(fmtLong(next.date))}</a>.` : ''}</p></section>
  ${ps.length ? `<h2 id="promises">${f}’s promises <span class="small">${ps.length}</span></h2>
  <p class="small">What ${f} promised during the campaign, in plain words. Tap one for the exact quote and source.</p>
  <div class="card stack">${ps.map((p) => promiseRow(p)).join('')}</div>` : ''}
  <h2 id="said-did">Does ${f} vote the way ${f} said?</h2>
  <p class="small">${pr.rows.length} things ${f} said during the campaign. Each gets a mark once a council vote tests it.</p>
  <details class="drop"><summary>See all ${pr.rows.length} positions</summary><div class="stack">${pr.rows.map((r) => posRow(c, r)).join('')}</div></details>`;
  return `<section class="card record" id="record"><h2>${f}’s record on council</h2>
  <div class="statrow"><div><b>${ps.length}</b><span>campaign promises we track</span></div><div><b>${vs.filter((d) => ['yes', 'no'].includes(d.votes[c.slug])).length}</b><span>votes cast so far</span></div><div><b>${pc.kept} / ${pc.broken}</b><span>promises kept / broken</span></div><div><b>${pr.inLine} / ${pr.against}</b><span>positions voted in line / against</span></div></div>
  ${vs.length ? '' : `<p class="small">${TODAY < '2026-11-03' ? 'The new council is sworn in on November 3, 2026.' : 'This council was sworn in on November 3, 2026.'} ${next && next.date !== '2026-11-03' ? `The next meeting is <a href="${mUrl(next)}">${esc(fmtDay(next.date))}</a>.` : ''} Votes will appear here after each meeting.</p>`}</section>
  ${ps.length ? `<h2 id="promises">${f}’s promises <span class="small">${pSum}</span></h2>
  <p class="small">What ${f} promised during the campaign, in plain words, with the exact quote and source. Tap any promise to see the details.</p>
  <div class="card stack">${ps.map((p) => promiseRow(p)).join('')}</div>` : ''}
  ${vs.length ? `<h2 id="votes">How ${f} has voted</h2>
  <div class="card stack">${vs.slice(0, 8).map((d) => `<div class="vrow"><span class="vme v-${d.votes[c.slug]}">${esc(VOTE_WORD[d.votes[c.slug]] || d.votes[c.slug])}</span><span><a href="${mUrl(d.m)}">${escGl(d.title)}</a><span class="small"> · ${esc(fmtLong(d.m.date))} · ${esc(RESULT_WORD[d.result] || '')}</span></span></div>`).join('')}</div>
  ${vs.length > 8 ? `<details class="drop"><summary>All ${vs.length} votes</summary>${vs.slice(8).map((d) => `<div class="vrow"><span class="vme v-${d.votes[c.slug]}">${esc(VOTE_WORD[d.votes[c.slug]] || d.votes[c.slug])}</span><span><a href="${mUrl(d.m)}">${escGl(d.title)}</a><span class="small"> · ${esc(fmtLong(d.m.date))}</span></span></div>`).join('')}</details>` : ''}` : ''}
  <h2 id="said-did">Does ${f} vote the way ${f} said?</h2>
  <p class="small">Everything ${f} said they stand for during the campaign (${pr.rows.length} positions), checked against every council vote that tests it.</p>
  <div class="pstats">${['in_line', 'against', 'mixed', 'untested'].map((k) => `<span class="pstatus ${POS_STATUS[k][2]}"><span aria-hidden="true">${POS_STATUS[k][0]}</span> ${pr[{ in_line: 'inLine', against: 'against', mixed: 'mixed', untested: 'untested' }[k]]} ${esc(POS_STATUS[k][1].toLowerCase())}</span>`).join('')}</div>
  ${pr.tested.length ? `<div class="card stack">${pr.tested.map((r) => posRow(c, r)).join('')}</div>` : ''}
  <details class="drop"><summary>${pr.untested} positions council hasn’t voted on yet</summary><div class="stack">${pr.rows.filter((r) => r.st === 'untested').map((r) => posRow(c, r)).join('')}</div></details>`;
}


// ---------- FOR YOU, SHARING, HAVE YOUR SAY, EMAIL ----------
const STEP_ICON = { done: '✓', current: '●', upcoming: '○' };
const issueDecisions = (t) => DECISIONS.filter((d) => (d.issues || []).includes(t.slug));
const stepNow = (t) => { const i = (t.steps || []).findIndex((x) => x.status === 'current'); return i < 0 ? null : { i, n: t.steps.length, step: t.steps[i] }; };
const issueRow = (t) => { const now = stepNow(t); return `<li class="mrow"><a href="/track/${t.slug}/"><span class="mtxt"><b class="mhead">${esc(t.question)}</b>${now ? `<span class="small">Step ${now.i + 1} of ${now.n}: ${esc(now.step.label)}</span>` : ''}</span><span class="go" aria-hidden="true">›</span></a></li>`; };

const hoodName = (sl) => (HOODS.find((h) => h.slug === sl) || {}).name || '';
const areaTags = (areas) => (areas || []).filter((a) => a !== 'all' && hoodName(a)).length ? `<p class="areas">${areas.filter((a) => hoodName(a)).map((a) => `<span class="area">📍 ${esc(hoodName(a))}</span>`).join('')}</p>` : '';
// One statement with all 7 answers as tiles (Said vs did, issue pages).
function qCard(q) {
  const people = [...mayors, ...council];
  const mark = (c) => { const pos = positionsOf(c).find((p) => p.kind === 'quiz' && p.q.id === q.id); if (!pos) return ''; const st = posStatus(checksFor(c, pos)); return st === 'untested' ? '' : `<span class="vmark ${POS_STATUS[st][2]}">${st === 'in_line' ? '✓ voted that way' : st === 'against' ? '✕ voted against' : '~ mixed'}</span>`; };
  const t = DECISIONS.filter((d) => (d.related_q || []).some((r) => r.q === q.id));
  return `<div class="card qcard"><p class="qtext">“${escGl(q.text)}”</p>
    <ul class="qwho">${people.map((c) => `<li><a href="/council/${c.slug}/#said-did">${cell(c.quiz_answers?.[q.id])}<span class="qname">${esc(lastName(c))}</span>${mark(c)}</a></li>`).join('')}</ul>
    ${t.length ? `<p class="small">Tested by: ${t.map((d) => `<a href="${mUrl(d.m)}">${escGl(d.title)}</a>`).join(', ')}</p>` : ''}</div>`;
}
const signupBox = (where) => `<section class="card signup no-print" id="signup"><h2>Get it by email, once a week</h2>
  <p>Every Friday morning: what council decided that week and what’s coming up. Plain words, nothing else. Unsubscribe any time.</p>
  <form data-subscribe="${where}" novalidate>
    <label class="fld">Your email<input type="email" name="email" autocomplete="email" required placeholder="you@example.com"></label>
    <button class="btn big block" type="submit">Send me the weekly email</button>
    <p class="small">We’ll email you a link to confirm. Unsubscribe any time.</p>
    <p class="small" data-msg role="status"></p>
  </form>
  <p class="small muted">Sent by Squamish Voters (Jeff Kirdeikis, Squamish, B.C.). We never share your address. <a href="/this-week/">See this week’s email</a>.</p></section>`;
// How to take part, from the District's own rules (data/participate.json). Short first, the fine print one tap away.
function haveSay(m, item, t) {
  const W = PART.write_to_council || {}, SP = PART.speak_at_a_meeting || {}, H = PART.public_hearings || {}, D = PART.delegations || {};
  const budget = t && t.slug === 'budget-2027' && W.budget_feedback_email;
  const email = budget ? W.budget_feedback_email : W.email || 'council@squamish.ca';
  const subject = `Comment for council${m ? `, ${fmtLong(m.date)} meeting` : ''}${item ? `: ${item}` : ''}`;
  const hearing = m && m.has_public_hearing && H.email;
  // Agendas are posted the Thursday before a Tuesday meeting, so that is the practical cut-off for a letter.
  const cut = m ? new Date(new Date(m.date + 'T12:00:00Z').getTime() - 5 * 864e5).toISOString().slice(0, 10) : null;
  return `<section class="card havesay"><h2>Have your say</h2>
    <p><b>Write to council.</b> One email reaches the mayor and all six councillors.${cut && cut >= TODAY ? ` <b>Send it by ${esc(fmtLong(cut))}</b> to be in the meeting package.` : ''} Include your name: anonymous letters aren’t passed on, and your name is published with your letter.${src(W.source_url, 'District of Squamish')}</p>
    <p><a class="btn" href="mailto:${esc(email)}?subject=${encodeURIComponent(subject)}">✉️ Email ${budget ? 'budget feedback' : 'council'} about this</a></p>
    ${hearing ? `<p><b>This meeting has a public hearing.</b> Email <a href="mailto:${esc(H.email)}?subject=${encodeURIComponent(subject)}">${esc(H.email)}</a> by 3 p.m. on the day, or speak in person, by Webex or by phone (three minutes each).${src(H.written_source_url)}</p>` : ''}
    <p><b>Speak at the meeting.</b> No need to sign up. Near the end of each regular meeting, anyone can ask a question for up to two minutes about what was on the agenda.${src(SP.source_url, 'District of Squamish')}</p>
    <details class="more"><summary>More ways and the fine print</summary>
      ${SP.unscheduled_public_attendance ? `<p><b>Something urgent?</b> ${escGl(SP.unscheduled_public_attendance.how_it_works)} ${escGl(SP.unscheduled_public_attendance.limits)}</p>` : ''}
      ${SP.ways_to_join ? `<p><b>How to join.</b> ${escGl(SP.ways_to_join)}</p>` : ''}
      ${D.summary ? `<p><b>Book a presentation.</b> ${escGl(D.summary)} ${D.form_url ? `<a href="${esc(D.form_url)}" target="_blank" rel="noopener">Application form (PDF)</a>.` : ''}${D.contact ? ` ${esc(D.contact)}.` : ''}</p>` : ''}
      ${W.mail ? `<p><b>By mail:</b> ${esc(W.mail)}. <b>Phone:</b> ${esc(W.phone || '')}.</p>` : ''}
      ${W.what_happens ? `<p class="small">${escGl(W.what_happens)}${src(W.what_happens_source_url)}</p>` : ''}
    </details>
    <p><b>Watch.</b> Live and afterward on the <a href="https://www.youtube.com/@DistrictofSquamish/streams" target="_blank" rel="noopener">District’s YouTube channel</a>.</p></section>`;
}
const shareText = (m) => `${m.summary.headline}\n\n${(m.summary.key_points || []).slice(0, 4).map((k) => '• ' + k).join('\n')}\n\nWho voted which way, in plain words: ${ORIGIN}${mUrl(m)}`;
const shareBar = (m) => `<div class="sharebar no-print"><a class="btn secondary" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(ORIGIN + mUrl(m))}" target="_blank" rel="noopener">Share on Facebook</a>
  <button class="btn secondary" type="button" data-copy="${esc(shareText(m))}">Copy a post to paste</button>
  <button class="btn secondary" type="button" data-print>🖨 Print one page</button></div>`;
const shareImg = (m) => (fs.existsSync(path.join(ROOT, 'public', 'share', `${m.id}.png`)) ? `${ORIGIN}/share/${m.id}.png` : null);

// ---------- PROFILES ----------
// Show the first few points; the rest stay one tap away rather than filling the screen.
const SHOW_FIRST = 3;
function sideList(c, key, heading, cls, listCls) {
  const items = c[key] || [];
  if (!items.length) return `<section class="card ${cls}"><h2>${heading}</h2><p class="muted">Nothing found on the public record yet.</p></section>`;
  const row = (s) => `<li>${escGl(s.text)}${src(s.source_url)}</li>`;
  const head = items.slice(0, SHOW_FIRST), rest = items.slice(SHOW_FIRST);
  return `<section class="card ${cls}"><h2>${heading}</h2><ul class="${listCls}">${head.map(row).join('')}</ul>
  ${rest.length ? `<details class="more"><summary>Show ${rest.length} more</summary><ul class="${listCls}">${rest.map(row).join('')}</ul></details>` : ''}</section>`;
}
const WRITE_IN = [
  ['one_thing', 'If you achieve only one thing in four years, what is it?'],
  ['say_no', 'Name something you will vote against, even if it is popular.'],
  ['homelessness', 'Squamish’s sharpest argument: what would you actually do about encampments, Under One Roof and street disorder — and what would it cost?'],
  ['differently', 'One council decision from the last four years you’d have made differently, and what you’d have done.'],
  ['disagree', 'What would you say to a resident on the other side of your biggest issue?'],
  ['corrections', 'Is anything on your profile wrong, out of date or missing? Tell us and we’ll fix it.'],
  ['pitch', 'Your one-line pitch — we may use this as your tagline on the site.'],
];
// Shown only once a candidate has returned the longer questionnaire.
const ANSWER_WORD = { '2': 'Strongly agrees', '1': 'Somewhat agrees', '0': 'In the middle', '-1': 'Somewhat disagrees', '-2': 'Strongly disagrees' };
// A long statement the candidate published themselves (not sent to us, so no "answered us" badge). We host a transcription so every line can be checked.
function paperNotice(c) {
  if (!c.paper) return '';
  const f = esc(first(c));
  return `<div class="notice info"><b>${f} has published a ${c.paper.points}-point positions paper.</b> ${f} ${esc(c.paper.where)} around ${esc(fmtLong(c.paper.date))}. The supports, against list and topics below now come from it. <a href="${esc(c.paper.url)}">Read it in full, in ${f}’s own words →</a>${isUrl(c.paper.post_url) ? ` · <a href="${esc(c.paper.post_url)}" target="_blank" rel="noopener">original post</a>` : ''}</div>`;
}
function directNotice(c) {
  if (!c.direct) return '';
  const f = esc(first(c)), when = esc(fmtLong(c.direct.date));
  if (c.direct.kind === 'email') return `<div class="notice direct"><b>✓ New — ${f} answered us by email.</b> On ${when}, ${f} sent Squamish Voters written answers about ${esc(c.direct.topic)}. They are published in full, word for word. <a href="#emailed">Read ${f}’s answers</a>.</div>`;
  return isDirectQ(c)
    ? `<div class="notice direct"><b>✓ Verified — in ${f}’s own words.</b> ${f} filled in our candidate questionnaire on ${when}. ${c.direct.checked ? esc(c.direct.checked) : `It was sent from the email address ${f} filed with the District of Squamish.`} ${(c.direct.answered || [1]).length ? `Everything marked <span class="badge direct">✓ Direct answer</span> below is ${f}’s own answer, not our reading of the public record. <a href="#questionnaire">Jump to all answers</a>.` : `${f} answered the written questions but skipped the agree/disagree statements, so the quiz still has no answers from ${f}. <a href="#own-words">Read ${f}’s written answers</a> · <a href="#questionnaire">see the statements not yet answered</a>.`}${stmtOf(c) ? ` ${f} also sent us a platform statement on ${esc(fmtLong(stmtOf(c).date))} — <a href="${esc(stmtOf(c).url)}">read it in full</a>.` : ''}</div>`
    : `<div class="notice direct"><b>✓ New — sent to us by ${f}.</b> ${f} sent Squamish Voters a platform statement on ${when}. The supports, against list and topics below now come from it. ${/\.pdf$/i.test(c.direct.url) ? `<a href="${esc(c.direct.url)}" target="_blank" rel="noopener">Read the original (PDF)</a>` : `<a href="${esc(c.direct.url)}">Read it in full, in ${f}’s own words →</a>`}.</div>`;
}
// Written answers a candidate emailed us: published whole, never trimmed or reworded.
function emailedAnswers(c) {
  if (!(c.emailed || []).length) return '';
  const para = (t) => t.split(/\n\n+/).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  return `<h2 id="emailed">${esc(first(c))}’s emailed answers <span class="badge direct">✓ Own words</span></h2>
  <p class="small">Sent to Squamish Voters on ${esc(fmtLong(c.direct.date))}. Published in full and unedited.</p>
  <div class="card stack">${c.emailed.map((x, n) => `<details class="stance-row has-more"${n === 0 ? ' open' : ''}><summary><span class="txt"><b>${esc(x.q)}</b>${moreBtn(`Click to expand — read ${esc(first(c))}’s full answer`)}</span></summary><blockquote class="long">${para(x.a)}</blockquote>${x.note ? `<p class="small ednote">${esc(x.note)}</p>` : ''}</details>`).join('')}</div>`;
}
function directAnswers(c) {
  if (!isDirectQ(c)) {
    // Researched (not candidate-supplied) scores on the non-quiz statements.
    const rows = EXTRA_QUESTIONS.filter((q) => typeof c.quiz_answers?.[q.id] === 'number');
    return rows.length ? `<details class="drop"><summary>More of ${esc(first(c))}’s positions (${rows.length})</summary>
    <ul class="qa">${rows.map((q) => `<li><b>${escGl(q.text)}</b><span class="ans">${ANSWER_WORD[String(c.quiz_answers[q.id])]}</span></li>`).join('')}</ul>
    <p class="small">Our reading of ${esc(first(c))}’s public statements and votes — ${esc(first(c))} has not answered our questionnaire.</p></details>` : '';
  }
  const rows = ALL_QUESTIONS.filter((q) => selfAnswered(c, q) || wrote(c, q));
  // The longer answers are the most useful thing a candidate gives us, so they sit in the open, not inside the full list.
  const noted = rows.filter((q) => wrote(c, q)), SHOW = 4;
  const noteLi = (q) => `<li><b>${escGl(q.text)}</b><span class="ans">${ansWord(c, q)}</span><p>“${escGl(wrote(c, q))}”</p></li>`;
  const words = WRITE_IN.filter(([k]) => c.own_words?.[k]);
  // Sent only written answers (Brownie, Oct 3): list the statements still open, so the candidate can see exactly what is left.
  const open = (list) => `<ul class="qa">${list.map((q) => `<li><b>${escGl(q.text)}</b><span class="ans">Not answered yet</span></li>`).join('')}</ul>`;
  const unanswered = rows.length ? '' : `<h2>Statements ${esc(first(c))} hasn’t answered yet</h2>
  <p class="small">${esc(first(c))} sent the written answers above on ${esc(fmtLong(c.direct.date))}, but none of the ${ALL_QUESTIONS.length} agree/disagree statements we put to every candidate. The quiz and compasses use the first ${QUESTIONS.length}, so until some are answered they leave ${esc(first(c))} out.</p>
  <details class="drop" id="questionnaire"><summary>The ${QUESTIONS.length} statements the quiz uses</summary>${open(QUESTIONS)}</details>
  <details class="drop"><summary>${EXTRA_QUESTIONS.length} more optional statements</summary>${open(EXTRA_QUESTIONS)}</details>`;
  return `${words.length ? `<h2 id="own-words">In ${esc(first(c))}’s own words <span class="badge direct">✓ Direct</span></h2>
  <div class="card stack">${words.map(([k, label]) => `<details class="stance-row has-more"${k === 'pitch' || k === 'one_thing' ? ' open' : ''}><summary><span class="txt"><b>${esc(label.replace(/ — we may use.*$/, ''))}</b>${moreBtn(`Click to expand — read ${esc(first(c))}’s full answer`)}</span></summary><blockquote>${escGl(c.own_words[k])}</blockquote></details>`).join('')}</div>` : ''}
  ${noted.length ? `<h2 id="explained">${esc(first(c))} explains ${noted.length === 1 ? 'an answer' : 'their answers'} <span class="badge direct">✓ Direct</span></h2>
  <p class="small">${esc(first(c))} added a comment to ${noted.length} of the statements we put to every candidate. These are ${esc(first(c))}’s words, unedited.</p>
  <div class="card"><ul class="qa">${noted.slice(0, SHOW).map(noteLi).join('')}</ul>
  ${noted.length > SHOW ? `<details class="more"><summary>Show ${noted.length - SHOW} more</summary><ul class="qa">${noted.slice(SHOW).map(noteLi).join('')}</ul></details>` : ''}</div>` : ''}
  ${rows.length ? `<details class="drop" id="questionnaire" open><summary>All ${rows.length} of ${esc(first(c))}’s questionnaire answers <span class="badge direct">✓ Direct</span></summary>
  <ul class="qa">${rows.map((q) => `<li><b>${escGl(q.text)}</b><span class="ans">${ansWord(c, q)}</span>${wrote(c, q) ? `<p>“${escGl(wrote(c, q))}”</p>` : ''}</li>`).join('')}</ul>
  <p class="small">Answered by ${esc(c.name)} on ${esc(fmtLong(c.direct.date))}. Where these differ from our earlier reading of the public record, the candidate’s own answer is what counts in the quiz and compare pages.</p></details>` : unanswered}`;
}
// The candidate's own questionnaire answers on one topic, shown inside that topic's row.
function directOnTopic(c, key) {
  if (!isDirectQ(c)) return '';
  const rows = ALL_QUESTIONS.filter((q) => q.issue === key && (selfAnswered(c, q) || wrote(c, q)));
  if (!rows.length) return '';
  return `<div class="direct-topic"><p class="small"><span class="badge direct">✓ Direct answer</span> ${esc(first(c))} told us:</p><ul class="qa">${rows.map((q) => `<li><b>${escGl(q.text)}</b><span class="ans">${ansWord(c, q)}</span>${wrote(c, q) ? `<p>“${escGl(wrote(c, q))}”</p>` : ''}</li>`).join('')}</ul></div>`;
}
function stanceRow(c, i) {
  const s = c.stances?.[i.key] || {};
  const none = !s.position || /no public position/i.test(s.position);
  const mine = directOnTopic(c, i.key);
  return `<details class="stance-row${none && !mine ? ' none' : ' has-more'}"><summary><span class="ic" aria-hidden="true">${i.icon}</span><span class="txt"><b>${i.title}</b><span class="pos">${none ? (mine ? 'Answered our questionnaire' : 'Hasn’t said') : escGl(s.position)}</span>${mine ? '<span class="badge direct">✓ Own answers inside</span>' : ''}${none && !mine ? '' : moreBtn(`Click to expand — read more about ${esc(first(c))}’s view on this`)}</span></summary>
  ${none ? (mine ? '' : `<p class="muted">We could not find anything ${esc(first(c))} has said publicly about this.</p>`) : `<p>${escGl(s.summary)}${src(s.source_url)}</p>${s.quote ? `<blockquote>“${escGl(s.quote.replace(/^["“]|["”]$/g, ''))}”</blockquote>` : ''}${confLabel[s.confidence] ? `<p class="conf">${confLabel[s.confidence]}</p>` : ''}`}${mine}</details>`;
}
const confLabel = { high: 'Well documented', medium: 'Some evidence', low: 'Limited evidence', none: '' };
function miniSlider(c, key) {
  const A = AXES[key], sc = axisScore(c, key);
  return `<div class="mini-axis"><div class="mini-head"><b>${A.title}</b><span>${sc ? esc(axisWords(key, sc)) : 'No public record yet'}</span></div>
  <div class="mini-track${sc ? '' : ' empty'}" role="img" aria-label="${A.title}: ${esc(axisWords(key, sc))}">${sc ? `<i style="left:${((sc.v + 2) / 4 * 100).toFixed(1)}%"></i>` : ''}</div>
  <div class="ends"><span>◀ ${A.lo}</span><span>${A.hi} ▶</span></div></div>`;
}
for (const c of all) {
  const links = Object.entries(c.links || {}).filter(([, u]) => isUrl(u)).map(([k, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc({ website: 'Campaign website', instagram: 'Instagram', facebook: 'Facebook', other: 'More', linkedin: 'LinkedIn', bluesky: 'Bluesky' }[k] || k)}</a></li>`).join('');
  const peers = c.office === 'mayor' ? mayors : council, idx = peers.indexOf(c);
  const prev = peers[(idx - 1 + peers.length) % peers.length], next = peers[(idx + 1) % peers.length];
  write(`/council/${c.slug}/`, page({
    url: '/council/', title: `${c.name}, ${c.office === 'mayor' ? 'Mayor of Squamish' : 'Squamish councillor'}: votes, promises and positions`,
    desc: `How ${c.name} votes on Squamish council, which campaign promises they have kept, and every answer they gave during the 2026 election, with sources.`,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'Person', name: c.name,
      url: `${ORIGIN}/council/${c.slug}/`,
      description: `${c.office === 'mayor' ? 'Mayor' : 'Councillor'}, District of Squamish, elected October 17, 2026.${c.tagline ? ' ' + c.tagline : ''}`,
      ...(hasPhoto(c) ? { image: `${ORIGIN}/${c.photo}` } : {}),
      jobTitle: c.office === 'mayor' ? 'Mayor, District of Squamish' : 'Councillor, District of Squamish',
      homeLocation: { '@type': 'Place', name: 'Squamish, British Columbia' },
      sameAs: Object.values(c.links || {}).filter(isUrl),
    }, {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Council', item: `${ORIGIN}/council/` },
        { '@type': 'ListItem', position: 3, name: c.name, item: `${ORIGIN}/council/${c.slug}/` },
      ],
    }],
    body: `<p class="crumbs"><a href="/council/" data-back>← The whole council</a></p>
    <div class="profile">
    <aside class="profile-side">
      ${avatar(c, 'lg')}
      <h1>${esc(c.name)}</h1><p class="role">${officeLabel(c)}${c.incumbent && c.office === 'council' ? ' · re-elected 2026' : ' · elected 2026'}</p>
      <p class="growth-line">${growthSentence(c)}</p>
      <p class="lede tagline">${escGl(c.tagline)}</p>
      ${links ? `<h2 class="side-h">${esc(first(c))}’s own pages</h2><ul class="linklist">${links}</ul>` : ''}
      ${hasPhoto(c) ? `<p class="small muted">Photo: ${esc(c.photo_credit || 'candidate’s campaign')}.</p>` : ''}
    </aside>
    <div class="profile-main">
    ${profileRecord(c)}
    <h2 id="campaign" class="campaign-h">What ${esc(first(c))} said during the 2026 campaign</h2>
    ${directNotice(c)}${paperNotice(c)}
    <p class="small ours">${stmtOf(c) ? `Summarised by us from ${esc(first(c))}’s own statement.` : 'Our summary of what ' + esc(first(c)) + ' has said and done in public.'} Tap <b>[source]</b> on any line to check it yourself.</p>
    <div class="grid cols-2">
      ${sideList(c, 'supports', 'Said they support', 'for', 'forlist')}
      ${sideList(c, 'opposes', 'Said they’re against', 'against', 'againstlist')}
    </div>
    <h2 id="issues">Where ${esc(first(c))} said they stand</h2>
    <p class="small">Each topic opens up — press <b>Click to expand</b> for the detail, quotes and sources.</p>
    <div class="card stack">${ISSUES.map((i) => stanceRow(c, i)).join('')}</div>
    <p class="small">Compare everyone on: ${ISSUES.map((i) => `<a href="/issues/${TOPIC_SLUG[i.key]}/">${esc(TOPIC_NAME[i.key])}</a>`).join(' · ')}.</p>
    ${(c.top_priorities || []).length ? `<details class="drop"><summary>${esc(first(c))}’s own priority list</summary><ol class="ol">${c.top_priorities.map((p) => `<li>${escGl(p)}</li>`).join('')}</ol></details>` : ''}
    ${emailedAnswers(c)}
    ${directAnswers(c)}
    <details class="drop"><summary>About ${esc(first(c))}</summary><p>${escGl(c.occupation_background)}</p></details>
    <details class="drop"><summary>Where ${esc(first(c))} leans on money, growth and LNG</summary>${Object.keys(AXES).map((k) => miniSlider(c, k)).join('')}<p class="small">Worked out from ${esc(first(c))}’s public statements and votes — not a label they chose. <a href="/compass/">See everyone side by side</a>.</p></details>
    <details class="drop"><summary>Sources we used (${(c.sources || []).filter((s) => isUrl(s.url)).length})</summary><ul class="small">${(c.sources || []).filter((s) => isUrl(s.url)).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></li>`).join('')}</ul></details>
    ${links ? `<div class="mobile-links"><h2>Hear it from ${esc(first(c))} directly</h2><ul class="linklist">${links}</ul></div>` : ''}
    <p class="small claim">Are you ${esc(c.name)}, or did you spot a mistake? Email <a href="mailto:${SITE.contact}?subject=${encodeURIComponent('Update for ' + c.name)}">${SITE.contact}</a> to update or add to this page. <a href="/about/#corrections">How corrections work</a>.</p>
    <div class="btn-row no-print"><a class="btn secondary" href="/council/${prev.slug}/">← ${esc(prev.name)}</a><a class="btn secondary" href="/council/${next.slug}/">${esc(next.name)} →</a></div>
    </div></div>`,
  }));
}

// ---------- COMPARE ----------
const BINS = [[2, 'a2', 'Strongly agree', '✓✓'], [1, 'a1', 'Somewhat agree', '✓'], [0, 'n0', 'Neutral / mixed', '~'], [-1, 'd1', 'Somewhat disagree', '✕'], [-2, 'd2', 'Strongly disagree', '✕✕']];
const binOf = (val) => BINS.find((b) => b[0] === val);
function spectrum(q) {
  const unknown = all.filter((c) => typeof c.quiz_answers?.[q.id] !== 'number');
  // When almost nobody has spoken, say why rather than showing a wall of grey names.
  const nearlyEmpty = unknown.length >= all.length - 1;
  const said = all.filter((c) => wrote(c, q));
  return `<div class="spectrum"><p class="stmt">“${esc(q.text)}”</p>
  <details class="means" data-q="${q.id}"><summary>What does this mean?</summary>${q.what ? `<p><b>${esc(q.what.term)}:</b> ${esc(q.what.def)}</p>` : ''}<p>${esc(q.why)}</p></details>
  ${nearlyEmpty ? `<p class="asknote">No candidate has addressed this publicly yet. We have put the question to all ${all.length} of them — answers will appear here as they come in.</p>` : ''}
  <div class="bins">
  ${BINS.map(([val, cls, label]) => { const inBin = all.filter((c) => c.quiz_answers?.[q.id] === val); return inBin.length ? `<div class="bin ${cls}"><span class="lab">${label}</span><ul class="namechips">${inBin.map(nameChip).join('')}</ul></div>` : ''; }).join('')}
  ${unknown.length ? `<details class="bin-un"><summary>${unknown.length} ${unknown.length === 1 ? 'candidate hasn’t' : 'candidates haven’t'} said — show names</summary><ul class="namechips">${unknown.map(nameChip).join('')}</ul></details>` : ''}
  </div>${said.length ? `<details class="said" data-q="${q.id}"><summary>${moreBtn(`Click to expand — read what ${said.length === 1 ? esc(said[0].name) : said.length + ' candidates'} wrote about this`)}</summary><ul class="qa">${said.map((c) => `<li><a href="/council/${c.slug}/#explained"><b>${esc(c.name)}</b></a>${c.office === 'mayor' ? ' <span class="small">(for mayor)</span>' : ''} <span class="ans">${ansWord(c, q)}</span><p>“${esc(wrote(c, q))}”</p></li>`).join('')}</ul><p class="small">Comments candidates added when answering our questionnaire, unedited.</p></details>` : ''}</div>`;
}
const issueSection = (i) => {
  const ic = issueCtx(i.key);
  return `<section id="${i.key}" data-panel data-group="cmp" hidden><h2><span aria-hidden="true">${i.icon}</span> ${i.title}</h2>
  ${ic.short_explainer ? `<p>${esc(ic.short_explainer)} <a href="/issues/${TOPIC_SLUG[i.key]}/">More background and every candidate’s answer</a></p>` : ''}
  ${(i.allq ? ALL_QUESTIONS : QUESTIONS).filter((q) => q.issue === i.key).map((q) => spectrum(q) + (q.id === 'q23' ? `<details class="drop ifno-d"><summary>What happens if council says yes — or no?</summary>${DEAL_IF_NO.replace('<h3>The Woodfibre tax deal: what each choice means</h3>', '')}</details>` : '')).join('')}
  <details><summary>Read each candidate’s position on ${i.title.toLowerCase()}</summary>
  <div class="table-scroll"><table class="issue-table"><thead><tr><th>Candidate</th><th>Position</th></tr></thead><tbody>
  ${all.map((c) => { const s = c.stances?.[i.key] || {}; const none = !s.position || /no public position/i.test(s.position); return `<tr><td><a href="/council/${c.slug}/">${esc(c.name)}</a>${c.office === 'mayor' ? '<br><span class="small">for mayor</span>' : ''}</td><td>${none ? '<span class="muted">No public position found.</span>' : `<span class="pos">${esc(s.position)}</span>${esc(s.summary)}${src(s.source_url)}`}</td></tr>`; }).join('')}
  </tbody></table></div></details></section>`;
};
const cell = (val) => { const b = typeof val === 'number' ? binOf(val) : null; return b ? `<span class="cell ${b[1]}" title="${b[2]}"><span aria-hidden="true">${b[3]}</span><span class="sr" style="position:absolute;left:-999em">${b[2]}</span></span>` : '<span class="cell un" title="No public position found">?</span>'; };
// The topic picker and its panels. Used on Compare and again at the end of the Candidates list.
const COMPARE_BLOCK = `<div class="cmp-wrap"><div class="picker no-print" data-picker="cmp" role="tablist" aria-label="Choose a topic">
    <button type="button" class="chip-btn" data-show="growth-chart" role="tab">🏘️ Stop, up or out?</button>
    ${ISSUES.map((i) => `<button type="button" class="chip-btn" data-show="${i.key}" role="tab"><span aria-hidden="true">${i.icon}</span> ${i.title}</button>`).join('')}
    <button type="button" class="chip-btn" data-show="matrix" role="tab">📋 Everything at once</button>
  </div>
  <section id="growth-chart" data-panel data-group="cmp" hidden><h2>Stop building, build up, or build out?</h2>
  <p>The biggest question in Squamish: how should the town grow? We sorted each candidate by their main public position. Many candidates hold nuanced views, so read their profile for detail.</p>
  <div class="notice info"><b>Worth knowing:</b> no candidate is campaigning to stop building altogether. The real differences are about <em>where</em> homes go, <em>how fast</em>, and <em>who pays</em> for the roads, pipes and parks that come with them.</div>
  <div class="growth-cols">${['slow', 'up', 'out', 'mix', 'unknown'].map((k) => { const list = all.filter((c) => growthKey(c) === k); return list.length ? `<div class="growth-col ${k}"><h3>${GROWTH[k].label} <span class="small">(${list.length})</span></h3><p>${GROWTH[k].blurb}</p><ul class="namechips">${list.map(nameChip).join('')}</ul></div>` : ''; }).join('')}</div></section>
  ${ISSUES.map(issueSection).join('')}
<section id="matrix" data-panel data-group="cmp" hidden><h2>Everything at once</h2><p>Every candidate against every quiz statement. Scroll sideways on a phone.</p>
  <div class="legend">${BINS.map((b) => `<span><span class="cell ${b[1]}">${b[3]}</span>${b[2]}</span>`).join('')}<span><span class="cell un">?</span>No public position</span></div>
  <div class="table-scroll"><table class="matrix"><thead><tr><th>Candidate</th>${QUESTIONS.map((q) => `<th>${esc(q.short)}</th>`).join('')}</tr></thead><tbody>
  ${all.map((c) => `<tr><td><a href="/council/${c.slug}/">${esc(c.name)}</a>${c.office === 'mayor' ? ' <span class="small">(mayor)</span>' : ''}</td>${QUESTIONS.map((q) => `<td>${cell(c.quiz_answers?.[q.id])}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>
  <ol class="small" style="margin-top:1rem">${QUESTIONS.map((q) => `<li><b>${esc(q.short)}:</b> “${esc(q.text)}”</li>`).join('')}</ol></section>
  <nav class="panel-nav no-print" data-panel-nav="cmp" aria-label="Move between topics"></nav></div>`;
write('/compare/', page({
  url: '/compare/', title: 'Compare the Squamish candidates on every issue',
  desc: 'See where every Squamish mayor and council candidate stands on housing, growth, taxes, Woodfibre LNG and more, side by side, issue by issue.',
  body: `<h1>Compare the candidates</h1>
  <p class="lede">Pick an issue to see where everyone stands, side by side. Candidates for mayor are marked in yellow.</p>
  ${COMPARE_BLOCK}
  ${miniCompass({ heading: 'The same candidates on one map' })}
  <a class="card" href="/issues/" style="display:block;margin-top:1.5rem"><h3>The issues explained</h3><p>Plain-language background on what this election is actually about.</p></a>`,
}));

// ---------- 2026 RESULTS (results page, and the top of home once the District posts numbers) ----------
const R26 = RES['2026'], RES_LIVE = R26.status !== 'pending' && (R26.mayor || []).length > 0;
const RES_WORD = 'Final';
const num = (x) => Number(x).toLocaleString('en-CA');
const candByName = Object.fromEntries(all.map((c) => [c.name, c]));
// One row per candidate, most votes first: face, name (linked to their profile), votes, bar. pct only for mayor,
// since the District's council and trustee percentages are shares of all votes, which reads oddly.
function resRace(rows, { pct = false, only = null } = {}) {
  const max = rows[0]?.total || 1;
  return `<div class="res-list">${rows.filter((r) => !only || only(r)).map((r) => { const c = candByName[r.name];
    return `<div class="res-row${r.elected ? ' won' : ''}">${c ? avatar(c, 'sm') : `<span class="avatar sm" aria-hidden="true">${esc(initials(r))}</span>`}<span class="res-name">${c ? `<a href="/council/${c.slug}/">${esc(r.name)}</a>` : esc(r.name)}${r.elected ? ' <span class="res-badge">Elected</span>' : ''}</span><span class="res-votes">${num(r.total)}${pct && r.pct != null ? ` <span class="small">${r.pct}%</span>` : ''}</span><span class="res-bar"><span style="width:${(100 * r.total / max).toFixed(1)}%"></span></span></div>`; }).join('')}</div>`;
}
const resLede = () => `<b>${RES_WORD} results</b>${R26.updated ? `, as of ${esc(R26.updated)}` : ''}${/\.$/.test(R26.updated || '') ? '' : '.'} ${num(R26.ballots_cast)} ballots cast, turnout ${R26.turnout_pct}% of ${num(R26.eligible_voters)} eligible voters.${src(R26.source_url, 'District of Squamish')}`;
const resWinner = (k) => (R26[k] || []).filter((r) => r.elected).map((r) => r.name);

// ---------- HOME (written after Compare because it reuses COMPARE_BLOCK) ----------
const v = ctx.voting || {};
{
  const nx = upcoming.slice(0, 3), last = past.find((m) => m.summary);
  const allP = pCounts(PROMISES);
  write('/', page({
    url: '/', title: '',
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'WebSite', name: 'Squamish Voters', alternateName: 'SquamishVoters.com', url: `${ORIGIN}/`, inLanguage: 'en-CA',
      description: 'Independent, plain-language guide to Squamish council: meetings, votes and campaign promises.',
    }, {
      '@context': 'https://schema.org', '@type': 'Organization', name: 'Squamish Voters', url: `${ORIGIN}/`, logo: `${ORIGIN}/icon-512.png`,
      founder: { '@type': 'Person', name: 'Jeff Kirdeikis' }, areaServed: 'Squamish, British Columbia',
      ...(SITE.contact ? { email: SITE.contact } : {}),
    }],
    hero: `<section class="hero"><div class="wrap">
    <h1>Squamish council made promises. We’re keeping score.</h1>
    <p class="lede">Every vote by Squamish’s mayor and councillors, checked against what they told voters in 2026.</p>
    <div class="btn-row hero-two"><a class="btn big" href="/meetings/">See what council is deciding →<small>Next meetings and past decisions</small></a><a class="btn big" href="/promises/">Are they keeping their promises? →<small>Promises, and votes against what they said</small></a></div>
    <a class="fbgroup" href="https://www.facebook.com/groups/1090076830319905" target="_blank" rel="noopener"><img src="/img/facebook-group.jpg" width="400" height="149" alt="Squamish Voters and Politics Facebook group" loading="eager"><span>Join the conversation on Facebook →</span></a>
    <form class="herosign" id="signup" data-subscribe="home-hero" novalidate>
      <label for="hs-email"><b>Get a short email every Friday:</b> what council decided and what’s coming up.</label>
      <div class="hs-row"><input id="hs-email" type="email" name="email" autocomplete="email" required placeholder="Enter your email"><button class="btn" type="submit">Sign up</button></div>
      <p class="hs-note">We’ll email you a link to confirm. Unsubscribe any time.</p>
      <p class="small" data-msg role="status"></p>
    </form>
    <p class="visit-count" data-visits hidden><span class="vc-dot" aria-hidden="true"></span><b>0</b> page views so far</p>
  </div></section>`,
    body: `
  <h2>Your council <span class="small">elected October 17, 2026</span></h2>
  <div class="faces faces-sm">${[...mayors, ...council].map(faceTile).join('')}</div>
  <p><a href="/council/">What each of them stands for, how they vote, and what they promised →</a></p>

  <section class="card foryou-box no-print" id="foryou"><h2>What matters to you</h2>
    <p class="small">Pick your neighbourhood and what you care about. We’ll show those first. It’s saved on this phone only.</p>
    <label class="fld">Where you live<select data-pref="area"><option value="">Choose your neighbourhood</option>${HOODS.map((h) => `<option value="${esc(h.slug)}">${esc(h.name)}</option>`).join('')}</select></label>
    <div class="topicpick" role="group" aria-label="Topics you care about">${ISSUES.map((i) => `<button type="button" class="chip-btn" data-topic="${i.key}" aria-pressed="false"><span aria-hidden="true">${i.icon}</span> ${esc(i.title)}</button>`).join('')}</div>
    <div data-feed></div>
  </section>
  <script>window.SV_FEED=${JSON.stringify([
    ...DECISIONS.filter((d) => d.result !== 'info').slice(0, 60).map((d) => ({ k: 'Decided', date: d.m.date, title: d.title, for_you: d.for_you || '', areas: d.areas || [], topic: d.topic, url: mUrl(d.m) })),
    ...upcoming.flatMap((m) => (m.agenda_items || []).map((a) => ({ k: 'Coming up', date: m.date, title: a.plain, for_you: a.for_you || '', areas: a.areas || [], topic: a.topic, url: mUrl(m) }))),
    ...TRACKED.map((t) => ({ k: 'Issue', date: '', title: t.question, for_you: (stepNow(t) || {}).step?.label || '', areas: t.areas || [], topic: t.topic, url: `/track/${t.slug}/` })),
  ]).replace(/</g, '\u003c')};</script>

  <section class="card prio-box no-print" data-prio-box hidden><h2>What readers say matters most</h2>
    <p class="small" data-prio-count></p>
    <div data-prio="3"></div>
    <p><a href="/priorities/">Every issue, and which way readers lean →</a></p>
  </section>
  <script>window.SV_SIDES=${JSON.stringify(SIDE_LABELS).replace(/</g, '\\u003c')};</script>

  <section class="card nextup"><h2>Coming up</h2>
  ${nx.length ? `<ul class="mlist">${nx.map(meetingRow).join('')}</ul><p><a href="/meetings/">All meetings →</a></p>` : '<p class="muted">No meetings are scheduled yet. Check back soon.</p>'}
  </section>

  ${last ? `<section class="card lastup"><h2>Last time council met</h2>
  <p class="mwhen"><b>${esc(fmtDay(last.date))}</b> ${mBadge(last)}</p>
  <p class="lede">${esc(last.summary.headline)}</p>
  <ul class="keypoints">${(last.summary.key_points || []).map((k) => `<li>${escGl(k)}</li>`).join('')}</ul>
  <a class="btn secondary" href="${mUrl(last)}">Read what they decided →</a></section>` : ''}

  <section class="card"><h2>Promise tracker</h2>
  <p>We wrote down <b>${PROMISES.length} promises</b> and <b>${all.reduce((a, c) => a + positionsOf(c).length, 0)} positions</b> the mayor and councillors took during the campaign. Every council vote is checked against them.</p>
  ${ANY_VOTES ? `<div class="pstats">${Object.entries(PSTATUS).map(([k, P]) => `<span class="pstatus ${P.cls}"><span aria-hidden="true">${P.icon}</span> ${allP[k]} ${esc(P.label.toLowerCase())}</span>`).join('')}</div>` : `<p class="small">Nothing to judge until the first votes${FIRST_VOTES ? ` on ${esc(fmtLong(FIRST_VOTES))}` : ''}.</p>`}
  <div class="btn-row"><a class="btn secondary" href="/promises/">See every promise →</a><a class="btn secondary" href="/said-vs-did/">Do they vote the way they said? →</a></div></section>

  ${TRACKED.length ? `<section class="card"><h2>Issues we’re following</h2><p class="small">The big questions that keep coming back to council. Tap one to see where it stands.</p><ul class="mlist">${TRACKED.slice(0, 5).map(issueRow).join('')}</ul><p><a href="/track/">All ${TRACKED.length} issues →</a></p></section>` : ''}
  ${NEWS.stories.length ? `<section class="card nw-homebox"><h2>Squamish news <span class="small">short updates from the public record</span></h2><ul>${NEWS.stories.slice(0, 3).map((st) => `<li><span class="nw-hk" data-s="${st.s}">${esc(Object.fromEntries(NEWS.sections)[st.s])}</span><a href="/news/${st.slug}/">${esc(st.head)}</a></li>`).join('')}</ul><p><a href="/news/">All news →</a></p></section>` : ''}
  <div class="trust-card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8l7.5 3v5.6c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V5.8z"/><path d="M8.6 12.2l2.4 2.4 4.6-5"/></svg><div>
    <h2>You can check our work</h2>
    <p>No endorsements. Every summary links to the official video, agenda and minutes, and every promise links to where it was said. The code is public.</p>
    <p class="trust-links"><a href="${REPO}" target="_blank" rel="noopener">See the code on GitHub →</a><a href="/about/">How this site works →</a></p>
  </div></div>
  <div class="btn-row"><a class="btn secondary" href="/quiz/">Who on council thinks like you? Take the quiz</a><a class="btn secondary" href="/results/">2026 election results</a></div>`,
  }));
}

// ---------- COUNCIL (list page; written after Compare because it reuses COMPARE_BLOCK) ----------
write('/council/', page({
  url: '/council/', title: 'Squamish mayor and council 2026 to 2030',
  desc: `${mayors[0]?.name} is mayor of Squamish. Councillors: ${council.map((c) => c.name).join(', ')}. What each stands for, how they vote and which promises they keep.`,
  body: `<h1>Your mayor and council</h1>
  <p class="lede">Seven people elected on October 17, 2026, to run Squamish until 2030. Tap anyone to see what they promised, how they vote, and every answer they gave during the campaign.</p>
  <h2 id="mayor">Mayor</h2>
  <ul class="cand-list">${mayors.map(candCard).join('')}</ul>
  <h2 id="council">Councillors</h2>
  <ul class="cand-list" id="council-grid">${council.map(candCard).join('')}</ul>
  <h2 id="compare">Compare them, issue by issue</h2>
  <p>What each of them said during the campaign, side by side. The mayor is marked in yellow.</p>
  ${COMPARE_BLOCK}`,
}));

// ---------- COMPASS ----------
// mini: the small version for home, quiz results and Compare. Bigger type (it is drawn smaller), short axis words,
// and not tappable — the whole chart is a link to the full one. data-map lets site.js add the ★ You dot.
function compassSvg({ mini = false, tap = !mini, map: mk = 'classic' } = {}) {
  const M = CMAPS[mk], placed = placedOn(mk);
  const W = 600, H = 600, P = mini ? 62 : 46, R = 2.15, S = (W - 2 * P) / (2 * R); // scores run -2..+2
  const FS = mini ? 32 : 18, AFS = mini ? 27 : 18, DR = mini ? 13 : 10, cw = FS * 0.6;
  const px = (v) => P + (v + R) * S, py = (v) => P + (R - v) * S;
  const pts = placed.map((c) => { const p = cmapPos(c, mk); return { c, thin: p.thin, x: px(p.x.v), y: py(p.y.v) }; });
  // Where their votes put them: needs votes on statements from both lines of this map.
  // At least 3 votes behind each line, so one vote can't fling someone to a corner.
  const VOTES_NEEDED = 3;
  const vpts = all.map((c) => {
    const vo = votedAnswers(c), nVotes = (qs) => Object.keys(qs).reduce((a, q) => a + (vo[q]?.n || 0), 0);
    if (nVotes(M.x) < VOTES_NEEDED || nVotes(M.y) < VOTES_NEEDED) return null;
    const p = cmapPos({ ...c, quiz_answers: Object.fromEntries(Object.entries(vo).map(([q, o]) => [q, o.v])) }, mk);
    return p ? { c, x: px(p.x.v), y: py(p.y.v) } : null;
  }).filter(Boolean);
  const near = mini ? 30 : 24;
  // nudge a dot off any earlier one, and keep going until it is clear (one nudge can land it on a third dot)
  pts.forEach((p, i) => { for (let k = 0; k < 8; k++) { const o = pts.slice(0, i).find((o) => Math.hypot(p.x - o.x, p.y - o.y) < near); if (!o) break; p.x += near * 0.83; p.y += near * 0.67; } });
  const boxes = [];
  const hit = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  pts.forEach((p) => boxes.push({ x: p.x - DR - 2, y: p.y - DR - 2, w: 2 * DR + 4, h: 2 * DR + 4 }));
  // keep names off the four axis titles
  const tw = (t) => t.replace(/&amp;/g, '&').length * AFS * 0.62;
  const L = mini ? M.Lm : M.L, L0 = [L.up, L.down, L.left, L.right];
  boxes.push({ x: W / 2 - tw(L0[0]) / 2, y: P - 16 - AFS, w: tw(L0[0]), h: AFS + 6 }, { x: W / 2 - tw(L0[1]) / 2, y: H - P + 8, w: tw(L0[1]), h: AFS + 8 },
    { x: P - 18 - AFS, y: H / 2 - tw(L0[2]) / 2, w: AFS + 4, h: tw(L0[2]) }, { x: W - P + 8, y: H / 2 - tw(L0[3]) / 2, w: AFS + 6, h: tw(L0[3]) });
  boxes.forEach((b, i) => { b.wt = i < pts.length ? 10 : 1; }); // covering a dot is far worse than touching a name
  const fixed = boxes.slice();
  const dist = (q, b) => Math.hypot(Math.max(b.x - q.x, 0, q.x - b.x - b.w), Math.max(b.y - q.y, 0, q.y - b.y - b.h));
  // Greedy placement depends on who goes first, so try many orders (seeded, so every build is identical) and keep the tidiest.
  const layout = (order) => {
    boxes.length = 0; boxes.push(...fixed); let total = 0; const res = new Map();
    order.forEach((p) => {
      const name = lastName(p.c), w = name.length * cw + 6, h = FS + 8, g = DR + 4;
      const near = [[g, -h / 2], [-g - w, -h / 2], [-w / 2, -h - g + 4], [-w / 2, g - 2], [g - 2, -h - 2], [g - 2, 2], [-g + 2 - w, -h - 2], [-g + 2 - w, 2]].map((o) => [...o, false]);
      // further out, with a thin line back to the dot (only when nothing close is clear)
      const far = [0, 45, 90, 135, 180, 225, 270, 315, 20, 160, 200, 340].map((deg) => {
        const t = (deg * Math.PI) / 180, r = DR + h * 1.6, cx = p.x + Math.cos(t) * (r + w / 2 * Math.abs(Math.cos(t))), cy = p.y - Math.sin(t) * (r + h / 2 * Math.abs(Math.sin(t)));
        return [cx - w / 2 - p.x, cy - h / 2 - p.y, true];
      });
      const cost = (o) => {
        const b = { x: p.x + o[0], y: p.y + o[1], w, h };
        if (b.x < 4 || b.x + w > W - 4 || b.y < 2 || b.y + h > H - 2) return 1e9;
        let c = boxes.reduce((a, q) => a + q.wt * Math.max(0, Math.min(b.x + b.w, q.x + q.w) - Math.max(b.x, q.x)) * Math.max(0, Math.min(b.y + b.h, q.y + q.h) - Math.max(b.y, q.y)), 0);
        // a name must sit nearer its own dot than any other, or a reader could pin it on the wrong person (a line settles it)
        if (!o[2]) c += pts.filter((q) => q !== p && dist(q, b) + 4 < dist(p, b)).length * 4000;
        return c + (o[2] ? 1500 : 0);
      };
      let best = near[0], bestC = Infinity;
      for (const o of [...near, ...far]) { const v = cost(o); if (v < bestC) { best = o; bestC = v; } if (!v) break; }
      total += bestC;
      const b = { x: p.x + best[0], y: p.y + best[1], w, h, wt: 1 }; boxes.push(b);
      const mid = b.x + w / 2, anchor = best[2] ? 'middle' : mid > p.x + g ? 'start' : mid < p.x - g ? 'end' : 'middle';
      const lx = anchor === 'start' ? b.x : anchor === 'end' ? b.x + w : mid;
      // line from the dot's edge to the nearest point of the name
      let lead = null;
      if (best[2]) { const ex = Math.max(b.x, Math.min(p.x, b.x + w)), ey = Math.max(b.y + 4, Math.min(p.y, b.y + h - 4)), d = Math.hypot(ex - p.x, ey - p.y); lead = [p.x + ((ex - p.x) / d) * (DR + 1), p.y + ((ey - p.y) / d) * (DR + 1), ex, ey]; }
      res.set(p, { lx, ly: b.y + h * 0.7, anchor, lead });
    });
    return { total, res };
  };
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let bestL = layout(pts);
  for (let t = 0; t < 600 && bestL.total > 0; t++) { const o = pts.slice().sort(() => rnd() - 0.5); const L = layout(o); if (L.total < bestL.total) bestL = L; }
  pts.forEach((p) => Object.assign(p, bestL.res.get(p)));
  const col = (c) => (c.office === 'mayor' ? '#eb6834' : '#2a78d6');
  const id = mk + (mini ? 'm' : '') + (tap ? 'c' : 'x');
  const map = esc(JSON.stringify({ W, P, R, fs: FS, x: M.x, y: M.y }));
  return `<svg viewBox="0 0 ${W} ${H}" role="${tap ? 'group' : 'img'}" aria-labelledby="${id}title ${id}desc" data-map="${map}" data-cmap="${mk}">
  <title id="${id}title">${esc(M.title)}</title><desc id="${id}desc">Scatter chart. ${M.desc}${!tap ? ` Placed: ${placed.map((c) => esc(c.name)).join(', ')}.` : ' The same information follows as sliders and a table.'}</desc>
  <rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}" fill="#fcfcfb" stroke="#c3c2b7"/>
  <rect x="${P}" y="${P}" width="${(W - 2 * P) / 2}" height="${(H - 2 * P) / 2}" fill="#f4f1e8"/><rect x="${W / 2}" y="${H / 2}" width="${(W - 2 * P) / 2}" height="${(H - 2 * P) / 2}" fill="#f4f1e8"/>
  ${[-1, 1].map((t) => `<line x1="${px(t)}" y1="${P}" x2="${px(t)}" y2="${H - P}" stroke="#e1e0d9"/><line x1="${P}" y1="${py(t)}" x2="${W - P}" y2="${py(t)}" stroke="#e1e0d9"/>`).join('')}
  <line x1="${W / 2}" y1="${P}" x2="${W / 2}" y2="${H - P}" stroke="#898781" stroke-width="1.5"/><line x1="${P}" y1="${H / 2}" x2="${W - P}" y2="${H / 2}" stroke="#898781" stroke-width="1.5"/>
  <text x="${W / 2}" y="${P - 16}" text-anchor="middle" font-size="${AFS}" font-weight="700" fill="#14211c">${L.up}</text>
  <text x="${W / 2}" y="${H - P + AFS + 12}" text-anchor="middle" font-size="${AFS}" font-weight="700" fill="#14211c">${L.down}</text>
  <!-- side titles are rotated -90°, so ▲/▼ glyphs render as ◀/▶ -->
  <text transform="translate(${P - 16} ${H / 2}) rotate(-90)" text-anchor="middle" font-size="${AFS}" font-weight="700" fill="#14211c">${L.left.replace('◀', '▲')}</text>
  <text transform="translate(${W - P + AFS + 12} ${H / 2}) rotate(-90)" text-anchor="middle" font-size="${AFS}" font-weight="700" fill="#14211c">${L.right.replace('▶', '▼')}</text>
  ${vpts.map((v) => { const o = pts.find((p) => p.c === v.c); return `${o ? `<line x1="${o.x}" y1="${o.y}" x2="${v.x}" y2="${v.y}" stroke="${col(v.c)}" stroke-width="2" stroke-dasharray="5 4"/>` : ''}<rect x="${v.x - DR}" y="${v.y - DR}" width="${DR * 2}" height="${DR * 2}" transform="rotate(45 ${v.x} ${v.y})" fill="#fcfcfb" stroke="${col(v.c)}" stroke-width="3"><title>${esc(v.c.name)}: where their votes put them</title></rect>`; }).join('')}
  ${pts.map((p) => `<g class="cdot"${!tap ? '' : ` tabindex="0" role="button" aria-label="${esc(p.c.name)}"`} data-slug="${p.c.slug}">
    ${!tap ? '' : `<circle cx="${p.x}" cy="${p.y}" r="${DR + 12}" fill="transparent" stroke="none"/>`}
    ${p.lead ? `<line x1="${p.lead[0].toFixed(1)}" y1="${p.lead[1].toFixed(1)}" x2="${p.lead[2].toFixed(1)}" y2="${p.lead[3].toFixed(1)}" stroke="#14211c" stroke-width="${mini ? 2 : 1.5}"/>` : ''}
    <circle cx="${p.x}" cy="${p.y}" r="${DR}" fill="${p.thin ? '#fcfcfb' : col(p.c)}" stroke="${p.thin ? col(p.c) : '#fcfcfb'}" stroke-width="${p.thin ? DR * 0.35 : 2}"/>
    <text x="${p.lx}" y="${p.ly}" text-anchor="${p.anchor}" font-size="${FS}" font-weight="600" fill="#14211c" paint-order="stroke" stroke="#fcfcfb" stroke-width="${FS / 4.5}">${esc(lastName(p.c))}</text></g>`).join('')}
  </svg>`;
}
// The small compass as a card. `you` adds the ★ You prompt (quiz CTA before the quiz, a note after it).
function compassLegend(mini, mk = 'classic') { return `<div class="legend${mini ? ' mini' : ''}"><span><svg width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="#eb6834"/></svg>Mayor</span><span><svg width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="#2a78d6"/></svg>Council</span><span><svg width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="7.5" fill="#fff" stroke="#2a78d6" stroke-width="3.5"/></svg>${mini ? 'Hollow = thin evidence' : 'Hollow = only one statement on one of the two lines'}</span></div>`; }
function miniCaveat(mk = 'classic') {
  const n = placedOn(mk).length;
  if (mk === 'classic') return `Only ${n} of ${all.length} candidates have said where they stand on enforcement — council has never voted on encampments, policing or public drug use.`;
  if (mk === 'cars') return `Only ${n} of ${all.length} candidates have enough on the record to place. Most of the parking and bike-lane statements aren’t in the quiz, so ★ You rests on fewer of your answers here.`;
  return `Only ${n} of ${all.length} candidates have enough on the record to place.`;
}
// ‹ 1 of 3 › header shared by the compass carousels (site.js [data-carousel] does the stepping).
function carHead(label, what) { return  `<div class="lt-head"><span class="lt-kicker">${label} <span class="lt-count" data-car-count></span></span><span class="lt-arrows no-print"><button type="button" class="picker-step" data-car-prev aria-label="Previous ${what}">‹</button><button type="button" class="picker-step" data-car-next aria-label="Next ${what}">›</button></span></div>`; }
function miniCompass({ heading = 'The Squamish compass', you = true, maps = Object.keys(CMAPS) } = {}) {
  const slide = (mk, n) => `<div${maps.length > 1 ? ` data-slide${n ? ' hidden' : ''}` : ''}>
  ${maps.length > 1 ? `<p class="mc-t">${esc(CMAPS[mk].title)}</p>` : ''}<p class="mc-q">${esc(CMAPS[mk].ask)}</p>
  ${compassLegend(true, mk)}
  <a class="mc-chart" href="/compass/${mk === 'classic' ? '' : '?map=' + mk}#map" aria-label="Open the full compass">${compassSvg({ mini: true, map: mk })}</a>
  <p class="small mc-note">${miniCaveat(mk)} <a href="/compass/#how">How it’s worked out</a>.</p></div>`;
  return `<section class="mini-compass"${maps.length > 1 ? ` data-carousel data-track="Compass step" aria-roledescription="carousel" aria-label="${esc(heading)}"` : ''}>
  ${maps.length > 1 ? carHead(`🧭 ${heading}`, 'compass') : `<span class="lt-kicker">🧭 ${heading}</span>`}
  ${maps.map(slide).join('')}
  ${maps.length > 1 ? `<p class="small lt-hint no-print">Use the arrows to see ${maps.length - 1} more ways of mapping the same candidates.</p>` : ''}
  ${you ? `<p class="mc-you" data-you="none"><a class="btn secondary" href="/quiz/">★ Take the quiz to see where you land</a></p><p class="small mc-you" data-you="has" hidden><b>★ You</b> is where your quiz answers put you. It’s worked out on your device and never sent anywhere.</p>` : ''}
  <a class="lt-go" href="/compass/">Open the full compass →</a>
</section>`;
}
// One ranked list per theme: a row per candidate, grouped under plain-word headings, each with a dot on a short line.
// Scrolls naturally on a phone and never stacks faces on top of each other.
const BANDS = (A, need) => [
  // "Clearly" needs at least 3 statements behind it; a single strong answer only counts as a lean.
  { test: (v, n) => v <= -1.2 && n >= need, label: `Clearly: ${lc(A.lo)}` },
  { test: (v) => v < -0.34, label: `Leans: ${lc(A.lo)}` },
  { test: (v) => v < 0.34, label: 'In the middle' },
  { test: (v, n) => v < 1.2 || n < need, label: `Leans: ${lc(A.hi)}` },
  { test: () => true, label: `Clearly: ${lc(A.hi)}` },
];
function trackPct(v) { return (4 + ((v + 2) / 4) * 92).toFixed(1); }
function leanList(key) {
  const A = AXES[key];
  const items = all.map((c) => ({ c, s: axisScore(c, key) })).filter((i) => i.s).sort((a, b) => a.s.v - b.s.v || lastName(a.c).localeCompare(lastName(b.c)));
  const missing = all.filter((c) => !axisScore(c, key));
  const single = Object.keys(A.q).length === 1;
  const bands = BANDS(A, axisFull(key)).map((b) => ({ ...b, rows: [] }));
  items.forEach((i) => bands.find((b) => b.test(i.s.v, i.s.n)).rows.push(i));
  const row = (i) => `<li class="srow${i.s.n === 1 && !single ? ' thin' : ''}" data-slug="${i.c.slug}" data-v="${i.s.v.toFixed(3)}"><a href="/council/${i.c.slug}/">${avatar(i.c, 'sm')}<span class="sname"><b>${esc(i.c.name)}</b><span>${i.c.office === 'mayor' ? 'Mayor' : 'Council'}${single ? '' : ` · ${i.s.n} statement${i.s.n > 1 ? 's' : ''}`}</span></span><span class="strack" aria-hidden="true"><i style="left:${trackPct(i.s.v)}%"></i></span></a></li>`;
  const used = Object.entries(A.q).map(([q, sign]) => { const Q = ALL_QUESTIONS.find((x) => x.id === q); return `“${Q.text}” <span class="muted">(agreeing moves a candidate toward “${lc(sign > 0 ? A.hi : A.lo)}”)</span>`; });
  return `<section class="spec" id="axis-${key}" data-axis="${key}">
  <h2><span aria-hidden="true">${A.icon}</span> ${A.title}</h2>
  <p class="ask">${esc(A.ask)}</p>
  ${key === 'street' ? `<p class="small">Policing, bylaw officers and drug-use bylaws are left off this line — they’re a separate question. Some candidates have only answered one or two of these three statements, so check the number of statements.</p>` : ''}
  ${key === 'deal' ? `<p class="small">This is about <b>money, not the environment</b>. People on both sides of the plant itself disagree about whether this is a good deal for taxpayers. <a href="/issues/#environment_lng">What’s in the deal</a>.</p><details class="drop ifno-d"><summary>What happens if council says yes — or no?</summary>${DEAL_IF_NO.replace('<h3>The Woodfibre tax deal: what each choice means</h3>', '')}</details>` : ''}
  ${single ? '' : `<p class="small legend-line"><span class="lg-dot"></span> based on 2 or more statements &nbsp; <span class="lg-dot hollow"></span> only 1 statement — treat with care</p>`}
  <div class="spec-ends" aria-hidden="true"><span>◀ ${A.lo}</span><span>${A.hi} ▶</span></div>
  ${bands.filter((b) => b.rows.length).map((b) => `<h3 class="band">${esc(b.label)} <span>(${b.rows.length})</span></h3><ul class="slist">${b.rows.map(row).join('')}</ul>`).join('')}
  ${missing.length ? `<p class="small nopos"><b>Haven’t said yet:</b> ${missing.map((c) => `<a href="/council/${c.slug}/">${esc(c.name)}</a>`).join(', ')}.</p>` : ''}
  <details><summary>How this is worked out</summary><ul class="small">${used.map((u) => `<li>${u}</li>`).join('')}</ul><p class="small">Each candidate’s dot is the average of their sourced scores on these statements. A dashed ring means it rests on a single statement.</p></details></section>`;
}
// Small preview for the home page: every placed face on one line.
function spectrumTeaser(key) {
  const A = AXES[key];
  const items = all.map((c) => ({ c, s: axisScore(c, key) })).filter((i) => i.s).sort((a, b) => a.s.v - b.s.v);
  // Faces at nearly the same spot fan out into rows above and below the line instead of hiding each other.
  const lanes = [], OFF = [0, -1, 1, -2, 2];
  items.forEach((i) => { i.p = +trackPct(i.s.v); let l = 0; while (l < OFF.length - 1 && lanes[l] !== undefined && i.p - lanes[l] < 7) l++; lanes[l] = i.p; i.o = OFF[l]; });
  return `<div class="teaser-line"><div class="teaser-track">${items.map((i) => `<span style="left:${i.p}%;margin-top:${i.o * 1.8}rem" data-name="${esc(i.c.name)}${i.c.office === 'mayor' ? ' (mayor)' : ''}">${avatar(i.c, 'xs')}</span>`).join('')}</div><div class="spec-ends"><span>◀ ${A.lo}</span><span>${A.hi} ▶</span></div></div>`;
}
const cmapWords = (c, mk) => { const M = CMAPS[mk], p = cmapPos(c, mk); if (!p) return []; const w = (v, lo, hi) => (Math.abs(v) < 0.34 ? 'in the middle' : `${Math.abs(v) >= 1.2 ? 'clearly' : 'leans'} ${v < 0 ? lo : hi}`);
  return [`${M.xt}: ${w(p.x.v, ...M.xw)} (${p.x.n} statement${p.x.n > 1 ? 's' : ''})`, `${M.yt}: ${w(p.y.v, ...M.yw)} (${p.y.n} statement${p.y.n > 1 ? 's' : ''})`]; };
const compassDetailAxes = (c) => Object.keys(AXES).map((k) => { const s = axisScore(c, k); return `${AXES[k].title}: ${axisWords(k, s)}${s ? ` (${s.n} statement${s.n > 1 ? 's' : ''})` : ''}`; });
write('/compass/', page({
  url: '/compass/', title: 'Where they lean',
  desc: 'Where Squamish mayor and council candidates sit on taxes and spending, growth, and Woodfibre LNG and climate — worked out from their public statements and votes.',
  body: `<h1>Where they lean</h1>
  <p class="lede">Everyone on a map first — swipe for ${Object.keys(CMAPS).length} different maps — then the five big questions, one at a time. Placed from their 2026 campaign answers.</p>
  <nav class="chapters no-print" aria-label="Jump to a topic"><a href="#map" data-ch="map"><span aria-hidden="true">🧭</span> Compass</a>${Object.entries(AXES).map(([k, A]) => `<a href="#axis-${k}" data-ch="axis-${k}"><span aria-hidden="true">${A.icon}</span> ${A.short || A.title}</a>`).join('')}</nav>
  <div class="lean-tools no-print">
    <label for="follow"><b>Follow one council member:</b></label>
    <select id="follow"><option value="">— Show everyone —</option>${all.map((c) => `<option value="${c.slug}">${esc(c.name)}${c.office === 'mayor' ? ' (mayor)' : ''}</option>`).join('')}</select>
  </div>
  <section class="spec" id="map">
  <div class="cmap-car" data-carousel data-track="Compass step" aria-roledescription="carousel" aria-label="${Object.keys(CMAPS).length} compasses">
  ${carHead('🧭 Compass', 'compass')}
  ${Object.keys(CMAPS).map((mk, n) => { const M = CMAPS[mk], un = all.filter((c) => !cmapPos(c, mk)); return `<div data-slide data-cmap-slide="${mk}"${n ? ' hidden' : ''}>
  <h2>${esc(M.title)}</h2>
  <p class="ask">${esc(M.ask)}</p>
  ${compassLegend(false, mk)}
  <div class="compass-box"><div class="cb-wide">${compassSvg({ map: mk })}</div><div class="cb-narrow">${compassSvg({ mini: true, tap: true, map: mk })}</div></div>
  ${mk === 'classic' ? '' : `<p class="small">${M.explain} Tap a dot for details.</p>
  <p class="small">${esc(miniCaveat(mk))}</p>`}
  ${un.length ? `<p class="small nopos"><b>Not on this map</b> (too little on the record to place fairly): ${un.map((c) => `<a href="/council/${c.slug}/">${esc(c.name)}</a>`).join(', ')}.</p>` : ''}
  </div>`; }).join('')}
  <p class="small lt-hint no-print">Use the arrows (or swipe) to see the same candidates mapped ${Object.keys(CMAPS).length} different ways.</p>
  </div>
  <p class="small"><b>Diamonds</b> (once council has voted at least 3 times on each line): where a member’s <b>votes</b> put them, joined by a dotted line to where their campaign answers put them. <a href="/said-vs-did/">Said vs did, statement by statement</a>.</p>
  <div class="card compass-detail" id="cdetail" aria-live="polite" style="margin-top:1rem"><p class="muted" style="margin:0">Tap any dot above to see the details here.</p></div>
  <div data-cmap-note="classic">
  <p class="small"><b>Left–right</b> is support: more shelter and supportive-housing spaces, and mental-health crisis teams (left), or fewer homeless shelters (right). <b>Up–down</b> is the camps: clear tent encampments and move Under One Roof out of downtown (down), or let the camps stay (up). These aren’t opposites — someone can want more shelter <em>and</em> the camps cleared (bottom-left). Tap a dot for details.</p>
  <p class="small"><b>Read this before judging anyone by it:</b> council has voted on supportive housing but has never voted on encampments, police numbers or public drug use, so only candidates who answered our questionnaire can be placed. Everyone else is listed under the chart as not placed. <a href="/issues/#homelessness">What council has and hasn’t decided</a>.</p>
  </div>
  </section>

  <h2 class="lean-more">Now topic by topic</h2>
  <p>The compass squeezes everything into two lines. Here is where everyone sits on each of the five questions on its own.</p>
  ${Object.keys(AXES).map(leanList).join('<!--YOU-->').replace('<!--YOU-->', `<div class="card you-cta no-print" id="you-cta"><b>Where do <em>you</em> fit?</b> Take the <a href="/quiz/">3-minute quiz</a> and a ★ You marker appears on the compass and on every list.</div>`)}


  <details class="drop"><summary>Everything above as a plain table</summary>
  <div class="table-scroll"><table class="issue-table"><thead><tr><th>Candidate</th>${Object.values(AXES).map((A) => `<th>${A.title}</th>`).join('')}</tr></thead><tbody>
  ${all.map((c) => `<tr><td><a href="/council/${c.slug}/">${esc(c.name)}</a>${c.office === 'mayor' ? '<br><span class="small">for mayor</span>' : ''}</td>${Object.keys(AXES).map((k) => { const s = axisScore(c, k); return `<td data-label="${AXES[k].title}">${s ? esc(axisWords(k, s)) : '<span class="muted">no public record</span>'}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div></details>
  <details class="drop" id="how"><summary>How the compasses are worked out</summary><p>Nobody here runs for a party, so nobody chose these labels. Each dot is <b>calculated</b> from the same sourced answers used in the quiz. <b>Homelessness:</b> left–right averages the support statements (more shelter and supportive housing, even near homes; mental-health crisis teams alongside the RCMP). Up–down averages two statements (clear encampments even when there is nowhere else to go; move Under One Roof out of downtown), with agreeing pushing the dot down.</p><p><b>How should we grow — and pay for it?</b> Left–right is the same growth line as the Growth list below (slow the pace of approvals; taller buildings downtown; cut red tape for builders). Up–down averages the statements about taxes, borrowing and public spending (housing, shelters, transit, recreation, bike lanes, childcare).</p><p><b>Cars or bikes?</b> Left–right is the growth line. Up–down averages the parking and transport statements: more public parking downtown, parking required in new buildings and free parking for residents (up), against paid parking being fair, and spending local money on bike lanes, sidewalks and regional transit (down).</p><p>A dot is hollow when either line rests on a single statement.</p></details>
  <details class="drop" hidden><summary>Why not “left vs. right”?</summary><p>Those labels come from national politics. Town councils don’t vote on civil liberties, candidates here don’t run for parties, and almost none of them have said anything about policing. Rather than guess, every position on this page is <b>calculated from the candidate’s sourced answers</b> to the same statements used in <a href="/quiz/">the quiz</a>. Anyone who hasn’t spoken publicly on a topic is left off that list, not parked in the middle.</p></details>`,
  scripts: `<script>var CD=${JSON.stringify(Object.fromEntries(Object.keys(CMAPS).map((mk) => [mk, Object.fromEntries(placedOn(mk).map((c) => [c.slug, { n: c.name, d: cmapWords(c, mk) }]))])))};
var AX=${JSON.stringify(Object.fromEntries(Object.entries(AXES).map(([k, A]) => [k, A.q])))};
</script><script src="/lean.js"></script>`,
}));

// ---------- ISSUES ----------
write('/issues/', page({
  url: '/issues/', title: 'Squamish election issues, explained',
  desc: 'The big questions in the 2026 Squamish election — housing, growth, taxes, Woodfibre LNG, homelessness, policing, parking — explained in plain language with sources.',
  body: `<h1>The issues, explained</h1>
  <p class="lede">A plain-language primer on what this election is about. Tap any topic to open it.</p>
  ${(ctx.issues || []).map((i) => { const paras = i.explainer.split(/(?<=[.!?])\s+/); const mid = Math.ceil(paras.length / 2); return `<details class="issue-card" id="${i.key}"><summary><span><b>${esc(i.title)}</b><span class="teaser">${esc(i.teaser)}</span></span></summary>
    <p>${esc(paras.slice(0, mid).join(' '))}</p><p>${esc(paras.slice(mid).join(' '))}</p>
    ${i.key === 'environment_lng' || i.key === 'taxes_spending' ? DEAL_IF_NO : ''}
    ${(i.key_facts || []).length ? `<h3>Key facts</h3><ul class="facts">${i.key_facts.map((f) => `<li>${esc(f.fact)}${src(f.source_url)}</li>`).join('')}</ul>` : ''}
    <div class="btn-row"><a class="btn secondary" href="/issues/${TOPIC_SLUG[i.key]}/">See where every candidate stands →</a></div></details>`; }).join('')}`,
  scripts: `<script>function openHash(){var el=location.hash&&document.getElementById(location.hash.slice(1));if(el&&el.tagName==='DETAILS'){el.open=true;el.scrollIntoView()}}window.addEventListener('hashchange',openHash);openHash()</script>`,
}));

// ---------- QUIZ ----------
const clientData = {
  questions: QUESTIONS.map((q) => ({ id: q.id, text: q.text, short: q.short, why: q.why, topic: q.topic, what: q.what || null })),
  candidates: all.map((c) => ({ slug: c.slug, name: c.name, office: c.office, incumbent: !!c.incumbent, initials: initials(c), photo: hasPhoto(c) ? '/' + c.photo : null, answers: c.quiz_answers || {}, direct: isDirectQ(c),
    // The candidate's own comments on quiz statements, shown word for word under their answers in the results.
    notes: Object.fromEntries(QUESTIONS.filter((q) => wrote(c, q)).map((q) => [q.id, wrote(c, q)])) })),
  // For the "before you see your matches" notice: how thin the record still is.
  stats: { total: all.length, answered: all.filter(isDirectQ).length, unmatched: all.filter((c) => QUESTIONS.filter((q) => typeof c.quiz_answers?.[q.id] === 'number').length < 4).length },
};
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'data.js'), 'window.SV_DATA=' + JSON.stringify(clientData) + ';');
write('/quiz/', page({
  url: '/quiz/', title: 'Squamish election quiz: who should I vote for?',
  desc: `Answer ${QUESTIONS.length} plain-language questions and see which Squamish mayor and council candidates match your views.`,
  body: `<div class="quiz-shell"><div id="quiz-intro"><h1>Who should I vote for?</h1>
  <p class="lede">${QUESTIONS.length} statements. Tell us if you agree or disagree. It takes about three minutes, and your answers never leave your device.</p></div>
  <div id="quiz" class="card"><noscript>The quiz needs JavaScript turned on. You can still <a href="/compare/">compare candidates issue by issue</a>.</noscript></div>
  <p class="small" style="margin-top:1rem">How matching works: we compare your answers to each candidate’s public positions and votes. Questions you mark as important count double. Where a candidate has no public position, that question is left out for them. <a href="/about/#quiz">Full method</a>.</p></div>
  <template id="tpl-compass">${miniCompass({ heading: 'Where you land', you: false, maps: ['classic'] })}</template>`,
  scripts: '<script src="/data.js"></script><script src="/quiz.js"></script>',
}));

// ---------- MEETINGS ----------
const MEET_HOW = `<details class="drop"><summary>How to watch or speak at a meeting</summary>
  <p><b>Go in person:</b> meetings are open to anyone at Council Chambers, Municipal Hall, 37955 Second Avenue. You don’t need to sign up to watch. Council meetings are usually the 1st and 3rd Tuesday of the month at 6 p.m.; Committee of the Whole is usually the 2nd and 4th Tuesday, often in the morning.</p>
  <p><b>Watch from home:</b> meetings are streamed live on the <a href="https://www.youtube.com/@DistrictofSquamish/streams" target="_blank" rel="noopener">District’s YouTube channel</a> and stay there afterward. Each meeting below links to its own video.</p>
  <p><b>Have your say:</b> you can write to council before a meeting, or speak at a public hearing. The District explains how on its <a href="https://squamish.ca/government-and-administration/council/" target="_blank" rel="noopener">council page</a>.</p></details>`;
const typeLegend = () => `<div class="mlegend">${['regular', 'cow', 'hearing', 'special'].map((k) => `<span><span class="mtype ${MTYPE[k].cls}">${esc(MTYPE[k].label)}</span> ${esc(MTYPE[k].plain)}</span>`).join('')}</div>`;
write('/meetings/', page({
  url: '/meetings/', title: 'Squamish council meetings: what’s next and what they decided',
  desc: 'Every upcoming Squamish council meeting, Committee of the Whole and public hearing, and a plain-language summary of every past one: what was decided and who voted yes or no.',
  jsonld: crumbLd([['Home', '/'], ['Meetings', '/meetings/']]),
  body: `<h1>Council meetings</h1>
  <p class="lede">What’s coming up, and what council decided. Tap any meeting for more.</p>
  <h2 id="next">Coming up <span class="small">${upcoming.length}</span></h2>
  ${upcoming.length ? `<ul class="mlist">${upcoming.map(meetingRow).join('')}</ul>` : '<p class="muted">No upcoming meetings are posted yet.</p>'}
  <details class="drop"><summary>What do the colours mean?</summary>${typeLegend()}</details>
  ${MEET_HOW}
  <h2 id="past">Already happened <span class="small">${past.length}</span></h2>
  ${past.length ? `<ul class="mlist">${past.map(meetingRow).join('')}</ul>` : '<p class="muted">The new council hasn’t met yet. After each meeting, a summary appears here within a day or two.</p>'}
  <p class="small">Meeting dates come from the District of Squamish’s official calendar and can change. Summaries are written automatically from the official video, agenda and minutes, and every one links back to them. <a href="/about/#meetings">How our summaries are made</a>.</p>`,
}));
for (const m of MEETINGS) {
  const T = mType(m), done = !!m.summary, S = m.summary || {};
  const votes = (m.decisions || []).filter((d) => d.votes);
  const links = [[m.video_url, '▶ Watch the full meeting video'], [m.agenda_url, 'Official agenda'], [m.minutes_url, 'Official minutes'], [m.transcript ? `/transcripts/${m.id}.txt` : null, 'Full written transcript']].filter(([u]) => u);
  write(mUrl(m), page({
    url: '/meetings/', image: done ? shareImg(m) : null, title: `${T.label}, ${fmtLong(m.date)}${done ? ': what Squamish council decided' : ''}`,
    desc: done ? `${S.headline} ${votes.length} vote${votes.length === 1 ? '' : 's'}, in plain words, with how each member voted.` : `Squamish ${T.label.toLowerCase()} on ${fmtDay(m.date)}${m.time ? ' at ' + fmtTime(m.time) : ''}: what’s on the agenda and how to watch.`,
    jsonld: [crumbLd([['Home', '/'], ['Meetings', '/meetings/'], [`${T.label}, ${fmtLong(m.date)}`, mUrl(m)]]), { '@context': 'https://schema.org', '@type': 'Event', name: `Squamish ${T.label}`, startDate: `${m.date}${m.time ? 'T' + m.time + ':00-' + (m.date >= '2026-11-01' && m.date < '2027-03-14' ? '08' : '07') + ':00' : ''}`, eventStatus: m.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/MixedEventAttendanceMode', location: { '@type': 'Place', name: m.place || 'Squamish Municipal Hall', address: '37955 Second Avenue, Squamish, BC' }, organizer: { '@type': 'GovernmentOrganization', name: 'District of Squamish', url: 'https://squamish.ca/' } }],
    body: `<p class="crumbs"><a href="/meetings/">← All meetings</a></p>
    <p class="mwhen">${mBadge(m)}</p>
    <h1>${esc(fmtDay(m.date))}</h1>
    <p class="small">${m.time ? esc(fmtTime(m.time)) + ' · ' : ''}${esc(m.place || 'Council Chambers, Municipal Hall, 37955 Second Avenue')}${m.status === 'cancelled' ? ' · <b>Cancelled</b>' : ''}</p>
    ${done ? `
    <section class="card layer1"><h2>What happened, in short</h2>
      <p class="lede">${escGl(S.headline)}</p>
      <ul class="keypoints">${(S.key_points || []).map((k) => `<li>${escGl(k)}</li>`).join('')}</ul>
      ${shareBar(m)}</section>
    ${votes.length ? `<h2 id="votes">The votes <span class="small">${votes.length}</span></h2><p class="small">Tap any vote to see what it means and who voted which way.</p>
    <div class="stack">${votes.slice(0, 6).map((d) => decisionCard(d, m)).join('')}</div>
    ${votes.length > 6 ? `<details class="drop"><summary>Show ${votes.length - 6} more votes, mostly routine</summary><div class="stack">${votes.slice(6).map((d) => decisionCard(d, m)).join('')}</div></details>` : ''}` : '<p class="muted">Council didn’t take any recorded votes at this meeting.</p>'}
    ${(m.decisions || []).filter((d) => !d.votes).length ? `<details class="drop"><summary>Also discussed, with no vote (${m.decisions.filter((d) => !d.votes).length})</summary><div class="stack">${m.decisions.filter((d) => !d.votes).map((d) => decisionCard(d, m)).join('')}</div></details>` : ''}
    ${(S.explainer || []).length ? `<details class="drop layer2"><summary>Explain this meeting a bit more</summary>${S.explainer.map((x) => `<p>${escGl(x)}</p>`).join('')}</details>` : ''}
    ${(m.promise_updates || []).length ? `<h2>Promises this meeting tested</h2><div class="card stack">${m.promise_updates.map((u) => { const pr = PROMISES.find((x) => x.id === u.id); return pr ? promiseRow(pr, { who: true }) : ''; }).join('')}</div>` : ''}
    ` : `
    <section class="card layer1"><h2>What’s on the agenda</h2>
      ${m.preview ? `<p class="lede">${escGl(m.preview)}</p>` : `<p>${esc(T.plain)}</p>`}
      ${(m.agenda_items || []).length ? `<ul class="keypoints">${m.agenda_items.map((a) => `<li>${escGl(a.plain || a.title)}${a.for_you ? `<br><span class="small"><b>For you:</b> ${escGl(a.for_you)}</span>` : ''}${areaTags(a.areas)}</li>`).join('')}</ul>` : `<p class="small muted">The District usually posts the agenda a few days before the meeting. We’ll list the main items here in plain words as soon as it’s out.</p>`}
    </section>
    ${m.status === 'cancelled' ? '' : haveSay(m)}
    ${MEET_HOW}`}
    ${links.length ? `<details class="drop layer3"${done ? '' : ' open'}><summary>Full details: video, agenda${done ? ', minutes and transcript' : ''}</summary><ul class="linklist">${links.map(([u, l]) => `<li><a href="${esc(u)}"${u.startsWith('/') ? '' : ' target="_blank" rel="noopener"'}>${l}</a></li>`).join('')}</ul>
    ${done && m.generated ? `<p class="small muted">Summary written automatically on ${esc(fmtLong(m.generated.at.slice(0, 10)))} from the ${esc(m.generated.from || 'meeting video and official documents')}. If anything here is wrong, the official minutes are the record. <a href="mailto:${esc(SITE.contact)}?subject=${encodeURIComponent('Meeting summary ' + m.id)}">Tell us</a>.</p>` : ''}</details>` : ''}
    <div class="btn-row no-print"><a class="btn secondary" href="/meetings/">← All meetings</a><a class="btn secondary" href="/promises/">Promise tracker</a></div>
    ${signupBox('meeting')}`,
  }));
}

// ---------- ISSUES WE'RE FOLLOWING (/track/) ----------
if (TRACKED.length) {
  write('/track/', page({
    url: '/track/', title: 'What’s happening with Squamish’s big issues',
    desc: `Where Squamish council is on ${TRACKED.slice(0, 4).map((t) => t.title).join(', ')} and more: each issue step by step, with every vote, in plain words.`,
    jsonld: crumbLd([['Home', '/'], ['Issues we’re following', '/track/']]),
    body: `<h1>Issues we’re following</h1>
    <p class="lede">The big questions that come back to council meeting after meeting. Each one shows where it stands, what happens next, and how every member has voted on it.</p>
    <ul class="mlist">${TRACKED.map(issueRow).join('')}</ul>${signupBox('track')}`,
  }));
  for (const t of TRACKED) {
    const ds = issueDecisions(t), qs = (t.related_q || []).map((id) => ALL_QUESTIONS.find((q) => q.id === id)).filter(Boolean);
    const now = stepNow(t);
    write(`/track/${t.slug}/`, page({
      url: '/track/', title: `${t.question.replace(/\?$/, '')}? Squamish council, step by step`,
      desc: `${t.summary.split('. ')[0]}. Where it stands now, what council decides next, and how each member has voted.`,
      jsonld: crumbLd([['Home', '/'], ['Issues we’re following', '/track/'], [t.title, `/track/${t.slug}/`]]),
      body: `<p class="crumbs"><a href="/track/">← All issues</a></p>
      <h1>${esc(t.question)}</h1>
      <p class="lede">${escGl(t.summary)}</p>
      ${areaTags(t.areas)}
      <section class="card"><h2>Where it stands${now ? ` <span class="small">step ${now.i + 1} of ${now.n}</span>` : ''}</h2>
        <ol class="isteps">${(t.steps || []).map((x) => `<li class="st-${esc(x.status)}"><span class="sdot" aria-hidden="true">${STEP_ICON[x.status] || '○'}</span><span><b>${esc(x.label)}</b>${x.date ? ` <span class="small">${esc(fmtLong(x.date))}</span>` : ''}${x.note ? `<br><span class="small">${escGl(x.note)}</span>` : ''}${src(x.source_url)}</span></li>`).join('')}</ol>
        ${t.what_next ? `<p><b>What happens next:</b> ${escGl(t.what_next)}</p>` : ''}</section>
      <h2>How this council has voted on it</h2>
      ${ds.length ? `<div class="stack">${ds.map((d) => decisionCard(d, d.m)).join('')}</div>` : `<p class="muted">The new council hasn’t voted on this yet. Every vote on it will appear here.</p>`}
      ${qs.length ? `<h2>What each of them said during the campaign</h2>${qs.map(qCard).join('')}` : ''}
      ${(t.history || []).length ? `<details class="drop"><summary>Earlier history (before this council)</summary><ul class="hist">${t.history.map((h) => `<li><b>${esc(fmtLong(h.date))}:</b> ${escGl(h.what)}${h.votes ? ` <span class="small">(${esc(h.votes)})</span>` : ''}${src(h.source_url)}</li>`).join('')}</ul></details>` : ''}
      ${haveSay(upcoming[0], t.title, t)}
      ${signupBox('issue')}`,
    }));
  }
}

// ---------- NEWS (/news/ and /news/<slug>/) ----------
// A side section: short local stories written from public sources (data/news.json). Council stays the main event,
// so News sits last in the bottom bar and the top bar, and gets one small box low on the home page.
{
  const SEC = Object.fromEntries(NEWS.sections);
  const nUrl = (st) => `/news/${st.slug}/`;
  const nDate = (st) => `<time datetime="${st.date}" data-rel>${esc(fmtLong(st.date))}</time>`;
  const kicker = (st) => `<div class="nw-kicker"><span>${esc(SEC[st.s])}</span>${nDate(st)}</div>`;
  const nBars = (rows, title = '', note = '') => {
    const top = Math.max(...rows.map((r) => r[1]));
    return `${title ? `<h3 class="nw-vtitle">${esc(title)}</h3>` : ''}<div class="nw-bars">${rows.map(([label, n, fill, shown], i) => `<div class="nw-bar${i === 0 ? ' win' : ''}" style="--w:${Math.round((n / top) * 1000) / 10}%${fill ? `;--fill:var(${fill})` : ''}"><div class="nw-lbl"><span>${esc(label)}</span><b>${esc(shown || n.toLocaleString('en-CA'))}</b></div><div class="nw-track"><div class="nw-fill"></div></div></div>`).join('')}</div>${note ? `<p class="nw-note">${esc(note)}</p>` : ''}`;
  };
  const nFaces = () => `<ul class="nw-faces">${[...mayors, ...council].map((c) => `<li><a href="/council/${c.slug}/">${avatar(c)}<b>${esc(c.name)}</b><span>${c.office === 'mayor' ? 'Mayor' : 'Councillor'}</span><em class="${c.incumbent ? '' : 'new'}">${c.incumbent ? 'Returning' : 'New'}</em></a></li>`).join('')}</ul>`;
  const visual = (st) => {
    const v = st.visual; if (!v) return '';
    if (v.type === 'bars') return `<div class="nw-panel">${nBars(v.rows, v.title, v.note)}</div>`;
    if (v.type === 'bars+faces') return nBars(v.rows) + nFaces();
    if (v.type === 'big') return `<div class="nw-big">${esc(v.big)}<small>${esc(v.small)}</small></div>`;
    if (v.type === 'map') return `<figure class="nw-map"><img src="${esc(v.img)}" alt="${esc(v.alt)}" width="1280" height="800" loading="lazy"><figcaption>${esc(v.cap)} Map data © OpenStreetMap contributors.</figcaption></figure>`;
    return '';
  };
  const take = (st) => (st.take ? `<p class="nw-take"><b>What changes</b>${st.take}</p>` : '');
  const source = (st) => `<p class="nw-src">Source: <a href="${esc(st.src[1])}" target="_blank" rel="noopener">${esc(st.src[0])}</a></p>`;
  const shareBtn = (st) => `<button class="nw-share no-print" type="button" data-nw-share="${esc(ORIGIN + nUrl(st))}" data-title="${esc(st.head)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>Share</button>`;
  const foot = (st) => `<div class="nw-foot">${source(st)}${shareBtn(st)}</div>`;
  const hLink = (st, tag = 'h2') => `<${tag} class="nw-h"><a href="${nUrl(st)}">${esc(st.head)}</a></${tag}>`;
  const attrs = (st, cls) => `class="${cls}" data-s="${st.s}"`;
  const story = (st) => {
    if (st.tier === 'lead') return `<article ${attrs(st, 'nw-lead')}>${kicker(st)}${hLink(st)}${visual(st)}<p class="nw-dek">${esc(st.dek)}</p>${take(st)}${foot(st)}</article>`;
    if (st.tier === 'feature') return `<article ${attrs(st, 'nw-feature')}>${kicker(st)}${hLink(st)}<p class="nw-dek">${esc(st.dek)}</p>${visual(st)}${take(st)}${foot(st)}</article>`;
    if (st.tier === 'brief') return `<article ${attrs(st, 'nw-brief')}>${kicker(st)}${hLink(st, 'h3')}<p class="nw-dek">${st.dek}</p>${foot(st)}</article>`;
    const isMap = st.visual && st.visual.type === 'map';
    return `<article ${attrs(st, 'nw-card')}>${kicker(st)}${isMap ? visual(st) : ''}${hLink(st, 'h3')}${isMap ? '' : visual(st)}<p class="nw-dek">${esc(st.dek)}</p>${take(st)}${foot(st)}</article>`;
  };
  const chips = `<div class="nw-chips-wrap no-print"><div class="nw-chips" role="group" aria-label="Show stories about">
    <button type="button" class="nw-chip" aria-pressed="true" data-f="all">All</button>${NEWS.sections.filter(([k]) => NEWS.stories.some((s) => s.s === k)).map(([k, l]) => `<button type="button" class="nw-chip" aria-pressed="false" data-f="${k}" data-s="${k}"><i></i>${esc(l)}</button>`).join('')}</div></div>`;
  const cal = (d) => { const x = new Date(d + 'T12:00:00'); return `<div class="nw-cal" aria-hidden="true"><span>${x.toLocaleDateString('en-CA', { month: 'short' }).replace('.', '')}</span><b>${x.getDate()}</b></div>`; };
  const coming = `<section class="nw-coming"><h2 class="nw-rail-h">Coming up</h2><ol>${NEWS.coming.map((c) => `<li data-until="${c.date}">${cal(c.date)}<div><a href="${esc(c.url)}"${isUrl(c.url) ? ' target="_blank" rel="noopener"' : ''}>${esc(c.title)}</a><p>${esc(fmtLong(c.date))}. ${esc(c.text)}</p></div></li>`).join('')}</ol><p class="nw-more"><a href="/meetings/">All council meetings →</a></p></section>`;
  const S = NEWS.stories;
  const lead = S.filter((s) => s.tier === 'lead'), feat = S.filter((s) => s.tier === 'feature'), briefs = S.filter((s) => s.tier === 'brief');
  const cards = S.filter((s) => s.tier === 'card');
  const latestCards = cards.slice(0, 2), earlierCards = cards.slice(2);

  write('/news/', page({
    url: '/news/', title: 'Squamish news',
    desc: 'Short Squamish news from the public record: District releases, council agendas, election results and local announcements, in plain words with the source for every story.',
    image: `${ORIGIN}/news/og/${S[0].slug}.jpg`,
    jsonld: crumbLd([['Home', '/'], ['News', '/news/']]),
    body: `<div class="nw">
  <header class="nw-top"><h1>Squamish news</h1>
    <p class="nw-lede">Short updates from the public record, each with its source. For what council decided and how each member voted, see <a href="/meetings/">Meetings</a>.</p></header>
  ${chips}
  <div class="nw-layout">
    <div class="nw-main">
      <section class="nw-group" data-group="latest"><h2 class="nw-sechead">Latest</h2>
        ${lead.map(story).join('')}${feat.map(story).join('')}
        <div class="nw-cards">${latestCards.map(story).join('')}</div>
      </section>
      <section class="nw-group" data-group="earlier"><h2 class="nw-sechead">Earlier</h2>
        <div class="nw-cards">${earlierCards.map(story).join('')}</div>
      </section>
      <p class="nw-empty muted" data-nw-empty hidden>No stories in this section yet.</p>
    </div>
    <aside class="nw-rail">
      ${coming}
      <section class="nw-briefs" data-group="briefs"><h2 class="nw-rail-h">In brief</h2>${briefs.map(story).join('')}</section>
      ${signupBox('news')}
    </aside>
  </div>
  <section class="nw-how"><h2>How we write these</h2>
    <p>We read District news releases, council agendas, regional district notices, Elections BC and local announcements, then write a short story in our own words. Every story names its source. No opinions and no endorsements. Spot a mistake? <a href="/about/">Tell us</a>.</p></section>
</div>`,
    scripts: '<script src="/news.js"></script>',
  }));

  S.forEach((st, i) => {
    const others = S.filter((x) => x !== st).slice(0, 4);
    const body = st.tier === 'lead'
      ? `${kicker(st)}<h1 class="nw-h">${esc(st.head)}</h1><p class="nw-dek">${esc(st.dek)}</p>${visual(st)}${take(st)}`
      : `${kicker(st)}<h1 class="nw-h">${esc(st.head)}</h1>${st.visual && st.visual.type === 'map' ? visual(st) : ''}<p class="nw-dek">${st.tier === 'brief' ? st.dek : esc(st.dek)}</p>${st.visual && st.visual.type !== 'map' ? visual(st) : ''}${take(st)}`;
    write(nUrl(st), page({
      url: nUrl(st), title: st.head,
      desc: st.dek.replace(/<[^>]+>/g, ''),
      image: `${ORIGIN}/news/og/${st.slug}.jpg`,
      jsonld: [crumbLd([['Home', '/'], ['News', '/news/'], [st.head, nUrl(st)]]), { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: st.head, datePublished: st.date, inLanguage: 'en-CA', image: `${ORIGIN}/news/og/${st.slug}.jpg`, publisher: { '@type': 'Organization', name: 'Squamish Voters', url: `${ORIGIN}/` }, isBasedOn: st.src[1] }],
      body: `<div class="nw nw-story-page">
  <p class="crumbs"><a href="/news/">← All news</a></p>
  <article class="nw-full" data-s="${st.s}">${body}${foot(st)}</article>
  <section class="nw-next"><h2 class="nw-sechead">More news</h2><ul>${others.map((o) => `<li data-s="${o.s}"><span>${esc(SEC[o.s])}</span><a href="${nUrl(o)}">${esc(o.head)}</a></li>`).join('')}</ul>
  <p class="nw-more"><a href="/news/">All news →</a> · <a href="/meetings/">What council decided →</a></p></section>
  ${signupBox('news-story')}
</div>`,
      scripts: '<script src="/news.js"></script>',
    }));
  });
}

// ---------- THIS WEEK AT COUNCIL (/this-week/ and the Friday email) ----------
{
  const back = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10), ahead = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  const recent = past.filter((m) => m.summary && m.date >= back), soon = upcoming.filter((m) => m.date <= ahead);
  const week = { built: TODAY, recent: recent.map((m) => ({ url: ORIGIN + mUrl(m), date: m.date, type: mType(m).label, headline: m.summary.headline, key_points: m.summary.key_points || [], votes: (m.decisions || []).filter((d) => d.votes).slice(0, 5).map((d) => ({ title: d.title, result: RESULT_WORD[d.result] || '', for_you: d.for_you || '', against: all.filter((c) => d.votes[c.slug] === 'no').map((c) => c.name) })) })),
    soon: soon.map((m) => ({ url: ORIGIN + mUrl(m), date: m.date, time: fmtTime(m.time), type: mType(m).label, preview: m.preview || mType(m).plain, items: (m.agenda_items || []).slice(0, 5).map((a) => a.plain) })),
    promises: Object.fromEntries(Object.entries(pCounts(PROMISES))) };
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, 'this-week.json'), JSON.stringify(week));
  write('/this-week/', page({
    url: '/this-week/', title: 'This week at Squamish council',
    desc: 'What Squamish council decided this week and what’s coming up next, in plain words. The same summary goes out by email every Friday.',
    body: `<h1>This week at council</h1>
    <p class="lede">What council decided in the last week, and what’s coming up. This is what our Friday email says.</p>
    <h2>Decided</h2>
    ${recent.length ? recent.map((m) => `<section class="card"><p class="mwhen"><b>${esc(fmtDay(m.date))}</b> ${mBadge(m)}</p><p class="lede">${escGl(m.summary.headline)}</p><ul class="keypoints">${(m.summary.key_points || []).map((k) => `<li>${escGl(k)}</li>`).join('')}</ul><a class="btn secondary" href="${mUrl(m)}">Every vote →</a></section>`).join('') : '<p class="muted">Council didn’t meet in the last week.</p>'}
    <h2>Coming up</h2>
    ${soon.length ? `<ul class="mlist">${soon.map(meetingRow).join('')}</ul>` : '<p class="muted">No meetings in the next 10 days.</p>'}
    ${signupBox('week')}`,
  }));
}

// ---------- SAID VS DID ----------
// Every agree/disagree statement against every member: their campaign answer, and whether their votes since went the same way.
{
  const people = [...mayors, ...council];
  const voteMark = (c, q) => {
    const pos = positionsOf(c).find((p) => p.kind === 'quiz' && p.q.id === q.id);
    if (!pos) return '';
    const st = posStatus(checksFor(c, pos));
    return st === 'untested' ? '' : `<span class="vmark ${POS_STATUS[st][2]}" title="${esc(POS_STATUS[st][1])}">${st === 'in_line' ? '✓ voted that way' : st === 'against' ? '✕ voted against' : '~ mixed'}</span>`;
  };
  const tested = (q) => DECISIONS.filter((d) => (d.related_q || []).some((r) => r.q === q.id));
  const groups = [...new Set(ALL_QUESTIONS.map((q) => q.issue))];
  const anyVotes = DECISIONS.some((d) => (d.related_q || []).length);
  write('/said-vs-did/', page({
    url: '/said-vs-did/', title: 'Do Squamish council members vote the way they said?',
    desc: 'Every Squamish council member’s campaign answers (strongly agree to strongly disagree) side by side with how they have actually voted since, statement by statement.',
    jsonld: crumbLd([['Home', '/'], ['Said vs did', '/said-vs-did/']]),
    body: `<h1>Do they vote the way they said?</h1>
    <p class="lede">During the campaign we asked every candidate to agree or disagree with the same ${ALL_QUESTIONS.length} statements. Here is what each of the seven winners said, and, as council votes, whether their votes went the same way.</p>
    ${noVotesNote()}
    <h2 id="scoreboard">Scoreboard</h2>
    <div class="scards">${people.map((c) => scoreCard(c, { promises: false })).join('')}</div>
    <h2 id="grid">Statement by statement</h2>
    <div class="card keybox"><div class="legend">${BINS.map((b) => `<span><span class="cell ${b[1]}">${b[3]}</span>${b[2]}</span>`).join('')}<span><span class="cell un">?</span>Didn’t say</span></div>
    <p class="small">The box is what they said during the campaign. Once a council vote tests it, <span class="vmark ps-kept">✓ voted that way</span> or <span class="vmark ps-broken">✕ voted against</span> appears under it.</p></div>
    <div class="chip-row no-print">${groups.map((g) => `<a class="chip-btn" href="#t-${g}">${esc(((ISSUES.find((i) => i.key === g) || {}).title || TOPIC_NAME[g] || g).replace(/^./, (x) => x.toUpperCase()))}</a>`).join('')}</div>
    ${groups.map((g) => { const qs = ALL_QUESTIONS.filter((q) => q.issue === g); const title = (ISSUES.find((i) => i.key === g) || {}).title || TOPIC_NAME[g] || g; return `<h3 id="t-${g}">${esc(title.charAt(0).toUpperCase() + title.slice(1))}</h3>
    ${qs.map(qCard).join('')}`; }).join('')}
    <h2 id="compass">On the compass</h2>
    <p>The <a href="/compass/">compass</a> places each member from their campaign answers. Once at least 3 votes test each line of a map, a second diamond-shaped marker shows where their <b>votes</b> put them, joined to the first by a dotted line. A long line means they vote differently from how they campaigned.</p>
    <p class="small"><a href="/promises/#how">How we link votes to statements</a> · <a href="/about/#meetings">How meeting summaries are made</a></p>`,
  }));
}

// ---------- PROMISES ----------
{
  const c0 = pCounts(PROMISES);
  write('/promises/', page({
    url: '/promises/', title: 'Squamish council promise tracker',
    desc: `${PROMISES.length} campaign promises from Squamish’s mayor and councillors, each with the exact quote and source, marked kept, broken or in progress as council votes.`,
    jsonld: crumbLd([['Home', '/'], ['Promise tracker', '/promises/']]),
    body: `<h1>Promise tracker</h1>
    <p class="lede">What the mayor and councillors said they would do during the 2026 campaign, and whether they’ve done it.</p>
    <div class="notice info"><b>Want the agree/disagree answers side by side with their votes?</b> <a href="/said-vs-did/">See “Do they vote the way they said?”</a></div>
    <h2 id="scoreboard">At a glance</h2>
    ${noVotesNote()}
    <div class="scards">${all.map((c) => scoreCard(c)).join('')}</div>
    <p class="small"><b>Promises</b> are specific things they said they would do. <b>Positions</b> are everything else they said they stand for. <a href="/said-vs-did/">See positions statement by statement</a>.</p>
    <h2 id="list">Every promise</h2>
    ${ANY_VOTES ? '' : '<!--'}<div class="pstats">${Object.entries(PSTATUS).map(([k, P]) => `<button type="button" class="chip-btn" data-pf="${k}" aria-pressed="false"><span class="pstatus ${P.cls}"><span aria-hidden="true">${P.icon}</span> ${c0[k]}</span> ${esc(P.label)}</button>`).join('')}<button type="button" class="chip-btn" data-pf="" aria-pressed="true">Show all</button></div>${ANY_VOTES ? '' : '-->'}
    ${all.map((c) => { const ps = promisesOf(c); return ps.length ? `<h2 id="${c.slug}" class="phead">${avatar(c, 'sm')} <a href="/council/${c.slug}/">${esc(c.name)}</a> <span class="small">${c.office === 'mayor' ? 'Mayor' : 'Councillor'} · ${ps.length} promises</span></h2>
    <div class="card stack">${ps.map((p) => promiseRow(p).replace('<details class="promise"', `<details class="promise" data-ps="${p.status || 'not_yet'}"`)).join('')}</div>` : ''; }).join('')}
    <h2 id="how">How we judge promises</h2>
    <ul>
      <li><b>We only count clear promises.</b> Something they said they would do or vote for, in their own words, with a link to where they said it. General values like “I care about Squamish” aren’t tracked.</li>
      <li><b>Each promise says how we’ll know.</b> We write down in advance what vote or action would show it was kept or broken.</li>
      <li><b>Votes decide it, not opinions.</b> When council votes on something that tests a promise, the promise is updated automatically and links to that vote.</li>
      <li><b>“In progress”</b> means council has taken a step but not finished. <b>“Nothing to judge yet”</b> means council hasn’t voted on it.</li>
      <li><b>Positions are checked the same way.</b> When a vote directly tests something a member said, like “move the Under One Roof shelter out of downtown”, we note whether their vote went the same way as what they said.</li>
      <li><b>One vote can’t always keep a promise.</b> A councillor can vote the way they promised and still lose. We mark their promise kept if they did what they said, even if the vote failed.</li>
    </ul>
    <p class="small">Think we got one wrong? <a href="mailto:${esc(SITE.contact)}?subject=Promise%20tracker">Tell us</a> and we’ll take another look.</p>`,
    scripts: `<script>document.querySelectorAll('[data-pf]').forEach(function(b){b.addEventListener('click',function(){var f=b.getAttribute('data-pf');document.querySelectorAll('[data-pf]').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});document.querySelectorAll('details.promise').forEach(function(d){d.hidden=!!f&&d.getAttribute('data-ps')!==f})})})</script>`,
  }));
}

// ---------- ABOUT (hand-written content in data/pages) ----------
const pageFile = (f) => fs.readFileSync(path.join(ROOT, 'data', 'pages', f), 'utf8');
const mapLink = (addr) => `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}" target="_blank" rel="noopener">Map</a>`;
const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
const hasStance = (c, key) => { const s = c.stances?.[key]; return !!(s && s.position && !/no public position/i.test(s.position)); };
const nameList = (cs) => cs.map((c) => `<a href="/council/${c.slug}/">${esc(c.name)}</a>`).join(', ');
function stanceBlock(c, key) {
  const s = c.stances[key];
  return `<li class="tstance"><h3><a href="/council/${c.slug}/#issues">${esc(c.name)}</a>${c.office === 'mayor' ? ' <span class="small">(running for mayor)</span>' : ''}${c.incumbent ? ' <span class="small">· current councillor</span>' : ''}</h3>
  <p><b>${escGl(s.position)}</b></p><p>${escGl(s.summary || '')}${src(s.source_url)}</p>${s.quote ? `<blockquote>“${escGl(s.quote.replace(/^["“]|["”]$/g, ''))}”</blockquote>` : ''}</li>`;
}
const TOPIC_EXTRA_Q = { recreation_facilities: ['q12', 'q22'] }; // Brennan Park statements are filed under taxes, but this is the page people look for
for (const ic of ctx.issues || []) {
  const slug = TOPIC_SLUG[ic.key]; if (!slug) continue;
  const iss = ISSUES.find((x) => x.key === ic.key);
  const qs = ALL_QUESTIONS.filter((q) => q.issue === ic.key || (TOPIC_EXTRA_Q[ic.key] || []).includes(q.id));
  const withS = iss ? all.filter((c) => hasStance(c, ic.key)) : [];
  const without = iss ? all.filter((c) => !hasStance(c, ic.key)) : [];
  const name = TOPIC_NAME[ic.key];
  const paras = ic.explainer.split(/(?<=[.!?])\s+/), mid = Math.ceil(paras.length / 2);
  const url = `/issues/${slug}/`;
  write(url, page({
    url: '/issues/', title: `Where Squamish candidates stand on ${name} (2026 election)`,
    desc: `${iss ? `${withS.length} of ${all.length} Squamish mayor and council candidates have a public position on ${name}. ` : ''}What each one has said, with sources, plus plain-language background for the October 17, 2026 election.`,
    jsonld: crumbLd([['Home', '/'], ['The issues', '/issues/'], [ic.title, url]]),
    body: `<p class="crumbs"><a href="/issues/">← All the issues</a></p>
    <h1>Where the candidates stand on ${esc(name)}</h1>
    ${ic.short_explainer && !ic.explainer.startsWith(ic.short_explainer.slice(0, 40)) ? `<p class="lede">${esc(ic.short_explainer)}</p>` : ''}
    <h2>The background</h2>
    <p>${escGl(paras.slice(0, mid).join(' '))}</p><p>${escGl(paras.slice(mid).join(' '))}</p>
    ${ic.key === 'environment_lng' || ic.key === 'taxes_spending' ? DEAL_IF_NO : ''}
    ${(ic.key_facts || []).length ? `<h3>Key facts</h3><ul class="facts">${ic.key_facts.map((f) => `<li>${esc(f.fact)}${src(f.source_url)}</li>`).join('')}</ul>` : ''}
    ${qs.length ? `<h2>Agree or disagree?</h2><p>Where each candidate lands on ${qs.length === 1 ? 'this statement' : `these ${qs.length} statements`}, from their own questionnaire answers or their public record. Tap a name for the detail.</p>${qs.map(spectrum).join('')}` : ''}
    ${iss ? `<h2>What each candidate has said</h2>
    <p class="small">Mayor candidates first, then council, in alphabetical order. Our summary of the public record; tap <b>[source]</b> to check it.</p>
    <ul class="plainlist tstances">${withS.map((c) => stanceBlock(c, ic.key)).join('')}</ul>
    ${without.length ? `<p class="muted"><b>No public position found for:</b> ${nameList(without)}. If you are one of these candidates, <a href="mailto:${SITE.contact}?subject=${encodeURIComponent('Position on ' + name)}">send us your position</a>.</p>` : ''}` : ''}
    <div class="btn-row no-print"><a class="btn" href="/quiz/">Take the ${QUESTIONS.length}-question quiz →</a><a class="btn secondary" href="/compare/">Compare everyone</a></div>
    <h2>Other issues</h2><ul class="namechips">${(ctx.issues || []).filter((o) => o.key !== ic.key && TOPIC_SLUG[o.key]).map((o) => `<li><a href="/issues/${TOPIC_SLUG[o.key]}/">${esc(TOPIC_NAME[o.key])}</a></li>`).join('')}<li><a href="/issues/woodfibre-tax-deal/">the Woodfibre tax deal</a></li></ul>`,
  }));
}
{ // The single hottest question of the campaign gets its own page.
  const q23 = ALL_QUESTIONS.find((q) => q.id === 'q23');
  if (q23) {
    const yes = all.filter((c) => c.quiz_answers?.q23 > 0), no = all.filter((c) => c.quiz_answers?.q23 < 0);
    write('/issues/woodfibre-tax-deal/', page({
      url: '/issues/', title: 'Woodfibre LNG tax deal: where the Squamish candidates stand',
      desc: `Council rejected the 10-year Woodfibre LNG tax agreement 5–2 on Sept. 22, 2026; the next council could revisit it. ${yes.length} candidates lean yes, ${no.length} lean no. What each choice means and what every candidate has said, with sources.`,
      jsonld: crumbLd([['Home', '/'], ['The issues', '/issues/'], ['Woodfibre LNG tax deal', '/issues/woodfibre-tax-deal/']]),
      body: `<p class="crumbs"><a href="/issues/">← All the issues</a></p>
      <h1>The Woodfibre LNG tax deal</h1>
      <p class="lede">On September 22, 2026, council voted 5–2 against a proposed 10-year agreement fixing what Woodfibre LNG pays in place of normal property tax. The next council could negotiate a new one. Here is what it means and where every candidate stands.</p>
      ${DEAL_IF_NO}
      <h2>Where the candidates stand</h2>${spectrum(q23)}
      <p>For the wider debate about the plant itself, see <a href="/issues/${TOPIC_SLUG.environment_lng}/">the Woodfibre LNG plant</a>. For property taxes generally, see <a href="/issues/${TOPIC_SLUG.taxes_spending}/">property taxes and spending</a>.</p>
      <div class="btn-row no-print"><a class="btn" href="/quiz/">Take the quiz →</a><a class="btn secondary" href="/compare/#taxes_spending">Compare everyone on taxes</a></div>`,
    }));
  }
}
// Results: the 2026 race as decided, with 2022 and 2018 below
{
  const n = num;
  const table = (rows, seats) => `<div class="table-scroll"><table class="issue-table"><thead><tr><th>Candidate</th><th>Votes</th><th></th></tr></thead><tbody>${[...rows].sort((a, b) => b.total - a.total).map((r) => `<tr><td>${r.elected ? '<b>' : ''}${esc(r.name)}${r.elected ? '</b>' : ''}</td><td>${n(r.total)}</td><td>${r.elected ? '<b>Elected</b>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
  const pastRes = (y) => { const r = RES[y]; return `<h2 id="${y}">${y} results</h2>
    <p>${n(r.ballots_cast)} ballots were cast, a turnout of <b>${r.turnout_pct}%</b> of ${n(r.total_eligible_electors)} eligible voters.${src(r.source_url, 'official results')}</p>
    <h3>Mayor</h3>${table(r.mayor)}<h3>Council (6 elected)</h3>${table(r.council)}`; };
  write('/results/', page({
    url: '/results/', title: `Squamish election results 2026: ${resWinner('mayor')[0]} elected mayor`,
    desc: `${resWinner('mayor')[0]} was elected mayor of Squamish on October 17, 2026 by ${num(R26.mayor[0].total - R26.mayor[1].total)} votes. Council: ${resWinner('council').join(', ')}. Every candidate's votes, turnout ${R26.turnout_pct}%, plus 2022 and 2018.`,
    jsonld: crumbLd([['Home', '/'], ['Election results', '/results/']]),
    body: `<h1>Squamish election results 2026</h1>
    <p class="lede">${num(R26.ballots_cast)} people voted on October 17, 2026, a turnout of ${R26.turnout_pct}% of ${num(R26.eligible_voters)} eligible voters.${src(R26.source_url, 'District of Squamish')}</p>
    <div class="jump"><a class="chip-btn" href="#mayor">Mayor</a><a class="chip-btn" href="#council">Council</a><a class="chip-btn" href="#trustees">School trustees</a><a class="chip-btn" href="#2022">2022</a></div>
    <h2 id="mayor">Mayor <span class="small">1 elected</span></h2>${resRace(R26.mayor, { pct: true })}
    <h2 id="council">Council <span class="small">6 elected</span></h2>${resRace(R26.council)}
    ${(R26.trustees || []).length ? `<h2 id="trustees">School trustees <span class="small">2 elected for Squamish, School District 48</span></h2>${resRace(R26.trustees)}` : ''}
    <div class="btn-row"><a class="btn" href="/council/">Meet the new council →</a></div>
    ${pastRes('2022')}
    ${pastRes('2018')}
    <p class="small">Past results are from the District of Squamish’s signed final determinations. 2026 numbers are from the District’s results page; see the <a href="https://squamish.ca/government-and-administration/council/election/" target="_blank" rel="noopener">District election page</a> for the official record.</p>`,
  }));
}
// Quick answers
{
  const M0 = mayors[0];
  const FAQ = [
    ['Who is the mayor of Squamish?', `${M0.name} was elected mayor on October 17, 2026, for a four-year term to 2030.`, `<a href="/council/${M0.slug}/">${esc(M0.name)}’s page</a>`],
    ['Who is on Squamish council?', `Mayor ${M0.name} and councillors ${council.map((c) => c.name).join(', ')}.`, '<a href="/council/">Meet the council</a>'],
    ['When does Squamish council meet?', 'Regular council meetings are usually the 1st and 3rd Tuesday of each month at 6 p.m., with no meetings in August. Committee of the Whole is usually the 2nd and 4th Tuesday. Our meetings page lists every upcoming one.', '<a href="/meetings/">Upcoming meetings</a>'],
    ['Can I watch a council meeting?', 'Yes. Meetings are open to the public at Municipal Hall, and most are streamed live and posted online afterward. Each meeting on our site links to the official video.', '<a href="/meetings/">Meetings and videos</a>'],
    ['What is the difference between a council meeting and Committee of the Whole?', `${MTYPE.regular.plain} ${MTYPE.cow.label}: ${MTYPE.cow.plain}`, ''],
    ['What is a public hearing?', MTYPE.hearing.plain + ' Anyone can speak or send a letter. Fewer rezonings need one since B.C. changed the rules in 2023.', ''],
    ['How do you know if a promise was kept?', 'Each promise lists exactly what would show it was kept or broken. When council votes on something that tests it, we mark it and link to the vote.', '<a href="/promises/#how">How we judge promises</a>'],
    ['Who won the 2026 Squamish election?', `${resWinner('mayor')[0]} won the mayor’s race. Elected to council: ${resWinner('council').join(', ')}. Turnout was ${R26.turnout_pct}%.`, '<a href="/results/">Full results</a>'],
    ...(ctx.pay ? [['How much is the mayor of Squamish paid?', `In ${ctx.pay.year} the mayor was paid $${ctx.pay.mayor.toLocaleString('en-CA')} and each councillor about $${ctx.pay.councillor.toLocaleString('en-CA')}, not counting expenses and benefits (District of Squamish financial statement).`, isUrl(ctx.pay.source_url) ? `<a href="${esc(ctx.pay.source_url)}" target="_blank" rel="noopener">Source</a>` : '']] : []),
    ['Is this site run by the District?', 'No. Squamish Voters is independent and not connected to the District, council or any group. It does not endorse anyone.', '<a href="/about/">About this site</a>'],
  ].filter(([, a]) => a);
  write('/faq/', page({
    url: '/faq/', title: 'Squamish council: quick answers',
    desc: 'Who is on Squamish council, when council meets, how to watch, what a public hearing is, and how we track promises: short answers.',
    jsonld: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    body: `<h1>Quick answers</h1>
    <p class="lede">The questions people ask most about Squamish council.</p>
    ${FAQ.map(([q, a, more]) => `<h2>${esc(q)}</h2><p>${esc(a)}${more ? ` ${more} →` : ''}</p>`).join('')}`,
  }));
}

// A platform statement a candidate sent us as text (not a PDF): published whole on its own page, like a positions paper.
for (const c of all.filter((x) => stmtOf(x)?.file)) {
  const f = esc(first(c)), st = stmtOf(c);
  write(st.url, page({
    url: '/council/', title: `${c.name}: platform statement, in full`,
    desc: `${c.name}’s own platform statement for the 2026 Squamish election, sent to Squamish Voters, in full.`,
    body: `<p class="crumbs"><a href="/council/${c.slug}/">← ${esc(c.name)}’s profile</a></p>
    <h1>${esc(c.name)}: platform statement, in full</h1>
    <div class="notice direct"><b>These are ${f}’s own words, not ours.</b> ${f} ${esc(st.how)} on ${esc(fmtLong(st.date))}, under the title “${esc(st.title.replace(/[“”]/g, "'"))}”. It is published whole; nothing has been cut or reworded. Spot a typing mistake? <a href="mailto:${esc(SITE.contact)}">Tell us</a>.</div>
    <div class="paper">${pageFile(st.file)}</div>
    <div class="btn-row"><a class="btn secondary" href="/council/${c.slug}/">← Back to ${f}’s profile</a></div>`,
  }));
}
for (const c of all.filter((x) => x.paper)) {
  const f = esc(first(c));
  write(c.paper.url, page({
    url: '/council/', title: `${c.name}: positions paper, in full`,
    desc: `${c.name}’s own ${c.paper.points}-point positions paper for the 2026 Squamish election, in full.`,
    body: `<p class="crumbs"><a href="/council/${c.slug}/">← ${esc(c.name)}’s profile</a></p>
    <h1>${esc(c.name)}: positions paper, in full</h1>
    <div class="notice info"><b>These are ${f}’s own words, not ours.</b> ${f} ${esc(c.paper.where)} around ${esc(fmtLong(c.paper.date))}${isUrl(c.paper.post_url) ? ` (<a href="${esc(c.paper.post_url)}" target="_blank" rel="noopener">original post</a>)` : ''}, under the title “${esc(c.paper.title.replace(/[“”]/g, "'"))}”. We typed it out from the original so it is easy to read and search on a phone; nothing has been cut or reworded. ${f} says it “may be updated”. Spot a typing mistake? <a href="mailto:${esc(SITE.contact)}">Tell us</a>.</div>
    <div class="paper">${pageFile(c.paper.file)}</div>
    <div class="btn-row"><a class="btn secondary" href="/council/${c.slug}/">← Back to ${f}’s profile</a></div>`,
  }));
}
write('/about/', page({ url: '/about/', title: 'About this site', desc: 'Who makes Squamish Voters, how meeting summaries and the promise tracker work, and how to send a correction. Independent and not affiliated with the District or any council member.', body: pageFile('about.html').replaceAll('<!--CONTACT-->', SITE.contact ? `<a href="mailto:${esc(SITE.contact)}">${esc(SITE.contact)}</a>` : 'a contact address will be posted here shortly.').replace('{{COUNT}}', String(all.length)).replace('{{UPDATED}}', esc(SITE.updated)) }));
// ---------- /welcome/: where the email confirm link lands (api/subscribe.js redirects here with ?t=<token>) ----------
// Two optional questions: up to 3 top issues (each asks which way they lean, or Other with a write-in) and their
// neighbourhood. Saved to their sign-up; not used to tailor the Friday email yet (Jeff, Oct 19). Each pair of sides is worded so neither sounds like the right answer.
const WELCOME_HOODS = [...HOODS, { slug: 'outside', name: 'Outside Squamish' }];
write('/welcome/', page({ url: '/welcome/', title: 'You’re confirmed', noindex: true,
  body: `<div class="welcome">
  <h1 data-wh>You’re confirmed</h1>
  <p class="lede" data-wok>Your first email arrives Friday morning. So it doesn’t land in spam, add <b>news@squamishvoters.com</b> to your contacts.</p>
  <p class="lede" data-wnotok hidden>This page opens from the link in your confirmation email. To get the weekly email, <a href="/#signup">sign up on the home page</a>.</p>
  <section class="card wq" data-wq>
    <h2>Two quick questions</h2>
    <p class="small">Optional. Your answers help us understand what people in Squamish care about. We only ever share totals, never names.</p>
    <h3>1. What are your top issues?</h3>
    <p class="small">Pick up to 3.</p>
    <div class="topicpick" role="group" aria-label="Your top issues">${SIGNUP_ISSUES.map((i) => `<button type="button" class="chip-btn" data-wi="${i.key}" aria-pressed="false"><span aria-hidden="true">${i.icon}</span> ${esc(i.title)}</button>`).join('')}</div>
    <p class="small" data-wnote aria-live="polite"></p>
    <ul class="wpicks" data-wpicks></ul>
    <h3>2. Which neighbourhood do you live in?</h3>
    <div class="topicpick" role="group" aria-label="Your neighbourhood">${WELCOME_HOODS.map((h) => `<button type="button" class="chip-btn" data-wa="${esc(h.slug)}" aria-pressed="false">${esc(h.name)}</button>`).join('')}</div>
    <p class="wsaved" data-wsaved aria-live="polite"></p>
  </section>
  <div class="btn-row"><a class="btn big" href="/">Go to Squamish Voters</a><a class="btn big secondary" href="/priorities/">See what other readers picked</a></div>
  <dialog class="sides" data-wdlg aria-labelledby="wd-q">
    <button type="button" class="sides-x" data-wclose aria-label="Close">×</button>
    <p class="small" data-wdt></p>
    <h2 id="wd-q" data-wdq></h2>
    <div class="sides-opts" data-wdo></div>
  </dialog>
</div>
<script>window.SV_SIDES=${JSON.stringify(SIDE_LABELS).replace(/</g, '\\u003c')};</script>`,
}));
// ---------- /priorities/: totals of what readers picked on the welcome page (api/priorities.js; counts only) ----------
write('/priorities/', page({ url: '/priorities/', title: 'Readers’ top issues',
  desc: 'The issues that matter most to people who get the Squamish Voters weekly email, and which way they lean on each. Totals only, never names.',
  body: `<p class="crumbs"><a href="/">← Home</a></p>
  <h1>Readers’ top issues</h1>
  <p class="lede">When someone confirms the weekly email, we ask them to pick up to 3 issues that matter most to them, and which way they lean on each. These are the totals so far.</p>
  <div class="notice info"><b>This is not a poll of Squamish.</b> It only counts readers who signed up for the weekly email and chose to answer, so it may not match the town as a whole. We show totals only, never names, email addresses or what people wrote in.</div>
  <section class="card prio-box"><h2>Top issues</h2>
    <p class="small" data-prio-count aria-live="polite">Loading the totals…</p>
    <div data-prio="all"></div>
  </section>
  <noscript><p>Turn on JavaScript to see the totals.</p></noscript>
  <p>Want to add yours? Sign up below. After you confirm, you’ll get the two quick questions.</p>
  ${signupBox('priorities')}
  <script>window.SV_SIDES=${JSON.stringify(SIDE_LABELS).replace(/</g, '\\u003c')};</script>`,
}));
// ---------- /subscribers/: Jeff's private view of the email sign-ups and their welcome page answers (api/subscribers.js, ADMIN_TOKEN) ----------
write('/subscribers/', page({ url: '/subscribers/', title: 'Email sign-ups', noindex: true,
  body: `<h1>Email sign-ups</h1>
<p class="lede" id="s-status" aria-live="polite">Loading…</p>
<div id="s-out" class="sb"></div>
<style>
.sb { display: grid; gap: 1.2rem; }
.sb-note { font-style: italic; color: var(--ink-2); }
.sb-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.sb-person { border-top: 1px solid var(--line); padding: .8rem 0; }
.sb-person p { margin: 0 0 .2rem; }
.sb-top { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; overflow-wrap: anywhere; }
.sb-dim { opacity: .7; }
.sb-pill { font-size: .8rem; font-weight: 700; border-radius: 999px; padding: .1rem .6rem; border: 1px solid var(--line); background: var(--surface-2); }
.sb-subscribed { background: var(--brand-soft); }
</style>
<script>window.SV_SUBS=${JSON.stringify({ issues: Object.fromEntries(SIGNUP_ISSUES.map((i) => [i.key, { t: i.title, i: i.icon, o: SIDES[i.key] ? [SIDES[i.key][1], SIDES[i.key][2]] : [] }])), hoods: Object.fromEntries(WELCOME_HOODS.map((h) => [h.slug, h.name])) }).replace(/</g, '\\u003c')};</script>
<script src="/subscribers.js" defer></script>`,
}));
write('/404/', page({ url: '/404/', title: 'Page not found', body: '<h1>We can’t find that page</h1><p class="lede">Try one of these instead.</p><div class="btn-row"><a class="btn big" href="/">Home</a><a class="btn big secondary" href="/council/">Candidates</a><a class="btn big secondary" href="/quiz/">Take the quiz</a></div>' }));
fs.copyFileSync(path.join(DIST, '404', 'index.html'), path.join(DIST, '404.html'));

// ---------- static assets ----------
for (const f of ['site.css', 'site.js', 'quiz.js', 'lean.js', 'subscribers.js', 'news.js']) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(DIST, f));
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

// ---------- sitemap (every indexable page written above; lastmod = build date) ----------
const today = new Date().toISOString().slice(0, 10);
const prio = (u) => (u === '/' || u === '/meetings/' ? '1.0' : ['/council/', '/promises/', '/quiz/', '/faq/'].includes(u) || u.startsWith('/meetings/') ? '0.8' : '0.6');
const mod = () => today;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...new Set(SITEMAP)].map((u) => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${mod(u)}</lastmod><priority>${prio(u)}</priority></url>`).join('\n')}
</urlset>
`);
console.log(`Built ${all.length} council members, ${MEETINGS.length} meetings, ${PROMISES.length} promises -> dist/`);
