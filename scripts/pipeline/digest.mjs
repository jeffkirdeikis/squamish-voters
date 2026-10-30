// The Friday email. A full weekly roundup: council votes and what's coming up, What Squamish Wants results, readers'
// top issues, the weekend, the promise scorecard, the Facebook group, news and what's new on the site. Built from the
// live site (this-week.json, /api/wants/, /api/priorities/, /api/today/) so the email and the site say the same thing.
// Nothing goes to readers until Jeff approves it.
//   node scripts/pipeline/digest.mjs                                   writes a preview to data/digest/<date>.html
//   node scripts/pipeline/digest.mjs --request                         emails Jeff the preview with an Approve button
//   node scripts/pipeline/digest.mjs --request --html f.html --subject "..."   same, for a hand-written email
// The Approve button (api/digest-review.js) sends it to every confirmed subscriber. --request needs RESEND_API_KEY,
// EMAIL_FROM and POSTGRES_URL; DIGEST_REVIEW_TO overrides who approves. ANTHROPIC_API_KEY lets Claude write the
// subject, the opening lines and "New on the site" (from the week's commits); without it those fall back to plain
// wording. In a hand-written email, %%UNSUB%% becomes each reader's unsubscribe link.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, log, claudeJson, STYLE } from './lib.mjs';

const ORIGIN = 'https://squamishvoters.com';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const REQUEST = process.argv.includes('--request');
const DB = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = DB && REQUEST ? (await import('@neondatabase/serverless')).neon(DB) : null;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
const num = (n) => Number(n).toLocaleString('en-CA');
const get = async (p) => { try { const r = await fetch(ORIGIN + p); return r.ok ? await r.json() : null; } catch { return null; } };
const stamp = new Date().toISOString().slice(0, 10);
const weekAgo = Date.now() - 7 * 864e5;

