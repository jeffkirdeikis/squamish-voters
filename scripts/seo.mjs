// Search engine helpers for build.mjs (review item 23): which pages are too thin to list yet, each page's own content
// date for the sitemap, and the RSS feed. Small and pure, so the rules are easy to check.

// A future meeting with no agenda yet reads the same as every other one, word for word. Keep it out of search until
// the agenda (or a summary) is in. The swearing in meeting has its own text, so it always stays listed.
export const thinMeeting = (m) => !m.summary && !(m.decisions || []).length && !(m.agenda_items || []).length && m.type !== 'inaugural';

// A neighbourhood page with no council decision and no building project shows zeros and a map. Listed again as soon as
// it has one of either.
export const thinHood = ({ decisions = 0, projects = 0 }) => !decisions && !projects;

// The newest real date in a list (YYYY-MM-DD strings or anything starting with one), never later than today in
// Squamish time. Empty when there is none, and then the sitemap leaves the date out instead of guessing.
export const latestDate = (dates, today) => dates.map((d) => (typeof d === 'string' && /^\d{4}-\d\d-\d\d/.test(d) ? d.slice(0, 10) : '')).filter((d) => d && d <= today).sort().pop() || '';

// The page's own content date: the date page() marks (from its data) and any date in its structured data.
export const LASTMOD_MARK = /<!--lastmod:(\d{4}-\d\d-\d\d)-->\n?/;
export const pageDate = (html, today) => latestDate([html.match(LASTMOD_MARK)?.[1], ...[...html.matchAll(/"date(?:Modified|Published)":"(\d{4}-\d\d-\d\d)/g)].map((x) => x[1])], today);

const xesc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export const sitemapXml = (origin, urls, lastmod, prio) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${origin}${u}</loc>${lastmod[u] ? `<lastmod>${lastmod[u]}</lastmod>` : ''}<priority>${prio(u)}</priority></url>`).join('\n')}
</urlset>
`;

// RSS 2.0, newest first. items: { title, url (path), date (YYYY-MM-DD), text }.
const rfc822 = (d) => new Date(`${d}T12:00:00-08:00`).toUTCString();
export const feedXml = ({ origin, title, desc, items }) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xesc(title)}</title>
<link>${origin}/</link>
<description>${xesc(desc)}</description>
<language>en-ca</language>
<atom:link href="${origin}/feed.xml" rel="self" type="application/rss+xml"/>
${items.length ? `<lastBuildDate>${rfc822(items[0].date)}</lastBuildDate>\n` : ''}${items.map((i) => `<item><title>${xesc(i.title)}</title><link>${origin}${i.url}</link><guid isPermaLink="true">${origin}${i.url}</guid><pubDate>${rfc822(i.date)}</pubDate><description>${xesc(i.text)}</description></item>`).join('\n')}
</channel>
</rss>
`;
