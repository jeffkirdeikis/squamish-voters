// Private read-back of the weekly email sign-ups and their welcome page answers, for /subscribers/. Requires ADMIN_TOKEN.
//   GET (Authorization: Bearer <token>)            -> { ok, rows }
//   GET ?format=csv (Authorization: Bearer <token>) -> the same rows as a spreadsheet
import { neon } from '@neondatabase/serverless';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const COLS = ['email', 'status', 'source', 'area', 'topics', 'stances', 'stance_notes', 'consent_at', 'confirmed_at', 'prefs_at', 'unsubscribed_at'];
const cell = (v) => { const s = v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  const token = (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!URL) return res.status(503).json({ ok: false, error: 'no database' });
  const rows = await neon(URL)`SELECT email, status, source, area, topics, stances, stance_notes, consent_at, confirmed_at, prefs_at, unsubscribed_at
    FROM sv_subscribers ORDER BY consent_at DESC`;
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="squamish-voters-signups-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send([COLS.join(','), ...rows.map((r) => COLS.map((c) => cell(r[c])).join(','))].join('\n'));
  }
  return res.json({ ok: true, rows });
}
