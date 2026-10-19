// Weekly email sign-ups, stored in the Neon Postgres database connected to this project (POSTGRES_URL).
// Sending is done separately (scripts/pipeline/digest.mjs) once an email service is connected; until then this only
// records who asked, with their consent and when, which Canada's anti-spam law (CASL) requires us to keep.
//   POST { email, consent: true, from, area, topics }  -> { ok }
//   GET  ?unsubscribe=<token>                          -> plain confirmation page
import { neon } from '@neondatabase/serverless';
import { createHash, randomBytes } from 'node:crypto';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
const CONSENT = 'Yes, send me the weekly Squamish Voters email. I can unsubscribe at any time.';
let ready = null;
const init = () => (ready ||= sql`CREATE TABLE IF NOT EXISTS sv_subscribers (
  email text PRIMARY KEY, status text NOT NULL DEFAULT 'subscribed', token text NOT NULL,
  consent_text text NOT NULL, consent_at timestamptz NOT NULL DEFAULT now(), source text, area text, topics jsonb,
  ip_hash text, unsubscribed_at timestamptz)`.catch((e) => { ready = null; throw e; }));
const dayHash = (ip) => createHash('sha256').update(`${new Date().toISOString().slice(0, 10)}|${ip}|sv-subscribe`).digest('hex').slice(0, 24);

export default async function handler(req, res) {
  if (!sql) return res.status(503).json({ ok: false, error: 'Sign-ups are not open yet.' });
  await init();
  if (req.method === 'GET' && req.query.unsubscribe) {
    await sql`UPDATE sv_subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE token = ${String(req.query.unsubscribe)}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send('<!doctype html><meta name="viewport" content="width=device-width"><body style="font:18px/1.5 system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>You’re unsubscribed</h1><p>You won’t get the Squamish Voters email any more. <a href="https://squamishvoters.com/">Back to the site</a></p>');
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,}$/i.test(email)) return res.status(400).json({ ok: false, error: 'Please check your email address.' });
  if (b.consent !== true) return res.status(400).json({ ok: false, error: 'Please tick the box so we know you want the email.' });
  const ip = dayHash(String(req.headers['x-forwarded-for'] || '').split(',')[0]);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_subscribers WHERE ip_hash = ${ip} AND consent_at > now() - interval '1 day'`;
  if (n >= 10) return res.status(429).json({ ok: false, error: 'Too many sign-ups from here today.' });
  const topics = Array.isArray(b.topics) ? b.topics.slice(0, 20).map(String) : [];
  await sql`INSERT INTO sv_subscribers (email, token, consent_text, source, area, topics, ip_hash)
    VALUES (${email}, ${randomBytes(18).toString('hex')}, ${CONSENT}, ${String(b.from || '').slice(0, 20)}, ${String(b.area || '').slice(0, 40)}, ${JSON.stringify(topics)}, ${ip})
    ON CONFLICT (email) DO UPDATE SET status = 'subscribed', consent_at = now(), unsubscribed_at = NULL, area = EXCLUDED.area, topics = EXCLUDED.topics`;
  return res.json({ ok: true });
}
