// Posts the most shareable new News stories to the Squamish Voters Facebook Page. Run by .github/workflows/news.yml
// after each pass. Does nothing until the FB_PAGE_TOKEN secret is set (a long lived Page access token with
// pages_manage_posts, from Jeff's Meta developer app).
//   Which stories: share score 4 or 5 (FB_MIN_SHARE changes it), dated today or yesterday, live on the site already
//   (Facebook reads the picture and title from the page when it posts), at most FB_PER_DAY (4) in 24 hours, one per pass.
//   Post text: the story's "social" text written by the drafter, then the link.
//   Every post is recorded in sv_fb_posts, so nothing posts twice. A story that fails 3 passes in a row emails Jeff once.
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { ROOT, log, readJson } from './lib.mjs';

const TOKEN = process.env.FB_PAGE_TOKEN;
if (!TOKEN) { log('facebook: no FB_PAGE_TOKEN yet, skipping'); process.exit(0); }
const ORIGIN = 'https://squamishvoters.com';
const MIN_SHARE = +(process.env.FB_MIN_SHARE || 4), PER_DAY = +(process.env.FB_PER_DAY || 4);
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
await sql`CREATE TABLE IF NOT EXISTS sv_fb_posts (slug text PRIMARY KEY, status text NOT NULL, post_id text, tries int NOT NULL DEFAULT 0, error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;

const day = (offset) => new Date(Date.now() - offset * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
const news = readJson(path.join(ROOT, 'data', 'news.json'));
const rows = await sql`SELECT slug, status, created_at FROM sv_fb_posts`;
const done = new Set(rows.filter((r) => r.status === 'posted' || r.status === 'failed').map((r) => r.slug));
const postedToday = rows.filter((r) => r.status === 'posted' && Date.now() - new Date(r.created_at) < 864e5).length;
if (postedToday >= PER_DAY) { log(`facebook: ${postedToday} posts in the last day, waiting`); process.exit(0); }

const next = news.stories
  .filter((st) => (st.share || 0) >= MIN_SHARE && st.date >= day(1) && !done.has(st.slug))
  .sort((a, b) => (b.share || 0) - (a.share || 0) || b.date.localeCompare(a.date))[0];
if (!next) { log('facebook: nothing new to post'); process.exit(0); }

const url = `${ORIGIN}/news/${next.slug}/`;
const live = await fetch(url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
if (!live) { log(`facebook: ${next.slug} isn't live yet, next pass`); process.exit(0); }

const message = String(next.social || `${next.head}\n\n${String(next.dek || '').replace(/<[^>]+>/g, '')}`).trim();
const r = await fetch('https://graph.facebook.com/me/feed', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ message, link: url, access_token: TOKEN }),
});
const j = await r.json().catch(() => ({}));
if (r.ok && j.id) {
  await sql`INSERT INTO sv_fb_posts (slug, status, post_id) VALUES (${next.slug}, 'posted', ${j.id})
    ON CONFLICT (slug) DO UPDATE SET status = 'posted', post_id = EXCLUDED.post_id, updated_at = now()`;
  log(`facebook: posted ${next.slug} (${j.id})`);
} else {
  const err = String(j.error?.message || r.statusText).slice(0, 400);
  const [row] = await sql`INSERT INTO sv_fb_posts (slug, status, tries, error) VALUES (${next.slug}, 'error', 1, ${err})
    ON CONFLICT (slug) DO UPDATE SET tries = sv_fb_posts.tries + 1, error = EXCLUDED.error, updated_at = now() RETURNING tries`;
  log(`facebook: failed ${next.slug}: ${err}`);
  if (row.tries >= 3) {
    await sql`UPDATE sv_fb_posts SET status = 'failed' WHERE slug = ${next.slug}`;
    if (process.env.NEWS_REVIEW_TO && process.env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [process.env.NEWS_REVIEW_TO], subject: `Facebook Page posting failed: "${next.head}"`,
          text: `The story couldn't be posted to the Squamish Voters Facebook Page after 3 tries.\n\nStory: ${url}\nError: ${err}\n\nIf the error mentions the access token, it has expired or lost permission: make a new Page token and update the FB_PAGE_TOKEN secret in GitHub.\nLogs: https://github.com/jeffkirdeikis/squamish-voters/actions/workflows/news.yml` }) }).catch(() => {});
    }
  }
}
