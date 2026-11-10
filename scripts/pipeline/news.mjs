// Squamish news, run by .github/workflows/news.yml every 10 minutes (no computer needs to be on).
//   1. Scan: check public sources for anything new, have Claude draft a short story in our own words (or skip it).
//   2. Publish: drafts go straight into data/news.json with a share picture. Since Nov 3 2026 Jeff doesn't approve
//      each story (his call: "always push them out automatically"). NEWS_APPROVAL=1 brings back the old way:
//      drafts saved as 'pending' and emailed to him with Approve / Decline (api/news-review.js).
// Every source here allows plain automated reading. We never get around a site's bot check: the District's own
// news page blocks scripts, so District news comes in through its weekly E-News email instead (see district() below).
// The Squamish Chief (since Nov 5 2026, Jeff's call): its local news is rewritten fully in our words, credited and linked, with our own photos.
//   NEWS_DRAFT_ONE=1  draft the newest item from one source even if it was seen before (to test the email).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';
import { ROOT, log, readJson, writeJson, claudeJson } from './lib.mjs';
import { mdToHtml, placePhotos } from '../../api/_md.js';
import { ogImage, SEC_NAME } from './news-og.mjs';

const NEWS_FILE = path.join(ROOT, 'data', 'news.json');
const OG_DIR = path.join(ROOT, 'public', 'news', 'og');
const PHOTO_DIR = path.join(ROOT, 'public', 'news', 'photos');
const ORIGIN = 'https://squamishvoters.com';
const UA = 'SquamishVotersNews/1.0 (+https://squamishvoters.com/news/; plain-language local news)';
const MAX_DRAFTS = 4; // per run, so a burst of releases can't flood the inbox
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);

await sql`CREATE TABLE IF NOT EXISTS sv_tips (id text PRIMARY KEY, status text NOT NULL DEFAULT 'new', text text, link text, image text, ip_hash text, reading jsonb, created_at timestamptz NOT NULL DEFAULT now())`;
await sql`CREATE TABLE IF NOT EXISTS sv_news (
  id text PRIMARY KEY, source text NOT NULL, source_url text, title text, found_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL, token text, draft jsonb, item jsonb, decided_at timestamptz, published_at timestamptz)`;

