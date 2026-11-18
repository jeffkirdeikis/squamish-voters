// Meeting night extras: turns the talk time file (scripts/pipeline/talktime.py merge output) plus the meeting summary
// into m.night: who spoke (names on each voice), chairing vs debating for the chair, time per topic, watch-this-moment
// links, quotes (checked word for word against the transcript), what happens next, places mentioned, motions moved,
// questions asked, and readers' Have your say answers next to council's votes. build.mjs draws it (nightTiles etc).
// Usage: node scripts/pipeline/night.mjs <meeting id> <talktime.json>
// Run after summarize.mjs has written m.summary and m.decisions for the meeting.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, MEET_DIR, readJson, saveMeeting, log, claudeJson, council, hoods, tracked } from './lib.mjs';

const [id, ttFile] = process.argv.slice(2);
const m = readJson(path.join(MEET_DIR, `${id}.json`));
if (!m || !m.decisions) throw new Error(`meeting ${id} has no summary yet; run summarize.mjs first`);
const tt = readJson(ttFile);
const hms = (t) => { t = Math.round(t); return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const secs = (s) => { const p = String(s).split(':').map(Number); return p.reduce((a, b) => a * 60 + b, 0); };

// Transcript lines with their anonymous voice ids, and how long each voice spoke.
const lines = tt.lines.filter((l) => l.text);
const script = lines.map((l) => `[${hms(l.start)}] ${l.spk || '?'}: ${l.text}`).join('\n');
const voices = Object.entries(tt.speakers).map(([k, v]) => `${k}: ${Math.round(v.seconds / 60)} min, ${v.turns} turns`).join('\n');
const members = council().map((c) => ({ slug: c.slug, name: c.name, office: c.office }));

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['voices', 'chair_debate', 'topics', 'moments', 'quotes', 'next', 'places', 'movers', 'questions', 'public_speakers', 'dollars', 'residents_map'],
  properties: {
    voices: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['voice', 'key', 'name', 'role', 'confidence'], properties: {
      voice: { type: 'string' }, key: { type: 'string', description: 'member slug, or "staff", "public", "guest", "unknown"' }, name: { type: 'string' },
      role: { type: 'string', enum: ['council', 'staff', 'public', 'guest', 'unknown'] }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } } } },
    chair_debate: { type: 'array', description: 'time ranges where the chair is debating or giving their own view rather than running the meeting', items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } },
    topics: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'from', 'to'], properties: { label: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } } },
    moments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['at', 'label'], properties: { at: { type: 'string' }, label: { type: 'string' } } } },
    quotes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['voice', 'text', 'at', 'about'], properties: { voice: { type: 'string' }, text: { type: 'string' }, at: { type: 'string' }, about: { type: 'string' } } } },
    next: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'steps', 'how', 'track'], properties: {
      title: { type: 'string' }, how: { type: 'string' }, track: { type: 'string' },
      steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'date', 'done'], properties: { label: { type: 'string' }, date: { type: 'string' }, done: { type: 'boolean' } } } } } } },
    places: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'area', 'note', 'at'], properties: { name: { type: 'string' }, area: { type: 'string' }, note: { type: 'string' }, at: { type: 'string' } } } },
    movers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['slug', 'count'], properties: { slug: { type: 'string' }, count: { type: 'integer' } } } },
    questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['slug', 'count'], properties: { slug: { type: 'string' }, count: { type: 'integer' } } } },
    public_speakers: { type: 'integer' },
    dollars: { type: 'object', additionalProperties: false, required: ['amount', 'label'], properties: { amount: { type: 'string' }, label: { type: 'string' } } },
    residents_map: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['qid', 'decision'], properties: { qid: { type: 'string' }, decision: { type: 'integer' } } } },
  },
};

const QS = (readJson(path.join(ROOT, 'api', '_questions.json'), []) || []);
const qList = (Array.isArray(QS) ? QS : QS.questions || []).filter((q) => q.meeting === m.id).map((q) => ({ qid: q.id, ask: q.ask }));

