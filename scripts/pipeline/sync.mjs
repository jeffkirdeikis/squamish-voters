// Step 1: keep the meeting list current, and turn each new or changed agenda into a plain-language preview.
//   node scripts/pipeline/sync.mjs
import path from 'node:path';
import fs from 'node:fs';
import { cw, CW, CW_TYPE, TERM_START, RAW_DIR, loadMeetings, saveMeeting, meetingId, htmlToText, sha, hoods, tracked, attachmentsText, TAG_RULES, log, claudeJson, STYLE } from './lib.mjs';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
const from = TERM_START > today ? TERM_START : new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
const list = await cw(`/Services/MeetingsService.svc/meetings?from=${from}&to=9999-12-31`);
const have = loadMeetings();

for (const it of list) {
  const type = CW_TYPE[it.TypeId];
  const [date, time] = it.MeetingDateTime.split(' ');
  if (!type || date < TERM_START) continue;
  const name = it.Name;
  const inaugural = /inaugural/i.test(name);
  // A meeting may already exist from the published schedule (no CivicWeb id yet): match it by date and type.
  let m = have.find((x) => x.civicweb_id === it.Id) || have.find((x) => !x.civicweb_id && x.date === date && (x.type === type || (inaugural && x.type === 'inaugural')));
  if (!m) { m = { id: meetingId(date, inaugural ? 'inaugural' : type), date, type: inaugural ? 'inaugural' : type }; have.push(m); log('new meeting', m.id); }
  Object.assign(m, { civicweb_id: it.Id, civicweb_name: name, date, time, place: 'Council Chambers, Municipal Hall, 37955 Second Avenue' });
  if (/CANCELLED/i.test(name)) m.status = 'cancelled';
  m.agenda_url = `${CW}/Portal/MeetingInformation.aspx?Id=${it.Id}`;
  saveMeeting(m);
}

// Agendas: fetch for anything in the next three weeks or held without a summary yet, and redo the preview when it changes.
for (const m of loadMeetings().filter((x) => x.civicweb_id && !x.summary && x.status !== 'cancelled')) {
  if (m.date > new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10)) continue;
  const docs = await cw(`/Services/MeetingsService.svc/meetings/${m.civicweb_id}/meetingDocuments`).catch(() => []);
  const ag = docs.find((d) => d.Type === 1 && d.IsPublic);
  if (!ag) continue;
  const { text, links } = htmlToText(ag.Html);
  const h = sha(text);
  fs.writeFileSync(path.join(RAW_DIR, `${m.id}-agenda.txt`), text);
  m.agenda_url = `${CW}/document/${ag.Id}/`;
  m.agenda_pdf = `${CW}/document/${ag.Id}/?printPdf=true`;
  m.attachments = links;
  if (m.agenda_hash === h) { saveMeeting(m); continue; }
  log('agenda changed', m.id);
  fs.rmSync(path.join(RAW_DIR, `${m.id}-attachments.txt`), { force: true });
  const out = await claudeJson({
    system: STYLE,
    effort: 'medium',
    maxTokens: 16000,
    content: `Below is the official agenda for the ${m.civicweb_name} of the District of Squamish council (${m.date}).

Write a preview for residents deciding whether to watch or attend:
- "preview": one or two sentences on what the meeting is mostly about.
- "agenda_items": the items residents would care about, most important first, at most 10. Skip routine items (adopting the agenda, approving minutes, adjourning) unless that is all there is. Each has "plain" (one plain sentence on what council is being asked to do), "kind" (vote, hearing, presentation, discussion or closed), and "topic" (one of: growth, housing_affordability, homelessness, policing, taxes_spending, environment_lng, transportation, parking, economy, recreation_facilities, flood_hazards_climate_resilience, other).
- For each agenda item also set:
${TAG_RULES}
- "has_public_hearing": true if the agenda includes a public hearing.
- "closed_only": true if the meeting exists only to move into a closed (in camera) session.

NEIGHBOURHOODS: ${JSON.stringify(hoods())}

TRACKED ISSUES: ${JSON.stringify(tracked())}

AGENDA:
${text.slice(0, 400000)}

STAFF REPORTS (for costs; may be cut short):
${await attachmentsText(m)}`,
    schema: {
      type: 'object', additionalProperties: false, required: ['preview', 'agenda_items', 'has_public_hearing', 'closed_only'],
      properties: {
        preview: { type: 'string' },
        has_public_hearing: { type: 'boolean' },
        closed_only: { type: 'boolean' },
        agenda_items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['plain', 'kind', 'topic', 'for_you', 'areas', 'issues'], properties: { plain: { type: 'string' }, kind: { type: 'string', enum: ['vote', 'hearing', 'presentation', 'discussion', 'closed'] }, topic: { type: 'string' }, for_you: { type: 'string' }, areas: { type: 'array', items: { type: 'string' } }, issues: { type: 'array', items: { type: 'string' } } } } },
      },
    },
  });
  Object.assign(m, out, { agenda_hash: h, agenda_checked: new Date().toISOString() });
  saveMeeting(m);
}
log('sync done');
