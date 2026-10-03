// Private: what the Ask chat has cost so far, plus the latest questions and answers. Requires ADMIN_TOKEN.
// Totals come from the file names written by api/chat.js, so one listing is enough to add them up.
import { list, get } from '@vercel/blob';

const CREDIT = Number(process.env.CHAT_CREDIT_USD || 50); // what has been loaded onto the Anthropic account
const NAME = /^chat\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_(\d+)u/;
const pacificDay = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  const token = req.query.token || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    const rows = [];
    let cursor;
    do {
      const page = await list({ prefix: 'chat/', limit: 1000, cursor });
      for (const b of page.blobs) {
        const m = NAME.exec(b.pathname);
        if (m) rows.push({ pathname: b.pathname, at: new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`), cost: Number(m[6]) / 1e6 });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    rows.sort((a, b) => b.at - a.at);

    const today = pacificDay(new Date());
    const sum = (rs) => rs.reduce((s, r) => s + r.cost, 0);
    const todays = rows.filter((r) => pacificDay(r.at) === today);
    const byDay = {};
    for (const r of rows) { const d = pacificDay(r.at); (byDay[d] ||= { day: d, questions: 0, cost: 0 }).questions++; byDay[d].cost += r.cost; }

    // The latest answers are only opened when asked for, to keep this cheap to poll.
    const want = Math.min(Number(req.query.recent) || 0, 50);
    const recent = [];
    for (const r of rows.slice(0, want)) {
      try {
        const got = await get(r.pathname, { access: 'private', useCache: false });
        recent.push(JSON.parse(await new Response(got.stream || got.blob).text()));
      } catch (e) { recent.push({ at: r.at.toISOString(), error: 'unreadable' }); }
    }
    const total = sum(rows);
    return res.status(200).json({
      ok: true, credit: CREDIT, total, remaining: CREDIT - total, questions: rows.length,
      today: { questions: todays.length, cost: sum(todays) },
      perQuestion: rows.length ? total / rows.length : 0,
      days: Object.values(byDay).slice(0, 14), recent,
    });
  } catch (err) {
    console.error('chat usage failed', err);
    return res.status(500).json({ ok: false, error: 'could not read' });
  }
}
