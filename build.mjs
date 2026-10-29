// Static site generator for Squamish Voters 2026. No dependencies.
//   node build.mjs   ->  dist/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promiseTally, tallyText, positionStatus, confirmedByMinutes } from './scripts/pipeline/status.mjs';

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
// Corrections log (/corrections/). An entry's "affects" lists the page addresses (or starts of addresses) it changed.
const CORR = fs.existsSync(path.join(ROOT, 'data', 'corrections.json')) ? read('corrections.json') : { log_started: '2026-10-28', entries: [] };
const corrDate = (u) => (CORR.entries || []).filter((e) => [e.page, ...(e.affects || [])].some((a) => a && u.startsWith(a))).map((e) => e.date).sort().pop() || '';
// Roles on council (acting mayor, regional district board, committees). Empty until appointments are published.
const ROLES = fs.existsSync(path.join(ROOT, 'data', 'roles.json')) ? read('roles.json') : { members: {} };
const TRACKED = fs.existsSync(path.join(ROOT, 'data', 'tracked-issues.json')) ? read('tracked-issues.json').issues || [] : [];
const PART = fs.existsSync(path.join(ROOT, 'data', 'participate.json')) ? read('participate.json') : {};
const HOODS = PART.neighbourhoods || [];
// Squamish news: short stories from public sources, newest first (a side section; council stays the focus).
// Plain answers to the money questions people ask most (each one researched, every fact with its source).
const EXPLAINERS = fs.existsSync(path.join(ROOT, 'data', 'explainers.json')) ? read('explainers.json') : [];
const NEWS = fs.existsSync(path.join(ROOT, 'data', 'news.json')) ? read('news.json') : { sections: [], coming: [], stories: [] };
const ctx = read('context.json');
const TR = read('trustees.json');
// The voter quiz and the comparison pages use only the 12 core statements, so they stay quick.
// The rest are asked of candidates and shown on their profile once they answer.
const ALL_QUESTIONS = read('questions.json');
const QUESTIONS = ALL_QUESTIONS.filter((q) => q.core !== false);
const EXTRA_QUESTIONS = ALL_QUESTIONS.filter((q) => q.core === false);
const GLOSSARY = read('glossary.json');
// Build check: a source link with a space in it is two links or a note pasted into the address, and it goes to a
// "page not found". Stop the build so it gets fixed instead of published.
(() => {
  const bad = [];
  const walk = (v, where) => {
    if (typeof v === 'string') { if (/^https?:\/\//.test(v) && /\s/.test(v.trim())) bad.push(`${where}: ${v}`); return; }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, `${where}.${k}`));
  };
  const scan = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) scan(p);
    else if (d.name.endsWith('.json') && !/\.pre-/.test(d.name)) { try { walk(JSON.parse(fs.readFileSync(p, 'utf8')), path.relative(ROOT, p)); } catch {} }
  });
  scan(path.join(ROOT, 'data')); // skips the candidates.pre-*.json backups, which are never published
  if (bad.length) throw new Error(`Source links with a space in them (fix the address):\n${bad.join('\n')}`);
})();
// The commit this build came from, as <meta name="build"> on every page, so the deploy watch can tell when the live
// site falls behind main (.github/workflows/deploy-watch.yml). Mac deploys pass BUILD_SHA (scripts/pipeline/mac/run.sh).
const BUILD_SHA = process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_SHA || (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } })();
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
  up: { label: 'Build up and fill in', blurb: 'Prefers growth inside today’s town boundary (infill and more density near downtown and transit) rather than spreading onto new land. Some still vote against individual projects.' },
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
  up: 'On growth: build inside the town we have: more homes downtown and near transit.',
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
  growth: { title: 'Growth', icon: '🏗️', ask: 'Build more, faster, or slow down?', lo: 'Slow down, be cautious', hi: 'Build more, faster', q: { q1: -1, q2: 1, q10: 1 } },
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
// More two-line maps people can swipe through on /compare/ and the small compass cards. Each is worked out the
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
    title: 'How should we grow, and pay for it?', ask: 'Build more or slow down? Spend on services or hold taxes down?',
    x: neg(AXES.growth.q), y: neg(CLASSIC.x),
    L: { up: '▲ SPEND MORE ON SERVICES', down: '▼ HOLD TAXES DOWN', left: '◀ BUILD MORE, FASTER', right: 'SLOW DOWN, BE CAUTIOUS ▶' },
    Lm: { up: '▲ SPEND MORE', down: '▼ HOLD TAXES DOWN', left: '◀ BUILD MORE', right: 'SLOW DOWN ▶' },
    xt: 'Growth', xw: ['build more, faster', 'slow down, be cautious'], yt: 'Money', yw: ['hold taxes and spending down', 'spend more on public services'],
    desc: 'Left to right runs from build more, faster to slow down and be cautious. Bottom to top runs from hold taxes and spending down to spend more on public services.',
    explain: '<b>Up–down</b> is money: spend more on housing, shelters, transit, recreation, bike lanes and childcare (up), or hold taxes and spending down (down). <b>Left–right</b> is growth: allow taller buildings and cut red tape for builders (left), or slow the pace of approvals (right).',
  },
  cars: {
    // Both lines reversed, like growpay, so transit / build-more sits top-left.
    title: 'Cars or bikes, and how much growth?', ask: 'Transit and bikes first, or parking and roads first? Build more or slow down?',
    x: neg(AXES.growth.q), y: neg(PARKING_Q),
    L: { up: '▲ TRANSIT &amp; BIKES FIRST', down: '▼ CARS &amp; PARKING FIRST', left: '◀ BUILD MORE, FASTER', right: 'SLOW DOWN, BE CAUTIOUS ▶' },
    Lm: { up: '▲ TRANSIT &amp; BIKES', down: '▼ CARS &amp; PARKING', left: '◀ BUILD MORE', right: 'SLOW DOWN ▶' },
    xt: 'Growth', xw: ['build more, faster', 'slow down, be cautious'], yt: 'Getting around', yw: ['cars and parking first', 'transit and bikes first'],
    desc: 'Left to right runs from build more, faster to slow down and be cautious. Bottom to top runs from cars and parking first to transit and bikes first.',
    explain: '<b>Up–down</b> is how people should get around: paid parking is fair, and spend local money on bike lanes, sidewalks and regional transit (up), or more public parking, parking required in new buildings and free parking for residents (down). <b>Left–right</b> is growth: allow taller buildings and cut red tape for builders (left), or slow the pace of approvals (right).',
  },
  projects: {
    // Same orientation rule as the other maps: more public investment up, build more left.
    title: 'Big projects: invest now or hold off?', ask: 'Borrow and build now, or wait and ask voters first? Build more or slow down?',
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
<p class="deal-update"><b>Update, Sept. 22:</b> council said no, 5–2 (Stoner, Hamilton and Pettingill against; Andersen and French for). The new council could still negotiate a new deal, so where each member stands still matters. <a href="https://www.squamishreporter.com/2026/09/23/squamish-council-rejects-woodfibre-lng-tax-deal/" target="_blank" rel="noopener">Squamish Reporter</a></p>
<p>This is a question about money. It is not a vote for or against the plant, which is already being built, and candidates who support the plant are on both sides of it.</p>
<div class="grid cols-2">
<div><h4>If council says yes</h4><ul>
<li><b>At least $142 million over 10 years</b>, fixed in advance: about $14.2 million a year on average, with the biggest payments in the first five years.</li>
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
const TOPIC_SLUG = { growth: 'growth-and-development', housing_affordability: 'housing', homelessness: 'homelessness', policing: 'policing-and-safety', taxes_spending: 'property-taxes', climate: 'climate-and-environment', environment_lng: 'woodfibre-lng', transportation: 'transit-and-highway-99', parking: 'parking', economy: 'jobs-and-economy', recreation_facilities: 'brennan-park-and-recreation', flood_hazards_climate_resilience: 'flood-protection', other_campaign_topics: 'childcare-rentals-and-vanlife' };
const TOPIC_NAME = { growth: 'growth and development', housing_affordability: 'housing', homelessness: 'homelessness and supportive housing', policing: 'policing and community safety', taxes_spending: 'property taxes and spending', climate: 'climate and the environment', environment_lng: 'the Woodfibre LNG plant', transportation: 'transit and Highway 99', parking: 'parking', economy: 'jobs and the local economy', recreation_facilities: 'Brennan Park and recreation', flood_hazards_climate_resilience: 'flood protection', other_campaign_topics: 'childcare, short-term rentals and vanlife' };
const issueCtx = (key) => (ctx.issues || []).find((i) => i.key === key) || {};

// ---------- layout ----------
// Desktop top bar (layout A, Oct 26): four jobs. Council and Your say open a dropdown; each also has its own hub page.
const NAV_GROUPS = [
  { href: '/council/', label: 'Council', items: [['/council/', 'Your mayor and council'], ['/meetings/', 'Council meetings'], ['/this-week/', 'This week at council'], ['/scorecard/', 'Scorecard: promises and positions'], ['/how-council-works/', 'How council works']] },
  { href: '/your-say/', label: 'Your say', items: [['/wants/', 'What Squamish Wants'], ['/have-your-say/', 'Before council votes'], ['/priorities/', 'Readers’ top issues']] },
  { href: '/meetings/', label: 'Meetings' },
  { href: '/neighbourhoods/', label: 'Neighbourhoods' },
  { href: '/issues/', label: 'Issues' },
  { href: '/news/', label: 'News' },
  { href: '/today/', label: 'Today' },
];
const NAV = [['/council/', 'Council'], ['/your-say/', 'Your say'], ['/wants/', 'What Squamish Wants'], ['/meetings/', 'Meetings'], ['/scorecard/', 'Scorecard'], ['/issues/', 'Issues'], ['/news/', 'News']];
// The Menu lists everything; the top bar only has room for the essentials.
const MENU = [...NAV, ['/have-your-say/', 'Before council votes'], ['/this-week/', 'This week at council'], ['/priorities/', 'Readers’ top issues'], ['/neighbourhoods/', 'Your neighbourhood'], ['/today/', 'Squamish today'], ['/faq/', 'Quick answers'], ['/results/', '2026 election results']];
const ICON = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  gavel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4l6 6M11 7l6 6M12.5 5.5l-6 6 3 3 6-6M8 13l-5 5 3 3 5-5M4 21h9"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11V5a1.5 1.5 0 0 1 3 0v5M12 10V4a1.5 1.5 0 0 1 3 0v6M15 10V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 13a1.5 1.5 0 0 1 2.4-1.8L9 14"/></svg>',
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
// Layout A (Jeff, Oct 26): five tabs with Your say raised in the centre; More opens the full menu.
// Each tab lights up for every page in its group (Meetings, Promises and the rest sit under Council).
const TABS = [['/', 'Home', 'home'], ['/council/', 'Council', 'people'], ['/your-say/', 'Your say', 'hand'], ['/news/', 'News', 'news'], ['#menu', 'More', 'more']];
const TAB_GROUP = {
  '/council/': ['/council/', '/meetings/', '/this-week/', '/scorecard/', '/quiz/', '/compare/', '/results/', '/how-council-works/'],
  '/your-say/': ['/your-say/', '/wants/', '/have-your-say/', '/priorities/', '/welcome/'],
  '/news/': ['/news/'],
};
// The phone Menu: every page, one per row, with How to vote near the top since it left the bottom bar.
const MENU_ICON = {
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  issues: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>',
  about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.1"/></svg>',
};
const MOBILE_MENU = [
  ['/', 'Home', 'home'], ['/wants/', 'What Squamish Wants: say yes or no to local asks', 'hand'], ['/your-say/', 'Your say: everywhere you can weigh in', 'ballot'], ['/council/', 'Your mayor and council', 'people'], ['/neighbourhoods/', 'Your neighbourhood: decisions, building projects, news', 'compass'], ['/have-your-say/', 'Before council votes: vote on what council votes on', 'ballot'], ['/meetings/', 'Council meetings: what’s next and what they decided', 'meet'],
  ['/this-week/', 'This week at council', 'meet'], ['/how-council-works/', 'How council works, and the first 100 days', 'about'], ['/scorecard/', 'Scorecard: their promises and how they vote', 'promise'], ['/issues/', 'Issues: each topic, what’s happening and who stands where', 'issues'], ['/priorities/', 'Readers’ top issues', 'compare'], ['/news/', 'Squamish news', 'news'], ['/today/', 'Squamish today: weather, highway, wind, river', 'sun'], ['/faq/', 'Quick answers', 'about'], ['/results/', '2026 election results', 'vote'],
  ['/about/', 'About this site &amp; sources', 'about'],
];

// Home page: a row of Squamish right now above the hero (weather, highway, tide, wind, river, air, sunset), filled by
// src/today.js. The cells hold their space while loading so the page doesn't jump; the row hides only if the feed fails.
const TODAY_STRIP = `<a class="td-strip no-print" href="/today/" data-today-strip aria-label="Squamish today: weather, highway, tide, wind, river and air. Open the full report."><span class="wrap ts-row"><span class="ts-c" data-k="weather"><span class="ts-i"></span><span class="ts-t"><small>Weather</small><b>…</b></span></span><span class="ts-c" data-k="highway"><span class="ts-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3L5 21M16 3l3 18M12 5v2M12 11v2M12 17v2"/></svg></span><span class="ts-t"><small>Highway 99</small><b>…</b></span></span><span class="ts-c" data-k="tide"><span class="ts-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M12 3v7M9 7l3 3 3-3"/></svg></span><span class="ts-t"><small>Tide</small><b>…</b></span></span><span class="ts-c" data-k="wind"><span class="ts-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/></svg></span><span class="ts-t"><small>Wind at the Spit</small><b>…</b></span></span><span class="ts-c" data-k="river"><span class="ts-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4c4 3 1 6 5 8s1 6 5 8M12 4c4 3 1 6 5 8s1 6 5 8" /></svg></span><span class="ts-t"><small>Squamish River</small><b>…</b></span></span><span class="ts-c" data-k="air"><span class="ts-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21c-4.4 0-8-3.4-8-7.6C4 8.8 12 3 12 3s8 5.8 8 10.4c0 4.2-3.6 7.6-8 7.6z"/></svg></span><span class="ts-t"><small>Air quality</small><b>…</b></span></span><span class="ts-c" data-k="sun"><span class="ts-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 18a5 5 0 0 0-10 0M12 9V3M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M9 6l3-3 3 3"/></svg></span><span class="ts-t"><small>Sunset</small><b>…</b></span></span><span class="ts-go">Full report<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span></span><span class="ts-hint" aria-hidden="true">›</span></a><script src="/today.js" defer></script>`;

// Search results cut a description at about 160 characters; end it on a whole word instead of mid word.
const clip = (s, n) => (!s || s.length <= n ? s : `${s.slice(0, n - 1).replace(/[\s,;:]+\S*$/, '')}…`);
// updated: the date this page's own content last changed (from its data), shown in the footer instead of the build date.
function page({ url, title, desc, body, hero = '', scripts = '', noindex = false, jsonld = null, image = null, imageAlt = null, updated = null }) {
  // Review item 21: the pages search sends people to end with the weekly email sign up, unless they have one already.
  if (SIGNUP_ON.some((u) => url.startsWith(u)) && !body.includes('id="signup"')) body += signupBox(url.split('/')[1] || 'home');
  const img = image || 'https://squamishvoters.com/og.png?v=4';
  const cur = (href) => ((href === '/' ? url === '/' : url.startsWith(href)) ? ' aria-current="page"' : '');
  const inGroup = (g) => [g.href, ...g.items.map(([h]) => h)].some((h) => url.startsWith(h));
  const full = title ? (title.length > 52 ? title : `${title} | ${SITE.name}`) : 'Squamish Voters: what Squamish council is deciding, how each member votes, and whether they keep their promises';
  desc = clip(desc, 158);
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
<meta property="og:image:alt" content="${esc(imageAlt || 'Squamish Voters: an independent, plain-language guide to Squamish council')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${img}">
<link rel="canonical" href="https://squamishvoters.com__PATH__">
<meta name="theme-color" content="#0f4c3a">${BUILD_SHA ? `\n<meta name="build" content="${BUILD_SHA}">` : ''}${noindex ? '\n<meta name="robots" content="noindex, nofollow">' : ''}${jsonld ? `\n<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
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
    <a class="logo" href="/" aria-label="${SITE.name}, home">
      <svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#ffb703"/><path d="M5 30 L15 12 L21 22 L26 15 L35 30 Z" fill="#0f4c3a"/><path d="M12.5 25l3.5 3.5 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Squamish Voters<small>Stay up to date, easily</small></span>
    </a>
    <nav class="top-nav" aria-label="Main">
      ${NAV_GROUPS.map((g) => g.href === '/news/' ? `<a class="nav-news" href="${g.href}"${cur(g.href)}>${ICON.news}<span>${g.label}</span></a>`
        : g.items ? `<div class="nav-dd"><a href="${g.href}"${inGroup(g) ? ' aria-current="page"' : ''}>${g.label}</a><button type="button" class="nav-dd-btn" aria-expanded="false" aria-label="More ${g.label.toLowerCase()} pages"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="nav-dd-panel">${g.items.map(([h, l]) => `<a href="${h}"${url === h ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</div></div>`
        : `<a href="${g.href}"${cur(g.href)}>${g.label}</a>`).join('')}
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
    <div><h2>${SITE.name}</h2><p>An independent, non-partisan guide to Squamish council made by <a href="/about/#who">Jeff Kirdeikis</a>, a Squamish resident. Not affiliated with the District of Squamish, any council member, or any party.</p>${updated ? `<p>This page last changed ${esc(fmtLong(updated))}.</p>` : ''}<p data-visits hidden><b>0</b> page views so far.</p></div>
    <div><h2>Pages</h2><ul>${[['/', 'Home'], ...MENU, ['/data/', 'Data downloads'], ['/about/', 'About and method'], ['/corrections/', 'Corrections']].map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ul></div>
    <div><h2>Official information</h2><ul><li><a href="https://squamish.ca/government-and-administration/council/" target="_blank" rel="noopener">District of Squamish: council</a></li><li><a href="https://squamish.civicweb.net/Portal/MeetingSchedule.aspx" target="_blank" rel="noopener">Official agendas and minutes</a></li><li><a href="https://www.youtube.com/@DistrictofSquamish/streams" target="_blank" rel="noopener">Meeting videos (YouTube)</a></li><li><a href="https://www.facebook.com/groups/1090076830319905" target="_blank" rel="noopener">Squamish Voters &amp; Politics on Facebook</a></li></ul>
    </div>
    <div><h2>Spot a mistake?</h2><p>Are you on council, or did we get something wrong? Email <a href="mailto:${SITE.contact}">${SITE.contact}</a> and we’ll fix it.</p></div>
  </div>
</div></footer>
<nav class="tabbar" aria-label="Quick navigation">
  ${TABS.map(([h, l, i]) => h === '#menu' ? `<button type="button" class="tab-more" data-menu-open aria-controls="menu-panel" aria-expanded="false">${MENU_ICON.more}<span>${l}</span></button>`
    : `<a href="${h}"${(TAB_GROUP[h] || [h]).some((x) => (x === '/' ? url === '/' : url.startsWith(x))) ? ' aria-current="page"' : ''}${i === 'hand' ? ' class="tab-feature"' : ''}>${ICON[i] || MENU_ICON[i]}<span>${l}</span></a>`).join('')}
</nav>
<a class="totop no-print" href="#main" id="totop" hidden>↑ Top</a>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="/site.js"></script>
${scripts}${noindex ? '' : '\n<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)}</script><script defer src="/_vercel/insights/script.js"></script>'}
</body></html>`;
}

const SITEMAP = []; // every indexable page, built into sitemap.xml at the end
const LASTMOD = {}; // pages whose structured data carries a real date use it as the sitemap lastmod
const LLM = {}; // bits built inside page blocks that llms.txt also needs
// Our own scripts and the stylesheet are linked with a short fingerprint of their contents (/wants.js?v=1a2b3c4d), so
// browsers fetch the new copy as soon as it changes instead of running one they kept from an earlier visit.
const ASSET_V = {};
// Vercel BotID's page script, from node_modules: it patches fetch so posts to the answer API carry proof a real browser
// sent them (api/wants.js turns away the rest). Turned into a plain script that starts itself; served as /botid.js.
const BOTID_JS = fs.readFileSync(path.join(ROOT, 'node_modules', 'botid', 'dist', 'client', 'core', 'index.mjs'), 'utf8')
  .replace(/export\{(\w+) as initBotId[^}]*\};?\s*$/, (m, fn) => `${fn}({protect:[{path:'/api/wants/',method:'POST'},{path:'/api/wants',method:'POST'}]});`);
if (/\bexport\{/.test(BOTID_JS)) throw new Error('botid client changed shape; check the export line');
ASSET_V['botid.js'] = crypto.createHash('sha1').update(BOTID_JS).digest('hex').slice(0, 8);
const assetV = (f) => (ASSET_V[f] ||= (fs.existsSync(path.join(ROOT, 'src', f)) ? crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'src', f))).digest('hex').slice(0, 8) : ''));
const versioned = (html) => html.replace(/(src|href)="\/([a-z]+\.(?:js|css))"/g, (m, attr, f) => (assetV(f) ? `${attr}="/${f}?v=${assetV(f)}"` : m));
function write(url, html) {
  html = versioned(html);
  if (!/name="robots" content="noindex/.test(html) && url !== '/404/') SITEMAP.push(url);
  const dated = html.match(/"dateModified":"(\d{4}-\d\d-\d\d)/) || html.match(/"datePublished":"(\d{4}-\d\d-\d\d)/);
  if (dated) LASTMOD[url] = dated[1];
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
  cow: { label: 'Council workshop (no final votes)', official: 'Committee of the Whole', cls: 'mt-cow', plain: 'All of council talks an issue through. Nothing is decided here: ideas only count once council confirms them at a later council meeting.' },
  hearing: { label: 'Public hearing', cls: 'mt-hearing', plain: 'Residents can speak to council about a rezoning or bylaw before council decides. Held as part of a council meeting.' },
  special: { label: 'Special meeting', cls: 'mt-special', plain: 'A meeting called outside the regular schedule, with at least 24 hours’ notice. Squamish holds many of these, and some include big decisions, such as budget workshops. Others open only to move behind closed doors.' },
  inaugural: { label: 'Swearing in meeting', cls: 'mt-special', plain: 'The new mayor and councillors take their oath of office.' },
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
// A promise's label is worked out from ALL its evidence every build (scripts/pipeline/status.mjs): only the member's own
// vote counts, and only votes checked against the official minutes can make it red; a vote heard on the video is an
// "Early sign" at most.
for (const p of PROMISES) { p.tally = promiseTally(p, MEETINGS); p.status = p.tally.status; }
const PSTATUS = {
  kept: { label: 'Kept', cls: 'ps-kept', icon: '✓' },
  not_kept: { label: 'Not kept', cls: 'ps-broken', icon: '✕' },
  mixed: { label: 'Mixed', cls: 'ps-progress', icon: '~' },
  early: { label: 'Early sign', cls: 'ps-early', icon: '…' },
  progress: { label: 'In progress', cls: 'ps-progress', icon: '…' },
  not_yet: { label: 'Not tested yet', cls: 'ps-notyet', icon: '○' },
};
const pStatus = (p) => PSTATUS[p.status === 'broken' ? 'not_kept' : p.status] || PSTATUS.not_yet;
const promisesOf = (c) => PROMISES.filter((p) => p.slug === c.slug);
const pKey = (p) => (p.status === 'broken' ? 'not_kept' : PSTATUS[p.status] ? p.status : 'not_yet');
const pCounts = (list) => Object.fromEntries(Object.keys(PSTATUS).map((k) => [k, list.filter((p) => pKey(p) === k).length]));
// Promises that also need someone other than council (the Province, BC Transit, the RCMP, Woodfibre, the Squamish Nation).
const whoBadge = (p) => p.who_decides && p.who_decides !== 'Council' ? `<span class="whob">Who decides: ${esc(p.who_decides)}</span>` : '';
const pBadge = (p) => { const t = p.tally && tallyText(p.tally); return `<span class="pstatus ${pStatus(p).cls}"><span aria-hidden="true">${pStatus(p).icon}</span> ${pStatus(p).label}${t ? ` <span class="ptally">(${esc(t)})</span>` : ''}</span>`; };
function promiseRow(p, { who = false } = {}) {
  const c = bySlug[p.slug];
  const ev = (p.evidence || []);
  const f = c ? esc(first(c)) : 'they';
  const outcomes = ev.filter((e) => e.outcome);
  return `<details class="promise" id="p-${esc(p.id)}"><summary>${pBadge(p)}<span class="ptxt">${who && c ? `<b class="pwho">${esc(c.name)}:</b> ` : ''}${esc(p.promise)}${whoBadge(p)}</span></summary>
  <div class="pbody">
    <p class="small"><b>What ${c ? esc(first(c)) : 'they'} said:</b></p><blockquote>“${esc(p.quote)}”</blockquote>${src(p.source_url)}
    <p class="small"><b>${f}’s part (the only thing we mark):</b> ${esc(p.their_part || '')}</p>
    <p class="small"><b>Did it happen?</b> ${outcomes.length ? esc(outcomes[outcomes.length - 1].outcome) : `Not yet. We’re watching ${esc((p.did_it_happen || '').replace(/^./, (x) => x.toLowerCase()))}`} <span class="muted">This is a plain fact, never a mark against ${f}: council decides as a group.</span></p>
    <p class="small"><b>Who decides:</b> ${esc(p.who_decides || 'Council')}</p>${p.note ? `<p class="small muted">${esc(p.note)}</p>` : ''}
    ${ev.length ? `<p class="small"><b>What has happened so far:</b></p><ul class="small">${ev.map((e) => { const m = MEETINGS.find((x) => x.id === e.meeting); return `<li>${m ? `<a href="${mUrl(m)}">${esc(fmtLong(m.date))}</a>: ` : ''}${esc(e.note)}${(() => { const d = m && Number.isInteger(e.decision) ? (m.decisions || [])[e.decision] : null; return d && !confirmedByMinutes(d) ? ' <span class="muted">(from the meeting video; waiting for the official minutes)</span>' : ''; })()}</li>`; }).join('')}</ul>` : '<p class="small muted">Council hasn’t voted on anything that tests this yet.</p>'}
    ${p.updated ? `<p class="small muted">Marked automatically by an AI model on ${esc(fmtLong(p.updated))} from council votes. <a href="/scorecard/#how">How we judge promises</a>.</p>` : ''}
  </div></details>`;
}
function voteChips(d) {
  const groups = ['yes', 'no', 'recused', 'absent', 'unknown'].map((k) => [k, all.filter((c) => d.votes?.[c.slug] === k)]).filter(([, l]) => l.length);
  const how = (d.votes_source === 'minutes' ? 'Checked against the official minutes.' : 'From the meeting video. We check it against the official minutes when they come out, usually a few weeks later.') + ' Under B.C. law, a member who is in the room and does not vote is counted as voting yes (Community Charter section 123(4)).';
  return `<div class="vchips">${groups.map(([k, l]) => `<div class="vgroup v-${k}"><span class="vlab">${{ yes: '✓ Yes', no: '✕ No', recused: 'Stepped out', absent: 'Not there', unknown: 'Not clear' }[k]}</span>${l.map((c) => `<a href="/council/${c.slug}/" class="vface">${avatar(c, 'xs')}${esc(lastName(c))}</a>`).join('')}</div>`).join('')}<p class="small muted">${how}</p></div>`;
}
// What the official minutes changed from our video based record (scripts/pipeline/minutes.mjs keeps corrected_from).
function corrections(d) {
  const was = d.corrected_from; if (!was) return [];
  const out = [];
  if (was.result !== d.result) out.push(`${RESULT_WORD[was.result] || was.result || 'Not recorded'} to ${RESULT_WORD[d.result] || d.result}`);
  for (const c of all) { const a = was.votes?.[c.slug], b = d.votes?.[c.slug]; if (a !== b && (a || b)) out.push(`${lastName(c)}: ${VOTE_WORD[a] || 'not recorded'} to ${VOTE_WORD[b] || 'not recorded'}`); }
  return out;
}
const corrNote = (d) => (corrections(d).length ? `<p class="corr"><b>Corrected after official minutes${d.corrected_on ? ` (${esc(fmtLong(d.corrected_on))})` : ''}:</b> ${corrections(d).map(esc).join('; ')}. <a href="/corrections/">All corrections</a></p>` : '');
const isoDay = (x) => (typeof x === 'string' && /^\d{4}-\d\d-\d\d/.test(x) ? x.slice(0, 10) : '');
// A bylaw reading is a step, not the final say: "First reading passed" reads right, "Passed" does not.
const READING_RX = /\b((?:first|second|third)(?:(?:,|,? and) (?:first|second|third))*) readings?\b|\b(adopt(?:ion|ed)?)\b/i;
function resultWord(d) {
  const base = RESULT_WORD[d.result] || 'Decided';
  if (d.result !== 'passed' && d.result !== 'failed') return base;
  const st = d.stage || ((d.title || '').match(READING_RX) || [])[1];
  if (!st || /adopt/i.test(st)) return base;
  const s = st.toLowerCase().replace(/ readings?$/, '');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} reading${/,| and /.test(s) ? 's' : ''} ${d.result}`;
}
// "All agreed" only counts the members who were there; away and stepped out members are named as such.
function tallyWord(d) {
  const vs = Object.values(d.votes || {}), n = (k) => vs.filter((v) => v === k).length;
  const yes = n('yes'), no = n('no'), away = n('absent'), out = n('recused');
  const extra = [away ? `${away} away` : '', out ? `${out} stepped out` : ''].filter(Boolean).join(', ');
  return no === 0 && yes > 1 ? `All ${yes} there agreed${extra ? ` (${extra})` : ''}` : `${yes} to ${no}${extra ? ` (${extra})` : ''}`;
}
function decisionCard(d, m, { open = false } = {}) {
  return `<details class="decision r-${esc(d.result || 'info')}"${open ? ' open' : ''}><summary><span class="dres">${esc(resultWord(d))}${d.result === 'passed' || d.result === 'failed' ? ` <span class="small">${esc(tallyWord(d))}</span>` : ''}</span><span class="dtitle">${esc(d.title)}</span></summary>
  <div class="dbody">${d.for_you ? `<p class="foryou"><b>What it means for you:</b> ${escGl(d.for_you)}</p>` : ''}<p>${escGl(d.what)}</p>${d.votes ? voteChips(d) : ''}${corrNote(d)}
  ${areaTags(d.areas)}${(d.issues || []).map((sl) => TRACKED.find((t) => t.slug === sl)).filter(Boolean).map((t) => `<p class="small">Part of: <a href="/track/${t.slug}/">${esc(t.title)}</a></p>`).join('')}
  ${d.why_it_matters ? `<p class="small"><b>Why it matters:</b> ${escGl(d.why_it_matters)}</p>` : ''}
  ${isUrl(d.video_url) ? `<p class="small"><a href="${esc(d.video_url)}" target="_blank" rel="noopener">▶ Watch this part of the meeting</a></p>` : ''}</div></details>`;
}
function meetingRow(m) {
  const done = !!m.summary;
  // A calendar chip shows the date (not an empty square that looks like a box to tick); the line beside it keeps the weekday.
  const x = new Date(m.date + 'T12:00:00'), yr = m.date.slice(0, 4) !== TODAY.slice(0, 4) ? `, ${m.date.slice(0, 4)}` : '';
  return `<li class="mrow ${mType(m).cls}${done ? ' done' : ''}"><a href="${mUrl(m)}"><span class="mcal" aria-hidden="true"><span>${x.toLocaleDateString('en-CA', { month: 'short' }).replace('.', '')}</span><b>${x.getDate()}</b></span>
  <span class="mtxt"><span class="mwhen"><span class="visually-hidden">${esc(fmtDay(m.date))}</span><b aria-hidden="true">${esc(x.toLocaleDateString('en-CA', { weekday: 'long' }))}${yr}</b>${m.time ? ` · ${esc(fmtTime(m.time))}` : ''}</span><span class="mtags">${mBadge(m)}${m.has_public_hearing ? `<span class="mtype ${MTYPE.hearing.cls}">Includes a public hearing</span>` : ''}${m.closed_only ? '<span class="mtype mt-special">Mostly behind closed doors</span>' : ''}</span>
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
    return [{ d, inLine: pos.kind === 'quiz' ? Math.sign(dir) === Math.sign(pos.said) : dir > 0, confirmed: confirmedByMinutes(d) }];
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
  ${promises ? line('Promises', [[pc.kept, 'ps-kept', 'kept'], [pc.not_kept, 'ps-broken', 'not kept'], [pc.mixed, 'ps-progress', 'mixed'], [pc.progress, 'ps-progress', 'in progress'], [pc.early, 'ps-early', 'early sign']], ps.length, pc.not_yet) : ''}
  ${positions ? line('Positions', [[pr.inLine, 'ps-kept', 'voted the way they said'], [pr.against, 'ps-broken', 'voted against'], [pr.mixed, 'ps-progress', 'mixed'], [pr.early, 'ps-early', 'early sign']], pr.rows.length, pr.untested) : ''}</span></a>`;
}
const noVotesNote = () => ANY_VOTES ? '' : `<div class="notice info"><b>No votes yet.</b> The new council is sworn in on November 3${FIRST_VOTES ? ` and its first regular meeting is ${esc(fmtLong(FIRST_VOTES))}` : ''}. Every vote after that is checked here automatically, and nothing is marked red until the official minutes confirm the vote.</div>`;
// Red ("voted against") needs 2 or more votes confirmed by the official minutes (scripts/pipeline/status.mjs).
const posStatus = (checks) => positionStatus(checks);
const POS_STATUS = { in_line: ['✓', 'Voted the way they said', 'ps-kept'], against: ['✕', 'Voted against what they said', 'ps-broken'], mixed: ['~', 'Mixed', 'ps-progress'], early: ['…', 'Early sign', 'ps-early'], untested: ['○', 'Not tested yet', 'ps-notyet'] };
const posBadge = (st) => `<span class="pstatus ${POS_STATUS[st][2]}"><span aria-hidden="true">${POS_STATUS[st][0]}</span> ${POS_STATUS[st][1]}</span>`;
function positionReport(c) {
  const rows = positionsOf(c).map((p) => { const ch = checksFor(c, p); return { p, ch, st: posStatus(ch) }; });
  const count = (k) => rows.filter((r) => r.st === k).length;
  return { rows, tested: rows.filter((r) => r.st !== 'untested'), inLine: count('in_line'), against: count('against'), mixed: count('mixed'), early: count('early'), untested: count('untested') };
}
const posRow = (c, r) => `<details class="promise"><summary>${posBadge(r.st)}<span class="ptxt">${esc(r.p.label)}</span></summary><div class="pbody">
  ${r.ch.length ? `<ul class="small">${r.ch.map((x) => `<li>${x.inLine ? '✓' : '✕'} ${esc(VOTE_WORD[x.d.votes[c.slug]])} on <a href="${mUrl(x.d.m)}">${escGl(x.d.title)}</a> (${esc(fmtLong(x.d.m.date))})</li>`).join('')}</ul>` : '<p class="small muted">Council hasn’t voted on anything that tests this yet.</p>'}
  ${isUrl(r.p.src) || r.p.src?.startsWith('/') ? `<p class="small"><a href="${esc(r.p.src)}">Where they said it</a></p>` : ''}</div></details>`;
function profileRecord(c) {
  const f = esc(first(c)), ps = promisesOf(c), pc = pCounts(ps), vs = votesOf(c), pr = positionReport(c);
  const next = upcoming[0];
  const pSum = ps.length ? [[pc.kept, 'kept'], [pc.not_kept, 'not kept'], [pc.mixed, 'mixed'], [pc.early, 'early sign'], [pc.progress, 'in progress'], [pc.not_yet, 'not tested yet']].filter(([n], i) => n || i < 2).map(([n, w]) => `${n} ${w}`).join(' · ') : '';
  if (!ANY_VOTES) return `<section class="card record" id="record"><h2>${f}’s record on council</h2>
  <p>Council hasn’t voted yet. We’re tracking <a href="#promises"><b>${ps.length} promises</b></a> and <a href="#said-did"><b>${pr.rows.length} positions</b></a> ${f} took during the campaign.${next ? ` First meeting: <a href="${mUrl(next)}">${esc(fmtLong(next.date))}</a>.` : ''}</p></section>
  ${ps.length ? `<h2 id="promises">${f}’s promises <span class="small">${ps.length}</span></h2>
  <p class="small">What ${f} promised during the campaign, in plain words. Tap one for the exact quote and source.</p>
  <div class="card stack">${ps.map((p) => promiseRow(p)).join('')}</div>` : ''}
  <h2 id="said-did">Do ${f}’s votes match what they said in the campaign?</h2>
  <p class="small">${pr.rows.length} things ${f} said during the campaign. Each gets a mark once a council vote tests it.</p>
  <details class="drop"><summary>See all ${pr.rows.length} positions</summary><div class="stack">${pr.rows.map((r) => posRow(c, r)).join('')}</div></details>`;
  return `<section class="card record" id="record"><h2>${f}’s record on council</h2>
  <div class="statrow"><div><b>${ps.length}</b><span>campaign promises we track</span></div><div><b>${vs.filter((d) => ['yes', 'no'].includes(d.votes[c.slug])).length}</b><span>votes cast so far</span></div><div><b>${pc.kept} / ${pc.not_kept}</b><span>promises kept / not kept</span></div><div><b>${pr.inLine} / ${pr.against}</b><span>positions voted in line / against</span></div></div>
  ${vs.length ? '' : `<p class="small">${TODAY < '2026-11-03' ? 'The new council is sworn in on November 3, 2026.' : 'This council was sworn in on November 3, 2026.'} ${next && next.date !== '2026-11-03' ? `The next meeting is <a href="${mUrl(next)}">${esc(fmtDay(next.date))}</a>.` : ''} Votes will appear here after each meeting.</p>`}</section>
  ${ps.length ? `<h2 id="promises">${f}’s promises <span class="small">${pSum}</span></h2>
  <p class="small">What ${f} promised during the campaign, in plain words, with the exact quote and source. Tap any promise to see the details.</p>
  <div class="card stack">${ps.map((p) => promiseRow(p)).join('')}</div>` : ''}
  ${vs.length ? `<h2 id="votes">How ${f} has voted</h2>
  <div class="card stack">${vs.slice(0, 8).map((d) => `<div class="vrow"><span class="vme v-${d.votes[c.slug]}">${esc(VOTE_WORD[d.votes[c.slug]] || d.votes[c.slug])}</span><span><a href="${mUrl(d.m)}">${escGl(d.title)}</a><span class="small"> · ${esc(fmtLong(d.m.date))} · ${esc(RESULT_WORD[d.result] || '')}</span></span></div>`).join('')}</div>
  ${vs.length > 8 ? `<details class="drop"><summary>All ${vs.length} votes</summary>${vs.slice(8).map((d) => `<div class="vrow"><span class="vme v-${d.votes[c.slug]}">${esc(VOTE_WORD[d.votes[c.slug]] || d.votes[c.slug])}</span><span><a href="${mUrl(d.m)}">${escGl(d.title)}</a><span class="small"> · ${esc(fmtLong(d.m.date))}</span></span></div>`).join('')}</details>` : ''}` : ''}
  <h2 id="said-did">Do ${f}’s votes match what they said in the campaign?</h2>
  <p class="small">Everything ${f} said they stand for during the campaign (${pr.rows.length} positions), checked against every council vote that tests it.</p>
  <div class="pstats">${['in_line', 'against', 'mixed', 'early', 'untested'].map((k) => `<span class="pstatus ${POS_STATUS[k][2]}"><span aria-hidden="true">${POS_STATUS[k][0]}</span> ${pr[{ in_line: 'inLine', against: 'against', mixed: 'mixed', early: 'early', untested: 'untested' }[k]]} ${esc(POS_STATUS[k][1].toLowerCase())}</span>`).join('')}</div>
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
  const mark = (c) => { const pos = positionsOf(c).find((p) => p.kind === 'quiz' && p.q.id === q.id); if (!pos) return ''; const st = posStatus(checksFor(c, pos)); return st === 'untested' ? '' : `<span class="vmark ${POS_STATUS[st][2]}">${st === 'in_line' ? '✓ voted that way' : st === 'against' ? '✕ voted against' : st === 'early' ? '… early sign' : '~ mixed'}</span>`; };
  const t = DECISIONS.filter((d) => (d.related_q || []).some((r) => r.q === q.id));
  return `<div class="card qcard"><p class="qtext">“${escGl(q.text)}”</p>
    <ul class="qwho">${people.map((c) => `<li><a href="/council/${c.slug}/#said-did">${cell(c.quiz_answers?.[q.id])}<span class="qname">${esc(lastName(c))}</span>${mark(c)}</a></li>`).join('')}</ul>
    ${t.length ? `<p class="small">Tested by: ${t.map((d) => `<a href="${mUrl(d.m)}">${escGl(d.title)}</a>`).join(', ')}</p>` : ''}</div>`;
}
const FB_CARD = '<a class="fbcard" href="https://www.facebook.com/groups/1090076830319905" target="_blank" rel="noopener"><img src="/img/facebook-group.jpg" width="400" height="149" alt="Squamish Voters and Politics Facebook group" loading="lazy"><span class="fbc-txt"><b>Join the conversation on Facebook</b><span>Talk about council decisions with other people in Squamish in the Squamish Voters and Politics group.</span><span class="fbc-btn">Join the group</span></span></a>';
// Small copy of a news picture (scripts/news-thumbs.mjs makes them), else the full size one.
const newsThumb = (src, w) => { const m = String(src || '').match(/^\/news\/(photos|og|img)\/([^/?]+?)\.(?:jpe?g|png)$/i); const t = m && `/news/thumbs/${w}/${m[1]}-${m[2]}.jpg`; return t && fs.existsSync(path.join(ROOT, 'public', t)) ? t : src; };
const SIGNUP_ON = ['/council/', '/results/', '/scorecard/', '/issues/', '/faq/', '/meetings/', '/explained/', '/compare/'];
// Share pictures drawn at the end of the build (scripts/og-cards.mjs), one per council member and per upcoming meeting,
// so a shared link shows that person or meeting instead of the general site picture (review item 22).
const CARDS = [];
const shareCard = (card) => { CARDS.push(card); return `${ORIGIN}/${card.file}?v=${crypto.createHash('sha1').update(JSON.stringify(card)).digest('hex').slice(0, 8)}`; };
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
  // The swearing in meeting is ceremonial: no question period, no delegations, and no letters on its agenda.
  if (m && m.type === 'inaugural') return `<section class="card havesay"><h2>Have your say</h2>
    <p>The swearing in meeting is ceremonial. There is no question period and no letters on the agenda. To raise something with the new council, write to <a href="mailto:council@squamish.ca">council@squamish.ca</a> after November 3. Letters sent before then go to the outgoing council.</p>
    <p><b>Watch.</b> Live and afterward on the <a href="https://www.youtube.com/@DistrictofSquamish/streams" target="_blank" rel="noopener">District’s YouTube channel</a>.</p></section>`;
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
  ['homelessness', 'Squamish’s sharpest argument: what would you actually do about encampments, Under One Roof and street disorder, and what would it cost?'],
  ['differently', 'One council decision from the last four years you’d have made differently, and what you’d have done.'],
  ['disagree', 'What would you say to a resident on the other side of your biggest issue?'],
  ['corrections', 'Is anything on your profile wrong, out of date or missing? Tell us and we’ll fix it.'],
  ['pitch', 'Your one line pitch (we may use this as your tagline on the site).'],
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
  if (c.direct.kind === 'email') return `<div class="notice direct"><b>✓ New: ${f} answered us by email.</b> On ${when}, ${f} sent Squamish Voters written answers about ${esc(c.direct.topic)}. They are published in full, word for word. <a href="#emailed">Read ${f}’s answers</a>.</div>`;
  return isDirectQ(c)
    ? `<div class="notice direct"><b>✓ Verified: in ${f}’s own words.</b> ${f} filled in our candidate questionnaire on ${when}. ${c.direct.checked ? esc(c.direct.checked) : `It was sent from the email address ${f} filed with the District of Squamish.`} ${(c.direct.answered || [1]).length ? `Everything marked <span class="badge direct">✓ Direct answer</span> below is ${f}’s own answer, not our reading of the public record. <a href="#questionnaire">Jump to all answers</a>.` : `${f} answered the written questions but skipped the agree/disagree statements, so the quiz still has no answers from ${f}. <a href="#own-words">Read ${f}’s written answers</a> · <a href="#questionnaire">see the statements not yet answered</a>.`}${stmtOf(c) ? ` ${f} also sent us a platform statement on ${esc(fmtLong(stmtOf(c).date))}: <a href="${esc(stmtOf(c).url)}">read it in full</a>.` : ''}</div>`
    : `<div class="notice direct"><b>✓ New: sent to us by ${f}.</b> ${f} sent Squamish Voters a platform statement on ${when}. The supports, against list and topics below now come from it. ${/\.pdf$/i.test(c.direct.url) ? `<a href="${esc(c.direct.url)}" target="_blank" rel="noopener">Read the original (PDF)</a>` : `<a href="${esc(c.direct.url)}">Read it in full, in ${f}’s own words →</a>`}.</div>`;
}
// Written answers a candidate emailed us: published whole, never trimmed or reworded.
function emailedAnswers(c) {
  if (!(c.emailed || []).length) return '';
  const para = (t) => t.split(/\n\n+/).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  return `<h2 id="emailed">${esc(first(c))}’s emailed answers <span class="badge direct">✓ Own words</span></h2>
  <p class="small">Sent to Squamish Voters on ${esc(fmtLong(c.direct.date))}. Published in full and unedited.</p>
  <div class="card stack">${c.emailed.map((x, n) => `<details class="stance-row has-more"${n === 0 ? ' open' : ''}><summary><span class="txt"><b>${esc(x.q)}</b>${moreBtn(`Tap to read ${esc(first(c))}’s full answer`)}</span></summary><blockquote class="long">${para(x.a)}</blockquote>${x.note ? `<p class="small ednote">${esc(x.note)}</p>` : ''}</details>`).join('')}</div>`;
}
function directAnswers(c) {
  if (!isDirectQ(c)) {
    // Researched (not candidate-supplied) scores on the non-quiz statements.
    const rows = EXTRA_QUESTIONS.filter((q) => typeof c.quiz_answers?.[q.id] === 'number');
    return rows.length ? `<details class="drop"><summary>More of ${esc(first(c))}’s positions (${rows.length})</summary>
    <ul class="qa">${rows.map((q) => `<li><b>${escGl(q.text)}</b><span class="ans">${ANSWER_WORD[String(c.quiz_answers[q.id])]}</span></li>`).join('')}</ul>
    <p class="small">Our reading of ${esc(first(c))}’s public statements and votes. ${esc(first(c))} has not answered our questionnaire.</p></details>` : '';
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
  <div class="card stack">${words.map(([k, label]) => `<details class="stance-row has-more"${k === 'pitch' || k === 'one_thing' ? ' open' : ''}><summary><span class="txt"><b>${esc(label.replace(/ \(we may use.*$/, ''))}</b>${moreBtn(`Tap to read ${esc(first(c))}’s full answer`)}</span></summary><blockquote>${escGl(c.own_words[k])}</blockquote></details>`).join('')}</div>` : ''}
  ${noted.length ? `<h2 id="explained">${esc(first(c))} explains ${noted.length === 1 ? 'an answer' : 'their answers'} <span class="badge direct">✓ Direct</span></h2>
  <p class="small">${esc(first(c))} added a comment to ${noted.length} of the statements we put to every candidate. These are ${esc(first(c))}’s words, unedited.</p>
  <div class="card"><ul class="qa">${noted.slice(0, SHOW).map(noteLi).join('')}</ul>
  ${noted.length > SHOW ? `<details class="more"><summary>Show ${noted.length - SHOW} more</summary><ul class="qa">${noted.slice(SHOW).map(noteLi).join('')}</ul></details>` : ''}</div>` : ''}
  ${rows.length ? `<p class="small">${esc(first(c))} answered ${rows.length === ALL_QUESTIONS.length ? `all ${rows.length}` : `${rows.length} of the ${ALL_QUESTIONS.length}`} statements we put to every candidate.${noted.length ? ' The answers with comments are above.' : ''} Tap below for the full list.</p>
  <details class="drop" id="questionnaire"><summary>All ${rows.length} of ${esc(first(c))}’s questionnaire answers <span class="badge direct">✓ Direct</span></summary>
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
  return `<details class="stance-row${none && !mine ? ' none' : ' has-more'}"><summary><span class="ic" aria-hidden="true">${i.icon}</span><span class="txt"><b>${i.title}</b><span class="pos">${none ? (mine ? 'Answered our questionnaire' : 'Hasn’t said') : esc(s.position)}</span>${mine ? '<span class="badge direct">✓ Own answers inside</span>' : ''}${none && !mine ? '' : moreBtn(`Tap to read more about ${esc(first(c))}’s view on this`)}</span></summary>
  ${none ? (mine ? '' : `<p class="muted">We could not find anything ${esc(first(c))} has said publicly about this.</p>`) : `<p>${escGl(s.summary)}${src(s.source_url)}</p>${s.quote ? `<blockquote>“${escGl(s.quote.replace(/^["“]|["”]$/g, ''))}”</blockquote>${src(s.quote_source_url, 'quote source')}` : ''}${confLabel[s.confidence] ? `<p class="conf">${confLabel[s.confidence]}</p>` : ''}`}${mine}</details>`;
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
  // The date this member's page content last changed: a promise update, a vote, a correction, or their own statement.
  const updated = [...promisesOf(c).map((p) => isoDay(p.updated)), ...votesOf(c).map((d) => isoDay(d.corrected_on) || d.m.date), isoDay(c.direct?.date), isoDay(c.statement?.date), corrDate(`/council/${c.slug}/`)].filter((x) => x && x <= TODAY).sort().pop() || null;
  const memberCard = (() => { const ps = promisesOf(c), k = pCounts(ps); return shareCard({ file: `share/cards/council-${c.slug}.png`, kicker: c.office === 'mayor' ? 'MAYOR OF SQUAMISH' : 'SQUAMISH COUNCILLOR', title: c.name, sub: 'Votes, promises and what they said', photo: hasPhoto(c) ? c.photo : null, stats: [[ps.length, 'promises tracked'], ...(ps.length - (k.not_yet || 0) > 0 ? [[k.kept || 0, 'kept so far']] : []), [castVotes(c).length, 'votes recorded']], foot: 'Council decides as a group. We track each member’s part.' }); })();
  write(`/council/${c.slug}/`, page({ updated, image: memberCard, imageAlt: `${c.name}, ${c.office === 'mayor' ? 'Mayor of Squamish' : 'Squamish councillor'}`,
    url: '/council/', title: `${c.name}, ${c.office === 'mayor' ? 'Mayor of Squamish' : 'Squamish councillor'}: votes, promises and positions`,
    desc: raceRow(c) ? `${c.name} was elected ${c.office === 'mayor' ? 'mayor of Squamish' : 'to Squamish council'} on October 17, 2026 with ${Number(raceRow(c).total).toLocaleString('en-CA')} votes. How ${first(c)} votes, which promises they kept, and every campaign answer.` : `How ${c.name} votes on Squamish council, which campaign promises they have kept, and every answer they gave during the 2026 election, with sources.`,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'Person', name: c.name,
      url: `${ORIGIN}/council/${c.slug}/`,
      description: `${c.office === 'mayor' ? 'Mayor' : 'Councillor'}, District of Squamish, elected October 17, 2026.${c.tagline ? ' ' + c.tagline : ''}`,
      ...(hasPhoto(c) ? { image: `${ORIGIN}/${c.photo}` } : {}),
      jobTitle: c.office === 'mayor' ? 'Mayor, District of Squamish' : 'Councillor, District of Squamish',
      worksFor: { '@type': 'GovernmentOrganization', name: 'District of Squamish', url: 'https://squamish.ca/' },
      homeLocation: { '@type': 'Place', name: 'Squamish, British Columbia' },
      sameAs: Object.values(c.links || {}).filter(isUrl),
    }, {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Council', item: `${ORIGIN}/council/` },
        { '@type': 'ListItem', position: 3, name: c.name, item: `${ORIGIN}/council/${c.slug}/` },
      ],
    }, memberFaq(c).ld],
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
    ${whoIs(c)}
    ${memberFacts(c)}
    ${rolesBox(c)}
    ${profileRecord(c)}
    <h2 id="campaign" class="campaign-h">What ${esc(first(c))} said during the 2026 campaign</h2>
    ${directNotice(c)}${paperNotice(c)}
    <p class="small ours">${stmtOf(c) ? `Summarised by us from ${esc(first(c))}’s own statement.` : 'Our summary of what ' + esc(first(c)) + ' has said and done in public.'} Tap <b>[source]</b> on any line to check it yourself.</p>
    <div class="grid cols-2">
      ${sideList(c, 'supports', 'Said they support', 'for', 'forlist')}
      ${sideList(c, 'opposes', 'Said they’re against', 'against', 'againstlist')}
    </div>
    <h2 id="issues">Where ${esc(first(c))} said they stand</h2>
    <p class="small">Each topic opens up: tap it for the detail, quotes and sources.</p>
    <div class="card stack">${ISSUES.map((i) => stanceRow(c, i)).join('')}</div>
    <p class="small">Compare everyone on: ${ISSUES.map((i) => `<a href="/issues/${TOPIC_SLUG[i.key]}/">${esc(TOPIC_NAME[i.key])}</a>`).join(' · ')}.</p>
    ${(c.top_priorities || []).length ? `<details class="drop"><summary>${esc(first(c))}’s own priority list</summary><ol class="ol">${c.top_priorities.map((p) => `<li>${escGl(p)}</li>`).join('')}</ol></details>` : ''}
    ${emailedAnswers(c)}
    ${directAnswers(c)}
    ${memberFaq(c).html}
    <details class="drop"><summary>About ${esc(first(c))}</summary><p>${escGl(c.occupation_background)}</p></details>
    <details class="drop"><summary>Where ${esc(first(c))} leans on money, growth and LNG</summary>${Object.keys(AXES).map((k) => miniSlider(c, k)).join('')}<p class="small">Worked out from ${esc(first(c))}’s public statements and votes, not a label they chose. <a href="/compare/#compass">See everyone side by side</a> · <a href="/quiz/">Who on council thinks like you? Take the quiz</a>.</p></details>
    <details class="drop"><summary>Sources we used (${(c.sources || []).filter((s) => isUrl(s.url)).length})</summary><ul class="small">${(c.sources || []).filter((s) => isUrl(s.url)).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></li>`).join('')}</ul></details>
    ${links ? `<div class="mobile-links"><h2>Hear it from ${esc(first(c))} directly</h2><ul class="linklist">${links}</ul></div>` : ''}
    <p class="small claim">Are you ${esc(c.name)}, or did you spot a mistake? Email <a href="mailto:${SITE.contact}?subject=${encodeURIComponent('Update for ' + c.name)}">${SITE.contact}</a> to update or add to this page. <a href="/about/#corrections">How corrections work</a>.</p>
    <div class="btn-row no-print"><a class="btn secondary" href="/council/${prev.slug}/">← ${esc(prev.name)}</a><a class="btn secondary" href="/council/${next.slug}/">${esc(next.name)} →</a></div>
    </div></div>`,
  }));
}

// The opening lines of a member's page: who they are, how they were elected, what they did before. Answers name searches.
function whoIs(c) {
  const num = (x) => Number(x).toLocaleString('en-CA'), r26 = RES['2026']; // the council pages are built before R26 and num below
  const race = c.office === 'mayor' ? r26.mayor : r26.council, i = (race || []).findIndex((r) => r.name === c.name), row = race?.[i];
  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  const how = !row ? '' : c.office === 'mayor'
    ? ` with ${num(row.total)} votes, ${num(row.total - race[1].total)} more than ${esc(race[1].name)}`
    : ` with ${num(row.total)} votes, ${i === 0 ? 'the most' : ord(i + 1)} of ${race.length} council candidates`;
  const bg = String(c.occupation_background || '').split(/(?<=[a-z0-9)]{2}\.)\s(?=[A-Z])/)[0]; // not after B.C. or U.S.
  return `<p class="lede who">${esc(c.name)} is ${c.office === 'mayor' ? 'the Mayor of Squamish' : 'a Squamish councillor'}, ${c.incumbent ? 're-elected' : 'elected'} on October 17, 2026${how}, for a term to 2030.${bg ? ` <span class="who-bg"><b>Background:</b> ${escGl(bg)}</span>` : ''}</p>`;
}

// Under the opening line: when they take office, what the role pays and what we track. Election facts stay in whoIs.
// Function declarations, not consts: the member pages are built above this point.
function raceRow(c) { return (RES['2026'][c.office === 'mayor' ? 'mayor' : 'council'] || []).find((r) => r.name === c.name); }
function castVotes(c) { return votesOf(c).filter((d) => ['yes', 'no'].includes(d.votes[c.slug])); }
function inaugural() { return MEETINGS.find((m) => m.type === 'inaugural'); }
function memberFacts(c) {
  const mayor = c.office === 'mayor', pay = ctx.pay?.[mayor ? 'mayor' : 'councillor'], ps = promisesOf(c), vs = castVotes(c), INAUGURAL = inaugural();
  const items = [
    INAUGURAL && [TODAY < INAUGURAL.date ? 'Takes office' : 'Took office', `<a href="${mUrl(INAUGURAL)}">${esc(fmtLong(INAUGURAL.date))}</a>, at the inaugural council meeting`],
    pay && ['Pay', `$${pay.toLocaleString('en-CA')} a year (${mayor ? 'the mayor’s' : 'each councillor’s'} pay in ${ctx.pay.year}, before expenses and benefits)${src(ctx.pay.source_url, 'District of Squamish')}`],
    ['Record', [ps.length && `<a href="#promises">${ps.length} campaign promises</a> tracked`, `<a href="#${vs.length ? 'votes' : 'record'}">${vs.length} council vote${vs.length === 1 ? '' : 's'}</a> so far`].filter(Boolean).join(' · ')],
  ].filter(Boolean);
  return `<dl class="who-facts">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}
// The questions people type about a member, answered in plain text from the same data. Also sent as FAQPage data.
function memberFaq(c) {
  const mayor = c.office === 'mayor', f = first(c), row = raceRow(c), n = (x) => Number(x).toLocaleString('en-CA');
  const pay = ctx.pay?.[mayor ? 'mayor' : 'councillor'], ps = promisesOf(c), vs = castVotes(c), next = upcoming.find((m) => m.type !== 'inaugural'), INAUGURAL = inaugural();
  const qs = [
    mayor ? ['Who is the mayor of Squamish?', `${c.name} is the mayor of Squamish, elected on October 17, 2026${row ? ` with ${n(row.total)} votes${row.pct != null ? ` (${Number(row.pct).toFixed(1)}%)` : ''}` : ''}. The term runs to the October 2030 election.`]
      : [`Is ${c.name} on Squamish council?`, `Yes. ${c.name} was ${c.incumbent ? 're-elected' : 'elected'} to Squamish council on October 17, 2026${row ? ` with ${n(row.total)} votes` : ''}, one of six councillors serving with Mayor ${mayors[0].name} until 2030.`],
    INAUGURAL && [`When does ${c.name} take office?`, TODAY < INAUGURAL.date ? `${c.name} is sworn in with the new council at the inaugural meeting on ${fmtLong(INAUGURAL.date)} at 6 p.m. at Municipal Hall.` : `${c.name} was sworn in with the new council at the inaugural meeting on ${fmtLong(INAUGURAL.date)}.`],
    ps.length && [`What did ${c.name} promise?`, `We track ${ps.length} promise${ps.length === 1 ? '' : 's'} ${f} made during the 2026 campaign, including: ${ps.slice(0, 3).map((p) => p.promise.replace(/\.$/, '')).join('; ')}. Each one is marked kept or not kept by how ${f} votes, not by what council as a whole decides.`],
    [`How has ${c.name} voted on council?`, vs.length ? `${f} has voted on ${vs.length} council decision${vs.length === 1 ? '' : 's'} so far: ${vs.filter((d) => d.votes[c.slug] === 'yes').length} for and ${vs.filter((d) => d.votes[c.slug] === 'no').length} against. Every vote is listed on this page with a link to the meeting.` : `Council hasn’t voted yet.${next ? ` The first regular meeting is ${fmtLong(next.date)}.` : ''} Every vote ${f} casts will be listed on this page.`],
    pay && [mayor ? 'How much is the mayor of Squamish paid?' : 'How much is a Squamish councillor paid?', `In ${ctx.pay.year} the ${mayor ? 'mayor' : 'each councillor'} was paid $${pay.toLocaleString('en-CA')}, not counting expenses and benefits, according to the District of Squamish financial statement.`],
  ].filter(Boolean);
  return {
    html: `<h2 id="questions">Questions about ${esc(c.name)}</h2><div class="card"><ul class="qa">${qs.map(([q, a]) => `<li><b>${esc(q)}</b><p>${esc(a)}</p></li>`).join('')}</ul></div>`,
    ld: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  };
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
  ${nearlyEmpty ? `<p class="asknote">No candidate has addressed this publicly yet. We have put the question to all ${all.length} of them; answers will appear here as they come in.</p>` : ''}
  <div class="bins">
  ${BINS.map(([val, cls, label]) => { const inBin = all.filter((c) => c.quiz_answers?.[q.id] === val); return inBin.length ? `<div class="bin ${cls}"><span class="lab">${label}</span><ul class="namechips">${inBin.map(nameChip).join('')}</ul></div>` : ''; }).join('')}
  ${unknown.length ? `<details class="bin-un"><summary>${unknown.length} ${unknown.length === 1 ? 'member hasn’t' : 'members haven’t'} said: show names</summary><ul class="namechips">${unknown.map(nameChip).join('')}</ul></details>` : ''}
  </div>${said.length ? `<details class="said" data-q="${q.id}"><summary>${moreBtn(`Tap to read what ${said.length === 1 ? esc(said[0].name) : said.length + ' members'} wrote about this`)}</summary><ul class="qa">${said.map((c) => `<li><a href="/council/${c.slug}/#explained"><b>${esc(c.name)}</b></a>${c.office === 'mayor' ? ' <span class="small">(mayor)</span>' : ''} <span class="ans">${ansWord(c, q)}</span><p>“${esc(wrote(c, q))}”</p></li>`).join('')}</ul><p class="small">Comments they added when answering our questionnaire during the campaign, unedited.</p></details>` : ''}</div>`;
}
const issueSection = (i) => {
  const ic = issueCtx(i.key);
  return `<section id="${i.key}" data-panel data-group="cmp" hidden><h2><span aria-hidden="true">${i.icon}</span> ${i.title}</h2>
  ${ic.short_explainer ? `<p>${esc(ic.short_explainer)} <a href="/issues/${TOPIC_SLUG[i.key]}/">More background and every member’s answer</a></p>` : ''}
  ${(i.allq ? ALL_QUESTIONS : QUESTIONS).filter((q) => q.issue === i.key).map((q) => spectrum(q) + (q.id === 'q23' ? `<details class="drop ifno-d"><summary>What happens if council says yes or no?</summary>${DEAL_IF_NO.replace('<h3>The Woodfibre tax deal: what each choice means</h3>', '')}</details>` : '')).join('')}
  <details><summary>Read each candidate’s position on ${i.title.toLowerCase()}</summary>
  <div class="table-scroll"><table class="issue-table"><thead><tr><th>Candidate</th><th>Position</th></tr></thead><tbody>
  ${all.map((c) => { const s = c.stances?.[i.key] || {}; const none = !s.position || /no public position/i.test(s.position); return `<tr><td><a href="/council/${c.slug}/">${esc(c.name)}</a>${c.office === 'mayor' ? '<br><span class="small">mayor</span>' : ''}</td><td>${none ? '<span class="muted">No public position found.</span>' : `<span class="pos">${esc(s.position)}</span>${esc(s.summary)}${src(s.source_url)}`}</td></tr>`; }).join('')}
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

// Have your say questions (built here because the home hero counts the open ones; the page is written further down).
const hyTz = (utcMs) => { const d = new Date(utcMs); return (new Date(d.toLocaleString('en-US', { timeZone: 'America/Vancouver' })) - new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60000; };
const hyClose = (m) => { const [y, mo, d] = m.date.split('-').map(Number), [h, mi] = (m.time || '18:00').split(':').map(Number); const guess = Date.UTC(y, mo - 1, d, h, mi); return new Date(guess - hyTz(guess) * 60000).toISOString(); };
const hyId = (m, a) => `${m.id}-${crypto.createHash('sha256').update(a.ask).digest('hex').slice(0, 8)}`;
const HY_SINCE = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
const HAVE_Q = MEETINGS.filter((m) => m.date >= HY_SINCE && m.status !== 'cancelled').flatMap((m) => (m.agenda_items || []).filter((a) => a.ask && (a.kind === 'vote' || a.kind === 'hearing')).map((a) => ({
  id: hyId(m, a), meeting: m.id, date: m.date, close: hyClose(m), url: mUrl(m), mlabel: `${mType(m).label}, ${fmtDay(m.date)}`, decided: !!m.summary,
  ask: a.ask, plain: a.plain, for_you: a.for_you || '', yes_means: a.yes_means || '', no_means: a.no_means || '', areas: a.areas || [], topic: a.topic,
  ...(a.depth === 'detailed' ? { depth: 'detailed', context: a.context || '', facts: a.facts || [], supporters: a.supporters || [], concerns: a.concerns || [], factors: (a.factors || []).slice(0, 6) } : {}),
})));
// What people wrote, summarized (scripts/pipeline/hy-themes.mjs). Only the summary is published, never the comments.
const HY_THEMES = fs.existsSync(path.join(ROOT, 'data', 'hy-themes.json')) ? read('hy-themes.json') : {};
for (const q of HAVE_Q) if (HY_THEMES[q.id]) q.themes = HY_THEMES[q.id];
if (process.env.SV_VOTE_TEST === '1') HAVE_Q.unshift(
  { id: 'test-question-1', meeting: 'test', date: TODAY, close: new Date(Date.now() + 3 * 86400000).toISOString(), url: '/meetings/', mlabel: 'Test meeting (preview only)', decided: false, ask: 'Should the District test this voting page?', plain: 'A test question that only exists on preview deployments.', for_you: '', yes_means: 'The test passes.', no_means: 'We fix it.', areas: ['downtown'], topic: 'other' },
  { id: 'test-question-2', meeting: 'test', date: TODAY, close: new Date(Date.now() + 3 * 86400000).toISOString(), url: '/meetings/', mlabel: 'Test meeting (preview only)', decided: false, ask: 'Should council change the community plan to allow about 1,100 homes at North Crumpit?', plain: 'Test example of a detailed question.', for_you: 'A new neighbourhood north of Crumpit Woods, reached from the Mamquam area.', yes_means: 'Planning continues toward a rezoning, with more public hearings before anything is built.', no_means: 'The land stays planned as it is now, and the applicant can come back with a new proposal.', areas: ['crumpit-woods'], topic: 'growth', depth: 'detailed', context: 'Example text for testing. The District is reviewing a community plan change for North Crumpit, a hillside area east of the highway. A plan change is an early step: a rezoning and development permits would still be needed.', facts: ['About 1,130 homes planned', 'Community plan change, not yet a rezoning', 'Under review by District staff'], supporters: ['Adds homes in a town short of housing', 'Planned as a whole neighbourhood rather than piece by piece'], concerns: ['More traffic on roads into the area', 'Building on a forested hillside with wildfire risk'], factors: ['Traffic', 'Homes people can afford', 'Wildfire and flood risk', 'Parks and trails', 'Cost to taxpayers'] },
);
const HAVE_SAY_OPEN = HAVE_Q.filter((q) => Date.parse(q.close) > Date.now()).length;

// ---------- WHAT SQUAMISH WANTS: data shared by /wants/, the per-ask pages, /your-say/ and Home ----------
// Starter asks from data/wants.json; residents' asks come from the database at page load (api/wants.js, src/wants.js).
const WANTS = read('wants.json');
const WANT_HOODS = [...(fs.existsSync(path.join(ROOT, 'data', 'neighbourhoods.json')) ? read('neighbourhoods.json').neighbourhoods : HOODS).map((h) => ({ slug: h.slug, name: h.name })), { slug: 'outside', name: 'Outside Squamish' }];
const WANT_STATUS = {
  none: { label: 'Nobody working on it', cls: 'none', explain: 'Not in any District plan or budget we can find, and not on a council agenda.' },
  plan: { label: 'Planned or in the budget', cls: 'plan', explain: 'The District has it in a plan or budget, but it hasn’t happened yet. The ask is usually about doing it sooner or differently.' },
  agenda: { label: 'Council is deciding', cls: 'agenda', explain: 'This is in front of council now, so it could be decided at an upcoming meeting.' },
  done: { label: 'Done', cls: 'done', explain: 'It has happened. We keep it on the list so you can see how people felt about it.' },
  province: { label: 'Province decides', cls: 'prov', explain: 'The Province of B.C. controls this. Council can ask for it and push, but can’t do it alone.' },
  resident: { label: 'Added by a resident', cls: 'res', explain: 'A resident added this. We haven’t checked where it stands yet.' },
};
const WANTS_N = WANTS.asks.length;
// "More info" explainers, one per starter ask: data/wants-info/<id>.json (facts, timeline, the case for each answer, sources).
const WANT_INFO = Object.fromEntries((fs.existsSync(path.join(ROOT, 'data', 'wants-info')) ? fs.readdirSync(path.join(ROOT, 'data', 'wants-info')) : [])
  .filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wants-info', f), 'utf8'))).filter((x) => WANTS.asks.some((a) => a.id === x.id)).map((x) => [x.id, x]));
const wantsData = (extra = {}) => `<script type="application/json" id="wa-data">${JSON.stringify({
  asks: WANTS.asks.map((a) => (WANT_INFO[a.id] ? { ...a, info: true } : a)), topics: WANTS.topics, statuses: WANT_STATUS, hoods: Object.fromEntries(WANT_HOODS.map((h) => [h.slug, h.name])), ...extra,
}).replace(/</g, '\\u003c')}</script>`;
// A plain list for search engines and anyone without JavaScript; src/wants.js replaces it with the answerable rows.
const wantsStatic = (list) => list.map((a) => `<li class="wa-row"><span class="wa-t">${WANT_INFO[a.id] ? `<a href="/wants/${a.id}/info/">${esc(a.title)}</a>` : esc(a.title)}</span>${a.why ? `<span class="small muted">${esc(a.why)}</span>` : ''}</li>`).join('');
// The short version: three asks you can answer on the spot, used on Home and /your-say/.
const wantsShort = (where) => `<section class="card wa-short" data-wants="short" data-count="3" aria-labelledby="wa-short-h-${where}">
  <p class="wa-kicker">New: What Squamish Wants</p>
  <h2 id="wa-short-h-${where}">What should Squamish do?</h2>
  <p class="small">Say yes, no or don’t mind on specific asks, then see what everyone else said. <span data-wa-people></span></p>
  <ul class="wa-rows" data-wa-rows>${wantsStatic(WANTS.asks.slice(0, 3))}</ul>
  <a class="btn block" href="/wants/">See all the asks and add your own</a>
</section>`;
// Home hero: the next meeting as a calendar card, or the last one once nothing is scheduled.
function heroMeet() {
  const m = upcoming[0], firstVote = upcoming.find((x) => x.type !== 'inaugural' && x !== m);
  const cal = (d) => { const t = new Date(d + 'T12:00:00'); return `<span class="cc-cal"><span>${t.toLocaleDateString('en-CA', { month: 'short' }).replace('.', '')}</span><b>${t.getDate()}</b></span>`; };
  if (m) {
    const day = new Date(m.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short' }).replace('.', '');
    const what = m.type === 'inaugural' ? 'New council sworn in' : mType(m).label;
    const more = m.type === 'inaugural' && firstVote ? `First votes ${fmtLong(firstVote.date).replace(/, \d{4}$/, '')}. See what’s on the agenda →` : 'See what’s on the agenda →';
    return `<a class="cc-meet" href="${mUrl(m)}">${cal(m.date)}<span><b>${esc(what)}, ${esc(day)}${m.time ? ` ${esc(fmtTime(m.time))}` : ''}</b>${esc(more)}</span></a>`;
  }
  const l = past.find((x) => x.summary);
  return l ? `<a class="cc-meet" href="${mUrl(l)}">${cal(l.date)}<span><b>Last meeting</b>${esc(l.summary.headline)} →</span></a>` : '';
}

// Home: latest news right under the hero. One highlighted story (the newest lead or feature, else the newest with a
// picture) shown big, then the next four as rows, then a button to the full page.
function homeNews() {
  const S = [...NEWS.stories].sort((a, b) => b.date.localeCompare(a.date)), SEC = Object.fromEntries(NEWS.sections);
  if (!S.length) return '';
  // Photo, else the story's map, else its share picture (every story has one).
  const pic = (st) => st.photo?.file || st.visual?.img || (fs.existsSync(path.join(ROOT, 'public', 'news', 'og', st.og || `${st.slug}.jpg`)) ? `/news/og/${st.og || `${st.slug}.jpg`}` : '');
  const top = S.slice(0, 4);
  const lead = top.find((st) => (st.tier === 'lead' || st.tier === 'feature') && pic(st)) || S.find(pic) || S[0];
  const rest = S.filter((st) => st !== lead).slice(0, 4);
  const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }).replace('.', '');
  const kick = (st) => `<span class="nw-hk" data-s="${st.s}">${esc(SEC[st.s] || 'News')}</span><span class="hn-date">${esc(day(st.date))}</span>`;
  return `<section class="hn" aria-labelledby="hn-h"><div class="hn-top"><h2 id="hn-h">Squamish news</h2><a class="hn-all" href="/news/">See more news →</a></div>
  <div class="hn-grid">
    <a class="hn-lead" href="/news/${lead.slug}/">${pic(lead) ? `<img src="${esc(newsThumb(pic(lead), 800))}" alt="${esc(lead.photo?.alt || lead.visual?.alt || '')}" width="800" height="450" loading="lazy">` : ''}<span class="hn-body"><span class="hn-k">${kick(lead)}</span><b>${esc(lead.head)}</b>${lead.dek ? `<span class="hn-dek">${esc(String(lead.dek).replace(/<[^>]+>/g, ''))}</span>` : ''}</span></a>
    <ul class="hn-list">${rest.map((st) => `<li><a href="/news/${st.slug}/">${pic(st) ? `<img src="${esc(newsThumb(pic(st), 240))}" alt="" width="120" height="80" loading="lazy">` : '<span class="hn-noimg" aria-hidden="true"></span>'}<span><span class="hn-k">${kick(st)}</span><b>${esc(st.head)}</b></span></a></li>`).join('')}</ul>
  </div>
  <a class="btn secondary hn-more" href="/news/">See more Squamish news →</a></section>`;
}

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
    hero: `${TODAY_STRIP}<section class="hero hero-cc"><div class="wrap cc">
  <div class="cc-main">
    <h1>Squamish council made promises. We’re keeping score.</h1>
    <p class="lede">Every vote by Squamish’s mayor and councillors, checked against what they told voters in 2026.</p>
    ${heroMeet()}
  </div>
  <div class="cc-tiles">
    <a class="cc-tile" href="/meetings/"><span class="cc-ico">${ICON.gavel}</span><b>What council decided</b><span>Every meeting, in plain words</span></a>
    <a class="cc-tile" href="/scorecard/"><span class="cc-ico">${ICON.check}</span><b>Scorecard</b><span>${PROMISES.length} promises we’re watching</span></a>
    <a class="cc-tile" href="/neighbourhoods/"><span class="cc-ico">${ICON.pin}</span><b>Your neighbourhood</b><span>Decisions and building near you</span></a>
${HAVE_SAY_OPEN ? `    <a class="cc-tile cc-say" href="/have-your-say/"><span class="cc-ico">${ICON.hand}</span><b>Have your say <span class="cc-new">${HAVE_SAY_OPEN ? 'Vote now' : 'New'}</span></b><span>${HAVE_SAY_OPEN ? `${HAVE_SAY_OPEN} question${HAVE_SAY_OPEN === 1 ? '' : 's'} open: vote before council does` : 'Vote on what council votes on'}</span></a>` : `<a class="cc-tile cc-say" href="/wants/"><span class="cc-ico">${ICON.hand}</span><b>What Squamish Wants <span class="cc-new">New</span></b><span>Say yes or no to what people want changed in town</span></a>`}
  </div>
  <form class="herosign cc-sign" id="signup" data-subscribe="home-hero" novalidate>
    <label for="hs-email"><b>Get a short email every Friday:</b> what council decided and what’s coming up.</label>
    <div class="hs-row"><input id="hs-email" type="email" name="email" autocomplete="email" required placeholder="Enter your email"><button class="btn" type="submit">Sign up</button></div>
    <p class="hs-note">We’ll email you a link to confirm. Unsubscribe any time.</p>
    <p class="small" data-msg role="status"></p>
  </form>
  <p class="visit-count" data-visits hidden><span class="vc-dot" aria-hidden="true"></span><b>0</b> page views so far</p>
  </div></section>`,
    body: `
  ${homeNews()}
  ${wantsShort('home')}
  ${wantsData()}
  <script src="/botid.js" defer></script><script src="/wants.js" defer></script>
  ${FB_CARD}
  <h2>Your council <span class="small">elected October 17, 2026</span></h2>
  <div class="faces faces-sm">${[...mayors, ...council].map(faceTile).join('')}</div>
  <p><a href="/council/">What each of them stands for, how they vote, and what they promised →</a></p>

  <section class="card foryou-box no-print" id="foryou"><h2>What matters to you</h2>
    <p class="small">Pick your neighbourhood and what you care about. We’ll show those first. It’s saved on this phone only.</p>
    <p class="small"><a href="/neighbourhoods/">See every neighbourhood: decisions, building projects and news on a map →</a></p>
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
  <div class="btn-row"><a class="btn secondary" href="/scorecard/">See every promise →</a><a class="btn secondary" href="/scorecard/#positions">Do they vote the way they said? →</a></div></section>

  ${TRACKED.length ? `<section class="card"><h2>Issues we’re following</h2><p class="small">The big questions that keep coming back to council. Tap one to see where it stands.</p><ul class="mlist">${TRACKED.slice(0, 5).map(issueRow).join('')}</ul><p><a href="/issues/">All the issues →</a></p></section>` : ''}
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
  url: '/council/', jsonld: crumbLd([['Home', '/'], ['Mayor and council', '/council/']]), title: 'Squamish mayor and council 2026 to 2030',
  desc: `${mayors[0]?.name} is mayor of Squamish. Councillors: ${council.map((c) => c.name).join(', ')}. What each stands for, how they vote and which promises they keep.`,
  body: `<h1>Your mayor and council</h1>
  <p class="lede">Seven people elected on October 17, 2026, to run Squamish until 2030. Tap anyone to see what they promised, how they vote, and every answer they gave during the campaign.</p>
  <h2 id="mayor">Mayor</h2>
  <ul class="cand-list">${mayors.map(candCard).join('')}</ul>
  <h2 id="council">Councillors</h2>
  <ul class="cand-list" id="council-grid">${council.map(candCard).join('')}</ul>
  <h2 id="compare">Compare them, issue by issue</h2>
  <p>What each of them said during the campaign, side by side. The mayor is marked in yellow.</p>
  ${COMPARE_BLOCK}
  <div class="btn-row no-print"><a class="btn secondary" href="/compare/#compass">Who agrees with whom: the map</a><a class="btn secondary" href="/quiz/">Who on council thinks like you? Take the quiz</a><a class="btn secondary" href="/scorecard/">Scorecard</a><a class="btn secondary" href="/how-council-works/">How council works</a></div>`,
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
  if (mk === 'classic') return `Only ${n} of ${all.length} council members have said where they stand on enforcement. Council has never voted on encampments, policing or public drug use.`;
  if (mk === 'cars') return `Only ${n} of ${all.length} council members have enough on the record to place. Most of the parking and bike-lane statements aren’t in the quiz, so ★ You rests on fewer of your answers here.`;
  return `Only ${n} of ${all.length} council members have enough on the record to place.`;
}
// ‹ 1 of 3 › header shared by the compass carousels (site.js [data-carousel] does the stepping).
function carHead(label, what) { return  `<div class="lt-head"><span class="lt-kicker">${label} <span class="lt-count" data-car-count></span></span><span class="lt-arrows no-print"><button type="button" class="picker-step" data-car-prev aria-label="Previous ${what}">‹</button><button type="button" class="picker-step" data-car-next aria-label="Next ${what}">›</button></span></div>`; }
function miniCompass({ heading = 'The Squamish compass', you = true, maps = Object.keys(CMAPS) } = {}) {
  const slide = (mk, n) => `<div${maps.length > 1 ? ` data-slide${n ? ' hidden' : ''}` : ''}>
  ${maps.length > 1 ? `<p class="mc-t">${esc(CMAPS[mk].title)}</p>` : ''}<p class="mc-q">${esc(CMAPS[mk].ask)}</p>
  ${compassLegend(true, mk)}
  <a class="mc-chart" href="/compare/${mk === 'classic' ? '' : '?map=' + mk}#map" aria-label="Open the full compass">${compassSvg({ mini: true, map: mk })}</a>
  <p class="small mc-note">${miniCaveat(mk)} <a href="/compare/#how">How it’s worked out</a>.</p></div>`;
  return `<section class="mini-compass"${maps.length > 1 ? ` data-carousel data-track="Compass step" aria-roledescription="carousel" aria-label="${esc(heading)}"` : ''}>
  ${maps.length > 1 ? carHead(`🧭 ${heading}`, 'compass') : `<span class="lt-kicker">🧭 ${heading}</span>`}
  ${maps.map(slide).join('')}
  ${maps.length > 1 ? `<p class="small lt-hint no-print">Use the arrows to see ${maps.length - 1} more ways of mapping the same candidates.</p>` : ''}
  ${you ? `<p class="mc-you" data-you="none"><a class="btn secondary" href="/quiz/">★ Take the quiz to see where you land</a></p><p class="small mc-you" data-you="has" hidden><b>★ You</b> is where your quiz answers put you. It’s worked out on your device and never sent anywhere.</p>` : ''}
  <a class="lt-go" href="/compare/#compass">Open the full map →</a>
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
  ${key === 'street' ? `<p class="small">Policing, bylaw officers and drug-use bylaws are left off this line: they’re a separate question. Some candidates have only answered one or two of these three statements, so check the number of statements.</p>` : ''}
  ${key === 'deal' ? `<p class="small">This is about <b>money, not the environment</b>. People on both sides of the plant itself disagree about whether this is a good deal for taxpayers. <a href="/issues/#environment_lng">What’s in the deal</a>.</p><details class="drop ifno-d"><summary>What happens if council says yes or no?</summary>${DEAL_IF_NO.replace('<h3>The Woodfibre tax deal: what each choice means</h3>', '')}</details>` : ''}
  ${single ? '' : `<p class="small legend-line"><span class="lg-dot"></span> based on 2 or more statements &nbsp; <span class="lg-dot hollow"></span> only 1 statement: treat with care</p>`}
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
// The compass now lives on /compare/ (review item 10; /compass/ redirects to /compare/#compass).
const COMPASS_PAGE = ({
  desc: 'Where Squamish mayor and council candidates sit on taxes and spending, growth, and Woodfibre LNG and climate, worked out from their public statements and votes.',
  body: `<h1>Where they lean</h1>
  <p class="lede">Everyone on a map first (swipe for ${Object.keys(CMAPS).length} different maps), then the five big questions, one at a time. Placed from their 2026 campaign answers.</p>
  <nav class="chapters no-print" aria-label="Jump to a topic"><a href="#map" data-ch="map"><span aria-hidden="true">🧭</span> Compass</a>${Object.entries(AXES).map(([k, A]) => `<a href="#axis-${k}" data-ch="axis-${k}"><span aria-hidden="true">${A.icon}</span> ${A.short || A.title}</a>`).join('')}</nav>
  <div class="lean-tools no-print">
    <label for="follow"><b>Follow one council member:</b></label>
    <select id="follow"><option value="">Show everyone</option>${all.map((c) => `<option value="${c.slug}">${esc(c.name)}${c.office === 'mayor' ? ' (mayor)' : ''}</option>`).join('')}</select>
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
  <p class="small"><b>Diamonds</b> (once council has voted at least 3 times on each line): where a member’s <b>votes</b> put them, joined by a dotted line to where their campaign answers put them. <a href="/scorecard/#positions">Do they vote the way they said? Statement by statement</a>.</p>
  <div class="card compass-detail" id="cdetail" aria-live="polite" style="margin-top:1rem"><p class="muted" style="margin:0">Tap any dot above to see the details here.</p></div>
  <div data-cmap-note="classic">
  <p class="small"><b>Left–right</b> is support: more shelter and supportive-housing spaces, and mental-health crisis teams (left), or fewer homeless shelters (right). <b>Up–down</b> is the camps: clear tent encampments and move Under One Roof out of downtown (down), or let the camps stay (up). These aren’t opposites: someone can want more shelter <em>and</em> the camps cleared (bottom-left). Tap a dot for details.</p>
  <p class="small"><b>Read this before judging anyone by it:</b> council has voted on supportive housing but has never voted on encampments, police numbers or public drug use, so only candidates who answered our questionnaire can be placed. Everyone else is listed under the chart as not placed. <a href="/issues/#homelessness">What council has and hasn’t decided</a>.</p>
  </div>
  </section>

  <h2 class="lean-more">Now topic by topic</h2>
  <p>The compass squeezes everything into two lines. Here is where everyone sits on each of the five questions on its own.</p>
  ${Object.keys(AXES).map(leanList).join('<!--YOU-->').replace('<!--YOU-->', `<div class="card you-cta no-print" id="you-cta"><b>Where do <em>you</em> fit?</b> Take the <a href="/quiz/">3-minute quiz</a> and a ★ You marker appears on the compass and on every list.</div>`)}


  <details class="drop"><summary>Everything above as a plain table</summary>
  <div class="table-scroll"><table class="issue-table"><thead><tr><th>Candidate</th>${Object.values(AXES).map((A) => `<th>${A.title}</th>`).join('')}</tr></thead><tbody>
  ${all.map((c) => `<tr><td><a href="/council/${c.slug}/">${esc(c.name)}</a>${c.office === 'mayor' ? '<br><span class="small">mayor</span>' : ''}</td>${Object.keys(AXES).map((k) => { const s = axisScore(c, k); return `<td data-label="${AXES[k].title}">${s ? esc(axisWords(k, s)) : '<span class="muted">no public record</span>'}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div></details>
  <details class="drop" id="how"><summary>How the compasses are worked out</summary><p>Nobody here runs for a party, so nobody chose these labels. Each dot is <b>calculated</b> from the same sourced answers used in the quiz. <b>Homelessness:</b> left–right averages the support statements (more shelter and supportive housing, even near homes; mental-health crisis teams alongside the RCMP). Up–down averages two statements (clear encampments even when there is nowhere else to go; move Under One Roof out of downtown), with agreeing pushing the dot down.</p><p><b>How should we grow, and pay for it?</b> Left–right is the same growth line as the Growth list below (slow the pace of approvals; taller buildings downtown; cut red tape for builders). Up–down averages the statements about taxes, borrowing and public spending (housing, shelters, transit, recreation, bike lanes, childcare).</p><p><b>Cars or bikes?</b> Left–right is the growth line. Up–down averages the parking and transport statements: more public parking downtown, parking required in new buildings and free parking for residents (up), against paid parking being fair, and spending local money on bike lanes, sidewalks and regional transit (down).</p><p>A dot is hollow when either line rests on a single statement.</p></details>
  <details class="drop" hidden><summary>Why not “left vs. right”?</summary><p>Those labels come from national politics. Town councils don’t vote on civil liberties, candidates here don’t run for parties, and almost none of them have said anything about policing. Rather than guess, every position on this page is <b>calculated from the candidate’s sourced answers</b> to the same statements used in <a href="/quiz/">the quiz</a>. Anyone who hasn’t spoken publicly on a topic is left off that list, not parked in the middle.</p></details>`,
  scripts: `<script>var CD=${JSON.stringify(Object.fromEntries(Object.keys(CMAPS).map((mk) => [mk, Object.fromEntries(placedOn(mk).map((c) => [c.slug, { n: c.name, d: cmapWords(c, mk) }]))])))};
var AX=${JSON.stringify(Object.fromEntries(Object.entries(AXES).map(([k, A]) => [k, A.q])))};
</script><script src="/lean.js"></script>`,
});
write('/compare/', page({
  url: '/compare/', jsonld: crumbLd([['Home', '/'], ['Compare them', '/compare/']]), title: 'Compare the Squamish mayor and council on every issue',
  desc: 'See where Squamish’s mayor and six councillors stand on housing, growth, taxes, Woodfibre LNG and more, side by side, issue by issue, and on one map.',
  body: `<h1>Compare the mayor and council, issue by issue</h1>
  <p class="lede">Pick an issue to see where everyone stands, side by side. The mayor is marked in yellow.</p>
  ${COMPARE_BLOCK}
  <h2 id="compass">Who agrees with whom: the map</h2>
  ${COMPASS_PAGE.body.replace(/^<h1>[^<]*<\/h1>\s*/, '')}
  <a class="card" href="/issues/" style="display:block;margin-top:1.5rem"><h3>The issues</h3><p>Plain language background on each topic, what council is doing about it, and where each member stands.</p></a>`,
  scripts: COMPASS_PAGE.scripts,
}));

// ---------- ISSUES ----------
// One Issues section (review item 10): /issues/ lists every topic, each topic page is the hub for it, with the
// issues we follow on that topic (/track/<slug>/) and where each member stands. /track/ redirects here.
write('/issues/', page({
  url: '/issues/', jsonld: crumbLd([['Home', '/'], ['The issues', '/issues/']]), title: 'Squamish council issues, explained',
  desc: 'Housing, growth, taxes, Woodfibre LNG, homelessness, policing, parking and more: what Squamish council is doing on each one, the background in plain words, and where each member stands.',
  body: `<h1>The issues</h1>
  <p class="lede">Each topic in plain words: what council is doing about it now, the background, and where each member stands. Tap a topic to open it.</p>
  <ul class="plainlist stack">${(ctx.issues || []).filter((i) => TOPIC_SLUG[i.key]).map((i) => { const ts = TRACKED.filter((t) => t.topic === i.key); return `<li class="card issue-hub" id="${i.key}"><h2><a href="/issues/${TOPIC_SLUG[i.key]}/">${esc(i.title)}</a></h2><p>${esc(i.teaser)}</p>
    ${ts.length ? `<p class="small"><b>What we’re following:</b></p><ul class="mlist">${ts.map(issueRow).join('')}</ul>` : ''}</li>`; }).join('')}
  <li class="card issue-hub"><h2><a href="/issues/woodfibre-tax-deal/">The Woodfibre LNG tax deal</a></h2><p>Council said no to a 10 year tax agreement in September 2026. What it would have meant, and where each member stands.</p></li></ul>`,
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
  url: '/quiz/', jsonld: crumbLd([['Home', '/'], ['Quiz', '/quiz/']]), title: 'Squamish council quiz: who on council thinks like you?',
  desc: `Answer ${QUESTIONS.length} plain-language questions and see which members of Squamish council think most like you.`,
  body: `<div class="quiz-shell"><div id="quiz-intro"><h1>Who on council thinks like you?</h1>
  <p class="lede">${QUESTIONS.length} statements. Tell us if you agree or disagree. It takes about three minutes, and your answers never leave your device.</p></div>
  <div id="quiz" class="card"><noscript>The quiz needs JavaScript turned on. You can still <a href="/compare/">compare the mayor and council issue by issue</a>.</noscript></div>
  <p class="small" style="margin-top:1rem">How matching works: we compare your answers to each council member’s public positions and votes. Questions you mark as important count double. Where a member has no public position, that question is left out for them. <a href="/about/#quiz">Full method</a>.</p></div>
  <template id="tpl-compass">${miniCompass({ heading: 'Where you land', you: false, maps: ['classic'] })}</template>`,
  scripts: '<script src="/data.js"></script><script src="/quiz.js"></script>',
}));

// ---------- MEETINGS ----------
const MEET_HOW = `<p class="small"><a href="/how-council-works/">How council works</a>: readings, the consent agenda, closed meetings and the new council’s first 100 days.</p>
<details class="drop"><summary>How to watch or speak at a meeting</summary>
  <p><b>Go in person:</b> meetings are open to anyone at Council Chambers, Municipal Hall, 37955 Second Avenue. You don’t need to sign up to watch. Council meetings are usually the 1st and 3rd Tuesday of the month at 6 p.m.; council workshops (official name: Committee of the Whole) are usually the 2nd and 4th Tuesday, often in the morning.</p>
  <p><b>Watch from home:</b> meetings are streamed live on the <a href="https://www.youtube.com/@DistrictofSquamish/streams" target="_blank" rel="noopener">District’s YouTube channel</a> and stay there afterward. Each meeting below links to its own video.</p>
  <p><b>Have your say:</b> you can write to council before a meeting, or speak at a public hearing. The District explains how on its <a href="https://squamish.ca/government-and-administration/council/" target="_blank" rel="noopener">council page</a>.</p></details>`;
const typeLegend = () => `<div class="mlegend">${['regular', 'cow', 'hearing', 'special'].map((k) => `<span><span class="mtype ${MTYPE[k].cls}">${esc(MTYPE[k].label)}</span> ${esc(MTYPE[k].plain)}${MTYPE[k].official ? ` <span class="small">Official name: ${esc(MTYPE[k].official)}.</span>` : ''}</span>`).join('')}</div>`;
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
  // Consent agenda items are routine and passed together in one vote: shown as one block, not as separate votes.
  const consent = (m.decisions || []).filter((d) => d.votes && d.consent_agenda);
  const votes = (m.decisions || []).filter((d) => d.votes && !d.consent_agenda);
  const links = [[m.video_url, '▶ Watch the full meeting video'], [m.agenda_url, 'Official agenda'], [m.minutes_url, 'Official minutes'], [m.transcript ? `/transcripts/${m.id}.txt` : null, 'Full written transcript']].filter(([u]) => u);
  write(mUrl(m), page({ updated: isoDay(m.minutes_checked) || isoDay(m.generated?.at) || null,
    url: '/meetings/', image: done ? shareImg(m) : shareCard({ file: `share/cards/meeting-${m.id}.png`, kicker: T.label.toUpperCase(), title: fmtDay(m.date), sub: m.time ? `Starts at ${fmtTime(m.time)}` : 'Agenda, how to watch and how to have your say', stats: m.type === 'inaugural' ? [[all.length, 'members sworn in'], [PROMISES.length, 'promises we track']] : [], foot: m.type === 'inaugural' ? 'The new mayor and council take their oath of office' : 'What’s on the agenda and how to have your say' }), title: `Squamish ${T.label.charAt(0).toLowerCase() + T.label.slice(1)}, ${fmtLong(m.date)}: ${done ? 'what council decided' : 'agenda and how to watch'}`,
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
    ${consent.length ? `<details class="drop"><summary>Routine items passed together in one vote (consent agenda, ${consent.length})</summary><p class="small">Council approves routine items, like minutes and reports for information, in one vote. Any member can pull one out for its own vote.</p><div class="stack">${consent.map((d) => decisionCard(d, m)).join('')}</div></details>` : ''}
    ${(m.decisions || []).filter((d) => !d.votes).length ? `<details class="drop"><summary>Also discussed, with no vote (${m.decisions.filter((d) => !d.votes).length})</summary><div class="stack">${m.decisions.filter((d) => !d.votes).map((d) => decisionCard(d, m)).join('')}</div></details>` : ''}
    ${(S.explainer || []).length ? `<details class="drop layer2"><summary>Explain this meeting a bit more</summary>${S.explainer.map((x) => `<p>${escGl(x)}</p>`).join('')}</details>` : ''}
    ${(m.promise_updates || []).length ? `<h2>Promises this meeting tested</h2><div class="card stack">${m.promise_updates.map((u) => { const pr = PROMISES.find((x) => x.id === u.id); return pr ? promiseRow(pr, { who: true }) : ''; }).join('')}</div>` : ''}
    ` : `
    <section class="card layer1"><h2>What’s on the agenda</h2>
      ${m.preview ? `<p class="lede">${escGl(m.preview)}</p>` : `<p>${esc(T.plain)}</p>`}
      ${(m.agenda_items || []).length ? `<ul class="keypoints">${m.agenda_items.map((a) => `<li>${escGl(a.plain || a.title)}${a.for_you ? `<br><span class="small"><b>For you:</b> ${escGl(a.for_you)}</span>` : ''}${areaTags(a.areas)}${a.ask && (a.kind === 'vote' || a.kind === 'hearing') && m.date >= TODAY ? `<br><a class="small hy-link" href="/have-your-say/">${ICON.hand} Have your say: vote on this before council does →</a>` : ''}</li>`).join('')}</ul>` : `<p class="small muted">The District usually posts the agenda a few days before the meeting. We’ll list the main items here in plain words as soon as it’s out.</p>`}
    </section>
    ${m.status === 'cancelled' ? '' : haveSay(m)}
    ${MEET_HOW}`}
    ${links.length ? `<details class="drop layer3"${done ? '' : ' open'}><summary>Full details: video, agenda${done ? ', minutes and transcript' : ''}</summary><ul class="linklist">${links.map(([u, l]) => `<li><a href="${esc(u)}"${u.startsWith('/') ? '' : ' target="_blank" rel="noopener"'}>${l}</a></li>`).join('')}</ul>
    ${done && m.generated ? `<p class="small muted">Summary written automatically on ${esc(fmtLong(m.generated.at.slice(0, 10)))} from the ${esc(m.generated.from || 'meeting video and official documents')}. If anything here is wrong, the official minutes are the record. <a href="mailto:${esc(SITE.contact)}?subject=${encodeURIComponent('Meeting summary ' + m.id)}">Tell us</a>.</p>` : ''}</details>` : ''}
    <div class="btn-row no-print"><a class="btn secondary" href="/meetings/">← All meetings</a><a class="btn secondary" href="/scorecard/">Scorecard</a></div>
    ${signupBox('meeting')}`,
  }));
}

// ---------- ISSUES WE'RE FOLLOWING (/track/) ----------
if (TRACKED.length) {
  // The /track/ index is now /issues/ (review item 10): each topic page lists the issues we follow on it.
  for (const t of TRACKED) {
    const ds = issueDecisions(t), qs = (t.related_q || []).map((id) => ALL_QUESTIONS.find((q) => q.id === id)).filter(Boolean);
    const now = stepNow(t);
    write(`/track/${t.slug}/`, page({
      url: '/issues/', title: `${t.title}: Squamish council, step by step`,
      desc: `${t.summary.split('. ')[0]}. Where it stands now, what council decides next, and how each member has voted.`,
      jsonld: crumbLd([['Home', '/'], ['The issues', '/issues/'], ...(TOPIC_SLUG[t.topic] ? [[TOPIC_NAME[t.topic].replace(/^./, (x) => x.toUpperCase()), `/issues/${TOPIC_SLUG[t.topic]}/`]] : []), [t.title, `/track/${t.slug}/`]]),
      body: `<p class="crumbs">${TOPIC_SLUG[t.topic] ? `<a href="/issues/${TOPIC_SLUG[t.topic]}/">← ${esc(TOPIC_NAME[t.topic].replace(/^./, (x) => x.toUpperCase()))}</a> · ` : ''}<a href="/issues/">All issues</a></p>
      <h1>${esc(t.question)}</h1>
      <p class="lede">${escGl(t.summary)}</p>
      ${areaTags(t.areas)}
      ${EXPLAINERS.filter((e) => e.track === t.slug).map((e) => `<p class="notice info"><b>Explained:</b> <a href="/explained/${e.slug}/">${esc(e.question)}</a></p>`).join('')}
      <section class="card"><h2>Where it stands${now ? ` <span class="small">step ${now.i + 1} of ${now.n}</span>` : ''}</h2>
        <ol class="isteps">${(t.steps || []).map((x) => `<li class="st-${esc(x.status)}"><span class="sdot" aria-hidden="true">${STEP_ICON[x.status] || '○'}</span><span><b>${esc(x.label)}</b>${x.date ? ` <span class="small">${esc(fmtLong(x.date))}</span>` : ''}${x.note ? `<br><span class="small">${escGl(x.note)}</span>` : ''}${src(x.source_url)}</span></li>`).join('')}</ol>
        ${t.what_next ? `<p><b>What happens next:</b> ${escGl(t.what_next)}</p>` : ''}</section>
      ${t.slug === 'budget-2027' ? `<section class="card" id="assessment"><h2>Your BC Assessment notice (early January)</h2>
        <p>BC Assessment mails every owner a notice in early January with the property’s value as of July 1 of the year before.${src('https://info.bcassessment.ca/', 'BC Assessment')}</p>
        <p><b>Your assessment doesn’t set your tax bill by itself.</b> Council decides how much money to raise in the budget, then sets tax rates in the spring. What matters is how your value changed compared with the average home in Squamish: if yours went up more than average, your share of the tax goes up a bit more; if less, a bit less.</p>
        <p>Think your value is wrong? You can ask BC Assessment to review it. The deadline is usually January 31, and it’s printed on your notice.${src('https://info.bcassessment.ca/', 'BC Assessment')}</p>
        <p class="small">More: <a href="/how-council-works/#first-100-days">the new council’s first 100 days</a>, including when the budget and tax rates are voted on.</p></section>` : ''}
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
  // Openly licensed photos (Wikimedia Commons and similar), always with the photographer and licence.
  const photo = (st, eager = false) => (st.photo ? `<figure class="nw-photo"><img src="${esc(eager ? st.photo.file : newsThumb(st.photo.file, 800))}" alt="${esc(st.photo.alt)}" width="1200" height="800"${eager ? '' : ' loading="lazy"'}><figcaption>${esc(st.photo.caption)} <span>Photo: <a href="${esc(st.photo.link)}" target="_blank" rel="noopener">${esc(st.photo.credit)}</a></span></figcaption></figure>` : '');
  const visual = (st) => {
    const v = st.visual; if (!v) return '';
    if (v.type === 'bars') return `<div class="nw-panel">${nBars(v.rows, v.title, v.note)}</div>`;
    if (v.type === 'bars+faces') return nBars(v.rows) + nFaces();
    if (v.type === 'big') return `<div class="nw-big">${esc(v.big)}<small>${esc(v.small)}</small></div>`;
    if (v.type === 'map') return `<figure class="nw-map"><img src="${esc(v.img)}" alt="${esc(v.alt)}" width="1280" height="800" loading="lazy"><figcaption>${esc(v.cap)} Map data © OpenStreetMap contributors.</figcaption></figure>`;
    return '';
  };
  const dekHtml = (st) => (st.html ? st.dek : esc(st.dek)); // hand-written stories may carry links; drafted ones are plain text
  const ogUrl = (st) => `${ORIGIN}/news/og/${st.og || `${st.slug}.jpg`}?v=2`;
  const take = (st) => (st.take ? `<p class="nw-take"><b>What changes</b>${st.take}</p>` : '');
  const source = (st) => `<p class="nw-src">Source: <a href="${esc(st.src[1])}" target="_blank" rel="noopener">${esc(st.src[0])}</a></p>`;
  const shareBtn = (st) => `<button class="nw-share no-print" type="button" data-nw-share="${esc(ORIGIN + nUrl(st))}" data-title="${esc(st.head)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>Share</button>`;
  const foot = (st) => `<div class="nw-foot">${source(st)}${shareBtn(st)}</div>`;
  const hLink = (st, tag = 'h2') => `<${tag} class="nw-h"><a href="${nUrl(st)}">${esc(st.head)}</a></${tag}>`;
  const attrs = (st, cls) => `class="${cls}" data-s="${st.s}"`;
  const story = (st) => {
    if (st.tier === 'lead') return `<article ${attrs(st, st.visual && st.visual.type === 'bars' ? 'nw-lead' : 'nw-lead solo')}>${photo(st, true)}${kicker(st)}${hLink(st)}${visual(st)}<p class="nw-dek">${esc(st.dek)}</p>${take(st)}${foot(st)}</article>`;
    if (st.tier === 'feature') return `<article ${attrs(st, 'nw-feature')}>${photo(st)}${kicker(st)}${hLink(st)}<p class="nw-dek">${esc(st.dek)}</p>${visual(st)}${take(st)}${foot(st)}</article>`;
    if (st.tier === 'brief') return `<article ${attrs(st, 'nw-brief')}>${kicker(st)}${hLink(st, 'h3')}<p class="nw-dek">${dekHtml(st)}</p>${foot(st)}</article>`;
    const isMap = st.visual && st.visual.type === 'map';
    return `<article ${attrs(st, 'nw-card')}>${isMap ? visual(st) : photo(st)}${kicker(st)}${hLink(st, 'h3')}${isMap ? '' : visual(st)}<p class="nw-dek">${esc(st.dek)}</p>${take(st)}${foot(st)}</article>`;
  };
  const chips = `<div class="nw-chips-wrap no-print"><div class="nw-chips" role="group" aria-label="Show stories about">
    <button type="button" class="nw-chip" aria-pressed="true" data-f="all">All</button>${NEWS.sections.filter(([k]) => NEWS.stories.some((s) => s.s === k)).map(([k, l]) => `<button type="button" class="nw-chip" aria-pressed="false" data-f="${k}" data-s="${k}"><i></i>${esc(l)}</button>`).join('')}</div></div>`;
  const cal = (d) => { const x = new Date(d + 'T12:00:00'); return `<div class="nw-cal" aria-hidden="true"><span>${x.toLocaleDateString('en-CA', { month: 'short' }).replace('.', '')}</span><b>${x.getDate()}</b></div>`; };
  const coming = `<section class="nw-coming"><h2 class="nw-rail-h">Coming up</h2><ol>${NEWS.coming.map((c) => `<li data-until="${c.date}">${cal(c.date)}<div><a href="${esc(c.url)}"${isUrl(c.url) ? ' target="_blank" rel="noopener"' : ''}>${esc(c.title)}</a><p>${esc(fmtLong(c.date))}. ${esc(c.text)}</p></div></li>`).join('')}</ol><p class="nw-more"><a href="/meetings/">All council meetings →</a></p></section>`;
  // Newest first. The lead is the newest big story near the top; the rest fall into Latest and Earlier by date.
  const S = [...NEWS.stories].sort((a, b) => b.date.localeCompare(a.date));
  const main = S.filter((s) => s.tier !== 'brief'), briefs = S.filter((s) => s.tier === 'brief').slice(0, 5);
  const leadSt = main.slice(0, 3).find((s) => s.tier === 'lead') || main[0];
  const featSt = main.slice(0, 6).find((s) => s !== leadSt && (s.tier === 'feature' || s.tier === 'lead'));
  const asTier = (st, tier) => (st ? { ...st, tier } : null);
  const lead = [asTier(leadSt, 'lead')].filter(Boolean), feat = [asTier(featSt, 'feature')].filter(Boolean);
  const rest = main.filter((s) => s !== leadSt && s !== featSt).map((s) => asTier(s, 'card'));
  const latestCards = rest.slice(0, feat.length ? 2 : 4), earlierCards = rest.slice(latestCards.length, latestCards.length + 14);

  write('/news/', page({
    url: '/news/', title: 'Squamish news',
    updated: [...(NEWS.stories || []).map((x) => isoDay(x.date)).filter((x) => x <= TODAY), corrDate('/news/')].filter(Boolean).sort().pop() || null,
    desc: 'Short Squamish news from the public record: District releases, council agendas, election results and local announcements, in plain words with the source for every story.',
    image: `${ORIGIN}/news/og/index.jpg?v=3`,
    jsonld: crumbLd([['Home', '/'], ['News', '/news/']]),
    body: `<div class="nw">
  <header class="nw-top"><h1>Squamish news</h1>
    <p class="nw-lede">Short updates from the public record, each with its source. For what council decided and how each member voted, see <a href="/meetings/">Meetings</a>.</p></header>
  ${chips}
  <div class="nw-layout">
    <div class="nw-main">
      <section class="nw-group" data-group="latest"><h2 class="nw-sechead">Latest</h2><div class="nw-cards" data-nw-live hidden></div>
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
    <p>An AI model (Anthropic’s Claude) reads District news releases, council agendas, regional district notices, Elections BC and local announcements, and drafts a short story about each one. A person reads every draft, fixes it if needed and approves it before it goes up. Every story names its source. No opinions and no endorsements. Spot a mistake? <a href="mailto:${esc(SITE.contact)}?subject=News%20correction">Tell us</a> and we’ll fix it and note it on the <a href="/corrections/">corrections page</a>.</p></section>
</div>`,
    scripts: '<script src="/news.js"></script>',
  }));

  // Template for stories approved but not built yet: api/news-live.js fills it in (so they're live the moment Jeff approves).
  write('/news/_live/', page({
    url: '/news/_live/', title: '__LIVE_TITLE__', desc: '__LIVE_DESC__', noindex: true,
    body: `<div class="nw nw-story-page">
  <p class="crumbs"><a href="/news/">← All news</a></p>
  <article class="nw-full" data-s="__LIVE_S__"><!--LIVE_BODY--></article>
  <section class="nw-next"><h2 class="nw-sechead">More news</h2><ul>${S.slice(0, 4).map((o) => `<li data-s="${o.s}"><span>${esc(SEC[o.s])}</span><a href="${nUrl(o)}">${esc(o.head)}</a></li>`).join('')}</ul>
  <p class="nw-more"><a href="/news/">All news →</a> · <a href="/meetings/">What council decided →</a></p></section>
  ${signupBox('news-story')}
</div>`,
    scripts: '<script src="/news.js"></script>',
  }));

  S.forEach((st, i) => {
    const others = S.filter((x) => x !== st).slice(0, 4);
    const body = st.tier === 'lead'
      ? `${kicker(st)}<h1 class="nw-h">${esc(st.head)}</h1>${photo(st, true)}<p class="nw-dek">${esc(st.dek)}</p>${visual(st)}${take(st)}`
      : `${kicker(st)}<h1 class="nw-h">${esc(st.head)}</h1>${st.visual && st.visual.type === 'map' ? visual(st) : photo(st, true)}<p class="nw-dek">${dekHtml(st)}</p>${st.visual && st.visual.type !== 'map' ? visual(st) : ''}${take(st)}`;
    write(nUrl(st), page({
      url: nUrl(st), title: st.head,
      desc: st.dek.replace(/<[^>]+>/g, ''),
      image: ogUrl(st),
      jsonld: [crumbLd([['Home', '/'], ['News', '/news/'], [st.head, nUrl(st)]]), { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: st.head, datePublished: st.date, inLanguage: 'en-CA', image: ogUrl(st), author: { '@type': 'Person', name: 'Jeff Kirdeikis', url: `${ORIGIN}/about/` }, publisher: { '@type': 'Organization', name: 'Squamish Voters', url: `${ORIGIN}/` }, isBasedOn: st.src[1] }],
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

// ---------- HAVE YOUR SAY (/have-your-say/) ----------
// Residents vote on the same questions council will decide. The agenda pipeline writes "ask", "yes_means" and "no_means"
// on agenda items council will vote on; each becomes a question here, open until the meeting starts. Votes are stored by
// api/have-your-say.js, which reads questions.json to know what is open. After the meeting the result stays up, next to
// a link to how council voted. SV_VOTE_TEST=1 at build time adds a test question (preview deployments only).
{
  const Q = HAVE_Q;
  fs.mkdirSync(path.join(DIST, 'have-your-say'), { recursive: true });
  const qJson = JSON.stringify({ updated: new Date().toISOString(), questions: Q });
  fs.writeFileSync(path.join(DIST, 'have-your-say', 'questions.json'), qJson);
  fs.writeFileSync(path.join(ROOT, 'api', '_questions.json'), JSON.stringify({ questions: Q }) + '\n'); // bundled into api/have-your-say.js (kept in git so the import always resolves)
  const next = upcoming.find((m) => m.type !== 'inaugural');
  write('/have-your-say/', page({
    url: '/have-your-say/', title: 'Have your say: vote on what Squamish council votes on',
    desc: 'Vote yes or no on the same questions the Squamish mayor and council are about to decide, then see how residents voted next to how council voted.',
    jsonld: crumbLd([['Home', '/'], ['Have your say', '/have-your-say/']]),
    body: `<div class="hy">
  <h1>Have your say</h1>
  <p class="lede">Vote on the same questions the mayor and council are about to decide. You see the results as soon as you vote, and after the meeting you can compare them with how council voted.</p>
  <div class="hy-area card"><label class="fld">Your neighbourhood <span class="small muted">(optional, so we can show how each area voted)</span><select data-hy-area><option value="">Choose your neighbourhood</option>${HOODS.map((h) => `<option value="${esc(h.slug)}">${esc(h.name)}</option>`).join('')}<option value="outside">Outside Squamish</option></select></label></div>
  <div data-hy-open></div>
  <div data-hy-empty hidden class="card hy-empty"><h2>No questions open right now</h2><p>Questions go up as soon as the District posts a meeting agenda, usually the Thursday before.${next ? ` The next council meeting is <a href="${mUrl(next)}">${esc(fmtDay(next.date))}</a>.` : ''} Get the Friday email and we’ll tell you when there’s something to vote on.</p></div>
  <section data-hy-closed-wrap hidden><h2>After the meeting</h2><p class="small">How residents voted. Tap through to see how council voted on the same question.</p><div data-hy-closed></div></section>
  <section class="card"><h2>How it works</h2>
  <ol class="hy-steps">
    <li><b>One vote per question</b> from each phone or computer. You can change it until the meeting starts, then voting closes.</li>
    <li><b>The questions come from the official agenda</b>, written as neutral yes or no questions, with what each answer would mean.</li>
    <li><b>No one sees how you voted.</b> We only show totals, and a neighbourhood’s split only once ${20} people from it have voted.</li>
    <li><b>Comments are public, without names.</b> Each one shows next to the answer its writer picked. Comments are checked before they show: no personal attacks, hate, threats, private details, spam or off-topic posts. Sharp criticism of a decision or a vote is welcome. Readers can report a comment, and three reports hide it.</li>
    <li><b>This is not a scientific poll.</b> It shows what the people who chose to vote think, nothing more.</li>
  </ol></section>
  ${signupBox('have-your-say')}
</div>
<script type="application/json" id="hy-data">${JSON.stringify({ questions: Q, hoods: Object.fromEntries([...HOODS.map((h) => [h.slug, h.name]), ['outside', 'Outside Squamish']]) }).replace(/</g, '\\u003c')}</script>`,
    scripts: '<script src="/vote.js" defer></script>',
  }));
}

// ---------- WHAT SQUAMISH WANTS (/wants/ and /wants/<ask>/) ----------
// The full list is the front door (answer right on each row; totals open once you answer or tap). Each starter ask also
// gets its own page, the same list opened on that ask, so it can be shared on Facebook with its own title.
// Residents' asks are shared as /wants/<r-id>/ too: vercel.json sends those to api/wants-page.js, which serves this /wants/ page
// with that ask's title and picture. Each ask's share picture is drawn by api/og.js (the question and its answer buttons).
// api/_wants.json tells the API which starter ids and neighbourhoods exist.
{
  fs.writeFileSync(path.join(ROOT, 'api', '_wants.json'), JSON.stringify({ topics: WANTS.topics, hoods: WANT_HOODS.filter((h) => h.slug !== 'outside').map((h) => h.slug), hoodNames: Object.fromEntries(WANT_HOODS.filter((h) => h.slug !== 'outside').map((h) => [h.slug, h.name])), asks: WANTS.asks.map(({ id, title, why, options, status }) => ({ id, title, why, ...(status === 'done' ? { status } : {}), ...(options ? { options: options.map((o) => o.key), labels: options.map((o) => o.label) } : {}) })) }) + '\n');
  // Live pictures: the main page shows the 3 most wanted asks, a question's page shows its results (api/og.js). Facebook keeps
  // its own copy per address, so these refresh when it re-reads the page; a share from the site's buttons is always fresh.
  const IMG = `${ORIGIN}/api/og/?top=1&v=3`;
  const askImg = (a) => ({ image: `${ORIGIN}/api/og/?id=${a.id}&live=1&v=3`, imageAlt: `What Squamish Wants: ${a.title}` });
  const body = (focus) => `<div class="wa" data-wants="page">
  <header class="wa-head">
    <h1>What Squamish Wants</h1>
    <p class="wa-lede">Say yes, no or don’t mind on what Squamish should do. Tap any ask to see what everyone said.</p>
    <p class="wa-people" data-wa-people aria-live="polite"></p>
    <p class="wa-live" data-wa-live hidden></p>
    <p class="wa-note">Independent, not the District. Not a scientific poll. <a href="#wa-how">How it works ›</a></p>
  </header>
  <div class="wa-layout">
  <div class="wa-main">
  <div class="wa-tabs" role="tablist" data-wa-tabs>
    <button type="button" role="tab" data-view="list" aria-selected="true">List</button>
    <button type="button" role="tab" data-view="one" aria-selected="false">One by one</button>
    <button type="button" role="tab" data-view="top" aria-selected="false">Top 10<span data-wa-lock> 🔒</span></button>
    <button type="button" role="tab" class="wa-tab-add" data-view="add" aria-selected="false">+ Add</button>
  </div>
  <div data-pane="list">
    <div class="wa-filters" role="group" aria-label="Show">
      <label class="wa-areachip"><span class="visually-hidden">Your area</span><select data-wa-area aria-label="Your area"><option value="">📍 Your area</option>${WANT_HOODS.map((h) => `<option value="${esc(h.slug)}">📍 ${esc(h.name)}</option>`).join('')}</select></label>
      <button type="button" class="wa-f" data-topic="all" aria-pressed="true">All</button>
      <button type="button" class="wa-f" data-topic="near" aria-pressed="false">Near you</button>
      <button type="button" class="wa-f" data-topic="todo" aria-pressed="false">Not answered</button>
    </div>
    <div class="wa-sortrow"><span class="small muted" data-wa-count>${WANTS_N} asks</span>
      <span class="wa-selects"><label class="small"><span class="visually-hidden">Topic</span><select data-wa-topic aria-label="Topic"><option value="all">All topics</option>${WANTS.topics.map((t) => `<option value="${t.key}">${esc(t.short || t.label)}</option>`).join('')}</select></label>
      <label class="small"><span class="visually-hidden">Sort</span><select data-wa-sort aria-label="Sort"><option value="wanted">Most wanted</option><option value="split">Most split</option><option value="voted">Most answered</option><option value="newest">Newest</option></select></label></span></div>
    <ul class="wa-rows" data-wa-rows>${wantsStatic(WANTS.asks)}</ul>
    <div class="wa-listfoot"><p><b>Missing something?</b> Add what you want Squamish to do. We check it against the list first.</p><button type="button" class="btn secondary" data-view="add">Add it</button></div>
    <section class="card wa-addfoot" data-wa-addfoot aria-label="Add an ask"></section>
  </div>
  <div data-pane="one" hidden><div data-wa-one></div></div>
  <div data-pane="top" hidden><div data-wa-top></div></div>
  <div data-pane="add" hidden><div class="card wa-addbox" data-wa-add></div></div>
  </div>
  <aside class="wa-rail" aria-label="Your progress and the most wanted asks">
    <section class="card wa-railcard" data-wa-railprog></section>
    <section class="card wa-railcard" data-wa-board aria-live="polite"></section>
  </aside>
  </div>
  <div class="wa-fixed">
    <div class="wa-sheet" data-wa-sheet hidden role="dialog" aria-live="polite"></div>
    <div class="wa-float" data-wa-float hidden></div>
  </div>
  ${focus && WANT_INFO[focus] ? (() => { const a = WANTS.asks.find((x) => x.id === focus), inf = WANT_INFO[focus]; return `<section class="card wi-sec wa-about"><h2>About this question</h2><p><b>${esc(a.title)}</b></p>${(inf.intro || []).slice(0, 2).map((x) => `<p>${esc(x)}</p>`).join('')}<p><a href="/wants/${a.id}/info/">The full background: key facts, the case for each answer, and sources ›</a></p></section>`; })() : ''}
  <section class="card wa-how" id="wa-how"><h2>How it works</h2>
    <ul>
      <li><b>One answer per ask</b> from each phone or computer. Tap the same answer again to take it back, or pick another to change it.</li>
      <li><b>Answering twice doesn’t work.</b> No sign up, so here is how repeats are stopped: answers sent by a script instead of a real browser are turned away; a private window or cleared browser on the same phone or computer is recognised and not counted again; and each internet connection can add only 8 answers to any one ask, enough for a busy household. Someone determined could still answer from a second device, so treat close results with care.</li>
      <li><b>Most wanted</b> ranks asks by the share of yes among people who said yes or no. “Don’t mind” is counted and shown, but left out of that share, so an ask that matters to one neighbourhood isn’t buried by people it doesn’t affect.</li>
      <li><b>Starter asks come from the public record</b>, each with a source. Asks added by residents are marked, with the resident’s own words underneath. Before an ask is added we check it against the list so the same idea isn’t added twice.</li>
      <li><b>No one sees how you answered.</b> We show totals only, and a neighbourhood’s answers only once 5 people from it have answered.</li>
      <li><b>This is not a scientific poll.</b> It shows what the people who chose to answer think. Nothing here is sent to council; it is public for anyone to see, council included.</li>
    </ul></section>
  ${signupBox('wants')}
</div>
${wantsData({ focus, said: null })}`;
  write('/wants/', page({
    url: '/wants/', title: 'What Squamish Wants: say yes or no to local asks', image: IMG,
    desc: `Pickleball courts, the encampment, speed humps, a bus to Vancouver: specific asks from residents. Say yes, no or don’t mind, see what Squamish said, and add your own.`,
    jsonld: crumbLd([['Home', '/'], ['Your say', '/your-say/'], ['What Squamish Wants', '/wants/']]),
    body: body(null), scripts: '<script src="/botid.js" defer></script><script src="/wants.js" defer></script>',
  }));
  for (const a of WANTS.asks) write(`/wants/${a.id}/`, page({
    url: `/wants/${a.id}/`, title: a.title.endsWith('?') ? a.title : `${a.title}?`, ...askImg(a),
    desc: `${a.why} Say yes, no or don’t mind, and see what Squamish said.`,
    jsonld: crumbLd([['Home', '/'], ['What Squamish Wants', '/wants/'], [a.title, `/wants/${a.id}/`]]),
    body: body(a.id), scripts: '<script src="/botid.js" defer></script><script src="/wants.js" defer></script>',
  }));
  // More info: /wants/<id>/info/, the background on one ask, with the answer buttons at the bottom.
  const sup = (inf, n) => (n && inf.sources[n - 1] ? `<sup><a href="#src-${n}" aria-label="Source ${n}">${n}</a></sup>` : '');
  for (const a of WANTS.asks) {
    const inf = WANT_INFO[a.id]; if (!inf) continue;
    const st = WANT_STATUS[a.status] || WANT_STATUS.none, hood = WANT_HOODS.find((h) => h.slug === a.area);
    const answers = a.options ? a.options.map((o) => o.label) : ['Yes', 'No'];
    const sides = answers.map((lab) => ({ lab, s: (inf.sides || []).find((x) => x.answer.toLowerCase() === lab.toLowerCase()) })).filter((x) => x.s && x.s.points?.length);
    const checked = inf.checked ? new Date(inf.checked + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
    write(`/wants/${a.id}/info/`, page({
      url: `/wants/${a.id}/info/`, title: `${a.title.replace(/\?$/, '')}${/squamish/i.test(a.title) ? '' : ' in Squamish'}: the background`, ...askImg(a),
      desc: `${(inf.intro || [])[0] || a.why || ''}`,
      jsonld: [crumbLd([['Home', '/'], ['What Squamish Wants', '/wants/'], [a.title, `/wants/${a.id}/`], ['More info', `/wants/${a.id}/info/`]]),
        { '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: (inf.intro || [])[0] || a.why || '', image: askImg(a).image,
          ...(inf.checked ? { datePublished: inf.published || inf.checked, dateModified: inf.checked } : {}), inLanguage: 'en-CA', about: { '@type': 'Place', name: hood ? `${hood.name}, Squamish, BC` : 'Squamish, BC' },
          author: { '@type': 'Person', name: 'Jeff Kirdeikis', url: `${ORIGIN}/about/` }, publisher: { '@type': 'Organization', name: SITE.name, url: ORIGIN, logo: { '@type': 'ImageObject', url: `${ORIGIN}/icon-512.png` } },
          mainEntityOfPage: `${ORIGIN}/wants/${a.id}/info/`, citation: (inf.sources || []).map((x) => x.url) },
        ...(inf.questions?.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: inf.questions.map((q) => ({ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: q.a } })) }] : [])],
      body: `<article class="wi">
  <p class="wi-crumb"><a href="/wants/">What Squamish Wants</a> › More info</p>
  <p class="wa-chips"><span class="wa-chip ${st.cls}">${esc(st.label)}</span>${hood ? `<span class="wa-chip area">${esc(hood.name)}</span>` : ''}</p>
  <h1>${esc(a.title)}</h1>
  <p class="wi-meta small muted">The background, so you can decide for yourself.${checked ? ` Facts checked ${esc(checked)}.` : ''}</p>
  ${inf.district ? `<p class="wi-district"><b>The District’s own page on this:</b> <a href="${esc(inf.district.url)}" target="_blank" rel="noopener">${esc(inf.district.label)} ›</a> Its official surveys and meetings are posted there. Answering here does not replace them.</p>` : ''}
  <a class="btn wi-jump" href="#answer">Skip to answering</a>
  <div class="wi-intro">${(inf.intro || []).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
  ${inf.facts?.length ? `<section class="card wi-sec"><h2>Key facts</h2><dl class="wi-facts">${inf.facts.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}${sup(inf, f.src)}</dd></div>`).join('')}</dl></section>` : ''}
  <section class="card wi-sec"><h2>Where it stands</h2><p><span class="wa-chip ${st.cls}">${esc(st.label)}</span> ${esc(st.explain)}</p><p><b>Who decides:</b> ${a.who === 'province' ? 'The Province. Council can press for it.' : 'Squamish council.'}</p></section>
  ${a.options ? `<section class="card wi-sec"><h2>What each answer would mean</h2><ul class="wi-means">${a.options.map((o, i) => `<li><i class="dot o${i + 1}"></i><span><b>${esc(o.label)}</b>${esc(o.means || '')}</span></li>`).join('')}</ul></section>` : ''}
  ${sides.length ? `<section class="wi-sec"><h2>The case for each answer</h2><p class="small muted">The strongest honest case for each side, as people who hold it would put it.</p><div class="wi-sides n${sides.length}">${sides.map((x) => `<div class="card wi-side"><h3>${esc(x.lab)}</h3><ul>${x.s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`).join('')}</div></section>` : ''}
  ${inf.timeline?.length ? `<section class="card wi-sec"><h2>How we got here</h2><ol class="wi-time">${inf.timeline.map((t) => `<li><b>${esc(t.when)}</b><span>${esc(t.what)}${sup(inf, t.src)}</span></li>`).join('')}</ol></section>` : ''}
  ${inf.questions?.length ? `<section class="card wi-sec"><h2>Questions people ask</h2>${inf.questions.map((q) => `<details class="wi-q"><summary>${esc(q.q)}</summary><p>${esc(q.a)}${sup(inf, q.src)}</p></details>`).join('')}</section>` : ''}
  <section class="wi-answer" id="answer">
    <div class="card wa-short" data-wants="short" data-only="${esc(a.id)}"><p class="wa-kicker">Ready to decide?</p><h2>Your answer</h2><p class="small">Tap to answer, then see what Squamish said. Tap your answer again to take it back.</p><ul class="wa-rows" data-wa-rows>${wantsStatic([a])}</ul>
    <a class="btn secondary block" href="/wants/">See every ask</a></div>
  </section>
  <section class="wi-sec wi-more"><h2>More background</h2><ul>${WANTS.asks.filter((x) => x.id !== a.id && WANT_INFO[x.id]).map((x) => `<li><a href="/wants/${x.id}/info/">${esc(x.title)}</a></li>`).join('')}</ul></section>
  ${inf.sources?.length ? `<section class="wi-sec wi-srcs"><h2>Sources</h2><ol>${inf.sources.map((x, i) => `<li id="src-${i + 1}"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a></li>`).join('')}</ol><p class="small muted">Spot something wrong or out of date? Email <a href="mailto:${SITE.contact}">${SITE.contact}</a>.</p></section>` : ''}
</article>
${wantsData()}`,
      scripts: '<script src="/botid.js" defer></script><script src="/wants.js" defer></script>',
    }));
  }
}

// ---------- YOUR SAY (/your-say/): the hub for every place residents weigh in ----------
write('/your-say/', page({
  url: '/your-say/', title: 'Your say: tell Squamish council what you think',
  desc: 'Every way to weigh in on Squamish Voters: say what you want Squamish to do, vote before council votes, and see readers’ top issues.',
  jsonld: crumbLd([['Home', '/'], ['Your say', '/your-say/']]),
  body: `<h1>Your say</h1>
  <p class="lede">Council decides. Here’s where you tell them, and everyone else, what you think.</p>
  <div class="ys-doors">
    <a class="ys-door hi" href="/wants/"><span class="cc-ico">${ICON.hand}</span><b>What Squamish Wants <span class="cc-new">New</span></b><span>Say yes, no or don’t mind on specific asks, from pickleball courts to the encampment. Add your own.</span></a>
    <a class="ys-door" href="/have-your-say/"><span class="cc-ico">${ICON.ballot}</span><b>Before council votes${HAVE_SAY_OPEN ? ` <span class="cc-new">${HAVE_SAY_OPEN} open</span>` : ''}</b><span>${HAVE_SAY_OPEN ? `Vote on ${HAVE_SAY_OPEN} question${HAVE_SAY_OPEN === 1 ? '' : 's'} council is about to decide.` : 'Vote on the questions council is about to decide. They open when the agenda comes out.'}</span></a>
    <a class="ys-door" href="/priorities/"><span class="cc-ico">${ICON.compare}</span><b>Readers’ top issues</b><span>The big topics readers of the Friday email care about most.</span></a>
  </div>
  ${wantsShort('hub')}
  ${wantsData()}`,
  scripts: '<script src="/botid.js" defer></script><script src="/wants.js" defer></script>',
}));

// ---------- NEIGHBOURHOODS (/neighbourhoods/ and /neighbourhoods/<slug>/) ----------
// ---------- TODAY (/today/) ----------
// Squamish right now: weather, Highway 99, wind at the Spit, river, air and avalanche danger. A daily reason to open
// the site; council stays the main event. The page is a shell that src/today.js fills from api/today.js (cached 5 min).
{
  // Category buttons above the cards (Jeff, Oct 28): on phones the cards sit side by side and swipe left and right,
  // and a button slides to its card; on wider screens the cards stay in a grid and a button scrolls down to it.
  const TD_CATS = [['weather', '☁️', 'Weather'], ['highway', '🛣️', 'Highway'], ['wind', '🪁', 'Wind'], ['tide', '🌊', 'Tides'], ['rock', '🧗', 'Rock'], ['river', '🏞️', 'River'], ['air', '🌬️', 'Air'], ['avalanche', '🏔️', 'Avalanche']];
  const card = (k, title, ico, src) => `<section class="td-card" id="t-${k}" data-td="${k}" aria-labelledby="td-${k}"><h2 id="td-${k}"><span class="td-ico" aria-hidden="true">${ico}</span>${title}</h2>
    <div class="td-body" data-body><p class="td-wait">Loading…</p></div>
    <p class="td-src">${src}</p></section>`;
  write('/today/', page({
    url: '/today/', title: 'Squamish weather, Highway 99 and tides today',
    desc: 'Squamish weather now and for 14 days, Highway 99 conditions, tides, wind at the Spit, is the rock dry at the Chief, the Squamish River, air quality and avalanche danger, on one page.',
    jsonld: crumbLd([['Home', '/'], ['Squamish today', '/today/']]),
    body: `<div class="td">
  <header class="td-top"><h1>Squamish weather, Highway 99 and tides today</h1><p class="lede">Weather, the highway, tides, wind, the rock, the river and the air, on one page. Updated every few minutes from public sources.</p><p class="small muted" data-td-at></p></header>
  <div class="td-alerts" data-td-alerts hidden></div>
  <nav class="chapters td-chips no-print" aria-label="Jump to a category">${TD_CATS.map(([k, ico, label], n) => `<a href="#t-${k}" data-tdc="${k}"${n ? '' : ' class="on" aria-current="true"'}><span aria-hidden="true">${ico}</span> ${label}</a>`).join('')}</nav>
  <p class="td-swipe no-print" aria-hidden="true"><span data-td-pos>1 of ${TD_CATS.length}</span> · Swipe sideways or tap a category</p>
  <div class="td-grid">
  ${card('weather', 'Weather', '☁️', 'Now and next hours: <a href="https://weather.gc.ca/en/location/index.html?coords=49.702,-123.156" target="_blank" rel="noopener">Environment Canada</a>, Squamish Airport. 14 days: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>')}
  ${card('highway', 'Highway 99', '🛣️', 'Horseshoe Bay to Whistler. Source: <a href="https://www.drivebc.ca/" target="_blank" rel="noopener">DriveBC</a>')}
  ${card('wind', 'Wind at the Spit', '🪁', 'Forecast from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (the same weather models Windy uses). Live readings: <a href="https://squamishwindsports.com/conditions/wind/" target="_blank" rel="noopener">Squamish Windsports Society</a>')}
  ${card('tide', 'Tides', '🌊', 'Squamish harbour, predicted. Source: <a href="https://www.tides.gc.ca/en/stations/07811" target="_blank" rel="noopener">Canadian Hydrographic Service</a>')}
  ${card('rock', 'Is the rock dry?', '🧗', 'Rough guide from rain at the Stawamus Chief. Source: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> hourly rainfall, past 2 days and next 12 hours')}
  ${card('river', 'Squamish River', '🏞️', 'Gauge near Brackendale. Source: <a href="https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08GA022" target="_blank" rel="noopener">Water Survey of Canada</a>, live and daily records since 1922')}
  ${card('air', 'Air quality', '🌬️', 'Squamish monitor. Source: <a href="https://weather.gc.ca/airquality/pages/bcaq-007_e.html" target="_blank" rel="noopener">Environment Canada</a>')}
  ${card('avalanche', 'Avalanche danger', '🏔️', 'Sea to Sky backcountry. Source: <a href="https://avalanche.ca/" target="_blank" rel="noopener">Avalanche Canada</a>')}
  </div>
  <section class="card td-go"><h2>Before you go</h2><ul>
    <li><b>Parking at the Chief:</b> the lots are day use only, fill early on nice days, and illegally parked cars can be towed. <a href="https://bcparks.ca/explore/parkpgs/stawamus/" target="_blank" rel="noopener">BC Parks: Stawamus Chief</a></li>
    <li><b>Brennan Park hours:</b> pool, ice and gym times change with the season and holidays. <a href="https://squamish.ca/brennan-park-recreation-centre" target="_blank" rel="noopener">District of Squamish: Brennan Park</a></li></ul></section>
  <section class="card td-a2hs no-print"><h2>Keep it one tap away</h2><p>Add this page to your home screen and it opens like an app.</p><ul><li><b>iPhone (Safari):</b> tap the Share button <span aria-hidden="true">(the square with an arrow)</span>, then <b>Add to Home Screen</b>.</li><li><b>Android (Chrome):</b> tap the <b>⋮</b> menu, then <b>Add to Home screen</b>.</li></ul></section>
  ${signupBox('today')}
  <section class="card td-about"><h2>Where this comes from</h2><p>Everything here is free public data, read straight from the people who measure it. Wind is a forecast, not a live reading. Before you head into the backcountry or onto the water, check the source.</p><p><a href="/news/">Squamish news →</a> · <a href="/meetings/">What council decided →</a></p></section>
  </div>`,
    scripts: '<script src="/today.js"></script>',
  }));
}

// One page per neighbourhood: council decisions tagged with it, District development projects, issues we follow and news,
// around a map. Boundaries and projects come from the District's open map data (scripts/pipeline/places.mjs).
{
  const NB = fs.existsSync(path.join(ROOT, 'data', 'neighbourhoods.json')) ? read('neighbourhoods.json') : { neighbourhoods: [] };
  const DV = fs.existsSync(path.join(ROOT, 'data', 'developments.json')) ? read('developments.json') : { developments: [] };
  const HOODLIST = NB.neighbourhoods;
  const KEEP_UPPER = new Set(['BCR', 'DPA', 'OCP', 'SFU', 'BC', 'II', 'III', 'IV', 'A', 'B', 'C', 'D', 'E', 'O']);
  const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z0-9][a-z0-9']*)/g, (w) => (KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));
  const hUrl = (h) => `/neighbourhoods/${h.slug}/`;
  const STATUS_CLS = { 'Under review': 'st-review', Approved: 'st-ok', 'Application received': 'st-new' };
  const devsIn = (slug) => DV.developments.filter((d) => d.area === slug);
  const decisionsIn = (slug) => DECISIONS.filter((d) => (d.areas || []).includes(slug));
  const comingIn = (slug) => upcoming.flatMap((m) => (m.agenda_items || []).filter((a) => (a.areas || []).includes(slug)).map((a) => ({ a, m })));
  const issuesIn = (slug) => TRACKED.filter((t) => (t.areas || []).includes(slug));
  const newsIn = (slug) => NEWS.stories.filter((s) => (s.areas || []).includes(slug)).sort((a, b) => b.date.localeCompare(a.date));
  const homes = (n) => n.toLocaleString('en-CA');
  const devRow = (d) => `<li class="hd-dev" data-dev="${esc(d.name)}"><b>${esc(titleCase(d.name))}</b>
    <span class="hd-tags"><span class="hd-st ${STATUS_CLS[d.status] || ''}">${esc(d.type)}: ${esc(d.status.toLowerCase())}</span>${d.homes ? `<span class="hd-homes">${homes(d.homes)} home${d.homes === 1 ? '' : 's'} planned</span>` : ''}</span>
    <span class="small muted">${[d.address ? titleCase(d.address) : '', d.housing.map((h) => h.toLowerCase()).join(', ')].filter(Boolean).map(esc).join(' · ')}</span></li>`;
  const mapData = (list, devs) => JSON.stringify({
    hoods: list.map((h) => ({ slug: h.slug, name: h.name, outline: h.outline, centre: h.centre, url: hUrl(h) })),
    devs: devs.map((d) => ({ name: titleCase(d.name), status: d.status, type: d.type, homes: d.homes, shape: d.shape, centre: d.centre })),
  }).replace(/</g, '\\u003c');
  const MAP_ASSETS = '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script><script src="/hoodmap.js"></script>';
  const SRC_NOTE = `<p class="small muted hd-source">Boundaries and projects: <a href="https://opendata-squamish.hub.arcgis.com" target="_blank" rel="noopener">District of Squamish open data</a> (updated ${esc(fmtLong(DV.updated || NB.updated || TODAY))}). Map © OpenStreetMap contributors.</p>`;

  write('/neighbourhoods/', page({
    url: '/neighbourhoods/', title: 'Squamish neighbourhoods',
    desc: 'Pick your Squamish neighbourhood to see council decisions, development projects and news for your area, on one map.',
    jsonld: crumbLd([['Home', '/'], ['Neighbourhoods', '/neighbourhoods/']]),
    body: `<div class="hd">
  <h1>Your neighbourhood</h1>
  <p class="lede">Tap your area on the map, or pick it from the list, to see what council decided there, what is being built and the news.</p>
  <div class="hd-map hd-map-all" id="hoodmap" data-mode="all" role="img" aria-label="Map of Squamish neighbourhoods"></div>
  <script type="application/json" id="hoodmap-data">${mapData(HOODLIST, DV.developments)}</script>
  ${SRC_NOTE}
  <ul class="hd-list">${HOODLIST.map((h) => { const dv = devsIn(h.slug), n = dv.reduce((a, d) => a + d.homes, 0), dc = decisionsIn(h.slug).length; return `<li><a href="${hUrl(h)}"><b>${esc(h.name)}</b><span class="small muted">${[dv.length ? `${dv.length} project${dv.length === 1 ? '' : 's'}` : 'No big projects', n ? `${homes(n)} homes planned` : '', dc ? `${dc} decision${dc === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span><span class="go" aria-hidden="true">›</span></a></li>`; }).join('')}</ul>
</div>`,
    scripts: MAP_ASSETS,
  }));

  for (const h of HOODLIST) {
    const dv = devsIn(h.slug), dc = decisionsIn(h.slug), cu = comingIn(h.slug), is = issuesIn(h.slug), nw = newsIn(h.slug);
    const total = dv.reduce((a, d) => a + d.homes, 0);
    const others = HOODLIST.filter((x) => x !== h);
    // zero tiles are hidden; an area with nothing yet gets one plain line and its local asks move up top
    const quiet = !dc.length && !dv.length && !total;
    const wantsBox = (() => { const as = WANTS.asks.filter((a) => a.area === h.slug); return as.length ? `<section class="card"><h2>What people want for ${esc(h.name)}</h2><ul class="hd-news">${as.map((a) => `<li><a href="${WANT_INFO[a.id] ? `/wants/${a.id}/info/` : `/wants/${a.id}/`}">${esc(a.title)}</a><span class="small muted">The background, and say yes or no</span></li>`).join('')}</ul></section>` : ''; })();
    write(hUrl(h), page({
      url: hUrl(h), title: `${h.name}, Squamish: council decisions, development and news`,
      desc: `What Squamish council decided for ${h.name}, development projects planned there (${dv.length}), issues we follow and local news, on one map.`,
      jsonld: crumbLd([['Home', '/'], ['Neighbourhoods', '/neighbourhoods/'], [h.name, hUrl(h)]]),
      body: `<div class="hd">
  <p class="crumbs"><a href="/neighbourhoods/">← All neighbourhoods</a></p>
  <h1>${esc(h.name)}</h1>
  ${quiet ? `<p class="muted">Quiet so far: no council decisions and no large building projects here this term.</p>
  ${wantsBox}` : `<div class="hd-stats">
    ${dc.length ? `<div><b>${dc.length}</b><span>council decision${dc.length === 1 ? '' : 's'} this term</span></div>` : ''}
    ${dv.length ? `<div><b>${dv.length}</b><span>development project${dv.length === 1 ? '' : 's'}</span></div>` : ''}
    ${total ? `<div><b>${homes(total)}</b><span>homes planned</span></div>` : ''}
  </div>`}
  <div class="hd-map" id="hoodmap" data-mode="one" data-slug="${h.slug}" role="img" aria-label="Map of ${esc(h.name)} with development projects"></div>
  <script type="application/json" id="hoodmap-data">${mapData([h, ...others], dv)}</script>
  <p class="hd-legend small"><span class="lg st-review"></span>Under review <span class="lg st-ok"></span>Approved <span class="lg st-new"></span>Application received</p>

  <section class="card"><h2>What council decided here</h2>
  ${dc.length ? dc.slice(0, 12).map((d) => decisionCard(d, d.m)).join('') : `<p class="muted">Nothing yet. The new council’s first meeting is ${esc(fmtLong((MEETINGS.find((m) => m.type === 'inaugural') || {}).date || '2026-11-03'))}, and decisions about ${esc(h.name)} will show up here as they happen.</p>`}
  ${cu.length ? `<h3>Coming up at council</h3><ul class="mlist">${cu.map(({ a, m }) => `<li class="mrow"><a href="${mUrl(m)}"><span class="mtxt"><b class="mhead">${esc(a.plain)}</b><span class="small">${esc(fmtDay(m.date))}</span></span><span class="go" aria-hidden="true">›</span></a></li>`).join('')}</ul>` : ''}
  </section>

  <section class="card"><h2>Development projects</h2>
  ${dv.length ? `<p class="small muted">Rezonings, development permits and community plan changes the District is reviewing or has approved, biggest first.</p><ul class="hd-devs">${dv.map(devRow).join('')}</ul>` : `<p class="muted">The District’s list has no large projects in ${esc(h.name)} right now.</p>`}
  ${SRC_NOTE}</section>

  ${is.length ? `<section class="card"><h2>Issues we’re following here</h2><ul class="mlist">${is.map(issueRow).join('')}</ul></section>` : ''}

  ${nw.length ? `<section class="card"><h2>News from ${esc(h.name)}</h2><ul class="hd-news">${nw.map((s) => `<li><a href="/news/${s.slug}/">${esc(s.head)}</a><span class="small muted">${esc(fmtLong(s.date))}</span></li>`).join('')}</ul><p><a href="/news/">All Squamish news →</a></p></section>` : ''}

  ${quiet ? '' : wantsBox}

  <section class="hd-others"><h2>Other neighbourhoods</h2><p>${others.map((o) => `<a href="${hUrl(o)}">${esc(o.name)}</a>`).join(' · ')}</p></section>
</div>`,
      scripts: MAP_ASSETS,
    }));
  }
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
    url: '/this-week/', jsonld: crumbLd([['Home', '/'], ['This week at council', '/this-week/']]), title: 'This week at Squamish council',
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

// ---------- SCORECARD (promises and positions on one page; /promises/ and /said-vs-did/ redirect here) ----------
// Two tabs, Promises and Positions. Without JavaScript both sections show one after the other and the tabs are plain
// links that jump down the page; with it, only the chosen tab shows (also from ?tab=positions, where /said-vs-did/ lands).
const AI_NOTE = 'An AI model (Anthropic’s Claude) reads each vote and decides whether it tests a promise. It marks it kept or not kept and links the vote so you can check. It can be wrong. Tell us and we will fix it and note the correction.';
{
  const people = [...mayors, ...council];
  const groups = [...new Set(ALL_QUESTIONS.map((q) => q.issue))];
  const c0 = pCounts(PROMISES);
  write('/scorecard/', page({
    url: '/scorecard/', title: 'Squamish council scorecard: promises and positions',
    updated: [...PROMISES.map((p) => isoDay(p.updated)), ...DECISIONS.map((d) => isoDay(d.corrected_on)), corrDate('/scorecard/')].filter(Boolean).sort().pop() || null,
    desc: `${PROMISES.length} campaign promises and every agree or disagree answer from Squamish’s mayor and councillors, each with a source, checked against their own votes.`,
    jsonld: crumbLd([['Home', '/'], ['Scorecard', '/scorecard/']]),
    body: `<h1>Scorecard</h1>
    <p class="lede">What the mayor and councillors said during the 2026 campaign, and whether their own votes match.</p>
    <div class="notice info"><b>An AI makes the calls.</b> ${esc(AI_NOTE)} <a href="/corrections/">See every correction</a>.</div>
    <h2 id="scoreboard">At a glance</h2>
    ${noVotesNote()}
    <div class="scards">${all.map((c) => scoreCard(c)).join('')}</div>
    <nav class="sc-tabs no-print" aria-label="Scorecard sections"><a href="#promises" data-sctab="promises" aria-current="true">Promises</a><a href="#positions" data-sctab="positions">Positions</a></nav>

    <section id="promises" data-scpanel="promises">
    <h2>Promises</h2>
    <p class="small">Specific things they said they would do. Each one says in advance what <b>their part</b> is: what they move, second or vote for. Only that part gets a label.</p>
    ${ANY_VOTES ? '' : '<!--'}<div class="pstats">${Object.entries(PSTATUS).map(([k, P]) => `<button type="button" class="chip-btn" data-pf="${k}" aria-pressed="false"><span class="pstatus ${P.cls}"><span aria-hidden="true">${P.icon}</span> ${c0[k]}</span> ${esc(P.label)}</button>`).join('')}<button type="button" class="chip-btn" data-pf="" aria-pressed="true">Show all</button></div>${ANY_VOTES ? '' : '-->'}
    ${all.map((c) => { const ps = promisesOf(c); return ps.length ? `<h3 id="${c.slug}" class="phead">${avatar(c, 'sm')} <a href="/council/${c.slug}/">${esc(c.name)}</a> <span class="small">${c.office === 'mayor' ? 'Mayor' : 'Councillor'} · ${ps.length} promises</span></h3>
    <div class="card stack">${ps.map((p) => promiseRow(p).replace('<details class="promise"', `<details class="promise" data-ps="${pKey(p)}"`)).join('')}</div>` : ''; }).join('')}
    </section>

    <section id="positions" data-scpanel="positions">
    <h2>Positions: do they vote the way they said?</h2>
    <p class="small">During the campaign we asked every candidate to agree or disagree with the same ${ALL_QUESTIONS.length} statements. Here is what each of the seven winners said, and, as council votes, whether their votes went the same way.</p>
    <div class="card keybox"><div class="legend">${BINS.map((b) => `<span><span class="cell ${b[1]}">${b[3]}</span>${b[2]}</span>`).join('')}<span><span class="cell un">?</span>Didn’t say</span></div>
    <p class="small">The box is what they said during the campaign. Once a council vote tests it, a mark appears under it: <span class="vmark ps-kept">✓ voted that way</span>, <span class="vmark ps-early">… early sign</span> or <span class="vmark ps-broken">✕ voted against</span>.</p></div>
    <div class="chip-row no-print">${groups.map((g) => `<a class="chip-btn" href="#t-${g}">${esc(((ISSUES.find((i) => i.key === g) || {}).title || TOPIC_NAME[g] || g).replace(/^./, (x) => x.toUpperCase()))}</a>`).join('')}</div>
    ${groups.map((g) => { const qs = ALL_QUESTIONS.filter((q) => q.issue === g); const title = (ISSUES.find((i) => i.key === g) || {}).title || TOPIC_NAME[g] || g; return `<h3 id="t-${g}">${esc(title.charAt(0).toUpperCase() + title.slice(1))}</h3>
    ${qs.map(qCard).join('')}`; }).join('')}
    <h3 id="compass">On the map</h3>
    <p>The <a href="/compare/#compass">map on the compare page</a> places each member from their campaign answers. Once at least 3 votes test each line of a map, a second diamond shaped marker shows where their <b>votes</b> put them, joined to the first by a dotted line. A long line means they vote differently from how they campaigned.</p>
    </section>

    <h2 id="how">How we judge</h2>
    <ul>
      <li><b>We only count clear promises.</b> Something they said they would do or vote for, in their own words, with a link to where they said it. General values like “I care about Squamish” aren’t tracked.</li>
      <li><b>We only mark what they did themselves.</b> Each promise says, in advance, what their part is: how they vote, or what they move or second. That is the only thing that gets a label.</li>
      <li><b>“Did it happen?” is a plain fact, never a mark.</b> Council decides as a group, and some promises also need the Province, BC Transit, the RCMP, Woodfibre or the Squamish Nation. If a member votes the way they promised and loses, their promise is still kept.</li>
      <li><b>An AI reads the votes.</b> Every mark links the vote it came from, so you can check it yourself. Fixes are listed on the <a href="/corrections/">corrections page</a>.</li>
      <li><b>Only the official minutes can make a label red.</b> A vote heard on the meeting video shows as an <b>early sign</b> until the minutes confirm it, usually a few weeks later. When the minutes change a vote, every label is worked out again from all the votes. A position is only marked “voted against” after at least 2 confirmed votes against it.</li>
      <li><b>Each label shows its count</b>, like “Not kept (1 vote)”, or “Mixed” when their votes went both ways.</li>
      <li><b>“In progress”</b> means council has taken a step but not finished. <b>“Not tested yet”</b> means council hasn’t voted on it.</li>
      <li><b>Positions are checked the same way.</b> When a vote directly tests something a member said, like “move the Under One Roof shelter out of downtown”, we note whether their vote went the same way as what they said.</li>
    </ul>
    <p class="small">Think we got one wrong? <a href="mailto:${esc(SITE.contact)}?subject=Scorecard">Tell us</a> and we’ll fix it and note it on the <a href="/corrections/">corrections page</a>. · <a href="/about/#meetings">How meeting summaries are made</a></p>`,
    scripts: `<script>document.querySelectorAll('[data-pf]').forEach(function(b){b.addEventListener('click',function(){var f=b.getAttribute('data-pf');document.querySelectorAll('[data-pf]').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});document.querySelectorAll('details.promise').forEach(function(d){d.hidden=!!f&&d.getAttribute('data-ps')!==f})})});
(function(){var tabs=document.querySelectorAll('[data-sctab]'),panels=document.querySelectorAll('[data-scpanel]');function show(t,scroll){if(t!=='positions')t='promises';tabs.forEach(function(a){a.setAttribute('aria-current',String(a.getAttribute('data-sctab')===t))});panels.forEach(function(p){p.hidden=p.getAttribute('data-scpanel')!==t});if(scroll){var n=document.querySelector('.sc-tabs');if(n)n.scrollIntoView({block:'start'})}}
var q=(location.search.match(/[?&]tab=(\\w+)/)||[])[1],h=location.hash.slice(1),el=h&&document.getElementById(h),inPos=el&&el.closest('[data-scpanel="positions"]');show(q||(h==='positions'||inPos?'positions':'promises'),false);if(el&&h!=='promises'&&h!=='positions')el.scrollIntoView();
tabs.forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var t=a.getAttribute('data-sctab');show(t,true);history.replaceState(null,'','#'+t)})});
window.addEventListener('hashchange',function(){var h=location.hash.slice(1),el=h&&document.getElementById(h);if(!el)return;var pn=el.closest('[data-scpanel]');if(pn&&pn.hidden){show(pn.getAttribute('data-scpanel'),false);el.scrollIntoView()}})})();</script>`,
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
  return `<li class="tstance"><h3><a href="/council/${c.slug}/#issues">${esc(c.name)}</a>${c.office === 'mayor' ? ' <span class="small">(mayor)</span>' : ''}${c.incumbent ? ' <span class="small">· also on the last council</span>' : ''}</h3>
  <p><b>${escGl(s.position)}</b></p><p>${escGl(s.summary || '')}${src(s.source_url)}</p>${s.quote ? `<blockquote>“${escGl(s.quote.replace(/^["“]|["”]$/g, ''))}”</blockquote>${src(s.quote_source_url, 'quote source')}` : ''}</li>`;
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
    url: '/issues/', title: `Squamish council on ${name}: where each member stands`,
    desc: `${iss ? `${withS.length} of ${all.length} Squamish council members have a public position on ${name}. ` : ''}What each one has said, with sources, plus plain language background.`,
    jsonld: crumbLd([['Home', '/'], ['The issues', '/issues/'], [ic.title, url]]),
    body: `<p class="crumbs"><a href="/issues/">← All the issues</a></p>
    <h1>Squamish council on ${esc(name)}</h1>
    ${ic.short_explainer && !ic.explainer.startsWith(ic.short_explainer.slice(0, 40)) ? `<p class="lede">${esc(ic.short_explainer)}</p>` : ''}
    ${ic.key === 'taxes_spending' ? '<p class="notice info"><b>Your 2027 property tax, in one place:</b> <a href="/track/budget-2027/">the budget, when council votes, and what your BC Assessment notice means →</a></p>' : ''}
    ${TRACKED.some((t) => t.topic === ic.key) ? `<h2>What council is doing now</h2><ul class="mlist">${TRACKED.filter((t) => t.topic === ic.key).map(issueRow).join('')}</ul>` : ''}
    <h2>The background</h2>
    <p>${escGl(paras.slice(0, mid).join(' '))}</p><p>${escGl(paras.slice(mid).join(' '))}</p>
    ${ic.key === 'environment_lng' || ic.key === 'taxes_spending' ? DEAL_IF_NO : ''}
    ${(ic.key_facts || []).length ? `<h3>Key facts</h3><ul class="facts">${ic.key_facts.map((f) => `<li>${esc(f.fact)}${src(f.source_url)}</li>`).join('')}</ul>` : ''}
    ${qs.length ? `<h2>Agree or disagree?</h2><p>Where each council member lands on ${qs.length === 1 ? 'this statement' : `these ${qs.length} statements`}, from their own questionnaire answers or their public record. Tap a name for the detail.</p>${qs.map(spectrum).join('')}` : ''}
    ${iss ? `<h2>What each council member has said</h2>
    <p class="small">The mayor first, then council, in alphabetical order. Our summary of the public record; tap <b>[source]</b> to check it.</p>
    <ul class="plainlist tstances">${withS.map((c) => stanceBlock(c, ic.key)).join('')}</ul>
    ${without.length ? `<p class="muted"><b>No public position found for:</b> ${nameList(without)}. If you are one of these council members, <a href="mailto:${SITE.contact}?subject=${encodeURIComponent('Position on ' + name)}">send us your position</a>.</p>` : ''}` : ''}
    <div class="btn-row no-print"><a class="btn" href="/quiz/">Take the ${QUESTIONS.length}-question quiz →</a><a class="btn secondary" href="/compare/">Compare everyone</a></div>
    <h2>Other issues</h2><ul class="namechips">${(ctx.issues || []).filter((o) => o.key !== ic.key && TOPIC_SLUG[o.key]).map((o) => `<li><a href="/issues/${TOPIC_SLUG[o.key]}/">${esc(TOPIC_NAME[o.key])}</a></li>`).join('')}<li><a href="/issues/woodfibre-tax-deal/">the Woodfibre tax deal</a></li></ul>`,
  }));
}
{ // The single hottest question of the campaign gets its own page.
  const q23 = ALL_QUESTIONS.find((q) => q.id === 'q23');
  if (q23) {
    const yes = all.filter((c) => c.quiz_answers?.q23 > 0), no = all.filter((c) => c.quiz_answers?.q23 < 0);
    write('/issues/woodfibre-tax-deal/', page({
      url: '/issues/', title: 'Woodfibre LNG tax deal: where Squamish council stands',
      desc: `Council rejected the 10-year Woodfibre LNG tax agreement 5–2 on Sept. 22, 2026; the next council could revisit it. ${yes.length} of the new council lean yes, ${no.length} lean no. What each choice means and what each member has said, with sources.`,
      jsonld: crumbLd([['Home', '/'], ['The issues', '/issues/'], ['Woodfibre LNG tax deal', '/issues/woodfibre-tax-deal/']]),
      body: `<p class="crumbs"><a href="/issues/">← All the issues</a></p>
      <h1>The Woodfibre LNG tax deal</h1>
      <p class="lede">On September 22, 2026, council voted 5–2 against a proposed 10-year agreement fixing what Woodfibre LNG pays in place of normal property tax. The new council could negotiate a new one. Here is what it means and where each member stands.</p>
      ${DEAL_IF_NO}
      <h2>Where council stands</h2>${spectrum(q23)}
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
    url: '/results/', title: `Squamish election results 2026${R26.status === 'official' ? ' (official)' : ''}: ${resWinner('mayor')[0]} elected mayor`,
    desc: `${R26.status === 'official' ? 'Official results. ' : ''}${resWinner('mayor')[0]} was elected mayor of Squamish on October 17, 2026 by ${num(R26.mayor[0].total - R26.mayor[1].total)} votes. Council: ${resWinner('council').join(', ')}. Every candidate's votes, turnout ${R26.turnout_pct}%, plus 2022 and 2018.`,
    jsonld: [crumbLd([['Home', '/'], ['Election results', '/results/']]),
      { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Squamish election results 2026', url: `${ORIGIN}/results/`, ...(R26.status === 'official' ? { dateModified: '2026-10-21' } : {}), about: { '@type': 'Event', name: 'District of Squamish general local election 2026', startDate: '2026-10-17', location: { '@type': 'Place', name: 'Squamish, British Columbia' } } }],
    body: `<h1>Squamish election results 2026</h1>
    ${R26.status === 'official' ? `<p class="res-official"><b>Official results.</b> Declared by the District’s Chief Election Officer on ${esc(R26.updated.replace(/\.$/, ''))}.</p>` : ''}
    <p class="lede">${num(R26.ballots_cast)} people voted on October 17, 2026, a turnout of ${R26.turnout_pct}% of ${num(R26.eligible_voters)} eligible voters.${src(R26.source_url, 'District of Squamish')}</p>
    <div class="jump"><a class="chip-btn" href="#mayor">Mayor</a><a class="chip-btn" href="#council">Council</a><a class="chip-btn" href="#trustees">School trustees</a><a class="chip-btn" href="#2022">2022</a></div>
    <h2 id="mayor">Mayor <span class="small">1 elected</span></h2>${resRace(R26.mayor, { pct: true })}
    <h2 id="council">Council <span class="small">6 elected</span></h2>${resRace(R26.council)}
    ${(R26.trustees || []).length ? `<h2 id="trustees">School trustees <span class="small">2 elected for Squamish, School District 48</span></h2>${resRace(R26.trustees)}` : ''}
    ${R26.mayor[0]?.advance != null ? `<h2 id="how">How people voted: mail, advance and election day</h2>
    <p>${num(['special', 'advance', 'general_voting_day'].reduce((t, k) => t + R26.mayor.reduce((a, r) => a + r[k], 0), 0))} votes for mayor: ${num(R26.mayor.reduce((a, r) => a + r.advance, 0))} at advance voting, ${num(R26.mayor.reduce((a, r) => a + r.general_voting_day, 0))} on election day and ${num(R26.mayor.reduce((a, r) => a + r.special, 0))} by mail or special voting.</p>
    ${[['Mayor', R26.mayor], ['Council', R26.council]].map(([h, rows]) => `<h3>${h}</h3><div class="table-scroll"><table class="res-how"><thead><tr><th>Candidate</th><th>Mail</th><th>Advance</th><th>Voting day</th><th>Total</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.elected ? `<b>${esc(r.name)}</b>` : esc(r.name)}</td><td>${num(r.special)}</td><td>${num(r.advance)}</td><td>${num(r.general_voting_day)}</td><td><b>${num(r.total)}</b></td></tr>`).join('')}</tbody></table></div>`).join('')}` : ''}
    <div class="btn-row"><a class="btn" href="/council/">Meet the new council →</a></div>
    ${pastRes('2022')}
    ${pastRes('2018')}
    <p class="small">Past results are from the District of Squamish’s signed final determinations. 2026 numbers are from the District’s results page; see the <a href="https://squamish.ca/government-and-administration/council/election/" target="_blank" rel="noopener">District election page</a> for the official record.</p>`,
  }));
}
// Quick answers
{
  const M0 = mayors[0];
  const FAQ = LLM.faq = [
    ['Who is the mayor of Squamish?', `${M0.name} was elected mayor on October 17, 2026, for a four-year term to 2030.`, `<a href="/council/${M0.slug}/">${esc(M0.name)}’s page</a>`],
    ['Who is on Squamish council?', `Mayor ${M0.name} and councillors ${council.map((c) => c.name).join(', ')}.`, '<a href="/council/">Meet the council</a>'],
    ['When does Squamish council meet?', 'Regular council meetings are usually the 1st and 3rd Tuesday of each month at 6 p.m., with no meetings in August. Council workshops (official name: Committee of the Whole) are usually the 2nd and 4th Tuesday. Our meetings page lists every upcoming one.', '<a href="/meetings/">Upcoming meetings</a>'],
    ['Can I watch a council meeting?', 'Yes. Meetings are open to the public at Municipal Hall, and most are streamed live and posted online afterward. Each meeting on our site links to the official video.', '<a href="/meetings/">Meetings and videos</a>'],
    ['What is the difference between a council meeting and a council workshop (Committee of the Whole)?', `${MTYPE.regular.plain} ${MTYPE.cow.label}: ${MTYPE.cow.plain}`, ''],
    ['What is a public hearing?', MTYPE.hearing.plain + ' Anyone can speak or send a letter. Since late 2023, B.C. law does not allow a public hearing on a rezoning that is mostly for housing and fits the Official Community Plan. A change to the Official Community Plan itself must have one.', ''],
    ['How do you know if a promise was kept?', 'Each promise lists their part: how they vote, or what they move or second. Only that is marked, not what council as a whole decides. When council votes on something that tests it, we mark it and link to the vote.', '<a href="/scorecard/#how">How we judge promises</a>'],
    ['Who won the 2026 Squamish election?', `${resWinner('mayor')[0]} won the mayor’s race. Elected to council: ${resWinner('council').join(', ')}. Turnout was ${R26.turnout_pct}%.`, '<a href="/results/">Full results</a>'],
    ...(ctx.pay ? [['How much is the mayor of Squamish paid?', `In ${ctx.pay.year} the mayor was paid $${ctx.pay.mayor.toLocaleString('en-CA')} and each councillor about $${ctx.pay.councillor.toLocaleString('en-CA')}, not counting expenses and benefits (District of Squamish financial statement).`, isUrl(ctx.pay.source_url) ? `<a href="${esc(ctx.pay.source_url)}" target="_blank" rel="noopener">Source</a>` : '']] : []),
    ['Is this site run by the District?', 'No. Squamish Voters is independent and not connected to the District, council or any group. It does not endorse anyone.', '<a href="/about/">About this site</a>'],
  ].filter(([, a]) => a);
  FAQ.push(...EXPLAINERS.map((e) => [e.question, e.answer, `<a href="/explained/${e.slug}/">${esc(e.short)}, explained</a>`]));
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
write('/about/', page({ url: '/about/', jsonld: crumbLd([['Home', '/'], ['About', '/about/']]), title: 'About this site', desc: 'Who makes Squamish Voters, how meeting summaries and the promise tracker work, and how to send a correction. Independent and not affiliated with the District or any council member.', body: pageFile('about.html').replaceAll('<!--CONTACT-->', SITE.contact ? `<a href="mailto:${esc(SITE.contact)}">${esc(SITE.contact)}</a>` : 'a contact address will be posted here shortly.').replace('{{COUNT}}', String(all.length)).replace('{{UPDATED}}', esc(SITE.updated)) }));
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
  ${FB_CARD}
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
write('/priorities/', page({ url: '/priorities/', jsonld: crumbLd([['Home', '/'], ['Readers’ top issues', '/priorities/']]), title: 'Readers’ top issues',
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
write('/subscribers/', page({ url: '/subscribers/', title: 'Admin', noindex: true,
  body: `<div id="ad-main" class="ad">
<h1>Admin</h1>
<p class="lede" id="a-sum" aria-live="polite">Loading…</p>
<nav class="ad-tabs" role="tablist" aria-label="Admin sections">
<button type="button" role="tab" data-tab="review">To review <span class="ad-n" hidden></span></button>
<button type="button" role="tab" data-tab="wants"><span class="ad-long">What Squamish </span>Wants <span class="ad-n"></span></button>
<button type="button" role="tab" data-tab="comments">Comments <span class="ad-n"></span></button>
<button type="button" role="tab" data-tab="signups">Sign-ups <span class="ad-n"></span></button>
</nav>
<section id="tab-review"><p class="small muted">Only what needs you: things the automatic check held back, things readers reported, and anything that went up unchecked.</p><div id="r-out" class="ad-list"><p class="muted">Loading…</p></div></section>
<section id="tab-wants" hidden><p class="small muted">Everything residents added on /wants/, grouped under its question. Newest activity first. Three reader reports hide an item on their own.</p><div id="w-out" class="ad-list"><p class="muted">Loading…</p></div></section>
<section id="tab-comments" hidden><p class="small muted">Comments on Have your say questions.</p><div id="c-out" class="ad-list"><p class="muted">Loading…</p></div></section>
<section id="tab-signups" hidden><p class="small" id="s-status" aria-live="polite">Loading…</p><div id="s-out" class="sb"></div></section>
</div>
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
.ad h1 { margin-bottom: .2rem; }
.ad-tabs { display: flex; gap: .3rem; border-bottom: 2px solid var(--line); margin: 1rem 0 1rem; overflow-x: auto; scrollbar-width: none; }
.ad-tabs button { font: inherit; font-weight: 700; background: none; border: 0; border-bottom: 3px solid transparent; margin-bottom: -2px; padding: .6rem .8rem; color: var(--ink-2); cursor: pointer; white-space: nowrap; display: flex; gap: .4rem; align-items: center; }
.ad-tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--brand); }
.ad-n { font-size: .75rem; min-width: 1.4rem; padding: .05rem .4rem; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); text-align: center; }
.ad-n.ad-alert { background: #b3261e; color: #fff; }
.ad-list { display: grid; gap: .7rem; }
.ad-chips { display: inline-flex; flex: none; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; margin-right: .5rem; vertical-align: middle; }
.ad-chips button { font: inherit; font-size: .9rem; background: none; border: 0; padding: .35rem .9rem; cursor: pointer; color: var(--ink-2); }
.ad-chips button[aria-pressed="true"] { background: var(--brand); color: #fff; font-weight: 700; }
.ad-search { font: inherit; padding: .4rem .7rem; border: 1px solid var(--line); border-radius: 999px; min-width: 0; width: min(20rem, 100%); vertical-align: middle; margin: .3rem 0; background: var(--surface); color: var(--ink); }
.ad-count { margin: .2rem 0 0; }
.ad-item { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: .8rem 1rem; }
.ad-item p { margin: 0; }
.ad-dim .ad-body { opacity: .6; }
.ad-bar { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
.ad-group.ad-solo { padding: 0; border: 0; background: none; }
@media (max-width: 600px) { .ad-long { display: none; } .ad-tabs button { padding: .6rem .5rem; } }
.ad-meta { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; font-size: .85rem; color: var(--ink-2); }
.ad-pill { font-size: .75rem; font-weight: 700; border-radius: 999px; padding: .1rem .55rem; }
.ad-live { background: var(--brand-soft); color: var(--brand); }
.ad-warn { background: #fff1c2; color: #6b4e00; }
.ad-bad { background: #fde2e0; color: #8c1d18; }
.ad-off { background: var(--surface-2); color: var(--ink-2); }
.ad-ctx { font-size: .85rem; color: var(--ink-2); margin-top: .35rem !important; }
.ad-title { font-weight: 700; font-size: 1.05rem; margin: .3rem 0 !important; overflow-wrap: anywhere; }
.ad-why { font-size: .9rem; background: var(--surface-2); border-radius: 8px; padding: .4rem .6rem; margin: .3rem 0 !important; }
.ad-orig { margin: 0; }
.ad-orig summary { display: inline-block; padding: 0; min-height: 0; font-size: .85rem; font-weight: 600; color: var(--ink-2); cursor: pointer; background: none; border: 0; }
.ad-orig p { white-space: pre-wrap; font-size: .9rem; font-style: italic; color: var(--ink-2); padding: .3rem 0 0 .8rem; border-left: 3px solid var(--line); margin-top: .3rem; }
.ad-acts { display: flex; gap: .4rem; flex-wrap: wrap; margin-top: .5rem; }
.ad-btn { font: inherit; font-size: .9rem; font-weight: 600; padding: .35rem .8rem; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; text-decoration: none; }
.ad-btn:hover { border-color: var(--ink-2); }
.ad-accept { border-color: var(--yes, #2e7d32); color: var(--yes, #2e7d32); }
.ad-accept:hover { background: var(--yes, #2e7d32); color: #fff; }
.ad-decline { border-color: #b3261e; color: #b3261e; }
.ad-decline:hover { background: #b3261e; color: #fff; }
.ad-done { font-size: .9rem; font-weight: 700; padding: .35rem .6rem; color: var(--ink-2); }
.ad-yes { color: var(--yes, #2e7d32); }
.ad-no { color: #b3261e; }
.ad-panel textarea { font: inherit; font-weight: 400; padding: .4rem .5rem; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); resize: vertical; }
.ad-primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.ad-panel { display: grid; gap: .5rem; margin-top: .6rem; padding: .7rem; background: var(--surface-2); border-radius: 8px; }
.ad-panel label { display: grid; gap: .2rem; font-size: .9rem; font-weight: 600; }
.ad-panel input, .ad-panel select { font: inherit; font-weight: 400; padding: .4rem .5rem; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); }
.ad-group { border: 1px solid var(--line); border-radius: 14px; padding: .8rem; background: var(--surface-2); display: grid; gap: .5rem; }
.ad-group header h3 { margin: .1rem 0 0; font-size: 1.05rem; }
.ad-group header h3 a { color: var(--ink); }
.ad-gk { margin: 0; font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-2); }
.ad-kids { display: grid; gap: .5rem; padding-left: .8rem; border-left: 3px solid var(--line); }
.ad-empty { text-align: center; padding: 2rem 1rem; border: 1px dashed var(--line); border-radius: 12px; }
.ad-empty p { margin: .2rem 0; }
</style>
<script>window.SV_SUBS=${JSON.stringify({ issues: Object.fromEntries(SIGNUP_ISSUES.map((i) => [i.key, { t: i.title, i: i.icon, o: SIDES[i.key] ? [SIDES[i.key][1], SIDES[i.key][2]] : [] }])), hoods: Object.fromEntries(WELCOME_HOODS.map((h) => [h.slug, h.name])) }).replace(/</g, '\\u003c')};</script>
<script src="/subscribers.js" defer></script>`,
}));
// "Roles on council": filled from data/roles.json once the District publishes appointments; until then, a plain note.
function rolesBox(c) {
  const rs = ((ROLES.members || {})[c.slug] || []).filter((r) => r.role && isUrl(r.source_url));
  return `<section class="card roles" id="roles"><h2>${esc(first(c))}’s roles on council</h2>${rs.length
    ? `<ul class="linklist">${rs.map((r) => `<li><b>${esc(r.role)}</b>${r.when ? ` <span class="small">${esc(r.when)}</span>` : ''}${src(r.source_url)}</li>`).join('')}</ul>`
    : `<p class="muted">Not appointed yet. Council usually decides who serves as acting mayor, who sits on the Squamish-Lillooet Regional District board, and who joins which committees at or soon after the swearing in on November 3, 2026. We’ll list ${esc(first(c))}’s roles here once the District publishes them.</p>`}
  <p class="small"><a href="/how-council-works/">How council works</a>: no one on council, not even the mayor, decides alone.</p></section>`;
}

// ---------- HOW COUNCIL WORKS (/how-council-works/) and the first 100 days ----------
// Plain explainers, each with its source in provincial law (Community Charter) or the District's own pages.
// Section numbers are the Community Charter's; check them at bclaws before changing any wording.
{
  const CC = 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/03026_00';
  const cc = (n) => src(`${CC}#section${n}`, `Community Charter, section ${n}`);
  const bud = TRACKED.find((t) => t.slug === 'budget-2027');
  const step = (label) => (bud?.steps || []).find((x) => x.label.toLowerCase().includes(label)) || {};
  const INAUG = MEETINGS.find((m) => m.type === 'inaugural');
  const HOW = [
    ['group', 'Council decides as a group', `<p>The mayor and six councillors make decisions together, by voting at a council meeting. A decision needs a majority of the members who are there, and at least four of the seven must be there for a meeting to go ahead.${cc(123)}${cc(129)}</p><p>No single member can make anything happen alone. That’s why we judge each member on their own part: how they voted and what they proposed.</p><p>A member who is in the room and doesn’t vote is counted as voting yes.${cc(123)}</p>`],
    ['mayor', 'What the mayor can and can’t do', `<p>The mayor chairs council meetings, speaks for council, and has one vote like everyone else. There is no veto.${cc(116)}</p><p>The mayor sets up standing committees and picks who sits on them.${cc(141)} Within 30 days of a vote, the mayor can send it back to council once to be voted on again; council then decides.${cc(131)}</p>`],
    ['bylaws', 'Bylaws and the three readings', `<p>A bylaw is a local law. It gets a first, second and third reading, which are votes to move it forward, and then a final vote to adopt it. A bylaw can’t be adopted on the same day as its third reading.${cc(135)}</p><p>A yes at first reading usually means “let this go forward”, not “I support it”. We count the final vote when we check a promise.</p>`],
    ['consent', 'The consent agenda', `<p>Routine items, like receiving reports and minutes, are approved together in one vote. Any member who wants to debate an item or vote against it can ask for it to be taken out and voted on by itself. <a class="src" href="https://squamish.civicweb.net/Portal/MeetingSchedule.aspx" target="_blank" rel="noopener">[agendas]</a></p>`],
    ['closed', 'Closed meetings, and why they’re allowed', `<p>Council can meet privately only for reasons the law lists, and has to say which reason in an open meeting first. The main ones, in plain words: buying or selling land, legal advice, staff and hiring matters, contract talks that would be hurt if public, and someone’s personal information.${cc(90)}</p><p>When a closed decision is later made public, it’s called “rise and report”.</p>`],
    ['conflicts', 'Conflicts of interest', `<p>A member who has a money interest in a decision, or another interest that could sway them, must say so, leave the room, and not vote or talk about it. Minutes record this. We show it as “stepped out”, never as a missed vote.${cc(100)}${cc(101)}</p>`],
    ['cow', 'Council workshops and Special meetings', `<p>At a council workshop (official name: Committee of the Whole), the whole council talks an issue through. It can only recommend; nothing is decided until council confirms it at a later council meeting. Special meetings are extra council meetings called with notice. In Squamish they are frequent and can include big decisions, like budget meetings.${cc(127)}</p>`],
  ];
  const D100 = [
    [INAUG ? fmtLong(INAUG.date) : 'November 3, 2026', 'Swearing in', `The mayor and councillors take their oath of office at the first meeting.${INAUG?.agenda_url ? src(INAUG.agenda_url, 'agenda') : ''} Council usually also sets the acting mayor schedule and names members to the Squamish-Lillooet Regional District board and to committees around this time.${cc(130)}`],
    ['November to December', 'Getting started', 'Orientation for new members, committee and liaison appointments, and the meeting schedule for the year. Most early votes are routine. Expect very few promise checks before the budget.'],
    ['From November', 'The 2027 budget', `The new council works through the budget, mostly at Special meetings. ${bud ? esc(bud.summary.split('. ').slice(-1)[0]) : ''}${src(step('draft').source_url)}`],
    ['Likely January 2027', 'Budget adopted', `The financial plan bylaw gets its readings and is adopted. ${esc(step('adoption').note || '')}${src(step('adoption').source_url)}`],
    ['Early January 2027', 'BC Assessment notices arrive', 'Your property’s assessed value for 2027 comes in the mail. It doesn’t set your tax bill by itself: council’s tax rates do. <a href="/track/budget-2027/#assessment">What your assessment means</a>.'],
    ['Winter to spring 2027', 'A new strategic plan', 'Councils usually set a plan for their term in their first months. The last council’s 2023 to 2026 plan is done.'],
    ['By about May 2027', 'Code of conduct', `The law says a new council must consider a code of conduct for its members within six months of its first regular meeting.${cc('113.1')}`],
    ['Before May 15, 2027', 'Tax rates set', `The tax rates bylaw has to be adopted after the financial plan and before May 15. ${esc(step('tax rate').note || '')}${cc(197)}${cc(165)}`],
  ];
  const faq = [
    ['Can the mayor of Squamish make decisions alone?', 'No. Council decides as a group by majority vote. The mayor chairs meetings and has one vote, with no veto, but can send a decision back to council once within 30 days to be voted on again.'],
    ['What does first reading of a bylaw mean?', 'It is the first of three votes to move a bylaw forward before a final vote to adopt it. A yes at first reading usually means letting the bylaw go forward for more discussion, not final support.'],
    ['Why does Squamish council meet behind closed doors?', 'The Community Charter allows closed meetings only for listed reasons, such as land deals, legal advice, staff matters and some negotiations. Council must say which reason applies in an open meeting first.'],
  ];
  write('/how-council-works/', page({
    url: '/how-council-works/', title: 'How Squamish council works, in plain words',
    desc: 'How Squamish council makes decisions: voting as a group, what the mayor can and can’t do, bylaw readings, the consent agenda, closed meetings, conflicts, and what happens in the new council’s first 100 days.',
    jsonld: [crumbLd([['Home', '/'], ['Council', '/council/'], ['How council works', '/how-council-works/']]), { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }],
    body: `<p class="crumbs"><a href="/council/">← Your mayor and council</a></p>
    <h1>How council works</h1>
    <p class="lede">No councillor, and not even the mayor, can make anything happen alone. Council decides as a group, and some things need the Province or others too. So we judge each person on how they voted and what they proposed.</p>
    <div class="chip-row no-print">${HOW.map(([id, h]) => `<a class="chip-btn" href="#${id}">${esc(h)}</a>`).join('')}<a class="chip-btn" href="#first-100-days">The first 100 days</a></div>
    ${HOW.map(([id, h, body]) => `<section class="card" id="${id}"><h2>${h}</h2>${body}</section>`).join('')}
    <h2 id="first-100-days">The new council’s first 100 days</h2>
    <p>What usually happens after the November 3 swearing in. Dates after November are the usual pattern, not fixed.</p>
    <ol class="isteps">${D100.map(([when, what, note]) => `<li class="st-upcoming"><span class="sdot" aria-hidden="true">○</span><span><b>${esc(what)}</b> <span class="small">${esc(when)}</span><br><span class="small">${note}</span></span></li>`).join('')}</ol>
    <p class="small muted">From the Community Charter (B.C.’s law for municipalities) and the District of Squamish. Something out of date? Email <a href="mailto:${esc(SITE.contact)}">${esc(SITE.contact)}</a>.</p>
    ${signupBox('how')}`,
  }));
}

// ---------- CORRECTIONS (every fix we make, plus every vote the official minutes corrected) ----------
{
  const fromMinutes = DECISIONS.filter((d) => corrections(d).length).map((d) => ({ date: d.corrected_on || isoDay(d.m.minutes_checked) || d.m.date, d }));
  const items = [
    ...(CORR.entries || []).map((e) => ({ date: e.date, html: `${e.page ? `<a href="${esc(e.page)}">${esc(e.page)}</a>: ` : ''}${esc(e.what)}` })),
    ...fromMinutes.map(({ date, d }) => ({ date, html: `<b>Vote corrected after the official minutes:</b> <a href="${mUrl(d.m)}">${escGl(d.title)}</a> (${esc(fmtLong(d.m.date))} meeting). ${corrections(d).map(esc).join('; ')}.` })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  write('/corrections/', page({
    url: '/corrections/', title: 'Corrections', updated: items[0]?.date || null,
    desc: 'Every correction Squamish Voters has made, and every council vote the official minutes changed from what we first wrote down from the meeting video.',
    jsonld: crumbLd([['Home', '/'], ['Corrections', '/corrections/']]),
    body: `<h1>Corrections</h1>
    <p class="lede">Every mistake we fix is listed here, newest first.</p>
    <p>Two kinds of corrections show up here: fixes we make ourselves, often after a reader tells us, and votes we first wrote down from the meeting video that the official minutes later changed. An AI model (Anthropic’s Claude) writes our meeting summaries and decides which votes test a promise, so it can be wrong. Spot something? <a href="mailto:${esc(SITE.contact)}?subject=Correction">Tell us</a>.</p>
    ${items.length ? `<ul class="corr-list">${items.map((x) => `<li class="card"><p class="small muted">${esc(fmtLong(x.date))}</p><p>${x.html}</p></li>`).join('')}</ul>` : '<p class="muted">No corrections yet.</p>'}`,
  }));
}
write('/404/', page({ url: '/404/', title: 'Page not found', body: '<h1>We can’t find that page</h1><p class="lede">Try one of these instead.</p><div class="btn-row"><a class="btn big" href="/">Home</a><a class="btn big secondary" href="/council/">Mayor and council</a><a class="btn big secondary" href="/quiz/">Take the quiz</a></div>' }));
fs.copyFileSync(path.join(DIST, '404', 'index.html'), path.join(DIST, '404.html'));

// ---------- static assets ----------
for (const f of ['site.css', 'site.js', 'quiz.js', 'lean.js', 'subscribers.js', 'news.js', 'hoodmap.js', 'vote.js', 'wants.js', 'today.js']) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(DIST, f));
fs.writeFileSync(path.join(DIST, 'botid.js'), `(function(){${BOTID_JS}})();`);
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

// ---------- explainers: one money question each, answered first, then the detail (/explained/<slug>/) ----------
for (const e of EXPLAINERS) {
  const S = e.sources, ref = (ns) => (ns || []).map((n) => src(S[n - 1]?.[1], String(n))).join('');
  const para = (x) => `<p>${escGl(x.t)}${ref(x.s)}</p>`;
  const others = EXPLAINERS.filter((o) => o !== e), tr = TRACKED.find((t) => t.slug === e.track);
  write(`/explained/${e.slug}/`, page({ url: `/explained/${e.slug}/`, title: e.question, desc: e.answer,
    jsonld: [crumbLd([['Home', '/'], ['Quick answers', '/faq/'], [e.short, `/explained/${e.slug}/`]]),
      { '@context': 'https://schema.org', '@type': 'Article', headline: e.question, description: e.answer, datePublished: e.published, dateModified: e.checked, inLanguage: 'en-CA',
        author: { '@type': 'Person', name: 'Jeff Kirdeikis', url: `${ORIGIN}/about/` }, publisher: { '@type': 'Organization', name: SITE.name, url: `${ORIGIN}/` },
        about: { '@type': 'Place', name: 'Squamish, British Columbia' }, citation: S.map(([, u]) => u) },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: e.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }],
    body: `<p class="crumbs"><a href="/faq/">← Quick answers</a></p>
    <h1>${esc(e.question)}</h1>
    <p class="lede">${escGl(e.answer)}${ref(e.answer_src)}</p>
    <p class="small">Checked ${esc(fmtLong(e.checked))} against District of Squamish records. Numbers link to their sources.</p>
    ${e.sections.map((x) => `<h2>${esc(x.h)}</h2>${(x.p || []).map(para).join('')}
      ${x.table ? `<div class="table-scroll"><table class="res-how"><thead><tr>${x.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${x.table.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
      ${x.list ? `<ul>${x.list.map((l) => `<li>${escGl(l)}</li>`).join('')}</ul>` : ''}${(x.after || []).map(para).join('')}`).join('')}
    ${tr ? `<p class="notice info">Follow what council does next: <a href="/track/${tr.slug}/">${esc(tr.title)}</a>, with every vote by member.</p>` : ''}
    <h2>Sources</h2><ol class="small">${S.map(([l, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a></li>`).join('')}</ol>
    ${others.length ? `<h2>More explained</h2><ul>${others.map((o) => `<li><a href="/explained/${o.slug}/">${esc(o.question)}</a></li>`).join('')}</ul>` : ''}`,
  }));
}

// ---------- open data: the site's records as spreadsheet files anyone can reuse with credit (CC BY 4.0) ----------
{
  const csv = (rows) => rows.map((r) => r.map((v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(',')).join('\r\n') + '\r\n';
  const U = (u) => ORIGIN + u, role = (c) => (c.office === 'mayor' ? 'Mayor' : 'Councillor');
  const files = [
    { f: 'council.csv', name: 'Squamish council 2026 to 2030', about: 'The mayor and six councillors: votes received on October 17, 2026, share of the vote, whether they were re-elected, promises tracked and council votes cast so far.',
      rows: [['name', 'role', 'page', 'votes_2026', 'vote_share_pct', 're_elected', 'promises_tracked', 'council_votes_cast'],
        ...all.map((c) => { const r = raceRow(c); return [c.name, role(c), U(`/council/${c.slug}/`), r?.total, r?.pct, c.incumbent ? 'yes' : 'no', promisesOf(c).length, castVotes(c).length]; })] },
    { f: 'votes.csv', name: 'How each Squamish council member voted', about: 'One row per member per council decision: the meeting, what was decided, the result and how that member voted. Fills in from the first regular meeting on November 17, 2026.',
      rows: [['meeting_date', 'meeting_type', 'meeting_page', 'decision', 'result', 'member', 'vote', 'checked_against'],
        ...DECISIONS.filter((d) => d.votes).flatMap((d) => all.filter((c) => d.votes[c.slug]).map((c) => [d.m.date, mType(d.m).label, U(mUrl(d.m)), d.title, d.result, c.name, d.votes[c.slug], d.m.votes_source === 'minutes' ? 'official minutes' : 'meeting video']))] },
    { f: 'promises.csv', name: 'Squamish council campaign promises', about: 'Every promise the mayor and councillors made in the 2026 campaign, in their words, what would count as keeping it, its status and the source.',
      rows: [['member', 'role', 'promise', 'their_words', 'topic', 'their_part', 'did_it_happen', 'who_decides', 'status', 'source'],
        ...all.flatMap((c) => promisesOf(c).map((p) => [c.name, role(c), p.promise, p.quote, p.topic, p.their_part, p.did_it_happen, p.who_decides, pStatus(p).label, String(p.source_url || '').replace(`${ORIGIN}/candidates/`, `${ORIGIN}/council/`)]))] },
    { f: 'election-2026.csv', name: 'Squamish election results 2026', about: `Official results for mayor and council from the District of Squamish: every candidate's mail, advance and voting day votes and total.`,
      rows: [['race', 'candidate', 'mail_ballot', 'advance', 'general_voting_day', 'total', 'pct', 'elected'],
        ...['mayor', 'council'].flatMap((k) => (R26[k] || []).map((r) => [k, r.name, r.special, r.advance, r.general_voting_day, r.total, r.pct, r.elected ? 'yes' : 'no']))] },
  ];
  fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });
  files.forEach((x) => fs.writeFileSync(path.join(DIST, 'data', x.f), '﻿' + csv(x.rows))); // the mark at the start makes Excel read the accents
  const LIC = 'https://creativecommons.org/licenses/by/4.0/';
  LLM.data = files;
  write('/data/', page({ url: '/data/', title: 'Squamish council data downloads',
    desc: 'Free spreadsheets of Squamish council: every member, every vote by member, every campaign promise and its status, and the 2026 election results. Reuse them with credit.',
    jsonld: [crumbLd([['Home', '/'], ['Data downloads', '/data/']]), ...files.map((x) => ({ '@context': 'https://schema.org', '@type': 'Dataset', name: x.name, description: x.about, url: U('/data/'), license: LIC, isAccessibleForFree: true, dateModified: TODAY,
      creator: { '@type': 'Organization', name: SITE.name, url: U('/') }, spatialCoverage: { '@type': 'Place', name: 'Squamish, British Columbia, Canada' },
      distribution: [{ '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: U(`/data/${x.f}`) }] }))],
    body: `<h1>Data downloads</h1>
    <p class="lede">The records behind this site as spreadsheet files. They update every time the site does. Use them for anything, including news stories and research, as long as you credit Squamish Voters.</p>
    <div class="card stack">${files.map((x) => `<div><h2 style="margin:0 0 .25em"><a href="/data/${x.f}">${esc(x.name)}</a></h2><p>${esc(x.about)}</p><p class="small">${x.f} · ${x.rows.length - 1} row${x.rows.length === 2 ? '' : 's'} · updated ${esc(fmtLong(TODAY))}</p></div>`).join('')}</div>
    <h2>How to credit</h2>
    <p>Write “Source: Squamish Voters (squamishvoters.com)” and link to the page you used. The files are shared under the <a href="${LIC}" rel="license">Creative Commons Attribution 4.0</a> licence.</p>
    <h2>Where the data comes from</h2>
    <p>Votes come from council meeting video and are checked against the official minutes once they are published. Promises come from each member's own campaign material, questionnaire answers and interviews, with a link to each source. Election results are the District of Squamish's official count. <a href="/about/">How the site works and how to send a correction</a>.</p>`,
  }));
}

// ---------- private AI visibility page: what the weekly check (scripts/ai-visibility) found. Not in the sitemap ----------
{
  const AV = path.join(ROOT, 'data', 'ai-visibility'), hist = fs.existsSync(path.join(AV, 'history.json')) ? JSON.parse(fs.readFileSync(path.join(AV, 'history.json'), 'utf8')) : [];
  const last = hist.at(-1), run = last && JSON.parse(fs.readFileSync(path.join(AV, `${last.date}.json`), 'utf8'));
  const mark = (b) => (b ? '<b style="color:#1a7f4b">Yes</b>' : '<span class="muted">No</span>');
  write('/ai-check/', page({ url: '/ai-check/', title: 'AI visibility check', noindex: true,
    body: `<h1>Does AI mention us?</h1>
    <p class="lede">Every Monday, Claude (with web search) is asked ${run ? run.rows.length : 20} questions Squamish residents ask, worded the way they ask them, without naming this site. Cited means the answer linked one of our pages.</p>
    ${!run ? '<p class="notice info">No check has run yet.</p>' : `
    <div class="card"><p><b>${esc(fmtLong(last.date))}:</b> cited us in <b>${last.cited} of ${last.answered}</b> answers, named us in ${last.named}, search turned us up in ${last.found}${last.searched != null ? ` (it searched for ${last.searched})` : ''}.</p>
    ${last.top_cited.length ? `<p class="small">Cited most instead: ${last.top_cited.map((t) => `${esc(t.site)} (${t.n})`).join(', ')}</p>` : ''}</div>
    ${hist.length > 1 ? `<h2>Week by week</h2><table class="res-how"><thead><tr><th>Week</th><th>Cited us</th><th>Named us</th><th>Found us</th></tr></thead><tbody>${hist.slice().reverse().map((h) => `<tr><td>${esc(fmtLong(h.date))}</td><td>${h.cited} of ${h.answered}</td><td>${h.named}</td><td>${h.found}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>Each question</h2>
    ${run.rows.map((r) => `<details class="drop"><summary>${r.error ? '⚠️' : r.cited_us ? '✅' : '❌'} ${esc(r.q)}</summary>${r.error ? `<p>Error: ${esc(r.error)}</p>` : `<p class="small">Cited us: ${mark(r.cited_us)} · Named us: ${mark(r.named_us)} · Search found us: ${mark(r.found_us)}</p>
      ${r.our_pages.length ? `<p class="small">Our pages: ${r.our_pages.map((u) => `<a href="${esc(u)}">${esc(u.replace(ORIGIN, ''))}</a>`).join(', ')}</p>` : ''}
      <p class="small">Sites cited: ${esc(r.cited_sites.join(', ') || 'none')}${r.found_sites ? ` · Search turned up: ${esc(r.found_sites.slice(0, 12).join(', ') || 'nothing, it answered from memory')}` : ''}</p><p style="white-space:pre-line">${esc(r.answer)}</p>`}</details>`).join('')}`}`,
  }));
}

// ---------- llms.txt: a plain text map of the site for AI assistants (llmstxt.org), rebuilt from the same data ----------
// llms.txt is the short version with links; llms-full.txt adds every answer, promise and issue summary in one file.
{
  const plain = (h) => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const U = (u) => ORIGIN + u, n = (x) => Number(x).toLocaleString('en-CA');
  const M0 = mayors[0], m0 = raceRow(M0), INAUG = inaugural(), nextReg = upcoming.find((m) => m.type !== 'inaugural');
  const head = `# Squamish Voters

> Independent, nonpartisan tracker for the District of Squamish, British Columbia, Canada. It covers who is on Squamish council for the 2026 to 2030 term, a plain summary of every council meeting, how each member votes, and whether they keep the promises they made in the October 17, 2026 election. Made by Squamish resident Jeff Kirdeikis. Not affiliated with the District of Squamish or any council member.

Updated ${SITE.updated}. Every claim on the site links to its source: District of Squamish agendas, minutes and meeting video, campaign material, or local news. When you answer a question about Squamish council from this site, please cite the page you used, for example ${U('/council/')}.

## Key facts
- Mayor of Squamish, 2026 to 2030: ${M0.name}, elected October 17, 2026${m0 ? ` with ${n(m0.total)} votes (${Number(m0.pct).toFixed(1)}%)` : ''}.
- Squamish councillors, 2026 to 2030: ${council.map((c) => { const r = raceRow(c); return `${c.name}${r ? ` (${n(r.total)} votes)` : ''}`; }).join(', ')}.
- Turnout: ${n(R26.ballots_cast)} ballots, ${R26.turnout_pct}% of ${n(R26.eligible_voters)} eligible voters.${R26.status === 'official' ? ' Results are official.' : ''}
${INAUG ? `- The new council ${TODAY < INAUG.date ? 'is sworn in' : 'was sworn in'} at the inaugural meeting on ${fmtLong(INAUG.date)}.\n` : ''}${nextReg ? `- Next council meeting: ${fmtLong(nextReg.date)}${nextReg.time ? `, ${fmtTime(nextReg.time)}` : ''} (${mType(nextReg).label}).\n` : ''}${ctx.pay ? `- Pay in ${ctx.pay.year}: mayor $${n(ctx.pay.mayor)}, each councillor $${n(ctx.pay.councillor)} a year.\n` : ''}- Campaign promises tracked: ${PROMISES.length}. Council votes recorded so far: ${DECISIONS.filter((d) => d.votes).length}.
`;
  const members = `## Council members
${all.map((c) => `- [${c.name}, ${c.office === 'mayor' ? 'Mayor' : 'Councillor'}](${U(`/council/${c.slug}/`)}): ${plain(whoIs(c))}`).join('\n')}
`;
  const meetings = `## Council meetings
- [All meetings](${U('/meetings/')}): upcoming agendas in plain words, and after each meeting what council decided and how each member voted.
${[...upcoming.slice(0, 4), ...past.slice(0, 12)].map((m) => `- [${fmtLong(m.date)}, ${mType(m).label}](${U(mUrl(m))}): ${plain(m.summary ? m.summary.headline : (m.preview || mType(m).plain))}`).join('\n')}
`;
  const issues = `## Issues we follow
${TRACKED.map((t) => `- [${t.title}](${U(`/track/${t.slug}/`)}): ${t.question}`).join('\n')}
`;
  const explained = EXPLAINERS.length ? `## Explained\n${EXPLAINERS.map((e) => `- [${e.question}](${U(`/explained/${e.slug}/`)}): ${e.answer}`).join('\n')}\n` : '';
  const more = `## Promises and record
- [Scorecard](${U('/scorecard/')}): ${PROMISES.length} promises the mayor and councillors made in the 2026 campaign, each marked kept or not kept by that member’s own votes, plus what each member said during the campaign next to how they later voted.
- [Compare them](${U('/compare/')}): where each member stands, issue by issue, and each member placed on a map from their answers and votes.

## Election
- [2026 Squamish election results](${U('/results/')}): every candidate's votes, turnout, school trustees, and 2022 results.

## More
- [Quick answers](${U('/faq/')}): who is on council, when it meets, how to watch, how to speak at a meeting.
- [Data downloads](${U('/data/')}): every member, vote, promise and the 2026 election results as spreadsheet files, free to reuse with credit (CC BY 4.0).
- [What Squamish Wants](${U('/wants/')}): residents vote yes or no on specific local asks.
- [Have your say](${U('/have-your-say/')}): how to write to council, speak at a meeting or a public hearing.
- [Squamish today](${U('/today/')}): weather, Highway 99, tides, wind, river and air quality.
- [News](${U('/news/')}): short local news stories from public sources.
- [About, method and corrections](${U('/about/')})

## Optional
- [Full text for AI assistants](${U('/llms-full.txt')}): every answer, promise and issue summary in one file.
`;
  fs.writeFileSync(path.join(DIST, 'llms.txt'), [head, members, meetings, issues, explained, more].filter(Boolean).join('\n'));
  const qa = ([q, a]) => `### ${q}\n${plain(a)}\n`;
  const full = [head,
    `## Quick answers\n${(LLM.faq || []).map(qa).join('\n')}`,
    ...all.map((c) => { const ps = promisesOf(c), vs = castVotes(c); return `## ${c.name}, ${c.office === 'mayor' ? 'Mayor of Squamish' : 'Squamish councillor'}\nPage: ${U(`/council/${c.slug}/`)}\n\n${plain(whoIs(c))}\n\n${memberFaq(c).ld.mainEntity.map((e) => qa([e.name, e.acceptedAnswer.text])).join('\n')}${ps.length ? `\n### Campaign promises ${first(c)} made\n${ps.map((p) => `- ${p.promise} Status: ${pStatus(p).label}.${isUrl(p.source_url) ? ` Source: ${p.source_url.replace(`${ORIGIN}/candidates/`, `${ORIGIN}/council/`)}` : ''}`).join('\n')}\n` : ''}${vs.length ? `\n### Votes\n${vs.map((d) => `- ${fmtLong(d.m.date)}: voted ${d.votes[c.slug]} on ${plain(d.title)} (${U(mUrl(d.m))})`).join('\n')}\n` : ''}`; }),
    `## Issues we follow\n${TRACKED.map((t) => `### ${t.title}\nPage: ${U(`/track/${t.slug}/`)}\n${t.summary}${t.what_next ? `\nWhat happens next: ${t.what_next}` : ''}\n`).join('\n')}`,
    ...past.filter((m) => m.summary).slice(0, 20).map((m) => `## ${mType(m).label}, ${fmtLong(m.date)}\nPage: ${U(mUrl(m))}\n${plain(m.summary.headline)}\n${(m.decisions || []).map((d) => `- ${plain(d.title)}: ${plain(d.what || '')}${d.result ? ` (${d.result})` : ''}`).join('\n')}\n`),
  ];
  fs.writeFileSync(path.join(DIST, 'llms-full.txt'), full.join('\n'));
}

// ---------- sitemap (every indexable page written above; lastmod = the page's own date, else build date) ----------
const today = new Date().toISOString().slice(0, 10);
const prio = (u) => (u === '/' || u === '/meetings/' ? '1.0' : ['/council/', '/scorecard/', '/quiz/', '/faq/'].includes(u) || u.startsWith('/meetings/') ? '0.8' : '0.6');
const mod = (u) => LASTMOD[u] || today;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...new Set(SITEMAP)].map((u) => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${mod(u)}</lastmod><priority>${prio(u)}</priority></url>`).join('\n')}
</urlset>
`);
// Share pictures for member and upcoming meeting pages (see shareCard above).
console.log(`Share cards: ${await (await import('./scripts/og-cards.mjs')).renderCards(CARDS, DIST)}`);
console.log(`Built ${all.length} council members, ${MEETINGS.length} meetings, ${PROMISES.length} promises -> dist/`);
