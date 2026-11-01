// Squamish news, run by .github/workflows/news.yml every 10 minutes (no computer needs to be on).
//   1. Publish: drafts Jeff approved (api/news-review.js) go into data/news.json with a share picture.
//   2. Scan: check public sources for anything new, have Claude draft a short story in our own words,
//      save it as 'pending' and email Jeff a link to read, edit and approve it.
// Every source here allows plain automated reading. We never get around a site's bot check: the District's own
// news page blocks scripts, so District news comes in through its weekly E-News email instead (see district() below).
// The Squamish Chief is not a source: its stories are its own reporting.
//   NEWS_DRAFT_ONE=1  draft the newest item from one source even if it was seen before (to test the email).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';
import { ROOT, log, readJson, writeJson, claudeJson } from './lib.mjs';

const NEWS_FILE = path.join(ROOT, 'data', 'news.json');
const OG_DIR = path.join(ROOT, 'public', 'news', 'og');
const PHOTO_DIR = path.join(ROOT, 'public', 'news', 'photos');
const ORIGIN = 'https://squamishvoters.com';
const UA = 'SquamishVotersNews/1.0 (+https://squamishvoters.com/news/; plain-language local news)';
const MAX_DRAFTS = 4; // per run, so a burst of releases can't flood the inbox
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);

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
  const main = (h.match(/<(article|main)[\s\S]*?<\/\1>/i) || [h])[0];
  return strip(main).slice(0, max);
};

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
      if (m.summary && m.date >= recent && m.date <= t) {
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
        const online = ((html.match(/href="(https:\/\/app\.cyberimpact\.com\/newsletter-view-online[^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&');
        const x = await claudeJson({
          system: 'You read the District of Squamish weekly email newsletter and list its separate news items. Use only what the newsletter says. Leave out: council meeting times and agendas (we cover meetings separately), job postings, holiday hours, recurring reminders with nothing new, and the newsletter header and footer.',
          schema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text', 'link'], properties: { title: { type: 'string' }, text: { type: 'string', description: 'everything the newsletter says about this item, close to its own words, with dates, places and numbers' }, link: { type: 'string', description: 'the item\'s "learn more" link if it has one, else empty' } } } } } },
          effort: 'low', maxTokens: 6000, content: `Subject: ${e.subject}\nSent: ${e.created_at}\n\n${text.slice(0, 30000)}\n\nLinks in the email:\n${[...new Set((html.match(/href="(https?:[^"]+)"/g) || []).map((h) => h.slice(6, -1).replace(/&amp;/g, '&')))].filter((u) => !/unsubscribe|cyberimpact\.com\/(?!newsletter-view-online)|facebook|instagram|twitter|x\.com|linkedin|youtube\.com\/@/i.test(u)).slice(0, 80).join('\n')}`,
        });
        const date = new Date(e.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
        const items = (x.items || []).map((it, n) => ({ key: `enews-${e.id}-${n}`, source: 'district', label: 'District of Squamish E-News', url: /^https?:/.test(it.link) ? it.link : (online || 'https://squamish.ca/government-and-administration/district-information/enews-archives/'), title: it.title, date, text: it.text }));
        await sql`INSERT INTO sv_news (id, source, source_url, title, status, item) VALUES (${issueId}, 'district', ${online || null}, ${e.subject}, 'issue', ${JSON.stringify({ items })}) ON CONFLICT DO NOTHING`;
        log(`district: newsletter "${e.subject}" has ${items.length} items`);
        row = { item: { items } };
      }
      out.push(...(row.item?.items || []));
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
- Headline: specific, under 90 characters, sentence case, no clickbait, no colon if you can avoid it.
- dek: 2 to 4 sentences with the key facts (who, what, when, where).
- take: one sentence that says what changes for residents or what they can do, strictly factual. Empty if there is nothing useful.
- weight: "big" only for something most residents care about (a major closure, an election result, a big decision); "brief" for small notices; otherwise "normal".
- visual: a key number or date from the source (like "Nov 16" with "Application deadline", or "90 km/h" with "Wind gusts") or null. Never invent one.
- Skip (publish=false): routine meeting notices, holiday hours, job postings, items not about the Squamish area, items with too little information, and anything already stale.
- section: one of ${SECTIONS.join(', ')}.
- areas: the Squamish neighbourhoods the story is about, from this list only: ${HOOD_SLUGS.join(', ')}. Empty if it is town-wide or outside these areas.
- body: the full story in markdown, shown under the summary on the story page. This is where the detail goes, so never leave it thin: 150 to 450 words in 2 to 5 sections, each starting with "## " and a plain heading (for example "What happens", "The details", "Who it affects", "What comes next", "How to take part"). Use "- " bullets for lists of dates, items, places or numbers. Put in every useful fact from the source: dates, times, places, amounts, names, deadlines, how to apply or comment. Do not repeat the dek word for word. Link to our own pages from the SITE PAGES list with [text](/path/) where they really help (a council member's page when you name them, the meeting page, an issue page), and to the source with its full https link. Only facts from the source or the SITE PAGES list; never guess.
- Any story about an event or meeting people can attend or watch MUST have a "## How to take part" (or "## Where and when") section with "- " bullets covering everything the source gives: the start time AND the time the main part begins if different (e.g. doors 6 p.m., ceremony 6:30 p.m.); the full address; whether it is open to the public; seating limits, overflow rooms or registration; a direct link to watch live (District of Squamish meetings stream at https://www.youtube.com/@DistrictofSquamish/streams); phone or WebEx call in details; and links to the agenda and our meeting page. Never write just "it's live streamed" without the watch link. The take line should name the single most practical detail (for example limited seating, or when the main part starts).
- photo_queries: 2 or 3 short searches for an openly licensed photo of the PLACE or TOPIC (not the event itself), most specific first, e.g. "Howe Sound Squamish", "Sea to Sky Highway", "downtown Squamish".`;
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['publish', 'reason', 'section', 'weight', 'head', 'dek', 'take', 'body', 'visual_big', 'visual_small', 'slug', 'photo_queries', 'areas'],
  properties: {
    publish: { type: 'boolean' }, reason: { type: 'string' }, section: { type: 'string', enum: SECTIONS }, weight: { type: 'string', enum: ['big', 'normal', 'brief'] },
    head: { type: 'string' }, dek: { type: 'string' }, take: { type: 'string' }, body: { type: 'string', description: 'full story in markdown (## headings, - bullets, [links](/path/))' }, visual_big: { type: 'string' }, visual_small: { type: 'string' },
    slug: { type: 'string', description: 'short url slug, lowercase words joined by hyphens, under 50 characters' },
    photo_queries: { type: 'array', items: { type: 'string' } },
    areas: { type: 'array', items: { type: 'string', enum: HOOD_SLUGS.length ? HOOD_SLUGS : ['downtown'] } },
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

async function draft(item) {
  let text = item.text;
  if (!text || text.length < 200) { try { text = await pageText(item.url); } catch (e) { log('page text failed', item.url, e.message); } }
  const d = await claudeJson({
    system: SYSTEM, schema: SCHEMA, effort: 'medium', maxTokens: 8000,
    content: `SITE PAGES (ours, to link to):\n${SITE_PAGES}\n\nToday is ${today()}.\nSource: ${item.label}\nURL: ${item.url}\nPublished: ${item.date}\nTitle: ${item.title}\n\n${(text || '').slice(0, 9000)}`,
  });
  for (const k of ['head', 'dek', 'take', 'visual_big', 'visual_small']) d[k] = clean(d[k]);
  d.body = String(d.body || '').replace(/\s*[—–]\s*/g, ', ').trim();
  d.slug = String(d.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `story-${Date.now()}`;
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
async function findPhoto(d) {
  if (d.section === 'council' || d.section === 'vote') return libraryPhoto(d);
  return (await commonsPhoto(d).catch((e) => { log('photo pick failed', e.message); return null; })) || libraryPhoto(d);
}
async function commonsPhoto(d) {
  const cands = [];
  for (const q of (d.photo_queries || []).slice(0, 3)) {
    try { for (const c of await commonsSearch(q)) if (!cands.some((x) => x.thumb === c.thumb)) cands.push(c); } catch (e) { log('photo search failed', q, e.message); }
    if (cands.length >= 8) break;
  }
  if (!cands.length) return null;
  const list = cands.slice(0, 8);
  const pick = await claudeJson({
    system: 'You pick a photo for a short local news story in Squamish, B.C. Pick one that clearly shows the place or topic and would not mislead (no photo that looks like it shows the actual event, no people who could be mistaken for those in the story, nothing outside the Squamish area unless the story is regional). Prefer well lit, landscape, uncluttered photos. Return -1 if none fit.',
    schema: { type: 'object', additionalProperties: false, required: ['index', 'alt', 'caption'], properties: { index: { type: 'integer' }, alt: { type: 'string' }, caption: { type: 'string', description: 'short plain caption saying what the photo shows, e.g. "Howe Sound, seen from above Squamish."' } } },
    effort: 'low', maxTokens: 1000,
    content: [
      { type: 'text', text: `Story: ${d.head}\n${d.dek}\n\nPhotos (numbered from 0):` },
      ...list.flatMap((c, i) => [{ type: 'text', text: `${i}: ${c.title}` }, { type: 'image', source: { type: 'url', url: c.thumb } }]),
    ],
  });
  const c = list[pick.index];
  if (!c) return null;
  return { remote: c.thumb, alt: clean(pick.alt), caption: clean(pick.caption), credit: `${c.artist || 'Unknown photographer'}, ${c.licence}`, link: c.page };
}

// ---------- email Jeff ----------
async function emailDrafts(rows) {
  const to = process.env.NEWS_REVIEW_TO;
  if (!to || !process.env.RESEND_API_KEY) { log('no NEWS_REVIEW_TO or RESEND_API_KEY; drafts saved but not emailed'); return; }
  const card = (r) => `<div style="border:1px solid #d9d5c8;border-radius:12px;padding:16px;margin:0 0 16px;background:#fff">
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2457a6">${esc(r.item.label)}</p>
${r.draft.photo ? `<img src="${esc(r.draft.photo.remote)}" alt="" width="528" style="width:100%;height:auto;border-radius:8px;margin:0 0 4px;display:block"><p style="margin:0 0 10px;font-size:12px;color:#5d6661">Photo: ${esc(r.draft.photo.credit)}</p>` : ''}<h2 style="font-family:Georgia,serif;font-size:21px;line-height:1.25;margin:0 0 8px">${esc(r.draft.head)}</h2>
<p style="margin:0 0 8px;color:#3f4b45">${esc(r.draft.dek)}</p>${r.draft.take ? `<p style="margin:0 0 12px;border-left:3px solid #0f4c3a;padding-left:10px">${esc(r.draft.take)}</p>` : ''}${r.draft.body ? `<p style="margin:0 0 8px;font-size:13px;color:#5d6661">Plus a full story of about ${r.draft.body.split(/\s+/).length} words with ${(r.draft.body.match(/^## /gm) || []).length} sections. Read it on the review page.</p>` : ''}
<p style="margin:14px 0 4px"><a href="${ORIGIN}/api/news-review/?id=${r.id}&amp;t=${r.token}" style="background:#0f4c3a;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;display:inline-block">Review and approve</a></p>
<p style="margin:6px 0 0;font-size:13px;color:#5d6661">Source: <a href="${esc(r.item.url)}" style="color:#5d6661">${esc(r.item.title)}</a>${r.item.more ? ` · Story links to <a href="${ORIGIN}${esc(r.item.more[1])}" style="color:#5d6661">${esc(r.item.more[0].toLowerCase())}</a>` : ''}</p></div>`;
  const subject = rows.length === 1 ? `News to approve: ${rows[0].draft.head}` : `${rows.length} news stories to approve`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject,
      html: `<!doctype html><html><body style="margin:0;background:#f7f5ef;font:16px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#14211c"><div style="max-width:560px;margin:0 auto;padding:20px 14px">
<p style="font-weight:700;color:#0f4c3a;margin:0 0 12px">Squamish Voters News: ${rows.length === 1 ? 'a new story is' : 'new stories are'} waiting for your OK</p>${rows.map(card).join('')}
<p style="font-size:13px;color:#5d6661">Nothing goes on the site until you approve it. You can fix the wording on the review page first. Ignored drafts just sit there.</p></div></body></html>`,
      text: rows.map((x) => `${x.draft.head}\n${x.draft.dek}\nReview: ${ORIGIN}/api/news-review/?id=${x.id}&t=${x.token}\n`).join('\n') }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  log(`emailed ${rows.length} draft(s)`);
}

// ---------- share picture ----------
const SEC_NAME = { vote: 'Elections', council: 'Council', money: 'Your money', community: 'Community', housing: 'Housing', recon: 'Reconciliation', move: 'Getting around', safety: 'Safety', weather: 'Weather' };
function ogImage(story) {
  const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((c) => { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } });
  if (!chrome) { log('no Chrome; skipping share picture'); return null; }
  const tpl = fs.readFileSync(path.join(ROOT, 'scripts', 'pipeline', 'news-og.html'), 'utf8');
  const data = { head: story.head, sec: SEC_NAME[story.s] || 'News', s: story.s, date: new Date(story.date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }), big: story.visual?.big || '', small: story.visual?.small || '', photo: story.photo ? `file://${path.join(ROOT, 'public', story.photo.og || story.photo.file)}` : '' }; // og: a share-picture version that leaves room for the headline
  const tmp = path.join(OG_DIR, `.tmp-${story.slug}.html`);
  fs.writeFileSync(tmp, tpl.replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c')));
  const out = path.join(OG_DIR, `${story.slug}.png`);
  try {
    execFileSync(chrome, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--hide-scrollbars', '--window-size=1200,630', '--virtual-time-budget=5000', `--screenshot=${out}`, `file://${tmp}`], { stdio: 'ignore', timeout: 60000 });
  } finally { fs.rmSync(tmp, { force: true }); }
  return fs.existsSync(out) ? `${story.slug}.png` : null;
}

// ---------- 1. publish what Jeff approved ----------
const news = readJson(NEWS_FILE);
const approved = await sql`SELECT * FROM sv_news WHERE status = 'approved' ORDER BY decided_at`;
for (const r of approved) {
  const d = r.draft, it = r.item;
  let slug = d.slug; while (news.stories.some((s) => s.slug === slug)) slug += '-2';
  const story = {
    slug, s: d.section, tier: { big: 'lead', normal: 'card', brief: 'brief' }[d.weight] || 'card', date: it.date && it.date <= today() ? it.date : today(),
    head: d.head, dek: d.dek, ...(d.take ? { take: esc(d.take) } : {}), ...(d.body ? { body: d.body } : {}),
    ...(d.visual_big ? { visual: { type: 'big', big: d.visual_big, small: d.visual_small } } : {}),
    src: [it.label, it.url], ...(it.more ? { more: it.more } : {}), auto: true, ...(d.areas && d.areas.length ? { areas: d.areas } : {}),
  };
  if (d.photo && d.photo.remote) {
    try {
      fs.mkdirSync(PHOTO_DIR, { recursive: true });
      const buf = Buffer.from(await (await fetch(d.photo.remote, { headers: { 'User-Agent': UA } })).arrayBuffer());
      fs.writeFileSync(path.join(PHOTO_DIR, `${slug}.jpg`), buf);
      story.photo = { file: `/news/photos/${slug}.jpg`, ...(d.photo.og ? { og: d.photo.og } : {}), alt: d.photo.alt, caption: d.photo.caption, credit: d.photo.credit, link: d.photo.link };
    } catch (e) { log('photo download failed', e.message); }
  }
  story.og = ogImage(story) || undefined;
  news.stories.unshift(story);
  await sql`UPDATE sv_news SET status = 'published', published_at = now(), draft = ${JSON.stringify({ ...d, slug })} WHERE id = ${r.id}`;
  log('published', slug);
}
if (approved.length) { news.stories.sort((a, b) => b.date.localeCompare(a.date)); writeJson(NEWS_FILE, news); }

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
const drafted = [];
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
    d.photo = await findPhoto(d);
    const token = crypto.randomBytes(18).toString('base64url');
    await sql`INSERT INTO sv_news (id, source, source_url, title, status, token, item, draft) VALUES (${id}, ${i.source}, ${i.url}, ${i.title}, 'pending', ${token}, ${JSON.stringify(i)}, ${JSON.stringify(d)})
      ON CONFLICT (id) DO UPDATE SET status = 'pending', token = EXCLUDED.token, draft = EXCLUDED.draft`;
    drafted.push({ id, token, item: i, draft: d });
    log('drafted:', d.head);
  } catch (e) { log('draft failed:', i.title, e.message); }
}
if (drafted.length) await emailDrafts(drafted);
log(`done: ${approved.length} published, ${drafted.length} drafted`);
