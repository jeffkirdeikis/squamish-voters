// Resend webhook: every delivered, opened, clicked, bounced or spam report event for emails we send. Saved to sv_email_events
// (api/_track.js) and shown in the Emails tab of /subscribers/ (api/email-stats.js).
// Signed by Resend (Svix): checked against RESEND_WEBHOOK_SECRET, so nobody else can add fake opens or clicks.
// Only the link clicked is kept from a click, never the reader's IP address or device.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql, initTrack, campaignName } from './_track.js';

export const config = { api: { bodyParser: false } };

const KEEP = { 'email.sent': 'sent', 'email.delivered': 'delivered', 'email.opened': 'opened', 'email.clicked': 'clicked', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.delivery_delayed': 'delayed', 'email.failed': 'failed', 'email.suppressed': 'suppressed' };

async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const parts = [];
  for await (const c of req) parts.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(parts).toString('utf8');
}

export function verify(secret, id, ts, sigs, body) {
  if (!secret || !id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // older than 5 minutes: a replay
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const want = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
  return String(sigs).split(' ').some((s) => {
    const [v, b64] = s.split(',');
    if (v !== 'v1' || !b64) return false;
    const got = Buffer.from(b64, 'base64');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

function campaignOf(tags) {
  if (!tags) return null;
  if (Array.isArray(tags)) { const t = tags.find((x) => x && x.name === 'campaign'); return t ? campaignName(t.value) : null; }
  return tags.campaign ? campaignName(tags.campaign) : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const body = await rawBody(req);
  const h = req.headers;
  if (!verify(process.env.RESEND_WEBHOOK_SECRET, h['svix-id'], h['svix-timestamp'], h['svix-signature'], body)) return res.status(401).json({ ok: false, error: 'bad signature' });
  if (!sql) return res.status(503).json({ ok: false, error: 'no database' });
  let e;
  try { e = JSON.parse(body); } catch (x) { return res.status(400).json({ ok: false }); }
  const type = KEEP[e.type], d = e.data || {};
  if (!type || !d.email_id) return res.json({ ok: true, ignored: e.type });
  const detail = type === 'bounced' ? { bounce: d.bounce?.type || d.bounce?.subType || null, message: String(d.bounce?.message || '').slice(0, 300) } : null;
  await initTrack();
  await sql`INSERT INTO sv_email_events (id, email_id, type, at, link, recipient, subject, campaign, detail)
    VALUES (${h['svix-id']}, ${d.email_id}, ${type}, ${e.created_at || new Date().toISOString()}, ${type === 'clicked' ? String(d.click?.link || '').slice(0, 500) : null},
      ${[].concat(d.to || [])[0] || null}, ${String(d.subject || '').slice(0, 200)}, ${campaignOf(d.tags)}, ${detail ? JSON.stringify(detail) : null})
    ON CONFLICT (id) DO NOTHING`;
  return res.json({ ok: true });
}
