// Squamish River near Brackendale (08GA022): what the flow usually is on each day of the year, from every daily mean
// on record (Water Survey of Canada, 1922 on). Writes api/_river-normals.json for api/today.js, so "50 cubic metres a
// second" can be put next to "usually about 140 this time of year". Rerun once a year when a new year is published.
import fs from 'node:fs';
const STN = '08GA022', API = 'https://api.weather.gc.ca/collections/hydrometric-daily-mean/items?f=json&properties=DATE,DISCHARGE';
const rows = [];
for (let off = 0; ; off += 10000) {
  const d = await fetch(`${API}&STATION_NUMBER=${STN}&limit=10000&offset=${off}`).then((r) => r.json());
  rows.push(...d.features.map((f) => f.properties).filter((p) => p.DISCHARGE != null));
  if (d.features.length < 10000) break;
}
const doy = (s) => { const d = new Date(s + 'T12:00:00Z'); return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5); };
const byDay = Array.from({ length: 367 }, () => []);
for (const r of rows) byDay[doy(r.DATE)].push(r.DISCHARGE);
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
// Two weeks either side of each day, so one stormy year doesn't make a single date look odd.
const days = {};
for (let d = 1; d <= 366; d++) {
  const w = [];
  for (let k = -14; k <= 14; k++) w.push(...byDay[((d + k - 1 + 366) % 366) + 1]);
  w.sort((a, b) => a - b);
  days[d] = [pct(w, 0.1), pct(w, 0.25), pct(w, 0.5), pct(w, 0.75), pct(w, 0.9)].map((x) => Math.round(x));
}
const top = rows.reduce((a, b) => (b.DISCHARGE > a.DISCHARGE ? b : a));
const years = rows.map((r) => r.DATE.slice(0, 4)).sort();
fs.writeFileSync(new URL('../../api/_river-normals.json', import.meta.url), JSON.stringify({
  station: STN, from: years[0], to: years[years.length - 1], record: { flow: Math.round(top.DISCHARGE), date: top.DATE }, days,
}));
console.log(rows.length, 'days', years[0], 'to', years[years.length - 1], 'record', top.DATE, top.DISCHARGE, 'Oct 28', days[doy('2026-10-28')]);
