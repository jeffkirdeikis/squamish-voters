// Share picture for one What Squamish Wants question (1200 x 630), so a link to /wants/<id>/ on Facebook shows that question.
//   GET ?id=<ask id>  -> PNG: the question and its answer buttons. No results on it, since people answer before they see the crowd.
//   GET ?id=<ask id>&said=<answer key>  -> the question, "I said Yes", and the live results, shared from /wants/<id>/said/<key>/.
//   GET ?top=1  -> the main /wants/ page: the 3 most wanted asks right now, each with its share of yes.
//   GET ?id=<ask id>&live=1  -> the question and the live results only (the sharer switched "Show my answer" off), from /wants/<id>/live/.
//   GET ?set=parents  -> a hand picked set of questions for one group (SETS in _wants-ask.js), from /wants/<set>/.
//   GET ?my=<id>.<key>,<id>.<key>  -> "My picks for Squamish": up to 5 of one person's answers and how many agree, from /wants/my/.
//   GET ?me=<id>.<key>,...&hd=<area>  -> "My Squamish": how many of their answers match the most picked one, their boldest take and
//                                     the neighbourhood that answers most like them, from /wants/me/.
// &n=<answers so far> only makes a new address (and so a fresh picture) each time the count moves; Facebook keeps a copy per address.
// Starter asks come from _wants.json; residents' asks (r-...) from sv_wants. An unknown or hidden id gets the general picture.
import { ImageResponse } from '@vercel/og';
import fs from 'node:fs';
import { findAsk, answerLabel, results, pctOf, topAsks, meSummary, HOOD_NAMES, SETS, setRows } from './_wants-ask.js';

const font = (f) => fs.readFileSync(new globalThis.URL(`./_fonts/${f}`, import.meta.url));
const FONTS = [
  { name: 'Serif', data: font('Gelasio-Bold.ttf'), weight: 700, style: 'normal' },
  { name: 'Sans', data: font('Inter-SemiBold.ttf'), weight: 600, style: 'normal' },
  { name: 'Sans', data: font('Inter-ExtraBold.ttf'), weight: 800, style: 'normal' },
];
const GREEN = '#0f4c3a', YELLOW = '#f5b800';

// Tiny element helper: satori takes React-shaped objects, so no JSX build step is needed.
const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c !== null && c !== '') } });

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const ANS = { y: { background: '#0b6b34', color: '#fff', border: '3px solid #0b6b34' }, n: { background: '#fff', color: '#a61b1b', border: '3px solid #e5b3b3' }, o: { background: YELLOW, color: '#1a1a1a', border: `3px solid ${YELLOW}` }, m: { background: '#fff', color: '#4a4a4a', border: '3px solid #d6d2c8' } };
const kindOf = (key, ask) => (key === 'm' ? 'm' : !ask.keys && !key.startsWith('x') ? key : 'o');
const footer = (left) => h('div', { marginTop: 'auto', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 26, fontWeight: 600 },
  h('div', { color: 'rgba(255,255,255,.8)', flex: 1, marginRight: 24 }, left), h('div', { fontWeight: 800, flexShrink: 0 }, 'squamishvoters.com/wants'));

// The live results as ranked bars: each answer with its full label and share, biggest first, the sharer's own answer in yellow.
// At most 4 rows fit, so a sharer's answer outside the top 4 takes the last row. Shares are of people who picked a side.
function resultsRows(r, mine) {
  let rows = [...r.options].sort((a, b) => b.n - a.n);
  if (rows.length > 4) { const own = rows.findIndex((o) => o.key === mine); rows = own > 3 ? [...rows.slice(0, 3), rows[own]] : rows.slice(0, 4); }
  const few = rows.length <= 3;
  return h('div', { flexDirection: 'column', marginTop: few ? 28 : 20 }, rows.map((o) => {
    const me = o.key === mine, p = pctOf(o.n, r.opinions), label = cut(o.label, 46);
    return h('div', { flexDirection: 'column', marginBottom: few ? 20 : 12 },
      h('div', { justifyContent: 'space-between', alignItems: 'center', fontSize: few ? (label.length > 30 ? 30 : 34) : 28, fontWeight: 800 },
        h('div', { alignItems: 'center', flex: 1, marginRight: 20 }, label,
          me ? h('div', { marginLeft: 16, fontSize: 18, letterSpacing: 2, background: YELLOW, color: '#1a1a1a', padding: '5px 12px', borderRadius: 8, flexShrink: 0 }, 'MY ANSWER') : null),
        h('div', { color: me ? YELLOW : '#fff', flexShrink: 0 }, `${p}%`)),
      h('div', { height: few ? 26 : 20, borderRadius: 13, background: 'rgba(255,255,255,.14)', marginTop: few ? 10 : 6 },
        p ? h('div', { width: `${p}%`, height: '100%', borderRadius: 13, background: me ? YELLOW : 'rgba(255,255,255,.75)' }) : null));
  }));
}

