// What Squamish Wants pages that need the database or a person's answers, so a Facebook share shows the right title and picture.
//   GET ?id=<r-id>               -> a resident's ask at /wants/<r-id>/ (starter asks have static pages built by build.mjs).
//   GET ?id=<id>&said=<key>      -> /wants/<id>/said/<key>/: "I said Yes" on one question, opened on that question.
//   GET ?mine=1&a=<id>.<key>,... -> /wants/my/?a=...: "My picks for Squamish", up to 5 answers, opened on the full list.
// All of them are the static /wants/ page (or the ask's own page) with the title, description, share picture and the
// page data's focus swapped in. Hidden or unknown -> /wants/.
import { findAsk, answerLabel } from './_wants-ask.js';

const ORIGIN = 'https://squamishvoters.com';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ask = (title) => (/[?.!]$/.test(title) ? title : `${title}?`);

async function describe(q) {
  if (q.mine) {
    const spec = String(q.a || '').split(',').slice(0, 5).filter((p) => /^[a-z0-9-]{2,40}\.[a-z0-9]{1,12}$/.test(p)).join(',');
    if (!spec) return null;
    return {
      shell: '/wants/', focus: null, said: null, url: `${ORIGIN}/wants/my/?a=${spec}`, canonical: `${ORIGIN}/wants/`,
      title: 'My picks for Squamish | What Squamish Wants', alt: 'My picks for Squamish',
      desc: 'Here’s what I want for Squamish. Say yes, no or don’t mind to the same questions and see what everyone said.',
      img: `${ORIGIN}/api/og/?my=${spec}&v=1`,
    };
  }
  const id = String(q.id || '').replace(/\/$/, ''), key = String(q.said || '');
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return null;
  const a = await findAsk(id);
  if (!a || (!key && !id.startsWith('r-'))) return null;
  const label = key && /^[a-z0-9]{1,12}$/.test(key) ? await answerLabel(id, a, key) : null;
  const shell = id.startsWith('r-') ? '/wants/' : `/wants/${id}/`;
  if (label) return {
    shell, focus: id, said: { id, label }, url: `${ORIGIN}/wants/${id}/said/${key}/`, canonical: `${ORIGIN}/wants/${id}/`,
    title: `I said “${label}”: ${ask(a.title)}`, alt: `What Squamish Wants: ${a.title}. I said ${label}.`,
    desc: 'What do you say? Answer, then see what Squamish said.', img: `${ORIGIN}/api/og/?id=${id}&said=${key}&v=1`,
  };
  if (!id.startsWith('r-')) return null;
  return {
    shell, focus: id, said: null, url: `${ORIGIN}/wants/${id}/`, canonical: `${ORIGIN}/wants/${id}/`,
    title: `${ask(a.title)} | Squamish Voters`, alt: `What Squamish Wants: ${a.title}`,
    desc: 'A Squamish resident asked for this. Say yes, no or don’t mind, and see what Squamish said.', img: `${ORIGIN}/api/og/?id=${id}&v=1`,
  };
}

export default async function handler(req, res) {
  const p = await describe(req.query).catch(() => null);
  if (!p) return res.redirect(302, '/wants/');
  const shell = await fetch(`${ORIGIN}${p.shell}`).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  if (!shell) return res.redirect(302, '/wants/');
  const title = esc(p.title), desc = esc(p.desc);
  const meta = (attr, key, val) => (html) => html.replace(new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(">)`), `$1${val}$2`);
  const html = [
    (h) => h.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`),
    meta('name', 'description', desc), meta('property', 'og:title', title), meta('property', 'og:description', desc),
    // og:url is this address, not the plain question, or Facebook would fetch the plain question's picture instead.
    meta('property', 'og:url', esc(p.url)), meta('property', 'og:image', esc(p.img)), meta('name', 'twitter:image', esc(p.img)),
    meta('property', 'og:image:alt', esc(p.alt)),
    (h) => h.replace(/(<link rel="canonical" href=")[^"]*(">)/, `$1${p.canonical}$2`),
    // src/wants.js opens and scrolls to the ask named in the page data's focus, and shows the sharer's answer above it.
    (h) => h.replace(/"focus":(null|"[^"]*")/, `"focus":${JSON.stringify(p.focus)}`),
    (h) => h.replace('"said":null', `"said":${JSON.stringify(p.said).replace(/</g, '\\u003c')}`),
  ].reduce((h, f) => f(h), shell);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  return res.send(html);
}
