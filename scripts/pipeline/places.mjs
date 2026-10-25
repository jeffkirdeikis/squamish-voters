// Neighbourhood boundaries and development projects from the District of Squamish's open map data (ArcGIS).
// Writes data/neighbourhoods.json (one entry per neighbourhood page, with its outline) and data/developments.json.
// Run by .github/workflows/news.yml so the project list stays current. No keys needed.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log, writeJson, readJson } from './lib.mjs';

const AGS = 'https://services.arcgis.com/YCM10gnCAvCoAhpj/arcgis/rest/services';
const HOODS_URL = `${AGS}/Squamish_Neighborhoods_(updated)/FeatureServer/0/query?where=1%3D1&outFields=Name&returnGeometry=true&outSR=4326&f=geojson`;
const DEVS_URL = `${AGS}/SIM_Data_Export/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
const UA = 'SquamishVoters/1.0 (+https://squamishvoters.com/neighbourhoods/)';

// District map area -> our neighbourhood (the slugs the rest of the site tags decisions with, data/participate.json).
const POLY = {
  'Business Park': 'business-park', Northyards: 'north-yards', 'Loggers East': 'loggers-east', Valleycliffe: 'valleycliffe', Crumpit: 'crumpit-woods',
  Downtown: 'downtown', University: 'university-heights', 'Garibaldi Highlands': 'garibaldi-highlands', Brackendale: 'brackendale',
  'Cheekeye Fan/Paradise Valley': 'squamish-north', "St'a7mes Site B Klahanie": 'squamish-south', 'Hospital Hill': 'hospital-hill', Dentville: 'dentville',
  Mamquam: 'mamquam', 'Garibladi Estates': 'garibaldi-estates', 'Garibaldi Estates': 'garibaldi-estates', Tantalus: 'garibaldi-estates',
};
// Neighbourhood names in the District's development list -> ours. "Waterfront" spans several, so those go by location.
const LABEL = {
  Downtown: 'downtown', Oceanfront: 'oceanfront', Brackendale: 'brackendale', 'Garibaldi Highlands': 'garibaldi-highlands', 'Loggers East': 'loggers-east',
  'North Yards': 'north-yards', Dentville: 'dentville', 'University Highlands': 'university-heights', Tantalus: 'garibaldi-estates', 'Hospital Hill': 'hospital-hill',
  'Garibaldi Estates': 'garibaldi-estates', 'Crumpit Woods': 'crumpit-woods', Mamquam: 'mamquam', Valleycliffe: 'valleycliffe', 'Business Park': 'business-park',
};
const EXTRA = { 'crumpit-woods': 'Crumpit Woods', mamquam: 'Mamquam' }; // District areas with no entry in participate.json yet

const get = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
// Map outlines only need to look right at neighbourhood zoom: at most `max` points, 5 decimals (about 1 m).
const round = (ring, max = 90) => { const step = Math.max(1, Math.ceil(ring.length / max)); return ring.filter((p, i) => i % step === 0 || i === ring.length - 1).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]); };
const rings = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : []);
const centre = (rs) => { const pts = rs.flat(); return [pts.reduce((a, p) => a + p[1], 0) / pts.length, pts.reduce((a, p) => a + p[0], 0) / pts.length].map((v) => Math.round(v * 1e5) / 1e5); };
const inside = ([lat, lng], ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; } return c; };

const hoodsGeo = await get(HOODS_URL);
const devsGeo = await get(DEVS_URL);
const part = (readJson(path.join(ROOT, 'data', 'participate.json')) || {}).neighbourhoods || [];
const names = { ...Object.fromEntries(part.map((h) => [h.slug, h.name])), ...EXTRA };

const outline = {}; // slug -> [rings]
for (const f of hoodsGeo.features) {
  const slug = POLY[f.properties.Name];
  if (!slug) { log('unmapped District area:', f.properties.Name); continue; }
  (outline[slug] ||= []).push(...rings(f.geometry).map((r) => round(r)));
}

const TYPE = { RZ: 'Rezoning', DP: 'Development permit', DDP: 'Development permit', OCP: 'Community plan change' };
const STATUS = { 'In-Progress': 'Under review', Completed: 'Approved', New: 'Application received' };
const groups = new Map();
for (const f of devsGeo.features) {
  const p = f.properties, rs = rings(f.geometry).map((r) => round(r, 24));
  if (!p.Project_Name || !rs.length) continue;
  const c = centre(rs);
  const slug = LABEL[p.Neighbourhood] || Object.entries(outline).find(([, rr]) => rr.some((r) => inside(c, r)))?.[0] || null;
  const key = `${p.Project_Name}|${p.Application_Type}|${p.Status}`;
  const g = groups.get(key) || { name: p.Project_Name.replace(/\s+/g, ' ').trim(), address: p.Address || '', type: TYPE[p.Application_Type] || p.Application_General || 'Application', status: STATUS[p.Status] || p.Status, area: slug, homes: 0, housing: [], shape: [] };
  g.homes += Math.round(p.Units_Dev_Remaining || 0);
  if (p.Housing_Type && !g.housing.includes(p.Housing_Type)) g.housing.push(p.Housing_Type);
  if (g.shape.length < 6) g.shape.push(...rs);
  groups.set(key, g);
}
const developments = [...groups.values()].map((g) => ({ ...g, centre: centre(g.shape) })).sort((a, b) => b.homes - a.homes);

const ORDER = [...part.map((h) => h.slug), ...Object.keys(EXTRA)];
const neighbourhoods = ORDER.map((slug) => ({ slug, name: names[slug], outline: outline[slug] || [], centre: outline[slug] ? centre(outline[slug]) : (developments.find((d) => d.area === slug) || {}).centre || null }));

writeJson(path.join(ROOT, 'data', 'neighbourhoods.json'), { source: 'District of Squamish open data: Squamish Neighborhoods map layer', updated: new Date().toISOString().slice(0, 10), neighbourhoods });
writeJson(path.join(ROOT, 'data', 'developments.json'), { source: 'District of Squamish open data: Squamish Insight Model 2026, development pipeline', source_url: 'https://opendata-squamish.hub.arcgis.com', updated: new Date().toISOString().slice(0, 10), developments });
log(`neighbourhoods: ${neighbourhoods.length} (${neighbourhoods.filter((n) => n.outline.length).length} with outlines), developments: ${developments.length} (${developments.filter((d) => !d.area).length} without a neighbourhood)`);
