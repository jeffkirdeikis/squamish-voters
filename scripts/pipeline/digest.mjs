// The Friday email. Redesigned Nov 20 2026 (Jeff approved all 20 changes on artifact 1dgkRBqE2Twwjggx82zFkP): the email
// is the skim layer and the site is the deep layer. Order: masthead with read time, a news headline with the stake in
// it, "The 60 second version" (five lines), a calm red strip for safety news, one council block per meeting (photo,
// number tiles from the story's glance, faces on a split vote, one line per decision with a result pill), council vs
// neighbours (What Squamish Wants answers beside the council vote), a one tap question on the next big vote, coming up
// as date blocks with Add to calendar, around town as a photo grid (duplicates merged, stale warnings dropped), the
// weekend in four tiles, the promise bar, one featured new thing on the site, and a slim footer.
// Built from the live site (this-week.json, /api/wants/, /api/today/) plus data/meetings and data/news.json, so the
// email and the site say the same thing. Nothing goes to readers until Jeff approves it.
//   node scripts/pipeline/digest.mjs                                   writes a preview to data/digest/<date>.html
//   node scripts/pipeline/digest.mjs --request                         emails Jeff the preview with an Approve button
//   node scripts/pipeline/digest.mjs --request --html f.html --subject "..."   same, for a hand-written email
// The Approve button (api/digest-review.js) sends it to every confirmed subscriber; Jeff picks one of three subject
// lines there. --request needs RESEND_API_KEY, EMAIL_FROM and POSTGRES_URL; DIGEST_REVIEW_TO overrides who approves.
// ANTHROPIC_API_KEY lets Claude write the subjects, headline, the five lines, short headlines and "New on the site";
// without it those fall back to plain wording. In a hand-written email, %%UNSUB%% becomes each reader's unsubscribe link.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, log, claudeJson, STYLE } from './lib.mjs';
import { isPolitics } from './politics.mjs';

const ORIGIN = 'https://squamishvoters.com';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const REQUEST = process.argv.includes('--request');
const DB = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = DB && REQUEST ? (await import('@neondatabase/serverless')).neon(DB) : null;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => Number(n).toLocaleString('en-CA');
const get = async (p) => { try { const r = await fetch(ORIGIN + p); return r.ok ? await r.json() : null; } catch { return null; } };
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return d; } };
const stamp = new Date().toISOString().slice(0, 10);
const weekAgo = Date.now() - 7 * 864e5;
const noon = (d) => new Date(d + 'T12:00:00');
const dayName = (d) => noon(d).toLocaleDateString('en-CA', { weekday: 'long' });
const shortDay = (d) => noon(d).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '');
const clean = (s) => String(s ?? '').replace(/\s*[—–]\s*/g, ', ').trim();

