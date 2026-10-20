// Weekly email sign-ups, stored in the Neon Postgres database connected to this project (POSTGRES_URL).
// Sending is done separately (scripts/pipeline/digest.mjs) once an email service is connected; until then this only
// records who asked, with their consent and when, which Canada's anti-spam law (CASL) requires us to keep.
// Double opt-in: a new sign-up is 'pending' until the person taps the link in the confirm email; only
// 'subscribed' addresses get the Friday email. That keeps typos and fake sign-ups off the list, which keeps us out of spam.
//   POST { email, consent: true, from, area, topics }  -> { ok, pending }
//   GET  ?confirm=<token>                              -> confirmed, then on to /welcome/?t=<token>
//   GET  ?prefs=<token>                                -> { ok, area, topics, stances, notes } (the welcome page starts from these)
//   POST { token, topics, stances, notes, area }       -> { ok } (answers to the welcome page's two questions; notes = "Other" write-ins)
//   GET or POST ?unsubscribe=<token>                   -> unsubscribed (POST is the one-click unsubscribe mail apps use)
import { neon } from '@neondatabase/serverless';
import { createHash, randomBytes } from 'node:crypto';
import { mailReady, sendConfirm } from './_mail.js';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
// What the person saw when they asked; their click on the confirm link is recorded separately as confirmed_at.
const CONSENT = 'Entered email and pressed the sign-up button for the weekly Squamish Voters email (we email a link to confirm; unsubscribe any time).';
let ready = null;
const init = () => (ready ||= sql`CREATE TABLE IF NOT EXISTS sv_subscribers (
  email text PRIMARY KEY, status text NOT NULL DEFAULT 'subscribed', token text NOT NULL,
  consent_text text NOT NULL, consent_at timestamptz NOT NULL DEFAULT now(), source text, area text, topics jsonb,
  ip_hash text, unsubscribed_at timestamptz)`.then(() => sql`ALTER TABLE sv_subscribers ADD COLUMN IF NOT EXISTS confirmed_at timestamptz, ADD COLUMN IF NOT EXISTS confirm_sent_at timestamptz, ADD COLUMN IF NOT EXISTS stances jsonb, ADD COLUMN IF NOT EXISTS stance_notes jsonb, ADD COLUMN IF NOT EXISTS prefs_at timestamptz`).catch((e) => { ready = null; throw e; }));
const KEY = /^[a-z_]{2,40}$/;
const dayHash = (ip) => createHash('sha256').update(`${new Date().toISOString().slice(0, 10)}|${ip}|sv-subscribe`).digest('hex').slice(0, 24);

