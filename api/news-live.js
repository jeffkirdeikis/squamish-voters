// Stories Jeff approved that the site hasn't built into static pages yet, so they show the moment he taps Approve.
//   GET              -> { stories: [...] } for the News page (src/news.js adds any it doesn't already show)
//   GET ?slug=<slug> -> one story's full page, for /news/<slug>/ before its static page exists (vercel.json rewrite)
// .github/workflows/news.yml later bakes each one into data/news.json with its share picture.
import { neon } from '@neondatabase/serverless';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
const ORIGIN = 'https://squamishvoters.com';
const SEC = { vote: 'Elections', council: 'Council', money: 'Your money', community: 'Community', housing: 'Housing', recon: 'Reconciliation', move: 'Getting around', safety: 'Safety', weather: 'Weather' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });

const toStory = (r) => {
  const d = r.draft || {}, it = r.item || {};
  return { slug: d.slug, s: d.section, sec: SEC[d.section] || 'News', date: it.date && it.date <= today() ? it.date : today(), head: d.head, dek: d.dek, take: d.take || '', big: d.visual_big || '', small: d.visual_small || '', photo: d.photo || null, src: [it.label, it.url] };
};

export default async function handler(req, res) {
  if (!sql) return res.status(503).json({ stories: [] });
  // Approved, plus anything published in the last hour (its static page may still be deploying).
  const rows = await sql`SELECT draft, item FROM sv_news WHERE status = 'approved' OR (status = 'published' AND published_at > now() - interval '1 hour') ORDER BY decided_at DESC LIMIT 20`.catch(() => []);
  const stories = rows.map(toStory).filter((s) => s.slug && s.head);
  if (!req.query.slug) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=20, stale-while-revalidate=60');
    return res.json({ stories });
  }
  const st = stories.find((s) => s.slug === String(req.query.slug).replace(/\/$/, ''));
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=20');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // The site's own story page shell, built by build.mjs at /news/_live/, so this looks like every other story page.
  const shell = await fetch(`${ORIGIN}/news/_live/`).then((r) => r.text()).catch(() => '');
  if (!st || !shell) {
    const nf = await fetch(`${ORIGIN}/404/`).then((r) => r.text()).catch(() => '<h1>Page not found</h1>');
    return res.status(404).send(nf);
  }
  const url = `/news/${st.slug}/`;
  const body = `<div class="nw-kicker"><span>${esc(st.sec)}</span><time datetime="${st.date}" data-rel>${esc(new Date(st.date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }))}</time></div>
<h1 class="nw-h">${esc(st.head)}</h1>${st.photo ? `<figure class="nw-photo"><img src="${esc(st.photo.remote)}" alt="${esc(st.photo.alt)}"><figcaption>${esc(st.photo.caption)} <span>Photo: <a href="${esc(st.photo.link)}" target="_blank" rel="noopener">${esc(st.photo.credit)}</a></span></figcaption></figure>` : ''}<p class="nw-dek">${esc(st.dek)}</p>
${st.big ? `<div class="nw-big">${esc(st.big)}<small>${esc(st.small)}</small></div>` : ''}
${st.take ? `<p class="nw-take"><b>What changes</b>${esc(st.take)}</p>` : ''}
<div class="nw-foot"><p class="nw-src">Source: <a href="${esc(st.src[1])}" target="_blank" rel="noopener">${esc(st.src[0])}</a></p><button class="nw-share no-print" type="button" data-nw-share="${esc(ORIGIN + url)}" data-title="${esc(st.head)}">Share</button></div>`;
  return res.send(shell
    .replace(/<meta name="robots" content="noindex, nofollow">\n?/, '')
    .replaceAll('__LIVE_TITLE__', esc(st.head)).replaceAll('__LIVE_DESC__', esc(st.dek)).replaceAll('/news/_live/', url)
    .replace('data-s="__LIVE_S__"', `data-s="${esc(st.s)}"`).replace('<!--LIVE_BODY-->', body));
}
