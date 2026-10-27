// What Squamish Wants (/wants/): residents answer yes, no or don't mind on specific asks, and can add their own.
// Starter asks come from data/wants.json (bundled here as _wants.json by build.mjs). Residents' asks live in sv_wants.
//   GET  ?voter=<id>                                   -> { ok, people, asks: [resident asks], tallies, mine: { wid: 'y'|'n'|'m' }, notes: { wid: [...] } }
//   POST { action: 'vote', wid, choice, voter, area }  -> { ok, tally, choice }   (choice '' takes the answer back)
//   POST { action: 'check', text, voter }              -> { ok, publish, reason, draft, similar: [{ id, title, how }], sig }
//        Claude checks the rules, writes a short neutral ask and lists asks already on the list that mean the same thing.
//   POST { action: 'post', text, draft, area, sig, voter }   -> { ok, ask }   (sig proves the draft came from 'check')
//   POST { action: 'add-words', wid, text, sig, voter }      -> { ok }        (adds the writer's words to an existing ask)
//   POST { action: 'report', wid, voter }              -> { ok }   (three reports from different people hide a resident's ask)
//   POST { action: 'add-option', wid, text, voter }    -> { ok, option, tally } | { ok, same: key } | { ok, rejected: reason }
//        On any ask, a resident can add an answer that's missing ("Other"). Claude checks the rules, writes a short
//        label and says if it means the same as an answer already there. The writer's answer moves to the new option.
//   POST { action: 'report', wid, okey, voter }        -> { ok }   (three reports hide a resident's answer)
//   GET  ?admin=1, POST { admin: 'hide' | 'show', wid [, nid | okey] }, both with Authorization: Bearer <ADMIN_TOKEN>
//   POST { admin: 'merge', wid, from, into, label? }  moves every vote from one added answer to another (and can rename it)
import { neon } from '@neondatabase/serverless';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import SEED from './_wants.json' with { type: 'json' };
import { COMMENT_RULES } from './have-your-say.js';

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;
const CHOICES = ['y', 'n', 'm'];
const PER_NETWORK = 8; // different browsers on one internet connection that can answer one ask (a busy household)
const AREA_MIN = 5; // a neighbourhood's answers show once this many people from it have answered (below that one answer could be worked out)
const REPORTS_TO_HIDE = 3;
const POSTS_PER_DAY = 5; // new asks from one internet connection in 24 hours
const CHECKS_PER_HOUR = 20; // suggestion checks from one internet connection in an hour (each one is a Claude call)
const OPTIONS_PER_DAY = 5; // answers added by one internet connection in 24 hours
const MAX_OPTIONS = 12; // answers on one question, starter ones included

let ready = null;
const init = () => (ready ||= sql`CREATE TABLE IF NOT EXISTS sv_wants (
  id text PRIMARY KEY, title text NOT NULL, why text, topic text, area text, body text, status text NOT NULL DEFAULT 'ok',
  voter text, net text, reports int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())`
  .then(() => sql`CREATE TABLE IF NOT EXISTS sv_want_votes (wid text NOT NULL, voter text NOT NULL, choice text NOT NULL, area text, net text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (wid, voter))`)
  .then(() => sql`CREATE TABLE IF NOT EXISTS sv_want_notes (wid text NOT NULL, voter text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'ok',
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (wid, voter))`)
  .then(() => sql`CREATE TABLE IF NOT EXISTS sv_want_reports (wid text NOT NULL, voter text NOT NULL, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (wid, voter))`)
  .then(() => sql`CREATE TABLE IF NOT EXISTS sv_want_checks (net text NOT NULL, at timestamptz NOT NULL DEFAULT now())`)
  .then(() => sql`CREATE TABLE IF NOT EXISTS sv_want_options (wid text NOT NULL, key text NOT NULL, label text NOT NULL, means text, body text,
    status text NOT NULL DEFAULT 'ok', voter text, net text, reports int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (wid, key))`)
  .catch((e) => { ready = null; throw e; }));

