// Private: what the Ask chat has cost so far, plus the latest questions and answers. Requires ADMIN_TOKEN.
// Reads the chat log in Neon (api/_chatdb.js). ?migrate=1 copies the answers logged to Blob before the move, once.
import { list, get } from '@vercel/blob';
import { available, usage, importOld, pacificDay } from './_chatdb.js';

const CREDIT = Number(process.env.CHAT_CREDIT_USD || 50); // what has been loaded onto the Anthropic account

async function migrate() {
  const entries = [];
  let cursor;
  do {
    const page = await list({ prefix: 'chat/', limit: 1000, cursor });
    for (const b of page.blobs) {
      const got = await get(b.pathname, { access: 'private', useCache: false });
      entries.push(JSON.parse(await new Response(got.stream || got.blob).text()));
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return { found: entries.length, copied: await importOld(entries) };
}

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  const token = req.query.token || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!available()) return res.status(503).json({ ok: false, error: 'DATABASE_URL not set' });
  try {
    const migrated = req.query.migrate ? await migrate() : undefined;
    const want = Math.min(Number(req.query.recent) || 0, 50);
    const u = await usage(want);
    const today = u.days.find((d) => d.day === pacificDay()) || { questions: 0, cost: 0 };
    return res.status(200).json({
      ok: true, credit: CREDIT, total: u.total, remaining: CREDIT - u.total, questions: u.questions,
      today: { questions: today.questions, cost: today.cost },
      perQuestion: u.questions ? u.total / u.questions : 0,
      limits: { perVisitorPerDay: Number(process.env.CHAT_PER_DAY || 50), dailyUsd: Number(process.env.CHAT_DAILY_USD || 25) },
      days: u.days, recent: u.recent, migrated,
    });
  } catch (err) {
    console.error('chat usage failed', err);
    return res.status(500).json({ ok: false, error: 'could not read' });
  }
}
