// Runs every 10 minutes (Vercel cron, vercel.json). Compares the official flood picture with the last one it saw and
// emails confirmed flood alert subscribers (api/flood-alert.js) when one of these changes:
//   - the province's flood notice for the South Coast goes up to a Flood Warning, or ends after a Watch or Warning
//   - the regional district's evacuation list goes from none to active
//   - a new provincial forecast moves the coming peak by 10% or more from the last peak we emailed (or first saw)
// Fixed wording, facts only, every email links the story and the official source. A copy goes to the site inbox.
// The first run only records the state; it never emails. ?dry=1 reports what it would send without sending or saving.
import { forecast, notices, slrd, SIZES } from './flood.js';
import { sql, initFlood } from './flood-alert.js';
import { mailReady, ORIGIN, REPLY_TO } from './_mail.js';

const STORY = `${ORIGIN}/news/squamish-river-flood-forecast-nov-12/`;
const NOTICE = ['no flood notice', 'a High Streamflow Advisory', 'a Flood Watch', 'a Flood Warning'];
const n0 = (x) => Math.round(x).toLocaleString('en-CA');
const sizeName = (f) => f < SIZES.y2 ? 'under the size the river reaches every second year' : f < SIZES.y5 ? 'between a 1 in 2 and a 1 in 5 year flood'
  : f < SIZES.y10 ? 'between a 1 in 5 and a 1 in 10 year flood' : f < SIZES.y20 ? 'between a 1 in 10 and a 1 in 20 year flood'
  : f < SIZES.y50 ? 'between a 1 in 20 and a 1 in 50 year flood' : f < SIZES.y100 ? 'between a 1 in 50 and a 1 in 100 year flood' : 'bigger than a 1 in 100 year flood';
const when = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(t));

export function compare(prev, now) {
  const out = [];
  if (now.level != null && prev.level != null) {
    if (now.level === 3 && prev.level < 3) out.push({ subject: 'Flood Warning issued for the Squamish area', lines: [`The BC River Forecast Centre has issued a Flood Warning covering the South Coast, including Squamish. A Flood Warning means rivers are over their banks, or will be very soon.`], link: now.noticeUrl });
    else if (now.level === 0 && prev.level >= 2) out.push({ subject: 'Squamish flood notice has ended', lines: ['The BC River Forecast Centre no longer lists a flood notice for the South Coast. Rivers can stay high for a while; stay off riverbanks until the water drops.'], link: now.noticeUrl });
  }
  if (now.slrd === true && prev.slrd === false) out.push({ subject: 'Evacuation alert or order listed by the regional district', lines: ['The Squamish Lillooet Regional District now lists an active evacuation alert or order.', ...(now.slrdItems || []).map((x) => `Listed: ${x}`), 'An evacuation alert means be ready to leave. An evacuation order means leave now. Check the regional district page for the exact area.'], link: 'https://www.slrd.bc.ca/emergency-program/evacuation-alerts-orders' });
  if (now.peak && prev.sentPeak && now.issued && now.issued !== prev.issued && now.peakT > Date.now() && prev.sentPeakT > Date.now()) {
    const ch = (now.peak - prev.sentPeak) / prev.sentPeak;
    if (Math.abs(ch) >= 0.1) out.push({ peakMove: true, subject: `Squamish River forecast peak ${ch > 0 ? 'up' : 'down'} to ${n0(now.peak)}`, lines: [`The province's new forecast (issued ${now.issued}) has the Squamish River peaking near ${n0(now.peak)} cubic metres per second, ${when(now.peakT)}. That is ${sizeName(now.peak)}.`, `The last peak we sent you was ${n0(prev.sentPeak)}, so that is ${Math.round(Math.abs(ch) * 100)}% ${ch > 0 ? 'higher' : 'lower'}. Possible range about ${n0(now.low)} to ${n0(now.high)}.`], link: 'https://bcrfc.env.gov.bc.ca/freshet/clever/08GA022.PDF' });
  }
  return out;
}