export default async function handler(req, res) {
  if (!sql) return res.status(503).json({ ok: false, error: 'Sign-ups are not open yet.' });
  await init();
  const page = (h, p) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(`<!doctype html><meta name="viewport" content="width=device-width"><title>${h}</title><body style="font:18px/1.5 system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#14211c"><h1 style="font-family:Georgia,serif">${h}</h1>${p}<p><a href="https://squamishvoters.com/">Back to Squamish Voters</a></p>`); };
  if (req.query.unsubscribe && (req.method === 'GET' || req.method === 'POST')) {
    await sql`UPDATE sv_subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE token = ${String(req.query.unsubscribe)}`;
    return page('You’re unsubscribed', '<p>You won’t get the Squamish Voters email any more.</p>');
  }
  if (req.method === 'GET' && req.query.confirm) {
    const rows = await sql`UPDATE sv_subscribers SET status = 'subscribed', confirmed_at = coalesce(confirmed_at, now()) WHERE token = ${String(req.query.confirm)} AND status <> 'unsubscribed' RETURNING token`;
    if (!rows.length) return page('That link didn’t work', '<p>It may be old, or you unsubscribed. You can sign up again on the home page.</p>');
    res.statusCode = 303;
    res.setHeader('Location', `/welcome/?t=${encodeURIComponent(rows[0].token)}`);
    return res.end();
  }
  if (req.method === 'GET' && req.query.prefs) {
    const [r] = await sql`SELECT area, topics, stances, stance_notes FROM sv_subscribers WHERE token = ${String(req.query.prefs)} AND status <> 'unsubscribed'`;
    res.setHeader('Cache-Control', 'no-store');
    return res.json(r ? { ok: true, area: r.area || '', topics: r.topics || [], stances: r.stances || {}, notes: r.stance_notes || {} } : { ok: false });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (b.token) {
    const topics = (Array.isArray(b.topics) ? b.topics : []).map(String).filter((k) => KEY.test(k)).slice(0, 3);
    const st = b.stances && typeof b.stances === 'object' ? b.stances : {};
    const stances = Object.fromEntries(topics.filter((k) => /^[a-z_]{1,24}$/.test(String(st[k] || ''))).map((k) => [k, String(st[k])]));
    const nt = b.notes && typeof b.notes === 'object' ? b.notes : {};
    const notes = Object.fromEntries(topics.filter((k) => stances[k] === 'other' && typeof nt[k] === 'string' && nt[k].trim()).map((k) => [k, nt[k].replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 280)]));
    const rows = await sql`UPDATE sv_subscribers SET topics = ${JSON.stringify(topics)}, stances = ${JSON.stringify(stances)}, stance_notes = ${JSON.stringify(notes)}, area = ${String(b.area || '').slice(0, 40)}, prefs_at = now()
      WHERE token = ${String(b.token)} AND status <> 'unsubscribed' RETURNING 1`;
    return res.json(rows.length ? { ok: true } : { ok: false, error: 'This link no longer works, so your answers weren’t saved.' });
  }
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,}$/i.test(email)) return res.status(400).json({ ok: false, error: 'Please check your email address.' });
  if (b.consent !== true) return res.status(400).json({ ok: false, error: 'Please tick the box so we know you want the email.' });
  const ip = dayHash(String(req.headers['x-forwarded-for'] || '').split(',')[0]);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_subscribers WHERE ip_hash = ${ip} AND consent_at > now() - interval '1 day'`;
  if (n >= 10) return res.status(429).json({ ok: false, error: 'Too many sign-ups from here today.' });
  const topics = Array.isArray(b.topics) ? b.topics.slice(0, 20).map(String) : [];
  // Someone already confirmed stays confirmed; anyone else (new, pending, or back after unsubscribing) confirms again.
  const [row] = await sql`INSERT INTO sv_subscribers (email, status, token, consent_text, source, area, topics, ip_hash)
    VALUES (${email}, 'pending', ${randomBytes(18).toString('hex')}, ${CONSENT}, ${String(b.from || '').slice(0, 20)}, ${String(b.area || '').slice(0, 40)}, ${JSON.stringify(topics)}, ${ip})
    ON CONFLICT (email) DO UPDATE SET status = CASE WHEN sv_subscribers.status = 'subscribed' THEN 'subscribed' ELSE 'pending' END,
      consent_at = now(), unsubscribed_at = NULL,
      -- signing up again from a device with no picks keeps what they told us on the welcome page
      area = coalesce(nullif(EXCLUDED.area, ''), sv_subscribers.area),
      topics = CASE WHEN EXCLUDED.topics = '[]'::jsonb THEN sv_subscribers.topics ELSE EXCLUDED.topics END
    RETURNING status, token, confirm_sent_at`;
  if (row.status === 'subscribed') return res.json({ ok: true, pending: false });
  // At most one confirm email per address per hour, so the form can't be used to flood someone's inbox.
  if (mailReady() && !(row.confirm_sent_at && Date.now() - new Date(row.confirm_sent_at) < 3600e3)) {
    await sendConfirm(email, row.token).then(() => sql`UPDATE sv_subscribers SET confirm_sent_at = now() WHERE email = ${email}`).catch((e) => console.error('confirm email', e.message));
  }
  return res.json({ ok: true, pending: true, sent: mailReady() });
}