const out = await claudeJson({
  system: 'You analyse District of Squamish (B.C.) council meeting recordings for Squamish Voters, a non-partisan site. Be exact and conservative: never guess a name you cannot support from the transcript.',
  content: `The transcript below was made automatically from the District's video. Each line has a timestamp and an anonymous voice id (S0, S5 ...) from voice recognition software. One person may occasionally appear under two ids, and a line where two people talk can carry the wrong id.

TASK 1, voices: name every voice id. Evidence: the chair calls on members by name right before they speak ("Councillor Ellis"), members say "through the chair", staff are introduced by name and title and answer questions, delegations and public speakers introduce themselves. Mayor Easton normally chairs; if someone else chairs, say so in the name. Use member slugs for council members, "staff" for all District staff (name = their name and title if said, else "District staff"), "public" for residents speaking in public input, "guest" for delegations and outside presenters, "unknown" if unsure. Two ids can map to the same person.

TASK 2, chair_debate: time ranges where the chair speaks for themselves (giving their own view in debate, asking their own questions, moving their own motion), as opposed to running the meeting (calling speakers, reading motions, calling votes, thanking people). Leave empty if the chair never debated.

TASK 3: topics = the meeting split into consecutive parts by agenda item, covering it start to end, plain short labels (max 5 words). moments = 6 to 12 moments worth watching: each vote, the sharpest exchanges, any surprise. quotes = 3 to 5 lines that best capture the debate, copied WORD FOR WORD from one transcript line (you may cut words from the start or end only), from council members by preference; "at" is that line's timestamp. next = for each item that is not finished (bylaws with readings still to come, items referred to staff, public hearings coming, motions given notice), the steps with dates if stated (YYYY-MM-DD, else ""), done true for steps completed; "how" = how a resident can have a say before the next step (write to council, speak at the hearing, etc.), "" if nothing; track = a tracked issue slug if it fits, else "". places = specific places (streets, parks, developments, buildings) that came up, with a neighbourhood slug or "all", a one-line note, and the timestamp. movers = how many motions each member moved (only when the transcript says who moved). questions = how many questions each council member asked staff or presenters. public_speakers = number of residents who spoke in public input (0 if none). dollars = the total money council approved spending tonight in plain form like "$1.4M" with label "approved", or amount "" if none or unclear. residents_map = for each Have your say question below, the index of the decision (from DECISIONS) that settled it, or -1.

All timestamps as HH:MM:SS from the transcript.

COUNCIL: ${JSON.stringify(members)}
NEIGHBOURHOODS: ${JSON.stringify(hoods().map((h) => ({ slug: h.slug, name: h.name })))}
TRACKED ISSUES: ${JSON.stringify(tracked().map((t) => ({ slug: t.slug, title: t.title })))}
HAVE YOUR SAY QUESTIONS: ${JSON.stringify(qList)}
DECISIONS (from our summary, index = position): ${JSON.stringify(m.decisions.map((d, i) => ({ i, title: d.title, result: d.result, timestamp: d.timestamp })))}

VOICE TOTALS:
${voices}

TRANSCRIPT:
${script}`,
  schema: SCHEMA,
});

// Voices -> people. Talk time comes from the diarization turns (speech only), split for the chair into chairing/debating.
const who = Object.fromEntries(out.voices.map((v) => [v.voice, v]));
const memberSlugs = new Set(members.map((c) => c.slug));
const people = {};
const debate = out.chair_debate.map((r) => [secs(r.from), secs(r.to)]);
const inDebate = (a, b) => debate.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
const chairSlug = members.find((c) => c.office === 'mayor')?.slug;
let prevKey = null;
for (const t of tt.turns) {
  const v = who[t.spk];
  const key = !v || v.role === 'unknown' || (v.role === 'council' && !memberSlugs.has(v.key)) ? 'unknown' : v.role === 'council' ? v.key : v.role;
  const p = (people[key] ||= { key, name: key !== 'unknown' && v.role === 'council' ? v.name : { staff: 'District staff', public: 'Residents (public input)', guest: 'Delegations and presenters', unknown: 'Not identified' }[key] || v?.name || key, role: key === 'unknown' ? 'unknown' : v.role, seconds: 0, turns: 0 });
  const d = t.end - t.start;
  p.seconds += d;
  if (key === chairSlug) p.chair_seconds = (p.chair_seconds || 0) + (d - inDebate(t.start, t.end));
  if (key !== prevKey) p.turns += 1;
  prevKey = key;
}
const qs = Object.fromEntries(out.questions.map((x) => [x.slug, x.count]));
const talk = Object.values(people).map((p) => ({ ...p, seconds: Math.round(p.seconds), ...(p.chair_seconds ? { chair_seconds: Math.round(p.chair_seconds) } : {}), ...(p.role === 'council' ? { questions: qs[p.key] || 0 } : {}) }));