// ---------- the look (email safe: tables and inline styles; one <style> block only adds phone tweaks) ----------
const C = { ink: '#14211c', mute: '#5d6661', soft: '#44504a', green: '#0f4c3a', blue: '#0b5cab', line: '#e7e3d8', bg: '#efece3', cream: '#f7f5ef', red: '#b3261e', gold: '#e0a526', goldbg: '#fff4d6', goldink: '#8a5a00', goodbg: '#e3f1e6', goodink: '#1e6b2f', badbg: '#fbe5e2', badink: '#8a1f17' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const label = (t, color = C.green) => `<div style="font-size:12px;font-weight:800;letter-spacing:1px;color:${color};text-transform:uppercase">${esc(t)}</div>`;
// One white band of the email. gap = the cream divider above it (sections), none for pieces that continue a section.
const band = (inner, { gap = true, pad = '22px 24px', id = '' } = {}) => `<tr><td${id ? ` id="${id}"` : ''} class="px" style="background:#fff;padding:${pad};${gap ? `border-top:8px solid ${C.bg};` : ''}">${id ? `<a name="${id}"></a>` : ''}${inner}</td></tr>`;
const pill = (text, kind) => {
  const [bg, fg] = { good: [C.goodbg, C.goodink], bad: [C.badbg, C.badink], wait: [C.goldbg, C.goldink] }[kind] || [C.line, C.soft];
  return `<span style="background:${bg};color:${fg};font-weight:800;font-size:11px;padding:3px 7px;border-radius:20px;white-space:nowrap">${esc(text)}</span>`;
};
const button = (href, text) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr><td style="background:${C.green};border-radius:8px"><a href="${href}" style="display:inline-block;padding:12px 20px;color:#fff;font-weight:700;text-decoration:none;font-size:15px">${esc(text)}</a></td></tr></table>`;
// A plain link that keeps the text's own look (Jeff, Nov 20: almost everything in the email should open the detail).
const lk = (href, inner, style = '') => `<a href="${href}" style="color:inherit;text-decoration:none;${style}">${inner}</a>`;
const more = (href, t = 'Read more') => ` <a href="${href}" style="color:${C.blue};font-weight:700;white-space:nowrap">${t} &rarr;</a>`;
const meter = (pct, color) => `<div style="background:${C.line};border-radius:5px"><div style="background:${color};width:${Math.max(2, Math.min(100, pct))}%;height:14px;border-radius:5px"></div></div>`;

// ---------- text helpers ----------
// First sentence, without cutting at "St." or "B.C." (the Nov 20 draft cut "the former St. Paul's..." at "St.").
const ABBR = /(?:\b(?:St|Mt|Dr|No|Mr|Mrs|Ms|Ave|Rd|Hwy|Jr|Sr|vs|approx|Inc|Ltd|Co|Ft|Pt|Sgt|Cpl|Const|Supt|Insp)|a\.m|p\.m|B\.C|U\.S|e\.g|i\.e|\b[A-Z])\.$/;
function firstSentence(s) {
  const t = String(s || '').trim(), re = /[.!?](?=\s+["“(]?[A-Z0-9])/g;
  let m;
  while ((m = re.exec(t))) { const head = t.slice(0, m.index + 1); if (!ABBR.test(head)) return head; }
  return t;
}
const short = (s, max = 170) => { const t = firstSentence(s); return t.length > max || ABBR.test(t) ? '' : t; };

// ---------- data ----------
async function gather() {
  const [W, wants, today] = await Promise.all([get('/this-week.json'), get('/api/wants/'), get('/api/today/')]);
  if (!W) throw new Error('could not load this-week.json');
  const starters = readJson('api/_wants.json', { asks: [] }).asks;
  return { W, wants, today, starters };
}

// One row per What Squamish Wants question with answers: multiple choice gets ranked options, yes/no gets counts.
function wantsRows({ wants, starters }) {
  if (!wants?.tallies) return [];
  const byId = new Map(starters.map((a) => [a.id, a]));
  for (const a of wants.asks || []) if (!byId.has(a.id)) byId.set(a.id, a);
  const rows = [];
  for (const [id, t] of Object.entries(wants.tallies)) {
    const a = byId.get(id); if (!a) continue;
    if (a.options) {
      const labels = Object.fromEntries(a.options.map((k, i) => [k, a.labels[i]]));
      for (const o of wants.extras?.[id] || []) labels[o.key] = o.label;
      const opts = Object.entries(t).filter(([k, v]) => labels[k] && typeof v === 'number').map(([k, v]) => ({ key: k, label: labels[k], n: v }));
      const total = opts.reduce((s, o) => s + o.n, 0); if (!total) continue;
      opts.sort((x, y) => y.n - x.n);
      rows.push({ id, title: a.title, kind: 'choice', total, opts: opts.map((o) => ({ ...o, pct: Math.round((o.n / total) * 100) })) });
    } else {
      const total = t.y + t.n + t.m; if (!total) continue;
      rows.push({ id, title: a.title, kind: 'yesno', total, y: t.y, n: t.n, m: t.m, created: a.created_at || null });
    }
  }
  return rows;
}

// Last week's numbers (and last week's one tap question), so this email can say what moved.
async function lastSnapshot() {
  if (!sql) return null;
  await sql`CREATE TABLE IF NOT EXISTS sv_digest_snap (taken_at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL)`;
  const [r] = await sql`SELECT data FROM sv_digest_snap WHERE taken_at < now() - interval '3 days' ORDER BY taken_at DESC LIMIT 1`;
  return r?.data || null;
}

// The week's commits, for Claude to turn into "New on the site". Automatic data commits are left out.
function weekCommits() {
  try {
    return execSync(`git log --since="7 days ago" --no-merges --pretty=%s`, { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter((s) => s && !/^(News update|Meetings update|Meeting summary|AI visibility check|Data:|IndexNow|Chore)/i.test(s)).slice(0, 80);
  } catch { return []; }
}

// ---------- news ----------
const NEWS = readJson('data/news.json', { stories: [] });
const storyUrl = (st) => `${ORIGIN}/news/${st.slug}/`;
const img = (f) => (/^https?:/.test(f) ? f : ORIGIN + f);
const CREDITS = new Set();
const photoOf = (st) => { const cr = String(st?.photo?.credit || '').replace(/\.$/, ''); if (cr && cr.length <= 60) CREDITS.add(cr); return st?.photo?.file ? img(st.photo.file) : ''; };

// Page views per story over the last 7 days, from Vercel Web Analytics. Needs VERCEL_ANALYTICS_TOKEN; without it the
// stories fall back to the site's own order (lead stories first, newest first).
async function newsViews() {
  const token = process.env.VERCEL_ANALYTICS_TOKEN;
  if (!token) { log('no VERCEL_ANALYTICS_TOKEN, ranking uses lead stories instead'); return null; }
  const q = new URLSearchParams({ projectId: 'prj_olAlaP4zJkDgHr6zHh7KBJ0Ub2RE', teamId: 'team_iw1pUMSqkMZdMypdybTf0LIn',
    since: new Date(weekAgo).toISOString(), until: new Date().toISOString(), by: 'requestPath', limit: '100' });
  try {
    const r = await fetch('https://api.vercel.com/v1/query/web-analytics/visits/aggregate?' + q, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('analytics ' + r.status);
    const views = {};
    for (const row of (await r.json()).data || []) {
      const m = /^\/news\/([^/]+)\/?$/.exec(row.requestPath || '');
      if (m) { const v = views[m[1]] || (views[m[1]] = { pageviews: 0, visitors: 0 }); v.pageviews += row.pageviews; v.visitors += row.visitors; }
    }
    return views;
  } catch (e) { log('news views failed:', e.message); return null; }
}

function rankStories(views) {
  const tier = { lead: 0, card: 1, brief: 2 };
  const fresh = (NEWS.stories || []).filter((st) => Date.parse(st.date + 'T12:00:00') > weekAgo || (st.pin_until && Date.parse(st.pin_until + 'T23:59:00') > Date.now()));
  const pv = (st) => views?.[st.slug]?.pageviews || 0;
  return fresh.sort((a, b) => pv(b) - pv(a) || (tier[a.tier] ?? 1) - (tier[b.tier] ?? 1) || b.date.localeCompare(a.date));
}

// A weather or hazard warning more than 3 days old is out of date by Friday (the Nov 20 draft repeated a Nov 14
// "70 mm more rain by Sunday" warning beside a 2 mm forecast). Safety stories about what happened stay.
const WARN = /\b(warning|watch|advisory|special weather|rainfall|snowfall|atmospheric river|heat wave|wind warning|forecast)\b/i;
const isStale = (st) => st.s !== 'safety' && WARN.test(`${st.head} ${st.dek}`) && Date.now() - Date.parse(st.date + 'T12:00:00') > 3 * 864e5;
const GRAVE = /\b(dead|died|dies|death|killed|missing|drown|fatal|injur|search and rescue)/i;
const isSafety = (st) => st.s === 'safety' || GRAVE.test(st.head);

// ---------- council ----------
const PEOPLE = Object.fromEntries((readJson('data/candidates.json', []) || []).map((c) => [c.slug, c.name]));
const surname = (slug) => { const n = PEOPLE[slug] || slug.replace(/-/g, ' '); return n.split(' ').slice(-1)[0].replace(/^./, (c) => c.toUpperCase()); };
const VOTE_LOOK = { yes: ['#2e7d32', '&#10003; Yes', 1], no: [C.red, '&#10007; No', 1], recused: ['#c9c4b5', 'Left room', 0.55], absent: ['#c9c4b5', 'Away', 0.55] };
const tally = (votes) => { const v = Object.values(votes || {}); return { y: v.filter((x) => x === 'yes').length, n: v.filter((x) => x === 'no').length }; };

function faces(d, href) {
  const order = { yes: 0, no: 1, recused: 2, absent: 3 };
  const people = Object.entries(d.votes).sort((a, b) => (order[a[1]] ?? 4) - (order[b[1]] ?? 4));
  const { y, n } = tally(d.votes);
  const cell = ([slug, v]) => { const [ring, word, op] = VOTE_LOOK[v] || VOTE_LOOK.absent;
    return `<td align="center" width="${Math.floor(100 / people.length)}%" style="padding:2px 0;font-size:10.5px;color:${C.soft}"><a href="${ORIGIN}/council/${slug}/" style="color:inherit;text-decoration:none"><img src="${ORIGIN}/img/${slug}.jpg" width="44" height="44" alt="${esc(PEOPLE[slug] || slug)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:3px solid ${ring};display:block;margin:0 auto 3px;opacity:${op}"><b style="color:${op < 1 ? '#8b928e' : ring}">${word}</b><br>${esc(surname(slug))}</a></td>`; };
  return `<div style="font-size:14px;font-weight:800;margin:4px 0 8px">How they voted: ${lk(href, esc(d.title))} <span style="font-weight:600;color:${C.green};white-space:nowrap">&middot; ${d.result === 'failed' ? 'Failed' : 'Passed'} ${y} to ${n}</span></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${people.map(cell).join('')}</tr></table>`;
}

function decisionRow(d, href) {
  const { y, n } = tally(d.votes);
  const p = d.result === 'info' ? pill('NO VOTE YET', 'wait') : d.result === 'referred' ? pill('SENT BACK', 'wait')
    : d.result === 'failed' ? pill(`FAILED ${y}–${n}`, 'bad') : n ? pill(`PASSED ${y}–${n}`, 'good') : pill('ALL YES', 'good');
  const extra = short(d.for_you, 150);
  return `<tr><td width="104" valign="top" style="padding:9px 0;border-top:1px solid ${C.line}">${p}</td><td style="padding:9px 0;border-top:1px solid ${C.line}">${lk(href, `<b style="color:${C.blue}">${esc(d.title)}</b>${extra ? `<span style="color:${C.ink}">. ${esc(extra)}</span>` : ''} <span style="color:${C.blue}">&rsaquo;</span>`)}</td></tr>`;
}

// One block per council meeting this week: the story's photo and glance tiles, faces on the first split vote, every
// real decision as one line.
function councilBlock(m, w, first) {
  const id = (/\/meetings\/([^/]+)\//.exec(m.url) || [])[1];
  const M = readJson(`data/meetings/${id}.json`, {}) || {};
  const st = (NEWS.stories || []).find((s) => s.meeting === id);
  const ds = (M.decisions || []).filter((d) => !d.consent_agenda && d.topic !== 'Routine business' && (d.votes || (d.result === 'info' && d.for_you)));
  const split = ds.find((d) => d.votes && tally(d.votes).n > 0);
  const head = w.council?.[id]?.head || st?.head || m.headline;
  const inShort = w.council?.[id]?.in_short || (st?.gist ? st.gist.slice(0, 2).join(' ') : firstSentence(m.headline));
  const tiles = (st?.glance || []).filter((g) => String(g.v).length <= 13).slice(0, 3);
  const sHref = st ? storyUrl(st) : m.url;
  const tile = (g) => `<td width="${Math.floor(100 / tiles.length)}%" style="padding:0 3px"><div style="background:${g.level === 'high' ? C.goldbg : C.cream};border-radius:10px;padding:12px 6px;text-align:center"><div style="font-family:${SERIF};font-size:19px;line-height:1.15;font-weight:700;color:${g.level === 'high' ? C.goldink : C.green}">${esc(g.v)}</div><div style="font-size:12px;line-height:1.3;color:${C.mute};margin-top:2px">${esc(g.k)}</div></div></td>`.replace(/^<td([^>]*)>([\s\S]*)<\/td>$/, (x, a, inner) => `<td${a}>${lk(sHref, inner)}</td>`);
  const photo = photoOf(st);
  const top = band(`${label(`Council · ${dayName(m.date)} ${noon(m.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }).replace('.', '')}`)}
 <div style="font-family:${SERIF};font-size:24px;line-height:1.2;font-weight:700;margin:6px 0 12px;color:${C.ink}">${lk(sHref, esc(head))}</div>
 ${photo ? `<a href="${st ? storyUrl(st) : m.url}"><img src="${photo}" width="552" alt="${esc(st.photo.alt || '')}" style="display:block;width:100%;height:auto;border-radius:10px;border:0"></a>` : ''}
 ${tiles.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 4px"><tr>${tiles.map(tile).join('')}</tr></table>` : ''}
 <div style="font-size:15.5px;line-height:1.5;margin:10px 0 0"><b>In short:</b> ${esc(inShort)}${more(sHref)}</div>`, { id: first ? 'council' : '' });
  const dHref = (d) => `${m.url}#d-${(M.decisions || []).indexOf(d)}`;
  const grid = split ? band(faces(split, dHref(split)), { gap: false, pad: '4px 24px 20px' }) : '';
  const rows = ds.slice(0, 6);
  const list = rows.length ? band(`<div style="font-size:14px;font-weight:800;margin:6px 0 8px">Every decision, one line each</div>
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14.5px;line-height:1.4">${rows.map((d) => decisionRow(d, dHref(d))).join('')}</table>
 ${button(st ? storyUrl(st) : m.url, st ? 'Read the full meeting story →' : 'See every vote →')}`, { gap: false, pad: '0 24px 22px' }) : '';
  return { html: top + grid + list, story: st, decisions: M.decisions || [] };
}

// Other political stories this week (no meeting of their own): compact rows with a small photo.
function politicsRows(items, w) {
  if (!items.length) return '';
  const row = (st) => { const p = photoOf(st); return `<tr>${p ? `<td width="92" valign="top" style="padding:8px 12px 8px 0"><a href="${storyUrl(st)}"><img src="${p}" width="80" height="60" alt="" style="display:block;width:80px;height:60px;object-fit:cover;border-radius:8px;border:0"></a></td>` : ''}<td valign="top" style="padding:8px 0;font-size:14.5px;line-height:1.4"><a href="${storyUrl(st)}" style="color:${C.ink};font-weight:800;text-decoration:none">${esc(w.heads?.[st.slug] || st.head)}</a>${short(st.dek, 150) ? `<div style="color:${C.soft};margin-top:2px">${lk(storyUrl(st), esc(short(st.dek, 150)))}${more(storyUrl(st))}</div>` : more(storyUrl(st))}</td></tr>`; };
  return band(`${label('Also in politics')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px">${items.map(row).join('')}</table>`);
}

// ---------- council vs neighbours, and the one tap question ----------
function versus(blocks, rows, wants, prev, ask) {
  const tallies = wants?.tallies || {};
  const pairs = [];
  for (const b of blocks) {
    const st = b.story; if (!st?.match?.pairs) continue;
    for (const p of st.match.pairs) {
      const poll = (st.polls || []).find((x) => x.id === p.poll), d = b.decisions[p.decision];
      const t = tallies[`news-${st.slug}--${p.poll}`] || {};
      if (!poll || !d?.votes || !poll.options.some((o) => o.key === 'yes')) continue;
      const ry = t.yes || 0, rn = t.no || 0; if (ry + rn < 10) continue;
      const { y, n } = tally(d.votes);
      pairs.push({ href: `${storyUrl(st)}#q-${poll.id}`, q: poll.q, council: Math.round((100 * y) / Math.max(1, y + n)), readers: Math.round((100 * ry) / (ry + rn)) });
    }
  }
  const people = wants?.people || 0, grew = prev?.people ? people - prev.people : 0;
  const close = rows.filter((r) => r.kind === 'yesno' && r.y + r.n >= 40).sort((a, b) => Math.abs(a.y - a.n) - Math.abs(b.y - b.n))[0];
  const twoBars = (p) => `<div style="font-size:14.5px;font-weight:700;margin:12px 0 6px">${lk(p.href, `${esc(p.q)} <span style="color:${C.blue}">&rsaquo;</span>`)}</div>
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
  <tr><td width="92" style="padding:3px 0;color:${C.soft}">Council</td><td style="padding:3px 0">${meter(p.council, C.green)}</td><td width="74" align="right" style="padding:3px 0"><b>${p.council}% yes</b></td></tr>
  <tr><td style="padding:3px 0;color:${C.soft}">Neighbours</td><td style="padding:3px 0">${meter(p.readers, C.gold)}</td><td align="right" style="padding:3px 0"><b>${p.readers}% yes</b></td></tr></table>`;
  // Last week's one tap question gets its result here.
  let last = '';
  const lt = prev?.ask && tallies[prev.ask.id];
  if (lt) {
    const opts = prev.ask.options.map((o) => ({ ...o, n: lt[o.key] || 0 })), total = opts.reduce((s, o) => s + o.n, 0);
    if (total >= 5) last = `<div style="font-size:14.5px;font-weight:700;margin:16px 0 6px">Last week you answered: ${esc(prev.ask.q)}</div>
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${opts.sort((a, b) => b.n - a.n).map((o) => `<tr><td style="padding:3px 0">${meter(Math.round((100 * o.n) / total), C.gold)}</td><td width="210" style="padding:3px 0 3px 10px"><b>${Math.round((100 * o.n) / total)}%</b> ${esc(o.label)}</td></tr>`).join('')}</table>`;
  }
  // No council vote to compare: the busiest multiple choice questions instead.
  const fallback = !pairs.length ? rows.filter((r) => r.kind === 'choice' && r.total >= 20).sort((a, b) => b.total - a.total).slice(0, 2).map((r) => `<div style="font-size:14.5px;font-weight:700;margin:12px 0 6px">${esc(r.title)}</div>
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${r.opts.slice(0, 3).map((o, i) => `<tr><td style="padding:3px 0">${meter(o.pct, i ? '#7aa594' : C.green)}</td><td width="210" style="padding:3px 0 3px 10px"><b>${o.pct}%</b> ${esc(o.label)}</td></tr>`).join('')}</table>`).join('') : '';
  if (!pairs.length && !fallback && !last) return '';
  return band(`${label(pairs.length ? 'Council vs neighbours' : 'What Squamish wants')}
 <div style="font-family:${SERIF};font-size:21px;font-weight:700;margin:4px 0 4px;color:${C.ink}">${pairs.length ? 'Did council vote the way you would?' : 'What your neighbours are saying'}</div>
 <div style="font-size:13.5px;color:${C.mute};margin-bottom:4px">${num(people)} people have answered on What Squamish Wants${grew > 0 ? ` (${num(grew)} new this week)` : ''}. Open to anyone, so not a scientific poll.</div>
 ${pairs.slice(0, 3).map(twoBars).join('')}${fallback}${last}
 ${close ? `<div style="font-size:13.5px;color:${C.soft};margin-top:12px;line-height:1.45"><b>Closest call:</b> ${lk(`${ORIGIN}/wants/${close.page ? close.id + '/' : ''}`, `${esc(close.title)}, ${num(close.y)} yes and ${num(close.n)} no. <span style="color:${C.blue};font-weight:700">Vote &rarr;</span>`)}</div>` : ''}
 <div style="font-size:14px;margin-top:10px"><a href="${ORIGIN}/wants/" style="color:${C.blue};font-weight:700">Add your answers &rarr;</a></div>`, { id: 'vs' }) + (ask ? ask.html : '');
}

// The question on the next big vote: a poll in this week's political stories that council hasn't decided yet.
// Each button opens the story with ?pick=<answer>#q-<poll>, and src/poll.js saves the answer in one tap.
function oneTap(stories, participate) {
  for (const st of stories) {
    const decided = new Set((st.match?.pairs || []).map((p) => p.poll));
    const poll = (st.polls || []).find((p) => !decided.has(p.id) && (p.options || []).length >= 2);
    if (!poll) continue;
    const opts = poll.options.filter((o) => o.key !== 'm').slice(0, 3);
    const btn = (o) => `<a href="${storyUrl(st)}?pick=${encodeURIComponent(o.key)}#q-${poll.id}" style="display:inline-block;background:#fff;color:${C.green};font-weight:800;text-decoration:none;padding:10px 16px;border-radius:24px;font-size:14.5px;margin:0 6px 8px 0">${esc(o.label)}</a>`;
    const tax = /tax|budget/i.test(poll.q + poll.why);
    const html = band(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.green};border-radius:12px"><tr><td style="padding:18px">
  <div style="color:#e6c766;font-size:12px;font-weight:800;letter-spacing:.8px">ONE TAP &middot; RESULTS NEXT FRIDAY</div>
  <div style="font-family:${SERIF};color:#fff;font-size:19px;font-weight:700;margin:6px 0 6px;line-height:1.3">${esc(poll.q)}</div>
  ${poll.why ? `<div style="color:#cfe0d8;font-size:13.5px;margin-bottom:12px">${esc(String(poll.why).replace(/<[^>]+>/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))}</div>` : ''}
  <div>${opts.map(btn).join('')}</div>
  ${participate?.email ? `<div style="color:#cfe0d8;font-size:13px;margin-top:6px">Want council to hear it directly? Email <a href="mailto:${participate.email}" style="color:#fff">${participate.email}</a>.${tax ? ` <a href="${ORIGIN}/property-tax-calculator/" style="color:#e6c766">Work out your own bill &rarr;</a>` : ''}</div>` : ''}
 </td></tr></table>`, { gap: false, pad: '0 24px 22px' });
    return { html, snap: { id: `news-${st.slug}--${poll.id}`, q: poll.q, options: opts.map((o) => ({ key: o.key, label: o.label })) } };
  }
  return null;
}

// ---------- coming up ----------
function utcStamp(date, time, addMin = 0) {
  const m = /(\d{1,2})(?::(\d\d))?\s*([ap])\.?\s*m/i.exec(time || ''); if (!m) return null;
  const h = (+m[1] % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0), mi = +(m[2] || 0);
  const [y, mo, d] = date.split('-').map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, 20));
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', timeZoneName: 'shortOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName').value;
  const hours = -parseInt(off.replace('GMT', ''), 10) || 8;
  return new Date(Date.UTC(y, mo - 1, d, h + hours, mi + addMin)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function comingUp(W, w) {
  const until = Date.now() + 15 * 864e5, items = [], seen = new Set();
  for (const m of W.soon) { seen.add(m.url); items.push({ date: m.date, time: m.time, title: m.type, text: m.preview, url: m.url }); }
  // Meetings in the next two weeks that this-week.json leaves out (it only looks a week ahead).
  try {
    for (const f of fs.readdirSync(path.join(ROOT, 'data', 'meetings'))) {
      if (!/^\d{4}-\d\d-\d\d.*\.json$/.test(f)) continue;
      const M = readJson(`data/meetings/${f}`, {}); const url = `${ORIGIN}/meetings/${f.replace('.json', '')}/`;
      if (!M.date || seen.has(url) || noon(M.date) > until || new Date(M.date + 'T23:59:00') < Date.now()) continue;
      seen.add(url); items.push({ date: M.date, time: M.time, title: ({ regular: 'Council meeting', cow: 'Council workshop (no final votes)', special: 'Special meeting', hearing: 'Public hearing' })[M.type] || M.type || 'Council meeting', text: M.preview || '', url });
    }
  } catch {}
  for (const d of W.dates || []) {
    if (!d.date || seen.has(d.url) || noon(d.date) > until || new Date(d.date + 'T23:59:00') < Date.now()) continue;
    items.push({ date: d.date, title: d.title, text: d.text, url: d.url });
  }
  if (!items.length) return '';
  const notes = Object.fromEntries((w.coming || []).map((c) => [c.date, c.note]));
  const byDate = {};
  for (const x of items.sort((a, b) => a.date.localeCompare(b.date) || String(b.time || '').localeCompare(String(a.time || '')))) (byDate[x.date] ||= []).push(x);
  const rows = Object.entries(byDate).slice(0, 4).map(([date, xs], i) => {
    const main = xs.find((x) => !/special|closed/i.test(x.title)) || xs[0];
    const rest = xs.filter((x) => x !== main);
    const t0 = utcStamp(date, main.time), t1 = utcStamp(date, main.time, 120);
    const cal = t0 ? ` &middot; <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&amp;text=${encodeURIComponent('Squamish: ' + main.title)}&amp;dates=${t0}/${t1}&amp;details=${encodeURIComponent(main.url)}" style="color:${C.blue}">Add to calendar</a>` : '';
    const what = notes[date] || short(main.text, 200);
    const top = i ? '' : '';
    return `<tr><td width="58" valign="top" style="padding:8px 0;${i ? `border-top:1px solid ${C.line}` : ''}${top}"><div style="border:1px solid #d9d5c8;border-radius:8px;text-align:center;overflow:hidden;width:48px"><div style="background:${i ? C.green : C.red};color:#fff;font-size:10px;font-weight:800;padding:2px 0">${noon(date).toLocaleDateString('en-CA', { month: 'short' }).replace('.', '').toUpperCase()}</div><div style="font-size:19px;font-weight:800;padding:2px 0;color:${C.ink}">${noon(date).getDate()}</div></div></td>
   <td style="padding:8px 0;${i ? `border-top:1px solid ${C.line}` : ''}">${lk(main.url, `<b style="color:${C.blue}">${main.time ? `${esc(main.time)} ` : ''}${esc(main.title)}.</b> ${esc(what)}`)} <a href="${main.url}" style="color:${C.blue}">${main.url.includes('/meetings/') ? 'Watch or have your say' : 'Details'}</a>${cal}${rest.length ? `<div style="color:${C.mute};font-size:13px;margin-top:3px">Also: ${rest.map((x) => `${x.time ? esc(x.time) + ' ' : ''}${esc(x.title)} (<a href="${x.url}" style="color:${C.blue}">details</a>)`).join('; ')}</div>` : ''}</td></tr>`;
  });
  return band(`${label('Coming up')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14.5px;line-height:1.4;margin-top:10px">${rows.join('')}</table>`, { id: 'coming' });
}