const SEEDS = SEED.asks || [];
const TOPICS = (SEED.topics || []).map((t) => t.key);
const HOODS = SEED.hoods || [];
const hash = (s) => createHash('sha256').update(`${s}|sv-wants`).digest('hex').slice(0, 24);
const voterOk = (v) => /^[a-zA-Z0-9-]{16,64}$/.test(String(v || ''));
const isAdmin = (req) => process.env.ADMIN_TOKEN && (req.headers.authorization || '').replace(/^Bearer /, '') === process.env.ADMIN_TOKEN;
const clean = (s, max) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/\s+\n/g, '\n').trim().slice(0, max);
const sign = (o) => createHmac('sha256', process.env.ADMIN_TOKEN || 'sv-wants').update(JSON.stringify(o)).digest('hex').slice(0, 32);
const netOf = (req) => hash(`net|${String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || ''}`);
const areaOk = (a) => (HOODS.includes(String(a || '')) ? String(a) : null);

async function residentAsks() {
  return sql`SELECT id, title, why, topic, area, body, created_at FROM sv_wants WHERE status = 'ok' ORDER BY created_at DESC LIMIT 1000`;
}
async function tallies() {
  const rows = await sql`SELECT wid, choice, area, count(*)::int AS n FROM sv_want_votes GROUP BY wid, choice, area`;
  const out = {};
  for (const r of rows) {
    const t = (out[r.wid] ||= { y: 0, n: 0, m: 0, areas: {} });
    t[r.choice] = (t[r.choice] || 0) + r.n; // y / n / m, or an option key on a multiple choice ask
    if (r.area) { const a = (t.areas[r.area] ||= { y: 0, n: 0, m: 0 }); a[r.choice] = (a[r.choice] || 0) + r.n; }
  }
  for (const t of Object.values(out)) for (const [k, a] of Object.entries(t.areas)) if (Object.values(a).reduce((x, y) => x + y, 0) < AREA_MIN) delete t.areas[k];
  return out;
}
async function extraOptions(status = 'ok') {
  const rows = await sql`SELECT wid, key, label, means FROM sv_want_options WHERE status = ${status} ORDER BY created_at LIMIT 2000`;
  const out = {};
  for (const r of rows) (out[r.wid] ||= []).push({ key: r.key, label: r.label, means: r.means || '' });
  return out;
}
async function notes() {
  const rows = await sql`SELECT wid, body, created_at FROM sv_want_notes WHERE status = 'ok' ORDER BY created_at DESC LIMIT 2000`;
  const out = {};
  for (const r of rows) (out[r.wid] ||= []).push({ text: r.body, at: r.created_at });
  return out;
}

// Rough "same words" match, used only when Claude can't be reached.
const STOP = new Set('the a an and or of to in on at for with by from is are be it this that we our should more less make build get put keep add squamish please need needs'.split(' '));
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) || []);
function roughSimilar(text, list) {
  const a = words(text);
  return list.map((x) => { const b = words(`${x.title} ${x.why || ''}`); let n = 0; for (const w of a) if (b.has(w)) n++; return { x, s: n / Math.max(3, Math.min(a.size, b.size)) }; })
    .filter((r) => r.s >= 0.34).sort((p, q) => q.s - p.s).slice(0, 3).map((r) => ({ id: r.x.id, title: r.x.title, how: 'Uses many of the same words.' }));
}

