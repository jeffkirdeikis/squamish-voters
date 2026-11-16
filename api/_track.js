// Email stats for reader emails (the Friday email, welcome, confirm, flood alerts).
//   tagLinks(html, campaign)  adds utm_source=email-<campaign> to every squamishvoters.com link (not /api/ links like
//                             unsubscribe or confirm), so the site's own reading stats (api/pulse.js) count visits per email.
//   recordSends(rows)         one row per email Resend accepted, keyed by Resend's email id.
//   sv_email_events           filled by api/resend-events.js from Resend's webhook: delivered, opened, clicked, bounced, complained.
// Files starting with _ in api/ are not served as endpoints.
import { neon } from '@neondatabase/serverless';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
export const sql = URL ? neon(URL) : null;
let ready = null;
export const initTrack = () => (ready ||= sql`CREATE TABLE IF NOT EXISTS sv_email_sends (
  email_id text PRIMARY KEY, campaign text NOT NULL, kind text NOT NULL, subject text, recipient text, sent_at timestamptz NOT NULL DEFAULT now())`
  .then(() => sql`CREATE INDEX IF NOT EXISTS sv_email_sends_campaign ON sv_email_sends (campaign)`)
  .then(() => sql`CREATE TABLE IF NOT EXISTS sv_email_events (
  id text PRIMARY KEY, email_id text NOT NULL, type text NOT NULL, at timestamptz NOT NULL, link text, recipient text, subject text, campaign text, detail jsonb)`)
  .then(() => sql`CREATE INDEX IF NOT EXISTS sv_email_events_email ON sv_email_events (email_id)`)
  .catch((e) => { ready = null; throw e; }));

// Campaign names go into a tag and a link tag: letters, numbers, dashes only, short enough for the site's 40 character utm field.
export const campaignName = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 33) || 'email';
export const tags = (campaign, kind) => [{ name: 'campaign', value: campaignName(campaign) }, { name: 'kind', value: campaignName(kind) }];

export function tagLinks(html, campaign) {
  const src = 'email-' + campaignName(campaign);
  return String(html).replace(/href="(https:\/\/(?:www\.)?squamishvoters\.com[^"#]*)(#[^"]*)?"/g, (m, url, hash = '') => {
    if (/\/api\//.test(url) || /[?&]utm_source=/.test(url)) return m;
    return `href="${url}${url.includes('?') ? '&amp;' : '?'}utm_source=${src}&amp;utm_medium=email${hash}"`;
  });
}

// rows: [{ id, campaign, kind, subject, to }]. Never throws: stats must never stop an email going out.
export async function recordSends(rows) {
  if (!sql || !rows.length) return;
  try {
    await initTrack();
    const ids = rows.map((r) => r.id), camps = rows.map((r) => campaignName(r.campaign)), kinds = rows.map((r) => r.kind),
      subs = rows.map((r) => r.subject || null), tos = rows.map((r) => r.to || null);
    await sql`INSERT INTO sv_email_sends (email_id, campaign, kind, subject, recipient)
      SELECT * FROM unnest(${ids}::text[], ${camps}::text[], ${kinds}::text[], ${subs}::text[], ${tos}::text[]) ON CONFLICT (email_id) DO NOTHING`;
  } catch (e) { console.error('recordSends', e.message); }
}

// Send one reader email through Resend with its campaign tag and tagged links, and record it. Returns Resend's id.
export async function sendTracked(msg, { campaign, kind }) {
  const body = { ...msg, html: msg.html ? tagLinks(msg.html, campaign) : msg.html, tags: tags(campaign, kind) };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  const { id } = await r.json();
  await recordSends([{ id, campaign, kind, subject: msg.subject, to: [].concat(msg.to)[0] }]);
  return id;
}
