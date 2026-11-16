// Private email stats for the Emails tab of /subscribers/. Requires ADMIN_TOKEN (Authorization: Bearer <token>).
//   GET -> { ok, emails: [ one row per email sent: who it went to, delivered, opened, clicked, bounced, spam reports,
//            links clicked, and site visits from its tagged links ] }
// Built from sv_email_sends + sv_email_events (api/_track.js, api/resend-events.js) and sv_pv (api/pulse.js).
import { sql, initTrack } from './_track.js';

const NAMES = { digest: 'Friday email', welcome: 'Welcome email', confirm: 'Please confirm email', flood: 'Flood alert', 'flood-confirm': 'Flood alert confirm' };

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!sql) return res.status(503).json({ ok: false, error: 'no database' });
  await initTrack();
  const [camps, ev, links, people, visits, since] = await Promise.all([
    sql`SELECT campaign, kind, max(subject) AS subject, min(sent_at) AS first_at, max(sent_at) AS last_at, count(*)::int AS sent
      FROM sv_email_sends GROUP BY campaign, kind ORDER BY max(sent_at) DESC LIMIT 200`,
    sql`SELECT s.campaign, e.type, count(DISTINCT e.email_id)::int AS people, count(*)::int AS events
      FROM sv_email_events e JOIN sv_email_sends s USING (email_id) GROUP BY s.campaign, e.type`,
    sql`SELECT s.campaign, e.link, count(*)::int AS clicks, count(DISTINCT e.email_id)::int AS people
      FROM sv_email_events e JOIN sv_email_sends s USING (email_id) WHERE e.type = 'clicked' AND e.link IS NOT NULL
      GROUP BY s.campaign, e.link ORDER BY clicks DESC`,
    sql`SELECT s.campaign, s.recipient, bool_or(e.type = 'opened') AS opened, bool_or(e.type = 'clicked') AS clicked,
        bool_or(e.type = 'bounced') AS bounced, bool_or(e.type = 'complained') AS complained, count(*) FILTER (WHERE e.type = 'clicked')::int AS clicks
      FROM sv_email_sends s LEFT JOIN sv_email_events e USING (email_id) GROUP BY s.campaign, s.recipient`,
    // Sign-up and flood emails: utm_source=email-<campaign> (api/_track.js). Friday emails: scripts/pipeline/digest.mjs tags
    // utm_campaign=weekly-<date>, stored as 'squamish-voters-email:weekly-<date>' (src/pulse.js); the digest id starts with that date.
    sql`SELECT CASE WHEN utm LIKE 'email-%' THEN substring(utm from 7) ELSE 'weekly:' || substring(utm from 'weekly-(.*)$') END AS campaign,
        count(*)::int AS views, count(DISTINCT sid)::int AS visitors
      FROM sv_pv WHERE utm LIKE 'email-%' OR utm LIKE '%:weekly-%' GROUP BY 1`.catch(() => []),
    sql`SELECT min(at) AS at FROM sv_email_events`,
  ]);
  const emails = camps.map((c) => {
    const t = {}; ev.filter((x) => x.campaign === c.campaign).forEach((x) => { t[x.type] = x.people; });
    const key = c.kind === 'digest' ? 'weekly:' + c.campaign.slice(7, 17) : c.campaign;
    const v = visits.find((x) => x.campaign === key) || {};
    const who = people.filter((p) => p.campaign === c.campaign);
    return {
      campaign: c.campaign, kind: c.kind, name: NAMES[c.kind] || c.kind, subject: c.subject, first_at: c.first_at, last_at: c.last_at,
      sent: c.sent, delivered: t.delivered || 0, opened: t.opened || 0, clicked: t.clicked || 0, bounced: t.bounced || 0, complained: t.complained || 0,
      views: v.views || 0, visitors: v.visitors || 0,
      links: links.filter((l) => l.campaign === c.campaign).slice(0, 25).map((l) => ({ link: l.link, clicks: l.clicks, people: l.people })),
      people: who.filter((p) => p.opened || p.clicked || p.bounced || p.complained).sort((a, b) => b.clicks - a.clicks || (b.opened - a.opened))
        .slice(0, 300).map((p) => ({ email: p.recipient, opened: p.opened, clicked: p.clicked, clicks: p.clicks, bounced: p.bounced, complained: p.complained })),
    };
  });
  return res.json({ ok: true, tracking_since: since[0]?.at || null, emails });
}
