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
<p>Replies are welcome. We read every one, and replying tells your email app you want to hear from us.</p>
<p style="font-size:14px;color:#5d6661;margin-top:26px">Didn’t ask for this? Ignore it and you won’t hear from us again. Questions? Just reply.</p>
</div></body></html>`,
    text: `One tap to confirm the weekly Squamish council email from Squamish Voters:\n${link}\n\nTo keep it out of spam, add ${fromAddress()} to your contacts.\nDidn't ask for this? Ignore this email and you won't hear from us again.`,
  };
}

export const FB_GROUP = 'https://www.facebook.com/groups/1090076830319905';

// Sent once, the first time someone taps the confirm link.
export function welcomeEmail(token) {
  const unsub = `${ORIGIN}/api/subscribe/?unsubscribe=${token}`;
  return {
    subject: 'You’re in: welcome to Squamish Voters',
    html: `<!doctype html><html><body style="margin:0;background:#f7f5ef;font:17px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#14211c">
<div style="max-width:560px;margin:0 auto;padding:28px 18px">
<p style="font-weight:700;color:#0f4c3a;margin:0 0 6px">Squamish Voters</p>
<h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 14px">Welcome, you’re confirmed</h1>
<p>Your first email arrives Friday morning: what Squamish council decided that week and what’s coming up, in plain words.</p>
<div style="background:#fff;border:1px solid #d9d5c8;border-radius:14px;padding:18px;margin:24px 0">
<a href="${FB_GROUP}"><img src="${ORIGIN}/img/facebook-group.jpg" width="520" alt="Squamish Voters and Politics Facebook group" style="width:100%;height:auto;border-radius:10px;display:block"></a>
<h2 style="font-family:Georgia,serif;font-size:21px;margin:16px 0 6px">Join the conversation on Facebook</h2>
<p style="margin:0 0 16px">Talk about council decisions with other people in Squamish in the <b>Squamish Voters and Politics</b> group.</p>
<a href="${FB_GROUP}" style="background:#1877f2;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px;display:inline-block">Join the Facebook group</a>
</div>
<p>In the meantime, see <a href="${ORIGIN}/meetings/" style="color:#0b5cab">what council is deciding next</a>, or <a href="${ORIGIN}/neighbourhoods/" style="color:#0b5cab">what’s happening in your neighbourhood</a>.</p>
<p>To keep these out of spam, add <b>${fromAddress()}</b> to your contacts. Replies are welcome; we read every one.</p>
<p style="font-size:14px;color:#5d6661;margin-top:26px">You’re getting this because you confirmed the weekly email at squamishvoters.com. <a href="${unsub}" style="color:#5d6661">Unsubscribe</a></p>
</div></body></html>`,
    text: `Welcome to Squamish Voters. You're confirmed, and your first email arrives Friday morning.\n\nJoin the conversation on Facebook, in the Squamish Voters and Politics group:\n${FB_GROUP}\n\nWhat council is deciding next: ${ORIGIN}/meetings/\n\nUnsubscribe: ${unsub}`,
  };
}

export async function sendWelcome(email, token) {
  const m = welcomeEmail(token);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [email], reply_to: REPLY_TO, headers: { 'List-Unsubscribe': `<${ORIGIN}/api/subscribe/?unsubscribe=${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, ...m }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
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
