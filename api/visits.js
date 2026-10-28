// Public page view counter. Reads the all-time total from Vercel Web Analytics (the same number the dashboard shows)
// and returns { ok, pageviews, visitors }. The CDN caches it for 30 s, so the Vercel API sees about two calls a minute.
// Needs VERCEL_ANALYTICS_TOKEN, a Vercel access token for the team that owns this project.
const PROJECT = 'prj_olAlaP4zJkDgHr6zHh7KBJ0Ub2RE';
const TEAM = 'team_iw1pUMSqkMZdMypdybTf0LIn';
const SINCE = '2026-01-01T00:00:00Z'; // before the site launched, so this is every view ever recorded

export default async function handler(req, res) {
  const token = process.env.VERCEL_ANALYTICS_TOKEN;
  // Not set up: answer quietly (204, no body) and let the CDN keep that for an hour, so pages stop asking.
  if (!token) { res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600'); return res.status(204).end(); }
  // The API rounds to whole days, so ask through tomorrow to include today.
  const until = new Date(Date.now() + 864e5).toISOString().slice(0, 10) + 'T23:59:59Z';
  const q = new URLSearchParams({ projectId: PROJECT, teamId: TEAM, since: SINCE, until });
  try {
    const r = await fetch('https://api.vercel.com/v1/query/web-analytics/visits/count?' + q, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('analytics ' + r.status);
    const { data } = await r.json();
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    return res.json({ ok: true, pageviews: data.pageviews, visitors: data.visitors });
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=10');
    return res.status(502).json({ ok: false, error: String(e.message || e) });
  }
}
