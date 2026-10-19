// Step 2: after a meeting, get its video, transcribe it, and write the plain-language summary and vote record.
//   node scripts/pipeline/summarize.mjs [meeting-id]
// Needs yt-dlp and ffmpeg on PATH, and python3 with faster-whisper for meetings YouTube hasn't captioned.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, RAW_DIR, TRANSCRIPTS, cw, loadMeetings, saveMeeting, readJson, writeJson, council, positionList, hoods, tracked, attachmentsText, TAG_RULES, log, claudeJson, STYLE } from './lib.mjs';

const only = process.argv[2];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
const TMP = path.join(RAW_DIR, '.audio'); fs.mkdirSync(TMP, { recursive: true });
const ytdlp = (args) => execFileSync('yt-dlp', ['--no-warnings', '--no-progress', ...args], { maxBuffer: 256 << 20 }).toString();
const hms = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), Math.floor(s % 60)].map((n) => String(n).padStart(2, '0')).join(':');

// YouTube's own captions when they exist (free and instant), otherwise Whisper on the audio.
function transcribe(vid, dur) {
  const base = path.join(TMP, vid);
  try {
    ytdlp(['--skip-download', '--write-auto-subs', '--sub-langs', 'en.*', '--sub-format', 'json3', '-o', base, `https://www.youtube.com/watch?v=${vid}`]);
    const f = fs.readdirSync(TMP).find((x) => x.startsWith(vid) && x.endsWith('.json3'));
    if (f) {
      const ev = JSON.parse(fs.readFileSync(path.join(TMP, f), 'utf8')).events || [];
      const lines = ev.filter((e) => e.segs).map((e) => `[${hms(e.tStartMs / 1000)}] ${e.segs.map((s) => s.utf8).join('').replace(/\s+/g, ' ').trim()}`).filter((l) => !/\]\s*$/.test(l));
      const last = ev.length ? ev[ev.length - 1].tStartMs / 1000 : 0;
      if (lines.length > 50 && last > dur * 0.9) return { text: lines.join('\n'), from: 'YouTube automatic captions' };
      log('captions incomplete, using Whisper');
    }
  } catch (e) { log('no captions:', e.message.split('\n')[0]); }
  ytdlp(['-f', 'bestaudio[ext=m4a]/bestaudio', '-o', `${base}.%(ext)s`, `https://www.youtube.com/watch?v=${vid}`]);
  const audio = fs.readdirSync(TMP).find((x) => x.startsWith(vid) && !x.endsWith('.json3'));
  const out = `${base}.txt`;
  execFileSync('python3', [path.join(ROOT, 'scripts', 'pipeline', 'transcribe.py'), path.join(TMP, audio), out], { stdio: 'inherit' });
  const text = fs.readFileSync(out, 'utf8');
  // A transcode that exits 0 isn't proof it finished: the last timestamp must reach the end of the video.
  const lastTs = [...text.matchAll(/^\[(\d+):(\d+):(\d+)\]/gm)].pop();
  const reached = lastTs ? (+lastTs[1]) * 3600 + (+lastTs[2]) * 60 + (+lastTs[3]) : 0;
  if (reached < dur * 0.9) throw new Error(`transcript stops at ${hms(reached)} of ${hms(dur)}`);
  return { text, from: 'meeting audio (transcribed by Whisper)' };
}

