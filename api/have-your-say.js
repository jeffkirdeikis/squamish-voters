// Have your say: residents vote on the same questions council will decide, and can leave a public comment.
// The questions come from the agenda pipeline (scripts/pipeline/sync.mjs writes "ask" on agenda items) and are published
// by build.mjs (api/_questions.json, also served at /have-your-say/questions.json) with the time each one closes (the meeting's start).
//   GET  ?voter=<id>                                       -> { ok, tallies, mine: { qid: { choice, factors, comment, comment_status, comment_note } }, comments: { qid: [...] } }
//   POST { qid, choice, voter, area, factors?, comment? }  -> { ok, tally, mine, comments }
//   POST { report: <cid>, qid, voter }                     -> { ok }  (three reports from different people hide a comment)
//   GET  ?admin=1, POST { admin: 'hide' | 'show', qid, cid }, both with Authorization: Bearer <ADMIN_TOKEN> (the /subscribers/ page)
// One vote per browser per question (the voter id lives in the browser), changeable until the meeting starts.
// A cap per network stops one person stuffing a question from many browsers.
// Comments are public without names. Each is checked by Claude against the rules below before it shows; if that check
// can't run, the comment waits and scripts/pipeline/hy-themes.mjs checks it within ten minutes.
import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import QUESTIONS from './_questions.json' with { type: 'json' };

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
// Simple questions: yes, no, not sure. Detailed ones (big decisions with trade-offs) add two in-between answers.
const CHOICES = ['yes', 'no', 'unsure'];
const CHOICES_DETAILED = ['yes', 'yes_changes', 'no_changes', 'no', 'unsure'];
const PER_NETWORK = 8; // different browsers on one internet connection that can vote on one question (a busy household)
const AREA_MIN = 20; // a neighbourhood's split is shown only once this many people from it have voted
const REPORTS_TO_HIDE = 3;

export const COMMENT_RULES = `Publish the comment unless it breaks one of these rules:
- No insults, name-calling or personal attacks on anyone, including council members, staff, applicants or other residents. Criticizing a decision, a plan, a vote or someone's public record is fine, even sharply.
- No hate, slurs, threats, harassment or sexual content.
- No names, addresses or other personal details of private people.
- No spam, ads or links.
- It has to be about the question or the decision behind it. Short comments are fine. Strong opinions on any side are fine, and so is mild swearing that isn't aimed at a person.
When in doubt about tone, publish: the point is to hear from residents. If it breaks a rule, "reason" is one short, friendly sentence telling the writer what to change.`;

let ready = null;
const init = () => (ready ||= sql`CREATE TABLE IF NOT EXISTS sv_votes (
  qid text NOT NULL, voter text NOT NULL, choice text NOT NULL, area text, net text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (qid, voter))`
  .then(() => sql`ALTER TABLE sv_votes ADD COLUMN IF NOT EXISTS factors jsonb, ADD COLUMN IF NOT EXISTS comment text,
    ADD COLUMN IF NOT EXISTS comment_status text, ADD COLUMN IF NOT EXISTS comment_note text, ADD COLUMN IF NOT EXISTS comment_at timestamptz, ADD COLUMN IF NOT EXISTS reports int NOT NULL DEFAULT 0`)
  .then(() => sql`CREATE TABLE IF NOT EXISTS sv_vote_reports (qid text NOT NULL, cid text NOT NULL, voter text NOT NULL, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (qid, cid, voter))`)
  .catch((e) => { ready = null; throw e; }));

// Written by build.mjs on every deploy, so the function always knows exactly which questions that deploy shows.
const questions = () => QUESTIONS.questions || [];

const hash = (s) => createHash('sha256').update(`${s}|sv-have-your-say`).digest('hex').slice(0, 24);
const cidOf = (qid, voterHash) => hash(`c|${qid}|${voterHash}`).slice(0, 12); // public id of a comment, not linkable to the voter
const voterOk = (v) => /^[a-zA-Z0-9-]{16,64}$/.test(String(v || ''));
const isAdmin = (req) => process.env.ADMIN_TOKEN && (req.headers.authorization || '').replace(/^Bearer /, '') === process.env.ADMIN_TOKEN;

