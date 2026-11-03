// Jeff's OK for a drafted news story (scripts/pipeline/news.mjs emails the link).
//   GET  ?id=&t=                     -> the story exactly as the site will show it, with Approve / Decline buttons on top
//   POST id, t, action, head, dek...  -> saved; .github/workflows/news.yml publishes approved drafts within about 10 minutes
// The link alone never approves anything: mail apps open links to scan them, so approving needs the button press (POST).
import { neon } from '@neondatabase/serverless';
import { toStory, storyPage } from './news-live.js';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const one = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s*[—–]\s*/g, ', ').trim().slice(0, n);

const shell = (title, body) => `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>
body{margin:0;background:#f7f5ef;color:#14211c;font:18px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.w{max-width:40rem;margin:0 auto;padding:1.2rem 1rem 3rem}h1{font:700 1.6rem/1.2 Georgia,serif;margin:.2rem 0 1rem}
.k{font:700 .75rem system-ui;letter-spacing:.1em;text-transform:uppercase;color:#0f4c3a}
label{display:block;font-weight:700;font-size:.9rem;margin:1rem 0 .3rem}input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.65rem .75rem;border:2px solid #d9d5c8;border-radius:10px;background:#fff;color:#14211c}
textarea{min-height:7.5rem;resize:vertical}.row{display:flex;gap:.6rem;flex-wrap:wrap}.row>*{flex:1 1 9rem}
.btns{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1.4rem}button{font:700 1.05rem system-ui;border:0;border-radius:12px;padding:.95rem 1.2rem;cursor:pointer;flex:1 1 12rem}
.go{background:#0f4c3a;color:#fff}.no{background:#efece3;color:#14211c}.src{font-size:.9rem;color:#5d6661}.src a{color:#0b5cab}
.note{background:#fff;border:1px solid #d9d5c8;border-radius:12px;padding:.8rem 1rem;font-size:.92rem;color:#3f4b45}
details{margin-top:1rem}summary{cursor:pointer;color:#0b5cab}pre{white-space:pre-wrap;font-size:.85rem;background:#fff;border:1px solid #d9d5c8;border-radius:10px;padding:.8rem;max-height:20rem;overflow:auto}
</style></head><body><div class="w"><p class="k">Squamish Voters News</p>${body}</div></body></html>`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!sql) return res.status(503).send(shell('Not ready', '<h1>The database is not connected.</h1>'));
  await sql`CREATE TABLE IF NOT EXISTS sv_news (
    id text PRIMARY KEY, source text NOT NULL, source_url text, title text, found_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL, token text, draft jsonb, item jsonb, decided_at timestamptz, published_at timestamptz)`;
  const b = req.method === 'POST' ? (typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body || {}) : {};
  const id = String(b.id || req.query.id || ''), t = String(b.t || req.query.t || '');
  const [r] = id && t ? await sql`SELECT * FROM sv_news WHERE id = ${id} AND token = ${t}` : [];
  if (!r) return res.status(404).send(shell('Link not found', '<h1>That link didn’t work</h1><p>It may be old or already used.</p>'));

  if (req.method === 'POST') {
    if (r.status !== 'pending') return res.send(shell('Already done', `<h1>Already ${esc(r.status)}</h1><p>Nothing changed.</p>`));
    if (b.action === 'skip') {
      await sql`UPDATE sv_news SET status = 'rejected', decided_at = now() WHERE id = ${id}`;
      return res.send(shell('Declined', '<h1>Declined</h1><p>This one won’t go on the site.</p>'));
    }
    // The preview has no edit fields, so a plain Approve keeps the draft exactly as shown.
    const edited = ['head', 'dek', 'take', 'body', 'visual_big', 'visual_small'].some((k) => k in b);
    const d = !edited ? { ...r.draft } : { ...r.draft, head: one(b.head, 140) || r.draft.head, dek: one(b.dek, 1200) || r.draft.dek, take: one(b.take, 400), body: b.body != null ? String(b.body).replace(/\r/g, '').replace(/\s*[—–]\s*/g, ', ').trim().slice(0, 8000) : r.draft.body || '', visual_big: one(b.visual_big, 24), visual_small: one(b.visual_small, 60), photo: b.no_photo ? null : r.draft.photo || null };
    await sql`UPDATE sv_news SET status = 'approved', decided_at = now(), draft = ${JSON.stringify(d)} WHERE id = ${id}`;
    return res.send(shell('Approved', `<h1>Approved</h1><p>“${esc(d.head)}” is on <a href="https://squamishvoters.com/news/">squamishvoters.com/news</a> now (it can take up to a minute to appear). Its share picture is added within about 20 minutes.</p>`));
  }

  const d = r.draft || {}, it = r.item || {};
  if (r.status !== 'pending') return res.send(shell('Already done', `<h1>${esc(d.head)}</h1><p class="note">This draft was already ${esc(r.status)}.</p>`));
  // The story as readers will see it, in the site's own page, with a bar on top to approve or decline.
  const pageShell = await fetch('https://squamishvoters.com/news/_live/').then((x) => (x.ok ? x.text() : '')).catch(() => '');
  const st = toStory(r);
  const bar = `<style>.rv-bar{position:sticky;top:0;z-index:999;background:#14211c;color:#fff;padding:.7rem 1rem;box-shadow:0 2px 12px rgba(0,0,0,.25)}
.rv-in{max-width:46rem;margin:0 auto;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}.rv-in p{margin:0;flex:1 1 14rem;font:600 .95rem/1.3 system-ui,sans-serif}.rv-in p small{display:block;font-weight:400;opacity:.75}
.rv-in form{display:flex;gap:.5rem;flex:1 1 16rem}.rv-in button{flex:1;font:700 1.05rem system-ui,sans-serif;border:0;border-radius:12px;padding:.85rem 1rem;cursor:pointer}
.rv-go{background:#3fbf7f;color:#08130e}.rv-no{background:#3a4640;color:#fff}</style>
<div class="rv-bar"><div class="rv-in"><p>Preview. Not on the site yet.<small>This is exactly how the story will look.</small></p>
<form method="post" action="/api/news-review/"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="t" value="${esc(t)}">
<button class="rv-go" name="action" value="approve">Approve</button><button class="rv-no" name="action" value="skip">Decline</button></form></div></div>`;
  if (pageShell && st.slug) return res.send(storyPage(st, pageShell, bar));
  // Fallback if the site shell can't be fetched: the plain story with the same two buttons.
  return res.send(shell('Approve this story?', `<h1>${esc(d.head)}</h1>${d.photo ? `<img src="${esc(d.photo.remote)}" alt="" style="width:100%;border-radius:10px">` : ''}<p>${esc(d.dek)}</p>
<form method="post" action="/api/news-review/"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="t" value="${esc(t)}">
<div class="btns"><button class="go" name="action" value="approve">Approve</button><button class="no" name="action" value="skip">Decline</button></div></form>`));
}
