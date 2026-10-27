// Share picture for one What Squamish Wants question (1200 x 630), so a link to /wants/<id>/ on Facebook shows that question.
//   GET ?id=<ask id>  -> PNG: the question and its answer buttons. No results on it, since people answer before they see the crowd.
//   GET ?id=<ask id>&said=<answer key>  -> the question, "I said Yes", and the live results, shared from /wants/<id>/said/<key>/.
//   GET ?top=1  -> the main /wants/ page: the 3 most wanted asks right now, each with its share of yes.
//   GET ?id=<ask id>&live=1  -> the question and the live results only (the sharer switched "Show my answer" off), from /wants/<id>/live/.
//   GET ?my=<id>.<key>,<id>.<key>  -> "My picks for Squamish": up to 5 of one person's answers and how many agree, from /wants/my/.
// &n=<answers so far> only makes a new address (and so a fresh picture) each time the count moves; Facebook keeps a copy per address.
// Starter asks come from _wants.json; residents' asks (r-...) from sv_wants. An unknown or hidden id gets the general picture.
import { ImageResponse } from '@vercel/og';
import fs from 'node:fs';
import { findAsk, answerLabel, results, pctOf, standing, topAsks } from './_wants-ask.js';

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

// Bar colours: the site's yes / no / don't mind, and its eight option colours (--wa-o1 to --wa-o8) for several answers.
const SEG = { y: '#0b6b2e', n: '#a32020', m: '#c9c6b9' }, OPT = ['#1c5cab', '#c2571c', '#6a4c9c', '#2a7f74', '#8a6d1f', '#b03a63', '#3f7d2e', '#4d5b6b'];

// The live results on a white panel: where Squamish stands, the bar, and the counts behind it.
function resultsPanel(r) {
  const segs = r.multi ? r.options.map((o, i) => ({ ...o, color: OPT[i % 8] })) : [{ ...r.options[0], color: SEG.y }, { key: 'm', n: 0, color: SEG.m }, { ...r.options[1], color: SEG.n }];
  if (!r.multi) segs[1].n = r.m; else segs.push({ key: 'm', label: 'Don’t mind', n: r.m, color: SEG.m });
  const legend = r.multi
    ? [...segs].filter((g) => g.key !== 'm' && g.n).sort((a, b) => b.n - a.n).slice(0, 3).map((g) => h('div', { alignItems: 'center', marginRight: 28, whiteSpace: 'nowrap' },
      h('div', { width: 16, height: 16, borderRadius: 8, background: g.color, marginRight: 8, flexShrink: 0 }), `${pctOf(g.n, r.opinions)}% ${cut(g.label, 20)}`))
    : [h('div', {}, `${r.options[0].n} yes · ${r.options[1].n} no · ${r.m} don’t mind`)];
  return h('div', { flexDirection: 'column', background: '#fff', color: '#1a1a1a', borderRadius: 20, padding: '22px 30px 20px', marginTop: 24 },
    h('div', { justifyContent: 'space-between', alignItems: 'baseline' },
      h('div', { fontFamily: 'Serif', fontSize: 40, color: GREEN }, cut(standing(r) || 'No one has picked a side yet', 52)),
      h('div', { fontSize: 24, fontWeight: 600, color: '#666', flexShrink: 0, marginLeft: 20 }, `${r.total} answer${r.total === 1 ? '' : 's'}`)),
    h('div', { height: 26, borderRadius: 13, overflow: 'hidden', background: '#ece9df', marginTop: 12 },
      segs.filter((g) => g.n).map((g) => h('div', { width: `${(100 * g.n) / r.total}%`, height: '100%', background: g.color }))),
    h('div', { fontSize: 22, fontWeight: 600, color: '#555', marginTop: 12 }, legend));
}

