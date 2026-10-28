// Weekly AI visibility check: asks Claude (with web search) the questions Squamish residents really ask, the way they
// ask them (never naming us), and records whether the answer finds, cites or names squamishvoters.com.
//   node scripts/ai-visibility/check.mjs            all questions
//   node scripts/ai-visibility/check.mjs --only 3   just the first 3 (a cheap test)
// Writes data/ai-visibility/<date>.json and adds a line to data/ai-visibility/history.json. Needs ANTHROPIC_API_KEY.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'data', 'ai-visibility');
const US = 'squamishvoters.com';
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(DIR, 'questions.json'), 'utf8'));
const only = process.argv.includes('--only') ? Number(process.argv[process.argv.indexOf('--only') + 1]) : QUESTIONS.length;
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });

const { default: Anthropic } = await import('@anthropic-ai/sdk');
const client = new Anthropic();
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

// Every URL anywhere in the search results (the dynamic filtering search can nest them), and every URL the answer cites.
function urlsIn(x, out = new Set()) {
  if (Array.isArray(x)) x.forEach((v) => urlsIn(v, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) k === 'url' && typeof v === 'string' ? out.add(v) : urlsIn(v, out);
  return out;
}

async function ask(q) {
  // Only the date as a system prompt, like the Claude app gives it, so the answer is close to what a person would get.
  const messages = [{ role: 'user', content: q.q }];
  let content = [], usage = { input_tokens: 0, output_tokens: 0 }, msg;
  for (let turn = 0; turn < 4; turn++) {
    msg = await client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: `The current date is ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Vancouver', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', city: 'Squamish', region: 'British Columbia', country: 'CA', timezone: 'America/Vancouver' } }],
      messages,
    }).finalMessage();
    content = content.concat(msg.content);
    usage.input_tokens += msg.usage.input_tokens; usage.output_tokens += msg.usage.output_tokens;
    if (msg.stop_reason !== 'pause_turn') break; // a long search pauses the turn; send it back to let it finish
    messages.push({ role: 'assistant', content: msg.content });
  }
  if (msg.stop_reason === 'refusal') return { ...q, error: `declined (${msg.stop_details?.category || 'no category'})` };
  const results = content.filter((b) => b.type !== 'text');
  const texts = content.filter((b) => b.type === 'text');
  const answer = texts.map((b) => b.text).join('').trim();
  const cited = [...new Set(texts.flatMap((b) => (b.citations || []).map((c) => c.url).filter(Boolean)))];
  const found = [...urlsIn(results)];
  const ours = (list) => list.filter((u) => host(u) === US);
  return {
    id: q.id, q: q.q, topic: q.topic,
    searched: results.length > 0, found_us: ours(found).length > 0, cited_us: ours(cited).length > 0, named_us: /squamish\s*voters/i.test(answer),
    our_pages: [...new Set([...ours(cited), ...ours(found)])],
    cited_sites: [...new Set(cited.map(host).filter(Boolean))],
    found_sites: [...new Set(found.map(host).filter(Boolean))],
    answer: answer.slice(0, 1500),
    tokens: usage,
  };
}

// A few at a time so a slow search doesn't hold up the rest.
const todo = QUESTIONS.slice(0, only), rows = [];
for (let i = 0; i < todo.length; i += 4) {
  rows.push(...await Promise.all(todo.slice(i, i + 4).map((q) => ask(q).catch((e) => ({ ...q, error: String(e.message || e).slice(0, 300) })))));
  console.log(`${rows.length}/${todo.length} asked`);
}

const ok = rows.filter((r) => !r.error);
const count = (k) => ok.filter((r) => r[k]).length;
const rivals = {};
ok.forEach((r) => r.cited_sites.filter((s) => s !== US).forEach((s) => { rivals[s] = (rivals[s] || 0) + 1; }));
const summary = {
  date: TODAY, model: 'claude-opus-5-5', asked: rows.length, answered: ok.length,
  searched: count('searched'), cited: count('cited_us'), named: count('named_us'), found: count('found_us'),
  top_cited: Object.entries(rivals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([site, n]) => ({ site, n })),
  tokens: ok.reduce((t, r) => ({ input_tokens: t.input_tokens + r.tokens.input_tokens, output_tokens: t.output_tokens + r.tokens.output_tokens }), { input_tokens: 0, output_tokens: 0 }),
};
fs.writeFileSync(path.join(DIR, `${TODAY}.json`), JSON.stringify({ summary, rows }, null, 2) + '\n');
const histFile = path.join(DIR, 'history.json');
const hist = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, 'utf8')) : [];
fs.writeFileSync(histFile, JSON.stringify([...hist.filter((h) => h.date !== TODAY), summary], null, 2) + '\n');
console.log(`Cited us in ${summary.cited} of ${summary.answered} answers, named us in ${summary.named}, search found us in ${summary.found}.`);
console.log(`Most cited instead: ${summary.top_cited.map((s) => `${s.site} (${s.n})`).join(', ')}`);
