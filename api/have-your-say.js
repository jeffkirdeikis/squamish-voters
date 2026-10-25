// Have your say: residents vote yes, no or not sure on the same questions council will decide.
// The questions come from the agenda pipeline (scripts/pipeline/sync.mjs writes "ask" on agenda items) and are published
// by build.mjs (api/_questions.json, also served at /have-your-say/questions.json) with the time each one closes (the meeting's start).
//   GET  ?voter=<id>                         -> { ok, tallies: { qid: { yes, no, unsure, total, areas } }, mine: { qid: choice } }
//   POST { qid, choice, voter, area }        -> { ok, tally, mine }
// One vote per browser per question (the voter id lives in the browser), changeable until the meeting starts.
// A cap per network stops one person stuffing a question from many browsers. Totals only; no one's vote is ever shown.
import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import QUESTIONS from './_questions.json' with { type: 'json' };

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
const CHOICES = ['yes', 'no', 'unsure'];
const PER_NETWORK = 8; // different browsers on one internet connection that can vote on one question (a busy household)
const AREA_MIN = 20; // a neighbourhood's split is shown only once this many people from it have voted

let ready = null;
const init = () => (ready ||= sql`CREATE TABLE IF NOT EXISTS sv_votes (
  qid text NOT NULL, voter text NOT NULL, choice text NOT NULL, area text, net text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (qid, voter))`.catch((e) => { ready = null; throw e; }));

// Written by build.mjs on every deploy, so the function always knows exactly which questions that deploy shows.
const questions = () => QUESTIONS.questions || [];

const hash = (s) => createHash('sha256').update(`${s}|sv-have-your-say`).digest('hex').slice(0, 24);
const voterOk = (v) => /^[a-zA-Z0-9-]{16,64}$/.test(String(v || ''));

async function tallies(ids) {
  if (!ids.length) return {};
  const rows = await sql`SELECT qid, choice, area, count(*)::int AS n FROM sv_votes WHERE qid = ANY(${ids}) GROUP BY qid, choice, area`;
  const out = {};
  for (const r of rows) {
    const t = (out[r.qid] ||= { yes: 0, no: 0, unsure: 0, total: 0, areas: {} });
    t[r.choice] += r.n; t.total += r.n;
    if (r.area) { const a = (t.areas[r.area] ||= { yes: 0, no: 0, unsure: 0, total: 0 }); a[r.choice] += r.n; a.total += r.n; }
  }
  for (const t of Object.values(out)) for (const [k, a] of Object.entries(t.areas)) if (a.total < AREA_MIN) delete t.areas[k];
  return out;
}

export default async function handler(req, res) {
  if (!sql) return res.status(503).json({ ok: false, error: 'Voting is not open yet.' });
  await init();
  res.setHeader('Cache-Control', 'no-store');
  const qs = questions();

  if (req.method === 'GET') {
    const ids = qs.map((q) => q.id);
    const voter = voterOk(req.query.voter) ? hash(req.query.voter) : null;
    const mine = voter && ids.length ? Object.fromEntries((await sql`SELECT qid, choice FROM sv_votes WHERE voter = ${voter} AND qid = ANY(${ids})`).map((r) => [r.qid, r.choice])) : {};
    return res.json({ ok: true, tallies: await tallies(ids), mine });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const q = qs.find((x) => x.id === b.qid);
  if (!q) return res.status(404).json({ ok: false, error: 'That question isn’t open.' });
  if (Date.now() >= Date.parse(q.close)) return res.status(409).json({ ok: false, error: 'Voting on this closed when the meeting started.' });
  if (!CHOICES.includes(b.choice)) return res.status(400).json({ ok: false, error: 'Pick yes, no or not sure.' });
  if (!voterOk(b.voter)) return res.status(400).json({ ok: false, error: 'Please reload the page and try again.' });
  const voter = hash(b.voter);
  const area = /^[a-z0-9-]{2,40}$/.test(String(b.area || '')) ? String(b.area) : null;
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const net = hash(`net|${ip}`);

  const [already] = await sql`SELECT 1 FROM sv_votes WHERE qid = ${q.id} AND voter = ${voter}`;
  if (!already) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_votes WHERE qid = ${q.id} AND net = ${net}`;
    if (n >= PER_NETWORK) return res.status(429).json({ ok: false, error: 'Lots of votes on this question have come from your internet connection already, so we can’t count another one from it.' });
  }
  await sql`INSERT INTO sv_votes (qid, voter, choice, area, net) VALUES (${q.id}, ${voter}, ${b.choice}, ${area}, ${net})
    ON CONFLICT (qid, voter) DO UPDATE SET choice = EXCLUDED.choice, area = EXCLUDED.area, updated_at = now()`;
  const t = await tallies([q.id]);
  return res.json({ ok: true, tally: t[q.id] || { yes: 0, no: 0, unsure: 0, total: 0, areas: {} }, mine: b.choice });
}