const strip = (h) => String(h || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&#8217;/g, '’').replace(/&#8211;|&ndash;/g, '-').replace(/&#8220;|&#8221;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const idOf = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
async function get(url, type = 'text') {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: type === 'json' ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return type === 'json' ? r.json() : r.text();
}
const pageText = async (url, max = 7000) => {
  const h = await get(url);
  const body = h.indexOf('itemprop="articleBody"'); // news sites (the Chief): start at the story itself, not the menus
  if (body > 0) return strip(h.slice(body + 23, body + 80000)).split(/Words missing in article\?|Have a story idea\?/)[0].slice(0, max);
  const main = (h.match(/<(article|main)[\s\S]*?<\/\1>/i) || [h])[0];
  return strip(main).slice(0, max);
};

// Newsletter links go through click trackers (Constant Contact, Mailchimp, Campaign Monitor). Follow them once to the
// real page so a story's source link is clean; if that fails, drop the link and the newsletter's home page is used.
const TRACKER = /rs6\.net|ccsend\.com|list-manage\.com|cmail\d*\.com|createsend|cyberimpact\.com\/(?:t|click)|mailchi\.mp|sendgrid\.net|mandrillapp/i;
async function realLink(u) {
  if (!/^https?:/.test(u || '') || !TRACKER.test(u)) return u || '';
  try { const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }); if (TRACKER.test(r.url)) return '';
    const x = new URL(r.url); for (const k of [...x.searchParams.keys()]) if (/^(utm_|gclid|gad_|gbraid|wbraid|fbclid|mc_|_hs)/i.test(k)) x.searchParams.delete(k); // ad tracking tags
    return x.toString(); } catch { return ''; }
}
const recent = (i) => i.date >= new Date(Date.now() - 5 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }); // new sources never dig up old posts
const rssItems = (x, n) => [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, n).map((m) => m[1]).map((it) => ({
  url: strip((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1]), title: strip((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]).replace(/^<!\[CDATA\[|\]\]>$/g, ''),
  date: new Date((it.match(/<pubDate>([^<]+)/) || [])[1] || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' }),
  text: strip((it.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || it.match(/<description>([\s\S]*?)<\/description>/) || [])[1]).slice(0, 6000) }));

// Newsletters that arrive in our Resend inbox (district-news@crisuavau.resend.app), told apart by sender.
// The first entry (District) is the default; the others are matched by sender, or by the original sender in a forward. Each one says what to keep, so ads and member perks never become stories.
const KEEP_PUBLIC = 'Keep only items any Squamish resident would want to know about: public events, closures, changes to services, plans, consultations, deadlines, results and real local news. Leave out: ads and sales pitches, members only or ticketed promotions, paid workshops, sponsor thanks, recaps with nothing new, and the header and footer. An empty list is fine. Use only what the email says.';
const NEWSLETTERS = [
  { match: /squamish\.ca|cyberimpact/i, source: 'district', label: 'District of Squamish E-News', home: 'https://squamish.ca/government-and-administration/district-information/enews-archives/',
    system: 'You read the District of Squamish weekly email newsletter and list its separate news items. Use only what the newsletter says. Leave out: council meeting times and agendas (we cover meetings separately), job postings, holiday hours, recurring reminders with nothing new, and the newsletter header and footer.' },
  { match: /squamishchamber|squamish chamber of commerce/i, source: 'chamber', label: 'Squamish Chamber of Commerce', home: 'https://www.squamishchamber.com/',
    system: 'You read the Squamish Chamber of Commerce email newsletter and list only the items any Squamish resident would want to know about. Keep: public events and meetings with elected officials (MP, MLA, council), District of Squamish or government plans, studies and consultations, Squamish Nation or major project opportunities that are open to the public, community events open to everyone, and real local business news (openings, closures, awards results). Leave out: members only events and perks, ticket sales pitches for Chamber events, paid workshops, sponsor thanks, advertising for single businesses, recaps with nothing new, and the header and footer. An empty list is fine. Use only what the newsletter says.' },
  { match: /tourism ?squamish|exploresquamish/i, source: 'tourism', label: 'Tourism Squamish', home: 'https://www.exploresquamish.com/', system: `You read the Tourism Squamish email newsletter. ${KEEP_PUBLIC}` },
  { match: /squamish public library|squamishlibrary|library-squamish/i, source: 'library', label: 'Squamish Public Library', home: 'https://www.squamishlibrary.ca/', system: `You read the Squamish Public Library email newsletter. Keep changes to hours or services, new programs open to everyone and library board news. ${KEEP_PUBLIC}` },
  { match: /woodfibre/i, source: 'woodfibre', label: 'Woodfibre LNG', home: 'https://woodfibrelng.ca/', system: `You read a Woodfibre LNG community update. Keep construction schedules, marine and road traffic changes, environmental monitoring results, community meetings and anything about jobs or safety. Report only what Woodfibre says, as Woodfibre's statement, never as fact checked. ${KEEP_PUBLIC}` },
  { match: /squamish arts|squamisharts/i, source: 'arts', label: 'Squamish Arts Council', home: 'https://squamisharts.com/', system: `You read the Squamish Arts Council email newsletter. Keep festivals, public art, grants and calls for artists, and events open to everyone. ${KEEP_PUBLIC}` },
  { match: /rcmp-grc\.gc\.ca/i, source: 'police', label: 'Sea to Sky RCMP', home: 'https://rcmp.ca/en/bc/squamish/news', system: `You read a media release from the Sea to Sky RCMP (Squamish, Whistler, Pemberton, Bowen Island). Keep public safety news, incidents, appeals for information, road safety campaigns, surveys and town halls. Report police statements as what police say. ${KEEP_PUBLIC}` },
  { match: /sea to sky gondola|seatoskygondola/i, source: 'gondola', label: 'Sea to Sky Gondola', home: 'https://www.seatoskygondola.com/', system: `You read the Sea to Sky Gondola email newsletter. Keep only closures, schedule changes, trail or access news and big public events; leave out ticket offers. ${KEEP_PUBLIC}` },
];
// Anything else that lands in the inbox (media releases from the District, SLRD, RCMP, Squamish Nation and others)
const RELEASE = (who) => ({ source: 'release', label: who || 'News release', home: 'https://squamishvoters.com/news/',
  system: `You read an email sent to the Squamish Voters news desk, usually a media release or newsletter from ${who || 'a local organization'}. ${KEEP_PUBLIC} If it is spam, a personal message or not about the Squamish area, return an empty list.` });

// ---------- sources: each returns [{ key, source, label, url, title, date, text? }] ----------
const SOURCES = {
  async weather() { // Environment Canada warnings and watches for Howe Sound and Squamish
    const d = await get('https://api.weather.gc.ca/collections/weather-alerts/items?f=json&bbox=-123.3,49.6,-123.0,49.85', 'json');
    return (d.features || []).map((f) => f.properties).filter((p) => /warning|watch/.test(p.alert_type)).map((p) => ({
      key: `wx-${p.alert_code}-${p.feature_id}-${String(p.event_end_datetime || p.expiration_datetime).slice(0, 10)}`,
      source: 'weather', label: 'Environment Canada', url: 'https://weather.gc.ca/warnings/index_e.html?prov=bc',
      title: `${p.alert_name_en} for ${p.feature_name_en}`, date: String(p.publication_datetime).slice(0, 10), text: p.alert_text_en,
    }));
  },
  async highway() { // DriveBC: major incidents on Highway 99 around Squamish (not routine construction)
    const d = await get('https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE&road_name=Highway%2099&severity=MAJOR&limit=50', 'json');
    return (d.events || []).filter((e) => e.event_type !== 'CONSTRUCTION').filter((e) => {
      const g = e.geography || {}; const c = g.type === 'Point' ? g.coordinates : (g.coordinates || [])[0] || [];
      return c[1] > 49.45 && c[1] < 49.95;
    }).map((e) => ({ key: `drivebc-${e.id}`, source: 'highway', label: 'DriveBC', url: 'https://www.drivebc.ca/', title: `${e.event_type} on Highway 99`, date: String(e.created).slice(0, 10), text: e.description }));
  },
  async police() { // Squamish RCMP newsroom (the list is in the page's settings data)
    const h = await get('https://rcmp.ca/en/bc/squamish/news');
    const js = h.match(/data-drupal-selector="drupal-settings-json">([\s\S]*?)<\/script>/);
    const list = JSON.parse(JSON.parse(js[1]).poweb.all_news.rest_export_all_news);
    return list.slice(0, 10).map((n) => ({ key: `rcmp-${n.view_node}`, source: 'police', label: 'Squamish RCMP', url: n.view_node, title: strip(n.title), date: n.created, text: strip(n.body).slice(0, 6000) }));
  },
  async regional() { // Squamish-Lillooet Regional District news and notices
    const h = await get('https://www.slrd.bc.ca/inside-slrd/news-events');
    const seen = new Set();
    return [...h.matchAll(/href="(\/inside-slrd\/news-notices\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)]
      .filter((m) => !seen.has(m[1]) && seen.add(m[1])).slice(0, 12)
      .map((m) => ({ key: `slrd-${m[1]}`, source: 'regional', label: 'Squamish-Lillooet Regional District', url: `https://www.slrd.bc.ca${m[1]}`, title: strip(m[2]) || m[1].split('/').pop().replace(/-/g, ' '), date: today() }));
  },
  async engage() { // Let's Talk Squamish: new District consultations you can take part in
    const h = await get('https://letstalksquamish.ca/projects');
    const skip = /^(accessibility|account|login|logout|moderation|privacy|privacy-policy|projects|register|signup|terms|terms-and-conditions|faq|faqs|sitemap|news_feed|translation-disclaimer|contact|contact-us|about|about-us|help)$/;
    const seen = new Set();
    return [...h.matchAll(/href="https:\/\/letstalksquamish\.ca\/([a-z0-9-]+)"/g)].map((m) => m[1]).filter((s) => !skip.test(s) && !seen.has(s) && seen.add(s))
      .map((s) => ({ key: `lts-${s}`, source: 'engage', label: 'Let’s Talk Squamish (District of Squamish)', url: `https://letstalksquamish.ca/${s}`, title: s.replace(/-/g, ' '), date: today() }));
  },
  async province() { // BC Government news that names Squamish or the Sea to Sky
    const x = await get('https://news.gov.bc.ca/feed');
    return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]).map((it) => ({
      title: strip((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]).replace(/^<!\[CDATA\[|\]\]>$/g, ''), url: strip((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1]),
      text: strip((it.match(/<description>([\s\S]*?)<\/description>/) || [])[1]).replace(/^<!\[CDATA\[|\]\]>$/g, ''), date: new Date((it.match(/<pubDate>([^<]+)/) || [])[1] || Date.now()).toISOString().slice(0, 10),
    })).filter((i) => /squamish|sea to sky|howe sound|highway 99|woodfibre|britannia|garibaldi/i.test(i.title + ' ' + i.text))
      .map((i) => ({ key: `bcgov-${i.url}`, source: 'province', label: 'BC Government News', ...i }));
  },
  async meetings() { // our own council meeting pages (scripts/pipeline): a posted agenda, then what council decided
    const dir = path.join(ROOT, 'data', 'meetings');
    const t = today(), soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), recent = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
    const KIND = { regular: 'council meeting', cow: 'council workshop (Committee of the Whole, no final votes)', hearing: 'public hearing', inaugural: 'inaugural council meeting', special: 'special council meeting' };
    const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const out = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const m = readJson(path.join(dir, f));
      if (!m || m.status === 'cancelled' || m.closed_only) continue;
      const kind = KIND[m.type] || 'council meeting', more = ['Full meeting page', `/meetings/${m.id}/`];
      // Skip the results item when a story dated on or after the meeting already covers it (written by hand from the video).
      const covered = (readJson(path.join(ROOT, 'data', 'news.json'), { stories: [] }).stories || []).some((st) => st.more?.[1] === `/meetings/${m.id}/` && st.date >= m.date);
      if (m.summary && !covered && m.date >= recent && m.date <= t) {
        const S = m.summary, dec = (m.decisions || []).filter((d) => !d.consent_agenda && d.result !== 'info');
        out.push({ key: `meet-result-${m.id}`, source: 'meetings', label: `${day(m.date)} ${kind} (District of Squamish)`, url: m.minutes_url || m.video_url || m.agenda_url, more, title: `What council decided on ${day(m.date)}`, date: m.date,
          text: `This is what Squamish council decided at its ${kind} on ${day(m.date)}. It is newsworthy: write it up as a council story, section "council" unless the main decision is clearly about money, housing or getting around.\n\n${S.headline}\n\n${(S.key_points || []).map((x) => '- ' + x).join('\n')}\n\n${(S.explainer || []).join('\n\n')}\n\nDecisions:\n${dec.map((d) => `- ${d.title} (${d.result}): ${d.what}`).join('\n')}` });
      } else if (!m.summary && (m.agenda_items || []).length && m.date >= t && m.date <= soon) {
        out.push({ key: `meet-agenda-${m.id}`, source: 'meetings', label: `${day(m.date)} ${kind} agenda (District of Squamish)`, url: m.agenda_url, more, title: `Agenda posted for the ${day(m.date)} ${kind}`, date: t,
          text: `The District of Squamish has posted the agenda for its ${kind} on ${day(m.date)}${m.time ? ' at ' + m.time + ' (24 hour clock)' : ''}, ${m.place || 'Council Chambers, Municipal Hall'}. Meetings are open to the public and streamed on the District's YouTube channel. Write it as a preview of what council will decide (this is not a routine meeting notice; skip only if every item is routine paperwork). Section "council" unless one item clearly dominates. Use the meeting date as the visual if nothing bigger stands out.${m.has_public_hearing ? ' It includes a public hearing where residents can speak.' : ''}\n\nOverview: ${m.preview || ''}\n\nAgenda items:\n${m.agenda_items.map((a) => `- ${a.plain}${a.for_you ? ' For residents: ' + a.for_you : ''}${(a.facts || []).length ? ' Facts: ' + a.facts.join('; ') : ''}`).join('\n')}\n\nOFFICIAL AGENDA TEXT (for exact details: venue, ceremony, how to watch or take part):\n${(() => { try { return fs.readFileSync(path.join(dir, 'raw', `${m.id}-agenda.txt`), 'utf8').slice(0, 7000); } catch { return ''; } })()}` });
      }
    }
    return out;
  },
  async district() { // District of Squamish weekly E-News: squamish.ca blocks automated readers, so the District's own
    // newsletter is sent to our Resend inbox (district-news@crisuavau.resend.app) and read here through the Resend API.
    const key = process.env.RESEND_INBOX_KEY;
    if (!key) return [];
    const api = async (p) => { const r = await fetch(`https://api.resend.com${p}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`); return r.json(); };
    const since = Date.now() - 10 * 86400000;
    const mails = ((await api('/emails/receiving?limit=30')).data || []).filter((e) => new Date(e.created_at).getTime() > since);
    const out = [];
    for (const e of mails) {
      const issueId = idOf(`enews-${e.id}`);
      let [row] = await sql`SELECT item FROM sv_news WHERE id = ${issueId}`;
      if (!row) {
        const full = await api(`/emails/receiving/${e.id}`);
        const html = full.html || '', text = full.text || strip(html);
        if (/confirm|verify|validate/i.test(e.subject || '') && !/enews|e-news|update/i.test(e.subject || '')) { log('district: confirmation email waiting:', e.subject, (html.match(/href="(https:[^"]+)"/g) || []).slice(0, 6).join(' ')); continue; }
        const online = ((html.match(/href="(https:\/\/(?:app\.cyberimpact\.com\/newsletter-view-online|myemail\.constantcontact\.com\/)[^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&');
        const from = String(e.from || full.from || '');
        const head = `${from}\n${text.slice(0, 3000)}`; // forwarded copies carry the original sender in the text
        const to = [].concat(e.to || full.to || []).join(' ');
        const who = (String(from).match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || '';
        const nl = NEWSLETTERS.slice(1).find((n) => n.match.test(head)) || (/district-news@/i.test(to) || NEWSLETTERS[0].match.test(head) ? NEWSLETTERS[0] : RELEASE(who));
        const x = await claudeJson({
          system: nl.system,
          schema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text', 'link'], properties: { title: { type: 'string' }, text: { type: 'string', description: 'everything the newsletter says about this item, close to its own words, with dates, places and numbers' }, link: { type: 'string', description: 'the item\'s "learn more" link if it has one, else empty' } } } } } },
          effort: 'low', maxTokens: 6000, content: `Subject: ${e.subject}\nSent: ${e.created_at}\n\n${text.slice(0, 30000)}\n\nLinks in the email:\n${[...new Set((html.match(/href="(https?:[^"]+)"/g) || []).map((h) => h.slice(6, -1).replace(/&amp;/g, '&')))].filter((u) => !/unsubscribe|cyberimpact\.com\/(?!newsletter-view-online)|constantcontact\.com\/(?!.*myemail)|ccsend\.com|facebook|instagram|twitter|x\.com|linkedin|youtube\.com\/@/i.test(u)).slice(0, 80).join('\n')}`,
        });
        const date = new Date(e.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
        for (const it of x.items || []) it.link = await realLink(it.link);
        const items = (x.items || []).map((it, n) => ({ key: `enews-${e.id}-${n}`, source: nl.source, label: nl.label, url: /^https?:/.test(it.link) ? it.link : (online || nl.home), title: it.title, date, text: it.text }));
        await sql`INSERT INTO sv_news (id, source, source_url, title, status, item) VALUES (${issueId}, ${nl.source}, ${online || null}, ${e.subject}, 'issue', ${JSON.stringify({ items })}) ON CONFLICT DO NOTHING`;
        log(`${nl.source}: newsletter "${e.subject}" has ${items.length} items`);
        row = { item: { items } };
      }
      out.push(...(row.item?.items || []));
    }
    return out;
  },
  async woodfibre() { // Woodfibre LNG's own news posts (permits, open houses, comment periods). Reported as the company's statement.
    const x = await get('https://woodfibrelng.ca/feed/');
    return rssItems(x, 6).filter(recent).map((i) => ({ key: `wlng-${i.url}`, source: 'woodfibre', label: 'Woodfibre LNG', ...i,
      text: `This is a post by Woodfibre LNG, the company building the LNG plant near Squamish. Report what it says as Woodfibre's statement, never as fact checked. Lead with anything residents can act on (comment deadlines, open houses, how to comment) and with what changes for people nearby (flaring, noise, light, marine traffic). Link our /issues/woodfibre-lng/ page.\n\n${i.text || ''}` }));
  },
  async chief() { // The Squamish Chief's local news feed. Facts retold in our own words, credited to the Chief, never their text or photos.
    const x = await get('https://www.squamishchief.com/rss/local-news');
    const items = rssItems(x, 12).filter(recent).filter((i) => i.date >= '2026-11-05' && /\/local-news\//.test(i.url) && !/letter|opinion|sponsored|obituar/i.test(i.title));
    if (!items.length) return [];
    let ours = [];
    try { ours = (readJson(NEWS_FILE).stories || []).filter((s) => s.date >= new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10)).map((s) => `- ${s.date}: ${s.head || s.title}`); } catch { /* no list */ }
    return items.map((i) => ({ key: `chief-${i.url}`, source: 'chief', label: 'The Squamish Chief', ...i, text: '',
      preface: `This is reporting by The Squamish Chief, a local newspaper. Retell the facts entirely in your own words and structure: never copy or closely paraphrase its sentences, and quote a person only briefly (under 15 words) when the quote matters. Say once in the body that The Squamish Chief reported it, with a [link](${i.url}). Skip it (publish=false) if one of our recent stories below already covers the same news, if it is an opinion piece, column or sponsored post, or if it is not about the Squamish area.\n\nOUR RECENT STORIES:\n${ours.join('\n') || '(none)'}\n\n` }));
  },
  async nation() { // Sḵwx̱wú7mesh Úxwumixw (Squamish Nation) news posts
    const x = await get('https://www.squamish.net/feed/');
    return rssItems(x, 6).filter(recent).map((i) => ({ key: `nation-${i.url}`, source: 'nation', label: 'Sḵwx̱wú7mesh Úxwumixw (Squamish Nation)', ...i }));
  },
  async downtown() { // Downtown Squamish Business Improvement Association posts
    const x = await get('https://www.downtownsquamish.com/feed/');
    return rssItems(x, 4).filter(recent).filter((i) => !/^welcome to the neighbourhood/i.test(i.title)).map((i) => ({ key: `dsbia-${i.url}`, source: 'downtown', label: 'Downtown Squamish Business Improvement Association', ...i }));
  },
  async hydro() { // BC Hydro power outages in the Squamish area (open data behind the outage map), big ones only
    const d = await get('https://www.bchydro.com/power-outages/app/outages-map-data.json', 'json');
    const at = (ms) => (ms ? new Date(ms).toLocaleString('en-CA', { timeZone: 'America/Vancouver', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not given');
    return (d || []).filter((o) => o.latitude > 49.6 && o.latitude < 49.86 && o.longitude > -123.35 && o.longitude < -122.95 && o.numCustomersOut >= 300 && (!o.dateOn || o.dateOn > Date.now()))
      .map((o) => ({ key: `hydro-${o.id}`, source: 'hydro', label: 'BC Hydro outage map', url: 'https://www.bchydro.com/power-outages/app/outage-map.html', title: `Power outage: ${o.numCustomersOut} BC Hydro customers in ${o.municipality}`, date: today(),
        text: `BC Hydro reports a power outage in ${o.municipality} affecting ${o.numCustomersOut} customers. Area: ${o.area}. Cause: ${o.cause}. Power went off ${at(o.dateOff)}. Crew status: ${o.crewStatusDescription || o.crewStatus}${o.crewStatusNote ? ' (' + o.crewStatusNote + ')' : ''}. ${o.showEtr && o.crewEtr ? 'Estimated restoration: ' + at(o.crewEtr) + '.' : 'No restoration estimate yet.'} Last updated ${at(o.lastUpdated)}. Write it as a short brief in section "safety". Say these numbers can change quickly and link the live outage map. Skip it if the cause is planned work that affects fewer than 1,000 customers.` }));
  },
  async tips() { // Tips sent through squamishvoters.com/tip/ (a screenshot of a Facebook or Instagram post, a link or a note)
    // Each tip is read once (the reading is saved); it stays listed for 3 days so a failed draft is tried again.
    const rows = await sql`SELECT id, status, text, link, image, reading FROM sv_tips WHERE status IN ('new', 'read') AND created_at > now() - interval '3 days' ORDER BY created_at LIMIT 8`;
    const out = [];
    for (const t of rows) {
      let r = t.reading || { poster: '', platform: '', official: false, posted: '', text: t.text || '', link: t.link || '' };
      const img = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(t.image || '');
      if (t.status === 'new' && img) {
        r = await claudeJson({ effort: 'low', maxTokens: 3000,
          system: 'Someone sent the Squamish Voters news desk a tip: usually a screenshot of a social media post, sometimes with a note or a link. Read it carefully. Copy the post text exactly as shown (all of it), say who posted it and where, and whether the poster is an official organization (a government, First Nation, police, fire, school district, utility, business or nonprofit page) rather than a private person. Never add anything that is not visible.',
          schema: { type: 'object', additionalProperties: false, required: ['poster', 'platform', 'official', 'posted', 'text', 'link'], properties: { poster: { type: 'string' }, platform: { type: 'string', description: 'Facebook, Instagram, X, website, email or other' }, official: { type: 'boolean' }, posted: { type: 'string', description: 'when it was posted, as shown, else empty' }, text: { type: 'string' }, link: { type: 'string', description: 'a full https link shown in the post or sent with the tip, else empty' } } },
          content: [...(img ? [{ type: 'image', source: { type: 'base64', media_type: img[1], data: img[2] } }] : []), { type: 'text', text: `Note from the sender: ${t.text || '(none)'}\nLink sent: ${t.link || '(none)'}` }] });
      }
      if (t.status === 'new') await sql`UPDATE sv_tips SET status = 'read', reading = ${JSON.stringify(r)} WHERE id = ${t.id}`;
      const who = r.poster ? `${r.poster}${r.platform ? ` (${r.platform})` : ''}` : 'A reader tip';
      out.push({ key: `tip-${t.id}`, source: 'tip', label: who, tip: true, url: /^https?:/.test(r.link || t.link || '') ? (r.link || t.link) : `${ORIGIN}/news/`, title: (r.text || t.text || 'Tip').slice(0, 90), date: today(),
        text: `This came in as a TIP to our news desk, not from a feed. ${r.official ? `It is a post by ${who}, an official organization: treat that organization as the source and name it.` : `It is a post by ${who}, who looks like a private person, not an official organization: only publish if it is clearly useful public information (a closure, a hazard, a public event), say plainly who posted it, and never present it as confirmed.`} Posted: ${r.posted || 'not shown'}.\n\nPost text:\n${r.text || ''}\n\nNote from the sender: ${t.text || '(none)'}` });
    }
    return out;
  },
  async foundation() { // Squamish Community Foundation posts
    const x = await get('https://www.squamishfoundation.com/feed/');
    return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5).map((m) => m[1]).map((it) => {
      const url = strip((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
      return { key: `scf-${url}`, source: 'foundation', label: 'Squamish Community Foundation', url, title: strip((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]), date: new Date((it.match(/<pubDate>([^<]+)/) || [])[1] || Date.now()).toISOString().slice(0, 10), text: strip((it.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) || it.match(/<description>([\s\S]*?)<\/description>/) || [])[1]).slice(0, 6000) };
    });
  },
};

// ---------- drafting ----------
const HOOD_SLUGS = (readJson(path.join(ROOT, 'data', 'neighbourhoods.json'), { neighbourhoods: [] }).neighbourhoods || []).map((h) => h.slug);
const SECTIONS = ['vote', 'council', 'money', 'community', 'housing', 'recon', 'move', 'safety', 'weather'];
const SYSTEM = `You write short local news for Squamish Voters, an independent, non-partisan site about Squamish, B.C.
You get one item from a public source. Decide whether Squamish residents would want to know about it, and if so write a short story in your own words.
Rules:
- Use only facts in the source text. Never add facts, guesses, quotes or numbers that are not there.
- Neutral and factual. No opinion, no praise or blame, no "big test", no predictions, no calls to action except practical ones (a deadline, how to apply, a road closure).
- Plain words a 12-year-old could follow. Canadian spelling. Short sentences.
- Never use em dashes or en dashes. Avoid hyphenated compound words where a plain phrase works. Spell out abbreviations (except B.C., BC in party or agency names, RCMP).
- Headline: the line that makes a Squamish resident stop scrolling and tap. Lead with what it means for them or the most interesting concrete fact (a number, a place they know, a date, a cost, a change to daily life), never with the agency's name or process words like "is building a plan", "launches", "announces", "seeks input". A question is fine when the story answers it. Active verbs, present tense, sentence case, under 75 characters. It must stay strictly true to the source: no exaggeration, no fear, no promise the story does not deliver.
  It must make sense to a local who knows the area. Never lift a phrase from the source without the context that makes it true (a source saying the Nation "received a whale for the first time in generations" meant receiving a whale's remains to care for under its laws; whales themselves are common in Howe Sound). Name the concrete who and what (Notcho, the BC Ferry) over abstractions.
  Weak: "District of Squamish is building a 10 year plan for local jobs and skills". Strong: "What jobs will Squamish need in 10 years? The District is writing the plan".
  Best of all, a curiosity gap: set up a concrete promise or question and hold back the payoff, so the reader has to tap to find out ("Here's what he says he'll fix", "The four changes coming to your street"). A headline that states the whole story or ends on a self contained quote gives readers no reason to tap. The story must pay it off in its first section, and never promise what the story doesn't deliver. Jeff's favourite: "New mayor promises to be judged on results. Here's what he says he'll fix".
  Meetings and ceremonies: lead with the most striking moment, quote or ask from the night, never the procedure. Weak: "Easton sworn in as Squamish mayor and tells council to judge itself on results, not plans". Better: "\"No one else is coming to save us\": Squamish's new mayor takes office". Best: "New mayor promises to be judged on results. Here's what he says he'll fix".
  Weak: "Britannia Village tree lighting set for Friday, November 27". Strong: "Britannia lights a taller Christmas tree November 27, with weekend markets after".
- dek: first sentence is the hook a reader cares about, then the key facts (who, what, when, where). 2 to 4 sentences.
- social: the text of the Facebook post that shares the story, 2 short paragraphs separated by a blank line. It must make a local stop scrolling and want to tap or comment. Paragraph 1 opens with either a question about the reader's own life that this story touches (their commute, kids, rent, taxes, weekend, street, safety) or the single most human or surprising fact in the story. Make the stakes personal: why should someone in Squamish care today? Paragraph 2 gives the key fact and ends with what they get by tapping (for example "How it happened and who helped:" or "What it covers and when it lands:"). A question to readers may go beyond the source (it asks, it does not claim), but every statement must be true to the source. No hashtags, no emoji, no "click here", no exclamation marks, no copy of the headline.
- share: 1 to 5, how likely Squamish people are to tap, share or comment on this on Facebook (5: a striking human story, a big change to daily life, a local event families go to; 1: a routine notice). Be honest; most stories are 2 or 3.
- take: one sentence that says what changes for residents or what they can do, strictly factual. Empty if there is nothing useful.
- weight: "big" only for something most residents care about (a major closure, an election result, a big decision); "brief" for small notices; otherwise "normal".
- visual: a key number or date from the source (like "Nov 16" with "Application deadline", or "90 km/h" with "Wind gusts") or null. Never invent one.
- Skip (publish=false): routine meeting notices, holiday hours, job postings, items not about the Squamish area, items with too little information, and anything already stale.
- section: one of ${SECTIONS.join(', ')}.
- areas: the Squamish neighbourhoods the story is about, from this list only: ${HOOD_SLUGS.join(', ')}. Empty if it is town-wide or outside these areas.
- body: the full story in markdown, shown under the summary on the story page. This is where the detail goes, so never leave it thin: 150 to 450 words in 2 to 5 sections, each starting with "## " and a plain heading (for example "What happens", "The details", "Who it affects", "What comes next", "How to take part"). Use "- " bullets for lists of dates, items, places or numbers. Put in every useful fact from the source: dates, times, places, amounts, names, deadlines, how to apply or comment. Do not repeat the dek word for word. Link to our own pages from the SITE PAGES list with [text](/path/) where they really help (a council member's page when you name them, the meeting page, an issue page), and to the source with its full https link. Only facts from the source or the SITE PAGES list; never guess.
- Any story about an event or meeting people can attend or watch MUST have a "## How to take part" (or "## Where and when") section with "- " bullets covering everything the source gives: the start time AND the time the main part begins if different (e.g. doors 6 p.m., ceremony 6:30 p.m.); the full address; whether it is open to the public; seating limits, overflow rooms or registration; a direct link to watch live (District of Squamish meetings stream at https://www.youtube.com/@DistrictofSquamish/streams); phone or WebEx call in details; and links to the agenda and our meeting page. Never write just "it's live streamed" without the watch link. The take line should name the single most practical detail (for example limited seating, or when the main part starts).
- poll: a question readers answer at the bottom of the story, to get Squamish thinking about what it means for them. Only when the story raises a real local choice or a matter of opinion (a project, a rule, a cost, a change to a service, how the town should respond). For events, markets, ceremonies, holiday notices, obituaries and plain announcements with nothing to weigh, set q to "" and options to []. When there is one: q is a short neutral question under 90 characters, ending in "?", that doesn't lead toward any answer. options are 3 or 4 distinct answers covering the real range of views (not just yes and no, and never a joke answer); label under 45 characters, means one short factual sentence on what that answer would lead to. Readers can also pick Not sure or write their own, so don't add those.
- photo_queries: 3 or 4 short searches for openly licensed photos of the PLACE or TOPIC (not the event itself), most specific first and each a different angle so the story can carry more than one picture, e.g. "Howe Sound Squamish", "Sea to Sky Highway", "downtown Squamish".`;
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['publish', 'reason', 'section', 'weight', 'head', 'dek', 'social', 'share', 'take', 'body', 'visual_big', 'visual_small', 'slug', 'photo_queries', 'areas', 'poll'],
  properties: {
    publish: { type: 'boolean' }, reason: { type: 'string' }, section: { type: 'string', enum: SECTIONS }, weight: { type: 'string', enum: ['big', 'normal', 'brief'] },
    head: { type: 'string' }, dek: { type: 'string' }, social: { type: 'string', description: 'Facebook post text: personal hook, blank line, key fact + what tapping gets you' }, share: { type: 'integer', description: '1 to 5' }, take: { type: 'string' }, body: { type: 'string', description: 'full story in markdown (## headings, - bullets, [links](/path/))' }, visual_big: { type: 'string' }, visual_small: { type: 'string' },
    slug: { type: 'string', description: 'short url slug, lowercase words joined by hyphens, under 50 characters' },
    photo_queries: { type: 'array', items: { type: 'string' } },
    areas: { type: 'array', items: { type: 'string', enum: HOOD_SLUGS.length ? HOOD_SLUGS : ['downtown'] } },
    poll: { type: 'object', additionalProperties: false, required: ['q', 'options'], properties: { q: { type: 'string', description: 'empty when the story has no real question to weigh' }, options: { type: 'array', description: '3 or 4 answers, or empty', items: { type: 'object', additionalProperties: false, required: ['label', 'means'], properties: { label: { type: 'string' }, means: { type: 'string' } } } } } },
  },
};
const clean = (s) => String(s || '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+,/g, ',').trim();

// Our own pages a story can link to, with one line of context each (members' pages get their background).
const SITE_PAGES = (() => {
  const people = readJson(path.join(ROOT, 'data', 'candidates.json'), []);
  const sitting = new Set(['sean-easton', 'eric-andersen', 'janice-desjardins', 'sarah-ellis', 'luc-perreault', 'laura-prosko', 'shaun-veltkamp']);
  const members = people.filter((c) => sitting.has(c.slug)).map((c) => `/council/${c.slug}/ ${c.office === 'mayor' ? 'Mayor' : 'Councillor'} ${c.name}${c.incumbent ? ' (returning)' : ' (new in 2026)'}: ${String(c.occupation_background || '').slice(0, 160)} Priorities: ${(c.top_priorities || []).slice(0, 2).join('; ').slice(0, 200)}`);
  const issues = ['brennan-park-and-recreation', 'childcare-rentals-and-vanlife', 'climate-and-environment', 'flood-protection', 'growth-and-development', 'homelessness', 'housing', 'jobs-and-economy', 'parking', 'policing-and-safety', 'property-taxes', 'transit-and-highway-99', 'woodfibre-lng', 'woodfibre-tax-deal'].map((x) => `/issues/${x}/ issue page: ${x.replace(/-/g, ' ')}`);
  const meets = fs.readdirSync(path.join(ROOT, 'data', 'meetings')).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(ROOT, 'data', 'meetings', f))).filter((m) => m && m.date >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).map((m) => `/meetings/${m.id}/ ${m.type} council meeting ${m.date}${m.place ? ' at ' + m.place : ''}`);
  return [...members, ...meets, ...issues, '/scorecard/ every promise and campaign position checked against votes', '/have-your-say/ residents vote on the questions before council does', '/how-council-works/ plain guide to council', '/today/ weather, Highway 99, river and air right now', '/neighbourhoods/ news and projects by neighbourhood'].join('\n');
})();

// One story per event: every draft sees what we ran in the last 5 days (plus this pass's drafts), so a second
// warning for the same storm, a nearby forecast zone or a repeat notice is skipped (Nov 9 2026: three rain stories in one day).
const draftedHeads = [];
function alreadyRan() {
  const since = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  let ours = [];
  try { ours = (readJson(NEWS_FILE).stories || []).filter((s) => s.date >= since).map((s) => `- ${s.date}: ${s.head}. ${String(s.dek || '').slice(0, 200)}`); } catch { /* no list */ }
  ours.push(...draftedHeads.map((h) => `- ${today()}: ${h}`));
  if (!ours.length) return '';
  return `ONE STORY PER EVENT. Skip this item (publish=false, reason "already covered") if one of our stories below already covers the same event: the same storm, weather system, outage, closure, meeting or announcement. That includes a second warning for the same weather (rain then more rain, a nearby zone such as Whistler or the Sea to Sky, an updated or extended warning) and a repeat or reminder of the same notice. Only write a new story when this item is a clearly different event, or the situation has changed in a major way residents must act on (an evacuation, a highway closure, a flood).\n\nSTORIES WE ALREADY RAN:\n${ours.join('\n')}\n\n`;
}

async function draft(item) {
  let text = item.text;
  if (!text || text.length < 200) { try { text = await pageText(item.url); } catch (e) { log('page text failed', item.url, e.message); } }
  const d = await claudeJson({
    system: SYSTEM, schema: SCHEMA, effort: 'medium', maxTokens: 8000,
    content: `${item.preface || ''}${alreadyRan()}SITE PAGES (ours, to link to):\n${SITE_PAGES}\n\nToday is ${today()}.\nSource: ${item.label}\nURL: ${item.url}\nPublished: ${item.date}\nTitle: ${item.title}\n\n${(text || '').slice(0, 9000)}`,
  });
  for (const k of ['head', 'dek', 'take', 'visual_big', 'visual_small']) d[k] = clean(d[k]);
  if (d.social) d.social = String(d.social).replace(/\s*[—–]\s*/g, ', ').trim().slice(0, 600);
  d.body = String(d.body || '').replace(/\s*[—–]\s*/g, ', ').trim();
  d.slug = String(d.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `story-${Date.now()}`;
  if (!d.publish) return d;
  return reviewLoops(d, item, text);
}

// ---------- review loops (Jeff, Nov 9 2026: every story gets two rounds of reviewers, then fixes) ----------
// A panel of local readers and a fact checker score the draft and list what stops it from a 9 out of 10; the writer
// fixes those and the panel reads it again. Two rounds. A loop that fails keeps the last good draft (never blocks news).
const PANEL = `You are a review panel for one local news story on Squamish Voters, an independent site about Squamish, B.C. Read it as each of these people, separately and honestly:
1. A resident directly affected by the story (who exactly depends on the story: a neighbour of the site, a parent, a commuter, a business owner).
2. An expert on the subject (a hydrologist for rivers, a planner for development, an accountant for budgets, and so on).
3. A veteran local news editor: headline, first lines, order, repetition, length, attribution, burying what matters.
4. A skeptical local scrolling Facebook on a phone with 10 seconds, allergic to hype and jargon. They see the "social" text first.
5. An adversarial fact checker who compares every fact, number, date, name and quote with the SOURCE text. Anything not in the source is an error.
Each gives a score out of 10 (9 means a reader would trust it, understand it fast and know what to do) and the problems that stop it from a 9, each with the exact words and the fix.
Pay special attention to: a headline that claims more than the source supports or that a first time reader cannot understand; what matters to readers (who is affected, what to do, when) not being near the top; facts not in the source; em dashes; jargon and unexplained abbreviations.`;
const PANEL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reviews', 'fixes'],
  properties: {
    reviews: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['who', 'score', 'problems'], properties: { who: { type: 'string' }, score: { type: 'number', description: '0 to 10' }, problems: { type: 'array', items: { type: 'string' } } } } },
    fixes: { type: 'array', description: 'every change the writer must make, most important first; errors against the source first', items: { type: 'string' } },
  },
};
async function reviewLoops(d, item, text) {
  const source = `Source: ${item.label}\nURL: ${item.url}\nPublished: ${item.date}\nTitle: ${item.title}\n\n${(text || '').slice(0, 9000)}`;
  const story = (x) => JSON.stringify({ section: x.section, head: x.head, dek: x.dek, take: x.take, social: x.social, visual_big: x.visual_big, visual_small: x.visual_small, body: x.body, poll: x.poll }, null, 1);
  const scores = [];
  for (let round = 1; round <= 2; round++) {
    try {
      const r = await claudeJson({ system: PANEL, schema: PANEL_SCHEMA, effort: 'medium', maxTokens: 6000, content: `Today is ${today()}.\n\nSOURCE:\n${source}\n\nSTORY (round ${round}):\n${story(d)}` });
      const avg = r.reviews.length ? r.reviews.reduce((s, x) => s + (+x.score || 0), 0) / r.reviews.length : 0;
      scores.push(+avg.toFixed(1));
      log(`review round ${round}: ${r.reviews.map((x) => `${x.who.split(/[ ,(]/)[0]} ${x.score}`).join(', ')} (avg ${avg.toFixed(1)})`);
      if (!r.fixes.length) break;
      const v = await claudeJson({
        system: SYSTEM, schema: SCHEMA, effort: 'medium', maxTokens: 8000,
        content: `${alreadyRan()}SITE PAGES (ours, to link to):\n${SITE_PAGES}\n\nToday is ${today()}.\n${source}\n\nYOUR DRAFT:\n${story(d)}\n\nA review panel read your draft. Make every fix below that is true to the source and to the rules, then return the whole story again (all fields). Keep publish=true, the same section, slug and photo_queries unless a fix says otherwise. Never add a fact that is not in the source.\n\nFIXES:\n${r.fixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}`,
      });
      if (!v.publish || !v.head || !v.body) { log(`review round ${round}: revision came back empty; keeping the earlier draft`); break; }
      for (const k of ['head', 'dek', 'take', 'visual_big', 'visual_small']) v[k] = clean(v[k]);
      v.social = String(v.social || d.social).replace(/\s*[—–]\s*/g, ', ').trim().slice(0, 600);
      v.body = String(v.body || '').replace(/\s*[—–]\s*/g, ', ').trim();
      d = { ...d, ...v, slug: d.slug, photo_queries: d.photo_queries?.length ? d.photo_queries : v.photo_queries };
    } catch (e) { log(`review round ${round} failed, keeping the draft so far: ${e.message}`); break; }
  }
  d.review_scores = scores;
  return d;
}

// ---------- photo: an openly licensed picture of the place or topic, picked by Claude from Wikimedia Commons ----------
const OK_LICENCE = /^(cc0|public domain|pdm|cc by(-sa)? \d(\.\d)?)$/i;
async function commonsSearch(q) {
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '10', gsrsearch: `${q} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1200' });
  const d = await get(u, 'json');
  return Object.values(d.query?.pages || {}).map((p) => {
    const ii = p.imageinfo?.[0] || {}, m = ii.extmetadata || {};
    return { title: p.title.slice(5), thumb: ii.thumburl, w: ii.width, h: ii.height, page: ii.descriptionurl, licence: strip(m.LicenseShortName?.value || ''), artist: strip(m.Artist?.value || '').slice(0, 80) };
  }).filter((c) => c.thumb && c.w >= 1000 && c.w >= c.h && OK_LICENCE.test(c.licence));
}
// Every story gets a picture: when Commons has nothing that fits (and for council stories, which get the council's faces),
// pick from our own library of Squamish photos (data/news-library.json).
const LIBRARY = (readJson(path.join(ROOT, 'data', 'news-library.json'), { photos: [] }).photos || []);
const LIB_BY_SECTION = { council: 0, vote: 0, weather: 1, move: 2, money: 3, community: 4, housing: 3, recon: 8, safety: 6 };
const libPhoto = (p) => p && { remote: `${ORIGIN}${p.file}`, ...(p.og ? { og: p.og } : {}), alt: p.alt, caption: p.caption, credit: p.credit, link: /^https?:/.test(p.link) ? p.link : `${ORIGIN}${p.link}` };
async function libraryPhoto(d) {
  const fallback = () => libPhoto(LIBRARY[LIB_BY_SECTION[d.section] ?? 6] || LIBRARY[0]);
  if (!LIBRARY.length) return null;
  try {
    const x = await claudeJson({
      system: 'Pick the photo that best suits a short local news story in Squamish, B.C., from our own library. Always pick one. For stories about council, the mayor or a council meeting, pick the council photo.',
      schema: { type: 'object', additionalProperties: false, required: ['index'], properties: { index: { type: 'integer' } } }, effort: 'low', maxTokens: 300,
      content: `Story (${d.section}): ${d.head}\n${d.dek}\n\nLibrary:\n${LIBRARY.map((p, i) => `${i}: ${p.caption} Suits: ${p.use}`).join('\n')}`,
    });
    return libPhoto(LIBRARY[x.index]) || fallback();
  } catch (e) { log('library pick failed', e.message); return fallback(); }
}
// The main photo plus up to two more for inside the full story (people like pictures).
async function findPhotos(d) {
  const commons = await commonsPhoto(d).catch((e) => { log('photo pick failed', e.message); return null; });
  const picks = commons || [];
  if (d.section === 'council' || d.section === 'vote' || !picks.length) return { photo: await libraryPhoto(d), photos: picks.slice(0, 2) };
  return { photo: picks[0], photos: picks.slice(1, 3) };
}
async function commonsPhoto(d) {
  const cands = [];
  for (const q of (d.photo_queries || []).slice(0, 4)) {
    try { for (const c of await commonsSearch(q)) if (!cands.some((x) => x.thumb === c.thumb)) cands.push(c); } catch (e) { log('photo search failed', q, e.message); }
    if (cands.length >= 10) break;
  }
  // Download the candidates here and send the bytes, so one picture Commons won't serve can't sink the whole pick.
  const list = [];
  for (const c of cands.slice(0, 10)) {
    try {
      const r = await fetch(c.thumb, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      const type = (r.headers.get('content-type') || '').split(';')[0];
      if (!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) continue;
      list.push({ ...c, data: Buffer.from(await r.arrayBuffer()).toString('base64'), type });
    } catch { /* skip that one */ }
  }
  if (!list.length) return null;
  const pick = await claudeJson({
    system: 'You pick photos for a local news story in Squamish, B.C. Pick one that clearly shows the place or topic and would not mislead (no photo that looks like it shows the actual event, no people who could be mistaken for those in the story, nothing outside the Squamish area unless the story is regional). Prefer well lit, landscape, uncluttered photos. Return the best one first, then up to two more that also fit and show something different (not near duplicates). Return an empty list if none fit.',
    schema: { type: 'object', additionalProperties: false, required: ['picks'], properties: { picks: { type: 'array', description: 'best first, at most 3', items: { type: 'object', additionalProperties: false, required: ['index', 'alt', 'caption'], properties: { index: { type: 'integer' }, alt: { type: 'string' }, caption: { type: 'string', description: 'short plain caption saying what the photo shows, e.g. "Howe Sound, seen from above Squamish."' } } } } } },
    effort: 'low', maxTokens: 1000,
    content: [
      { type: 'text', text: `Story: ${d.head}\n${d.dek}\n\nPhotos (numbered from 0):` },
      ...list.flatMap((c, i) => [{ type: 'text', text: `${i}: ${c.title}` }, { type: 'image', source: { type: 'base64', media_type: c.type, data: c.data } }]),
    ],
  });
  const seen = new Set();
  const out = (pick.picks || []).filter((p) => list[p.index] && !seen.has(p.index) && seen.add(p.index)).slice(0, 3)
    .map((p) => { const c = list[p.index]; return { remote: c.thumb, alt: clean(p.alt), caption: clean(p.caption), credit: `${c.artist || 'Unknown photographer'}, ${c.licence}`, link: c.page }; });
  return out.length ? out : null;
}

// ---------- email Jeff ----------
async function emailDrafts(rows) {
  const to = process.env.NEWS_REVIEW_TO;
  if (!to || !process.env.RESEND_API_KEY) { log('no NEWS_REVIEW_TO or RESEND_API_KEY; drafts saved but not emailed'); return; }
  // The email shows the story the way the site will: photo, section, headline, number, summary, full story, source.
  // Approve and Decline open the preview page with the two buttons (mail apps scan links, so a link alone never approves).
  const bodyMail = (md) => mdToHtml(md)
    .replace(/<h2>/g, '<h2 style="font-family:Georgia,serif;font-size:19px;line-height:1.25;margin:22px 0 8px;color:#14211c">')
    .replace(/<p>/g, '<p style="margin:0 0 12px">').replace(/<ul>/g, '<ul style="margin:0 0 12px;padding-left:22px">').replace(/<li>/g, '<li style="margin:0 0 6px">')
    .replace(/href="\//g, `href="${ORIGIN}/`).replace(/<a /g, '<a style="color:#0b5cab" ');
  const mailFig = (p) => `<img src="${esc(p.remote)}" alt="${esc(p.alt)}" width="524" style="width:100%;height:auto;display:block;border-radius:8px;margin:14px 0 4px"><p style="margin:0 0 14px;font-size:12px;color:#5d6661">${esc(p.caption)} Photo: ${esc(p.credit)}</p>`;
  const review = (r) => `${ORIGIN}/api/news-review/?id=${r.id}&amp;t=${r.token}`;
  const btns = (r) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0 4px"><tr>
<td style="padding-right:8px"><a href="${review(r)}" style="background:#0f4c3a;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Approve</a></td>
<td><a href="${review(r)}" style="background:#e7e3d8;color:#14211c;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block">Decline</a></td></tr></table>`;
  const card = (r) => { const d = r.draft; return `<div style="border:1px solid #d9d5c8;border-radius:14px;margin:0 0 22px;background:#fff;overflow:hidden">
${d.photo ? `<img src="${esc(d.photo.remote)}" alt="${esc(d.photo.alt)}" width="560" style="width:100%;height:auto;display:block"><p style="margin:6px 18px 0;font-size:12px;color:#5d6661">${esc(d.photo.caption)} Photo: ${esc(d.photo.credit)}</p>` : ''}
<div style="padding:16px 18px 18px">
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#7a3a78">${esc(SEC_NAME[d.section] || 'News')}</p>
<h2 style="font-family:Georgia,serif;font-size:26px;line-height:1.15;margin:0 0 12px;color:#14211c">${esc(d.head)}</h2>
${d.visual_big ? `<p style="margin:0 0 12px;font-family:Georgia,serif;font-size:34px;font-weight:700;line-height:1;color:#7a3a78">${esc(d.visual_big)}<br><span style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#3f4b45">${esc(d.visual_small)}</span></p>` : ''}
<p style="margin:0 0 12px;font-size:17px">${esc(d.dek)}</p>
${d.take ? `<p style="margin:0 0 14px;border-left:3px solid #7a3a78;padding-left:12px"><span style="display:block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#7a3a78">What changes</span>${esc(d.take)}</p>` : ''}
${placePhotos(d.body ? bodyMail(d.body) : '', (d.photos || []).map(mailFig))}
<p style="margin:10px 0 0;font-size:13px;color:#5d6661">Source: <a href="${esc(r.item.url)}" style="color:#5d6661">${esc(r.item.label)}</a></p>
${r.item.tip ? `<p style="margin:10px 0 0;padding:10px 12px;background:#fdf3d4;border-radius:8px;font-size:14px"><b>This came in as a tip.</b> Check it against the original post before you approve.</p>` : ''}
${btns(r)}</div></div>`; };
  const subject = rows.length === 1 ? `News to approve: ${rows[0].draft.head}` : `${rows.length} news stories to approve`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject,
      html: `<!doctype html><html><body style="margin:0;background:#f7f5ef;font:16px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#14211c"><div style="max-width:560px;margin:0 auto;padding:20px 14px">
<p style="font-weight:700;color:#0f4c3a;margin:0 0 12px">Squamish Voters News: ${rows.length === 1 ? 'a new story is' : 'new stories are'} waiting for your OK</p>${rows.map(card).join('')}
<p style="font-size:13px;color:#5d6661">Nothing goes on the site until you tap Approve. Ignored drafts just sit there.</p></div></body></html>`,
      text: rows.map((x) => `${x.draft.head}\n${x.draft.dek}\nReview: ${ORIGIN}/api/news-review/?id=${x.id}&t=${x.token}\n`).join('\n') }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  log(`emailed ${rows.length} draft(s)`);
}

// ---------- publish: every approved draft goes into data/news.json ----------
const news = readJson(NEWS_FILE);
let publishedCount = 0;
async function publishApproved() {
const REMOVED = new Set(readJson(path.join(ROOT, 'api', '_removed.json'), { slugs: [] }).slugs || []); // stories taken down by hand
const approved = (await sql`SELECT * FROM sv_news WHERE status = 'approved' ORDER BY decided_at`).filter((r) => !REMOVED.has(r.draft?.slug));
for (const r of approved) {
  const d = r.draft, it = r.item;
  let slug = d.slug; while (news.stories.some((s) => s.slug === slug)) slug += '-2';
  const story = {
    slug, s: d.section, tier: { big: 'lead', normal: 'card', brief: 'brief' }[d.weight] || 'card', date: it.date && it.date <= today() ? it.date : today(),
    head: d.head, dek: d.dek, ...(d.take ? { take: esc(d.take) } : {}), ...(d.body ? { body: d.body } : {}),
    ...(d.visual_big ? { visual: { type: 'big', big: d.visual_big, small: d.visual_small } } : {}),
    src: [it.label, it.url], ...(it.more ? { more: it.more } : {}), ...(d.social ? { social: d.social } : {}), ...(d.share ? { share: Math.min(5, Math.max(1, Math.round(d.share))) } : {}), auto: true, ...(d.areas && d.areas.length ? { areas: d.areas } : {}),
    // The vote under the story (build.mjs pollHtml): answer keys a, b, c, d; readers' own answers get x keys in the database.
    ...(d.poll && clean(d.poll.q) && (d.poll.options || []).length >= 2 ? { poll: { q: clean(d.poll.q), options: d.poll.options.slice(0, 4).map((o, i) => ({ key: 'abcd'[i], label: clean(o.label), means: clean(o.means) })) } } : {}),
  };
  if (d.photo && d.photo.remote) {
    try {
      fs.mkdirSync(PHOTO_DIR, { recursive: true });
      const buf = Buffer.from(await (await fetch(d.photo.remote, { headers: { 'User-Agent': UA } })).arrayBuffer());
      fs.writeFileSync(path.join(PHOTO_DIR, `${slug}.jpg`), buf);
      story.photo = { file: `/news/photos/${slug}.jpg`, ...(d.photo.og ? { og: d.photo.og } : {}), alt: d.photo.alt, caption: d.photo.caption, credit: d.photo.credit, link: d.photo.link };
    } catch (e) { log('photo download failed', e.message); }
  }
  for (const [i, p] of (d.photos || []).entries()) {
    try {
      const buf = Buffer.from(await (await fetch(p.remote, { headers: { 'User-Agent': UA } })).arrayBuffer());
      fs.mkdirSync(PHOTO_DIR, { recursive: true });
      fs.writeFileSync(path.join(PHOTO_DIR, `${slug}-${i + 2}.jpg`), buf);
      (story.photos ||= []).push({ file: `/news/photos/${slug}-${i + 2}.jpg`, alt: p.alt, caption: p.caption, credit: p.credit, link: p.link });
    } catch (e) { log('extra photo download failed', e.message); }
  }
  story.og = ogImage(story) || undefined;
  news.stories.unshift(story);
  await sql`UPDATE sv_news SET status = 'published', published_at = now(), draft = ${JSON.stringify({ ...d, slug })} WHERE id = ${r.id}`;
  log('published', slug);
}
if (approved.length) { news.stories.sort((a, b) => b.date.localeCompare(a.date)); writeJson(NEWS_FILE, news); }
publishedCount += approved.length;
}
await publishApproved(); // anything approved by hand since the last pass
const AUTO = process.env.NEWS_APPROVAL !== '1';

// ---------- 2. scan for new items ----------
const [{ n: known }] = await sql`SELECT count(*)::int AS n FROM sv_news`;
const firstRun = known === 0;
const found = [];
for (const [name, fn] of Object.entries(SOURCES)) {
  try { const items = await fn(); log(`${name}: ${items.length}`); found.push(...items); } catch (e) { log(`${name} failed: ${e.message}`); }
}
const ids = found.map((i) => idOf(i.key));
const seen = new Set((await sql`SELECT id FROM sv_news WHERE id = ANY(${ids})`).map((r) => r.id));
let fresh = found.filter((i) => !seen.has(idOf(i.key)));
if (firstRun) { // the first run only records what is already out there, so the inbox doesn't fill with old news
  for (const i of fresh) await sql`INSERT INTO sv_news (id, source, source_url, title, status, item) VALUES (${idOf(i.key)}, ${i.source}, ${i.url}, ${i.title}, 'skipped', ${JSON.stringify(i)}) ON CONFLICT DO NOTHING`;
  log(`first run: recorded ${fresh.length} existing items without drafting`);
  fresh = [];
}
if (process.env.NEWS_DRAFT_ONE === '1' && !fresh.length && found.length) { // test the approval email with one real item
  const pick = [...found].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (a.source === 'weather' ? -1 : 1))[0]; // the newest item
  await sql`DELETE FROM sv_news WHERE id = ${idOf(pick.key)} AND status = 'skipped'`;
  fresh = [pick];
}
const drafted = [], failures = [];
for (const i of fresh) {
  const id = idOf(i.key);
  if (drafted.length >= MAX_DRAFTS) break; // the rest wait for the next run
  try {
    const d = await draft(i);
    if (!d.publish) {
      await sql`INSERT INTO sv_news (id, source, source_url, title, status, item, draft) VALUES (${id}, ${i.source}, ${i.url}, ${i.title}, 'skipped', ${JSON.stringify(i)}, ${JSON.stringify(d)}) ON CONFLICT DO NOTHING`;
      log('skipped:', i.title, '|', d.reason);
      continue;
    }
    Object.assign(d, await findPhotos(d));
    const token = crypto.randomBytes(18).toString('base64url');
    const auto = AUTO && !i.tip; // tips come from anyone, so they always wait for Jeff's OK
    const status = auto ? 'approved' : 'pending';
    await sql`INSERT INTO sv_news (id, source, source_url, title, status, token, item, draft, decided_at) VALUES (${id}, ${i.source}, ${i.url}, ${i.title}, ${status}, ${token}, ${JSON.stringify(i)}, ${JSON.stringify(d)}, ${auto ? new Date().toISOString() : null})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, token = EXCLUDED.token, draft = EXCLUDED.draft, decided_at = EXCLUDED.decided_at`;
    drafted.push({ id, token, item: i, draft: d });
    draftedHeads.push(`${d.head}. ${String(d.dek || '').slice(0, 200)}`);
    log('drafted:', d.head);
  } catch (e) { log('draft failed:', i.title, e.message); failures.push({ i, msg: String(e.message || e).slice(0, 400) }); }
}
// Alarm: a story that fails 3 passes in a row (about 30 minutes) emails Jeff once, so a broken drafter never sits silent again (Nov 3 to 5 2026).
for (const f of failures) {
  const [row] = await sql`INSERT INTO sv_news (id, source, source_url, title, status, item) VALUES (${idOf('fail-' + f.i.key)}, ${f.i.source}, ${f.i.url}, ${f.i.title}, 'failing', ${JSON.stringify({ count: 1, error: f.msg })})
    ON CONFLICT (id) DO UPDATE SET item = jsonb_build_object('count', (sv_news.item->>'count')::int + 1, 'error', ${f.msg}::text) RETURNING (item->>'count')::int AS count`;
  if (row?.count !== 3) continue;
  const to = process.env.NEWS_REVIEW_TO;
  if (!to || !process.env.RESEND_API_KEY) { log('alarm: no NEWS_REVIEW_TO or RESEND_API_KEY'); continue; }
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject: `Squamish Voters News is stuck: "${f.i.title}" failed 3 times`,
      text: `The News scanner has failed to write this story 3 passes in a row (about 30 minutes), so nothing new is publishing for it.\n\nStory: ${f.i.title}\nSource: ${f.i.label} ${f.i.url}\nError: ${f.msg}\n\nLogs: https://github.com/jeffkirdeikis/squamish-voters/actions/workflows/news.yml\nAsk Claude to look at it.` }) }).catch((e) => ({ ok: false, statusText: e.message }));
  log(r.ok ? `alarm emailed: ${f.i.title}` : `alarm email failed: ${r.statusText}`);
}
const toEmail = drafted.filter((r) => !AUTO || r.item.tip);
if (toEmail.length) await emailDrafts(toEmail);
if (AUTO) await publishApproved(); // straight onto the site this pass
log(`done: ${publishedCount} published, ${drafted.length} drafted`);
