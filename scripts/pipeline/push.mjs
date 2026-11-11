// Sends phone alerts to people who turned them on in the Squamish Voters app. Run by .github/workflows/news.yml after
// each pass. Does nothing until the Apple (and later Google) keys are set as repository secrets.
//   Which stories: dated today or yesterday, live on the site already, never alerted before (sv_push_sent).
//   "Big" stories go to everyone with alerts on: share score 4 or 5, or the lead story. At most PUSH_BIG_PER_DAY (3) a day.
//   Every other story goes only to phones set to "every story". At most PUSH_ALL_PER_DAY (8) a day. One story per pass.
//   Tokens a phone has thrown away (app deleted, alerts turned off in Settings) are removed.
// Apple: APNS_KEY_P8 (the .p8 file's text), APNS_KEY_ID, APNS_TEAM_ID. Google: FCM_SERVICE_ACCOUNT (the JSON file's text).
import path from 'node:path';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { ROOT, log, readJson } from './lib.mjs';

const { APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, FCM_SERVICE_ACCOUNT } = process.env;
const haveApple = !!(APNS_KEY_P8 && APNS_KEY_ID && APNS_TEAM_ID);
let google = null; try { google = FCM_SERVICE_ACCOUNT ? JSON.parse(FCM_SERVICE_ACCOUNT) : null; } catch (e) { log('push: FCM_SERVICE_ACCOUNT is not valid JSON'); }
if (!haveApple && !google) { log('push: no Apple or Google push keys yet, skipping'); process.exit(0); }
const DB = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!DB) { log('push: no database, skipping'); process.exit(0); }
const sql = neon(DB);
const ORIGIN = 'https://squamishvoters.com', TOPIC = 'com.squamishvoters.app';
const BIG_PER_DAY = +(process.env.PUSH_BIG_PER_DAY || 3), ALL_PER_DAY = +(process.env.PUSH_ALL_PER_DAY || 8);
const TEST = process.env.PUSH_TEST_TOKEN || ''; // send one test alert to this token only, record nothing