// One person's answer: the question, then how Squamish has answered so far with their answer marked. Without results yet,
// "I said" and their answer instead. With no answer (the sharer kept it to themselves), just the question and the results.
function saidPicture(ask, label, kind, r, key) {
  const q = /[?.!]$/.test(ask.title) ? ask.title : `${ask.title}?`;
  if (r && r.total) {
    const many = r.options.length > 3, who = `${r.total} neighbour${r.total === 1 ? '' : 's'} answered.`;
    const size = (q.length <= 45 ? 58 : q.length <= 75 ? 54 : q.length <= 105 ? 44 : 38) - (many ? 6 : 0);
    return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: GREEN, padding: '44px 64px 40px', color: '#fff', fontFamily: 'Sans' },
      h('div', { fontSize: 22, fontWeight: 800, color: YELLOW, letterSpacing: 3 }, 'WHAT SQUAMISH WANTS'),
      h('div', { fontFamily: 'Serif', fontSize: size, lineHeight: 1.1, marginTop: 12, maxWidth: 1072 }, q),
      resultsRows(r, key),
      footer(kind === 'm' ? `${who} I said I don’t mind.` : `${who} Where do you stand?`));
  }
  const size = q.length <= 45 ? 72 : q.length <= 75 ? 62 : q.length <= 105 ? 52 : 44;
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: GREEN, padding: '56px 72px', color: '#fff', fontFamily: 'Sans' },
    h('div', { fontSize: 22, fontWeight: 800, color: YELLOW, letterSpacing: 3 }, 'WHAT SQUAMISH WANTS'),
    h('div', { fontFamily: 'Serif', fontSize: size, lineHeight: 1.12, marginTop: 30, maxWidth: 1072 }, q),
    label ? h('div', { alignItems: 'center', marginTop: 34 },
      h('div', { fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,.8)', marginRight: 16 }, 'I said'),
      h('div', { alignItems: 'center', padding: '14px 34px', borderRadius: 14, fontWeight: 800, fontSize: label.length > 24 ? 28 : 40, ...ANS[kind] }, cut(label, 44))) : null,
    footer(!label ? 'Where do you stand? Answer and see the latest' : 'What do you say? Answer, then see the results'));
}

// Up to 5 of one person's answers, each as a coloured answer and the question beside it.
function picksPicture(rows) {
  const big = rows.length <= 3;
  const line = (r) => h('div', { alignItems: 'center', marginBottom: big ? 20 : 11 },
    h('div', { width: 270, flexShrink: 0, justifyContent: 'center', textAlign: 'center', padding: '7px 12px', borderRadius: 10, fontWeight: 800, fontSize: r.label.length > 16 ? 19 : 25, lineHeight: 1.15, marginRight: 22, ...ANS[r.kind] }, cut(r.label, 40)),
    h('div', { fontSize: big ? 32 : 27, fontWeight: 600, lineHeight: 1.2, flex: 1 }, cut(/[?.!]$/.test(r.title) ? r.title : `${r.title}?`, big ? 90 : 64)),
    r.agree === null ? null : h('div', { flexShrink: 0, marginLeft: 20, flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1 },
      h('div', { fontSize: big ? 36 : 30, fontWeight: 800, color: YELLOW }, `${r.agree}%`), h('div', { fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,.75)', marginTop: 4 }, 'agree')));
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: GREEN, padding: '44px 64px 46px', color: '#fff', fontFamily: 'Sans' },
    h('div', { fontSize: 22, fontWeight: 800, color: YELLOW, letterSpacing: 3 }, 'WHAT SQUAMISH WANTS'),
    h('div', { fontFamily: 'Serif', fontSize: 50, marginTop: 8, marginBottom: big ? 30 : 18 }, 'My picks for Squamish'),
    h('div', { flexDirection: 'column' }, rows.map(line)),
    footer('What do you want? Answer and see the results'));
}

// My Squamish: "I agree with Squamish on 17 of 22", then the boldest take and the neighbourhood most like them.
function mePicture(m, hood) {
  const box = (k, v, sub) => h('div', { flexDirection: 'column', flex: 1, background: 'rgba(255,255,255,.1)', borderRadius: 18, padding: '20px 24px', marginRight: 18 },
    h('div', { fontSize: 20, fontWeight: 800, letterSpacing: 2, color: 'rgba(255,255,255,.7)' }, k),
    h('div', { fontSize: v.length > 40 ? 26 : 31, fontWeight: 800, lineHeight: 1.2, marginTop: 8 }, v),
    sub ? h('div', { fontSize: 22, fontWeight: 600, color: YELLOW, marginTop: 8 }, sub) : null);
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: GREEN, padding: '44px 64px 40px', color: '#fff', fontFamily: 'Sans' },
    h('div', { fontSize: 22, fontWeight: 800, color: YELLOW, letterSpacing: 3 }, 'MY SQUAMISH'),
    h('div', { fontFamily: 'Serif', fontSize: 74, lineHeight: 1.05, marginTop: 14 }, 'I agree with Squamish on'),
    h('div', { fontFamily: 'Serif', fontSize: 74, lineHeight: 1.05, color: YELLOW }, `${m.agree} of ${m.of}`),
    h('div', { marginTop: 34, marginRight: -18 },
      m.bold ? box('BOLDEST TAKE', cut(m.bold.yn ? `${m.bold.label}: ${m.bold.title}` : `${/[?.!]$/.test(m.bold.title) ? m.bold.title : `${m.bold.title}?`} “${m.bold.label}”`, 80), `Only ${m.bold.share}% agree`) : box('BOLDEST TAKE', 'With the crowd on every one', null),
      hood ? box('ANSWERS MOST LIKE', hood, null) : null),
    footer('What Squamish Wants. Where do you land?'));
}