// Claude reads the suggestion: does it fit the rules, what is the short neutral ask, and is it already on the list?
async function check(text, list) {
  const fallback = { publish: true, held: true, reason: '', draft: { title: clean(text.split(/(?<=[.!?])\s/)[0], 120), why: '', topic: 'other', area: null }, similar: roughSimilar(text, list) };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  const listText = list.map((x) => `${x.id}: ${x.title}`).join('\n');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(25000),
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-5-5', max_tokens: 700,
        output_config: { format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false,
          required: ['publish', 'reason', 'title', 'why', 'topic', 'area', 'similar'],
          properties: {
            publish: { type: 'boolean' }, reason: { type: 'string' }, title: { type: 'string' }, why: { type: 'string' },
            topic: { type: 'string', enum: TOPICS }, area: { type: 'string', enum: ['all', ...HOODS] },
            similar: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'how'], properties: { id: { type: 'string' }, how: { type: 'string' } } } },
          } } } },
        system: `You review suggestions for "What Squamish Wants", a public list on Squamish Voters (a non-partisan site about Squamish, B.C.) where residents answer yes, no or don't mind on specific things they want the town to do.

1. publish: should this go on the list? Use these rules:
${COMMENT_RULES.replace('It has to be about the question or the decision behind it.', 'It has to be something the District of Squamish, its council, or the Province could actually do for Squamish.')}
If it breaks a rule, publish is false and "reason" is one short, friendly sentence telling the writer what to change. Otherwise reason is "".

2. title: rewrite it as ONE short, specific, neutral ask that starts with a verb, the way a resident would say it (for example "Fence the off leash dog area at John Hunter Park"). Under 90 characters. Keep the writer's meaning and side; don't soften or strengthen it. Plain words, no jargon, no em dashes, no hyphenated compound words.

3. why: one neutral sentence of background taken only from what the writer said, written as a plain statement of the situation (for example "There are no public washrooms open after 9 pm."). Never start with "The writer says" or similar. No facts they didn't give. "" if there is nothing to add.

4. topic and area: the best topic. area is a neighbourhood ONLY if the writer names that neighbourhood itself (for example "in Brackendale"); a park, street or building name is not enough, because you may not know where it is. Otherwise "all". The writer can change it before posting.

5. similar: asks already on the list below that ask for the same thing or nearly the same thing, so the writer can answer that one instead of adding a copy. Include an ask only if a resident would see the two as essentially the same request (same place and same action, or one clearly covers the other). Opposite asks on the same issue are NOT similar. "how" is a few words on what they share. At most 3, best match first. Use the ids exactly as given. Empty if none.

THE LIST:
${listText}`,
        messages: [{ role: 'user', content: `SUGGESTION:\n${text}` }],
      }),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const o = JSON.parse(j.content.filter((x) => x.type === 'text').map((x) => x.text).join(''));
    const byId = Object.fromEntries(list.map((x) => [x.id, x]));
    return {
      publish: !!o.publish, held: false, reason: clean(o.reason, 300),
      draft: { title: clean(o.title, 120) || fallback.draft.title, why: clean(o.why, 300), topic: TOPICS.includes(o.topic) ? o.topic : 'other', area: areaOk(o.area) },
      similar: (o.similar || []).filter((s) => byId[s.id]).slice(0, 3).map((s) => ({ id: s.id, title: byId[s.id].title, how: clean(s.how, 120) })),
    };
  } catch (e) {
    console.error('wants check', e.message);
    return fallback;
  }
}

