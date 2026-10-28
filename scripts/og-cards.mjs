// Share pictures drawn at build time (1200 x 630 PNG), so a council member's page or an upcoming meeting shows its own
// picture on Facebook and in texts instead of the general site logo. Same drawing kit as the /wants/ pictures
// (api/og.js: @vercel/og, which is satori + resvg), but run once per build here instead of on every request.
// build.mjs collects the cards and calls renderCards() at the end. A card that fails to draw is skipped (the page then
// keeps the general picture), so this can never fail the build.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const font = (f) => fs.readFileSync(path.join(ROOT, 'api', '_fonts', f));
const GREEN = '#0f4c3a', YELLOW = '#f5b800';
const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c !== null && c !== '' && c !== undefined) } });
const img = (src, style) => ({ type: 'img', props: { src, style } });
const dataUrl = (file) => {
  try { const b = fs.readFileSync(file); return `data:image/${/\.png$/i.test(file) ? 'png' : 'jpeg'};base64,${b.toString('base64')}`; } catch { return null; }
};

// card: { file (path under dist), kicker, title, sub, stats: [[number, label]], photo (path under public), foot }
function draw(card) {
  const photo = card.photo && dataUrl(path.join(ROOT, 'public', card.photo));
  const size = card.title.length <= 18 ? 84 : card.title.length <= 30 ? 68 : 54;
  return h('div', { width: '100%', height: '100%', flexDirection: 'column', background: GREEN, padding: '48px 64px 42px', color: '#fff', fontFamily: 'Sans' },
    h('div', { fontSize: 24, fontWeight: 800, color: YELLOW, letterSpacing: 3 }, card.kicker),
    h('div', { alignItems: 'center', marginTop: 18 },
      photo ? img(photo, { width: 190, height: 190, borderRadius: 95, objectFit: 'cover', border: `6px solid ${YELLOW}`, marginRight: 40 }) : null,
      h('div', { flexDirection: 'column', flex: 1 },
        h('div', { fontFamily: 'Serif', fontSize: size, lineHeight: 1.05 }, card.title),
        card.sub ? h('div', { fontSize: 32, fontWeight: 600, marginTop: 14, color: 'rgba(255,255,255,.88)' }, card.sub) : null)),
    card.stats && card.stats.length ? h('div', { marginTop: 40 }, card.stats.map(([n, label]) => h('div', { flexDirection: 'column', marginRight: 56 },
      h('div', { fontSize: 64, fontWeight: 800, color: YELLOW, lineHeight: 1 }, String(n)),
      h('div', { fontSize: 24, fontWeight: 600, marginTop: 6, color: 'rgba(255,255,255,.85)' }, label)))) : null,
    h('div', { marginTop: 'auto', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 26, fontWeight: 600 },
      h('div', { color: 'rgba(255,255,255,.8)', flex: 1, marginRight: 24 }, card.foot || 'Squamish council, in plain words'),
      h('div', { fontWeight: 800, flexShrink: 0 }, 'squamishvoters.com')));
}

export async function renderCards(cards, distDir) {
  if (!cards.length) return 0;
  let ImageResponse;
  try { ({ ImageResponse } = await import('@vercel/og')); } catch (e) { console.log(`share cards skipped: ${e.message}`); return 0; }
  const fonts = [
    { name: 'Serif', data: font('Gelasio-Bold.ttf'), weight: 700, style: 'normal' },
    { name: 'Sans', data: font('Inter-SemiBold.ttf'), weight: 600, style: 'normal' },
    { name: 'Sans', data: font('Inter-ExtraBold.ttf'), weight: 800, style: 'normal' },
  ];
  let n = 0;
  for (const card of cards) {
    try {
      const out = path.join(distDir, card.file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const res = new ImageResponse(draw(card), { width: 1200, height: 630, fonts });
      fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      n++;
    } catch (e) { console.log(`share card ${card.file} skipped: ${e.message}`); }
  }
  return n;
}
