// Is a District of Squamish meeting streaming on YouTube right now? Powers the "Council is live" strip (src/council-live.js).
//   GET -> { live: true, title, url } or { live: false, next?: { title, url, starts } }
// Reads the channel's public /live page (no API key): while a stream is on it is that stream's watch page, otherwise
// the next scheduled stream or the channel. Cached at the edge for two minutes so a busy night is one fetch.
const LIVE = 'https://www.youtube.com/@DistrictofSquamish/live';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36';

export function parseLive(html) {
  const id = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1];
  if (!id) return { live: false };
  const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '').replace(/ - YouTube$/, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const url = `https://www.youtube.com/watch?v=${id}`;
  if (/"isLiveNow":true/.test(html)) return { live: true, title, url };
  const at = (html.match(/"scheduledStartTime":"(\d+)"/) || [])[1];
  if (at && +at * 1000 > Date.now()) return { live: false, next: { title, url, starts: new Date(+at * 1000).toISOString() } };
  return { live: false };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');
  try {
    const r = await fetch(LIVE, { headers: { 'user-agent': UA, 'accept-language': 'en-CA,en;q=0.9', cookie: 'CONSENT=YES+1; SOCS=CAI' } });
    const html = await r.text();
    const out = parseLive(html);
    if (req.query && req.query.debug === '1') out.debug = { status: r.status, url: r.url, len: html.length, title: (html.match(/<title>[^<]*/) || [])[0], canon: (html.match(/<link rel="canonical"[^>]*>/) || [])[0] };
    return res.json(out);
  } catch (e) {
    return res.json({ live: false, error: 'check failed' });
  }
}