// Shared pieces of the email's look (same as the first full email, Oct 30 2026).
const S = {
  card: 'background:#fff;border:1px solid #d9d5c8;border-radius:12px;padding:16px;margin:0 0 14px',
  h2: 'font-size:20px;margin:24px 0 8px',
  a: 'color:#0b5cab',
  more: 'color:#0b5cab;font-weight:700',
  q: 'margin:0 0 4px;font-weight:700',
};
const section = (icon, title, inner) => `<h2 style="${S.h2}">${icon} ${esc(title)}</h2>\n${inner}`;
const bars = (rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;margin:0 0 14px">
${rows.map(([pct, label], i) => `    <tr><td width="44" style="padding:3px 0"><b>${pct}%</b></td><td style="padding:3px 0"><div style="background:${i ? '#7aa594' : '#0f4c3a'};height:10px;border-radius:5px;width:${Math.max(pct, 2)}%"></div></td><td width="200" style="padding:3px 0 3px 8px">${esc(label)}</td></tr>`).join('\n')}
  </table>`;

// ---------- data ----------
async function gather() {
  const [W, wants, pri, today] = await Promise.all([get('/this-week.json'), get('/api/wants/'), get('/api/priorities/'), get('/api/today/')]);
  if (!W) throw new Error('could not load this-week.json');
  const starters = JSON.parse(fs.readFileSync(path.join(ROOT, 'api', '_wants.json'), 'utf8')).asks;
  return { W, wants, pri, today, starters };
}

// One row per question with answers: multiple choice gets ranked options, yes/no gets counts.
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
      const opts = Object.entries(t).filter(([k, v]) => labels[k] && typeof v === 'number').map(([k, v]) => ({ label: labels[k], n: v }));
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

// Last week's numbers, so the email can say what moved. Kept in the database next to the emails.
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
      .split('\n').filter((s) => s && !/^(News update|Meetings update|AI visibility check|Data:|IndexNow|Chore)/i.test(s)).slice(0, 80);
  } catch { return []; }
}

// ---------- sections ----------
function council(W) {
  if (!W.recent.length) return '';
  return section('🏛️', 'What council decided', W.recent.map((m) => `<div style="${S.card}">
  <p style="margin:0 0 6px;color:#44504a;font-size:15px">${esc(day(m.date))} · ${esc(m.type)}</p>
  <p style="margin:0 0 10px;font-weight:700;font-size:18px">${esc(m.headline)}</p>
  <ul style="margin:0 0 10px;padding-left:20px">${m.key_points.map((k) => `<li style="margin:4px 0">${esc(k)}</li>`).join('')}</ul>
  ${m.votes.filter((v) => v.for_you).map((v) => `<p style="margin:6px 0;background:#fff4d6;border-radius:8px;padding:8px 10px;font-size:15px"><b>${esc(v.title)}:</b> ${esc(v.for_you)}</p>`).join('')}
  <a href="${m.url}" style="${S.more}">See who voted which way →</a></div>`).join('\n'));
}

function comingUp(W) {
  const until = Date.now() + 24 * 864e5, seen = new Set(), items = [];
  for (const m of W.soon) { seen.add(m.url); items.push({ date: m.date, html: `<b>${esc(day(m.date))}${m.time ? ` · ${esc(m.time.replace(/\.$/, ''))}` : ''}.</b> ${esc(m.type)}: ${esc(m.preview)} <a href="${m.url}" style="${S.a}">How to watch or have your say</a>` }); }
  for (const d of W.dates || []) {
    if (seen.has(d.url) || (d.date && new Date(d.date + 'T12:00:00') > until) || (d.date && new Date(d.date + 'T23:59:00') < Date.now())) continue;
    items.push({ date: d.date || '9999', html: `<b>${d.date ? esc(day(d.date)) : 'Date to be confirmed'}.</b> ${esc(d.title)}: ${esc(d.text)} <a href="${d.url}" style="${S.a}">Details</a>` });
  }
  if (!items.length && W.next) items.push({ date: W.next.date, html: `<b>${esc(day(W.next.date))}.</b> ${esc(W.next.type)}: ${esc(W.next.preview)} <a href="${W.next.url}" style="${S.a}">Meeting page</a>` });
  if (!items.length) return '';
  items.sort((a, b) => a.date.localeCompare(b.date));
  return section('📅', 'Coming up', `<div style="${S.card}">\n${items.map((x, i) => `  <p style="margin:0 0 ${i === items.length - 1 ? 0 : 8}px">${x.html}</p>`).join('\n')}\n</div>`);
}

function wantsSection(rows, people, prev) {
  if (!rows.length) return '';
  const before = prev?.wants || {};
  const grew = (r) => r.total - (before[r.id] || 0);
  // Three multiple choice questions: the ones that got the most new answers this week (or the most answers overall).
  const choice = rows.filter((r) => r.kind === 'choice' && r.total >= 20).sort((a, b) => grew(b) - grew(a) || b.total - a.total).slice(0, 3);
  const yesno = rows.filter((r) => r.kind === 'yesno' && r.total >= 30);
  const fresh = rows.filter((r) => r.kind === 'yesno' && r.created && Date.parse(r.created) > weekAgo).sort((a, b) => b.total - a.total).slice(0, 3);
  const bigYes = yesno.filter((r) => !fresh.includes(r)).sort((a, b) => (b.y - b.n) - (a.y - a.n)).slice(0, 3);
  const close = yesno.filter((r) => r.y + r.n >= 40).sort((a, b) => Math.abs(a.y - a.n) - Math.abs(b.y - b.n))[0];
  const newPeople = prev?.people ? people - prev.people : 0;
  const moreChoice = rows.filter((r) => r.kind === 'choice' && r.total >= 20 && !choice.includes(r)).sort((a, b) => b.total - a.total).slice(0, 2);
  const yn = (r) => `${esc(r.title)} (${num(r.y)} yes, ${num(r.n)} no)`;
  const li = (html) => `    <li style="margin:4px 0">${html}</li>`;
  const bullets = [
    ...moreChoice.map((r) => li(`<b>${esc(r.title)}</b> ${r.opts[0].pct}% say ${esc(r.opts[0].label.toLowerCase())}; ${r.opts[1].pct}% say ${esc(r.opts[1].label.toLowerCase())}.`)),
    fresh.length ? li(`<b>New this week from residents:</b> ${fresh.map(yn).join('; ')}.`) : '',
    bigYes.length ? li(`<b>Big yeses:</b> ${bigYes.map(yn).join('; ')}.`) : '',
    close ? li(`<b>Closest call:</b> ${yn(close)}.`) : '',
  ].filter(Boolean);
  return section('🙋', 'What Squamish wants', `<p style="margin:0 0 10px">${num(people)} people have answered questions on our What Squamish Wants page${newPeople > 0 ? `, ${num(newPeople)} of them new this week` : ' so far'}. It's open to anyone, so it isn't a scientific poll, and it isn't run by the District. Here's where things stand:</p>
<div style="${S.card}">
${choice.map((r) => `  <p style="${S.q}">${esc(r.title)}</p>\n  ${bars(r.opts.slice(0, 3).map((o) => [o.pct, o.label]))}`).join('\n')}
${bullets.length ? `  <p style="margin:0 0 6px;font-weight:700">Other things that stood out</p>\n  <ul style="margin:0 0 12px;padding-left:20px">\n${bullets.join('\n')}\n  </ul>` : ''}
  <a href="${ORIGIN}/wants/" style="${S.more}">Add your answers, or ask your own question →</a>
</div>`);
}

const ISSUE = { growth: 'growth', taxes_spending: 'taxes', recreation_facilities: 'Brennan Park and recreation', environment_lng: 'the Woodfibre LNG plant', parking: 'parking', homelessness: 'homelessness', housing_affordability: 'housing costs', economy: 'local jobs', transportation: 'getting around', climate: 'climate', flood_hazards_climate_resilience: 'flood protection', policing: 'policing' };
function priorities(pri) {
  if (!pri?.issues?.length || pri.people < 5) return '';
  const top = pri.issues.slice(0, 5).map((i) => ISSUE[i.key] || i.key.replace(/_/g, ' '));
  const g = pri.issues[0], lean = g.leans && Object.entries(g.leans).sort((a, b) => b[1] - a[1])[0];
  const leanLine = g.key === 'growth' && lean?.[0] === 'slower' && lean[1] / g.n > 0.6 ? ' (nearly everyone who picked it wants it slowed down)' : '';
  return `<p style="margin:0 0 14px;font-size:16px">And from readers of this email: the top issue is <b>${esc(top[0])}</b>${leanLine}, then ${top.slice(1, -1).map((t) => `<b>${esc(t)}</b>`).join(', ')} and <b>${esc(top.at(-1))}</b>. <a href="${ORIGIN}/priorities/" style="${S.a}">See readers' top issues</a></p>`;
}

