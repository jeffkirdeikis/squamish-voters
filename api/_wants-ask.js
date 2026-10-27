// One What Squamish Wants question and the words for an answer to it, for the share pictures (og.js) and pages (wants-page.js).
// Starter asks come from _wants.json; residents' asks (r-...) and answers residents added (x...) from the database.
import { neon } from '@neondatabase/serverless';
import SEED from './_wants.json' with { type: 'json' };

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = URL ? neon(URL) : null;

export async function findAsk(id) {
  const s = SEED.asks.find((a) => a.id === id);
  if (s) return { title: s.title, labels: s.labels || null, keys: s.options || null };
  if (!sql || !/^r-[a-z0-9]{4,20}$/.test(id)) return null;
  const [r] = await sql`SELECT title FROM sv_wants WHERE id = ${id} AND status = 'ok'`.catch(() => []);
  return r ? { title: r.title, labels: null, keys: null } : null;
}
// The words for one answer: Yes / No / Don't mind, a starter option's label, or an answer a resident added (x...).
export async function answerLabel(id, ask, key) {
  if (key === 'm') return 'Don’t mind';
  const i = ask.keys ? ask.keys.indexOf(key) : -1;
  if (i > -1) return ask.labels[i];
  if (!ask.keys && (key === 'y' || key === 'n')) return key === 'y' ? 'Yes' : 'No';
  if (!sql || !/^x[a-f0-9]{6}$/.test(key)) return null;
  const [o] = await sql`SELECT label FROM sv_want_options WHERE wid = ${id} AND key = ${key} AND status = 'ok'`.catch(() => []);
  return o ? o.label : null;
}

// Live results for one ask, for the share pictures and the words under a shared link. The answers are listed in the
// site's order (Yes / No, or the starter options, then answers residents added); Don't mind is counted apart.
export async function results(id, ask) {
  if (!sql) return null;
  const [votes, extra] = await Promise.all([
    sql`SELECT choice, count(*)::int AS n FROM sv_want_votes WHERE wid = ${id} GROUP BY choice`.catch(() => null),
    sql`SELECT key, label FROM sv_want_options WHERE wid = ${id} AND status = 'ok' ORDER BY created_at`.catch(() => []),
  ]);
  if (!votes) return null;
  const n = Object.fromEntries(votes.map((r) => [r.choice, r.n]));
  const base = ask.keys ? ask.keys.map((k, i) => ({ key: k, label: ask.labels[i] })) : [{ key: 'y', label: 'Yes' }, { key: 'n', label: 'No' }];
  const options = [...base, ...extra].map((o) => ({ ...o, n: n[o.key] || 0 }));
  const opinions = options.reduce((s, o) => s + o.n, 0), m = n.m || 0;
  return { options, opinions, m, total: opinions + m, multi: !!ask.keys || extra.length > 0 };
}
export const pctOf = (n, d) => (d ? Math.round((100 * n) / d) : 0);
// One line on where Squamish stands, e.g. "87% say yes" or "“Freeze it” leads with 62%". Null before anyone has picked a side.
export function standing(r) {
  if (!r || !r.opinions) return null;
  if (!r.multi) return `${pctOf(r.options[0].n, r.opinions)}% say yes`;
  const top = [...r.options].sort((a, b) => b.n - a.n)[0];
  return `“${top.label}” leads with ${pctOf(top.n, r.opinions)}%`;
}

// The most wanted yes / no asks right now, for the main page's share picture: the highest share of yes among people who
// said yes or no, counting only asks at least `min` people took a side on, so two early yeses can't top the list.
export async function topAsks(limit = 3, min = 20) {
  if (!sql) return [];
  const [rows, extra] = await Promise.all([
    sql`SELECT wid, choice, count(*)::int AS n FROM sv_want_votes GROUP BY wid, choice`.catch(() => []),
    sql`SELECT DISTINCT wid FROM sv_want_options WHERE status = 'ok'`.catch(() => []),
  ]);
  const t = {};
  for (const r of rows) (t[r.wid] ||= { y: 0, n: 0, m: 0 })[r.choice] = r.n;
  const multi = new Set(extra.map((r) => r.wid));
  const scored = Object.entries(t).filter(([id, x]) => x.y + x.n >= min && !multi.has(id))
    .map(([id, x]) => ({ id, yes: x.y / (x.y + x.n), opinions: x.y + x.n, total: x.y + x.n + x.m }))
    .sort((a, b) => b.yes - a.yes || b.opinions - a.opinions);
  const out = [];
  for (const s of scored) {
    if (out.length >= limit) break;
    const ask = await findAsk(s.id);
    if (ask && !ask.keys) out.push({ ...s, title: ask.title, pct: Math.round(100 * s.yes) });
  }
  return out;
}