// Claude reads a suggested answer: does it fit the rules, what is its short label, and is it already one of the answers?
async function checkOption(text, seed, current) {
  const fallback = { publish: true, held: true, reason: '', label: clean(text, 60), means: '', same: '' };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(25000),
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-5-5', max_tokens: 400,
        output_config: { format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false,
          required: ['publish', 'reason', 'label', 'means', 'same'],
          properties: { publish: { type: 'boolean' }, reason: { type: 'string' }, label: { type: 'string' }, means: { type: 'string' }, same: { type: 'string', enum: ['', ...current.map((o) => o.key)] } } } } },
        system: `You review answers that residents add to a question on "What Squamish Wants", a public list on Squamish Voters (a non-partisan site about Squamish, B.C.).

THE QUESTION: ${seed.title}
${seed.why ? `BACKGROUND: ${seed.why}\n` : ''}THE ANSWERS ALREADY THERE:
${current.map((o) => `${o.key}: ${o.label}`).join('\n')}

1. publish: should this answer be added? Use these rules:
${COMMENT_RULES.replace('It has to be about the question or the decision behind it.', 'It has to be a real answer to the question above, something the town or the Province could actually do.')}
If it breaks a rule, publish is false and "reason" is one short, friendly sentence telling the writer what to change. Otherwise reason is "".

2. same: if it means the same as one of the answers already there (or is clearly covered by it), that answer's key. Otherwise "". A real difference in what would happen counts as different.

3. label: the answer as a short button label in the same style as the others, under 45 characters. Keep the writer's meaning and side. Plain words, no em dashes, no hyphenated compound words.

4. means: one neutral sentence on what would happen if this answer won, using only what the writer said and the background. "" if unsure.`,
        messages: [{ role: 'user', content: `SUGGESTED ANSWER:\n${text}` }],
      }),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const o = JSON.parse(j.content.filter((x) => x.type === 'text').map((x) => x.text).join(''));
    return { publish: !!o.publish, held: false, reason: clean(o.reason, 300), label: clean(o.label, 60) || fallback.label, means: clean(o.means, 300), same: current.some((c) => c.key === o.same) ? o.same : '' };
  } catch (e) {
    console.error('wants option check', e.message);
    return fallback;
  }
}