const SKY = (c) => c <= 1 ? 'Sunny' : c <= 3 ? 'Cloudy' : c <= 48 ? 'Foggy' : c <= 67 || (c >= 80 && c <= 82) ? 'Rain' : c <= 77 || c === 85 || c === 86 ? 'Snow' : 'Storms';
function weekend(today) {
  if (!today?.days?.length) return '';
  const wk = today.days.filter((d) => [6, 0].includes(new Date(d.date + 'T12:00:00').getDay())).slice(0, 2);
  if (!wk.length) return '';
  const rows = wk.map((d) => `<tr><td style="padding:3px 0"><b>${new Date(d.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long' })}</b></td><td style="padding:3px 0">${SKY(d.code)}, high ${Math.round(d.hi)}°, low ${Math.round(d.lo)}°</td><td align="right" style="padding:3px 0">${d.rain >= 0.5 ? `${Math.round(d.rain)} mm rain` : d.snow >= 0.5 ? `${Math.round(d.snow)} cm snow` : 'dry'}</td></tr>`).join('');
  const hw = today.highway, roads = !hw ? '' : hw.status === 'clear' ? 'Highway 99 has no closures right now' : `Highway 99: ${hw.events?.[0]?.text?.split('.')[0] || 'check before you go'}`;
  const river = today.river?.band ? `the Squamish River is ${today.river.band} for this time of year` : '';
  const extra = [roads, river].filter(Boolean).join(', and ');
  return section('🌦️', 'The weekend', `<div style="${S.card}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:16px;margin:0 0 10px">${rows}</table>
  ${extra ? `<p style="margin:0 0 10px">${esc(extra.charAt(0).toUpperCase() + extra.slice(1))}.</p>` : ''}
  <a href="${ORIGIN}/today/" style="${S.more}">Tides, wind at the Spit and "Is the rock dry?" →</a>
</div>`);
}