// ---------- around town ----------
function aroundTown(list, w, safety = []) {
  const bySlug = Object.fromEntries(list.map((st) => [st.slug, st]));
  let cards = (w.town?.cards || []).map((c) => ({ ...c, slugs: (c.slugs || []).filter((s) => bySlug[s]) })).filter((c) => c.slugs.length);
  const box = w.town?.box && (w.town.box.slugs || []).filter((s) => bySlug[s]).length ? { title: w.town.box.title, items: w.town.box.slugs.filter((s) => bySlug[s]).map((s, i) => ({ st: bySlug[s], label: w.town.box.labels?.[i] || bySlug[s].head })) } : null;
  if (!cards.length) cards = list.filter((st) => st.photo?.file).slice(0, 4).map((st) => ({ slugs: [st.slug], head: st.head, sub: '' }));
  cards = cards.filter((c) => bySlug[c.slugs[0]].photo?.file).slice(0, 4);
  if (!cards.length && !box && !safety.length) return '';
  // Deaths and emergencies (Jeff, Nov 20: politics and city news first): a quiet line at the end, never up top.
  const safe = safety.slice(0, 3).map((st) => `<tr><td style="padding:6px 0;border-top:1px solid ${C.line};font-size:14px;line-height:1.4">${lk(storyUrl(st), `<b>${esc(st.head)}</b>`)}${more(storyUrl(st))}</td></tr>`).join('');
  const safeHtml = safe ? `<div style="font-size:12px;font-weight:800;letter-spacing:1px;color:${C.mute};margin:16px 0 4px">ALSO THIS WEEK</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${safe}</table>` : '';
  const card = (c, i) => { const st = bySlug[c.slugs[0]];
    return `<td class="stack" width="50%" valign="top" style="padding:0 ${i % 2 ? 0 : 8}px 16px ${i % 2 ? 8 : 0}px"><a href="${storyUrl(st)}" style="text-decoration:none;color:${C.ink}"><img src="${photoOf(st)}" width="264" alt="${esc(st.photo.alt || '')}" style="display:block;width:100%;height:150px;object-fit:cover;border-radius:10px;border:0"><div style="font-weight:800;font-size:15px;line-height:1.3;margin-top:8px">${esc(clean(c.head || st.head))}</div>${c.sub ? `<div style="font-size:13px;color:${C.mute};margin-top:3px">${esc(clean(c.sub))}</div>` : ''}</a></td>`; };
  const gridRows = [];
  for (let i = 0; i < cards.length; i += 2) gridRows.push(`<tr>${card(cards[i], 0)}${cards[i + 1] ? card(cards[i + 1], 1) : '<td class="stack" width="50%"></td>'}</tr>`);
  const flood = box && /flood/i.test(box.title + box.items.map((x) => x.st.head).join(' '));
  const boxHtml = box ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4f8;border-radius:10px;margin-top:4px"><tr><td style="padding:14px 16px;font-size:14.5px;line-height:1.45">
  <b>${esc(clean(box.title))}</b> ${box.items.map((x) => `<a href="${storyUrl(x.st)}" style="color:${C.blue}">${esc(clean(x.label))}</a>`).join(' &middot; ')}${flood ? ` &middot; <a href="${ORIGIN}/flood/" style="color:${C.blue}">Live river levels</a>` : ''}
 </td></tr></table>` : '';
  return band(`${label('Around town')}
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">${gridRows.join('')}</table>${boxHtml}${safeHtml}
 <div style="font-size:14px;margin-top:14px"><a href="${ORIGIN}/news/" style="color:${C.blue};font-weight:700">All Squamish news this week &rarr;</a></div>`, { id: 'town' });
}

// ---------- the weekend ----------
const SKY = (c) => c <= 1 ? ['&#9728;&#65039;', 'Sunny'] : c <= 3 ? ['&#9729;&#65039;', 'Cloudy'] : c <= 48 ? ['&#127787;&#65039;', 'Foggy'] : c <= 67 || (c >= 80 && c <= 82) ? ['&#127783;&#65039;', 'Rain'] : c <= 77 || c === 85 || c === 86 ? ['&#127784;&#65039;', 'Snow'] : ['&#9928;&#65039;', 'Storms'];
function weekend(today) {
  if (!today?.days?.length) return '';
  const wk = today.days.filter((d) => [6, 0].includes(noon(d.date).getDay())).slice(0, 2);
  if (!wk.length) return '';
  const hw = today.highway, open = hw?.status === 'clear', band2 = today.river?.band || '';
  const riverOk = !band2 || /normal|low/i.test(band2);
  const tile = (bg, icon, top, bottom) => `<td width="25%" style="background:${bg};border-radius:10px;padding:10px 4px;text-align:center;font-size:13px;color:${C.ink}">${lk(`${ORIGIN}/today/`, `<div style="font-size:22px">${icon}</div><b>${top}</b><br>${bottom}`)}</td>`;
  const tiles = [...wk.map((d) => tile(C.cream, SKY(d.code)[0], dayName(d.date).slice(0, 3), `${Math.round(d.hi)}&deg; / ${Math.round(d.lo)}&deg;`)),
    hw ? tile(open ? C.goodbg : C.badbg, '&#128739;&#65039;', 'Hwy 99', open ? 'Open' : 'Check first') : '',
    band2 ? tile(riverOk ? C.goodbg : C.goldbg, '&#127754;', 'River', esc(band2.replace(/^./, (c) => c.toUpperCase()))) : ''].filter(Boolean);
  const wet = wk.map((d) => d.rain >= 0.5 ? `${dayName(d.date)} ${SKY(d.code)[1].toLowerCase()}, about ${Math.round(d.rain)} mm` : d.snow >= 0.5 ? `${dayName(d.date)} snow, about ${Math.round(d.snow)} cm` : `${dayName(d.date)} dry`).join('; ');
  const road = hw && !open ? ` Highway 99: ${esc(hw.events?.[0]?.text?.split('.')[0] || 'check DriveBC before you go')}.` : '';
  return band(`${label('The weekend')}
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr>${tiles.join('<td width="6"></td>')}</tr></table>
 <div style="font-size:13px;color:${C.mute};margin-top:8px">${esc(wet)}.${road} <a href="${ORIGIN}/today/" style="color:${C.blue}">Tides, Spit wind, is the rock dry &rarr;</a></div>`, { pad: '18px 24px' });
}

// ---------- promises ----------
function promises(p, prev) {
  if (!p) return '';
  const total = Object.values(p).reduce((s, n) => s + n, 0), judged = total - (p.not_yet || 0);
  const was = prev?.promises, moved = was ? judged - (Object.values(was).reduce((s, n) => s + n, 0) - (was.not_yet || 0)) : 0;
  const parts = [p.kept && `${p.kept} kept`, p.not_kept && `${p.not_kept} not kept`, p.mixed && `${p.mixed} mixed`, p.progress && `${p.progress} in progress`].filter(Boolean);
  return band(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:14.5px;color:${C.ink}">${lk(`${ORIGIN}/scorecard/`, `<b>Promise tracker:</b> ${judged} of ${total} council promises voted on${judged ? ` (${esc(parts.join(', '))})` : ' yet'}${moved > 0 ? `, ${moved} this week` : ''}`)}</td><td align="right" width="80"><a href="${ORIGIN}/scorecard/" style="color:${C.blue};font-size:14px;font-weight:700">See them</a></td></tr></table>
 ${lk(`${ORIGIN}/scorecard/`, `<div style="background:${C.line};height:8px;border-radius:4px;margin-top:8px"><div style="background:${C.green};width:${Math.max(1, Math.round((100 * judged) / Math.max(1, total)))}%;height:8px;border-radius:4px"></div></div>`, 'display:block')}`, { pad: '18px 24px' });
}