function email(a, token) {
  const unsub = `${ORIGIN}/api/flood-alert/?unsubscribe=${token}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return {
    subject: a.subject,
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    html: `<!doctype html><html><body style="margin:0;background:#f7f5ef;font:17px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#14211c"><div style="max-width:560px;margin:0 auto;padding:28px 18px">
<p style="font-weight:700;color:#0f4c3a;margin:0 0 6px">Squamish Voters flood alert</p>
<h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 14px">${esc(a.subject)}</h1>
${a.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
<p><a href="${esc(a.link)}" style="color:#0b5cab">Official source</a> · <a href="${STORY}" style="color:#0b5cab">Live river numbers and what to do</a></p>
<p style="background:#fff4d6;border-radius:10px;padding:12px 14px;font-size:15px">If you are told to evacuate, leave. Emergency: 911. Regional district: 1-800-298-7753.</p>
<p style="font-size:13px;color:#5d6661;margin-top:24px">You asked for Squamish River flood alerts at squamishvoters.com. These do not replace official alerts. <a href="${unsub}" style="color:#5d6661">Turn off flood alerts</a></p>
</div></body></html>`,
    text: `${a.subject}\n\n${a.lines.join('\n\n')}\n\nOfficial source: ${a.link}\nLive river numbers and what to do: ${STORY}\n\nIf you are told to evacuate, leave. Emergency: 911.\n\nTurn off flood alerts: ${unsub}`,
  };
}

async function send(list) {
  // Resend batch: up to 100 emails a call.
  for (let i = 0; i < list.length; i += 100) {
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(list.slice(i, i + 100)) });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  }
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}` && req.query.key !== secret) return res.status(401).json({ ok: false });
  if (!sql) return res.status(503).json({ ok: false, error: 'no database' });
  await initFlood();
  const dry = req.query.dry === '1';
  const [f, n, s] = await Promise.all([forecast().catch(() => null), notices().catch(() => null), slrd().catch(() => null)]);
  const ahead = f ? f.rows.filter((r) => r[0] >= Date.now()) : [];
  const pk = ahead.length ? ahead.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
  const now = {
    level: n ? (n.here?.level || 0) : null, noticeUrl: n?.here?.url || n?.page || 'https://bcrfc.env.gov.bc.ca/warnings/index.htm',
    slrd: s ? s.active : null, slrdItems: s?.items || [],
    issued: f?.issued || null, peak: pk ? pk[1] : null, peakT: pk ? pk[0] : null,
    low: ahead.length ? Math.max(...ahead.map((r) => r[2])) : null, high: ahead.length ? Math.max(...ahead.map((r) => r[3])) : null,
  };
  // Save each new provincial run (median every 3 hours) so the story can show how the forecast has moved.
  if (f && pk && !dry) {
    await sql`CREATE TABLE IF NOT EXISTS sv_flood_runs (issued text PRIMARY KEY, peak int, peak_t bigint, series jsonb, at timestamptz NOT NULL DEFAULT now())`;
    await sql`INSERT INTO sv_flood_runs (issued, peak, peak_t, series) VALUES (${f.issued}, ${f.peak.flow}, ${f.peak.t}, ${JSON.stringify(f.rows.filter((r, i) => i % 3 === 0).map((r) => [r[0], r[1]]))}) ON CONFLICT (issued) DO NOTHING`;
  }
  const [row] = await sql`SELECT v FROM sv_flood_state WHERE k = 'squamish'`;
  const prev = row?.v || null;
  const alerts = prev ? compare(prev, now) : [];
  // Keep the last good value of any source that failed this time, so a failed check never looks like a change.
  const next = {
    level: now.level ?? prev?.level ?? null, slrd: now.slrd ?? prev?.slrd ?? null, issued: now.issued ?? prev?.issued ?? null,
    sentPeak: alerts.some((a) => a.peakMove) || !prev?.sentPeak ? now.peak ?? prev?.sentPeak ?? null : prev.sentPeak,
    sentPeakT: alerts.some((a) => a.peakMove) || !prev?.sentPeakT ? now.peakT ?? prev?.sentPeakT ?? null : prev.sentPeakT,
  };
  let sent = 0;
  if (!dry && alerts.length && mailReady()) {
    const subs = await sql`SELECT email, token FROM sv_flood_alerts WHERE status = 'subscribed'`;
    const msgs = [];
    for (const a of alerts) {
      for (const sub of subs) msgs.push({ from: process.env.EMAIL_FROM, to: [sub.email], reply_to: REPLY_TO, ...email(a, sub.token) });
      msgs.push({ from: process.env.EMAIL_FROM, to: [REPLY_TO], reply_to: REPLY_TO, ...email({ ...a, subject: `[Copy, sent to ${subs.length}] ${a.subject}` }, 'copy') });
    }
    await send(msgs); sent = msgs.length;
  }
  if (!dry) await sql`INSERT INTO sv_flood_state (k, v, at) VALUES ('squamish', ${JSON.stringify(next)}, now()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, at = now()`;
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, dry, first: !prev, now, prev, alerts: alerts.map((a) => a.subject), sent });
}