await sql`CREATE TABLE IF NOT EXISTS sv_push_tokens (token text PRIMARY KEY, platform text NOT NULL, level text NOT NULL DEFAULT 'big',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), fails int NOT NULL DEFAULT 0)`;
await sql`CREATE TABLE IF NOT EXISTS sv_push_sent (slug text PRIMARY KEY, big boolean NOT NULL, phones int NOT NULL DEFAULT 0, ok int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now())`;

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const isBig = (st) => (st.share || 0) >= 4 || st.tier === 'lead';
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ----- Apple -----
function appleJwt() {
  const head = b64({ alg: 'ES256', kid: APNS_KEY_ID }), body = b64({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: APNS_KEY_P8.replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}
async function sendApple(tokens, note) {
  if (!tokens.length) return { ok: 0, gone: [] };
  const client = http2.connect('https://api.push.apple.com');
  client.on('error', (e) => log(`push: Apple connection error: ${e.message}`));
  const jwt = appleJwt(), gone = []; let ok = 0;
  const payload = JSON.stringify({ aps: { alert: { title: note.title, body: note.body }, sound: 'default' }, url: note.url });
  const one = (token) => new Promise((resolve) => {
    const req = client.request({ ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${jwt}`,
      'apns-topic': TOPIC, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': String(Math.floor(Date.now() / 1000) + 6 * 3600),
      'apns-collapse-id': note.slug.slice(0, 60), 'content-type': 'application/json' });
    let status = 0, data = '';
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (d) => { data += d; });
    req.on('end', () => { if (status === 200) ok++; else if (status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(data)) gone.push(token); else log(`push: Apple said ${status} ${data.slice(0, 120)}`); resolve(); });
    req.on('error', () => resolve());
    req.setTimeout(15000, () => { req.close(); resolve(); });
    req.end(payload);
  });
  for (let i = 0; i < tokens.length; i += 50) await Promise.all(tokens.slice(i, i + 50).map(one));
  await new Promise((r) => client.close(r));
  return { ok, gone };
}

// ----- Google -----
async function googleToken() {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: google.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 })}`;
  const jwt = `${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), google.private_key).toString('base64url')}`;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const j = await r.json(); if (!j.access_token) throw new Error(j.error_description || 'no Google access token'); return j.access_token;
}
async function sendGoogle(tokens, note) {
  if (!tokens.length) return { ok: 0, gone: [] };
  const access = await googleToken(), gone = []; let ok = 0;
  const one = async (token) => {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${google.project_id}/messages:send`, { method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: note.title, body: note.body }, data: { url: note.url }, android: { collapse_key: note.slug.slice(0, 60), ttl: '21600s' } } }) }).catch(() => null);
    if (r && r.ok) ok++; else if (r && (r.status === 404 || r.status === 400)) gone.push(token); else log(`push: Google said ${r ? r.status : 'no answer'}`);
  };
  for (let i = 0; i < tokens.length; i += 50) await Promise.all(tokens.slice(i, i + 50).map(one));
  return { ok, gone };
}

const note = (st) => ({ slug: st.slug, title: plain(st.head).slice(0, 110), body: plain(st.dek || st.take).slice(0, 170), url: `${ORIGIN}/news/${st.slug}/` });
const news = readJson(path.join(ROOT, 'data', 'news.json'));

if (TEST) {
  const st = news.stories[0], n = note(st);
  const r = /^[a-f0-9]{64,200}$/i.test(TEST) ? await sendApple([TEST], n) : await sendGoogle([TEST], n);
  log(`push: test alert "${n.title}" sent: ${r.ok ? 'delivered to Apple or Google' : 'not accepted'}`); process.exit(0);
}

const day = (offset) => new Date(Date.now() - offset * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
const sent = await sql`SELECT slug, big, created_at FROM sv_push_sent`;
const done = new Set(sent.map((r) => r.slug));
const last24 = sent.filter((r) => Date.now() - new Date(r.created_at) < 864e5);
const bigToday = last24.filter((r) => r.big).length, allToday = last24.length;

// The first time this runs there may be a backlog of recent stories nobody was alerted about. Mark them as done so
// the first people to turn alerts on don't get a burst of old news.
if (!sent.length) {
  for (const st of news.stories.filter((x) => x.date >= day(1))) await sql`INSERT INTO sv_push_sent (slug, big) VALUES (${st.slug}, ${isBig(st)}) ON CONFLICT DO NOTHING`;
  log('push: first run, marked the current stories as already seen'); process.exit(0);
}

const fresh = news.stories.filter((st) => st.date >= day(1) && !done.has(st.slug));
const next = fresh.filter((st) => (isBig(st) ? bigToday < BIG_PER_DAY : allToday < ALL_PER_DAY))
  .sort((a, b) => Number(isBig(b)) - Number(isBig(a)) || (b.share || 0) - (a.share || 0))[0];
if (!next) { log('push: nothing new to alert'); process.exit(0); }
const n = note(next);
const live = await fetch(n.url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
if (!live) { log(`push: ${next.slug} isn't live yet, next pass`); process.exit(0); }

const big = isBig(next);
const phones = big ? await sql`SELECT token, platform FROM sv_push_tokens WHERE level IN ('big', 'all')` : await sql`SELECT token, platform FROM sv_push_tokens WHERE level = 'all'`;
const ios = phones.filter((p) => p.platform === 'ios').map((p) => p.token), android = phones.filter((p) => p.platform === 'android').map((p) => p.token);
let ok = 0; const gone = [];
if (haveApple) { const r = await sendApple(ios, n).catch((e) => (log(`push: Apple failed: ${e.message}`), { ok: 0, gone: [] })); ok += r.ok; gone.push(...r.gone); }
if (google) { const r = await sendGoogle(android, n).catch((e) => (log(`push: Google failed: ${e.message}`), { ok: 0, gone: [] })); ok += r.ok; gone.push(...r.gone); }
for (const t of gone) await sql`DELETE FROM sv_push_tokens WHERE token = ${t}`;
await sql`INSERT INTO sv_push_sent (slug, big, phones, ok) VALUES (${next.slug}, ${big}, ${phones.length}, ${ok}) ON CONFLICT DO NOTHING`;
log(`push: ${big ? 'big' : 'regular'} alert for ${next.slug}: ${ok} of ${phones.length} phones${gone.length ? `, ${gone.length} old phones removed` : ''}`);
