// Squamish right now: weather, Highway 99, wind at the Spit, the river, air quality and avalanche danger in one reply
// for /today/ and the home page strip. Every source is free public data; one that fails is left out, not fatal.
//   GET -> { at, weather, days, highway, wind, tide, river, air, avalanche }
import NORMALS from './_river-normals.json' with { type: 'json' };

const TZ = 'America/Vancouver';
const UA = { 'User-Agent': 'squamishvoters.com (today page)' };
const once = (u) => fetch(u, { headers: UA, signal: AbortSignal.timeout(6000) }).then((r) => { if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); });
// One retry after a short pause: DriveBC answers 429 to bursts, and any source can be slow for a moment.
const get = (u) => once(u).catch(() => new Promise((ok) => setTimeout(ok, 1200)).then(() => once(u)));
const en = (o) => (o && typeof o === 'object' && 'en' in o ? o.en : o);
const val = (o) => en(o?.value);
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Environment Canada's Squamish city page (station: Squamish Airport) plus any warnings in effect.
async function weather() {
  const d = await get('https://api.weather.gc.ca/collections/citypageweather-realtime/items/bc-50?f=json&lang=en');
  const p = d.properties, c = p.currentConditions || {};
  const hourly = (p.hourlyForecastGroup?.hourlyForecasts || []).slice(0, 12).map((h) => ({
    t: h.timestamp, temp: val(h.temperature), cond: en(h.condition), pop: val(h.lop), icon: h.iconCode?.value ?? null,
  }));
  const ws = val(c.wind?.speed), wg = val(c.wind?.gust);
  return {
    temp: val(c.temperature), cond: en(c.condition) || hourly[0]?.cond || '',
    icon: c.iconCode?.value ?? hourly[0]?.icon ?? null,
    wind: ws == null ? '' : /calm/i.test(ws) ? 'Calm' : `${val(c.wind?.direction) || ''} ${ws} km/h${wg ? `, gusts ${wg}` : ''}`.trim(),
    observed: en(c.timestamp),
    periods: (p.forecastGroup?.forecasts || []).slice(0, 4).map((f) => ({ name: en(f.period?.textForecastName), text: en(f.textSummary) })),
    hourly,
    sunrise: en(p.riseSet?.sunrise), sunset: en(p.riseSet?.sunset),
    warnings: (Array.isArray(p.warnings) ? p.warnings : p.warnings?.event ? [].concat(p.warnings.event) : []).map((w) => ({ type: en(w.type), text: en(w.description) || en(w.priority) || '' })),
    link: 'https://weather.gc.ca/en/location/index.html?coords=49.702,-123.156',
  };
}

// DriveBC: everything active on Highway 99 between Horseshoe Bay and Whistler. Incidents first, then roadwork.
async function highway() {
  const d = await get('https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE&road_name=Highway%2099&limit=200');
  const lat = (g) => { let c = g?.coordinates; while (Array.isArray(c?.[0])) c = c[0]; return c?.[1]; };
  const rank = (e) => (e.event_type === 'INCIDENT' ? 0 : e.severity === 'MAJOR' ? 1 : 2);
  const events = (d.events || []).filter((e) => { const y = lat(e.geography); return y > 49.36 && y < 50.18; })
    .sort((a, b) => rank(a) - rank(b) || String(b.updated).localeCompare(String(a.updated)))
    .map((e) => ({ type: e.event_type, severity: e.severity, text: String(e.description || '').replace(/\s*Last update:[^.]*?(?:PDT|PST)\.?/i, '').trim(), updated: e.updated }));
  const closed = events.some((e) => /closed|closure/i.test(e.text) && !/lane closure|single lane|shoulder/i.test(e.text) && e.type === 'INCIDENT');
  const incidents = events.filter((e) => e.type === 'INCIDENT' || e.severity === 'MAJOR');
  return { status: closed ? 'closed' : incidents.length ? 'delays' : 'clear', events, link: 'https://www.drivebc.ca/' };
}

// Wind at the Spit: hourly forecast from Open-Meteo (free, the same weather models Windy shows), in knots.
async function wind() {
  const d = await get(`https://api.open-meteo.com/v1/forecast?latitude=49.716&longitude=-123.163&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kn&timezone=${encodeURIComponent(TZ)}&forecast_days=2`);
  const h = d.hourly || {}, now = d.current || {};
  // Daytime hours (8 a.m. to 8 p.m.) for today, or tomorrow once today's are over.
  const late = +String(now.time).slice(11, 13) >= 20;
  const day = late ? (h.time || []).find((t) => t.slice(0, 10) > String(now.time).slice(0, 10))?.slice(0, 10) : String(now.time || '').slice(0, 10);
  const hours = (h.time || []).map((t, i) => ({ t, kn: Math.round(h.wind_speed_10m[i]), gust: Math.round(h.wind_gusts_10m[i]), dir: h.wind_direction_10m[i] }))
    .filter((x) => x.t.slice(0, 10) === day && +x.t.slice(11, 13) >= 8 && +x.t.slice(11, 13) <= 20);
  const best = hours.reduce((a, b) => (b.kn > (a?.kn ?? -1) ? b : a), null);
  return {
    kn: Math.round(now.wind_speed_10m), gust: Math.round(now.wind_gusts_10m), dir: now.wind_direction_10m, hours, best, day, tomorrow: late,
    live: 'https://squamishwindsports.com/conditions/wind/', link: 'https://open-meteo.com/',
  };
}

