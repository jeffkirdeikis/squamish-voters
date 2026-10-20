// Send the confirm email to everyone still 'pending' who hasn't been sent one in the last day: covers sign-ups
// that came in before the email service was connected. Runs before the Friday email (digest.yml); safe to rerun.
//   RESEND_API_KEY=… EMAIL_FROM=… POSTGRES_URL=… node scripts/pipeline/confirm-pending.mjs
import { mailReady, sendConfirm } from '../../api/_mail.js';
import { log } from './lib.mjs';

const DB = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!mailReady() || !DB) { log('no email service connected yet; nothing sent'); process.exit(0); }
const { neon } = await import('@neondatabase/serverless');
const sql = neon(DB);
const rows = await sql`SELECT email, token FROM sv_subscribers WHERE status = 'pending' AND (confirm_sent_at IS NULL OR confirm_sent_at < now() - interval '1 day')`;
for (const r of rows) {
  await sendConfirm(r.email, r.token);
  await sql`UPDATE sv_subscribers SET confirm_sent_at = now() WHERE email = ${r.email}`;
  await new Promise((ok) => setTimeout(ok, 600)); // Resend's default limit is 2 a second
}
log(`confirm emails sent: ${rows.length}`);
