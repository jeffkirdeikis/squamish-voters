// Static site generator for Squamish Voters 2026. No dependencies.
//   node build.mjs   ->  dist/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const candidates = read('candidates.json');
const ctx = read('context.json');
// The voter quiz and the comparison pages use only the 12 core statements, so they stay quick.
// The rest are asked of candidates and shown on their profile once they answer.
const ALL_QUESTIONS = read('questions.json');
const QUESTIONS = ALL_QUESTIONS.filter((q) => q.core !== false);
const EXTRA_QUESTIONS = ALL_QUESTIONS.filter((q) => q.core === false);
const GLOSSARY = read('glossary.json');
const ORIGIN = 'https://squamishvoters.com';
const REPO = 'https://github.com/jeffkirdeikis/squamish-voters';
const SITE = { name: 'Squamish Voters 2026', updated: ctx.updated, contact: ctx.contact_email || null };

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
const officeLabel = (c) => (c.office === 'mayor' ? 'Running for Mayor' : 'Running for Council');

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
  street: { title: 'Homelessness & street safety', icon: '🏘️', short: 'Streets', ask: 'Housing and support first, or enforcement and order first?', lo: 'Housing and support first', hi: 'Enforcement and order first', q: { q5: -1, q20: -1, q6: 1, q18: 1, q31: 1, q19: 1, q32: 1, q35: 1 } },
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
  // up = housing and support first, down = enforcement and order first (the 'street' list, flipped)
  y: { q5: 1, q20: 1, q6: -1, q18: -1, q31: -1, q19: -1, q32: -1, q35: -1 },
};
const classicScore = (c, ax) => {
  const vals = Object.entries(CLASSIC[ax]).map(([q, sign]) => (typeof c.quiz_answers?.[q] === 'number' ? c.quiz_answers[q] * sign : null)).filter((v) => v !== null);
  return vals.length ? { v: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length } : null;
};
const compassPosOld = (c) => { const x = axisScore(c, 'money'), y = axisScore(c, 'env'); return x && y && x.n + y.n >= 2 && x.n >= 1 ? { x, y, thin: x.n + y.n <= 3 } : null; };
// Where a candidate has fewer than 2 scored statements on the money axis, fall back to our researched
// estimate of their economic lean (−5..+5, written up with reasons in the data) and mark the dot as an estimate.
const compassPos = (c) => {
  let x = classicScore(c, 'x'); const y = classicScore(c, 'y'); let est = false;
  const k = c.compass || {};
  const hasEst = typeof k.economic === 'number' && !/no evidence|placeholder/i.test(k.rationale || '');
  if ((!x || x.n < 2) && hasEst) { x = { v: Math.max(-2, Math.min(2, k.economic * 0.4)), n: x ? x.n : 0 }; est = true; }
  if (!x || !y) return null;
  return { x, y, est, thin: est || y.n < 2 };
};
const isPlaced = (c) => !!compassPos(c);
const placed = all.filter(isPlaced), unplaced = all.filter((c) => !isPlaced(c));

// Plain answer to the question everyone asks about the Woodfibre deal. Facts from the District's own FAQ and staff report.
const DEAL_SRC = 'https://squamish.ca/projects-plans-and-initiatives/projects-in-our-community/wlng-agreement/';
const DEAL_IF_NO = `<div class="ifno"><h3>The Woodfibre tax deal: what each choice means</h3>
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
  { key: 'environment_lng', title: 'Climate, environment & the LNG plant', icon: '🌲' },
  { key: 'transportation', title: 'Transportation & transit', icon: '🚌' },
  // allq: Compare shows every parking statement, not just the one in the quiz
  { key: 'parking', title: 'Parking', icon: '🅿️', allq: true },
  { key: 'economy', title: 'Jobs & local economy', icon: '💼' },
].filter((i) => !i.allq || ALL_QUESTIONS.some((q) => q.issue === i.key)); // a topic with no statements yet stays hidden
const issueCtx = (key) => (ctx.issues || []).find((i) => i.key === key) || {};

// ---------- layout ----------
const NAV = [
  ['/candidates/', 'Candidates'], ['/quiz/', 'Quiz'], ['/compare/', 'Compare'], ['/compass/', 'Where they lean'], ['/vote/', 'How to vote'],
];
// The Menu lists everything; the top bar only has room for the essentials.
const MENU = [...NAV, ['/issues/', 'The issues explained'], ['/my-ballot/', 'My ballot']];
const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10.5L12 4l8.5 6.5V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M9.5 21v-6h5v6"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.5.2 4 1.8 4.5 4.5"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  quiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.300a2.8 2.8 0 1 1 3.9 2.600c-.8.4-1.2 1-1.2 1.9"/><path d="M12 17.200v.1"/></svg>',
  vote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13h16v7.500H4z"/><path d="M8 13l1.5-8.500h5L16 13"/><path d="M10 8.500l1.5 1.5 2.5-3"/></svg>',
  compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
  ballot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8.500l1.2 1.2 2-2.400M8.5 14.500l1.2 1.2 2-2.400M14 9h2M14 15h2"/></svg>',
};
const TABS = [['/', 'Home', 'home'], ['/candidates/', 'People', 'people'], ['/quiz/', 'Quiz', 'quiz'], ['/compass/', 'Compass', 'compass'], ['/compare/', 'Compare', 'compare'], ['/vote/', 'Voting', 'vote']];

function page({ url, title, desc, body, hero = '', scripts = '', noindex = false, jsonld = null }) {
  const cur = (href) => ((href === '/' ? url === '/' : url.startsWith(href)) ? ' aria-current="page"' : '');
  const full = title ? `${title} — ${SITE.name}` : `${SITE.name} — an independent voter guide for the October 17 election`;
  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc || 'Plain-language guide to every candidate for Squamish mayor and council in the October 17, 2026 election: positions, comparisons, a matching quiz and how to vote.')}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(desc || 'Every candidate, every issue, in plain language. Take the quiz to find your match.')}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Squamish Voters">
<meta property="og:url" content="https://squamishvoters.com__PATH__">
<meta property="og:image" content="https://squamishvoters.com/og.png?v=3">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Squamish Voters — independent voter guide for the October 17, 2026 election">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://squamishvoters.com/og.png?v=3">
<link rel="canonical" href="https://squamishvoters.com__PATH__">
<meta name="theme-color" content="#0f4c3a">${noindex ? '\n<meta name="robots" content="noindex, nofollow">' : ''}${jsonld ? `\n<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<header class="site-header">
  <div class="wrap">
    <a class="logo" href="/" aria-label="${SITE.name} — home">
      <svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="#ffb703"/><path d="M5 30 L15 12 L21 22 L26 15 L35 30 Z" fill="#0f4c3a"/><path d="M12.5 25l3.5 3.5 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Squamish Voters<small>Voter guide · Oct 17, 2026</small></span>
    </a>
    <nav class="top-nav" aria-label="Main">
      ${NAV.map(([h, l]) => `<a href="${h}"${cur(h)}>${l}</a>`).join('')}
      <a class="hdr-btn" href="/my-ballot/">My ballot <span class="ballot-count" hidden>0</span></a>
    </nav>
    <a class="hdr-btn ballot-btn" href="/my-ballot/" aria-label="My ballot">${ICON.ballot}<span class="ballot-count" hidden>0</span></a>
    <button class="hdr-btn menu-btn" type="button" aria-expanded="false" aria-controls="menu-panel"><span>Menu</span></button>
  </div>
  <div class="menu-panel" id="menu-panel">
    <nav class="wrap" aria-label="All pages">
      <a href="/">Home</a>
      ${MENU.map(([h, l]) => `<a href="${h}"${cur(h)}>${l}</a>`).join('')}
      <a href="/about/">About this guide &amp; sources</a>
    </nav>
  </div>