// Tides at Squamish (Canadian Hydrographic Service station 07811, Squamish Inner): predicted highs and lows, next 36 hours.
async function tide() {
  const from = new Date(Date.now() - 6 * 36e5), to = new Date(Date.now() + 36 * 36e5);
  const iso = (d) => d.toISOString().slice(0, 19) + 'Z';
  const d = await get(`https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/5cebf1de3d0f4a073c4bb94e/data?time-series-code=wlp-hilo&from=${iso(from)}&to=${iso(to)}`);
  const pts = d.map((x) => ({ t: x.eventDate, m: +x.value.toFixed(1) }));
  // A turning point is a high when it's above both neighbours (the feed doesn't label them).
  pts.forEach((x, i) => { const n = [pts[i - 1], pts[i + 1]].filter(Boolean); x.high = n.every((y) => x.m > y.m); });
  const now = Date.now(), next = pts.filter((x) => Date.parse(x.t) > now);
  return { rising: next[0]?.high ?? null, next: next.slice(0, 5), link: 'https://www.tides.gc.ca/en/stations/07811' };
}

// Next 14 days for Squamish from Open-Meteo (Environment Canada's own text forecast only covers about 6 days).
async function days() {
  const d = await get(`https://api.open-meteo.com/v1/forecast?latitude=49.70&longitude=-123.155&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_gusts_10m_max&timezone=${encodeURIComponent(TZ)}&forecast_days=15`);
  const x = d.daily;
  return x.time.map((t, i) => ({ date: t, code: x.weather_code[i], hi: Math.round(x.temperature_2m_max[i]), lo: Math.round(x.temperature_2m_min[i]), pop: x.precipitation_probability_max[i], rain: +x.precipitation_sum[i].toFixed(1), snow: +x.snowfall_sum[i].toFixed(1), gust: Math.round(x.wind_gusts_10m_max[i]) }));
}

// Water Survey of Canada gauge: Squamish River near Brackendale. Level now and 24 hours ago.
async function river() {
  const d = await get('https://api.weather.gc.ca/collections/hydrometric-realtime/items?f=json&STATION_NUMBER=08GA022&sortby=-DATETIME&limit=300');
  const f = (d.features || []).map((x) => x.properties).filter((x) => x.LEVEL != null);
  if (!f.length) return null;
  const last = f[0], t0 = Date.parse(last.DATETIME);
  const ago = f.find((x) => t0 - Date.parse(x.DATETIME) >= 24 * 36e5) || f[f.length - 1];
  // How today's flow compares with the same weeks in every year since 1922 (api/_river-normals.json).
  const d0 = new Date(last.DATETIME_LST.slice(0, 10) + 'T12:00:00Z'), doy = Math.floor((d0 - Date.UTC(d0.getUTCFullYear(), 0, 0)) / 864e5);
  const [p10, p25, p50, p75, p90] = NORMALS.days[doy], q = last.DISCHARGE;
  const band = q < p10 ? 'very low' : q < p25 ? 'low' : q <= p75 ? 'normal' : q <= p90 ? 'high' : 'very high';
  return {
    band, usual: p50, range: [p25, p75], p10, p90, record: NORMALS.record, since: NORMALS.from,
    name: 'Squamish River at Brackendale', level: last.LEVEL, flow: last.DISCHARGE, at: last.DATETIME,
    change: +(last.LEVEL - ago.LEVEL).toFixed(2), link: 'https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=08GA022',
  };
}

// Air Quality Health Index at the Squamish monitor (1 to 3 low risk, 4 to 6 moderate, 7 to 10 high, above 10 very high).
async function air() {
  const d = await get('https://api.weather.gc.ca/collections/aqhi-observations-realtime/items?f=json&location_id=JCVCJ&sortby=-observation_datetime&limit=1');
  const p = d.features?.[0]?.properties;
  if (!p) return null;
  const v = Math.round(p.aqhi);
  return { aqhi: v, risk: v <= 3 ? 'Low' : v <= 6 ? 'Moderate' : v <= 10 ? 'High' : 'Very high', at: p.observation_datetime, note: p.special_notes_en || '', link: 'https://weather.gc.ca/airquality/pages/bcaq-007_e.html' };
}

// Avalanche Canada for the Sea to Sky backcountry (Garibaldi). Before the season there is only a general note.
async function avalanche() {
  const d = await get('https://api.avalanche.ca/forecasts/en/products/point?lat=49.85&long=-123.0');
  const r = d.report || {}, dr = (r.dangerRatings || [])[0];
  const rating = (k) => { const x = dr?.ratings?.[k]; return x ? { zone: x.display, value: x.rating?.value, label: x.rating?.display } : null; };
  return {
    ratings: dr ? ['alp', 'tln', 'btl'].map(rating).filter(Boolean) : [],
    day: dr?.date?.display || '', note: dr ? '' : strip(r.highlights).slice(0, 220), link: d.url || 'https://avalanche.ca/',
  };
}

export default async function handler(req, res) {
  const parts = { weather, days, highway, wind, tide, river, air, avalanche };
  const out = { at: new Date().toISOString() };
  await Promise.all(Object.entries(parts).map(async ([k, fn]) => { out[k] = await fn().catch((e) => { console.error(k, e.message); return null; }); }));
  // Shared cache: one fetch of every source per five minutes, however many people open the page.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  res.json(out);
}