function scorecard(p, prev) {
  if (!p) return '';
  const total = Object.values(p).reduce((s, n) => s + n, 0), judged = total - (p.not_yet || 0);
  const was = prev?.promises, moved = was ? judged - (Object.values(was).reduce((s, n) => s + n, 0) - (was.not_yet || 0)) : 0;
  const parts = [p.kept && `${p.kept} kept`, p.not_kept && `${p.not_kept} not kept`, p.mixed && `${p.mixed} mixed`, p.progress && `${p.progress} in progress`, p.early && `${p.early} too early to call`].filter(Boolean);
  const line = !judged
    ? `All ${total} promises the new council made are still waiting on their first votes. We check every vote against them the night it happens.`
    : `${judged} of ${total} promises have a result so far: ${parts.join(', ')}.${moved > 0 ? ` ${moved} got a result this week.` : ''}`;
  return section('📋', 'Promise scorecard', `<div style="${S.card}"><p style="margin:0 0 10px">${esc(line)}</p><a href="${ORIGIN}/scorecard/" style="${S.more}">See every promise →</a></div>`);
}

const facebook = () => section('💬', 'Join us on Facebook', `<a href="https://www.facebook.com/groups/1090076830319905" style="display:block;background:#fff;border:1px solid #d9d5c8;border-radius:12px;overflow:hidden;margin:0 0 14px;color:#14211c;text-decoration:none">
  <img src="${ORIGIN}/img/facebook-group.jpg" width="600" alt="Squamish Voters and Politics Facebook group" style="display:block;width:100%;height:auto;border:0">
  <span style="display:block;padding:14px 16px">
    <b style="display:block;font-size:18px;margin:0 0 4px">Squamish Voters and Politics</b>
    <span style="display:block;margin:0 0 10px">Talk about council decisions with other people in Squamish.</span>
    <span style="display:inline-block;background:#0f4c3a;color:#fff;font-weight:700;padding:9px 16px;border-radius:8px">Join the group</span>
  </span>
</a>`);

