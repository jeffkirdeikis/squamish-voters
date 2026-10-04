// The Ask chat's limits and log, on Neon Postgres (DATABASE_URL, from the Neon store connected to this project).
// Moved off Vercel Blob: the Hobby plan allows about 2,000 Blob writes a month, and one write per answer (plus the
// admin page listing every 20 seconds) would get the store suspended, taking the candidate questionnaire down with it.
import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';

const URL = process.env.DATABASE_URL;
const sql = URL ? neon(URL) : null;
let ready = null;
const init = () => (ready ||= Promise.all([
  sql`CREATE TABLE IF NOT EXISTS sv_chat_log (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), day date NOT NULL,
      visitor text, turn int, q text, a text, bad jsonb, stop text, model text, usage jsonb, cost double precision NOT NULL DEFAULT 0)`,
  sql`CREATE TABLE IF NOT EXISTS sv_chat_quota (day date NOT NULL, visitor text NOT NULL, n int NOT NULL DEFAULT 0, PRIMARY KEY (day, visitor))`,
]).then(() => sql`CREATE INDEX IF NOT EXISTS sv_chat_log_day ON sv_chat_log (day)`).catch((e) => { ready = null; throw e; }));

export const available = () => !!sql;
export const pacificDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });

// The IP address is never stored: only a hash that changes every day, so visits can't be linked across days.
export const visitorId = (ip, day) => createHash('sha256').update(`${day}|${ip}|${process.env.CHAT_SALT || 'squamish-voters'}`).digest('hex').slice(0, 24);

// Counts this question against the visitor's daily allowance and returns the new count and today's spend so far.
export async function takeQuestion(visitor, day) {
  await init();
  const [quota, spend] = await Promise.all([
    sql`INSERT INTO sv_chat_quota (day, visitor, n) VALUES (${day}, ${visitor}, 1)
        ON CONFLICT (day, visitor) DO UPDATE SET n = sv_chat_quota.n + 1 RETURNING n`,
    sql`SELECT coalesce(sum(cost), 0)::float AS spent FROM sv_chat_log WHERE day = ${day}`,
  ]);
  return { count: quota[0].n, spent: spend[0].spent };
}

// A question that was turned away (or failed before answering) shouldn't use up the visitor's allowance.
export async function giveBack(visitor, day) {
  await init();
  await sql`UPDATE sv_chat_quota SET n = greatest(n - 1, 0) WHERE day = ${day} AND visitor = ${visitor}`;
}

export async function logAnswer(e) {
  await init();
  await sql`INSERT INTO sv_chat_log (at, day, visitor, turn, q, a, bad, stop, model, usage, cost)
            VALUES (${e.at}, ${e.day}, ${e.visitor}, ${e.turn}, ${e.q}, ${e.a}, ${JSON.stringify(e.bad || [])}, ${e.stop}, ${e.model}, ${JSON.stringify(e.usage || {})}, ${e.cost})`;
}

// For the keep-warm ping: when the cache was last used (any call) and when someone last asked a real question.
export async function lastUse() {
  await init();
  const r = await sql`SELECT max(at) AS any, max(at) FILTER (WHERE turn > 0) AS question FROM sv_chat_log`;
  return { any: r[0].any ? new Date(r[0].any) : null, question: r[0].question ? new Date(r[0].question) : null };
}

// For the admin page: totals, the last 14 days, and optionally the latest answers.
export async function usage(recent = 0) {
  await init();
  const [tot, days, rows] = await Promise.all([
    sql`SELECT (count(*) FILTER (WHERE turn > 0))::int AS questions, coalesce(sum(cost), 0)::float AS total,
               (count(*) FILTER (WHERE turn = 0))::int AS warmups, coalesce(sum(cost) FILTER (WHERE turn = 0), 0)::float AS warmup_cost FROM sv_chat_log`,
    sql`SELECT to_char(day, 'YYYY-MM-DD') AS day, (count(*) FILTER (WHERE turn > 0))::int AS questions, sum(cost)::float AS cost,
               (count(*) FILTER (WHERE turn = 0))::int AS warmups FROM sv_chat_log GROUP BY day ORDER BY day DESC LIMIT 14`,
    recent ? sql`SELECT at, turn, q, a, bad, stop, model, usage, cost FROM sv_chat_log WHERE turn > 0 ORDER BY at DESC LIMIT ${recent}` : [],
  ]);
  return { ...tot[0], days, recent: rows };
}

// One-time copy of the answers logged to Blob before the move (skips any already copied).
export async function importOld(entries) {
  await init();
  let n = 0;
  for (const e of entries) {
    const at = e.at || new Date().toISOString();
    const dup = await sql`SELECT 1 FROM sv_chat_log WHERE at = ${at} AND q = ${e.q || ''} LIMIT 1`;
    if (dup.length) continue;
    await logAnswer({ ...e, at, q: e.q || '', day: pacificDay(new Date(at)), visitor: null, cost: e.cost || 0 });
    n++;
  }
  return n;
}
