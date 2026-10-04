// The "Ask" chat. Answers only from the guide's own records (api/_kb.js, written by build.mjs).
// Streams newline-delimited JSON: {t:"text",d:"..."} chunks, then {t:"done",bad:[urls not in the records]}.
// Needs ANTHROPIC_API_KEY. Put a monthly spend limit on that key's workspace in the Anthropic Console.
import Anthropic from '@anthropic-ai/sdk';
import { track } from '@vercel/analytics/server';
import { URLS } from './_kb.js';
import { MODEL, SYSTEM, costOf } from './_prompt.js';
import { available as dbOn, pacificDay, visitorId, takeQuestion, giveBack, logAnswer } from './_chatdb.js';

const MAX_TURNS = 12;          // user messages per conversation
const MAX_USER_CHARS = 600;
const MAX_ASSISTANT_CHARS = 8000;
const RATE = { windowMs: 10 * 60 * 1000, max: 20 }; // per visitor, per server instance (a quick first check)
const PER_DAY = Number(process.env.CHAT_PER_DAY || 50);        // questions per visitor (IP address) per Pacific day, across all servers
const DAILY_USD = Number(process.env.CHAT_DAILY_USD || 25);     // the chat pauses for everyone once today's spend reaches this
const ALLOWED_ORIGINS = [/^https:\/\/squamishvoters\.com$/, /^https:\/\/squamish-votes[a-z0-9-]*\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];


const client = new Anthropic();
const hits = new Map();

function limited(key) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < RATE.windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > RATE.windowMs) hits.delete(k);
  return list.length > RATE.max;
}

// The browser keeps the conversation and sends it back each time; check its shape before using it.
function clean(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_TURNS * 2 - 1) return null;
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i], role = i % 2 === 0 ? 'user' : 'assistant';
    if (!m || m.role !== role || typeof m.content !== 'string') return null;
    const text = m.content.trim();
    if (!text || text.length > (role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS)) return null;
    out.push({ role, content: text });
  }
  return out[out.length - 1].role === 'user' ? out : null;
}

const KNOWN = new Set(URLS);
const linkUrls = (text) => [...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
const known = (u) => KNOWN.has(u) || KNOWN.has(u.split('#')[0]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const origin = req.headers.origin || '';
  if (origin && !ALLOWED_ORIGINS.some((r) => r.test(origin))) return res.status(403).json({ error: 'Not allowed' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'The question service is not switched on yet.' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'That’s a lot of questions in a short time. Please wait a few minutes and try again.' });

  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch { body = null; }
  const messages = clean(body?.messages);
  if (!messages) return res.status(400).json({ error: `Please keep questions under ${MAX_USER_CHARS} characters. Long conversations need a fresh start.` });

  // Daily limits, counted in the database so every server sees the same numbers. If the database is
  // unreachable the chat keeps working with only the per-server check above.
  const day = pacificDay(), visitor = visitorId(ip, day);
  let counted = false;
  if (dbOn()) {
    try {
      const { count, spent } = await takeQuestion(visitor, day);
      counted = true;
      if (count > PER_DAY) return res.status(429).json({ error: `You’ve asked ${PER_DAY} questions today, which is the daily limit. It resets at midnight. Everything the helper knows is also on the candidate pages.` });
      if (spent >= DAILY_USD) {
        await giveBack(visitor, day).catch(() => {});
        console.error(JSON.stringify({ chat: 1, error: 'daily spend cap reached', spent, cap: DAILY_USD }));
        return res.status(503).json({ error: 'The question helper has reached its limit for today. Please try again tomorrow, or browse the candidate pages and the quiz.' });
      }
    } catch (e) { console.error('chat limits unavailable', e?.message); }
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const send = (o) => res.write(JSON.stringify(o) + '\n');

  let answer = '';
  try {
    // Text-only history: no thinking blocks are replayed, so nothing in earlier turns needs to match.
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: process.env.CHAT_EFFORT || 'medium' },
      cache_control: { type: 'ephemeral' }, // caches the growing conversation for follow-up questions
      system: SYSTEM,
      messages,
    });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        answer += ev.delta.text;
        send({ t: 'text', d: ev.delta.text });
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      const msg = 'Sorry, I can’t help with that one. Try asking about a candidate, an issue, or how to vote.';
      answer += msg;
      send({ t: 'text', d: (answer.length > msg.length ? '\n\n' : '') + msg });
    } else if (final.stop_reason === 'max_tokens') {
      send({ t: 'text', d: '\n\n(That answer got cut off. Try asking about fewer candidates at once.)' });
    }
    const bad = linkUrls(answer).filter((u) => !known(u));
    send({ t: 'done', bad });
    const turn = Math.ceil(messages.length / 2), cost = costOf(final.usage);
    const entry = { at: new Date().toISOString(), turn, q: messages[messages.length - 1].content, a: answer, bad, stop: final.stop_reason, model: final.model, usage: final.usage, cost };
    console.log(JSON.stringify({ chat: 1, ...entry }));
    await Promise.all([
      dbOn() ? logAnswer({ ...entry, day, visitor }).catch((e) => console.error('chat record failed', e?.message)) : null,
      track('Chat question', { turn, cents: Math.round(cost * 1000) / 10 }, { headers: req.headers }).catch(() => {}),
    ]);
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status : 0;
    console.error(JSON.stringify({ chat: 1, error: String(err?.message || err), status }));
    if (counted && !answer) await giveBack(visitor, day).catch(() => {});
    send({ t: 'error', d: status === 429 || status === 529 ? 'The question service is busy right now. Please try again in a minute.' : 'Something went wrong on our end. Please try again.' });
  }
  res.end();
}
