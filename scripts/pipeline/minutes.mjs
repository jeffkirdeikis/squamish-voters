// Step 3: when a later agenda carries the draft minutes of a meeting we summarised from video, check every
// result and vote against them. Minutes name who was opposed, so they settle anything the video left unclear.
//   node scripts/pipeline/minutes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { cw, RAW_DIR, loadMeetings, saveMeeting, pdfToText, council, log, claudeJson, STYLE } from './lib.mjs';

const KIND = { Regular: 'regular', Special: 'special', COW: 'cow' };
const all = loadMeetings();
const people = council(), slugs = people.map((c) => c.slug);
const roster = people.map((c) => `${c.slug}: ${c.office === 'mayor' ? 'Mayor' : 'Councillor'} ${c.name}`).join('\n');

for (const host of all.filter((m) => (m.attachments || []).length)) {
  for (const a of host.attachments) {
    const name = decodeURIComponent(a.url.split('/').pop());
    const mm = name.match(/(\d{2})(\d{2}) (Regular|Special|COW) Minutes (\d{4})(?: (10AM|6PM))?/i);
    if (!mm) continue;
    const date = `${mm[4]}-${mm[1]}-${mm[2]}`, type = KIND[mm[3]] || KIND[mm[3].toUpperCase()];
    const m = all.find((x) => x.date === date && (x.type === type || (x.type === 'inaugural' && type === 'regular')) && x.summary && x.votes_source !== 'minutes');
    if (!m) continue;
    log('minutes for', m.id, 'found in', host.id);
    const text = pdfToText(await cw(new URL(a.url).pathname, { json: false }));
    fs.writeFileSync(path.join(RAW_DIR, `${m.id}-minutes.txt`), text);
    const out = await claudeJson({
      system: STYLE,
      effort: 'high',
      content: `These are the official draft minutes of a District of Squamish council meeting, and the list of decisions we published from the meeting video. Check every decision against the minutes.

For each of our decisions (by index), return the result and every member's vote as the minutes record them. In these minutes, a motion marked CARRIED or DEFEATED with no names opposed means every member present voted yes. Named members "OPPOSED" voted no. Members not listed IN ATTENDANCE are "absent". Members who declared a conflict and left before the vote are "recused". If the minutes don't mention one of our decisions, return it unchanged with matched false.

Also list any motion in the minutes that we missed (skip adopting the agenda, approving earlier minutes and adjourning), written in the same plain style.

COUNCIL:
${roster}

OUR DECISIONS:
${JSON.stringify(m.decisions.map((d, i) => ({ i, title: d.title, what: d.what, result: d.result, votes: d.votes })))}

MINUTES:
${text}`,
      schema: {
        type: 'object', additionalProperties: false, required: ['checked', 'missed'],
        properties: {
          checked: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'matched', 'result', 'votes'], properties: { i: { type: 'integer' }, matched: { type: 'boolean' }, result: { type: 'string', enum: ['passed', 'failed', 'referred', 'info'] }, votes: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: slugs, properties: Object.fromEntries(slugs.map((s) => [s, { type: 'string', enum: ['yes', 'no', 'absent', 'recused', 'unknown'] }])) }] } } } },
          missed: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'what', 'result', 'votes', 'topic'], properties: { title: { type: 'string' }, what: { type: 'string' }, result: { type: 'string', enum: ['passed', 'failed', 'referred'] }, topic: { type: 'string' }, votes: { type: 'object', additionalProperties: false, required: slugs, properties: Object.fromEntries(slugs.map((s) => [s, { type: 'string', enum: ['yes', 'no', 'absent', 'recused'] }])) } } } },
        },
      },
    });
    let changed = 0;
    for (const c of out.checked) {
      const d = m.decisions[c.i]; if (!d || !c.matched) continue;
      if (JSON.stringify([d.result, d.votes]) !== JSON.stringify([c.result, c.votes])) { changed++; d.corrected_from = { result: d.result, votes: d.votes }; }
      Object.assign(d, { result: c.result, votes: c.votes, votes_source: 'minutes', votes_confidence: 'clear' });
    }
    m.decisions.push(...out.missed.map((d) => ({ ...d, why_it_matters: '', related_q: [], votes_source: 'minutes', votes_confidence: 'clear' })));
    Object.assign(m, { votes_source: 'minutes', minutes_url: a.url, minutes_checked: new Date().toISOString(), minutes_corrections: changed });
    saveMeeting(m);
    log(`checked ${m.id}: ${changed} corrected, ${out.missed.length} added`);
  }
}
