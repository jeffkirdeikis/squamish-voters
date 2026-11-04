// News tips: a screenshot of a Facebook or Instagram post, a link or a short note, sent from squamishvoters.com/tip/
// (or Jeff's iPhone shortcut). Stored in sv_tips; scripts/pipeline/news.mjs reads each one with Claude and drafts a
// story for Jeff to approve. Nothing here ever publishes anything.
//   POST { text?, link?, image? (data:image/jpeg;base64,..., under about 3 MB) } -> { ok }
import { neon } from '@neondatabase/serverless';
import { createHash, randomBytes } from 'node:crypto';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
const PER_DAY = 15; // per network, so one person can't flood the desk
let ready = null;
const init = () => (ready ||= sql`CREATE TABLE IF NOT EXISTS sv_tips (id text PRIMARY KEY, status text NOT NULL DEFAULT 'new', text text, link text, image text, ip_hash text, reading jsonb, created_at timestamptz NOT NULL DEFAULT now())`.catch((e) => { ready = null; throw e; }));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Send a tip with POST.' });
  if (!sql) return res.status(503).json({ ok: false, error: 'Tips are not open yet.' });
  let b = req.body;
  try { if (typeof b === 'string') b = JSON.parse(b || '{}'); } catch { return res.status(400).json({ ok: false, error: 'That did not come through. Try again.' }); }
  b = b || {};
  const text = String(b.text || '').trim().slice(0, 4000);
  const link = /^https?:\/\/\S+$/.test(String(b.link || '').trim()) ? String(b.link).trim().slice(0, 600) : '';
  let image = String(b.image || '');
  if (image && !/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(image)) image = '';
  image = image.replace(/\s+/g, '');
  if (image.length > 4_000_000) return res.status(413).json({ ok: false, error: 'That picture is too big. Try a smaller screenshot.' });
  if (!text && !link && !image) return res.status(400).json({ ok: false, error: 'Add a screenshot, a link or a few words.' });
  await init();
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const ipHash = createHash('sha256').update(`${new Date().toISOString().slice(0, 10)}|${ip}|sv-tip`).digest('hex').slice(0, 24);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_tips WHERE ip_hash = ${ipHash} AND created_at > now() - interval '1 day'`;
  if (n >= PER_DAY) return res.status(429).json({ ok: false, error: 'Thanks! That is a lot of tips for one day. Try again tomorrow.' });
  await sql`INSERT INTO sv_tips (id, text, link, image, ip_hash) VALUES (${randomBytes(9).toString('base64url')}, ${text || null}, ${link || null}, ${image || null}, ${ipHash})`;
  return res.json({ ok: true });
}
