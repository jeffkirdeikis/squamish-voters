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
