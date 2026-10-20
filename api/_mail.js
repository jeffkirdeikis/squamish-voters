// The "please confirm" email sent after someone signs up. Used by api/subscribe.js (right away, once an email
// service is connected) and by scripts/pipeline/confirm-pending.mjs (for sign-ups that came in before that).
// Files starting with _ in api/ are not served as endpoints.
export const ORIGIN = 'https://squamishvoters.com';
export const REPLY_TO = 'squamishvoters@gmail.com';
export const mailReady = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
const fromAddress = () => (String(process.env.EMAIL_FROM).match(/<([^>]+)>/) || [, process.env.EMAIL_FROM])[1];

export function confirmEmail(token) {
  const link = `${ORIGIN}/api/subscribe/?confirm=${token}`;
  return {
    subject: 'Please confirm: the weekly Squamish council email',
    html: `<!doctype html><html><body style="margin:0;background:#f7f5ef;font:17px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#14211c">
<div style="max-width:560px;margin:0 auto;padding:28px 18px">
<p style="font-weight:700;color:#0f4c3a;margin:0 0 6px">Squamish Voters</p>
<h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 14px">One tap to confirm</h1>
<p>Someone (hopefully you) asked for the weekly Squamish council email at squamishvoters.com. Tap the button to start getting it every Friday morning.</p>
<p style="margin:26px 0"><a href="${link}" style="background:#0f4c3a;color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:10px;display:inline-block">Yes, send me the weekly email</a></p>
<p>To make sure it reaches your inbox and not spam, add <b>${fromAddress()}</b> to your contacts. In Gmail, if this landed in Promotions or Spam, move it to your Primary inbox.</p>
<p style="font-size:14px;color:#5d6661;margin-top:26px">Didn’t ask for this? Ignore it and you won’t hear from us again. Questions? Just reply.</p>
</div></body></html>`,
    text: `One tap to confirm the weekly Squamish council email from Squamish Voters:\n${link}\n\nTo keep it out of spam, add ${fromAddress()} to your contacts.\nDidn't ask for this? Ignore this email and you won't hear from us again.`,
  };
}

export async function sendConfirm(email, token) {
  const m = confirmEmail(token);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [email], reply_to: REPLY_TO, ...m }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}
