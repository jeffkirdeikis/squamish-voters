// Share picture (1200x630) for a news story, drawn from news-og.html with headless Chrome into public/news/og/.
// Used by news.mjs when a story publishes, and by `node scripts/pipeline/news-og.mjs --all` to redraw every story.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, log, readJson } from './lib.mjs';

const OG_DIR = path.join(ROOT, 'public', 'news', 'og');
export const SEC_NAME = { vote: 'Elections', council: 'Council', money: 'Your money', community: 'Community', housing: 'Housing', recon: 'Reconciliation', move: 'Getting around', safety: 'Safety', weather: 'Weather' };
export function ogImage(story) {
  const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((c) => { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } });
  if (!chrome) { log('no Chrome; skipping share picture'); return null; }
  const tpl = fs.readFileSync(path.join(ROOT, 'scripts', 'pipeline', 'news-og.html'), 'utf8');
  const data = { head: story.head, sec: SEC_NAME[story.s] || 'News', s: story.s, date: new Date(story.date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }), big: story.visual?.big || '', small: story.visual?.small || '', photo: story.photo ? `file://${path.join(ROOT, 'public', story.photo.og || story.photo.file)}` : '' }; // og: a share-picture version that leaves room for the headline
  const tmp = path.join(OG_DIR, `.tmp-${story.slug}.html`);
  fs.writeFileSync(tmp, tpl.replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c')));
  const out = path.join(OG_DIR, `${story.slug}.png`);
  try {
    execFileSync(chrome, ['--headless=new', '--no-sandbox', `--user-data-dir=${path.join(OG_DIR, '.chrome-profile')}`, '--mute-audio', '--disable-gpu', '--hide-scrollbars', '--window-size=1200,630', '--virtual-time-budget=5000', `--screenshot=${out}`, `file://${tmp}`], { stdio: 'ignore', timeout: 60000 });
  } finally { fs.rmSync(tmp, { force: true }); }
  return fs.existsSync(out) ? `${story.slug}.png` : null;
}


if (process.argv.includes('--all')) {
  const news = readJson(path.join(ROOT, 'data', 'news.json'));
  for (const st of news.stories) { if (!st.og || !st.og.endsWith('.png')) continue; /* older stories have hand made .jpg pictures */ const f = ogImage(st); log(f ? `drew ${f}` : `FAILED ${st.slug}`); }
}
