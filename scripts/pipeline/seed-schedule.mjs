// One-off: add the meetings the District has published in its 2026 schedule but not yet posted to CivicWeb,
// so the site lists them before their agendas exist. sync.mjs attaches each one when CivicWeb posts it.
// Source: https://squamish.ca/assets/Council-Meeting-files/2026-Regular-Business-Meeting-Schedule.pdf
import { loadMeetings, saveMeeting, meetingId } from './lib.mjs';

const SCHEDULE = [
  ['2026-11-03', 'inaugural', '18:00', 'The new mayor and councillors are sworn in and take their oath of office.'],
  ['2026-11-17', 'regular', '18:00', null],
  ['2026-12-01', 'regular', '18:00', null],
  ['2026-12-15', 'regular', '18:00', null],
];
const have = loadMeetings();
for (const [date, type, time, preview] of SCHEDULE) {
  if (have.some((m) => m.date === date && m.type === type)) continue;
  saveMeeting({ id: meetingId(date, type), date, type, time, place: 'Council Chambers, Municipal Hall, 37955 Second Avenue', ...(preview ? { preview } : {}), source: 'District of Squamish 2026 meeting schedule' });
  console.log('added', date, type);
}
