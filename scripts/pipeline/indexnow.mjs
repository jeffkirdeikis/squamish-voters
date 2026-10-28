// After a deploy: tell Bing (and the other IndexNow engines) which meeting pages changed, so new summaries get
// crawled the same day. Google doesn't use IndexNow; request indexing in Search Console for that.
// Usage: node scripts/pipeline/indexnow.mjs <commit that was live before this deploy>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const prev = process.argv[2];
const HOST = 'squamishvoters.com', KEY = '1b43e26e54325153101ab32f093e6363'; // key file: public/<KEY>.txt
if (!prev) process.exit(0);
let files;
try { files = execFileSync('git', ['diff', '--name-only', prev, 'HEAD'], { encoding: 'utf8' }).split('\n'); } catch { process.exit(0); }
const ids = files.map((f) => f.match(/^data\/meetings\/([^/]+)\.json$/)?.[1]).filter((id) => id && !id.startsWith('TEST-'));
if (!ids.length) process.exit(0);

// A summarised meeting also changes the hubs and every member's vote record.
const c = JSON.parse(fs.readFileSync('data/candidates.json', 'utf8'));
const members = (Array.isArray(c) ? c : c.candidates).map((x) => `/council/${x.slug}/`);
const urls = [...ids.map((id) => `/meetings/${id}/`), '/meetings/', '/this-week/', '/scorecard/', '/council/', '/', ...members].map((u) => `https://${HOST}${u}`);
const r = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
}).catch((e) => ({ status: e.message }));
console.log(`${new Date()} IndexNow ${r.status} for ${ids.join(', ')}`);
