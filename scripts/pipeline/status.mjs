// How a promise or a campaign position gets its label. Shared by the pipeline (summarize.mjs, minutes.mjs) and
// build.mjs, so the label is always worked out again from ALL the evidence, never from the newest vote alone.
// No imports: build.mjs stays zero dependency.
//
// Fairness rules (review item 1 and 2, October 2026):
// - Only a member's own action counts: how they voted, what they moved or seconded. What council as a whole decides
//   is shown as a plain fact under "Did it happen?" and never changes their label.
// - Only votes checked against the official minutes can give a red label ("Not kept", "Voted against what they said").
//   A vote heard on the meeting video gives an "Early sign" at most, until the minutes confirm it.
// - Consent agenda items (routine items approved together in one vote) never give a red label.
// - A position needs 2 or more confirmed votes against it before it is marked red.

// One decision a promise's evidence points at, or null when the evidence predates decision links.
const decisionOf = (e, meetings) => {
  const m = meetings.find((x) => x.id === e.meeting);
  if (!m) return { m: null, d: null };
  const d = Number.isInteger(e.decision) ? (m.decisions || [])[e.decision] || null : null;
  return { m, d };
};

// Is this decision's vote record settled by the official minutes?
export const confirmedByMinutes = (d) => !!d && d.votes_source === 'minutes' && !d.consent_agenda;

// One piece of promise evidence, worked out against the vote record as it stands now (so a correction from the
// minutes flips it automatically). Returns { way: 'kept' | 'not_kept' | 'progress' | null, confirmed }.
export function readEvidence(p, e, meetings) {
  const { m, d } = decisionOf(e, meetings);
  let way = null;
  if (d && (e.keeps_if === 'yes' || e.keeps_if === 'no')) {
    const v = d.votes?.[p.slug];
    if (v === 'yes' || v === 'no') way = v === e.keeps_if ? 'kept' : 'not_kept';
    // Away, stepped out or not clear: this vote says nothing about their promise.
  } else {
    way = e.status === 'broken' ? 'not_kept' : ['kept', 'not_kept', 'progress'].includes(e.status) ? e.status : null;
  }
  const confirmed = d ? confirmedByMinutes(d) : !!(m && m.votes_source === 'minutes');
  return { way, confirmed };
}

// A promise's label from every piece of its evidence. Returns { status, kept, notKept, early, progress }.
//   kept / not_kept: only from minutes; mixed when confirmed votes went both ways; early: video only so far.
export function promiseTally(p, meetings) {
  if (p.testable === false) return { status: 'not_testable', kept: 0, notKept: 0, early: 0, progress: 0 };
  const t = { kept: 0, notKept: 0, early: 0, progress: 0 };
  for (const e of p.evidence || []) {
    const r = readEvidence(p, e, meetings);
    if (!r.way) continue;
    if (r.way === 'progress') t.progress++;
    else if (!r.confirmed) t.early++;
    else if (r.way === 'kept') t.kept++;
    else t.notKept++;
  }
  t.status = t.kept && t.notKept ? 'mixed' : t.notKept ? 'not_kept' : t.kept ? 'kept' : t.early ? 'early' : t.progress ? 'progress' : 'not_yet';
  return t;
}

// "Not kept (1 vote)", "Mixed (2 kept, 1 not kept)", "Early sign (1 vote, waiting for the minutes)".
const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
export function tallyText(t) {
  switch (t.status) {
    case 'kept': return n(t.kept, 'vote');
    case 'not_kept': return n(t.notKept, 'vote');
    case 'mixed': return `${t.kept} kept, ${t.notKept} not kept`;
    case 'early': return `${n(t.early, 'vote')}, waiting for the official minutes`;
    default: return '';
  }
}

// Recompute every promise's status from its evidence (pipeline: after a summary or a minutes check).
export function recomputePromises(promises, meetings) {
  let changed = 0;
  for (const p of promises) {
    const st = promiseTally(p, meetings).status;
    if (st !== p.status) { p.status = st; changed++; }
  }
  return changed;
}

// A campaign position's label from the votes that test it.
// checks: [{ inLine: bool, confirmed: bool }]; said: the campaign answer (-2..2) for agree/disagree statements.
export function positionStatus(checks) {
  if (!checks.length) return 'untested';
  const conf = checks.filter((x) => x.confirmed);
  const yes = conf.filter((x) => x.inLine).length, no = conf.length - yes;
  if (yes && no) return 'mixed';
  if (no >= 2) return 'against';
  if (yes) return 'in_line';
  return 'early'; // only video votes, or a single confirmed vote against: not enough for a red mark
}
