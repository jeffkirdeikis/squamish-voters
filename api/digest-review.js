// Jeff's OK for an email to every subscriber (scripts/pipeline/digest.mjs --request emails him the link).
//   GET  ?id=&t=            -> the email as readers will see it, with Approve and send / Skip buttons
//   POST id, t, action       -> approve sends it to every confirmed subscriber through Resend; skip drops it
// The link alone never sends anything: mail apps open links to scan them, so sending needs the button press (POST).
import { neon } from '@neondatabase/serverless';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
const ORIGIN = 'https://squamishvoters.com';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const shell = (title, body) => `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>
body{margin:0;background:#f7f5ef;color:#14211c;font:18px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.w{max-width:44rem;margin:0 auto;padding:1.2rem 1rem 3rem}h1{font:700 1.6rem/1.2 Georgia,serif;margin:.2rem 0 1rem}
.k{font:700 .75rem system-ui;letter-spacing:.1em;text-transform:uppercase;color:#0f4c3a}
.btns{display:flex;gap:.6rem;flex-wrap:wrap;margin:1.2rem 0}button{font:700 1.05rem system-ui;border:0;border-radius:12px;padding:.95rem 1.2rem;cursor:pointer;flex:1 1 12rem}
.go{background:#0f4c3a;color:#fff}.no{background:#efece3;color:#14211c}
.note{background:#fff;border:1px solid #d9d5c8;border-radius:12px;padding:.8rem 1rem;font-size:.92rem;color:#3f4b45}
.bad{background:#fbebeb;border-color:#e3b5b5}
iframe{width:100%;height:75vh;border:1px solid #d9d5c8;border-radius:12px;background:#f7f5ef}
</style></head><body><div class="w"><p class="k">Squamish Voters email</p>${body}</div></body></html>`;

async function sendAll(r) {
  const subs = await sql`SELECT email, token FROM sv_subscribers WHERE status = 'subscribed' ORDER BY email`;
  let sent = 0;
  for (let i = 0; i < subs.length; i += 100) {
    const batch = subs.slice(i, i + 100).map((s) => {
      const unsub = `${ORIGIN}/api/subscribe/?unsubscribe=${s.token}`;
      return { from: process.env.EMAIL_FROM, to: [s.email], subject: r.subject, html: r.html.replaceAll('%%UNSUB%%', unsub), reply_to: 'squamishvoters@gmail.com', headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
    });
    const res = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `digest-${r.id}-${i}` }, body: JSON.stringify(batch) });
    if (!res.ok) return { sent, total: subs.length, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    sent += batch.length;
  }
  return { sent, total: subs.length };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!sql) return res.status(503).send(shell('Not ready', '<h1>The database is not connected.</h1>'));
  const b = req.method === 'POST' ? (typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body || {}) : {};
  const id = String(b.id || req.query.id || ''), t = String(b.t || req.query.t || '');
  const [r] = id && t ? await sql`SELECT * FROM sv_digests WHERE id = ${id} AND token = ${t}` : [];
  if (!r) return res.status(404).send(shell('Link not found', '<h1>That link didn’t work</h1><p>It may be old or already used.</p>'));
  const done = (s) => res.send(shell('Already done', `<h1>${esc(r.subject)}</h1><p class="note">This email was already ${esc(s)}${r.sent_count ? ` (${r.sent_count} people)` : ''}. Nothing changed.</p>`));

  if (req.method === 'POST') {
    if (b.action === 'skip') {
      const [x] = await sql`UPDATE sv_digests SET status = 'skipped', decided_at = now() WHERE id = ${id} AND status = 'pending' RETURNING id`;
      return x ? res.send(shell('Skipped', '<h1>Skipped</h1><p>This email won’t go out.</p>')) : done(r.status);
    }
    // Claim it first, so a double tap can never send twice.
    const [x] = await sql`UPDATE sv_digests SET status = 'sending', decided_at = now() WHERE id = ${id} AND status = 'pending' RETURNING id`;
    if (!x) return done(r.status);
    const out = await sendAll(r);
    if (out.error && !out.sent) {
      await sql`UPDATE sv_digests SET status = 'pending', error = ${out.error} WHERE id = ${id}`;
      return res.send(shell('Not sent', `<h1>Nothing was sent</h1><p class="note bad">${esc(out.error)}</p><p>The email is still waiting. Open the link again to retry once this is fixed.</p>`));
    }
    await sql`UPDATE sv_digests SET status = ${out.error ? 'partial' : 'sent'}, sent_at = now(), sent_count = ${out.sent}, error = ${out.error || null} WHERE id = ${id}`;
    return res.send(shell('Sent', out.error
      ? `<h1>Sent to ${out.sent} of ${out.total}</h1><p class="note bad">It stopped partway: ${esc(out.error)}</p>`
      : `<h1>Sent</h1><p>“${esc(r.subject)}” went to ${out.sent} readers.</p>`));
  }

  if (r.status !== 'pending') return done(r.status);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_subscribers WHERE status = 'subscribed'`;
  return res.send(shell('Approve this email?', `<h1>Approve this email?</h1>
<p><b>Subject:</b> ${esc(r.subject)}<br><b>Goes to:</b> ${n} confirmed readers</p>
${r.error ? `<p class="note bad">Last try failed: ${esc(r.error)}</p>` : ''}
<form method="post" action="/api/digest-review/"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="t" value="${esc(t)}">
<div class="btns"><button class="go" name="action" value="approve">Approve and send to ${n} readers</button><button class="no" name="action" value="skip">Skip, don’t send</button></div></form>
<iframe sandbox title="The email" srcdoc="${esc(r.html.replaceAll('%%UNSUB%%', '#'))}"></iframe>`));
}
