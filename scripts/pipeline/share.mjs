// A share picture for every summarised meeting (public/share/<id>.png, 1200x630): what Facebook and texts show
// when someone shares the meeting's page. Drawn with headless Chrome, so it runs on the Mac and on GitHub.
//   node scripts/pipeline/share.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, RAW_DIR, loadMeetings, log } from './lib.mjs';

const OUT = path.join(ROOT, 'public', 'share');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

for (const m of loadMeetings().filter((x) => x.summary && !fs.existsSync(path.join(OUT, `${x.id}.png`)))) {
  if (!CHROME) { log('no Chrome found; share images skipped'); break; }
  const pts = (m.summary.key_points || []).slice(0, 3);
  const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:630px}body{background:#0f4c3a;color:#fff;font-family:-apple-system,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;padding:54px 64px;box-sizing:border-box}
  .top{display:flex;align-items:center;gap:16px;font-weight:700;font-size:26px;opacity:.95}.top svg{width:46px;height:46px}
  .when{margin-top:30px;font-size:26px;color:#ffd166;font-weight:700}h1{font-family:Georgia,serif;font-size:${m.summary.headline.length > 120 ? 38 : 46}px;line-height:1.18;margin:12px 0 18px}
  ul{margin:0;padding-left:28px;font-size:24px;line-height:1.35}li{margin:6px 0}.foot{margin-top:auto;font-size:24px;font-weight:700;color:#ffd166}</style>
  <div class="top"><svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#ffb703"/><path d="M5 30 L15 12 L21 22 L26 15 L35 30 Z" fill="#0f4c3a"/><path d="M12.5 25l3.5 3.5 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>Squamish Voters · council, in plain words</div>
  <div class="when">${esc(day(m.date))}</div><h1>${esc(m.summary.headline)}</h1>
  <ul>${pts.map((p) => `<li>${esc(p.length > 110 ? p.slice(0, 107) + '…' : p)}</li>`).join('')}</ul>
  <div class="foot">Who voted which way: squamishvoters.com</div>`;
  const tmp = path.join(RAW_DIR, `.share-${m.id}.html`);
  fs.writeFileSync(tmp, html);
  execFileSync(CHROME, ['--headless=new', '--mute-audio', '--disable-gpu', '--hide-scrollbars', '--no-sandbox', '--window-size=1200,630', `--screenshot=${path.join(OUT, `${m.id}.png`)}`, `file://${tmp}`], { stdio: 'ignore' });
  fs.rmSync(tmp, { force: true });
  log('share image', m.id);
}
