// Live election-night results. Looks for the District of Squamish results page, reads each candidate's vote count,
// and returns JSON the /results/ page polls. The CDN caches it for 30 s so the District's site sees almost no load.
const BASE = 'https://squamish.ca';
// Pages that link to the results once they are up, and the address pattern the District used in 2022.
const INDEXES = ['/government-and-administration/council/election/', '/'];
const GUESSES = ['/Squamish2026ElectionResultsDisplay/', '/Squamish2026ElectionResults/', '/2026ElectionResults/', '/ElectionResultsDisplay/', '/election-results/'];

// Each candidate is matched by first name (or what they may be listed as) followed closely by last name,
// so Brown/Brownie and the two Lowes stay apart.
const RACES = {
  mayor: [['Daniel Deal', 'Dan(?:iel)?', 'Deal'], ['Sean Easton', 'Sean', 'Easton'], ['Jenna Stoner', 'Jenna', 'Stoner']],
  council: [['Eric Andersen', 'Eric', 'Andersen'], ['Ian Brown', 'Ian', 'Brown(?!ie)'], ['Kieran Brownie', 'Kieran', 'Brownie'], ['Janice DesJardins', 'Janice', 'Des ?Jardins'], ['Sarah Ellis', 'Sarah', 'Ellis'], ['John French', 'John', 'French'], ['Sean Goodwin', 'Sean', 'Goodwin'], ['Andrew Hamilton', 'Andrew', 'Hamilton'], ['A. John Lowe', 'John', 'Lowe'], ['Anders Ourom', 'Anders', 'Ourom'], ['Luc Perreault', 'Luc', 'Perreault'], ['Chris Pettingill', 'Chris(?:topher)?', 'Pettingill'], ['Laura Prosko', 'Laura', 'Prosko'], ['Chris Ryan', 'Chris(?:topher)?', 'Ryan'], ['Shaun Veltkamp', 'Shaun', 'Veltkamp']],
  trustees: [['April Lowe', 'April', 'Lowe'], ['Leanne Roderick', 'Leanne', 'Roderick'], ['Dalia Shehata', 'Dalia', 'Shehata'], ['Lisa Turpin', 'Lisa', 'Turpin'], ['Robyn Walters', 'Robyn', 'Walters']],
};
const SEATS = { mayor: 1, council: 6, trustees: 2 };

const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/\s+/g, ' ');

async function get(path) {
  const url = path.startsWith('http') ? path : BASE + path;
  const r = await fetch(url, { headers: { 'user-agent': 'SquamishVoters results checker (squamishvoters.com)' }, redirect: 'follow', signal: AbortSignal.timeout(6000) });
  return r.ok ? { url: r.url, html: await r.text() } : null;
}

// Finds every candidate in the page text and takes the first whole number after their name as their votes.
function parse(t) {
  const hits = [];
  for (const [race, list] of Object.entries(RACES)) for (const [name, first, last] of list) {
    const m = new RegExp(`\\b${first}\\b[^\\d]{0,30}?\\b${last}\\b|\\b${last}\\b,\\s*[A-Z.\\s]{0,6}${first}\\b`, 'i').exec(t); // "First Last" or "LAST, First"
    if (m) hits.push({ race, name, at: m.index, end: m.index + m[0].length });
  }
  hits.sort((a, b) => a.at - b.at);
  const out = { mayor: [], council: [], trustees: [] };
  hits.forEach((h, i) => {
    const seg = t.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : h.end + 200);
    const v = /(?:^|[^\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?![\d.,]*\s*%)(?!\.\d)/.exec(seg);
    if (v) out[h.race].push({ name: h.name, total: Number(v[1].replace(/,/g, '')) });
  });
  return out;
}

async function find() {
  const seen = new Set(), tries = [...GUESSES];
  for (const p of INDEXES) {
    const page = await get(p).catch(() => null);
    if (!page) continue;
    for (const [, href] of page.html.matchAll(/href="([^"#]+)"/g)) {
      if (/result/i.test(href) && !/20(18|22)|\.pdf$/i.test(href)) tries.unshift(href);
    }
  }
  for (const p of tries) {
    if (seen.has(p)) continue; seen.add(p);
    const page = await get(p).catch(() => null);
    if (!page) continue;
    const t = text(page.html), r = parse(t);
    // Only trust a page that lists every mayor candidate with a number.
    if (r.mayor.length === RACES.mayor.length) {
      const pct = /(\d{1,3}(?:\.\d+)?)\s*%\s*Complete/i.exec(t) || /(\d+)\s*of\s*(\d+)\s*(?:polls|voting places|stations)/i.exec(t);
      return { url: page.url, r, progress: pct ? (pct[2] ? `${pct[1]} of ${pct[2]} reporting` : `${pct[1]}% counted`) : null };
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const f = await find();
    if (!f) return res.status(200).json({ found: false, checked: new Date().toISOString() });
    const races = {};
    for (const k of Object.keys(RACES)) {
      const rows = f.r[k].sort((a, b) => b.total - a.total);
      races[k] = { seats: SEATS[k], rows };
    }
    res.status(200).json({ found: true, source_url: f.url, progress: f.progress, checked: new Date().toISOString(), races });
  } catch (e) {
    res.status(200).json({ found: false, error: String(e && e.message), checked: new Date().toISOString() });
  }
}
export { parse, text };