function news(W) {
  const all = (W.news || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const items = (all.filter((n) => Date.parse(n.date) > weekAgo).length >= 2 ? all.filter((n) => Date.parse(n.date) > weekAgo) : all).slice(0, 5);
  if (!items.length) return '';
  const short = (s) => { const t = String(s || '').split(/(?<=\.)\s/)[0]; return t.length > 160 ? '' : t; };
  return section('📰', 'In the news', `<div style="${S.card}">
${items.map((n) => `  <p style="margin:0 0 10px"><a href="${n.url}" style="color:#14211c;font-weight:700">${esc(n.head)}</a>${short(n.dek) ? `<br><span style="font-size:15px;color:#44504a">${esc(short(n.dek))}</span>` : ''}</p>`).join('\n')}
  <a href="${ORIGIN}/news/" style="${S.more}">All Squamish news →</a>
</div>`);
}

function siteNew(items) {
  if (!items?.length) return '';
  return section('✨', 'New on the site', `<div style="${S.card}">\n  <ul style="margin:0;padding-left:20px">\n${items.map((x) => `    <li style="margin:6px 0"><a href="${ORIGIN}${x.path}" style="${S.more}">${esc(x.name)}</a>: ${esc(x.text)}</li>`).join('\n')}\n  </ul>\n</div>`);
}

// Claude writes the subject, the opening and "New on the site". Every link it suggests is checked before use.
async function words(facts, commits, announced) {
  const fallback = { subject: facts.subject_hint, intro: 'Hi! Here is your weekly roundup of Squamish council, what people in town are asking for, and what is new.', site_new: [] };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const out = await claudeJson({
      effort: 'medium', maxTokens: 4000,
      system: `${STYLE}
You are writing parts of the weekly Squamish Voters email to subscribers. The voice is neutral and friendly, signed by Squamish Voters, never by a person. Never use an em dash or a hyphenated compound. Never invent a fact: use only what is in the facts given.`,
      content: `Facts for this week's email (JSON):\n${JSON.stringify(facts)}\n\nThis week's site changes (git commit subjects, newest first):\n${commits.join('\n') || '(none)'}\n\nAlready announced in an earlier email, so leave these out of site_new unless something new was added to them:\n${announced.join('\n') || '(none)'}\n\nWrite:
1. subject: an email subject line under 70 characters naming the two or three biggest things in this email. No clickbait, no emoji.
2. intro: two or three short sentences that open the email, starting "Hi!", saying what is in it this week.
3. site_new: up to 6 things a resident would notice or use that were added or clearly improved on the site this week, from the commits. Skip fixes, admin pages, search engine work, internal tools, and anything private. Each has name (2 to 5 words), text (one plain sentence on what it does for them) and path (the site path it lives at, starting and ending with /, such as /today/). Empty list if nothing qualifies.`,
      schema: { type: 'object', additionalProperties: false, required: ['subject', 'intro', 'site_new'], properties: {
        subject: { type: 'string' }, intro: { type: 'string' },
        site_new: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'text', 'path'], properties: { name: { type: 'string' }, text: { type: 'string' }, path: { type: 'string' } } } } } },
    });
    const clean = (s) => String(s).replace(/\s*[—–]\s*/g, ', ').trim();
    const checked = [];
    for (const x of out.site_new.slice(0, 6)) {
      if (!/^\/[a-z0-9\-/]*$/.test(x.path)) continue;
      const r = await fetch(ORIGIN + x.path, { method: 'HEAD' }).catch(() => null);
      if (r?.ok) checked.push({ name: clean(x.name), text: clean(x.text), path: x.path });
    }
    return { subject: clean(out.subject).slice(0, 90) || fallback.subject, intro: clean(out.intro) || fallback.intro, site_new: checked };
  } catch (e) { log('claude words failed, using plain wording:', e.message); return fallback; }
}

// What the first full email (Oct 30 2026) already told readers about, before snapshots kept this list.
const ANNOUNCED_OCT30 = ['Scorecard of promises against votes', 'Squamish today page', 'Have your say', 'Neighbourhood pages', 'Why property taxes went up 12.8% explainer', 'Woodfibre LNG taxes explainer', 'How council works page', 'What Squamish Wants', 'News page', 'Readers top issues'];

// ---------- build ----------
let subject, html;
if (arg('--html')) {
  subject = arg('--subject') || 'Squamish Voters';
  html = fs.readFileSync(arg('--html'), 'utf8');
} else {
  const D = await gather();
  const prev = await lastSnapshot();
  const rows = wantsRows(D);
  const people = D.wants?.people || 0;
  const parts = {
    council: council(D.W), coming: comingUp(D.W), wants: wantsSection(rows, people, prev), pri: priorities(D.pri),
    weekend: weekend(D.today), score: scorecard(D.W.promises, prev), fb: facebook(), news: news(D.W),
  };
  const facts = {
    subject_hint: D.W.recent.length ? `Council this week: ${D.W.recent[0].headline}` : `This week in Squamish: ${people} people on what Squamish wants`,
    council_decided: D.W.recent.map((m) => ({ date: m.date, headline: m.headline })),
    coming_up: D.W.soon.map((m) => ({ date: m.date, what: m.type })).concat((D.W.dates || []).slice(0, 4).map((d) => ({ date: d.date, what: d.title }))),
    wants_people: people, wants_top: rows.filter((r) => r.kind === 'choice').sort((a, b) => b.total - a.total).slice(0, 3).map((r) => ({ q: r.title, top: r.opts[0].label, pct: r.opts[0].pct })),
    news: (D.W.news || []).filter((n) => Date.parse(n.date) > weekAgo).map((n) => n.head),
  };
  const w = await words(facts, weekCommits(), prev?.announced || ANNOUNCED_OCT30);
  subject = w.subject;
  const h1 = D.W.recent.length ? 'This week in Squamish' : 'Your weekly Squamish roundup';
  html = `<!doctype html><html><body style="margin:0;background:#f7f5ef;font:17px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#14211c">
<div style="max-width:600px;margin:0 auto;padding:24px 18px">
<p style="font-weight:700;color:#0f4c3a;margin:0 0 4px">Squamish Voters</p>
<h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 10px">${esc(h1)}</h1>
<p style="margin:0 0 18px">${esc(w.intro)}</p>
${[parts.council, parts.coming, parts.wants, parts.pri, parts.weekend, parts.score, parts.fb, parts.news, siteNew(w.site_new)].filter(Boolean).join('\n\n')}

<p style="margin:22px 0 6px">Know someone who'd like this? Forward it on. They can sign up at <a href="${ORIGIN}/" style="${S.a}">squamishvoters.com</a>. And just hit reply if you have a question or spot something we got wrong.</p>
<p style="font-size:14px;color:#5d6661;margin-top:26px">Squamish Voters is an independent, plain language guide to Squamish council, made by Jeff Kirdeikis in Squamish, British Columbia. You're getting this because you signed up at squamishvoters.com.
<a href="%%UNSUB%%" style="color:#5d6661">Unsubscribe</a>.</p>
</div></body></html>`;
  if (sql) await sql`INSERT INTO sv_digest_snap (data) VALUES (${JSON.stringify({ people, promises: D.W.promises, wants: Object.fromEntries(rows.map((r) => [r.id, r.total])), announced: [...(prev?.announced || ANNOUNCED_OCT30), ...w.site_new.map((x) => x.name)].slice(-40) })})`;
}

