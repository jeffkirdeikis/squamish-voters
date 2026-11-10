// Live numbers for flood stories (story.live = "flood"): the Squamish River gauge now, the province's newest 10 day
// forecast, flood notices in effect, and whether the regional district lists any evacuation alerts or orders.
// Every source is free public data. One that fails comes back null and the page says so; nothing here is fatal.
//   GET -> { at, gauge, forecast, notices, slrd }
const UA = { 'User-Agent': 'squamishvoters.com (flood panel)' };
const once = (u, kind) => fetch(u, { headers: UA, signal: AbortSignal.timeout(8000) }).then((r) => { if (!r.ok) throw new Error(`${r.status} ${u}`); return kind === 'json' ? r.json() : r.text(); });
const get = (u, kind = 'json') => once(u, kind).catch(() => new Promise((ok) => setTimeout(ok, 1000)).then(() => once(u, kind)));

// Flood sizes the BC River Forecast Centre uses for the Squamish River near Brackendale (08GA022), cubic metres per second.
export const SIZES = { y2: 1351, y5: 1809, y10: 2129, y20: 2441, y50: 2843, y100: 3137, record: 3140 };

// Water Survey of Canada real time gauge, last 3 days, one point per hour.
async function gauge() {
  const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 13) + ':00:00Z';
  const d = await get(`https://api.weather.gc.ca/collections/hydrometric-realtime/items?f=json&STATION_NUMBER=08GA022&datetime=${since}/..&limit=3000&sortby=DATETIME&properties=DATETIME,LEVEL,DISCHARGE&skipGeometry=true`);
  const pts = (d.features || []).map((f) => f.properties).filter((p) => p.DISCHARGE != null);
  if (!pts.length) return null;
  const hourly = new Map();
  for (const p of pts) hourly.set(Math.floor(Date.parse(p.DATETIME) / 36e5), [Date.parse(p.DATETIME), Math.round(p.DISCHARGE)]);
  const last = pts[pts.length - 1], t = Date.parse(last.DATETIME);
  const back = (h) => { let b = null; for (const p of pts) { if (Date.parse(p.DATETIME) <= t - h * 36e5) b = p; else break; } return b?.DISCHARGE ?? null; };
  const three = back(3);
  return { t, flow: Math.round(last.DISCHARGE), level: last.LEVEL, perHour: three == null ? null : Math.round((last.DISCHARGE - three) / 3), series: [...hourly.values()] };
}

// The province's CLEVER model: hourly forecast, low and high bound for 10 days. The hour column is read as Pacific
// Standard Time (UTC-8); British Columbia's clocks are UTC-7 since 2026, so times are good to about an hour.
async function forecast() {
  const t = await get('https://bcrfc.env.gov.bc.ca/freshet/clever/08GA022.CSV', 'text');
  const issued = (t.match(/ISSUED AT:\s*(.+)/) || [])[1]?.trim() || '';
  const rows = [];
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^(\d{4})-(\d\d)-(\d\d),(\d\d?),([\d.]+),([\d.]+),([\d.]+)/);
    if (m) rows.push([Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 8), Math.round(+m[5]), Math.round(+m[6]), Math.round(+m[7])]);
  }
  if (!rows.length) return null;
  const ahead = rows.filter((r) => r[0] >= Date.now() - 36e5);
  const use = ahead.length ? ahead : rows;
  const peak = use.reduce((a, b) => (b[1] > a[1] ? b : a));
  return {
    issued, rows,
    peak: { t: peak[0], flow: peak[1] },
    low: Math.max(...use.map((r) => r[2])), high: Math.max(...use.map((r) => r[3])),
    chart: 'https://bcrfc.env.gov.bc.ca/freshet/clever/08GA022.PDF',
  };
}

// Flood notices "currently in effect" on the River Forecast Centre's page. Squamish is in the South Coast region.
async function notices() {
  const base = 'https://bcrfc.env.gov.bc.ca/warnings/';
  const h = await get(base + 'index.htm', 'text');
  const a = h.search(/Currently in Effect/i), b = h.search(/Previously issued/i);
  if (a < 0) return null;
  const block = h.slice(a, b > a ? b : undefined), list = [];
  for (const m of block.matchAll(/<a[^>]+href="([^"]+\.pdf)"[^>]*>([^<]+)</gi)) {
    const title = m[2].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    list.push({
      title: title.replace(/\s*-\s*Issued:.*$/i, '').replace(/^UPDATE\s*-\s*/i, ''),
      issued: (title.match(/Issued:\s*(.+)$/i) || [])[1] || '',
      level: /Flood Warning/i.test(title) ? 3 : /Flood Watch/i.test(title) ? 2 : /High Streamflow/i.test(title) ? 1 : 0,
      local: /South Coast|Sea.to.Sky|Howe Sound|Squamish/i.test(title),
      url: base + encodeURI(m[1]),
    });
  }
  const here = list.filter((n) => n.local).sort((x, y) => y.level - x.level)[0] || null;
  return { here, page: base + 'index.htm' };
}

// Squamish Lillooet Regional District evacuation alerts and orders (covers the Upper Squamish Valley and upper Paradise Valley).
async function slrd() {
  const page = 'https://www.slrd.bc.ca/emergency-program/evacuation-alerts-orders';
  const h = await get(page, 'text');
  const main = (h.match(/<main[\s\S]*?<\/main>/i) || [h])[0];
  if (/no active Evacuation Alerts or Orders/i.test(main)) return { active: false, page };
  const items = [...main.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{12,160})<\/a>/gi)]
    .map((m) => m[2].replace(/&amp;/g, '&').trim()).filter((s) => /alert|order|evacu/i.test(s)).slice(0, 4);
  return { active: true, items, page };
}

export default async function handler(req, res) {
  const parts = { gauge, forecast, notices, slrd };
  const out = { at: new Date().toISOString(), sizes: SIZES };
  await Promise.all(Object.entries(parts).map(async ([k, fn]) => { out[k] = await fn().catch((e) => { console.error(k, e.message); return null; }); }));
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  res.json(out);
}