// Quotes must be in the transcript word for word, from the voice we say; anything else is dropped.
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const quotes = out.quotes.filter((q) => {
  const at = secs(q.at), near = lines.filter((l) => Math.abs(l.start - at) < 30 && l.spk === q.voice);
  return near.some((l) => norm(l.text).includes(norm(q.text))) && who[q.voice] && who[q.voice].key !== 'unknown' && (who[q.voice].role !== 'council' || memberSlugs.has(who[q.voice].key));
}).map((q) => ({ slug: memberSlugs.has(who[q.voice].key) ? who[q.voice].key : null, name: who[q.voice].name, text: q.text.trim(), t_s: secs(q.at), about: q.about }));
log(`quotes kept ${quotes.length} of ${out.quotes.length}`);

// Readers' answers, read from the live site at this moment (the questions closed when the meeting started).
let residents = [];
try {
  const r = await (await fetch(`https://squamishvoters.com/api/have-your-say/?voter=night-${Date.now()}`)).json();
  residents = out.residents_map.filter((x) => x.decision >= 0 && m.decisions[x.decision] && r.tallies?.[x.qid]).map((x) => {
    const t = r.tallies[x.qid], d = m.decisions[x.decision], v = Object.values(d.votes || {});
    const y = v.filter((z) => z === 'yes').length, n = v.filter((z) => z === 'no').length;
    return { qid: x.qid, q: qList.find((q) => q.qid === x.qid)?.ask || d.title, yes: t.yes + (t.yes_changes || 0), no: t.no + (t.no_changes || 0), unsure: t.unsure || 0, total: t.total, council: d.votes ? `${d.result === 'passed' ? 'Passed' : d.result === 'failed' ? 'Failed' : 'Decided'} ${y}–${n}` : 'No vote' };
  });
} catch (e) { log('residents tallies unavailable', e.message); }

const end = tt.duration;
m.night = {
  video_id: (m.video_ids || [])[0] || (m.video_url || '').match(/v=([\w-]{11})/)?.[1] || null,
  duration_s: end,
  talk: talk.sort((a, b) => b.seconds - a.seconds),
  voices: out.voices,
  topics: out.topics.map((t) => ({ label: t.label, start_s: secs(t.from), end_s: Math.min(end, secs(t.to)) })).filter((t) => t.end_s > t.start_s),
  moments: out.moments.map((x) => ({ t_s: secs(x.at), label: x.label })),
  quotes,
  next: out.next.map((x) => ({ ...x, steps: x.steps.map((s) => ({ label: s.label, ...(s.date ? { date: s.date } : {}), done: s.done })), ...(x.track ? {} : { track: undefined }) })),
  places: out.places.map((p) => ({ name: p.name, area: p.area || 'all', note: p.note, t_s: p.at ? secs(p.at) : null })),
  movers: Object.fromEntries(out.movers.filter((x) => memberSlugs.has(x.slug) && x.count).map((x) => [x.slug, x.count])),
  public_speakers: out.public_speakers,
  ...(out.dollars.amount ? { dollars: out.dollars } : {}),
  residents,
  method: 'Speaker turns from sherpa-onnx (pyannote segmentation 3.0 + NeMo TitaNet), transcript from faster-whisper small.en, names and topics by Claude from the transcript.',
  generated: new Date().toISOString(),
};
saveMeeting(m);
log('night written', id, `${talk.length} speakers, ${m.night.topics.length} topics, ${quotes.length} quotes`);
