// After a deploy: tell Bing (and the other IndexNow engines) every page whose content changed, so new summaries,
// news stories, budget and What Squamish Wants pages get crawled the same day. Bing feeds Microsoft Copilot.
// Google doesn't use IndexNow; request indexing in Search Console for that.
// Run by .github/workflows/indexnow.yml, which builds the site at the last commit it pinged for and at the commit now
// live, then compares the two builds page by page.
// Usage: node scripts/pipeline/indexnow.mjs <old dist folder> <new dist folder> [--dry]
// Never fails: any problem is logged and it exits 0.
import fs from 'node:fs';
import path from 'node:path';

const [oldDir, newDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const DRY = process.argv.includes('--dry');
const HOST = 'squamishvoters.com', KEY = '1b43e26e54325153101ab32f093e6363'; // key file: public/<KEY>.txt

// What changes without the page's content changing: the build commit, the cache fingerprints on our files, and the
// "updated" date on the District map data, which is stamped every day it is fetched.
const norm = (html) => html.replace(/<meta name="build" content="[^"]*">/, '').replace(/\?v=[0-9a-f]{6,}/g, '').replace(/(<p class="small muted hd-source">.*?)\(updated [^)]*\)/, '$1');
const pageHtml = (dir, u) => { try { return norm(fs.readFileSync(path.join(dir, u, 'index.html'), 'utf8')); } catch { return null; } };

try {
  if (!oldDir || !newDir) throw new Error('usage: indexnow.mjs <old dist> <new dist>');
  // Only pages search engines may list: the ones in the new sitemap.
  const urls = [...fs.readFileSync(path.join(newDir, 'sitemap.xml'), 'utf8').matchAll(/<loc>https:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
  const changed = urls.filter((u) => pageHtml(oldDir, u) !== pageHtml(newDir, u));
  if (!changed.length) { console.log('IndexNow: no page changed'); process.exit(0); }
  const urlList = changed.slice(0, 10000).map((u) => `https://${HOST}${u}`);
  console.log(`IndexNow: ${changed.length} changed page(s):\n${changed.join('\n')}`);
  if (DRY) process.exit(0);
  const r = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
    signal: AbortSignal.timeout(30000),
  });
  console.log(`${new Date().toISOString()} IndexNow answered ${r.status}`);
} catch (e) {
  console.log(`IndexNow skipped: ${e.message}`);
}
