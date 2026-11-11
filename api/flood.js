// Live numbers for flood stories (story.live = "flood"): the Squamish River gauge now, the province's newest 10 day
// forecast, flood notices in effect, and whether the regional district lists any evacuation alerts or orders.
// Every source is free public data. One that fails comes back null and the page says so; nothing here is fatal.
//   GET -> { at, gauge, forecast, notices, slrd }
const UA = { 'User-Agent': 'squamishvoters.com (flood panel)' };
const once = (u, kind) => fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) }).then((r) => { if (!r.ok) throw new Error(`${r.status} ${u}`); return kind === 'json' ? r.json() : r.text(); });
const get = (u, kind = 'json') => once(u, kind).catch(() => new Promise((ok) => setTimeout(ok, 1000)).then(() => once(u, kind)));

// Flood sizes the BC River Forecast Centre uses for the Squamish River near Brackendale (08GA022), cubic metres per second.
export const SIZES = { y2: 1351, y5: 1809, y10: 2129, y20: 2441, y50: 2843, y100: 3137, record: 3140 };

// Water Survey of Canada real time gauge, last 3 days, one point per hour.
export async function gauge() {
  const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 13) + ':00:00Z';
  // Two ways to ask the same service; the second (newest first) is the one the Today page uses and rarely fails.
  let d = await get(`https://api.weather.gc.ca/collections/hydrometric-realtime/items?f=json&STATION_NUMBER=08GA022&datetime=${since}/..&limit=3000&sortby=DATETIME&properties=DATETIME,LEVEL,DISCHARGE&skipGeometry=true`).catch(() => null);
  if (!d?.features?.length) d = await get('https://api.weather.gc.ca/collections/hydrometric-realtime/items?f=json&STATION_NUMBER=08GA022&sortby=-DATETIME&limit=900&properties=DATETIME,LEVEL,DISCHARGE&skipGeometry=true');
  const pts = (d.features || []).map((f) => f.properties).filter((p) => p.DISCHARGE != null).sort((a, b) => Date.parse(a.DATETIME) - Date.parse(b.DATETIME));
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
export async function forecast() {
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
export async function notices() {
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
export async function slrd() {
  const page = 'https://www.slrd.bc.ca/emergency-program/evacuation-alerts-orders';
  const h = await get(page, 'text');
  const main = (h.match(/<main[\s\S]*?<\/main>/i) || [h])[0];
  if (/no active Evacuation Alerts or Orders/i.test(main)) return { active: false, page };
  const items = [...main.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{12,160})<\/a>/gi)]
    .map((m) => m[2].replace(/&amp;/g, '&').trim()).filter((s) => /alert|order|evacu/i.test(s) && !/sign ?up|subscribe|slrd ?alert|notification/i.test(s)).slice(0, 8);
  return { active: true, items, page };
}

// Rain on the mountains that feed the river: Open-Meteo model, hourly, averaged over three points in the watershed
// (Elaho, upper Squamish, Ashlu). Past 3 days and the next 5, so the page can add up "so far" and "still to come".
const RAIN_PTS = [[50.30, -123.70], [50.20, -123.45], [50.00, -123.40]];
export async function rain() {
  const d = await get(`https://api.open-meteo.com/v1/forecast?latitude=${RAIN_PTS.map((p) => p[0]).join(',')}&longitude=${RAIN_PTS.map((p) => p[1]).join(',')}&hourly=precipitation,freezing_level_height&past_days=3&forecast_days=5&timezone=GMT`);
  const list = Array.isArray(d) ? d : [d];
  const t = list[0].hourly.time.map((x) => Date.parse(x + 'Z'));
  const mm = t.map((_, i) => +(list.reduce((a, p) => a + (p.hourly.precipitation[i] || 0), 0) / list.length).toFixed(2));
  const fz = t.map((_, i) => Math.round(list.reduce((a, p) => a + (p.hourly.freezing_level_height[i] || 0), 0) / list.length));
  return { hourly: t.map((x, i) => [x, mm[i], fz[i]]), points: RAIN_PTS, link: 'https://open-meteo.com/' };
}

// Earlier provincial forecast runs, saved by api/flood-watch.js each time the province issues a new one.
async function history() {
  const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL; if (!URL) return [];
  const { neon } = await import('@neondatabase/serverless');
  const rows = await neon(URL)`SELECT issued, peak, peak_t, series FROM sv_flood_runs ORDER BY at DESC LIMIT 6`.catch(() => []);
  return rows.map((r) => ({ issued: r.issued, peak: r.peak, peakT: Number(r.peak_t), series: r.series }));
}

export default async function handler(req, res) {
  const parts = { gauge, forecast, notices, slrd, rain };
  const out = { at: new Date().toISOString(), sizes: SIZES };
  await Promise.all(Object.entries(parts).map(async ([k, fn]) => { out[k] = await fn().catch((e) => { console.error(k, e.message); return null; }); }));
  // A reply with a missing source is cached for only 30 seconds, so one slow answer does not blank the panel for minutes.
  out.history = await history().catch(() => []);
  const whole = Object.keys(parts).every((k) => out[k]);
  res.setHeader('Cache-Control', whole ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' : 'public, max-age=15, s-maxage=30');
  res.json(out);
}