// ---------- new on the site: one featured thing ----------
function siteNew(items) {
  if (!items?.length) return '';
  const [f, ...rest] = items;
  return band(`${label('New on the site')}
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr>
  <td width="64" valign="top"><div style="width:52px;height:52px;border-radius:12px;background:${C.goldbg};text-align:center;line-height:52px;font-size:13px;font-weight:800;color:${C.goldink}">NEW</div></td>
  <td style="font-size:14.5px;line-height:1.45;color:${C.ink}">${lk(`${ORIGIN}${f.path}`, `<b style="color:${C.blue}">${esc(f.name)}.</b> ${esc(f.text)}`)} <a href="${ORIGIN}${f.path}" style="color:${C.blue};font-weight:700">Try it</a></td>
 </tr></table>
 ${rest.length ? `<div style="font-size:13px;color:${C.mute};margin-top:10px">Also new: ${rest.map((x) => `<a href="${ORIGIN}${x.path}" style="color:${C.blue}">${esc(x.name.toLowerCase())}</a>`).join(' &middot; ')}</div>` : ''}`, { pad: '20px 24px' });
}

// ---------- Claude writes the words; every fact comes from the facts given, every link is checked ----------
async function words(facts, commits, announced) {
  const fallback = { subjects: [facts.subject_hint], preheader: '', headline: facts.subject_hint, dek: '', skim: [], council: {}, heads: {}, town: null, coming: [], site_new: [] };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  const str = { type: 'string' };
  try {
    const out = await claudeJson({
      effort: 'medium', maxTokens: 8000,
      system: `${STYLE}
You are writing the weekly Squamish Voters email. It is the skim layer: a reader should get the whole week in a minute, and tap through to the site for detail. The voice is neutral and plain, signed Squamish Voters, never by a person. Never use an em dash or a hyphenated compound word. Never invent a fact, number, name or date: use only what is in the facts given. Squamish Voters is politics first, then what is happening in the city: lead with council, budgets, taxes and city decisions, and what changed for a resident (money, a deadline). Deaths, drownings, injuries and other tragedies never go in the subject lines, the preview line, the headline or the five lines; they appear quietly near the end of the email.`,
      content: `Facts for this week's email (JSON):\n${JSON.stringify(facts)}\n\nThis week's site changes (git commit subjects, newest first):\n${commits.join('\n') || '(none)'}\n\nAlready announced in an earlier email, so leave these out of site_new unless something new was added:\n${announced.join('\n') || '(none)'}\n\nWrite:
1. subjects: three different subject lines, each under 65 characters, best first. Lead with politics or city news and the reader's stake (their bill, a date). Never mention a death or tragedy. No clickbait, no emoji.
2. preheader: the inbox preview line under the subject, under 90 characters, naming the other one or two biggest things.
3. headline: the email's own headline, under 90 characters, naming the stake for a reader. dek: one short sentence under it.
4. skim: exactly five lines, politics first, then city news. No deaths, injuries or tragedies. Each has lead (two to four words, bold in the email), text (one sentence, with the key number or name) and red (always false). anchor: "council" if the line is about this week's council meeting, else "". slug: the slug of the story in the facts that the line is about (story_slug, slug), so a tap opens it; "" if none.
5. council: for each meeting in council_meetings, its meeting id, head (a news headline under 80 characters) and in_short (two short sentences: what was decided and what comes next).
6. heads: for each story in politics_other that is not already covered by council_meetings, its slug and a headline under 70 characters. Leave out stories that repeat a council meeting decision.
7. town: from town_stories, pick up to four cards for a photo grid (only stories with has_photo true lead a card). Put stories on the same event in one card (list every slug, the first one leads), with head (under 60 characters) and sub (a few words: when, where or why). Put two or more stories about one running situation (for example flood recovery) in box instead: title (a short question or phrase) with slugs and labels (a few words each). Use box only when it fits; otherwise give it an empty title and empty lists. Leave out any story that is out of date by today (${stamp}), such as a warning for a day that has passed.
8. coming: for each date in coming_up worth a line, the date and note about the main public meeting that day (not a mostly closed special meeting) (one sentence on why a resident would care, from the facts; empty list if none).
9. site_new: up to 4 things a resident would notice or use that were added or clearly improved on the site this week, from the commits, best fit for this week's news first. Skip fixes, admin pages, search engine work, internal tools and anything private. Each has name (2 to 5 words), text (one plain sentence on what it does for them) and path (the site path, starting and ending with /). Empty list if nothing qualifies.`,
      schema: { type: 'object', additionalProperties: false, required: ['subjects', 'preheader', 'headline', 'dek', 'skim', 'council', 'heads', 'town', 'coming', 'site_new'], properties: {
        subjects: { type: 'array', items: str }, preheader: str, headline: str, dek: str,
        skim: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['lead', 'text', 'red', 'anchor', 'slug'], properties: { lead: str, text: str, red: { type: 'boolean' }, anchor: { type: 'string', enum: ['council', ''] }, slug: str } } },
        council: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['meeting', 'head', 'in_short'], properties: { meeting: str, head: str, in_short: str } } },
        heads: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['slug', 'head'], properties: { slug: str, head: str } } },
        town: { type: 'object', additionalProperties: false, required: ['cards', 'box'], properties: {
          cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['slugs', 'head', 'sub'], properties: { slugs: { type: 'array', items: str }, head: str, sub: str } } },
          box: { type: 'object', additionalProperties: false, required: ['title', 'slugs', 'labels'], properties: { title: str, slugs: { type: 'array', items: str }, labels: { type: 'array', items: str } } } } },
        coming: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['date', 'note'], properties: { date: str, note: str } } },
        site_new: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'text', 'path'], properties: { name: str, text: str, path: str } } } } },
    });
    const checked = [];
    for (const x of out.site_new.slice(0, 4)) {
      if (!/^\/[a-z0-9\-/]*$/.test(x.path)) continue;
      const r = await fetch(ORIGIN + x.path, { method: 'HEAD' }).catch(() => null);
      if (r?.ok) checked.push({ name: clean(x.name), text: clean(x.text), path: x.path });
    }
    return {
      subjects: out.subjects.map(clean).filter(Boolean).slice(0, 3), preheader: clean(out.preheader), headline: clean(out.headline), dek: clean(out.dek),
      skim: out.skim.slice(0, 5).map((s) => ({ ...s, lead: clean(s.lead), text: clean(s.text) })),
      council: Object.fromEntries(out.council.map((c) => [c.meeting, { head: clean(c.head), in_short: clean(c.in_short) }])),
      heads: Object.fromEntries(out.heads.map((h) => [h.slug, clean(h.head)])), town: out.town, coming: out.coming.map((c) => ({ date: c.date, note: clean(c.note) })), site_new: checked,
    };
  } catch (e) { log('claude words failed, using plain wording:', e.message); return fallback; }
}