export default async function handler(req, res) {
  if (!sql) return res.status(503).json({ ok: false, error: 'This isn’t open yet.' });
  await init();
  res.setHeader('Cache-Control', 'no-store');
  const b = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) : {};

  if (req.query.admin || b.admin) {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (req.method === 'GET') {
      const [asks, ns, os] = await Promise.all([
        sql`SELECT id, title, why, topic, area, body, status, reports, created_at FROM sv_wants ORDER BY created_at DESC LIMIT 1000`,
        sql`SELECT wid, voter, body, status, created_at FROM sv_want_notes ORDER BY created_at DESC LIMIT 1000`,
        sql`SELECT wid, key, label, body, status, reports, created_at FROM sv_want_options ORDER BY created_at DESC LIMIT 1000`,
      ]);
      return res.json({ ok: true, asks, notes: ns.map((n) => ({ wid: n.wid, nid: hash(`n|${n.wid}|${n.voter}`).slice(0, 12), text: n.body, status: n.status, at: n.created_at })),
        options: os.map((o) => {
          const seed = SEEDS.find((s) => s.id === o.wid);
          const base = seed?.options ? seed.options.map((k, i) => ({ key: k, label: seed.labels?.[i] || k })) : [{ key: 'y', label: 'Yes' }, { key: 'n', label: 'No' }];
          const others = [...base, ...os.filter((x) => x.wid === o.wid && x.key !== o.key && x.status === 'ok').map((x) => ({ key: x.key, label: x.label }))];
          return { wid: o.wid, okey: o.key, label: o.label, text: o.body, status: o.status, reports: o.reports, at: o.created_at, question: seed?.title || o.wid, others };
        }) });
    }
    const st = b.admin === 'show' ? 'ok' : 'removed';
    if (b.admin === 'merge') {
      // Two answers that mean the same thing: move every vote from one to the other and retire the first.
      const wid = String(b.wid || ''), from = String(b.from || ''), into = String(b.into || ''), label = clean(b.label, 60);
      const [f] = await sql`SELECT key FROM sv_want_options WHERE wid = ${wid} AND key = ${from}`;
      const seed = SEEDS.find((x) => x.id === wid);
      const intoOk = (seed?.options || ['y', 'n']).includes(into) || (await sql`SELECT 1 FROM sv_want_options WHERE wid = ${wid} AND key = ${into} AND status = 'ok'`).length > 0;
      if (!f || !intoOk || from === into) return res.status(400).json({ ok: false, error: 'Pick two different answers on the same question.' });
      await sql`UPDATE sv_want_votes SET choice = ${into}, updated_at = now() WHERE wid = ${wid} AND choice = ${from}`;
      await sql`UPDATE sv_want_options SET status = 'merged' WHERE wid = ${wid} AND key = ${from}`;
      if (label && into.startsWith('x')) await sql`UPDATE sv_want_options SET label = ${label} WHERE wid = ${wid} AND key = ${into}`;
      return res.json({ ok: true });
    }
    if (b.okey) await sql`UPDATE sv_want_options SET status = ${st} WHERE wid = ${String(b.wid || '')} AND key = ${String(b.okey)}`;
    else if (b.nid) {
      const [n] = (await sql`SELECT wid, voter FROM sv_want_notes WHERE wid = ${String(b.wid || '')}`).filter((r) => hash(`n|${r.wid}|${r.voter}`).slice(0, 12) === b.nid);
      if (!n) return res.status(404).json({ ok: false });
      await sql`UPDATE sv_want_notes SET status = ${st} WHERE wid = ${n.wid} AND voter = ${n.voter}`;
    } else await sql`UPDATE sv_wants SET status = ${st} WHERE id = ${String(b.wid || '')}`;
    return res.json({ ok: true });
  }

  if (req.method === 'GET') {
    const voter = voterOk(req.query.voter) ? hash(req.query.voter) : null;
    const [asks, t, ns, extras, mine, [{ people }]] = await Promise.all([
      residentAsks(), tallies(), notes(), extraOptions(),
      voter ? sql`SELECT wid, choice FROM sv_want_votes WHERE voter = ${voter}` : [],
      sql`SELECT count(DISTINCT voter)::int AS people FROM sv_want_votes`,
    ]);
    return res.json({ ok: true, people, asks, tallies: t, notes: ns, extras, mine: Object.fromEntries(mine.map((r) => [r.wid, r.choice])) });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!voterOk(b.voter)) return res.status(400).json({ ok: false, error: 'Please reload the page and try again.' });
  const voter = hash(b.voter), net = netOf(req);
  const exists = async (wid) => SEEDS.some((s) => s.id === wid) || (await sql`SELECT 1 FROM sv_wants WHERE id = ${wid} AND status = 'ok'`).length > 0;

  if (b.action === 'vote') {
    const wid = String(b.wid || '');
    if (!(await exists(wid))) return res.status(404).json({ ok: false, error: 'That ask isn’t on the list any more.' });
    if (b.choice === '') await sql`DELETE FROM sv_want_votes WHERE wid = ${wid} AND voter = ${voter}`;
    else {
      const seed = SEEDS.find((x) => x.id === wid);
      const allowed = [...(seed?.options ? [...seed.options, 'm'] : CHOICES), ...(await sql`SELECT key FROM sv_want_options WHERE wid = ${wid} AND status = 'ok'`).map((r) => r.key)];
      if (!allowed.includes(b.choice)) return res.status(400).json({ ok: false, error: 'Please pick one of the answers.' });
      const [before] = await sql`SELECT 1 FROM sv_want_votes WHERE wid = ${wid} AND voter = ${voter}`;
      if (!before) {
        const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_want_votes WHERE wid = ${wid} AND net = ${net}`;
        if (n >= PER_NETWORK) return res.status(429).json({ ok: false, error: 'Lots of answers on this one have come from your internet connection already, so we can’t count another from it.' });
      }
      await sql`INSERT INTO sv_want_votes (wid, voter, choice, area, net) VALUES (${wid}, ${voter}, ${b.choice}, ${areaOk(b.area)}, ${net})
        ON CONFLICT (wid, voter) DO UPDATE SET choice = EXCLUDED.choice, area = coalesce(EXCLUDED.area, sv_want_votes.area), updated_at = now()`;
    }
    const t = await tallies();
    return res.json({ ok: true, tally: t[wid] || { y: 0, n: 0, m: 0, areas: {} }, choice: b.choice || '' });
  }

  if (b.action === 'check') {
    const text = clean(b.text, 2000);
    if (text.length < 12) return res.status(400).json({ ok: false, error: 'Add a little more so we can turn it into a clear ask.' });
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_want_checks WHERE net = ${net} AND at > now() - interval '1 hour'`;
    if (n >= CHECKS_PER_HOUR) return res.status(429).json({ ok: false, error: 'That’s a lot of suggestions from your connection in the last hour. Please try again a bit later.' });
    await sql`INSERT INTO sv_want_checks (net) VALUES (${net})`;
    const list = [...SEEDS.map((s) => ({ id: s.id, title: s.title, why: s.why })), ...(await residentAsks()).map((a) => ({ id: a.id, title: a.title, why: a.why }))];
    const c = await check(text, list);
    return res.json({ ok: true, ...c, sig: sign({ text, title: c.draft.title, why: c.draft.why, topic: c.draft.topic, publish: c.publish, held: c.held }) });
  }

  if (b.action === 'post' || b.action === 'add-words') {
    const text = clean(b.text, 2000), d = b.draft || {};
    const signed = { text, title: clean(d.title, 120), why: clean(d.why, 300), topic: TOPICS.includes(d.topic) ? d.topic : 'other', publish: !!d.publish, held: !!d.held };
    if (!b.sig || b.sig !== sign(signed)) return res.status(400).json({ ok: false, error: 'Please check your suggestion again before posting.' });
    if (!signed.publish) return res.status(400).json({ ok: false, error: 'This one doesn’t fit the rules yet. Edit it and check again.' });
    const status = signed.held ? 'pending' : 'ok';
    if (b.action === 'add-words') {
      const wid = String(b.wid || '');
      if (!(await exists(wid))) return res.status(404).json({ ok: false, error: 'That ask isn’t on the list any more.' });
      await sql`INSERT INTO sv_want_notes (wid, voter, body, status) VALUES (${wid}, ${voter}, ${text}, ${status})
        ON CONFLICT (wid, voter) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, created_at = now()`;
      return res.json({ ok: true, status });
    }
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_wants WHERE net = ${net} AND created_at > now() - interval '1 day'`;
    if (n >= POSTS_PER_DAY) return res.status(429).json({ ok: false, error: 'Your connection has added a few asks today already. Please come back tomorrow to add more.' });
    const id = `r-${randomBytes(4).toString('hex')}`;
    const area = b.area === 'all' ? null : areaOk(b.area);
    await sql`INSERT INTO sv_wants (id, title, why, topic, area, body, status, voter, net) VALUES (${id}, ${signed.title}, ${signed.why}, ${signed.topic}, ${area}, ${text}, ${status}, ${voter}, ${net})`;
    // The writer has answered yes to their own ask.
    await sql`INSERT INTO sv_want_votes (wid, voter, choice, area, net) VALUES (${id}, ${voter}, 'y', ${areaOk(b.myArea)}, ${net}) ON CONFLICT DO NOTHING`;
    return res.json({ ok: true, status, ask: { id, title: signed.title, why: signed.why, topic: signed.topic, area, body: text, created_at: new Date().toISOString() } });
  }

  if (b.action === 'add-option') {
    const wid = String(b.wid || ''), text = clean(b.text, 300);
    const seed = SEEDS.find((x) => x.id === wid) || (await sql`SELECT id, title, why FROM sv_wants WHERE id = ${wid} AND status = 'ok'`)[0];
    if (!seed) return res.status(404).json({ ok: false, error: 'That ask isn’t on the list any more.' });
    const base = seed.options ? seed.options.map((k, i) => ({ key: k, label: seed.labels?.[i] || k })) : [{ key: 'y', label: 'Yes' }, { key: 'n', label: 'No' }];
    if (text.length < 3) return res.status(400).json({ ok: false, error: 'Write the answer you’d like to see.' });
    const extra = await sql`SELECT key, label, status, net, created_at FROM sv_want_options WHERE wid = ${wid}`;
    const live = extra.filter((o) => o.status === 'ok' || o.status === 'pending');
    if (base.length + live.length >= MAX_OPTIONS) return res.status(400).json({ ok: false, error: 'This question has plenty of answers already. Pick the closest one, or add the idea as its own ask.' });
    const [{ n: checks }] = await sql`SELECT count(*)::int AS n FROM sv_want_checks WHERE net = ${net} AND at > now() - interval '1 hour'`;
    if (checks >= CHECKS_PER_HOUR) return res.status(429).json({ ok: false, error: 'That’s a lot of suggestions from your connection in the last hour. Please try again a bit later.' });
    const [{ n: today }] = await sql`SELECT count(*)::int AS n FROM sv_want_options WHERE net = ${net} AND created_at > now() - interval '1 day'`;
    if (today >= OPTIONS_PER_DAY) return res.status(429).json({ ok: false, error: 'Your connection has added a few answers today already. Please come back tomorrow.' });
    await sql`INSERT INTO sv_want_checks (net) VALUES (${net})`;
    const current = [...base, ...extra.filter((o) => o.status === 'ok').map((o) => ({ key: o.key, label: o.label }))];
    const c = await checkOption(text, seed, current);
    if (!c.publish) return res.json({ ok: true, rejected: c.reason || 'It doesn’t fit the rules yet.' });
    if (c.same) return res.json({ ok: true, same: c.same });
    const dupe = current.find((o) => o.label.toLowerCase() === c.label.toLowerCase());
    if (dupe) return res.json({ ok: true, same: dupe.key });
    const key = `x${randomBytes(3).toString('hex')}`, status = c.held ? 'pending' : 'ok';
    await sql`INSERT INTO sv_want_options (wid, key, label, means, body, status, voter, net) VALUES (${wid}, ${key}, ${c.label}, ${c.means}, ${text}, ${status}, ${voter}, ${net})`;
    if (status === 'ok') await sql`INSERT INTO sv_want_votes (wid, voter, choice, area, net) VALUES (${wid}, ${voter}, ${key}, ${areaOk(b.area)}, ${net})
      ON CONFLICT (wid, voter) DO UPDATE SET choice = EXCLUDED.choice, area = coalesce(EXCLUDED.area, sv_want_votes.area), updated_at = now()`;
    const t = await tallies();
    return res.json({ ok: true, status, option: { key, label: c.label, means: c.means }, tally: t[wid] || { y: 0, n: 0, m: 0, areas: {} } });
  }

  if (b.action === 'report' && b.okey) {
    const wid = String(b.wid || ''), okey = String(b.okey), rid = `${wid}#${okey}`;
    const [row] = await sql`SELECT voter FROM sv_want_options WHERE wid = ${wid} AND key = ${okey} AND status = 'ok'`;
    if (!row || row.voter === voter) return res.json({ ok: true });
    await sql`INSERT INTO sv_want_reports (wid, voter) VALUES (${rid}, ${voter}) ON CONFLICT DO NOTHING`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_want_reports WHERE wid = ${rid}`;
    await sql`UPDATE sv_want_options SET reports = ${n}, status = CASE WHEN ${n} >= ${REPORTS_TO_HIDE} THEN 'reported' ELSE status END WHERE wid = ${wid} AND key = ${okey}`;
    return res.json({ ok: true });
  }

  if (b.action === 'report') {
    const wid = String(b.wid || '');
    const [row] = await sql`SELECT voter FROM sv_wants WHERE id = ${wid} AND status = 'ok'`;
    if (!row || row.voter === voter) return res.json({ ok: true });
    await sql`INSERT INTO sv_want_reports (wid, voter) VALUES (${wid}, ${voter}) ON CONFLICT DO NOTHING`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM sv_want_reports WHERE wid = ${wid}`;
    await sql`UPDATE sv_wants SET reports = ${n}, status = CASE WHEN ${n} >= ${REPORTS_TO_HIDE} THEN 'reported' ELSE status END WHERE id = ${wid}`;
    return res.json({ ok: true });
  }
  return res.status(400).json({ ok: false });
}
