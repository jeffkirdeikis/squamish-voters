// Small copies of the news pictures for lists (the home page rows show them at 120 x 80, the lead at about 400 wide).
// The originals are 1200 wide and 200 to 400 KB each; these are 240 and 800 wide JPEGs of about 10 to 60 KB.
//   node scripts/news-thumbs.mjs      writes public/news/thumbs/<w>/<folder>-<name>.jpg for any picture without one
// Uses sips on a Mac and ImageMagick (convert) on Linux (GitHub's runners have it). With neither, it does nothing,
// and build.mjs falls back to the full size picture, so a missing thumbnail never breaks a page.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const NEWS = path.join(ROOT, 'public', 'news');
export const THUMB_WIDTHS = [240, 800];
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
const tool = process.platform === 'darwin' && has('sips') ? 'sips' : has('convert') ? 'convert' : null;

let made = 0;
if (!tool) console.log('news thumbs: no sips or convert here; skipped');
else for (const dir of ['photos', 'og', 'img']) {
  const src = path.join(NEWS, dir);
  if (!fs.existsSync(src)) continue;
  for (const f of fs.readdirSync(src).filter((x) => /\.(jpe?g|png)$/i.test(x))) {
    for (const w of THUMB_WIDTHS) {
      const out = path.join(NEWS, 'thumbs', String(w), `${dir}-${f.replace(/\.(png|jpeg)$/i, '.jpg')}`);
      if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(path.join(src, f)).mtimeMs) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      if (tool === 'sips') execFileSync('sips', ['--resampleWidth', String(w), '-s', 'format', 'jpeg', '-s', 'formatOptions', '72', path.join(src, f), '--out', out], { stdio: 'ignore' });
      else execFileSync('convert', [path.join(src, f), '-resize', `${w}x`, '-strip', '-quality', '72', out], { stdio: 'ignore' });
      made++;
    }
  }
}
if (tool) console.log(`news thumbs: ${made} made`);
