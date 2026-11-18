// Is a District of Squamish meeting streaming on YouTube right now? Powers the "Council is live" strip (src/council-live.js).
//   GET -> { live: true, title, url } or { live: false }
// YouTube shows server traffic a bot check on its channel pages, so this reads the channel's public video feed (Atom XML,
// no key) for the newest videos, then asks each recent one's watch page whether it is live now. Cached at the edge for
// two minutes so a busy night is a handful of fetches.
const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCYUnwGUWAIyeB2aoU8gqzAw';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36';
const H = { 'user-agent': UA, 'accept-language': 'en-CA,en;q=0.9', cookie: 'CONSENT=YES+1; SOCS=CAI' };

export function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: (e.match(/<yt:videoId>([\w-]{11})</) || [])[1],
    title: ((e.match(/<title>([^<]*)</) || [])[1] || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
    published: (e.match(/<published>([^<]+)</) || [])[1],
  })).filter((v) => v.id);
}

export const isLiveNow = (html) => /"isLiveNow":true/.test(html) || (/"isLive":true/.test(html) && !/"endTimestamp"/.test(html) && !/"isUpcoming":true/.test(html));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');
  const dbg = req.query?.debug === '1', debug = [];
  try {
    const xml = await (await fetch(FEED, { headers: H })).text();
    // A stream shows in the feed from when it is scheduled; a scheduled stream is often posted days ahead, so look two weeks back.
    const recent = parseFeed(xml).filter((v) => Date.now() - Date.parse(v.published) < 14 * 86400000).slice(0, 3);
    for (const v of recent) {
      const html = await (await fetch(`https://www.youtube.com/watch?v=${v.id}`, { headers: H })).text();
      const live = isLiveNow(html);
      if (dbg) debug.push({ id: v.id, title: v.title, len: html.length, live, bot: /not a bot/.test(html) });
      if (live) return res.json({ live: true, title: v.title, url: `https://www.youtube.com/watch?v=${v.id}`, ...(dbg ? { debug } : {}) });
    }
    return res.json({ live: false, ...(dbg ? { debug, feed: recent.length, feedLen: xml.length } : {}) });
  } catch (e) {
    return res.json({ live: false, error: 'check failed', ...(dbg ? { msg: String(e) } : {}) });
  }
}
