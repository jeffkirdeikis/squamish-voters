// Reading stats collector for src/pulse.js. POST only, body is JSON sent as text (sendBeacon).
//   { t:'view',  sid, pv, path, ref, utm, app, dev, n, ret, title, secs_all }   one row per page opened
//   { t:'leave', sid, pv, secs, scroll, sec, secname }                            keeps the highest numbers seen for that page
//   { t:'ev',    sid, pv, path, name, data, secs }                                a tap (link, share, sign-up)
// Nothing here identifies a person: no cookies, no IP address stored, only the town Vercel guesses from the connection.
import { neon } from '@neondatabase/serverless';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
let ready = null;
export const initPulse = () => (ready ||= sql`CREATE TABLE IF NOT EXISTS sv_pv (
  pv text PRIMARY KEY, sid text NOT NULL, at timestamptz NOT NULL DEFAULT now(), path text NOT NULL, title text, ref text, utm text, app text, dev text,
  n int NOT NULL DEFAULT 1, ret boolean NOT NULL DEFAULT false, country text, city text,
  secs int NOT NULL DEFAULT 0, scroll int NOT NULL DEFAULT 0, sec int NOT NULL DEFAULT -1, secname text, secs_all jsonb)`
  .then(() => sql`CREATE INDEX IF NOT EXISTS sv_pv_at ON sv_pv (at)`)
  .then(() => sql`CREATE INDEX IF NOT EXISTS sv_pv_sid ON sv_pv (sid)`)
  .then(() => sql`CREATE TABLE IF NOT EXISTS sv_ev (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), sid text NOT NULL, pv text, path text, name text NOT NULL, data jsonb, secs int)`)
  .then(() => sql`CREATE INDEX IF NOT EXISTS sv_ev_at ON sv_ev (at)`)
  .then(() => sql`ALTER TABLE sv_pv ADD COLUMN IF NOT EXISTS ab text`)
  .catch((e) => { ready = null; throw e; }));
export { sql };

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|monitor|curl|wget|python|node-fetch|axios|scrapy|GPT|Claude|perplexity/i;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const int = (v, lo, hi) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo; };
const ID = /^[a-z0-9]{8,20}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' || !sql) return res.status(204).end();
  if (BOT.test(req.headers['user-agent'] || '') && !/SVTest/.test(req.headers['user-agent'] || '')) return res.status(204).end();
  let b = req.body;
  try { if (typeof b === 'string') b = JSON.parse(b); else if (Buffer.isBuffer(b)) b = JSON.parse(b.toString('utf8')); } catch (e) { return res.status(204).end(); }
  if (!b || !ID.test(b.sid || '') || !ID.test(b.pv || '')) return res.status(204).end();
  const path = str(b.path, 160) || '/';
  try {
    await initPulse();
    if (b.t === 'view') {
      const dec = (v) => { try { return decodeURIComponent(v || ''); } catch (e) { return v || ''; } };
      const country = str(req.headers['x-vercel-ip-country'], 4), city = str(dec(req.headers['x-vercel-ip-city']), 60);
      const heads = Array.isArray(b.secs_all) ? b.secs_all.slice(0, 40).map((x) => str(x, 60)) : [];
      await sql`INSERT INTO sv_pv (pv, sid, path, title, ref, utm, app, dev, n, ret, country, city, secs_all, ab)
        VALUES (${b.pv}, ${b.sid}, ${path}, ${str(b.title, 90)}, ${str(b.ref, 80)}, ${str(b.utm, 40)}, ${str(b.app, 20)}, ${str(b.dev, 10)},
          ${int(b.n, 1, 500)}, ${!!b.ret}, ${country}, ${city}, ${JSON.stringify(heads)}::jsonb, ${/^[a-z0-9]{1,12}:[AB]$/.test(b.ab || '') ? b.ab : null})
        ON CONFLICT (pv) DO NOTHING`;
    } else if (b.t === 'leave') {
      const secs = int(b.secs, 0, 7200), scroll = int(b.scroll, 0, 100), sec = int(b.sec, -1, 60);
      await sql`UPDATE sv_pv SET secs = GREATEST(secs, ${secs}), scroll = GREATEST(scroll, ${scroll}),
        secname = CASE WHEN ${sec} > sec THEN ${str(b.secname, 60)} ELSE secname END, sec = GREATEST(sec, ${sec}) WHERE pv = ${b.pv} AND sid = ${b.sid}`;
    } else if (b.t === 'ev') {
      const name = str(b.name, 40); if (!name) return res.status(204).end();
      const data = {}; if (b.data && typeof b.data === 'object') for (const k of Object.keys(b.data).slice(0, 6)) data[str(k, 20)] = str(String(b.data[k]), 120);
      await sql`INSERT INTO sv_ev (sid, pv, path, name, data, secs) VALUES (${b.sid}, ${b.pv}, ${path}, ${name}, ${JSON.stringify(data)}::jsonb, ${int(b.secs, 0, 7200)})`;
    }
  } catch (e) { console.error('pulse', e.message); }
  return res.status(204).end();
}