// One person's answer: the question, "I said" and their answer, then how Squamish has answered so far.
function saidPicture(ask, label, kind, r) {
  const q = /[?.!]$/.test(ask.title) ? ask.title : `${ask.title}?`;
  const size = r ? (q.length <= 45 ? 56 : q.length <= 75 ? 48 : q.length <= 105 ? 41 : 35) : (q.length <= 45 ? 72 : q.length <= 75 ? 62 : q.length <= 105 ? 52 : 44);
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: GREEN, padding: r ? '44px 64px 40px' : '56px 72px', color: '#fff', fontFamily: 'Sans' },
    h('div', { fontSize: 22, fontWeight: 800, color: YELLOW, letterSpacing: 3 }, 'WHAT SQUAMISH WANTS'),
    h('div', { fontFamily: 'Serif', fontSize: size, lineHeight: 1.12, marginTop: r ? 16 : 30, maxWidth: 1072 }, q),
    label ? h('div', { alignItems: 'center', marginTop: r ? 22 : 34 },
      h('div', { fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,.8)', marginRight: 16 }, 'I said'),
      h('div', { alignItems: 'center', padding: r ? '10px 28px' : '14px 34px', borderRadius: 14, fontWeight: 800, fontSize: label.length > 24 ? 28 : r ? 34 : 40, ...ANS[kind] }, cut(label, 44))) : null,
    r ? resultsPanel(r) : null,
    footer(!label ? 'Where do you stand? Answer and see the latest' : r ? 'What do you say? Answer and see the latest' : 'What do you say? Answer, then see the results'));
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
      h('div', { fontSize: 31, fontWeight: 600, lineHeight: 1.2, flex: 1, marginRight: 24 }, cut(r.title, 70)),
      h('div', { fontSize: 36, fontWeight: 800, color: YELLOW, flexShrink: 0 }, `${r.pct}% yes`)),
    h('div', { height: 14, borderRadius: 7, background: 'rgba(255,255,255,.18)', marginTop: 10, overflow: 'hidden' },
      h('div', { width: `${r.pct}%`, height: '100%', background: '#3fb36b' })));
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: GREEN, padding: '44px 64px 40px', color: '#fff', fontFamily: 'Sans' },
    h('div', { fontSize: 22, fontWeight: 800, color: YELLOW, letterSpacing: 3 }, 'WHAT SQUAMISH WANTS'),
    h('div', { fontFamily: 'Serif', fontSize: 50, marginTop: 8, marginBottom: 28 }, 'Most wanted right now'),
    h('div', { flexDirection: 'column' }, rows.map(line)),
    footer('Say yes, no or don’t mind, and add your own'));
}

export default async function handler(req, res) {
  const id = String(req.query.id || '').replace(/\/$/, ''), said = String(req.query.said || '');
  let el = null;
  if (req.query.top) { const rows = await topAsks(3).catch(() => []); if (rows.length) el = topPicture(rows); }
  else if (req.query.my) { const rows = await picks(req.query.my); if (rows.length) el = picksPicture(rows); }
  else {
    const ask = id && (await findAsk(id));
    const label = ask && said && /^[a-z0-9]{1,12}$/.test(said) && (await answerLabel(id, ask, said));
    const r = ask && (label || req.query.live) ? await results(id, ask).catch(() => null) : null;
    // Results only: the same picture without "I said", when the sharer keeps their answer to themselves.
    if (ask) el = label ? saidPicture(ask, label, kindOf(said, ask), r) : r && r.total ? saidPicture(ask, null, null, r) : picture(ask);
  }
  if (!el) { res.setHeader('Cache-Control', 'public, max-age=3600'); return res.redirect(302, '/share/wants.png?v=1'); }
  const img = new ImageResponse(el, { width: 1200, height: 630, fonts: FONTS });
  res.setHeader('Content-Type', 'image/png');
  // Pictures with results change as people answer: an address with &n= is one moment's count and can stay a day at the edge;
  // without it, ten minutes. The plain question picture has no numbers and keeps a day.
  const live = said || req.query.my || req.query.live || req.query.top;
  res.setHeader('Cache-Control', live && !req.query.n ? 'public, max-age=300, s-maxage=600' : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  return res.send(Buffer.from(await img.arrayBuffer()));
}