const dir = path.join(ROOT, 'data', 'digest'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${stamp}.html`), html.replaceAll('%%UNSUB%%', `${ORIGIN}/api/subscribe/?unsubscribe=PREVIEW`));
log('preview written', `data/digest/${stamp}.html`, '|', subject);

if (!REQUEST) process.exit(0);
const { RESEND_API_KEY, EMAIL_FROM } = process.env;
const TO = process.env.DIGEST_REVIEW_TO || 'jeffreykirdeikis@gmail.com';
if (!RESEND_API_KEY || !EMAIL_FROM || !sql) { log('no email service connected yet; preview only'); process.exit(0); }
const crypto = await import('node:crypto');
await sql`CREATE TABLE IF NOT EXISTS sv_digests (id text PRIMARY KEY, token text NOT NULL, subject text NOT NULL, html text NOT NULL,
  status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz, sent_at timestamptz,
  sent_count int, error text)`;
// A newer email replaces any older one still waiting, so an old link can't send a stale email.
await sql`UPDATE sv_digests SET status = 'replaced' WHERE status = 'pending'`;
const id = `${stamp}-${crypto.randomBytes(3).toString('hex')}`, token = crypto.randomBytes(18).toString('hex');
await sql`INSERT INTO sv_digests (id, token, subject, html) VALUES (${id}, ${token}, ${subject}, ${html})`;
const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_subscribers WHERE status = 'subscribed'`;
const link = `${ORIGIN}/api/digest-review/?id=${id}&t=${token}`;
const banner = `<div style="background:#fff4d6;border-bottom:2px solid #e6c766;padding:18px;font:16px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#14211c;text-align:center">
<p style="margin:0 0 4px;font-weight:700;font-size:18px">Approve this email before it goes out?</p>
<p style="margin:0 0 12px">Nothing has been sent to readers. Below is exactly what ${n} confirmed readers will get.</p>
<a href="${link}" style="background:#0f4c3a;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px;display:inline-block">Review and approve</a>
<p style="margin:10px 0 0;font-size:14px">Want changes? Reply to this email or tell Claude, and a new version will replace this one.</p></div>`;
const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: EMAIL_FROM, to: [TO], subject: `Approve? ${subject}`, html: html.replace(/<body([^>]*)>/, `<body$1>${banner}`).replaceAll('%%UNSUB%%', '#'),
    text: `Approve this email before it goes to ${n} readers:\n${link}\n\nSubject: ${subject}` }) });
if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
log(`approval request sent to ${TO} (${n} readers waiting)`);
