// What Squamish Wants pages that need the database or a person's answers, so a Facebook share shows the right title and picture.
//   GET ?id=<r-id>               -> a resident's ask at /wants/<r-id>/ (starter asks have static pages built by build.mjs).
//   GET ?id=<id>&said=<key>      -> /wants/<id>/said/<key>/: "I said Yes" and the live results on one question, opened on it.
// A shared link carries ?n=<answers so far>, so each share is a new address and Facebook fetches today's results for it.
//   GET ?id=<id>&live=1          -> /wants/<id>/live/: the live results without the sharer's answer, opened on it.
//   GET ?mine=1&a=<id>.<key>,... -> /wants/my/?a=...: "My picks for Squamish", up to 5 answers, opened on the full list.
//   GET ?set=parents              -> /wants/parents/: the full list with a picture of a hand picked set for one group.
//   GET ?me=1&a=<id>.<key>,...&hd=<area> -> /wants/me/?a=...: "My Squamish", how one person's answers line up with everyone's.
// All of them are the static /wants/ page (or the ask's own page) with the title, description, share picture and the
// page data's focus swapped in. Hidden or unknown -> /wants/.
import { findAsk, answerLabel, results, standing, meSummary, HOOD_NAMES, SETS } from './_wants-ask.js';

const ORIGIN = 'https://squamishvoters.com';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ask = (title) => (/[?.!]$/.test(title) ? title : `${title}?`);

async function describe(q) {
  const n = /^\d{1,7}$/.test(String(q.n || '')) ? `${q.n}` : '';
  if (q.set && SETS[q.set]) {
    const s = SETS[q.set];
    return {
      shell: '/wants/', focus: null, said: null, url: `${ORIGIN}/wants/${q.set}/${n ? `?n=${n}` : ''}`, canonical: `${ORIGIN}/wants/`,
      title: s.title, alt: `What Squamish Wants: ${s.head}`, desc: s.desc,
      img: `${ORIGIN}/api/og/?set=${q.set}&v=1${n && `&n=${n}`}`,
    };
  }
  if (q.me) {
    const spec = String(q.a || '').split(',').slice(0, 60).filter((p) => /^[a-z0-9-]{2,40}\.[a-z0-9]{1,12}$/.test(p)).join(',');
    const m = spec && (await meSummary(spec).catch(() => null));
    if (!m) return null;
    const hd = HOOD_NAMES[String(q.hd || '')] ? String(q.hd) : '';
    const tail = `${hd && `&hd=${hd}`}${n && `&n=${n}`}`;
    return {
      shell: '/wants/', focus: null, said: null, url: `${ORIGIN}/wants/me/?a=${spec}${tail}`, canonical: `${ORIGIN}/wants/`,
      title: `I agree with Squamish on ${m.agree} of ${m.of} | What Squamish Wants`, alt: `My Squamish: I agree with Squamish on ${m.agree} of ${m.of}`,
      desc: `${m.bold ? `My boldest take: ${m.bold.yn ? `${m.bold.label} to “${m.bold.title}”` : `“${m.bold.label}”`} (only ${m.bold.share}% agree). ` : ''}Took 2 minutes. Where do you land?`,
      img: `${ORIGIN}/api/og/?me=${spec}&v=1${tail}`,
    };
  }
  if (q.mine) {
    const spec = String(q.a || '').split(',').slice(0, 5).filter((p) => /^[a-z0-9-]{2,40}\.[a-z0-9]{1,12}$/.test(p)).join(',');
    if (!spec) return null;
    return {
      shell: '/wants/', focus: null, said: null, url: `${ORIGIN}/wants/my/?a=${spec}${n && `&n=${n}`}`, canonical: `${ORIGIN}/wants/`,
      title: 'My picks for Squamish | What Squamish Wants', alt: 'My picks for Squamish',
      desc: 'Here’s what I want for Squamish. Say yes, no or don’t mind to the same questions and see what everyone said.',
      img: `${ORIGIN}/api/og/?my=${spec}&v=2${n && `&n=${n}`}`,
    };
  }
  const id = String(q.id || '').replace(/\/$/, ''), key = String(q.said || '');
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return null;
  const a = await findAsk(id);
  if (!a || (!key && !q.live && !id.startsWith('r-'))) return null;
  const label = key && /^[a-z0-9]{1,12}$/.test(key) ? await answerLabel(id, a, key) : null;
  const shell = id.startsWith('r-') ? '/wants/' : `/wants/${id}/`;
  if (label) {
    const r = await results(id, a).catch(() => null), now = standing(r), tot = r ? r.total : 0;
    const stamp = `${tot || n}`;
    return {
      shell, focus: id, said: { id, label }, url: `${ORIGIN}/wants/${id}/said/${key}/${n ? `?n=${n}` : ''}`, canonical: `${ORIGIN}/wants/${id}/`,
      title: `${key === 'm' ? 'I don’t mind' : `I said “${label}”`}: ${ask(a.title)}`,
      alt: `What Squamish Wants: ${a.title}. I said ${label}.${now ? ` So far ${now}.` : ''}`,
      desc: now ? `So far ${now} (${tot} answer${tot === 1 ? '' : 's'}). What do you say?` : 'What do you say? Answer, then see what Squamish said.',
      img: `${ORIGIN}/api/og/?id=${id}&said=${key}&v=3&n=${stamp}`,
    };
  }
  if (q.live) {
    const r = await results(id, a).catch(() => null), now = standing(r), tot = r ? r.total : 0;
    return {
      shell, focus: id, said: { id, label: null }, url: `${ORIGIN}/wants/${id}/live/${n ? `?n=${n}` : ''}`, canonical: `${ORIGIN}/wants/${id}/`,
      title: `${now ? `${now[0].toUpperCase()}${now.slice(1)}: ` : ''}${ask(a.title)}`,
      alt: `What Squamish Wants: ${a.title}.${now ? ` So far ${now}.` : ''}`,
      desc: now ? `So far ${now} (${tot} answer${tot === 1 ? '' : 's'}). Where do you stand?` : 'Where do you stand? Answer, then see what Squamish said.',
      img: `${ORIGIN}/api/og/?id=${id}&live=1&v=3&n=${tot || n}`,
    };
  }
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
