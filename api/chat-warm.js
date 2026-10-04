// Keeps the chat's cached system prompt alive between questions. The whole guide (~140K tokens) is cached for an
// hour, and every use resets the hour. Letting it lapse costs about 56 cents to rebuild on the next question; a
// one-token ping that reads the cache costs about 2.8 cents. Called every 10 minutes by .github/workflows/keep-warm.yml;
// it only pings when the cache is close to expiring and someone has asked a real question recently.
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, SYSTEM, costOf } from './_prompt.js';
import { available, lastUse, logAnswer, pacificDay } from './_chatdb.js';

const PING_AFTER_MIN = 48;     // the cache lasts 60 minutes from its last use
const IDLE_STOP_H = 14;        // no real question for this long (e.g. a quiet night): let it lapse
const LAST_DAY = '2026-10-17'; // election day; nothing to keep warm after it

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!process.env.WARM_TOKEN || token !== process.env.WARM_TOKEN) return res.status(401).json({ ok: false });
  if (!available() || !process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: 'not configured' });

  const now = new Date(), day = pacificDay(now);
  const { any, question } = await lastUse();
  const minsSinceUse = any ? (now - any) / 60000 : Infinity;
  const hoursSinceQuestion = question ? (now - question) / 3600000 : Infinity;
  const why = day > LAST_DAY ? 'after election day'
    : hoursSinceQuestion > IDLE_STOP_H ? 'no recent questions'
    : minsSinceUse < PING_AFTER_MIN ? 'cache still fresh'
    : minsSinceUse > 60 ? 'cache already expired'
    : null;
  if (why && !req.query.force) return res.status(200).json({ ok: true, pinged: false, why, minsSinceUse: Math.round(minsSinceUse) });

  const msg = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 1,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: 'ping' }],
  });
  const cost = costOf(msg.usage);
  // Logged as turn 0 so it counts toward the daily spending cap and the admin totals, but not as a question.
  await logAnswer({ at: now.toISOString(), day, visitor: null, turn: 0, q: '(keep-warm ping)', a: '', bad: [], stop: msg.stop_reason, model: msg.model, usage: msg.usage, cost });
  return res.status(200).json({ ok: true, pinged: true, cacheRead: msg.usage.cache_read_input_tokens || 0, cents: Math.round(cost * 1000) / 10 });
}
