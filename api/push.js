// Phone alerts for the Squamish Voters app (iPhone and Android). The app shows this site in a frame; src/app.js asks
// the phone for a push token and posts it here. scripts/pipeline/push.mjs sends the alerts when a story goes live.
//   POST { token, platform: 'ios' | 'android', level: 'big' | 'all' | 'off' }
//   level 'test' is the automated simulator check (app opened with ?svpushtest=1): kept apart, never sent real alerts.
//   GET with the ADMIN_TOKEN in the Authorization header: how many phones have alerts on, and the test tokens.
//   big = the day's top stories only (major council decisions and the biggest local news). all = every new story. off = forget this phone.
// Nothing here identifies a person: only the token the phone hands out, which is useless anywhere else.
import { neon } from '@neondatabase/serverless';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
let ready = null;
const init = () => (ready ||= sql`CREATE TABLE IF NOT EXISTS sv_push_tokens (
  token text PRIMARY KEY, platform text NOT NULL, level text NOT NULL DEFAULT 'big',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), fails int NOT NULL DEFAULT 0)`
  .catch((e) => { ready = null; throw e; }));

const TOKEN = { ios: /^[a-f0-9]{64,200}$/i, android: /^[\w:\-]{100,400}$/ };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!sql) return res.status(503).json({ ok: false });
  if (req.method === 'GET') {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
    await init();
    const counts = await sql`SELECT platform, level, count(*)::int AS n FROM sv_push_tokens GROUP BY 1, 2 ORDER BY 1, 2`;
    const tests = await sql`SELECT token, platform, updated_at FROM sv_push_tokens WHERE level = 'test' ORDER BY updated_at DESC LIMIT 5`;
    return res.status(200).json({ ok: true, counts, tests });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!/SquamishVotersApp/.test(req.headers['user-agent'] || '')) return res.status(403).json({ ok: false });
  let b = req.body;
  try { if (typeof b === 'string') b = JSON.parse(b); else if (Buffer.isBuffer(b)) b = JSON.parse(b.toString('utf8')); } catch (e) { return res.status(400).json({ ok: false }); }
  const platform = b && b.platform, level = b && b.level, token = b && typeof b.token === 'string' ? b.token.trim() : '';
  if (!TOKEN[platform] || !TOKEN[platform].test(token) || !['big', 'all', 'off', 'test'].includes(level)) return res.status(400).json({ ok: false });
  try {
    await init();
    if (level === 'off') await sql`DELETE FROM sv_push_tokens WHERE token = ${token}`;
    else await sql`INSERT INTO sv_push_tokens (token, platform, level) VALUES (${token}, ${platform}, ${level})
      ON CONFLICT (token) DO UPDATE SET level = EXCLUDED.level, platform = EXCLUDED.platform, fails = 0, updated_at = now()`;
    return res.status(200).json({ ok: true, level });
  } catch (e) { return res.status(500).json({ ok: false }); }
}