</header>
${hero}
<main id="main"><div class="wrap">
${body}
</div></main>
<footer class="site-footer"><div class="wrap">
  <div class="cols">
    <div><h2>${SITE.name}</h2><p>An independent, non-partisan voter guide made by <a href="/about/#who">Jeff Kirdeikis</a>, a Squamish resident. Not affiliated with the District of Squamish, any candidate, or any party.</p><p>Last updated ${esc(SITE.updated)}.</p></div>
    <div><h2>Pages</h2><ul>${[['/', 'Home'], ...MENU, ['/about/', 'About, method &amp; corrections']].map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ul></div>
    <div><h2>Official information</h2><ul><li><a href="https://squamish.ca/government-and-administration/council/election/" target="_blank" rel="noopener">District of Squamish election page</a></li><li><a href="https://squamish.ca/government-and-administration/council/election/2026-municipal-election-candidates/" target="_blank" rel="noopener">Official candidate list</a></li><li><a href="https://elections.bc.ca/local-elections/" target="_blank" rel="noopener">Elections BC: local elections</a></li></ul>
    </div>
    <div><h2>Are you a candidate?</h2><p>Want to update your profile, add your positions or send a photo? Email <a href="mailto:${SITE.contact}">${SITE.contact}</a>. Anyone can also use this address to report a mistake.</p></div>
  </div>
</div></footer>
<nav class="tabbar" aria-label="Quick navigation">
  ${TABS.map(([h, l, i]) => `<a href="${h}"${cur(h)}>${ICON[i]}<span>${l}</span></a>`).join('')}
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
const pickBtn = (c, cls = 'btn secondary') => `<button type="button" class="${cls}" data-pick="${c.slug}" data-office="${c.office}" data-name="${esc(c.name)}" aria-pressed="false" aria-label="Add ${esc(c.name)} to my ballot">+ Add</button>`;
const candCard = (c) => `<li class="crow" data-incumbent="${!!c.incumbent}">
  <a class="crow-hit" href="/candidates/${c.slug}/">${avatar(c)}
    <span class="crow-txt"><b>${esc(c.name)}${c.incumbent ? ' <span class="badge incumbent">Current councillor</span>' : ''}${c.direct ? ' ' + directBadge(c) : ''}</b>
    <span class="crow-sub">${esc(c.tagline)}</span>
    <span class="crow-growth">${growthSentence(c)}</span></span>
    <span class="go" aria-hidden="true">›</span></a>
  ${pickBtn(c, 'btn secondary add no-print')}
</li>`;
const faceTile = (c) => `<a class="face" href="/candidates/${c.slug}/">${avatar(c)}<b>${esc(c.name)}</b>${c.incumbent ? '<span class="small">Current councillor</span>' : ''}</a>`;
const nameChip = (c) => `<li><a href="/candidates/${c.slug}/"${c.office === 'mayor' ? ' class="m"' : ''}>${avatar(c, 'xs')}${esc(c.name)}${c.office === 'mayor' ? ' <span class="small">(mayor)</span>' : ''}</a></li>`;

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
    ? `<div class="notice direct"><b>✓ Verified — in ${f}’s own words.</b> ${f} filled in our candidate questionnaire on ${when}. It was sent from the email address ${f} filed with the District of Squamish. Everything marked <span class="badge direct">✓ Direct answer</span> below is ${f}’s own answer, not our reading of the public record. <a href="#questionnaire">Jump to all answers</a>.${stmtOf(c) ? ` ${f} also sent us a platform statement on ${esc(fmtLong(stmtOf(c).date))} — <a href="${esc(stmtOf(c).url)}">read it in full</a>.` : ''}</div>`
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
  return `${words.length ? `<h2 id="own-words">In ${esc(first(c))}’s own words <span class="badge direct">✓ Direct</span></h2>
  <div class="card stack">${words.map(([k, label]) => `<details class="stance-row has-more"${k === 'pitch' || k === 'one_thing' ? ' open' : ''}><summary><span class="txt"><b>${esc(label.replace(/ — we may use.*$/, ''))}</b>${moreBtn(`Click to expand — read ${esc(first(c))}’s full answer`)}</span></summary><blockquote>${escGl(c.own_words[k])}</blockquote></details>`).join('')}</div>` : ''}
  ${noted.length ? `<h2 id="explained">${esc(first(c))} explains ${noted.length === 1 ? 'an answer' : 'their answers'} <span class="badge direct">✓ Direct</span></h2>
  <p class="small">${esc(first(c))} added a comment to ${noted.length} of the statements we put to every candidate. These are ${esc(first(c))}’s words, unedited.</p>
  <div class="card"><ul class="qa">${noted.slice(0, SHOW).map(noteLi).join('')}</ul>
  ${noted.length > SHOW ? `<details class="more"><summary>Show ${noted.length - SHOW} more</summary><ul class="qa">${noted.slice(SHOW).map(noteLi).join('')}</ul></details>` : ''}</div>` : ''}
  <details class="drop" id="questionnaire"><summary>All ${rows.length} of ${esc(first(c))}’s questionnaire answers <span class="badge direct">✓ Direct</span></summary>
  <ul class="qa">${rows.map((q) => `<li><b>${escGl(q.text)}</b><span class="ans">${ansWord(c, q)}</span>${wrote(c, q) ? `<p>“${escGl(wrote(c, q))}”</p>` : ''}</li>`).join('')}</ul>
  <p class="small">Answered by ${esc(c.name)} on ${esc(fmtLong(c.direct.date))}. Where these differ from our earlier reading of the public record, the candidate’s own answer is what counts in the quiz and compare pages.</p></details>`;
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
  ${none ? (mine ? '' : `<p class="muted">We could not find anything ${esc(c.name.split(' ')[0])} has said publicly about this.</p>`) : `<p>${escGl(s.summary)}${src(s.source_url)}</p>${s.quote ? `<blockquote>“${escGl(s.quote.replace(/^["“]|["”]$/g, ''))}”</blockquote>` : ''}${confLabel[s.confidence] ? `<p class="conf">${confLabel[s.confidence]}</p>` : ''}`}${mine}</details>`;
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
  write(`/candidates/${c.slug}/`, page({
    url: '/candidates/', title: `${c.name} — ${c.office === 'mayor' ? 'candidate for Mayor' : 'candidate for Council'}`,
    desc: `${c.name}: what they support, what they oppose, and where they stand on growth, housing, homelessness, policing and taxes in Squamish.`,
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'Person', name: c.name,
      url: `${ORIGIN}/candidates/${c.slug}/`,
      description: `Candidate for ${c.office === 'mayor' ? 'Mayor' : 'Council'} in the October 17, 2026 District of Squamish election.${c.tagline ? ' ' + c.tagline : ''}`,
      ...(hasPhoto(c) ? { image: `${ORIGIN}/${c.photo}` } : {}),
      ...(c.incumbent ? { jobTitle: 'Councillor, District of Squamish' } : {}),
      homeLocation: { '@type': 'Place', name: 'Squamish, British Columbia' },
      sameAs: Object.values(c.links || {}).filter(isUrl),
    }, {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Candidates', item: `${ORIGIN}/candidates/` },
        { '@type': 'ListItem', position: 3, name: c.name, item: `${ORIGIN}/candidates/${c.slug}/` },
      ],
    }],
    body: `<p class="crumbs"><a href="/candidates/" data-back>← All candidates</a></p>
    <div class="profile">
    <aside class="profile-side">
      ${avatar(c, 'lg')}
      <h1>${esc(c.name)}</h1><p class="role">${officeLabel(c)}${c.incumbent ? ' · Current councillor' : ''}</p>${c.direct ? `<p>${directBadge(c)}</p>` : ''}
      <p class="growth-line">${growthSentence(c)}</p>
      <p class="lede tagline">${escGl(c.tagline)}</p>
      <div class="side-actions no-print">${pickBtn(c, 'btn big block')}</div>
      ${links ? `<h2 class="side-h">Hear it from ${esc(c.name.split(' ')[0])} directly</h2><ul class="linklist">${links}</ul>` : ''}
      ${hasPhoto(c) ? `<p class="small muted">Photo: ${esc(c.photo_credit || 'candidate’s campaign')}.</p>` : ''}
    </aside>
    <div class="profile-main">
    ${thinRecord(c) ? `<div class="notice"><b>We could not find much yet.</b> ${esc(c.name)} has said very little in public so far. The best way to learn more is to email them${links ? ' using the link on this page' : ''}, or go to an <a href="/vote/#events">all-candidates meeting</a>.</div>` : ''}
    ${directNotice(c)}${paperNotice(c)}
    <p class="small ours">${stmtOf(c) ? `Summarised by us from ${esc(first(c))}’s own statement.` : 'Our summary of what ' + esc(first(c)) + ' has said and done in public.'} Tap <b>[source]</b> on any line to check it yourself.</p>
    <div class="grid cols-2">
      ${sideList(c, 'supports', 'Supports', 'for', 'forlist')}
      ${sideList(c, 'opposes', 'Against', 'against', 'againstlist')}
    </div>
    <h2 id="issues">Where ${esc(c.name.split(' ')[0])} stands</h2>
    <p class="small">Each topic opens up — press <b>Click to expand</b> for the detail, quotes and sources.</p>
    <div class="card stack">${ISSUES.map((i) => stanceRow(c, i)).join('')}</div>
    ${(c.top_priorities || []).length ? `<details class="drop"><summary>${esc(c.name.split(' ')[0])}’s own priority list</summary><ol class="ol">${c.top_priorities.map((p) => `<li>${escGl(p)}</li>`).join('')}</ol></details>` : ''}
    ${emailedAnswers(c)}
    ${directAnswers(c)}
    <details class="drop"><summary>About ${esc(c.name.split(' ')[0])}</summary><p>${escGl(c.occupation_background)}</p></details>
    <details class="drop"><summary>Where ${esc(c.name.split(' ')[0])} leans on money, growth and LNG</summary>${Object.keys(AXES).map((k) => miniSlider(c, k)).join('')}<p class="small">Worked out from ${esc(c.name.split(' ')[0])}’s public statements and votes — not a label they chose. <a href="/compass/">See everyone side by side</a>.</p></details>
    <details class="drop"><summary>Sources we used (${(c.sources || []).filter((s) => isUrl(s.url)).length})</summary><ul class="small">${(c.sources || []).filter((s) => isUrl(s.url)).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></li>`).join('')}</ul></details>
    ${links ? `<div class="mobile-links"><h2>Hear it from ${esc(c.name.split(' ')[0])} directly</h2><ul class="linklist">${links}</ul></div>` : ''}
    <p class="small claim">Are you ${esc(c.name)}, or did you spot a mistake? Email <a href="mailto:${SITE.contact}?subject=${encodeURIComponent('Update for ' + c.name)}">${SITE.contact}</a> to update or add to this page. <a href="/about/#corrections">How corrections work</a>.</p>
    <div class="btn-row no-print"><a class="btn secondary" href="/candidates/${prev.slug}/">← ${esc(prev.name)}</a><a class="btn secondary" href="/candidates/${next.slug}/">${esc(next.name)} →</a></div>
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
  </div>${said.length ? `<details class="said" data-q="${q.id}"><summary>${moreBtn(`Click to expand — read what ${said.length === 1 ? esc(said[0].name) : said.length + ' candidates'} wrote about this`)}</summary><ul class="qa">${said.map((c) => `<li><a href="/candidates/${c.slug}/#explained"><b>${esc(c.name)}</b></a>${c.office === 'mayor' ? ' <span class="small">(for mayor)</span>' : ''} <span class="ans">${ansWord(c, q)}</span><p>“${esc(wrote(c, q))}”</p></li>`).join('')}</ul><p class="small">Comments candidates added when answering our questionnaire, unedited.</p></details>` : ''}</div>`;
}
const issueSection = (i) => {
  const ic = issueCtx(i.key);
  return `<section id="${i.key}" data-panel data-group="cmp" hidden><h2><span aria-hidden="true">${i.icon}</span> ${i.title}</h2>
  ${ic.short_explainer ? `<p>${esc(ic.short_explainer)} <a href="/issues/#${i.key}">More background</a></p>` : ''}
  ${(i.allq ? ALL_QUESTIONS : QUESTIONS).filter((q) => q.issue === i.key).map((q) => spectrum(q) + (q.id === 'q23' ? `<details class="drop ifno-d"><summary>What happens if council says yes — or no?</summary>${DEAL_IF_NO.replace('<h3>The Woodfibre tax deal: what each choice means</h3>', '')}</details>` : '')).join('')}
  <details><summary>Read each candidate’s position on ${i.title.toLowerCase()}</summary>
  <div class="table-scroll"><table class="issue-table"><thead><tr><th>Candidate</th><th>Position</th></tr></thead><tbody>
  ${all.map((c) => { const s = c.stances?.[i.key] || {}; const none = !s.position || /no public position/i.test(s.position); return `<tr><td><a href="/candidates/${c.slug}/">${esc(c.name)}</a>${c.office === 'mayor' ? '<br><span class="small">for mayor</span>' : ''}</td><td>${none ? '<span class="muted">No public position found.</span>' : `<span class="pos">${esc(s.position)}</span>${esc(s.summary)}${src(s.source_url)}`}</td></tr>`; }).join('')}
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
  ${all.map((c) => `<tr><td><a href="/candidates/${c.slug}/">${esc(c.name)}</a>${c.office === 'mayor' ? ' <span class="small">(mayor)</span>' : ''}</td>${QUESTIONS.map((q) => `<td>${cell(c.quiz_answers?.[q.id])}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>
  <ol class="small" style="margin-top:1rem">${QUESTIONS.map((q) => `<li><b>${esc(q.short)}:</b> “${esc(q.text)}”</li>`).join('')}</ol></section>
  <nav class="panel-nav no-print" data-panel-nav="cmp" aria-label="Move between topics"></nav></div>`;
write('/compare/', page({
  url: '/compare/', title: 'Compare the candidates',
  desc: 'See where every Squamish mayor and council candidate stands on housing, growth, taxes, Woodfibre LNG and more, side by side, issue by issue.',
  body: `<h1>Compare the candidates</h1>
  <p class="lede">Pick an issue to see where everyone stands, side by side. Candidates for mayor are marked in yellow.</p>
  ${COMPARE_BLOCK}
  ${miniCompass({ heading: 'The same candidates on one map' })}
  <a class="card" href="/issues/" style="display:block;margin-top:1.5rem"><h3>The issues explained</h3><p>Plain-language background on what this election is actually about.</p></a>`,
}));

// ---------- HOME (written after Compare because it reuses COMPARE_BLOCK) ----------
const v = ctx.voting || {};
write('/', page({
  url: '/', title: '',
  jsonld: [{
    '@context': 'https://schema.org', '@type': 'WebSite', name: 'Squamish Voters', alternateName: 'SquamishVoters.com', url: `${ORIGIN}/`, inLanguage: 'en-CA',
    description: 'Independent, non-partisan voter guide for the October 17, 2026 District of Squamish municipal election.',
  }, {
    '@context': 'https://schema.org', '@type': 'Organization', name: 'Squamish Voters', url: `${ORIGIN}/`, logo: `${ORIGIN}/favicon.svg`,
    founder: { '@type': 'Person', name: 'Jeff Kirdeikis' }, areaServed: 'Squamish, British Columbia',
    ...(SITE.contact ? { email: SITE.contact } : {}),
  }],
  hero: `<section class="hero"><div class="wrap">
    <h1>Not sure who to vote for in Squamish?</h1>
    <p class="lede">On <b>Saturday, October 17</b> we pick 1 mayor and 6 councillors. Here is where all ${all.length} candidates stand, in plain words.</p>
    <div class="btn-row"><a class="btn big" href="/quiz/">Who actually agrees with you? →<small>${QUESTIONS.length} quick questions · about 3 minutes</small></a></div>
    <p class="hero-alt"><a href="/candidates/">Or just show me everyone running →</a></p>
  </div></section>`,
  body: `
  <a class="datebar-link" href="/vote/">
    <div class="datebar">${(ctx.key_dates || []).map((d) => `<div class="datecard"><b>${esc(d.date)}</b><span>${esc(d.label)}</span></div>`).join('')}</div>
    <p class="small center" style="margin:.6rem 0 0">Full details on how, when and where to vote →</p>
  </a>
  <div class="trust-card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8l7.5 3v5.6c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V5.8z"/><path d="M8.6 12.2l2.4 2.4 4.6-5"/></svg><div>
    <h2>You can check our work</h2>
    <p>No endorsements. The same questions go to every candidate, every claim links to its source, and the code and scoring formula are public for anyone to inspect.</p>
    <p class="trust-links"><a href="${REPO}" target="_blank" rel="noopener">See the code on GitHub →</a><a href="/about/#quiz">How the scoring works →</a></p>
  </div></div>
  <h2>Running for Mayor <span class="small">— you vote for 1</span></h2>
  <div class="faces">${mayors.map(faceTile).join('')}</div>
  <div class="btn-row"><a class="btn secondary block" href="/candidates/#council">See all ${council.length} council candidates →</a></div>
  ${miniCompass()}
  <div class="lean-teaser" data-carousel aria-roledescription="carousel" aria-label="Where they lean">
    <div class="lt-head">
      <span class="lt-kicker">Where they lean <span class="lt-count" data-car-count></span></span>
      <span class="lt-arrows"><button type="button" class="picker-step" data-car-prev aria-label="Previous question">‹</button><button type="button" class="picker-step" data-car-next aria-label="Next question">›</button></span>
    </div>
    ${Object.entries(AXES).map(([k, A], n) => `<a class="lt-slide" data-slide href="/compass/#axis-${k}"${n ? ' hidden' : ''}>
      <b class="lt-q"><span aria-hidden="true">${A.icon}</span> ${esc(A.ask)}</b>
      ${spectrumTeaser(k)}
      <span class="lt-go">See everyone on ${esc(lc(A.title))} →</span>
    </a>`).join('')}
    <p class="small lt-hint no-print">Use the arrows to see the other ${Object.keys(AXES).length - 1} questions, or tap the line for the full picture.</p>
  </div>
  <h2 id="compare">Where they stand, issue by issue</h2>
  <p>Pick a topic, or use the arrows to move through them. Every position links to where the candidate said it.</p>
  ${COMPARE_BLOCK}
  <div class="notice info"><b>Independent and non-partisan.</b> Made by <a href="/about/#who">Jeff Kirdeikis</a>, a Squamish resident. We don’t endorse anyone. Every position links to where the candidate said it, and when we couldn’t find an answer we say so instead of guessing. <a href="/about/">How we made this</a>.</div>`,
}));

// ---------- CANDIDATES (list page; written after Compare because it reuses COMPARE_BLOCK) ----------
write('/candidates/', page({
  url: '/candidates/', title: 'The candidates',
  desc: `All ${all.length} candidates for Squamish mayor and council in the October 17, 2026 election, in alphabetical order, with what each supports and opposes.`,
  body: `<h1>The candidates</h1>
  <p class="lede">Everyone on the ballot, in alphabetical order. Tap anyone to see what they support and oppose.</p>
  <div class="jump"><a class="chip-btn" href="#mayor">Mayor (${mayors.length})</a><a class="chip-btn" href="#council">Council (${council.length})</a><a class="chip-btn" href="#compare">Compare them</a><a class="chip-btn" href="#trustees">School trustees</a></div>
  <p class="small"><span class="badge direct">✓ Answered us directly</span> means the candidate filled in our questionnaire themselves. Everything else is our summary of public sources, each with a link.</p>
  <h2 id="mayor">For Mayor <span class="small">— vote for 1</span></h2>
  <ul class="cand-list">${mayors.map(candCard).join('')}</ul>
  <h2 id="council">For Council <span class="small">— vote for up to 6</span></h2>
  <div class="filters no-print" role="group" aria-label="Filter council candidates">
    <button class="chip-btn" type="button" data-filter="all" aria-pressed="true">Show all</button>
    <button class="chip-btn" type="button" data-filter="incumbent" aria-pressed="false">Current councillors</button>
    <button class="chip-btn" type="button" data-filter="new" aria-pressed="false">New faces</button>
  </div>
  <ul class="cand-list" id="council-grid">${council.map(candCard).join('')}</ul>
  <h2 id="compare">Compare them, issue by issue</h2>
  <p>Pick an issue to see where everyone stands, side by side. Candidates for mayor are marked in yellow.</p>
  ${COMPARE_BLOCK}
  <h2 id="trustees">School trustees</h2>
  <div class="card"><p>Squamish voters also elect school trustees for School District 48 (Sea to Sky). This guide focuses on mayor and council, but here is who is running:</p>
  <p><b>${(ctx.trustees || []).map(esc).join(' · ')}</b></p>
  <p class="small">See the <a href="https://squamish.ca/government-and-administration/council/election/2026-municipal-election-candidates/" target="_blank" rel="noopener">official candidate list</a> for their contact details.</p></div>`,
  scripts: `<script>document.querySelectorAll('[data-filter]').forEach(function(b){b.addEventListener('click',function(){var f=b.getAttribute('data-filter');document.querySelectorAll('[data-filter]').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});document.querySelectorAll('#council-grid .crow').forEach(function(c){var inc=c.getAttribute('data-incumbent')==='true';c.hidden=f==='incumbent'?!inc:f==='new'?inc:false})})})</script>`,
}));

// ---------- COMPASS ----------
// mini: the small version for home, quiz results and Compare. Bigger type (it is drawn smaller), short axis words,
// and not tappable — the whole chart is a link to the full one. data-map lets site.js add the ★ You dot.
function compassSvg({ mini = false, tap = !mini } = {}) {
  const W = 600, H = 600, P = mini ? 62 : 46, R = 2.15, S = (W - 2 * P) / (2 * R); // scores run -2..+2
  const FS = mini ? 32 : 18, AFS = mini ? 27 : 18, DR = mini ? 13 : 10, cw = FS * 0.6;
  const px = (v) => P + (v + R) * S, py = (v) => P + (R - v) * S;
  const pts = placed.map((c) => { const p = compassPos(c); return { c, thin: p.thin, x: px(p.x.v), y: py(p.y.v) }; });
  const near = mini ? 30 : 24;
  pts.forEach((p, i) => pts.slice(0, i).forEach((o) => { if (Math.hypot(p.x - o.x, p.y - o.y) < near) { p.x += near * 0.83; p.y += near * 0.67; } }));
  const boxes = [];
  const hit = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  pts.forEach((p) => boxes.push({ x: p.x - DR - 2, y: p.y - DR - 2, w: 2 * DR + 4, h: 2 * DR + 4 }));
  // keep names off the four axis titles
  const tw = (t) => t.replace(/&amp;/g, '&').length * AFS * 0.62;
  const L0 = mini ? ['▲ HOUSING & SUPPORT', '▼ ENFORCEMENT & ORDER', '◀ SPEND MORE', 'LOWER TAXES ▶'] : ['▲ HOUSING & SUPPORT FIRST', '▼ ENFORCEMENT & ORDER FIRST', '◀ LEFT · SPEND MORE ON SERVICES', 'RIGHT · LOWER TAXES ▶'];
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
  const L = mini
    ? { up: '▲ HOUSING &amp; SUPPORT', down: '▼ ENFORCEMENT &amp; ORDER', left: '◀ SPEND MORE', right: 'LOWER TAXES ▶' }
    : { up: '▲ HOUSING &amp; SUPPORT FIRST', down: '▼ ENFORCEMENT &amp; ORDER FIRST', left: '◀ LEFT · SPEND MORE ON SERVICES', right: 'RIGHT · LOWER TAXES ▶' };
  const id = (mini ? 'm' : '') + (tap ? 'c' : 'x');
  const map = esc(JSON.stringify({ W, P, R, fs: FS, x: CLASSIC.x, y: CLASSIC.y }));
  return `<svg viewBox="0 0 ${W} ${H}" role="${tap ? 'group' : 'img'}" aria-labelledby="${id}title ${id}desc" data-map="${map}">
  <title id="${id}title">The Squamish compass</title><desc id="${id}desc">Scatter chart. Left to right runs from left (spend more on public services) to right (lower taxes). Bottom to top runs from enforcement and order first to housing and support first.${!tap ? ` Placed: ${placed.map((c) => esc(c.name)).join(', ')}.` : ' The same information follows as sliders and a table.'}</desc>
  <rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}" fill="#fcfcfb" stroke="#c3c2b7"/>
  <rect x="${P}" y="${P}" width="${(W - 2 * P) / 2}" height="${(H - 2 * P) / 2}" fill="#f4f1e8"/><rect x="${W / 2}" y="${H / 2}" width="${(W - 2 * P) / 2}" height="${(H - 2 * P) / 2}" fill="#f4f1e8"/>
  ${[-1, 1].map((t) => `<line x1="${px(t)}" y1="${P}" x2="${px(t)}" y2="${H - P}" stroke="#e1e0d9"/><line x1="${P}" y1="${py(t)}" x2="${W - P}" y2="${py(t)}" stroke="#e1e0d9"/>`).join('')}
  <line x1="${W / 2}" y1="${P}" x2="${W / 2}" y2="${H - P}" stroke="#898781" stroke-width="1.5"/><line x1="${P}" y1="${H / 2}" x2="${W - P}" y2="${H / 2}" stroke="#898781" stroke-width="1.5"/>
  <text x="${W / 2}" y="${P - 16}" text-anchor="middle" font-size="${AFS}" font-weight="700" fill="#14211c">${L.up}</text>
  <text x="${W / 2}" y="${H - P + AFS + 12}" text-anchor="middle" font-size="${AFS}" font-weight="700" fill="#14211c">${L.down}</text>
  <text transform="translate(${P - 16} ${H / 2}) rotate(-90)" text-anchor="middle" font-size="${AFS}" font-weight="700" fill="#14211c">${L.left}</text>
  <text transform="translate(${W - P + AFS + 12} ${H / 2}) rotate(-90)" text-anchor="middle" font-size="${AFS}" font-weight="700" fill="#14211c">${L.right}</text>
  ${pts.map((p) => `<g class="cdot"${!tap ? '' : ` tabindex="0" role="button" aria-label="${esc(p.c.name)}"`} data-slug="${p.c.slug}">
    ${!tap ? '' : `<circle cx="${p.x}" cy="${p.y}" r="${DR + 12}" fill="transparent" stroke="none"/>`}
    ${p.lead ? `<line x1="${p.lead[0].toFixed(1)}" y1="${p.lead[1].toFixed(1)}" x2="${p.lead[2].toFixed(1)}" y2="${p.lead[3].toFixed(1)}" stroke="#14211c" stroke-width="${mini ? 2 : 1.5}"/>` : ''}
    <circle cx="${p.x}" cy="${p.y}" r="${DR}" fill="${p.thin ? '#fcfcfb' : col(p.c)}" stroke="${p.thin ? col(p.c) : '#fcfcfb'}" stroke-width="${p.thin ? DR * 0.35 : 2}"/>
    <text x="${p.lx}" y="${p.ly}" text-anchor="${p.anchor}" font-size="${FS}" font-weight="600" fill="#14211c" paint-order="stroke" stroke="#fcfcfb" stroke-width="${FS / 4.5}">${esc(lastName(p.c))}</text></g>`).join('')}
  </svg>`;
}
// The small compass as a card. `you` adds the ★ You prompt (quiz CTA before the quiz, a note after it).
function compassLegend(mini) { return `<div class="legend${mini ? ' mini' : ''}"><span><svg width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="#eb6834"/></svg>Mayor</span><span><svg width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="#2a78d6"/></svg>Council</span><span><svg width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="7.5" fill="#fff" stroke="#2a78d6" stroke-width="3.5"/></svg>${mini ? 'Hollow = thin evidence' : 'Hollow = only one statement on homelessness, or partly our estimate'}</span></div>`; }
function miniCaveat() { return `Only ${placed.length} of ${all.length} candidates have enough on the public record to place, and council has never voted on the enforcement side — so most sitting councillors can only show up on the upper half.`; }
function miniCompass({ heading = 'The Squamish compass', you = true } = {}) {
  return `<section class="mini-compass">
  <span class="lt-kicker">🧭 ${heading}</span>
  <p class="mc-q">Left or right on money. Support first or enforcement first on the streets.</p>
  ${compassLegend(true)}
  <a class="mc-chart" href="/compass/" aria-label="Open the full compass">${compassSvg({ mini: true })}</a>
  <p class="small mc-note">${miniCaveat()} <a href="/compass/#map">How it’s worked out</a>.</p>
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
  const row = (i) => `<li class="srow${i.s.n === 1 && !single ? ' thin' : ''}" data-slug="${i.c.slug}" data-v="${i.s.v.toFixed(3)}"><a href="/candidates/${i.c.slug}/">${avatar(i.c, 'sm')}<span class="sname"><b>${esc(i.c.name)}</b><span>${i.c.office === 'mayor' ? 'Mayor' : 'Council'}${single ? '' : ` · ${i.s.n} statement${i.s.n > 1 ? 's' : ''}`}</span></span><span class="strack" aria-hidden="true"><i style="left:${trackPct(i.s.v)}%"></i></span></a></li>`;
  const used = Object.entries(A.q).map(([q, sign]) => { const Q = ALL_QUESTIONS.find((x) => x.id === q); return `“${Q.text}” <span class="muted">(agreeing moves a candidate toward “${lc(sign > 0 ? A.hi : A.lo)}”)</span>`; });
  return `<section class="spec" id="axis-${key}" data-axis="${key}">
  <h2><span aria-hidden="true">${A.icon}</span> ${A.title}</h2>
  <p class="ask">${esc(A.ask)}</p>
  ${key === 'street' ? `<p class="small">Some candidates want both more housing <b>and</b> more enforcement — they land in the middle. Many have only spoken about one side so far, so check the number of statements.</p>` : ''}
  ${key === 'deal' ? `<p class="small">This is about <b>money, not the environment</b>. People on both sides of the plant itself disagree about whether this is a good deal for taxpayers. <a href="/issues/#environment_lng">What’s in the deal</a>.</p><details class="drop ifno-d"><summary>What happens if council says yes — or no?</summary>${DEAL_IF_NO.replace('<h3>The Woodfibre tax deal: what each choice means</h3>', '')}</details>` : ''}
  ${single ? '' : `<p class="small legend-line"><span class="lg-dot"></span> based on 2 or more statements &nbsp; <span class="lg-dot hollow"></span> only 1 statement — treat with care</p>`}
  <div class="spec-ends" aria-hidden="true"><span>◀ ${A.lo}</span><span>${A.hi} ▶</span></div>
  ${bands.filter((b) => b.rows.length).map((b) => `<h3 class="band">${esc(b.label)} <span>(${b.rows.length})</span></h3><ul class="slist">${b.rows.map(row).join('')}</ul>`).join('')}
  ${missing.length ? `<p class="small nopos"><b>Haven’t said yet:</b> ${missing.map((c) => `<a href="/candidates/${c.slug}/">${esc(c.name)}</a>`).join(', ')}.</p>` : ''}
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
const classicWords = (c) => { const p = compassPos(c); if (!p) return []; const w = (v, lo, hi) => (Math.abs(v) < 0.34 ? 'in the middle' : `${Math.abs(v) >= 1.2 ? 'clearly' : 'leans'} ${v < 0 ? lo : hi}`);
  return [`Left–right: ${w(p.x.v, 'left (more public spending)', 'right (lower taxes)')}${p.est ? ' — our estimate from their platform' : ` (${p.x.n} statements)`}`, `Homelessness & street safety: ${w(p.y.v, 'enforcement and order first', 'housing and support first')} (${p.y.n} statement${p.y.n > 1 ? 's' : ''})`]; };
const compassDetailAxes = (c) => Object.keys(AXES).map((k) => { const s = axisScore(c, k); return `${AXES[k].title}: ${axisWords(k, s)}${s ? ` (${s.n} statement${s.n > 1 ? 's' : ''})` : ''}`; });
write('/compass/', page({
  url: '/compass/', title: 'Where they lean',
  desc: 'Where Squamish mayor and council candidates sit on taxes and spending, growth, and Woodfibre LNG and climate — worked out from their public statements and votes.',
  body: `<h1>Where they lean</h1>
  <p class="lede">Everyone on one map first, then the five questions that split this election, one at a time.</p>
  <nav class="chapters no-print" aria-label="Jump to a topic"><a href="#map" data-ch="map"><span aria-hidden="true">🧭</span> Compass</a>${Object.entries(AXES).map(([k, A]) => `<a href="#axis-${k}" data-ch="axis-${k}"><span aria-hidden="true">${A.icon}</span> ${A.short || A.title}</a>`).join('')}</nav>
  <div class="lean-tools no-print">
    <label for="follow"><b>Follow one candidate:</b></label>
    <select id="follow"><option value="">— Show everyone —</option>${all.map((c) => `<option value="${c.slug}">${esc(c.name)}${c.office === 'mayor' ? ' (mayor)' : ''}</option>`).join('')}</select>
  </div>
  <section class="spec" id="map">
  <h2><span aria-hidden="true">🧭</span> The political compass</h2>
  <p class="ask">Left or right on money. Support first or enforcement first on the streets.</p>
  ${compassLegend(false)}
  <div class="compass-box"><div class="cb-wide">${compassSvg()}</div><div class="cb-narrow">${compassSvg({ mini: true, tap: true })}</div></div>
  <div class="card compass-detail" id="cdetail" aria-live="polite" style="margin-top:1rem"><p class="muted" style="margin:0">Tap any dot above to see the details here.</p></div>
  <p class="small"><b>Left–right</b> is about money: spend more on public services and housing (left), or hold taxes and spending down (right). <b>Up–down</b> is the argument downtown: put housing, shelter and support services first (up), or put enforcement, policing and clearing encampments first (down). Someone who wants both lands in the middle. Tap a dot for details.</p>
  <p class="small"><b>Read this before judging anyone by it:</b> council has voted on supportive housing but has never voted on encampments, police numbers or public drug use — so most sitting councillors can only show up on the upper half. Only candidates who answered our questionnaire are placed on both sides. <a href="/issues/#homelessness">What council has and hasn’t decided</a>.</p>
  ${unplaced.length ? `<p class="small nopos"><b>Not on the compass</b> (too little on the public record to place fairly): ${unplaced.map((c) => `<a href="/candidates/${c.slug}/">${esc(c.name)}</a>`).join(', ')}.</p>` : ''}
  </section>

  <h2 class="lean-more">Now topic by topic</h2>
  <p>The compass squeezes everything into two lines. Here is where everyone sits on each of the five questions on its own.</p>
  ${Object.keys(AXES).map(leanList).join('<!--YOU-->').replace('<!--YOU-->', `<div class="card you-cta no-print" id="you-cta"><b>Where do <em>you</em> fit?</b> Take the <a href="/quiz/">3-minute quiz</a> and a ★ You marker appears on the compass and on every list.</div>`)}


  <details class="drop"><summary>Everything above as a plain table</summary>
  <div class="table-scroll"><table class="issue-table"><thead><tr><th>Candidate</th>${Object.values(AXES).map((A) => `<th>${A.title}</th>`).join('')}</tr></thead><tbody>
  ${all.map((c) => `<tr><td><a href="/candidates/${c.slug}/">${esc(c.name)}</a>${c.office === 'mayor' ? '<br><span class="small">for mayor</span>' : ''}</td>${Object.keys(AXES).map((k) => { const s = axisScore(c, k); return `<td data-label="${AXES[k].title}">${s ? esc(axisWords(k, s)) : '<span class="muted">no public record</span>'}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div></details>
  <details class="drop"><summary>How the compass is worked out</summary><p>Nobody here runs for a party, so nobody chose these labels. Each dot is <b>calculated</b> from the same sourced answers used in the quiz. <b>Left–right</b> averages the statements about taxes, borrowing and public spending (housing, shelters, transit, recreation, bike lanes, childcare). <b>Up–down</b> averages the statements on homelessness and street safety: more shelter and supportive housing, and mental-health crisis teams (up), against more RCMP, more bylaw officers downtown, moving Under One Roof out of downtown, clearing encampments, putting safety first when the two conflict, and bylaws against public drug use (down). Where a candidate has answered fewer than two money statements, we use our own researched estimate of their lean from their platform and mark the dot hollow.</p></details>
  <details class="drop" hidden><summary>Why not “left vs. right”?</summary><p>Those labels come from national politics. Town councils don’t vote on civil liberties, candidates here don’t run for parties, and almost none of them have said anything about policing. Rather than guess, every position on this page is <b>calculated from the candidate’s sourced answers</b> to the same statements used in <a href="/quiz/">the quiz</a>. Anyone who hasn’t spoken publicly on a topic is left off that list, not parked in the middle.</p></details>`,
  scripts: `<script>var CD=${JSON.stringify(Object.fromEntries(placed.map((c) => [c.slug, { n: c.name, d: classicWords(c) }])))};
var AX=${JSON.stringify(Object.fromEntries(Object.entries(AXES).map(([k, A]) => [k, A.q])))};
</script><script src="/lean.js"></script>`,
}));

// ---------- ISSUES ----------
write('/issues/', page({
  url: '/issues/', title: 'The issues, explained',
  desc: 'The big questions in the 2026 Squamish election — housing, growth, taxes, Woodfibre LNG, homelessness, policing, parking — explained in plain language with sources.',
  body: `<h1>The issues, explained</h1>
  <p class="lede">A plain-language primer on what this election is about. Tap any topic to open it.</p>
  ${(ctx.issues || []).map((i) => { const paras = i.explainer.split(/(?<=[.!?])\s+/); const mid = Math.ceil(paras.length / 2); return `<details class="issue-card" id="${i.key}"><summary><span><b>${esc(i.title)}</b><span class="teaser">${esc(i.teaser)}</span></span></summary>
    <p>${esc(paras.slice(0, mid).join(' '))}</p><p>${esc(paras.slice(mid).join(' '))}</p>
    ${i.key === 'environment_lng' || i.key === 'taxes_spending' ? DEAL_IF_NO : ''}
    ${(i.key_facts || []).length ? `<h3>Key facts</h3><ul class="facts">${i.key_facts.map((f) => `<li>${esc(f.fact)}${src(f.source_url)}</li>`).join('')}</ul>` : ''}
    ${ISSUES.some((x) => x.key === i.key) ? `<div class="btn-row"><a class="btn secondary" href="/compare/#${i.key}">See where candidates stand →</a></div>` : ''}</details>`; }).join('')}`,
  scripts: `<script>function openHash(){var el=location.hash&&document.getElementById(location.hash.slice(1));if(el&&el.tagName==='DETAILS'){el.open=true;el.scrollIntoView()}}window.addEventListener('hashchange',openHash);openHash()</script>`,
}));

// ---------- QUIZ ----------
const clientData = {
  questions: QUESTIONS.map((q) => ({ id: q.id, text: q.text, short: q.short, why: q.why, topic: q.topic, what: q.what || null })),
  candidates: all.map((c) => ({ slug: c.slug, name: c.name, office: c.office, incumbent: !!c.incumbent, initials: initials(c), photo: hasPhoto(c) ? '/' + c.photo : null, answers: c.quiz_answers || {}, direct: isDirectQ(c) })),
  // For the "before you see your matches" notice: how thin the record still is.
  stats: { total: all.length, answered: all.filter(isDirectQ).length, unmatched: all.filter((c) => QUESTIONS.filter((q) => typeof c.quiz_answers?.[q.id] === 'number').length < 4).length },
};
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'data.js'), 'window.SV_DATA=' + JSON.stringify(clientData) + ';');
write('/quiz/', page({
  url: '/quiz/', title: 'Who should I vote for? Take the quiz',
  desc: `Answer ${QUESTIONS.length} plain-language questions and see which Squamish mayor and council candidates match your views.`,
  body: `<div class="quiz-shell"><div id="quiz-intro"><h1>Who should I vote for?</h1>
  <p class="lede">${QUESTIONS.length} statements. Tell us if you agree or disagree. It takes about three minutes, and your answers never leave your device.</p></div>
  <div id="quiz" class="card"><noscript>The quiz needs JavaScript turned on. You can still <a href="/compare/">compare candidates issue by issue</a>.</noscript></div>
  <p class="small" style="margin-top:1rem">How matching works: we compare your answers to each candidate’s public positions and votes. Questions you mark as important count double. Where a candidate has no public position, that question is left out for them. <a href="/about/#quiz">Full method</a>.</p></div>
  <template id="tpl-compass">${miniCompass({ heading: 'Where you land', you: false })}</template>`,
  scripts: '<script src="/data.js"></script><script src="/quiz.js"></script>',
}));

// ---------- MY BALLOT ----------
const V = ctx.voting || {}, gv = V.general_voting_day || {}, mb = V.mail_ballot || {}, ceo = V.chief_election_officer || {};
write('/my-ballot/', page({
  url: '/my-ballot/', title: 'My ballot',
  desc: 'Build and print your own Squamish ballot: pick a mayor and up to six councillors, then bring your list into the voting booth on October 17.',
  body: `<h1>My ballot</h1>
  <p class="lede">Your list, saved on this phone or computer only. You’re allowed to bring it into the voting booth.</p>
  <h2>Mayor <span class="small">— vote for 1</span></h2><div id="b-mayor"></div>
  <h2>Council <span class="small">— vote for up to 6. You can vote for fewer.</span></h2><div id="b-council"></div>
  <p id="b-left" class="small"></p>
  <div class="btn-row no-print"><button class="btn big" type="button" id="send">Send this list to myself</button><button class="btn secondary" type="button" onclick="window.print()">Print</button><button class="btn secondary" type="button" id="clear">Clear my list</button></div>
  <div class="card big-answer" style="margin-top:1.4rem"><h2 style="margin-top:0">Then go and vote</h2><p><b>Saturday, October 17</b> · ${esc(gv.hours)}<br>${(gv.places || []).map((pl) => esc(pl.name)).join(', ')}</p><p>Bring two pieces of ID — one with your signature.</p><a class="btn secondary" href="/vote/">Early voting, mail ballots and the map →</a></div>
  <div class="notice info">This is only a reminder list for you. It is <b>not</b> a vote. You must vote in person or by mail ballot.</div>`,
  scripts: `<script src="/data.js"></script><script>(function(){var C={};SV_DATA.candidates.forEach(function(c){C[c.slug]=c});
function slot(c,office){var d=document.createElement('div');d.className='ballot-slot'+(c?' filled':'');if(c){if(c.photo){var im=document.createElement('img');im.className='avatar sm';im.src=c.photo;im.alt='';d.append(im)}var a=document.createElement('a');a.className='name';a.href='/candidates/'+c.slug+'/';a.textContent=c.name;var b=document.createElement('button');b.type='button';b.className='no-print';b.textContent='Remove';b.setAttribute('aria-label','Remove '+c.name);b.onclick=function(){SV.toggle(c.slug,office,c.name)};d.append(a,b)}else{var s=document.createElement('span');s.className='muted';s.textContent='Nobody picked for mayor yet.';d.append(s)}return d}
function draw(){var b=SV.getBallot(),m=document.getElementById('b-mayor'),k=document.getElementById('b-council'),left=document.getElementById('b-left');m.textContent='';k.textContent='';m.append(slot(C[b.mayor],'mayor'));var list=b.council.filter(function(s){return C[s]});list.forEach(function(s){k.append(slot(C[s],'council'))});var n=6-list.length;left.innerHTML=n>0?'<b>'+n+' council spot'+(n===1?'':'s')+' left.</b> Voting for fewer than 6 is fine. <a href="/candidates/#council">See the candidates</a> or <a href="/quiz/">take the quiz</a>.':'<b>That’s all 6 council picks.</b>'}
function text(){var b=SV.getBallot(),L=['My Squamish ballot — vote Sat Oct 17, 8am-8pm, Brennan Park','','Mayor: '+(C[b.mayor]?C[b.mayor].name:'(not picked)'),'Council:'];b.council.forEach(function(s){if(C[s])L.push(' - '+C[s].name)});L.push('','squamishvoters.com');return L.join('\\n')}
document.getElementById('send').onclick=function(){var t=text();SV.track('Ballot sent');if(navigator.share){navigator.share({title:'My Squamish ballot',text:t}).catch(function(){})}else if(navigator.clipboard){navigator.clipboard.writeText(t).then(function(){SV.toast('Copied — paste it into a text or email to yourself')})}else{location.href='mailto:?subject='+encodeURIComponent('My Squamish ballot')+'&body='+encodeURIComponent(t)}};
document.addEventListener('sv:ballot',draw);document.getElementById('clear').onclick=function(){SV.setBallot({mayor:null,council:[]});SV.toast('Your list was cleared')};draw()})();</script>`,
}));

// ---------- CANDIDATE FORM (hidden page: no nav link, no sitemap entry, noindex) ----------
const formQ = (q, n) => `<fieldset class="fq" data-qid="${q.id}"><legend><span class="qn">${n}</span> ${escGl(q.text)}</legend>
  ${q.what ? `<p class="why"><b>${esc(q.what.term)}:</b> ${esc(q.what.def)}</p>` : ''}<p class="why">${escGl(q.why)}</p>
  <div class="opts">${[[2, 'Strongly agree'], [1, 'Somewhat agree'], [0, 'Mixed / in the middle'], [-1, 'Somewhat disagree'], [-2, 'Strongly disagree'], ['', 'Rather not say']].map(([v, l]) => `<label><input type="radio" name="${q.id}" value="${v}"><span>${l}</span></label>`).join('')}</div>
  <label class="addnote">Want to add a sentence? We’ll publish it next to your answer.<textarea name="${q.id}_note" rows="2" placeholder="Optional"></textarea></label></fieldset>`;
write('/for-candidates/', page({
  url: '/for-candidates/', title: 'Candidate questionnaire', noindex: true,
  desc: 'For candidates in the Squamish 2026 election: answer the questionnaire that appears on your profile page.',
  body: `<h1>Candidate questionnaire</h1>
  <p class="lede">You’re on the ballot for Squamish mayor or council. This is your page on <a href="/">squamishvoters.com</a> — fill in as much or as little as you like, and we’ll publish it.</p>
  <div class="notice info"><b>How this works.</b> ${QUESTIONS.length} statements feed the voter-matching quiz — those matter most. ${EXTRA_QUESTIONS.length} more are optional, and there’s space at the end to write freely. <b>Answers are published exactly as you give them</b>, word for word, with no editing for tone or length. Every candidate gets identical questions. Your progress is saved in this browser, so you can stop and come back.</div>
  <form id="cform" novalidate>
    <h2>Who you are</h2>
    <div class="card">
      <label class="fld">Your name
        <select name="who" required><option value="">Choose your name…</option>${all.map((c) => `<option value="${esc(c.name)}">${esc(c.name)} — ${c.office === 'mayor' ? 'Mayor' : 'Council'}</option>`).join('')}<option value="other">My name isn’t listed</option></select>
      </label>
      <label class="fld">Your email <span class="small">(so we can check it’s really you — not published)</span>
        <input type="email" name="email" required placeholder="you@example.com"></label>
    </div>
    <h2>Part A — the ${QUESTIONS.length} that feed the voter quiz</h2>
    ${QUESTIONS.map((q, i) => formQ(q, i + 1)).join('')}
    <h2>Part B — ${EXTRA_QUESTIONS.length} more, specific to Squamish <span class="small">(optional)</span></h2>
    <p>These show on your profile but don’t affect the quiz.</p>
    ${EXTRA_QUESTIONS.map((q, i) => formQ(q, QUESTIONS.length + i + 1)).join('')}
    <h2>Part C — in your own words <span class="small">(optional)</span></h2>
    <p>Anything here is published as a direct quote, attributed to you.</p>
    ${WRITE_IN.map(([k, label]) => `<label class="fld big-fld">${esc(label)}<textarea name="w_${k}" rows="4"></textarea></label>`).join('')}
    <h2>Photo</h2>
    <div class="card"><p>If you’d like a photo on your profile, email one you own the rights to to <a href="mailto:${SITE.contact}">${SITE.contact}</a>. Four candidates currently show initials instead.</p></div>
    <div class="btn-row"><button type="submit" class="btn big" id="fsubmit">Finish →</button><button type="button" class="btn secondary" id="fclear">Clear this form</button></div>
    <p class="small" id="fcount"></p>
    <p class="small"><b>Nothing is sent until the last step.</b> When you press Finish we show your answers and you send them to us — that is how we know they really came from you.</p>
  </form>
  <div id="fdone" hidden></div>`,
  scripts: `<script src="/cform.js"></script>`,
}));

// ---------- VOTE + ABOUT (hand-written content in data/pages) ----------
const pageFile = (f) => fs.readFileSync(path.join(ROOT, 'data', 'pages', f), 'utf8');
const mapLink = (addr) => `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}" target="_blank" rel="noopener">Map</a>`;
const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
write('/vote/', page({
  url: '/vote/', title: 'How, when and where to vote',
  desc: 'Squamish election day is Saturday, October 17, 2026, 8 a.m. to 8 p.m. at Brennan Park. Advance voting dates, mail ballots, ID and eligibility in plain language.',
  jsonld: {
    '@context': 'https://schema.org', '@type': 'Event', name: 'Squamish municipal election — General Voting Day',
    description: 'Vote for Mayor, six Councillors and School Trustees in the District of Squamish 2026 general local election.',
    startDate: '2026-10-17T08:00:00-07:00', endDate: '2026-10-17T20:00:00-07:00',
    eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    isAccessibleForFree: true, image: `${ORIGIN}/og.png`,
    location: { '@type': 'Place', name: 'Brennan Park Recreation Centre', address: { '@type': 'PostalAddress', streetAddress: '1009 Centennial Way', addressLocality: 'Squamish', addressRegion: 'BC', addressCountry: 'CA' } },
    organizer: { '@type': 'GovernmentOrganization', name: 'District of Squamish', url: 'https://squamish.ca/government-and-administration/council/election/' },
  },
  body: `<h1>How to vote</h1>
  <div class="card big-answer">
    <h2 style="margin-top:0">Saturday, October 17</h2>
    <p class="huge">${esc(gv.hours)}</p>
    ${(gv.places || []).map((pl) => `<p><b>${esc(pl.name)}</b><br>${esc(pl.address)}<br><a class="btn secondary" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pl.name + ' ' + pl.address)}" target="_blank" rel="noopener">Show me the map</a></p>`).join('')}
    <p><b>Bring two pieces of ID</b> — one with your signature, one showing your Squamish address.</p>
    <p class="small">This is the only voting place on election day. <b>Renters can vote</b>, and you don’t need to register ahead — you can do it at the voting place. <a href="#can-i-vote">Check if you can vote</a>.</p>
  </div>
  <details class="drop" open><summary>Can’t make it that day? Vote early</summary>
    <p>Advance voting is open to everyone. No reason needed.</p>
    <ul class="plainlist">${(V.advance_voting || []).map((a) => `<li><b>${esc(a.date.replace(', 2026', ''))}</b>, ${esc(a.hours)}<br>${esc(a.place)}, ${esc(a.address)} · ${mapLink(a.place + ' ' + a.address)}</li>`).join('')}</ul>
  </details>
  <details class="drop"><summary>Vote by mail from home</summary>
    <p><b>${escGl(mb.who)}</b> A good option if getting to a voting place is hard for you.</p>
    <ol><li>${escGl(mb.how_to_apply)} <a href="${esc(mb.application_form_url)}" target="_blank" rel="noopener">Get the form (PDF)</a>.</li>
    <li>${escGl(mb.pickup)}</li>
    <li><b>${escGl(mb.return_deadline)}</b></li></ol>
    <p><b>Ways to return it:</b></p><ul>${(mb.return_options || []).map((o) => `<li>${escGl(o)}</li>`).join('')}</ul>
    <p>${esc(mb.help)}</p>
  </details>
  <details class="drop" id="can-i-vote"><summary>Can I vote?</summary>
    <p>Yes, if <b>all</b> of these are true:</p><ul>${(V.eligibility?.resident_elector || []).map((r) => `<li>${escGl(r)}</li>`).join('')}</ul>
    <p><b>Not registered?</b> You can register right at the voting place. ${escGl(V.registration?.same_day_details)}</p>
    <details class="more"><summary>I own property here but live somewhere else</summary><p>${escGl(V.eligibility?.non_resident_property_elector?.rule)}</p><p><b>Bring:</b></p><ul>${(V.eligibility?.non_resident_property_elector?.what_to_bring_on_voting_day || []).map((r) => `<li>${escGl(r)}</li>`).join('')}</ul><ul class="small">${(V.eligibility?.non_resident_property_elector?.limits || []).map((r) => `<li>${escGl(r)}</li>`).join('')}</ul></details>
    <details class="more"><summary>What counts as ID</summary><ul>${(V.id_to_bring?.acceptable_id || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>
  </details>
  <details class="drop"><summary>What’s on the ballot</summary>
    <ul class="plainlist"><li><b>Mayor</b> — vote for <b>1</b> of ${mayors.length}. <a href="/candidates/#mayor">See them</a></li>
    <li><b>Councillors</b> — vote for <b>up to 6</b> of ${council.length}. You may pick fewer, but marking more than 6 spoils that part of your ballot. <a href="/candidates/#council">See them</a></li>
    <li><b>School trustees</b> — vote for <b>up to 2</b> of ${(ctx.trustees || []).length}. <a href="/candidates/#trustees">See them</a></li></ul>
    <p class="small">You can bring notes into the booth — such as <a href="/my-ballot/">your saved list</a>.</p>
  </details>
  <details class="drop"><summary>I need help, or I have trouble getting around</summary>
    <p>${escGl(V.accessibility?.recommendation)}</p>
    <p><b>${esc(ceo.name)}</b>, ${esc(ceo.title)}<br>Phone: <a href="tel:${esc((ceo.phone || '').replace(/[^0-9]/g, ''))}">${esc(ceo.phone)}</a><br>Email: <a href="mailto:${esc(ceo.email)}">${esc(ceo.email)}</a><br>${esc(ceo.address)}</p>
  </details>
  <h2 id="events">Meet the candidates in person</h2>
  <p>The best way to hear them in their own words.</p>
  <ul class="plainlist">${(ctx.events || []).map((e) => `<li><b>${esc(fmtDate(e.date))}</b> · ${esc(e.time)}<br>${esc(e.title)} — ${esc(e.place)}<br><span class="small">Hosted by ${esc(e.host)}.${/^required/i.test(e.registration || '') ? ' Registration required.' : ''} ${isUrl(e.registration_url) ? `<a href="${esc(e.registration_url)}" target="_blank" rel="noopener">Register</a> · ` : ''}<a href="${esc(e.source_url)}" target="_blank" rel="noopener">Details</a></span></li>`).join('')}</ul>
  <p class="small">Event list from the <a href="${esc((ctx.coverage_hubs || [])[1]?.url || '')}" target="_blank" rel="noopener">Squamish Chief’s running list</a>, updated as new events are announced. All details here come from the District of Squamish — <a href="${esc(gv.source_url)}" target="_blank" rel="noopener">check the official page</a> for last-minute changes.</p>`,
}));

// A platform statement a candidate sent us as text (not a PDF): published whole on its own page, like a positions paper.
for (const c of all.filter((x) => stmtOf(x)?.file)) {
  const f = esc(first(c)), st = stmtOf(c);
  write(st.url, page({
    url: '/candidates/', title: `${c.name}: platform statement, in full`,
    desc: `${c.name}’s own platform statement for the 2026 Squamish election, sent to Squamish Voters, in full.`,
    body: `<p class="crumbs"><a href="/candidates/${c.slug}/">← ${esc(c.name)}’s profile</a></p>
    <h1>${esc(c.name)}: platform statement, in full</h1>
    <div class="notice direct"><b>These are ${f}’s own words, not ours.</b> ${f} ${esc(st.how)} on ${esc(fmtLong(st.date))}, under the title “${esc(st.title.replace(/[“”]/g, "'"))}”. It is published whole; nothing has been cut or reworded. Spot a typing mistake? <a href="mailto:${esc(SITE.contact)}">Tell us</a>.</div>
    <div class="paper">${pageFile(st.file)}</div>
    <div class="btn-row"><a class="btn secondary" href="/candidates/${c.slug}/">← Back to ${f}’s profile</a></div>`,
  }));
}
for (const c of all.filter((x) => x.paper)) {
  const f = esc(first(c));
  write(c.paper.url, page({
    url: '/candidates/', title: `${c.name}: positions paper, in full`,
    desc: `${c.name}’s own ${c.paper.points}-point positions paper for the 2026 Squamish election, in full.`,
    body: `<p class="crumbs"><a href="/candidates/${c.slug}/">← ${esc(c.name)}’s profile</a></p>
    <h1>${esc(c.name)}: positions paper, in full</h1>
    <div class="notice info"><b>These are ${f}’s own words, not ours.</b> ${f} ${esc(c.paper.where)} around ${esc(fmtLong(c.paper.date))}${isUrl(c.paper.post_url) ? ` (<a href="${esc(c.paper.post_url)}" target="_blank" rel="noopener">original post</a>)` : ''}, under the title “${esc(c.paper.title.replace(/[“”]/g, "'"))}”. We typed it out from the original so it is easy to read and search on a phone; nothing has been cut or reworded. ${f} says it “may be updated”. Spot a typing mistake? <a href="mailto:${esc(SITE.contact)}">Tell us</a>.</div>
    <div class="paper">${pageFile(c.paper.file)}</div>
    <div class="btn-row"><a class="btn secondary" href="/candidates/${c.slug}/">← Back to ${f}’s profile</a></div>`,
  }));
}
write('/about/', page({ url: '/about/', title: 'About this guide', desc: 'Who makes Squamish Voters, how candidate positions are sourced and scored, and how to send a correction. Independent and not affiliated with any candidate.', body: pageFile('about.html').replaceAll('<!--CONTACT-->', SITE.contact ? `<a href="mailto:${esc(SITE.contact)}">${esc(SITE.contact)}</a>` : 'a contact address will be posted here shortly.').replace('{{COUNT}}', String(all.length)).replace('{{UPDATED}}', esc(SITE.updated)) }));
write('/404/', page({ url: '/404/', title: 'Page not found', body: '<h1>We can’t find that page</h1><p class="lede">Try one of these instead.</p><div class="btn-row"><a class="btn big" href="/">Home</a><a class="btn big secondary" href="/candidates/">Candidates</a><a class="btn big secondary" href="/quiz/">Take the quiz</a></div>' }));
fs.copyFileSync(path.join(DIST, '404', 'index.html'), path.join(DIST, '404.html'));

// ---------- ADMIN (hidden, token-gated, never linked or indexed) ----------
write('/admin/', page({
  url: '/admin/', title: 'Responses', noindex: true,
  desc: 'Private.',
  body: `<h1>Candidate responses</h1>
  <p class="lede" id="a-status">Checking…</p>
  <div class="btn-row no-print"><button type="button" class="btn secondary" id="a-refresh">Refresh now</button>
  <label class="small" style="display:flex;align-items:center;gap:.5rem"><input type="checkbox" id="a-auto" checked> Update automatically</label></div>
  <div id="a-list"></div>`,
  scripts: `<script>window.SV_Q=${JSON.stringify(ALL_QUESTIONS.map((q) => ({ id: q.id, short: q.short, text: q.text, core: q.core !== false })))};</script><script src="/admin.js"></script>`,
}));

// The submit endpoint needs to know each candidate's official address, so a submission
// claiming to be someone can be checked against the address the District published.
fs.writeFileSync(path.join(ROOT, 'api', '_official.js'),
  'export const OFFICIAL = ' + JSON.stringify(Object.fromEntries(
    all.map((c) => [c.name, ((c.links || {}).email_public || '').toLowerCase()])
  ), null, 1) + ';\n');

// ---------- static assets ----------
for (const f of ['site.css', 'site.js', 'quiz.js', 'cform.js', 'admin.js', 'lean.js']) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(DIST, f));
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

// ---------- sitemap (every indexable page written above; lastmod = build date) ----------
const today = new Date().toISOString().slice(0, 10);
const prio = (u) => (u === '/' ? '1.0' : ['/candidates/', '/quiz/', '/vote/'].includes(u) ? '0.8' : '0.6');
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...new Set(SITEMAP)].map((u) => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${today}</lastmod><priority>${prio(u)}</priority></url>`).join('\n')}
</urlset>
`);
console.log(`Built ${all.length} candidates (${mayors.length} mayor, ${council.length} council) -> dist/`);