const people = council();
const roster = people.map((c) => `${c.slug}: ${c.office === 'mayor' ? 'Mayor' : 'Councillor'} ${c.name}`).join('\n');
const promises = readJson(path.join(ROOT, 'data', 'promises.json'), []);
const questions = readJson(path.join(ROOT, 'data', 'questions.json'));
const slugs = people.map((c) => c.slug);
const positions = positionList(people);
const voteProps = Object.fromEntries(slugs.map((s) => [s, { type: 'string', enum: ['yes', 'no', 'absent', 'recused', 'unknown'] }]));

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'decisions', 'promise_updates', 'no_video_content'],
  properties: {
    no_video_content: { type: 'boolean', description: 'true if the recording has no real meeting in it (only standby, or only a vote to go in camera)' },
    summary: {
      type: 'object', additionalProperties: false, required: ['headline', 'key_points', 'explainer'],
      properties: {
        headline: { type: 'string', description: 'One plain sentence: the most important thing that happened.' },
        key_points: { type: 'array', items: { type: 'string' }, description: '4 to 8 short plain bullets covering the most important points and every important vote result.' },
        explainer: { type: 'array', items: { type: 'string' }, description: '2 to 5 short paragraphs explaining the meeting a bit more, still in plain words: the background, what was argued, what happens next.' },
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'what', 'why_it_matters', 'for_you', 'areas', 'issues', 'result', 'votes', 'votes_confidence', 'topic', 'related_q', 'positions', 'timestamp'],
        properties: {
          title: { type: 'string', description: 'Plain title, e.g. "Rezoning for 120 rental homes on Pioneer Way".' },
          what: { type: 'string', description: 'One to three plain sentences: what council decided and what it means.' },
          why_it_matters: { type: 'string', description: 'One plain sentence on why a resident might care. Empty string if routine.' },
          for_you: { type: 'string' },
          areas: { type: 'array', items: { type: 'string' } },
          issues: { type: 'array', items: { type: 'string' } },
          result: { type: 'string', enum: ['passed', 'failed', 'referred', 'info'] },
          votes: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: slugs, properties: voteProps }], description: 'null for items with no vote. Otherwise every member. "unknown" when the recording does not make it clear.' },
          votes_confidence: { type: 'string', enum: ['clear', 'likely', 'unclear', 'none'] },
          topic: { type: 'string' },
          related_q: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'yes_is'], properties: { q: { type: 'string' }, yes_is: { type: 'integer', enum: [1, -1] } } }, description: 'Quiz statements this vote directly tests. yes_is 1 if voting yes agrees with the statement, -1 if it disagrees. Only include clear, direct links.' },
          positions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'yes_is'], properties: { id: { type: 'string' }, yes_is: { type: 'integer', enum: [1, -1] } } }, description: 'Campaign positions (from the POSITIONS list) this vote directly tests. yes_is 1 if voting yes goes the same way as that position, -1 if voting yes goes against it.' },
          timestamp: { type: 'string', description: 'hh:mm:ss in the recording where this item starts, or empty.' },
        },
      },
    },
    promise_updates: {
      type: 'array', description: 'Only promises that a vote at THIS meeting clearly tests.',
      items: { type: 'object', additionalProperties: false, required: ['id', 'status', 'note'], properties: { id: { type: 'string' }, status: { type: 'string', enum: ['kept', 'broken', 'progress'] }, note: { type: 'string', description: 'One plain sentence with the evidence, e.g. "Voted no on the 2027 budget increase of 4.9%, as promised."' } } },
    },
  },
};