const ANNOUNCED_OCT30 = ['Scorecard of promises against votes', 'Squamish today page', 'Have your say', 'Neighbourhood pages', 'Why property taxes went up 12.8% explainer', 'Woodfibre LNG taxes explainer', 'How council works page', 'What Squamish Wants', 'News page', 'Readers top issues'];

// ---------- build ----------
let subject, subjects = [], html;
if (arg('--html')) {
  subject = arg('--subject') || 'Squamish Voters';
  html = fs.readFileSync(arg('--html'), 'utf8');
} else {
  const D = await gather();
  const prev = await lastSnapshot();
  const rows = wantsRows(D);
  const views = await newsViews();
  const ranked = rankStories(views).filter((st) => !isStale(st));
  const meetings = D.W.recent.slice(0, 2);
  const meetingIds = new Set(meetings.map((m) => (/\/meetings\/([^/]+)\//.exec(m.url) || [])[1]));
  const safety = ranked.filter(isSafety).sort((a, b) => GRAVE.test(b.head) - GRAVE.test(a.head));
  const pol = ranked.filter((st) => isPolitics(st) && !isSafety(st));
  const meetDays = meetings.map((m) => noon(m.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }).toLowerCase().replace(/\.?\s+/, '-'));
  const polOther = pol.filter((st) => !meetingIds.has(st.meeting) && !meetDays.some((d) => st.slug.includes(d))).slice(0, 4);
  const town = ranked.filter((st) => !isPolitics(st) && !isSafety(st));
  const participate = readJson('data/participate.json', {})?.write_to_council || null;

  const facts = {
    today: stamp,
    subject_hint: 'This week in Squamish',
    council_meetings: meetings.map((m) => { const id = (/\/meetings\/([^/]+)\//.exec(m.url) || [])[1]; const st = (NEWS.stories || []).find((s) => s.meeting === id);
      return { meeting: id, story_slug: st?.slug || null, date: m.date, headline: m.headline, key_points: m.key_points, story_gist: st?.gist || null, glance: st?.glance || null }; }),
    politics_other: polOther.map((st) => ({ slug: st.slug, head: st.head, dek: st.dek, date: st.date })),
    safety: safety.slice(0, 3).map((st) => ({ slug: st.slug, head: st.head, dek: st.dek, date: st.date })),
    town_stories: town.slice(0, 14).map((st) => ({ slug: st.slug, head: st.head, dek: short(st.dek, 240) || st.dek, date: st.date, has_photo: !!st.photo?.file, readers: views?.[st.slug]?.visitors || null })),
    coming_up: D.W.soon.map((m) => ({ date: m.date, what: m.type, preview: m.preview })).concat((D.W.dates || []).filter((d) => d.date).map((d) => ({ date: d.date, what: d.title, preview: d.text }))),
    wants_people: D.wants?.people || 0,
  };
  const w = await words(facts, weekCommits(), prev?.announced || ANNOUNCED_OCT30);
  subjects = w.subjects.length ? w.subjects : [facts.subject_hint];
  subject = subjects[0];

  const blocks = meetings.map((m, i) => councilBlock(m, w, i === 0));
  const councilStories = blocks.map((b) => b.story).filter(Boolean);
  const ask = oneTap([...councilStories, ...polOther], participate);
  const skim = w.skim.length ? w.skim : [...meetings.map((m) => ({ lead: 'Council', text: firstSentence(m.headline), anchor: 'council' })), ...polOther.slice(0, 2).map((st) => ({ lead: 'Politics', text: st.head, slug: st.slug })), ...town.slice(0, 2).map((st) => ({ lead: 'Around town', text: st.head, slug: st.slug }))].slice(0, 5);
  const bySlug = Object.fromEntries((NEWS.stories || []).map((st) => [st.slug, st]));
  const skimRows = skim.map((s, i) => { const st = bySlug[s.slug]; const line = `<b style="color:${st ? C.blue : C.ink}">${esc(s.lead)}${/[.?!:]$/.test(s.lead) ? '' : '.'}</b> ${esc(s.text)}`;
    return `<tr><td valign="top" width="30" style="padding:7px 0;font-weight:800;color:${s.red ? C.red : C.green}">${i + 1}</td><td style="padding:7px 0;${i < skim.length - 1 ? 'border-bottom:1px solid #dde8e2' : ''}">${st ? `${lk(storyUrl(st), line)}${more(storyUrl(st), 'Read')}` : line}${s.anchor === 'council' && blocks.length ? ` <a href="#council" style="color:${C.blue};font-weight:700;white-space:nowrap">Below &darr;</a>` : ''}</td></tr>`; }).join('');
  const headline = w.headline || blocks[0]?.story?.head || facts.subject_hint;
  if (!w.subjects.length || w.subjects[0] === facts.subject_hint) { subjects = [headline]; subject = headline; }

  const body = [
    band(`${label('This week', '#b3541e')}
 <div class="hl" style="font-family:${SERIF};font-size:32px;line-height:1.12;font-weight:700;margin:6px 0 10px;color:${C.ink}">${blocks[0]?.story ? lk(storyUrl(blocks[0].story), esc(headline)) : esc(headline)}</div>
 ${w.dek ? `<div style="font-size:16px;line-height:1.5;color:${C.soft}">${esc(w.dek)}</div>` : ''}`, { gap: false, pad: '26px 24px 8px' }),
    skimRows ? band(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8f5;border:1px solid #cfe0d8;border-radius:12px">
 <tr><td style="padding:16px 18px 6px;font-size:13px;font-weight:800;letter-spacing:.6px;color:${C.green}">THE 60 SECOND VERSION</td></tr>
 <tr><td style="padding:0 18px 14px;font-size:15.5px;line-height:1.45;color:${C.ink}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${skimRows}</table></td></tr></table>`, { gap: false, pad: '14px 24px 22px' }) : '',
    ...blocks.map((b) => b.html),
    politicsRows(Object.keys(w.heads).length ? polOther.filter((st) => w.heads[st.slug]) : polOther, w),
    versus(blocks, rows, D.wants, prev, ask),
    comingUp(D.W, w),
    aroundTown(town, w, safety),
    weekend(D.today),
    promises(D.W.promises, prev),
    siteNew(w.site_new),
  ].filter(Boolean).join('\n');

  const footer = `<tr><td class="px" style="background:${C.cream};padding:22px 24px 30px;border-top:8px solid ${C.bg}">
 <div style="font-size:14px;font-weight:700;color:${C.ink}">Talk about it with neighbours</div>
 <div style="padding-top:8px">
  <a href="https://www.facebook.com/groups/1090076830319905" style="display:inline-block;background:#1877f2;color:#fff;text-decoration:none;font-weight:700;font-size:13.5px;padding:8px 14px;border-radius:20px;margin:0 6px 6px 0">Facebook group</a>
  <a href="https://www.reddit.com/r/Squamish_News/" style="display:inline-block;background:#ff4500;color:#fff;text-decoration:none;font-weight:700;font-size:13.5px;padding:8px 14px;border-radius:20px;margin:0 6px 6px 0">r/Squamish_News</a>
  <a href="mailto:?subject=${encodeURIComponent('Squamish this week')}&amp;body=${encodeURIComponent('Thought you might like this weekly Squamish email: https://squamishvoters.com')}" style="display:inline-block;border:1.5px solid ${C.green};color:${C.green};text-decoration:none;font-weight:700;font-size:13.5px;padding:7px 14px;border-radius:20px;margin:0 6px 6px 0">Forward to a neighbour</a>
 </div>
 <div style="font-size:12.5px;color:${C.mute};line-height:1.5;margin-top:14px">Spot a mistake or have a tip? Just reply. Squamish Voters is an independent, plain language guide to Squamish council, made by Jeff Kirdeikis in Squamish, British Columbia. You're getting this because you signed up at <a href="${ORIGIN}/" style="color:${C.mute}">squamishvoters.com</a>.${CREDITS.size ? ` Photos: ${esc([...CREDITS].join('; '))}.` : ''} <a href="%%UNSUB%%" style="color:${C.mute}">Unsubscribe</a>.</div>
</td></tr>`;

  const text = (body + footer).replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');
  const minutes = Math.max(2, Math.ceil(text.split(/\s+/).filter((x) => /[a-z0-9]/i.test(x)).length / 220));
  const date = new Date().toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Vancouver' }).replace(/\./g, '');

  html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
body{margin:0;padding:0;background:${C.bg}}
@media (max-width:480px){.px{padding-left:16px!important;padding-right:16px!important}.stack{display:block!important;width:100%!important;padding:0 0 18px!important}.hl{font-size:27px!important;line-height:1.15!important}img{max-width:100%!important}}
</style></head>
<body style="margin:0;padding:0;background:${C.bg}">
${w.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(w.preheader)}${'&#847; '.repeat(40)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:0">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;font-family:${FONT};color:${C.ink}">
<tr><td class="px" style="background:${C.green};padding:14px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
 <td style="color:#fff;font-weight:800;font-size:15px;letter-spacing:.3px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px"><a href="${ORIGIN}/"><img src="${ORIGIN}/icon-96.png" width="30" height="30" alt="Squamish Voters logo" style="display:block;width:30px;height:30px;border-radius:7px;border:0"></a></td><td style="color:#fff;font-weight:800;font-size:15px;letter-spacing:.3px">SQUAMISH VOTERS</td></tr></table></td>
 <td align="right" style="color:#cfe0d8;font-size:12px">${esc(date)} &middot; ${minutes} min read</td></tr></table></td></tr>
${body}
${footer}
</table></td></tr></table>
</body></html>`;
  if (sql) await sql`INSERT INTO sv_digest_snap (data) VALUES (${JSON.stringify({ people: D.wants?.people || 0, promises: D.W.promises, wants: Object.fromEntries(rows.map((r) => [r.id, r.total])), ask: ask?.snap || null, announced: [...(prev?.announced || ANNOUNCED_OCT30), ...w.site_new.map((x) => x.name)].slice(-40) })})`;
}

// Every link to the site carries utm tags, so site analytics can count clicks from each email (filter utm_campaign).
// API links (unsubscribe, approve) are left alone.
const utm = `utm_source=squamish-voters-email&amp;utm_medium=email&amp;utm_campaign=weekly-${stamp}`;
html = html.replace(/href="(https:\/\/(?:www\.)?squamishvoters\.com(?!\/api\/)[^"#]*)(#[^"]*)?"/g,
  (m, u, h = '') => (u.includes('utm_') ? m : `href="${u}${u.includes('?') ? '&amp;' : '?'}${utm}${h}"`));

const dir = path.join(ROOT, 'data', 'digest'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${stamp}.html`), html.replaceAll('%%UNSUB%%', `${ORIGIN}/api/subscribe/?unsubscribe=PREVIEW`));
log('preview written', `data/digest/${stamp}.html`, '|', subject, subjects.length > 1 ? `| also: ${subjects.slice(1).join(' / ')}` : '');

if (!REQUEST) process.exit(0);
const { RESEND_API_KEY, EMAIL_FROM } = process.env;
const TO = process.env.DIGEST_REVIEW_TO || 'jeffreykirdeikis@gmail.com';
if (!RESEND_API_KEY || !EMAIL_FROM || !sql) { log('no email service connected yet; preview only'); process.exit(0); }
const crypto = await import('node:crypto');
await sql`CREATE TABLE IF NOT EXISTS sv_digests (id text PRIMARY KEY, token text NOT NULL, subject text NOT NULL, html text NOT NULL,
  status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz, sent_at timestamptz,
  sent_count int, error text)`;
await sql`ALTER TABLE sv_digests ADD COLUMN IF NOT EXISTS subjects jsonb`;
// A newer email replaces any older one still waiting, so an old link can't send a stale email.
await sql`UPDATE sv_digests SET status = 'replaced' WHERE status = 'pending'`;
const id = `${stamp}-${crypto.randomBytes(3).toString('hex')}`, token = crypto.randomBytes(18).toString('hex');
await sql`INSERT INTO sv_digests (id, token, subject, html, subjects) VALUES (${id}, ${token}, ${subject}, ${html}, ${JSON.stringify(subjects.length ? subjects : [subject])})`;
const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_subscribers WHERE status = 'subscribed'`;
const link = `${ORIGIN}/api/digest-review/?id=${id}&t=${token}`;
const banner = `<div style="background:#fff4d6;border-bottom:2px solid #e6c766;padding:18px;font:16px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#14211c;text-align:center">
<p style="margin:0 0 4px;font-weight:700;font-size:18px">Approve this email before it goes out?</p>
<p style="margin:0 0 12px">Nothing has been sent to readers. Below is exactly what ${n} confirmed readers will get.${subjects.length > 1 ? ' You pick the subject line on the approve page.' : ''}</p>
<a href="${link}" style="background:#0f4c3a;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px;display:inline-block">Review and approve</a>
<p style="margin:10px 0 0;font-size:14px">Want changes? Reply to this email or tell Claude, and a new version will replace this one.</p></div>`;
const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: EMAIL_FROM, to: [TO], subject: `Approve? ${subject}`, html: html.replace(/<body([^>]*)>/, `<body$1>${banner}`).replaceAll('%%UNSUB%%', '#'),
    text: `Approve this email before it goes to ${n} readers:\n${link}\n\nSubject options:\n${(subjects.length ? subjects : [subject]).map((s) => '- ' + s).join('\n')}` }) });
if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
log(`approval request sent to ${TO} (${n} readers waiting)`);
