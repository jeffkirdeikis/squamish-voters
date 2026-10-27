// Share picture for one What Squamish Wants question (1200 x 630), so a link to /wants/<id>/ on Facebook shows that question.
//   GET ?id=<ask id>  -> PNG: the question and its answer buttons. No results on it, since people answer before they see the crowd.
// Starter asks come from _wants.json; residents' asks (r-...) from sv_wants. An unknown or hidden id gets the general picture.
import { ImageResponse } from '@vercel/og';
import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
import SEED from './_wants.json' with { type: 'json' };

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
const font = (f) => fs.readFileSync(new globalThis.URL(`./_fonts/${f}`, import.meta.url));
const FONTS = [
  { name: 'Serif', data: font('Gelasio-Bold.ttf'), weight: 700, style: 'normal' },
  { name: 'Sans', data: font('Inter-SemiBold.ttf'), weight: 600, style: 'normal' },
  { name: 'Sans', data: font('Inter-ExtraBold.ttf'), weight: 800, style: 'normal' },
];
const GREEN = '#0f4c3a', YELLOW = '#f5b800';

// Tiny element helper: satori takes React-shaped objects, so no JSX build step is needed.
const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c !== null && c !== '') } });

async function findAsk(id) {
  const s = SEED.asks.find((a) => a.id === id);
  if (s) return { title: s.title, labels: s.labels || null };
  if (!sql || !/^r-[a-z0-9]{4,20}$/.test(id)) return null;
  const [r] = await sql`SELECT title FROM sv_wants WHERE id = ${id} AND status = 'ok'`.catch(() => []);
  return r ? { title: r.title, labels: null } : null;
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

export default async function handler(req, res) {
  const id = String(req.query.id || '').replace(/\/$/, '');
  const ask = id && (await findAsk(id));
  if (!ask) { res.setHeader('Cache-Control', 'public, max-age=3600'); return res.redirect(302, '/share/wants.png?v=1'); }
  const img = new ImageResponse(picture(ask), { width: 1200, height: 630, fonts: FONTS });
  res.setHeader('Content-Type', 'image/png');
  // Facebook keeps its own copy anyway; a day at the edge keeps a busy share cheap, and a corrected title shows by tomorrow.
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  return res.send(Buffer.from(await img.arrayBuffer()));
}