async function picks(spec) {
  const pairs = String(spec).split(',').slice(0, 5).map((p) => p.split('.')).filter(([id, k]) => /^[a-z0-9-]{2,40}$/.test(id || '') && /^[a-z0-9]{1,12}$/.test(k || ''));
  const rows = await Promise.all(pairs.map(async ([id, key]) => {
    const ask = await findAsk(id), label = ask && (await answerLabel(id, ask, key));
    if (!label) return null;
    const r = await results(id, ask), same = r && (r.options.find((o) => o.key === key) || { n: 0 }).n;
    return { title: ask.title, label, kind: kindOf(key, ask), agree: r && r.opinions && key !== 'm' ? pctOf(same, r.opinions) : null };
  }));
  return rows.filter(Boolean);
}

function picture({ title, labels }) {
  const q = /[?.!]$/.test(title) ? title : `${title}?`;
  const size = q.length <= 45 ? 72 : q.length <= 75 ? 62 : q.length <= 105 ? 52 : 44;
  const pill = (text, kind) => h('div', {
    alignItems: 'center', justifyContent: 'center', padding: labels ? '14px 24px' : '16px 40px', borderRadius: 14, fontFamily: 'Sans', fontWeight: 800,
    fontSize: labels ? 26 : 32, marginRight: 14, marginBottom: 14,
    ...(kind === 'y' ? { background: '#0b6b34', color: '#fff', border: '3px solid #0b6b34' }
      : kind === 'n' ? { background: '#fff', color: '#a61b1b', border: '3px solid #e5b3b3' }
      : kind === 'm' ? { background: '#fff', color: '#4a4a4a', border: '3px solid #d6d2c8' }
      : { background: '#fff', color: GREEN, border: '3px solid #fff' }),
  }, text);
  const answers = labels
    ? [...labels.slice(0, 4).map((l) => pill(l, 'o')), pill('Don’t mind', 'm')]
    : [pill('Yes', 'y'), pill('No', 'n'), pill('Don’t mind', 'm')];
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: GREEN, padding: '56px 72px', color: '#fff', fontFamily: 'Sans' },
    h('div', { fontSize: 24, fontWeight: 800, color: YELLOW, letterSpacing: 3 }, 'WHAT SQUAMISH WANTS'),
    h('div', { fontSize: 24, fontWeight: 600, color: 'rgba(255,255,255,.75)', marginTop: 28 }, labels ? 'Pick your answer' : 'Do you want this?'),
    h('div', { fontFamily: 'Serif', fontSize: size, lineHeight: 1.12, marginTop: 10, maxWidth: 1050 }, q),
    h('div', { flexWrap: 'wrap', marginTop: 36 }, answers),
    h('div', { marginTop: 'auto', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 26, fontWeight: 600 },
      h('div', { color: 'rgba(255,255,255,.8)' }, 'Answer, then see what Squamish said'),
      h('div', { fontWeight: 800 }, 'squamishvoters.com/wants')));
}

