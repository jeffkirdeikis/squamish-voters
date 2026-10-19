// Shared helpers for the meetings pipeline: CivicWeb (agendas), YouTube (video), files, and Claude.
// Every meeting lives in data/meetings/<id>.json. build.mjs turns those files into the site.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MEET_DIR = path.join(ROOT, 'data', 'meetings');
export const RAW_DIR = path.join(ROOT, 'data', 'meetings', 'raw'); // agenda and minutes text we summarise from
export const TRANSCRIPTS = path.join(ROOT, 'public', 'transcripts');
export const CW = 'https://squamish.civicweb.net';
// The new council's first meeting. Anything earlier belongs to the old council and is ignored.
export const TERM_START = '2026-11-03';
// CivicWeb's robots.txt asks bots to stay away, so we identify ourselves, poll gently and cache.
const UA = 'SquamishVoters/1.0 (+https://squamishvoters.com; civic summaries)';
// CivicWeb TypeId -> our meeting type. 7 (advisory committees) is left out.
export const CW_TYPE = { 3: 'regular', 4: 'special', 5: 'cow' };

for (const d of [MEET_DIR, RAW_DIR, TRANSCRIPTS]) fs.mkdirSync(d, { recursive: true });

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
export const readJson = (f, dflt = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : dflt);
export const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n');

export function loadMeetings() {
  return fs.readdirSync(MEET_DIR).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(MEET_DIR, f)));
}
export const saveMeeting = (m) => writeJson(path.join(MEET_DIR, `${m.id}.json`), m);
export const meetingId = (date, type) => `${date}-${type}`;

let lastFetch = 0;
export async function cw(p, { json = true } = {}) {
  const wait = 1500 - (Date.now() - lastFetch); if (wait > 0) await sleep(wait); // at most one request every 1.5 s
  lastFetch = Date.now();
  const r = await fetch(CW + p, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*' } });
  if (!r.ok) throw new Error(`CivicWeb ${r.status} for ${p}`);
  if (!json) return Buffer.from(await r.arrayBuffer());
  let v = await r.json();
  if (typeof v === 'string' && /^[[{]/.test(v)) v = JSON.parse(v); // getevent and videolink double-encode
  return v;
}

// Agenda HTML -> plain text with the item numbering kept, plus every attachment link.
export function htmlToText(html) {
  const links = [...html.matchAll(/href="([^"]*FileStorage[^"]+)"[^>]*>([^<]*)/gi)].map((m) => ({ url: m[1].startsWith('http') ? m[1] : CW + m[1], name: m[2].trim() }));
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<td[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  return { text, links };
}

export function pdfToText(buf) {
  const tmp = path.join(RAW_DIR, `.tmp-${process.pid}.pdf`);
  fs.writeFileSync(tmp, buf);
  try { return execFileSync('pdftotext', ['-layout', tmp, '-'], { maxBuffer: 64 << 20 }).toString(); } finally { fs.rmSync(tmp, { force: true }); }
}

// Council roster for prompts, from the same candidates.json the site uses.
export function council() {
  const res = readJson(path.join(ROOT, 'data', 'results.json'))['2026'];
  const won = new Set(['mayor', 'council'].flatMap((k) => res[k].filter((r) => r.elected).map((r) => r.name)));
  return readJson(path.join(ROOT, 'data', 'candidates.json')).filter((c) => won.has(c.name));
}

// Same ids build.mjs gives each "supports" / "against" line, so a vote can point at the exact position it tests.
export const posId = (c, kind, text) => `${c.slug}-${kind}-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 6)}`;
export const positionList = (people) => people.flatMap((c) => [
  ...(c.supports || []).map((x) => ({ id: posId(c, 's', x.text), who: c.slug, position: `supports: ${x.text}` })),
  ...(c.opposes || []).map((x) => ({ id: posId(c, 'o', x.text), who: c.slug, position: `against: ${x.text}` })),
]);

// Neighbourhoods and the long-running issues we follow, for tagging decisions (data/participate.json, data/tracked-issues.json).
export const hoods = () => (readJson(path.join(ROOT, 'data', 'participate.json'), {}).neighbourhoods || []).map((h) => ({ slug: h.slug, name: h.name, also: h.also || [] }));
export const tracked = () => readJson(path.join(ROOT, 'data', 'tracked-issues.json'), []).map((t) => ({ slug: t.slug, title: t.title, keywords: t.keywords || [], steps: (t.steps || []).map((x) => x.label) }));
export const TAG_RULES = `"for_you": one plain sentence on what it means for an ordinary resident, ideally in dollars ("About $40 more a year on an average home's property tax") or places ("Affects homes along Government Road"). Use only numbers the agenda, staff reports or recording actually give. Empty string if nothing concrete.
"areas": neighbourhood slugs it mostly affects, from the NEIGHBOURHOODS list, or ["all"] for the whole town.
"issues": slugs from the TRACKED ISSUES list this is part of, or [].`;

// Staff reports and other PDFs attached to an agenda, as text, so summaries can quote real costs. Cached per meeting.
export async function attachmentsText(m, max = 160000) {
  const f = path.join(RAW_DIR, `${m.id}-attachments.txt`);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  let out = '';
  for (const a of (m.attachments || []).filter((x) => /\.pdf$/i.test(x.url) && !/Minutes/i.test(x.url)).slice(0, 25)) {
    if (out.length > max) break;
    try { out += `\n\n=== ${decodeURIComponent(a.url.split('/').pop()).replace(/^[0-9A-F]{20,}-/, '')} ===\n` + pdfToText(await cw(new URL(a.url).pathname, { json: false })).slice(0, 25000); } catch (e) { log('attachment skipped:', e.message); }
  }
  fs.writeFileSync(f, out);
  return out;
}

// ---------- Claude ----------
// One structured call per job. Opus 5.5 at high effort: these summaries are the site's public record.
let client;
export async function claudeJson({ system, content, schema, effort = 'high', maxTokens = 64000 }) {
  if (!client) { const { default: Anthropic } = await import('@anthropic-ai/sdk'); client = new Anthropic(); }
  const stream = client.beta.messages.stream({
    model: 'claude-opus-5-5',
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error(`Claude declined (${msg.stop_details?.category || 'no category'})`);
  if (msg.stop_reason === 'max_tokens') throw new Error('Claude hit max_tokens before finishing the JSON');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  log(`claude: ${msg.usage.input_tokens} in, ${msg.usage.output_tokens} out`);
  return JSON.parse(text);
}

// The rules every summary follows. Kept in one place so agenda previews and meeting summaries read the same.
export const STYLE = `You write for Squamish Voters, an independent, non-partisan site that explains Squamish (B.C.) council to ordinary residents.
Write so a grandparent who has never watched a council meeting understands every sentence:
- Short sentences. Everyday words. Say "council voted to..." not "council resolved that...".
- Explain any planning or legal term the first time in a few words (for example: "rezoning (changing what can be built on a piece of land)").
- No em dashes. No hyphenated compound adjectives where a plain phrase works. Spell out abbreviations (write "Official Community Plan", not "OCP").
- Never take sides, praise or criticise anyone. Report what was said and decided. Use people's titles and last names ("Councillor Ellis", "Mayor Easton").
- Never invent anything. If the source doesn't say it, leave it out. If you are unsure who voted which way, say so in the field provided rather than guessing.
- Don't name members of the public who spoke or wrote in. Say "three residents spoke against it" instead.`;
