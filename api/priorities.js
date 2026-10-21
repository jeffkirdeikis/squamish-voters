// Public totals for /priorities/: how many readers picked each issue on the welcome page, and which way they lean.
// Counts only, added up in the database, so no email, neighbourhood or write-in ever leaves it. Counts people who
// confirmed the weekly email and answered. The CDN caches the answer for 5 minutes.
//   GET -> { ok, people, areas, issues: [{ key, n, leans: { <side value>|mid|other|none: n } }] }
import { neon } from '@neondatabase/serverless';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const MIN = 5; // fewer answers than this and nothing is shown

export default async function handler(req, res) {
  if (!URL) return res.status(503).json({ ok: false, error: 'not configured' });
  const sql = neon(URL);
  try {
    const [[who], rows] = await Promise.all([
      sql`SELECT count(*)::int AS people, count(DISTINCT nullif(area, ''))::int AS areas FROM sv_subscribers
        WHERE status = 'subscribed' AND prefs_at IS NOT NULL AND jsonb_array_length(topics) > 0`,
      sql`SELECT t.key, coalesce(stances ->> t.key, '') AS lean, count(*)::int AS n
        FROM sv_subscribers, jsonb_array_elements_text(topics) AS t(key)
        WHERE status = 'subscribed' AND prefs_at IS NOT NULL GROUP BY 1, 2`,
    ]);
    const by = {};
    for (const r of rows) {
      const i = (by[r.key] ||= { key: r.key, n: 0, leans: {} });
      i.n += r.n;
      i.leans[r.lean || 'none'] = (i.leans[r.lean || 'none'] || 0) + r.n;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    if (who.people < MIN) return res.json({ ok: true, people: who.people, min: MIN, issues: [] });
    return res.json({ ok: true, people: who.people, areas: who.areas, issues: Object.values(by).sort((a, b) => b.n - a.n) });
  } catch (e) {
    console.error('priorities', e.message);
    res.setHeader('Cache-Control', 'public, s-maxage=10');
    return res.status(502).json({ ok: false });
  }
}