// The main page: what Squamish wants most right now, three asks with their share of yes as a bar.
function topPicture(rows) {
  const line = (r) => h('div', { flexDirection: 'column', marginBottom: 22 },
    h('div', { justifyContent: 'space-between', alignItems: 'flex-end' },
      h('div', { fontSize: 31, fontWeight: 600, lineHeight: 1.2, flex: 1, marginRight: 24 }, cut(r.title, 92)),
      h('div', { fontSize: 36, fontWeight: 800, color: YELLOW, flexShrink: 0 }, `${r.pct}% yes`)),
    h('div', { height: 14, borderRadius: 7, background: 'rgba(255,255,255,.18)', marginTop: 10, overflow: 'hidden' },
      h('div', { width: `${r.pct}%`, height: '100%', background: '#3fb36b' })));
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: GREEN, padding: '44px 64px 40px', color: '#fff', fontFamily: 'Sans' },
    h('div', { fontSize: 22, fontWeight: 800, color: YELLOW, letterSpacing: 3 }, 'WHAT SQUAMISH WANTS'),
    h('div', { fontFamily: 'Serif', fontSize: 50, marginTop: 8, marginBottom: 28 }, 'Most wanted right now'),
    h('div', { flexDirection: 'column' }, rows.map(line)),
    footer('Say yes, no or don’t mind, and add your own'));
}

// A set for one group: its own heading, then each question with where Squamish stands, as in the main page's picture.
function setPicture(set, rows) {
  const line = (r) => h('div', { flexDirection: 'column', marginBottom: 20 },
    h('div', { justifyContent: 'space-between', alignItems: 'flex-end' },
      h('div', { fontSize: 29, fontWeight: 600, lineHeight: 1.2, flex: 1, marginRight: 24 }, cut(r.title, 80)),
      h('div', { fontSize: 32, fontWeight: 800, color: YELLOW, flexShrink: 0 }, cut(r.line, 22))),
    h('div', { height: 12, borderRadius: 6, background: 'rgba(255,255,255,.18)', marginTop: 8, overflow: 'hidden' },
      h('div', { width: `${r.pct}%`, height: '100%', background: '#3fb36b' })));
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: GREEN, padding: '40px 64px 38px', color: '#fff', fontFamily: 'Sans' },
    h('div', { fontSize: 22, fontWeight: 800, color: YELLOW, letterSpacing: 3 }, set.kicker),
    h('div', { fontFamily: 'Serif', fontSize: 50, marginTop: 6, marginBottom: 24 }, set.head),
    h('div', { flexDirection: 'column' }, rows.map(line)),
    footer('Say yes, no or don’t mind, and add your own'));
}

export default async function handler(req, res) {
  const id = String(req.query.id || '').replace(/\/$/, ''), said = String(req.query.said || '');
  let el = null;
  if (req.query.set && SETS[req.query.set]) { const rows = await setRows(req.query.set).catch(() => []); if (rows.length) el = setPicture(SETS[req.query.set], rows); }
  else if (req.query.top) { const rows = await topAsks(3).catch(() => []); if (rows.length) el = topPicture(rows); }
  else if (req.query.me) { const m = await meSummary(req.query.me).catch(() => null); if (m) el = mePicture(m, HOOD_NAMES[String(req.query.hd || '')] || null); }
  else if (req.query.my) { const rows = await picks(req.query.my); if (rows.length) el = picksPicture(rows); }
  else {
    const ask = id && (await findAsk(id));
    const label = ask && said && /^[a-z0-9]{1,12}$/.test(said) && (await answerLabel(id, ask, said));
    const r = ask && (label || req.query.live) ? await results(id, ask).catch(() => null) : null;
    // Results only: the same picture without "I said", when the sharer keeps their answer to themselves.
    if (ask) el = label ? saidPicture(ask, label, kindOf(said, ask), r, said) : r && r.total ? saidPicture(ask, null, null, r) : picture(ask);
  }
  if (!el) { res.setHeader('Cache-Control', 'public, max-age=3600'); return res.redirect(302, '/share/wants.png?v=1'); }
  const img = new ImageResponse(el, { width: 1200, height: 630, fonts: FONTS });
  res.setHeader('Content-Type', 'image/png');
  // Pictures with results change as people answer: an address with &n= is one moment's count and can stay a day at the edge;
  // without it, ten minutes. The plain question picture has no numbers and keeps a day.
  const live = said || req.query.my || req.query.me || req.query.live || req.query.top || req.query.set;
  res.setHeader('Cache-Control', live && !req.query.n ? 'public, max-age=300, s-maxage=600' : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  return res.send(Buffer.from(await img.arrayBuffer()));
}