const blank = () => ({ yes: 0, yes_changes: 0, no_changes: 0, no: 0, unsure: 0, total: 0 });
async function tallies(ids) {
  if (!ids.length) return {};
  const rows = await sql`SELECT qid, choice, area, count(*)::int AS n FROM sv_votes WHERE qid = ANY(${ids}) GROUP BY qid, choice, area`;
  const out = {};
  for (const r of rows) {
    const t = (out[r.qid] ||= { ...blank(), areas: {}, factors: {} });
    t[r.choice] += r.n; t.total += r.n;
    if (r.area) { const a = (t.areas[r.area] ||= blank()); a[r.choice] += r.n; a.total += r.n; }
  }
  for (const t of Object.values(out)) for (const [k, a] of Object.entries(t.areas)) if (a.total < AREA_MIN) delete t.areas[k];
  const fr = await sql`SELECT qid, f, count(*)::int AS n FROM sv_votes, jsonb_array_elements_text(coalesce(factors, '[]'::jsonb)) AS f WHERE qid = ANY(${ids}) GROUP BY qid, f`;
  for (const r of fr) if (out[r.qid]) out[r.qid].factors[r.f] = r.n;
  return out;
}
async function publicComments(ids) {
  if (!ids.length) return {};
  const rows = await sql`SELECT qid, voter, choice, comment, comment_at FROM sv_votes WHERE qid = ANY(${ids}) AND comment_status = 'ok' AND comment <> '' ORDER BY comment_at DESC LIMIT 2000`;
  const out = {};
  for (const r of rows) (out[r.qid] ||= []).push({ cid: cidOf(r.qid, r.voter), choice: r.choice, text: r.comment, at: r.comment_at });
  for (const k of Object.keys(out)) out[k] = out[k].slice(0, 300);
  return out;
}

// Claude checks a comment against COMMENT_RULES. Returns { status: 'ok' | 'hidden' | 'pending', note }.
async function moderate(q, text) {
  if (!process.env.ANTHROPIC_API_KEY) return { status: 'pending', note: '' };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-5-5', max_tokens: 300,
        output_config: { format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['publish', 'reason'], properties: { publish: { type: 'boolean' }, reason: { type: 'string' } } } } },
        system: `You check public comments on Squamish Voters, a non-partisan site where residents of Squamish, B.C. vote on questions their council is about to decide.\n${COMMENT_RULES}`,
        messages: [{ role: 'user', content: `QUESTION: ${q.ask}\n\nCOMMENT:\n${text}` }],
      }),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const out = JSON.parse(j.content.filter((x) => x.type === 'text').map((x) => x.text).join(''));
    return out.publish ? { status: 'ok', note: '' } : { status: 'hidden', note: String(out.reason || '').slice(0, 300) };
  } catch (e) {
    console.error('comment check', e.message);
    return { status: 'pending', note: '' };
  }
}

const mineRow = (r) => ({ choice: r.choice, factors: r.factors || [], comment: r.comment || '', comment_status: r.comment ? r.comment_status || 'pending' : '', comment_note: r.comment_note || '', cid: cidOf(r.qid, r.voter) });

