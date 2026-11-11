// Private read-back of the reading stats (api/pulse.js) for /insights/. Requires ADMIN_TOKEN in the Authorization header.
//   GET ?range=today|yesterday|7d|30d&focus=/news/some-story  -> { ok, site, timeline, pages, focus, recent }
import { initPulse, sql } from './pulse.js';

const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
const pct = (n, d) => (d ? Math.round(1000 * n / d) / 10 : 0);
const top = (m, n = 12) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, n: v }));
const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);

function source(p) {
  const r = (p.ref || '').toLowerCase(), u = (p.utm || '').toLowerCase(), a = p.app || '';
  if (/reddit/.test(r) || /reddit/.test(u) || /reddit/.test(a)) return 'Reddit';
  if (/facebook|fb\.me|fb\.com/.test(r) || /facebook|fbclid|^fb$/.test(u) || /facebook/.test(a)) return 'Facebook';
  if (/instagram/.test(r) || /instagram/.test(a) || /^ig$|instagram/.test(u)) return 'Instagram';
  if (/google\./.test(r)) return 'Google';
  if (/bing\.|duckduckgo|yahoo\.|ecosia|brave\./.test(r)) return 'Other search';
  if (/mail|outlook|resend/.test(r) || /email|newsletter|digest/.test(u)) return 'Email';
  if (/chatgpt|openai|claude|perplexity|copilot|gemini/.test(r) || /chatgpt|perplexity/.test(u)) return 'AI assistant';
  if (/t\.co$|twitter|x\.com$|linkedin|bsky|threads/.test(r)) return 'Other social';
  if (!r) return u ? 'Link with tag: ' + u : 'Direct (typed, saved, or a text message)';
  return r;
}
// Pacific time day edges
function pacificMidnight(daysAgo) {
  const now = new Date(), loc = new Date(now.toLocaleString('en-US', { timeZone: 'America/Vancouver' }));
  const off = now.getTime() - loc.getTime();
  loc.setHours(0, 0, 0, 0); loc.setDate(loc.getDate() - daysAgo);
  return new Date(loc.getTime() + Math.round(off / 9e5) * 9e5);
}
const TIME_B = [['Under 10 seconds', 0, 10], ['10 to 30 seconds', 10, 30], ['30 to 60 seconds', 30, 60], ['1 to 3 minutes', 60, 180], ['3 to 10 minutes', 180, 600], ['Over 10 minutes', 600, 1e9]];
const SCROLL_B = [['Top only (under 25%)', 0, 25], ['25 to 50%', 25, 50], ['50 to 75%', 50, 75], ['75 to 99%', 75, 100], ['Reached the bottom', 100, 101]];
const buckets = (B, vals) => B.map(([label, lo, hi]) => ({ label, n: vals.filter((v) => v >= lo && v < hi).length }));

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!sql) return res.status(503).json({ ok: false, error: 'no database' });
  await initPulse();
  const range = ['today', 'yesterday', '7d', '30d'].includes(req.query.range) ? req.query.range : 'today';
  const from = pacificMidnight(range === 'today' ? 0 : range === 'yesterday' ? 1 : range === '7d' ? 6 : 29);
  const to = range === 'yesterday' ? pacificMidnight(0) : new Date(Date.now() + 6e4);
  const [pvs, evs, first] = await Promise.all([
    sql`SELECT pv, sid, at, path, title, ref, utm, app, dev, n, ret, country, city, secs, scroll, sec, secname FROM sv_pv WHERE at >= ${from} AND at < ${to} AND sid NOT LIKE 'svtest%' ORDER BY at LIMIT 150000`,
    sql`SELECT sid, pv, at, path, name, data, secs FROM sv_ev WHERE at >= ${from} AND at < ${to} AND sid NOT LIKE 'svtest%' ORDER BY at LIMIT 300000`,
    sql`SELECT min(at) AS at FROM sv_pv WHERE sid NOT LIKE 'svtest%'`,
  ]);

  // visits
  const visits = new Map();
  for (const p of pvs) { let v = visits.get(p.sid); if (!v) visits.set(p.sid, v = { sid: p.sid, pages: [], evs: [] }); v.pages.push(p); }
  for (const e of evs) { const v = visits.get(e.sid); if (v) v.evs.push(e); }
  const V = [...visits.values()];
  for (const v of V) {
    const p0 = v.pages[0];
    v.src = source(p0); v.dev = p0.dev || ''; v.city = p0.city || ''; v.country = p0.country || ''; v.ret = v.pages.some((p) => p.ret); v.at = p0.at;
    v.secs = v.pages.reduce((a, p) => a + p.secs, 0);
    v.has = (name) => v.evs.some((e) => e.name === name);
    v.signup = v.has('signup'); v.tried = v.has('signup try'); v.fb = v.has('facebook group'); v.rd = v.has('reddit group'); v.share = v.has('share');
    v.pages.forEach((p, i) => { p.next = v.pages[i + 1] ? v.pages[i + 1].path : null; p.prev = i ? v.pages[i - 1].path : null; p.entry = i === 0; });
  }
  const rate = (list) => ({
    visits: list.length,
    pagesPerVisit: list.length ? Math.round(10 * list.reduce((a, v) => a + v.pages.length, 0) / list.length) / 10 : 0,
    wentOn: pct(list.filter((v) => new Set(v.pages.map((p) => p.path)).size > 1).length, list.length),
    medSecs: med(list.map((v) => v.secs)), avgSecs: avg(list.map((v) => v.secs)),
    tried: list.filter((v) => v.tried).length, signups: list.filter((v) => v.signup).length, signupRate: pct(list.filter((v) => v.signup).length, list.length),
    fb: list.filter((v) => v.fb).length, fbRate: pct(list.filter((v) => v.fb).length, list.length),
    reddit: list.filter((v) => v.rd).length, redditRate: pct(list.filter((v) => v.rd).length, list.length),
    shares: list.filter((v) => v.share).length, shareRate: pct(list.filter((v) => v.share).length, list.length),
    returning: pct(list.filter((v) => v.ret).length, list.length),
  });
  const group = (list, key) => { const m = new Map(); for (const v of list) { const k = key(v) || 'Unknown'; (m.get(k) || m.set(k, []).get(k)).push(v); } return [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12).map(([k, l]) => ({ k, ...rate(l) })); };

  // timeline: by hour for one day, by day for longer
  const byHour = range === 'today' || range === 'yesterday', tl = new Map();
  const tkey = (d) => new Date(d).toLocaleString('en-CA', byHour ? { timeZone: 'America/Vancouver', hour: 'numeric', hour12: true } : { timeZone: 'America/Vancouver', month: 'short', day: 'numeric' });
  for (const v of V) bump(tl, tkey(v.at));

  // pages table
  const byPath = new Map();
  for (const p of pvs) (byPath.get(p.path) || byPath.set(p.path, []).get(p.path)).push(p);
  const pages = [...byPath.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 40).map(([path, l]) => ({
    path, title: (l[l.length - 1].title || '').replace(/\s*[|·–-]\s*Squamish Voters.*$/, ''), views: l.length, medSecs: med(l.map((p) => p.secs)), medScroll: med(l.map((p) => p.scroll)),
    entries: l.filter((p) => p.entry).length, exits: l.filter((p) => !p.next).length, exitRate: pct(l.filter((p) => !p.next).length, l.length),
  }));

  // focus page
  const focusPath = req.query.focus && byPath.has(req.query.focus) ? req.query.focus : (pages[0] ? pages[0].path : null);
  let focus = null;
  if (focusPath) {
    const l = byPath.get(focusPath), fv = V.filter((v) => v.pages.some((p) => p.path === focusPath));
    const heads = (await sql`SELECT secs_all FROM sv_pv WHERE path = ${focusPath} AND secs_all IS NOT NULL ORDER BY at DESC LIMIT 1`)[0]?.secs_all || [];
    const next = new Map(), prev = new Map(), taps = new Map();
    for (const p of l) { bump(next, p.next || 'Left the site'); if (!p.entry) bump(prev, p.prev); }
    const pvset = new Set(l.map((p) => p.pv));
    for (const e of evs) if (pvset.has(e.pv)) {
      const d = e.data || {};
      const detail = e.name === 'nav' ? d.to + ' (from ' + d.at + ')' : e.name === 'out' ? d.to + ' (from ' + d.at + ')' : e.name === 'opened' ? d.what : e.name === 'share' ? d.how + ' (' + d.at + ')' : e.name === 'jump' ? d.to : e.name === 'signup' || e.name === 'signup try' ? d.kind + (d.from ? ' · ' + d.from : '') : d.at || '';
      bump(taps, e.name + '\t' + (detail || ''));
    }
    const secsOf = l.map((p) => p.secs), tapSecs = (name) => med(evs.filter((e) => pvset.has(e.pv) && e.name === name).map((e) => e.secs || 0));
    focus = {
      path: focusPath, title: pages.find((p) => p.path === focusPath)?.title || focusPath, views: l.length, ...rate(fv),
      landedHere: l.filter((p) => p.entry).length, onlyPage: pct(fv.filter((v) => new Set(v.pages.map((p) => p.path)).size === 1).length, fv.length),
      pageMedSecs: med(secsOf), pageAvgSecs: avg(secsOf), medScroll: med(l.map((p) => p.scroll)),
      time: buckets(TIME_B, secsOf), scroll: buckets(SCROLL_B, l.map((p) => p.scroll)),
      sections: heads.map((name, i) => ({ name, n: l.filter((p) => p.sec >= i).length, pct: pct(l.filter((p) => p.sec >= i).length, l.length) })),
      next: top(next, 15), prev: top(prev, 8),
      taps: top(taps, 40).map(({ k, n }) => ({ name: k.split('\t')[0], detail: k.split('\t')[1], n })),
      signupAfterSecs: tapSecs('signup'), fbAfterSecs: tapSecs('facebook group'), redditAfterSecs: tapSecs('reddit group'),
      sources: group(fv, (v) => v.src), devices: group(fv, (v) => v.dev), towns: group(fv, (v) => (v.city ? v.city + (v.country && v.country !== 'CA' ? ', ' + v.country : '') : '')),
      visitors: group(fv, (v) => (v.ret ? 'Been here before' : 'First time')),
    };
  }

  const recent = V.slice(-60).reverse().map((v) => ({
    at: v.at, src: v.src, dev: v.dev, city: v.city, ret: v.ret, secs: v.secs,
    pages: v.pages.map((p) => ({ path: p.path, secs: p.secs, scroll: p.scroll, sec: p.secname || '' })),
    did: [...new Set(v.evs.filter((e) => ['signup', 'signup try', 'facebook group', 'reddit group', 'share', 'email box tapped'].includes(e.name)).map((e) => e.name))],
  }));

  return res.json({
    ok: true, range, from, to, since: first[0]?.at || null, capped: pvs.length >= 150000,
    site: { views: pvs.length, ...rate(V), sources: group(V, (v) => v.src), entries: top(V.reduce((m, v) => bump(m, v.pages[0].path), new Map()), 10) },
    timeline: [...tl.entries()].map(([k, n]) => ({ k, n })), pages, focus, recent,
  });
}
