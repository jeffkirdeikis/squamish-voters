// The Friday email: "This week at council". Built from the live site's /this-week.json so the email and the
// /this-week/ page always say the same thing.
//   node scripts/pipeline/digest.mjs           writes a preview to data/digest/<date>.html
//   node scripts/pipeline/digest.mjs --send    also sends it, once an email service is connected
// Sending needs RESEND_API_KEY, EMAIL_FROM (e.g. "Squamish Voters <news@squamishvoters.com>") and POSTGRES_URL
// (the sign-up list from api/subscribe.js). Without them it only writes the preview.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log } from './lib.mjs';

const ORIGIN = 'https://squamishvoters.com';
const W = await (await fetch(`${ORIGIN}/this-week.json`)).json();
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
if (!W.recent.length && !W.soon.length) { log('nothing this week; no email'); process.exit(0); }

const subject = W.recent.length ? `Council this week: ${W.recent[0].headline}`.slice(0, 120) : `Coming up at council: ${day(W.soon[0].date)}`;
const body = (unsub) => `<!doctype html><html><body style="margin:0;background:#f7f5ef;font:17px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#14211c">
<div style="max-width:600px;margin:0 auto;padding:24px 18px">
<p style="font-weight:700;color:#0f4c3a;margin:0 0 4px">Squamish Voters</p><h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 18px">This week at council</h1>
${W.recent.length ? `<h2 style="font-size:20px;margin:22px 0 8px">What council decided</h2>` : ''}
${W.recent.map((m) => `<div style="background:#fff;border:1px solid #d9d5c8;border-radius:12px;padding:16px;margin:0 0 14px">
  <p style="margin:0 0 6px;color:#44504a;font-size:15px">${esc(day(m.date))} · ${esc(m.type)}</p>
  <p style="margin:0 0 10px;font-weight:700;font-size:18px">${esc(m.headline)}</p>
  <ul style="margin:0 0 10px;padding-left:20px">${m.key_points.map((k) => `<li style="margin:4px 0">${esc(k)}</li>`).join('')}</ul>
  ${m.votes.filter((v) => v.for_you).map((v) => `<p style="margin:6px 0;background:#fff4d6;border-radius:8px;padding:8px 10px;font-size:15px"><b>${esc(v.title)}:</b> ${esc(v.for_you)}</p>`).join('')}
  <a href="${m.url}" style="color:#0b5cab;font-weight:700">See every vote →</a></div>`).join('')}
${W.soon.length ? `<h2 style="font-size:20px;margin:22px 0 8px">Coming up</h2>` : ''}
${W.soon.map((m) => `<div style="background:#fff;border:1px solid #d9d5c8;border-radius:12px;padding:16px;margin:0 0 14px">
  <p style="margin:0 0 6px;font-weight:700">${esc(day(m.date))}${m.time ? ` · ${esc(m.time)}` : ''} · ${esc(m.type)}</p>
  <p style="margin:0 0 8px">${esc(m.preview)}</p>${m.items.length ? `<ul style="margin:0 0 8px;padding-left:20px">${m.items.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
  <a href="${m.url}" style="color:#0b5cab;font-weight:700">How to watch or have your say →</a></div>`).join('')}
<p style="font-size:14px;color:#5d6661;margin-top:26px">Squamish Voters is an independent, plain-language guide to Squamish council, made by Jeff Kirdeikis in Squamish, B.C. You’re getting this because you signed up at squamishvoters.com.
${unsub ? `<a href="${unsub}" style="color:#5d6661">Unsubscribe</a>.` : ''}</p></div></body></html>`;

const dir = path.join(ROOT, 'data', 'digest'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${W.built}.html`), body(`${ORIGIN}/api/subscribe/?unsubscribe=PREVIEW`));
log('preview written', `data/digest/${W.built}.html`, '|', subject);

if (!process.argv.includes('--send')) process.exit(0);
const { RESEND_API_KEY, EMAIL_FROM } = process.env, DB = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!RESEND_API_KEY || !EMAIL_FROM || !DB) { log('no email service connected yet; preview only'); process.exit(0); }
const { neon } = await import('@neondatabase/serverless');
const subs = await neon(DB)`SELECT email, token FROM sv_subscribers WHERE status = 'subscribed'`;
for (let i = 0; i < subs.length; i += 100) {
  const batch = subs.slice(i, i + 100).map((s) => {
    const unsub = `${ORIGIN}/api/subscribe/?unsubscribe=${s.token}`;
    return { from: EMAIL_FROM, to: [s.email], subject, html: body(unsub), headers: { 'List-Unsubscribe': `<${unsub}>` } };
  });
  const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}
log(`sent to ${subs.length}`);