export default async function handler(req, res) {
  if (!sql) return res.status(503).json({ ok: false, error: 'Voting is not open yet.' });
  await init();
  res.setHeader('Cache-Control', 'no-store');
  const qs = questions(), ids = qs.map((q) => q.id);
  const b = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) : {};

  // Admin: every comment with its status, and hide or show one.
  if (req.query.admin || b.admin) {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (req.method === 'GET') {
      const rows = await sql`SELECT qid, voter, choice, comment, comment_status, comment_note, comment_at, reports FROM sv_votes WHERE comment IS NOT NULL AND comment <> '' ORDER BY comment_at DESC NULLS LAST LIMIT 1000`;
      const ask = Object.fromEntries(qs.map((q) => [q.id, q.ask]));
      return res.json({ ok: true, comments: rows.map((r) => ({ qid: r.qid, ask: ask[r.qid] || r.qid, cid: cidOf(r.qid, r.voter), choice: r.choice, text: r.comment, status: r.comment_status || 'pending', note: r.comment_note || '', at: r.comment_at, reports: r.reports })) });
    }
    const [row] = (await sql`SELECT qid, voter FROM sv_votes WHERE qid = ${String(b.qid || '')}`).filter((r) => cidOf(r.qid, r.voter) === b.cid);
    if (!row) return res.status(404).json({ ok: false });
    await sql`UPDATE sv_votes SET comment_status = ${b.admin === 'show' ? 'ok' : 'removed'}, comment_note = ${b.admin === 'show' ? '' : 'Removed by Squamish Voters.'} WHERE qid = ${row.qid} AND voter = ${row.voter}`;
    return res.json({ ok: true });
  }

  if (req.method === 'GET') {
    const voter = voterOk(req.query.voter) ? hash(req.query.voter) : null;
    const mine = voter && ids.length ? Object.fromEntries((await sql`SELECT qid, voter, choice, factors, comment, comment_status, comment_note FROM sv_votes WHERE voter = ${voter} AND qid = ANY(${ids})`).map((r) => [r.qid, mineRow(r)])) : {};
    return res.json({ ok: true, tallies: await tallies(ids), mine, comments: await publicComments(ids) });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const q = qs.find((x) => x.id === b.qid);
  if (!q) return res.status(404).json({ ok: false, error: 'That question isn’t open.' });
  if (!voterOk(b.voter)) return res.status(400).json({ ok: false, error: 'Please reload the page and try again.' });
  const voter = hash(b.voter);

  // Report a comment. Works after voting closes too.
  if (b.report) {
    const [row] = (await sql`SELECT qid, voter FROM sv_votes WHERE qid = ${q.id} AND comment_status = 'ok'`).filter((r) => cidOf(r.qid, r.voter) === b.report);
    if (!row || row.voter === voter) return res.json({ ok: true });
    await sql`INSERT INTO sv_vote_reports (qid, cid, voter) VALUES (${q.id}, ${String(b.report)}, ${voter}) ON CONFLICT DO NOTHING`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_vote_reports WHERE qid = ${q.id} AND cid = ${String(b.report)}`;
    await sql`UPDATE sv_votes SET reports = ${n}, comment_status = CASE WHEN ${n} >= ${REPORTS_TO_HIDE} THEN 'reported' ELSE comment_status END WHERE qid = ${row.qid} AND voter = ${row.voter}`;
    return res.json({ ok: true });
  }

  if (Date.now() >= Date.parse(q.close)) return res.status(409).json({ ok: false, error: 'Voting on this closed when the meeting started.' });
  if (!(q.depth === 'detailed' ? CHOICES_DETAILED : CHOICES).includes(b.choice)) return res.status(400).json({ ok: false, error: 'Please pick one of the answers.' });
  // Optional: what matters most (detailed questions, from the question's own list) and a public comment.
  // Left out of a request means "keep what they told us before".
  const factors = Array.isArray(b.factors) ? JSON.stringify(b.factors.map(String).filter((f) => (q.factors || []).includes(f)).slice(0, 6)) : null;
  const comment = typeof b.comment === 'string' ? b.comment.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, 600) : null;
  const area = /^[a-z0-9-]{2,40}$/.test(String(b.area || '')) ? String(b.area) : null;
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
  const net = hash(`net|${ip}`);

  const [before] = await sql`SELECT comment FROM sv_votes WHERE qid = ${q.id} AND voter = ${voter}`;
  if (!before) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_votes WHERE qid = ${q.id} AND net = ${net}`;
    if (n >= PER_NETWORK) return res.status(429).json({ ok: false, error: 'Lots of votes on this question have come from your internet connection already, so we can’t count another one from it.' });
  }
  // A new or changed comment is checked again and its reports start over; an unchanged one keeps its status.
  let mod = null;
  if (comment !== null && comment !== (before?.comment || '')) mod = comment ? await moderate(q, comment) : { status: '', note: '' };
  const m = !!mod;
  await sql`INSERT INTO sv_votes (qid, voter, choice, area, net, factors, comment, comment_status, comment_note, comment_at)
    VALUES (${q.id}, ${voter}, ${b.choice}, ${area}, ${net}, ${factors}::jsonb, ${comment}, ${mod?.status ?? null}, ${mod?.note ?? null}, ${m ? new Date().toISOString() : null})
    ON CONFLICT (qid, voter) DO UPDATE SET choice = EXCLUDED.choice, area = coalesce(EXCLUDED.area, sv_votes.area), updated_at = now(),
      factors = coalesce(EXCLUDED.factors, sv_votes.factors), comment = coalesce(EXCLUDED.comment, sv_votes.comment),
      comment_status = CASE WHEN ${m} THEN EXCLUDED.comment_status ELSE sv_votes.comment_status END,
      comment_note = CASE WHEN ${m} THEN EXCLUDED.comment_note ELSE sv_votes.comment_note END,
      comment_at = CASE WHEN ${m} THEN EXCLUDED.comment_at ELSE sv_votes.comment_at END,
      reports = CASE WHEN ${m} THEN 0 ELSE sv_votes.reports END`;
  if (m) await sql`DELETE FROM sv_vote_reports WHERE qid = ${q.id} AND cid = ${cidOf(q.id, voter)}`;
  const [me] = await sql`SELECT qid, voter, choice, factors, comment, comment_status, comment_note FROM sv_votes WHERE qid = ${q.id} AND voter = ${voter}`;
  const t = await tallies([q.id]), c = await publicComments([q.id]);
  return res.json({ ok: true, tally: t[q.id] || { ...blank(), areas: {}, factors: {} }, mine: mineRow(me), comments: c[q.id] || [] });
}
