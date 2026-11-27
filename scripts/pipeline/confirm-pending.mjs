// Send the confirm email to everyone still 'pending' who has never been sent one: covers sign-ups that came in
// before the email service was connected. One confirm email per person, never a weekly reminder. Runs before the Friday email (digest.yml); safe to rerun.
//   RESEND_API_KEY=… EMAIL_FROM=… POSTGRES_URL=… node scripts/pipeline/confirm-pending.mjs
import { mailReady, sendConfirm } from '../../api/_mail.js';
import { log } from './lib.mjs';

const DB = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!mailReady() || !DB) { log('no email service connected yet; nothing sent'); process.exit(0); }
const { neon } = await import('@neondatabase/serverless');
const sql = neon(DB);
const rows = await sql`SELECT email, token FROM sv_subscribers WHERE status = 'pending' AND confirm_sent_at IS NULL`;
// One bad sign-up must never stop the rest, or the Friday email that runs after this: on Nov 27 2026 a single address
// Resend refused crashed this script and the weekly email never got built. Addresses are never logged (the repo's logs are public).
let sent = 0, invalid = 0, failed = 0;
for (const r of rows) {
  try {
    await sendConfirm(r.email, r.token);
    await sql`UPDATE sv_subscribers SET confirm_sent_at = now() WHERE email = ${r.email}`;
    sent++;
  } catch (e) {
    if (/Invalid `to` field/.test(e.message)) { // not an address anyone can send to: park it so it isn't tried every Friday
      await sql`UPDATE sv_subscribers SET status = 'invalid' WHERE email = ${r.email} AND status = 'pending'`.catch(() => {});
      invalid++;
    } else { failed++; log(`a confirm email failed (will try again next run): ${e.message.slice(0, 200)}`); }
  }
  await new Promise((ok) => setTimeout(ok, 600)); // Resend's default limit is 2 a second
}
log(`confirm emails sent: ${sent}${invalid ? `; ${invalid} sign-up(s) with an address Resend can't send to, marked invalid` : ''}${failed ? `; ${failed} failed` : ''}`);
