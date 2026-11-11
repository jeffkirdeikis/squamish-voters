// Flood alert emails: sign up on a flood story, confirm by email (double opt in), unsubscribe any time.
// The emails themselves are sent by api/flood-watch.js when something official changes.
//   POST { email, consent: true }  -> { ok, pending }
//   GET  ?confirm=<token>          -> confirmed page
//   GET or POST ?unsubscribe=<token> -> unsubscribed page (POST is the one click unsubscribe mail apps use)
import { neon } from '@neondatabase/serverless';
import { randomBytes } from 'node:crypto';
import { mailReady, ORIGIN, REPLY_TO } from './_mail.js';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
export const CONSENT = 'Entered email and pressed "Email me flood alerts" on a Squamish Voters flood story: one email when the province issues a Flood Warning or ends its notice, the regional district lists an evacuation alert or order, or the forecast peak moves by 10% or more. Confirmed by email link; unsubscribe any time.';
let ready = null;
export const initFlood = () => (ready ||= sql`CREATE TABLE IF NOT EXISTS sv_flood_alerts (
  email text PRIMARY KEY, status text NOT NULL DEFAULT 'pending', token text NOT NULL, consent_text text NOT NULL,
  consent_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz, confirm_sent_at timestamptz, unsubscribed_at timestamptz)`
  .then(() => sql`CREATE TABLE IF NOT EXISTS sv_flood_state (k text PRIMARY KEY, v jsonb NOT NULL, at timestamptz NOT NULL DEFAULT now())`)
  .catch((e) => { ready = null; throw e; }));
export { sql };

async function sendConfirm(email, token) {
  const link = `${ORIGIN}/api/flood-alert/?confirm=${token}`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM, to: [email], reply_to: REPLY_TO,
      subject: 'Confirm: Squamish River flood alerts',
      html: `<!doctype html><html><body style="margin:0;background:#f7f5ef;font:17px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#14211c"><div style="max-width:560px;margin:0 auto;padding:28px 18px">
<p style="font-weight:700;color:#0f4c3a;margin:0 0 6px">Squamish Voters</p>
<h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 14px">One tap to turn on flood alerts</h1>
<p>Someone (hopefully you) asked for Squamish River flood alerts at squamishvoters.com. We email only when something official changes:</p>
<ul><li>The province issues a Flood Warning for the area, or ends its flood notice</li><li>The regional district lists an evacuation alert or order</li><li>The forecast peak moves up or down by 10% or more</li></ul>
<p style="margin:26px 0"><a href="${link}" style="background:#0f4c3a;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:10px;display:inline-block">Yes, send me flood alerts</a></p>
<p style="font-size:14px;color:#5d6661">These alerts do not replace official alerts. Also sign up for SLRD Alert or Squamish Alert. Didn’t ask for this? Ignore it and you won’t hear from us.</p>
</div></body></html>`,
      text: `Turn on Squamish River flood alerts from Squamish Voters:\n${link}\n\nWe email only when the province issues a Flood Warning or ends its notice, the regional district lists an evacuation alert or order, or the forecast peak moves by 10% or more.\nDidn't ask for this? Ignore this email.`,
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

export default async function handler(req, res) {
  if (!sql) return res.status(503).json({ ok: false, error: 'Alerts are not available yet.' });
  await initFlood();
  const page = (h, p) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(`<!doctype html><meta name="viewport" content="width=device-width"><title>${h}</title><body style="font:18px/1.5 system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#14211c"><h1 style="font-family:Georgia,serif">${h}</h1>${p}<p><a href="${ORIGIN}/news/">Back to Squamish news</a></p>`); };
  if (req.query.unsubscribe && (req.method === 'GET' || req.method === 'POST')) {
    await sql`UPDATE sv_flood_alerts SET status = 'unsubscribed', unsubscribed_at = now() WHERE token = ${String(req.query.unsubscribe)}`;
    return page('Flood alerts are off', '<p>You won’t get Squamish River flood alerts any more.</p>');
  }
  if (req.method === 'GET' && req.query.confirm) {
    const rows = await sql`UPDATE sv_flood_alerts SET status = 'subscribed', confirmed_at = coalesce(confirmed_at, now()) WHERE token = ${String(req.query.confirm)} AND status <> 'unsubscribed' RETURNING email`;
    if (!rows.length) return page('That link didn’t work', '<p>It may be old, or you turned alerts off. You can sign up again on the flood story.</p>');
    return page('Flood alerts are on', '<p>We’ll email you when the province issues a Flood Warning or ends its notice, the regional district lists an evacuation alert or order, or the forecast peak moves by 10% or more.</p><p>These do not replace official alerts. Also sign up for <a href="https://www.slrd.bc.ca/SLRDAlert">SLRD Alert</a> or <a href="https://squamish.ca/alert">Squamish Alert</a>.</p>');
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return res.status(400).json({ ok: false, error: 'That email address doesn’t look right.' });
  if (b.consent !== true) return res.status(400).json({ ok: false, error: 'Please tick the box to say we can email you.' });
  const token = randomBytes(18).toString('base64url');
  const [row] = await sql`INSERT INTO sv_flood_alerts (email, token, consent_text) VALUES (${email}, ${token}, ${CONSENT})
    ON CONFLICT (email) DO UPDATE SET status = CASE WHEN sv_flood_alerts.status = 'subscribed' THEN 'subscribed' ELSE 'pending' END, consent_text = ${CONSENT}, consent_at = now()
    RETURNING status, token, confirm_sent_at`;
  if (row.status === 'subscribed') return res.json({ ok: true, already: true });
  // At most one confirm email an hour per address, so the form cannot be used to flood someone's inbox.
  if (mailReady() && !(row.confirm_sent_at && Date.now() - new Date(row.confirm_sent_at) < 3600e3)) {
    await sendConfirm(email, row.token).then(() => sql`UPDATE sv_flood_alerts SET confirm_sent_at = now() WHERE email = ${email}`).catch((e) => console.error('flood confirm', e.message));
  }
  return res.json({ ok: true, pending: true });
}
