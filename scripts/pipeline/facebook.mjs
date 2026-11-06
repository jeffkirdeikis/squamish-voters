// Posts the most shareable new News stories to the Squamish Voters Facebook Page. Run by .github/workflows/news.yml
// after each pass. Does nothing until the Facebook secrets are set (see below), from Jeff's Meta developer app.
//   Which stories: share score 4 or 5 (FB_MIN_SHARE changes it), dated today or yesterday, live on the site already
//   (Facebook reads the picture and title from the page when it posts), at most FB_PER_DAY (4) in 24 hours, one per pass.
//   Post text: the story's "social" text written by the drafter, then the link.
//   Every post is recorded in sv_fb_posts, so nothing posts twice. A story that fails 3 passes in a row emails Jeff once.
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { ROOT, log, readJson } from './lib.mjs';

// Two ways in. FB_PAGE_TOKEN: a Page token pasted directly. Or FB_APP_ID + FB_APP_SECRET + FB_USER_TOKEN (the
// short lived token from the Graph API Explorer): the first pass trades it for a long lived one, then for the Page's
// own token, which doesn't expire. That Page token is kept in sv_fb_auth, so the user token can expire afterwards.
import crypto from 'node:crypto';
const { FB_PAGE_TOKEN, FB_APP_ID, FB_APP_SECRET, FB_USER_TOKEN } = process.env;
// Paused Nov 6 2026: Meta wants Jeff to confirm his identity (facebook.com/id) before any app can post as the Page, and he
// chose not to. Set FB_POSTING to 'on' in news.yml once that's done; the connection itself already works.
if (process.env.FB_POSTING !== 'on') { log('facebook: posting paused'); process.exit(0); }
if (!FB_PAGE_TOKEN && !(FB_APP_ID && FB_APP_SECRET && FB_USER_TOKEN)) { log('facebook: no Facebook token yet, skipping'); process.exit(0); }
const ORIGIN = 'https://squamishvoters.com', GRAPH = 'https://graph.facebook.com/v27.0';
const MIN_SHARE = +(process.env.FB_MIN_SHARE || 4), PER_DAY = +(process.env.FB_PER_DAY || 4);
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
const graph = async (u) => { const j = await (await fetch(u)).json(); if (j.error) throw new Error(j.error.message); return j; };
async function pageToken() {
  if (FB_PAGE_TOKEN) return FB_PAGE_TOKEN;
  await sql`CREATE TABLE IF NOT EXISTS sv_fb_auth (id int PRIMARY KEY, page_id text, page_name text, page_token text, from_user text, updated_at timestamptz NOT NULL DEFAULT now())`;
  const from = crypto.createHash('sha256').update(FB_USER_TOKEN).digest('hex').slice(0, 16);
  const [have] = await sql`SELECT page_token, from_user FROM sv_fb_auth WHERE id = 1`;
  if (have && have.from_user === from) return have.page_token;
  const long = await graph(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(FB_APP_ID)}&client_secret=${encodeURIComponent(FB_APP_SECRET)}&fb_exchange_token=${encodeURIComponent(FB_USER_TOKEN)}`);
  const pages = (await graph(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(long.access_token)}`)).data || [];
  const page = pages.find((p) => p.id === process.env.FB_PAGE_ID) || pages.find((p) => /squamish voters/i.test(p.name)) || (pages.length === 1 ? pages[0] : null);
  if (!page) throw new Error(`no Squamish Voters Page among this login's Pages (${pages.map((p) => p.name).join(', ') || 'none'}); tick the Page when granting access`);
  await sql`INSERT INTO sv_fb_auth (id, page_id, page_name, page_token, from_user) VALUES (1, ${page.id}, ${page.name}, ${page.access_token}, ${from})
    ON CONFLICT (id) DO UPDATE SET page_id = EXCLUDED.page_id, page_name = EXCLUDED.page_name, page_token = EXCLUDED.page_token, from_user = EXCLUDED.from_user, updated_at = now()`;
  log(`facebook: connected to the Page "${page.name}"`);
  return page.access_token;
}
let TOKEN;
try { TOKEN = await pageToken(); } catch (e) {
  log(`facebook: can't get a Page token: ${e.message}`);
  // Once a day at most: tell Jeff the Facebook login needs redoing.
  await sql`CREATE TABLE IF NOT EXISTS sv_fb_posts (slug text PRIMARY KEY, status text NOT NULL, post_id text, tries int NOT NULL DEFAULT 0, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  const [r] = await sql`INSERT INTO sv_fb_posts (slug, status, error) VALUES ('_auth', 'error', ${e.message.slice(0, 400)}) ON CONFLICT (slug) DO UPDATE SET error = EXCLUDED.error,
    updated_at = CASE WHEN sv_fb_posts.updated_at < now() - interval '1 day' THEN now() ELSE sv_fb_posts.updated_at END, tries = CASE WHEN sv_fb_posts.updated_at < now() - interval '1 day' THEN 0 ELSE sv_fb_posts.tries + 1 END RETURNING tries`;
  if (r.tries === 0 && process.env.NEWS_REVIEW_TO && process.env.RESEND_API_KEY) await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [process.env.NEWS_REVIEW_TO], subject: 'Facebook Page posting needs a fresh login', text: `Squamish Voters News couldn't connect to the Facebook Page.\n\nError: ${e.message}\n\nMake a new user token in the Graph API Explorer and update the FB_USER_TOKEN secret in GitHub (Claude can walk you through it).` }) }).catch(() => {});
  process.exit(0);
}
await sql`CREATE TABLE IF NOT EXISTS sv_fb_posts (slug text PRIMARY KEY, status text NOT NULL, post_id text, tries int NOT NULL DEFAULT 0, error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;

const day = (offset) => new Date(Date.now() - offset * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
const news = readJson(path.join(ROOT, 'data', 'news.json'));
const rows = await sql`SELECT slug, status, created_at FROM sv_fb_posts`;
const done = new Set(rows.filter((r) => r.slug !== '_auth' && (r.status === 'posted' || r.status === 'failed')).map((r) => r.slug));
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
const r = await fetch(`${GRAPH}/me/feed`, {
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
  // Account problems (Meta wants Jeff to confirm his identity, or the token lost permission) aren't the story's fault:
  // don't use up its 3 tries, just wait and try again next pass.
  if (/confirm your identity|access token|permission|session/i.test(err)) { log(`facebook: waiting on the Facebook account: ${err}`); process.exit(0); }
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
