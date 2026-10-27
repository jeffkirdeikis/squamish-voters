// A resident's ask at its own address, /wants/<r-id>/ (vercel.json rewrite), so a Facebook share shows that question.
//   GET ?id=<r-id> -> the /wants/ page opened on that ask, with its title, description and share picture (api/og.js).
// Starter asks have static pages built by build.mjs; this is only for asks residents added. Hidden or unknown -> /wants/.
import { neon } from '@neondatabase/serverless';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
const ORIGIN = 'https://squamishvoters.com';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async function handler(req, res) {
  const id = String(req.query.id || '').replace(/\/$/, '');
  const [a] = sql && /^r-[a-z0-9]{4,20}$/.test(id) ? await sql`SELECT id, title, why FROM sv_wants WHERE id = ${id} AND status = 'ok'`.catch(() => []) : [];
  if (!a) return res.redirect(302, '/wants/');
  const shell = await fetch(`${ORIGIN}/wants/`).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  if (!shell) return res.redirect(302, '/wants/');
  const q = /[?.!]$/.test(a.title) ? a.title : `${a.title}?`;
  const title = esc(`${q} | Squamish Voters`);
  const desc = esc(`${a.why ? `${a.why} ` : ''}A Squamish resident asked for this. Say yes, no or don’t mind, and see what Squamish said.`);
  const url = `${ORIGIN}/wants/${a.id}/`, img = `${ORIGIN}/api/og/?id=${a.id}&v=1`;
  const meta = (attr, key, val) => (html) => html.replace(new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(">)`), `$1${val}$2`);
  const html = [
    (h) => h.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`),
    meta('name', 'description', desc), meta('property', 'og:title', title), meta('property', 'og:description', desc),
    meta('property', 'og:url', url), meta('property', 'og:image', img), meta('name', 'twitter:image', img),
    meta('property', 'og:image:alt', esc(`What Squamish Wants: ${a.title}`)),
    (h) => h.replace(/(<link rel="canonical" href=")[^"]*(">)/, `$1${url}$2`),
    // src/wants.js opens and scrolls to the ask named in the page data's focus.
    (h) => h.replace('"focus":null', `"focus":${JSON.stringify(a.id)}`),
  ].reduce((h, f) => f(h), shell);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  return res.send(html);
}
