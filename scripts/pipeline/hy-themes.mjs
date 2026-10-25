// Have your say: a neutral summary of what people wrote on each question. Comments are never published; this summary is.
// Writes data/hy-themes.json ({ qid: { n, summary, at } }). Redoes a summary once there are 8 comments, then whenever the
// count grows by a quarter, and one last time after voting closes. Run by .github/workflows/news.yml.
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { ROOT, log, readJson, writeJson, claudeJson, STYLE } from './lib.mjs';

const MIN = 8;
const FILE = path.join(ROOT, 'data', 'hy-themes.json');
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);
const questions = (readJson(path.join(ROOT, 'api', '_questions.json')) || {}).questions || [];
const themes = readJson(FILE) || {};
let changed = false;

const ids = questions.map((q) => q.id);
const rows = ids.length ? await sql`SELECT qid, choice, comment FROM sv_votes WHERE qid = ANY(${ids}) AND comment IS NOT NULL AND comment <> '' ORDER BY updated_at` : [];
for (const q of questions) {
  const cs = rows.filter((r) => r.qid === q.id);
  const was = themes[q.id], isClosed = Date.now() >= Date.parse(q.close);
  const due = cs.length >= MIN && (!was || cs.length >= Math.ceil(was.n * 1.25) || (isClosed && !was.final && cs.length !== was.n));
  if (!due) continue;
  const out = await claudeJson({
    system: STYLE,
    effort: 'medium',
    maxTokens: 4000,
    content: `Residents voted on this question before Squamish council decided it, and some added a comment.
QUESTION: ${q.ask}
BACKGROUND: ${q.context || q.plain}

Write "summary": two to four plain sentences on what people wrote: the main themes, roughly how common each was ("many", "several", "a few"), and points raised on different sides. Neutral and fair to every side. No quotes, no names, nothing that could identify anyone. Leave out abuse, personal attacks and anything off topic. If the comments are mostly one side, say so plainly.

COMMENTS (each with the person's vote):
${cs.map((c) => `- [${c.choice}] ${c.comment.replace(/\s+/g, ' ')}`).join('\n').slice(0, 150000)}`,
    schema: { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string' } } },
  });
  themes[q.id] = { n: cs.length, summary: out.summary.replace(/\s*[—–]\s*/g, ', '), at: new Date().toISOString(), ...(isClosed ? { final: true } : {}) };
  changed = true;
  log('comment summary', q.id, cs.length);
}
if (changed) writeJson(FILE, themes);