const todo = loadMeetings().filter((m) => (only ? m.id === only : m.civicweb_id && !m.summary && m.date <= today && m.status !== 'cancelled'));
for (const m of todo) {
  log('summarising', m.id);
  const ev = await cw(`/api/getevent/${m.civicweb_id}`).catch(() => null);
  const vids = (ev?.Events || []).map((e) => e.eventId).filter(Boolean);
  if (!vids.length && ev?.eventId) vids.push(ev.eventId);
  // YouTube refuses cloud servers ("Sign in to confirm you're not a bot"), so the GitHub job sets SKIP_VIDEO and only
  // summarises from the official minutes; Jeff's Mac (scripts/pipeline/mac/run.sh) does the video, usually the next day.
  let parts = [];
  if (vids.length && !process.env.SKIP_VIDEO) {
    try {
      for (const vid of vids) {
        // Only once YouTube has finished processing the recording (evening meetings take about 12 hours).
        const info = JSON.parse(ytdlp(['-J', '--skip-download', `https://www.youtube.com/watch?v=${vid}`]));
        if (info.live_status !== 'was_live' && info.live_status !== 'not_live') throw new Error(`video ${vid} is ${info.live_status}`);
        parts.push({ vid, dur: info.duration, ...transcribe(vid, info.duration) });
      }
    } catch (e) { log('video not usable:', e.message.split('\n')[0]); parts = []; }
  }
  const minutesFile = path.join(RAW_DIR, `${m.id}-minutes.txt`);
  const fromMinutes = !parts.length && fs.existsSync(minutesFile);
  if (!parts.length && !fromMinutes) { log('nothing to summarise from yet'); continue; }
  const transcript = parts.map((p, i) => (parts.length > 1 ? `=== Recording ${i + 1} of ${parts.length} ===\n` : '') + p.text).join('\n\n');
  if (parts.length) fs.writeFileSync(path.join(TRANSCRIPTS, `${m.id}.txt`), `Transcript of the ${m.civicweb_name}, District of Squamish, ${m.date}.\nMade automatically from the ${parts[0].from}. It will contain mistakes; the official video and minutes are the record.\n\n${transcript}\n`);
  const agenda = fs.existsSync(path.join(RAW_DIR, `${m.id}-agenda.txt`)) ? fs.readFileSync(path.join(RAW_DIR, `${m.id}-agenda.txt`), 'utf8') : '(no agenda text saved)';

  const out = await claudeJson({
    system: STYLE,
    content: `Summarise this District of Squamish council meeting for residents.

MEETING: ${m.civicweb_name} (${m.date})

COUNCIL (use these ids in "votes"):
${roster}

${fromMinutes ? 'SOURCE: the official draft minutes (no transcript). In the minutes, a motion marked CARRIED or DEFEATED with no names opposed means every member present voted yes; named members "OPPOSED" voted no; members not listed IN ATTENDANCE are "absent"; members who declared a conflict and left are "recused". Leave every timestamp empty.' : ''}

HOW VOTES WORK HERE: the chair calls the question and asks who is opposed. Unless the recording shows someone voting against, leaving the room, declaring a conflict of interest, or being absent, every member present voted yes. Members away for the whole meeting are "absent". A member who declares a conflict and leaves is "recused". If you can't tell from the recording, use "unknown" and set votes_confidence to "unclear"; the official minutes will settle it later.

Include every motion that was voted on (skip only adopting the agenda and adjourning), plus important presentations or discussions with no vote (votes null, result "info"). Put the most important first.

CAMPAIGN PROMISES WE TRACK (only update one if a vote here clearly tests it; a member who votes the way they promised has kept it even if the vote failed):
${JSON.stringify(promises.map((p) => ({ id: p.id, who: p.slug, promise: p.promise, how_to_check: p.how_to_check })))}

CAMPAIGN POSITIONS (for "positions"; what each member said they support or are against). Link a vote to every position it directly tests, for any member, even ones not marked as promises. Example: a vote to fund keeping a shelter downtown tests "against: moving Under One Roof" (yes_is 1) and "supports: moving it out" (yes_is -1). Only clear, direct links; leave it empty when nothing fits:
${JSON.stringify(positions)}

FOR EACH DECISION ALSO SET:
${TAG_RULES}

NEIGHBOURHOODS: ${JSON.stringify(hoods())}

TRACKED ISSUES: ${JSON.stringify(tracked())}

QUIZ STATEMENTS (for related_q; every member's agree/disagree answers are checked against these, so link every statement a vote directly tests):
${JSON.stringify(questions.map((q) => ({ id: q.id, text: q.text })))}

AGENDA:
${agenda.slice(0, 300000)}

STAFF REPORTS AND ATTACHMENTS (for costs and details; may be cut short):
${await attachmentsText(m)}

${fromMinutes ? `OFFICIAL MINUTES:\n${fs.readFileSync(minutesFile, 'utf8')}` : `TRANSCRIPT (automatic, with timestamps; names and words may be misheard):\n${transcript}`}`,
    schema: SCHEMA,
  });
  const vurl = vids.length ? `https://www.youtube.com/watch?v=${vids[0]}` : null;
  if (out.no_video_content) { m.summary = null; m.closed_only = true; m.video_url = vurl; saveMeeting(m); continue; }

  const t0 = (ts) => { const p = (ts || '').split(':').map(Number); return p.length === 3 && p.every((n) => !isNaN(n)) ? p[0] * 3600 + p[1] * 60 + p[2] : null; };
  m.summary = out.summary;
  const known = new Set(positions.map((x) => x.id));
  m.decisions = out.decisions.map((d) => ({ ...d, positions: d.positions.filter((x) => known.has(x.id)), votes: d.votes, video_url: vurl && t0(d.timestamp) != null ? `${vurl}&t=${t0(d.timestamp)}s` : null, votes_source: fromMinutes ? 'minutes' : 'video', ...(fromMinutes ? { votes_confidence: 'clear' } : {}) }));
  m.video_url = vurl;
  m.transcript = !fromMinutes;
  if (fromMinutes) m.votes_source = 'minutes';
  m.generated = { at: new Date().toISOString(), model: 'claude-opus-5-5', from: fromMinutes ? 'official minutes and the agenda' : parts[0].from === 'YouTube automatic captions' ? 'meeting video’s automatic captions and the agenda' : 'meeting audio and the agenda' };
  // Promises: newest evidence wins the status, and every piece of evidence is kept.
  m.promise_updates = out.promise_updates.filter((u) => promises.some((p) => p.id === u.id));
  for (const u of m.promise_updates) {
    const p = promises.find((x) => x.id === u.id);
    p.status = u.status; p.updated = today;
    p.evidence = [...(p.evidence || []).filter((e) => e.meeting !== m.id), { meeting: m.id, note: u.note, status: u.status }];
  }
  writeJson(path.join(ROOT, 'data', 'promises.json'), promises);
  saveMeeting(m);
  log('summarised', m.id, `${m.decisions.length} items, ${m.promise_updates.length} promise updates`);
}
fs.rmSync(TMP, { recursive: true, force: true });
